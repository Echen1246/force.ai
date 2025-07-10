const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
require('dotenv').config();

// Import custom modules
const authRoutes = require('./routes/auth');
const workspaceRoutes = require('./routes/workspaces');
const workerRoutes = require('./routes/workers');
const taskRoutes = require('./routes/tasks');
const webhookRoutes = require('./routes/webhooks');
const { authenticateToken, authenticateWorker } = require('./middleware/auth');
const logger = require('./utils/logger');
const { pool } = require('./database/connection');
const WorkerManager = require('./services/WorkerManager');
const TaskManager = require('./services/TaskManager');

class SaaSPlatform {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });
    
    this.workerManager = new WorkerManager(this.io);
    this.taskManager = new TaskManager(this.io, this.workerManager);
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSockets();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true
    }));
    
    // Performance middleware
    this.app.use(compression());
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP'
    });
    this.app.use(limiter);
    
    // Logging
    this.app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });
    
    // Database health check
    this.app.get('/health/db', async (req, res) => {
      try {
        await pool.query('SELECT 1');
        res.json({ status: 'healthy' });
      } catch (error) {
        logger.error('Database health check failed:', error);
        res.status(500).json({ status: 'unhealthy', error: error.message });
      }
    });
  }

  setupRoutes() {
    // Public routes
    this.app.use('/auth', authRoutes);
    this.app.use('/webhooks', webhookRoutes); // Stripe webhooks etc.
    
    // Protected routes (require authentication)
    this.app.use('/workspaces', authenticateToken, workspaceRoutes);
    this.app.use('/tasks', authenticateToken, taskRoutes);
    
    // Worker routes (require worker authentication)
    this.app.use('/workers', workerRoutes);
    
    // API documentation
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Browser Use Orchestration Platform',
        version: '1.0.0',
        description: 'SaaS platform for managing browser automation workers',
        endpoints: {
          auth: '/auth',
          workspaces: '/workspaces',
          workers: '/workers',
          tasks: '/tasks',
          health: '/health'
        }
      });
    });
  }

  setupWebSockets() {
    // Admin dashboard connections
    const adminNamespace = this.io.of('/admin');
    adminNamespace.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user workspace
        const userResult = await pool.query(
          'SELECT w.* FROM workspaces w JOIN workspace_members wm ON w.id = wm.workspace_id WHERE wm.user_id = $1',
          [decoded.userId]
        );
        
        if (userResult.rows.length === 0) {
          return next(new Error('No workspace found'));
        }
        
        socket.userId = decoded.userId;
        socket.workspaceId = userResult.rows[0].id;
        socket.join(`workspace:${socket.workspaceId}`);
        
        next();
      } catch (err) {
        next(new Error('Authentication failed'));
      }
    });
    
    adminNamespace.on('connection', (socket) => {
      logger.info(`Admin connected: userId=${socket.userId}, workspaceId=${socket.workspaceId}`);
      
      // Send current workspace status
      this.sendWorkspaceStatus(socket);
      
      // Handle task creation
      socket.on('create_task', async (taskData) => {
        try {
          const task = await this.taskManager.createTask(socket.workspaceId, socket.userId, taskData);
          socket.emit('task_created', task);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });
      
      socket.on('disconnect', () => {
        logger.info(`Admin disconnected: userId=${socket.userId}`);
      });
    });

    // Worker connections
    const workerNamespace = this.io.of('/workers');
    workerNamespace.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        const worker = await this.workerManager.authenticateWorker(token);
        
        socket.workerId = worker.id;
        socket.workspaceId = worker.workspace_id;
        socket.join(`workspace:${socket.workspaceId}`);
        
        next();
      } catch (err) {
        next(new Error('Worker authentication failed'));
      }
    });
    
    workerNamespace.on('connection', (socket) => {
      logger.info(`Worker connected: workerId=${socket.workerId}`);
      
      // Register worker as online
      this.workerManager.setWorkerOnline(socket.workerId, socket);
      
      // Handle task completion
      socket.on('task_complete', async (taskResult) => {
        try {
          await this.taskManager.completeTask(taskResult.taskId, taskResult);
          
          // Notify admin dashboard
          adminNamespace.to(`workspace:${socket.workspaceId}`).emit('task_completed', taskResult);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });
      
      // Handle task logs
      socket.on('task_log', async (logData) => {
        await this.taskManager.addTaskLog(logData.taskId, socket.workerId, logData);
        
        // Forward to admin dashboard
        adminNamespace.to(`workspace:${socket.workspaceId}`).emit('task_log', logData);
      });
      
      // Handle worker status updates
      socket.on('status_update', async (status) => {
        await this.workerManager.updateWorkerStatus(socket.workerId, status);
        
        // Notify admin dashboard
        adminNamespace.to(`workspace:${socket.workspaceId}`).emit('worker_status_update', {
          workerId: socket.workerId,
          status: status
        });
      });
      
      socket.on('disconnect', () => {
        logger.info(`Worker disconnected: workerId=${socket.workerId}`);
        this.workerManager.setWorkerOffline(socket.workerId);
        
        // Notify admin dashboard
        adminNamespace.to(`workspace:${socket.workspaceId}`).emit('worker_status_update', {
          workerId: socket.workerId,
          status: 'offline'
        });
      });
    });
  }

  async sendWorkspaceStatus(socket) {
    try {
      // Get workspace workers
      const workersResult = await pool.query(
        'SELECT id, name, status, last_seen, total_tasks_completed FROM workers WHERE workspace_id = $1',
        [socket.workspaceId]
      );
      
      // Get recent tasks
      const tasksResult = await pool.query(
        'SELECT id, title, status, created_at, completed_at FROM tasks WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 10',
        [socket.workspaceId]
      );
      
      socket.emit('workspace_status', {
        workers: workersResult.rows,
        recentTasks: tasksResult.rows
      });
    } catch (error) {
      logger.error('Failed to send workspace status:', error);
    }
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`
      });
    });
    
    // Global error handler
    this.app.use((err, req, res, next) => {
      logger.error('Unhandled error:', err);
      
      const status = err.status || 500;
      const message = process.env.NODE_ENV === 'production' 
        ? 'Internal Server Error' 
        : err.message;
      
      res.status(status).json({
        error: 'Server Error',
        message: message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
      });
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received. Shutting down gracefully...');
      this.server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
      });
    });
  }

  start(port = process.env.PORT || 3001) {
    this.server.listen(port, () => {
      logger.info(`🚀 SaaS Platform running on port ${port}`);
      logger.info(`📊 Admin Dashboard: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      logger.info(`🔌 WebSocket endpoints: /admin, /workers`);
      logger.info(`💾 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
    });
  }
}

// Start the server
const platform = new SaaSPlatform();
platform.start();

module.exports = SaaSPlatform; 