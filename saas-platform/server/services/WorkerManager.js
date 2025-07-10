const jwt = require('jsonwebtoken');
const { pool } = require('../database/connection');
const logger = require('../utils/logger');

class WorkerManager {
  constructor(io) {
    this.io = io;
    this.connectedWorkers = new Map(); // workerId -> socket
    this.workerHeartbeats = new Map(); // workerId -> timestamp
    
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  // Authenticate worker token
  async authenticateWorker(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.type !== 'worker') {
        throw new Error('Invalid token type');
      }

      // Get worker details from database
      const workerResult = await pool.query(
        'SELECT id, workspace_id, name, status FROM workers WHERE id = $1',
        [decoded.workerId]
      );

      if (workerResult.rows.length === 0) {
        throw new Error('Worker not found');
      }

      return workerResult.rows[0];

    } catch (error) {
      logger.error('Worker authentication failed:', error);
      throw new Error('Authentication failed');
    }
  }

  // Set worker as online
  async setWorkerOnline(workerId, socket) {
    try {
      this.connectedWorkers.set(workerId, socket);
      this.workerHeartbeats.set(workerId, Date.now());

      // Update database
      await pool.query(
        'UPDATE workers SET status = $1, last_seen = NOW(), last_heartbeat = NOW() WHERE id = $2',
        ['online', workerId]
      );

      logger.worker(`Worker online: ${workerId}`);

      // Notify admin dashboard
      this.notifyWorkspaceAdmins(socket.workspaceId, 'worker_status_update', {
        workerId: workerId,
        status: 'online'
      });

    } catch (error) {
      logger.error('Error setting worker online:', error);
    }
  }

  // Set worker as offline
  async setWorkerOffline(workerId) {
    try {
      this.connectedWorkers.delete(workerId);
      this.workerHeartbeats.delete(workerId);

      // Update database
      await pool.query(
        'UPDATE workers SET status = $1, last_seen = NOW() WHERE id = $2',
        ['offline', workerId]
      );

      logger.worker(`Worker offline: ${workerId}`);

      // Get workspace ID for notifications
      const workerResult = await pool.query(
        'SELECT workspace_id FROM workers WHERE id = $1',
        [workerId]
      );

      if (workerResult.rows.length > 0) {
        this.notifyWorkspaceAdmins(workerResult.rows[0].workspace_id, 'worker_status_update', {
          workerId: workerId,
          status: 'offline'
        });
      }

      // Cancel any running tasks assigned to this worker
      await this.cancelWorkerTasks(workerId);

    } catch (error) {
      logger.error('Error setting worker offline:', error);
    }
  }

  // Update worker status
  async updateWorkerStatus(workerId, status) {
    try {
      this.workerHeartbeats.set(workerId, Date.now());

      await pool.query(
        'UPDATE workers SET status = $1, last_seen = NOW(), last_heartbeat = NOW() WHERE id = $2',
        [status, workerId]
      );

      logger.worker(`Worker status updated: ${workerId} -> ${status}`);

    } catch (error) {
      logger.error('Error updating worker status:', error);
    }
  }

  // Get available workers for a workspace
  async getAvailableWorkers(workspaceId, capabilities = []) {
    try {
      let query = `
        SELECT id, name, capabilities, status, last_seen
        FROM workers 
        WHERE workspace_id = $1 AND status = 'online'
      `;
      
      const params = [workspaceId];

      // Filter by capabilities if specified
      if (capabilities.length > 0) {
        query += ` AND capabilities @> $2::jsonb`;
        params.push(JSON.stringify(capabilities));
      }

      query += ` ORDER BY total_tasks_completed ASC, last_seen DESC`;

      const result = await pool.query(query, params);
      return result.rows;

    } catch (error) {
      logger.error('Error getting available workers:', error);
      return [];
    }
  }

  // Assign task to best available worker
  async assignTaskToWorker(task) {
    try {
      const availableWorkers = await this.getAvailableWorkers(
        task.workspace_id,
        task.worker_filter?.capabilities || []
      );

      if (availableWorkers.length === 0) {
        logger.worker(`No available workers for task: ${task.id}`);
        return null;
      }

      // Select the worker with least tasks completed (load balancing)
      const selectedWorker = availableWorkers[0];

      // Update task assignment
      await pool.query(
        'UPDATE tasks SET assigned_worker_id = $1, status = $2, assigned_at = NOW() WHERE id = $3',
        [selectedWorker.id, 'assigned', task.id]
      );

      // Update worker status
      await pool.query(
        'UPDATE workers SET status = $1 WHERE id = $2',
        ['busy', selectedWorker.id]
      );

      // Send task to worker via WebSocket
      const workerSocket = this.connectedWorkers.get(selectedWorker.id);
      if (workerSocket) {
        workerSocket.emit('task_assigned', {
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          workspace_id: task.workspace_id
        });
      }

      logger.worker(`Task ${task.id} assigned to worker ${selectedWorker.id}`);

      // Notify admin dashboard
      this.notifyWorkspaceAdmins(task.workspace_id, 'task_assigned', {
        taskId: task.id,
        workerId: selectedWorker.id,
        workerName: selectedWorker.name
      });

      return selectedWorker;

    } catch (error) {
      logger.error('Error assigning task to worker:', error);
      return null;
    }
  }

  // Cancel tasks assigned to a worker
  async cancelWorkerTasks(workerId) {
    try {
      // Get running tasks for this worker
      const tasksResult = await pool.query(
        'SELECT id, workspace_id FROM tasks WHERE assigned_worker_id = $1 AND status IN ($2, $3)',
        [workerId, 'assigned', 'running']
      );

      for (const task of tasksResult.rows) {
        await pool.query(
          `UPDATE tasks SET 
             status = 'failed', 
             error_message = 'Worker disconnected unexpectedly',
             completed_at = NOW()
           WHERE id = $1`,
          [task.id]
        );

        // Notify admin dashboard
        this.notifyWorkspaceAdmins(task.workspace_id, 'task_failed', {
          taskId: task.id,
          error: 'Worker disconnected unexpectedly'
        });
      }

      if (tasksResult.rows.length > 0) {
        logger.worker(`Cancelled ${tasksResult.rows.length} tasks for disconnected worker: ${workerId}`);
      }

    } catch (error) {
      logger.error('Error cancelling worker tasks:', error);
    }
  }

  // Get worker statistics
  async getWorkerStats(workspaceId) {
    try {
      const result = await pool.query(
        `SELECT 
           COUNT(*) as total_workers,
           COUNT(*) FILTER (WHERE status = 'online') as online_workers,
           COUNT(*) FILTER (WHERE status = 'busy') as busy_workers,
           COUNT(*) FILTER (WHERE status = 'offline') as offline_workers,
           COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '5 minutes') as recently_active
         FROM workers
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      return result.rows[0];

    } catch (error) {
      logger.error('Error getting worker stats:', error);
      return {
        total_workers: 0,
        online_workers: 0,
        busy_workers: 0,
        offline_workers: 0,
        recently_active: 0
      };
    }
  }

  // Notify workspace admins via WebSocket
  notifyWorkspaceAdmins(workspaceId, event, data) {
    try {
      const adminNamespace = this.io.of('/admin');
      adminNamespace.to(`workspace:${workspaceId}`).emit(event, data);
    } catch (error) {
      logger.error('Error notifying workspace admins:', error);
    }
  }

  // Periodic cleanup of inactive workers
  startPeriodicCleanup() {
    setInterval(async () => {
      try {
        const now = Date.now();
        const inactiveThreshold = 5 * 60 * 1000; // 5 minutes

        // Check for workers that haven't sent heartbeat recently
        for (const [workerId, lastHeartbeat] of this.workerHeartbeats.entries()) {
          if (now - lastHeartbeat > inactiveThreshold) {
            logger.worker(`Worker inactive, marking offline: ${workerId}`);
            
            // Mark as offline but don't remove from maps yet
            // (in case it's just a temporary network issue)
            await pool.query(
              'UPDATE workers SET status = $1 WHERE id = $2 AND status != $3',
              ['offline', workerId, 'offline']
            );
          }
        }

        // Clean up workers that have been offline for too long
        const offlineThreshold = 24 * 60 * 60 * 1000; // 24 hours
        const cutoffTime = new Date(now - offlineThreshold);

        const oldWorkersResult = await pool.query(
          'SELECT id FROM workers WHERE last_seen < $1 AND status = $2',
          [cutoffTime, 'offline']
        );

        for (const worker of oldWorkersResult.rows) {
          this.connectedWorkers.delete(worker.id);
          this.workerHeartbeats.delete(worker.id);
        }

        // Log cleanup stats
        if (oldWorkersResult.rows.length > 0) {
          logger.worker(`Cleaned up ${oldWorkersResult.rows.length} inactive workers`);
        }

      } catch (error) {
        logger.error('Error in periodic worker cleanup:', error);
      }
    }, 60000); // Run every minute
  }

  // Broadcast message to all workers in a workspace
  async broadcastToWorkspace(workspaceId, event, data) {
    try {
      const workersResult = await pool.query(
        'SELECT id FROM workers WHERE workspace_id = $1',
        [workspaceId]
      );

      let sentCount = 0;
      for (const worker of workersResult.rows) {
        const socket = this.connectedWorkers.get(worker.id);
        if (socket) {
          socket.emit(event, data);
          sentCount++;
        }
      }

      logger.worker(`Broadcasted ${event} to ${sentCount} workers in workspace ${workspaceId}`);

    } catch (error) {
      logger.error('Error broadcasting to workspace workers:', error);
    }
  }

  // Get connected worker count
  getConnectedWorkerCount() {
    return this.connectedWorkers.size;
  }

  // Check if worker is connected
  isWorkerConnected(workerId) {
    return this.connectedWorkers.has(workerId);
  }
}

module.exports = WorkerManager; 