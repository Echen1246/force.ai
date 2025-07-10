const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const WorkerManager = require('./lib/workerManager');
const CredentialStore = require('./lib/credentialStore');
const MessageRouter = require('./lib/messageRouter');

class AdminServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    
    this.workerManager = new WorkerManager();
    this.credentialStore = new CredentialStore();
    this.messageRouter = new MessageRouter(this.wss, this.workerManager, this.credentialStore);
    
    this.currentToken = this.generateToken();
    this.tokenExpiry = Date.now() + (10 * 60 * 1000); // 10 minutes
    
    this.setupExpress();
    this.setupWebSocket();
    this.setupTokenRotation();
  }

  generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 6; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  setupTokenRotation() {
    setInterval(() => {
      if (Date.now() > this.tokenExpiry) {
        this.currentToken = this.generateToken();
        this.tokenExpiry = Date.now() + (10 * 60 * 1000);
        console.log(`🔄 New worker token generated: ${this.currentToken}`);
        
        // Broadcast new token to all connected admin clients
        this.messageRouter.broadcastToAdmins({
          type: 'TOKEN_UPDATE',
          token: this.currentToken,
          expiresAt: this.tokenExpiry
        });
      }
    }, 30000); // Check every 30 seconds
  }

  setupExpress() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // API endpoints
    this.app.get('/api/status', (req, res) => {
      res.json({
        workers: this.workerManager.getConnectedWorkers(),
        currentToken: this.currentToken,
        tokenExpiresAt: this.tokenExpiry
      });
    });

    this.app.get('/api/credentials', (req, res) => {
      const credentialsObj = this.credentialStore.getAllCredentials();
      const credentialsArray = Object.entries(credentialsObj).map(([key, value]) => ({
        key: key,
        value: value
      }));
      res.json(credentialsArray);
    });

    this.app.post('/api/credentials', (req, res) => {
      const { key, value } = req.body;
      this.credentialStore.setCredential(key, value);
      res.json({ success: true });
    });

    this.app.delete('/api/credentials/:key', (req, res) => {
      this.credentialStore.removeCredential(req.params.key);
      res.json({ success: true });
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, request) => {
      console.log('📡 New WebSocket connection');

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.messageRouter.handleMessage(ws, message);
        } catch (error) {
          console.error('❌ Invalid message format:', error);
          ws.send(JSON.stringify({
            type: 'ERROR',
            message: 'Invalid message format'
          }));
        }
      });

      ws.on('close', () => {
        console.log('📡 WebSocket connection closed');
        this.workerManager.removeWorker(ws);
      });

      ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
      });

      // Send initial connection info
      ws.send(JSON.stringify({
        type: 'CONNECTION_ESTABLISHED',
        currentToken: this.currentToken,
        tokenExpiresAt: this.tokenExpiry
      }));
    });
  }

  start(port = 3000) {
    this.server.listen(port, () => {
      console.log(`🚀 Admin Server running on port ${port}`);
      console.log(`📋 Current worker token: ${this.currentToken}`);
      console.log(`⏰ Token expires at: ${new Date(this.tokenExpiry).toLocaleTimeString()}`);
      console.log(`🌐 Admin interface: http://localhost:${port}`);
    });
  }
}

// Start the server
const server = new AdminServer();
server.start(process.env.PORT || 3000); 