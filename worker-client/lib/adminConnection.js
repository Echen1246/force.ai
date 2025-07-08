const WebSocket = require('ws');
const EventEmitter = require('events');

class AdminConnection extends EventEmitter {
  constructor(adminUrl) {
    super();
    this.adminUrl = adminUrl;
    this.ws = null;
    this.isConnected = false;
    this.isRegistered = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectInterval = 3000; // 3 seconds
    this.heartbeatInterval = null;
    this.workerInfo = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Connecting to admin server: ${this.adminUrl}`);
        
        this.ws = new WebSocket(this.adminUrl);
        
        this.ws.on('open', () => {
          console.log('✅ Connected to admin server');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.emit('connected');
          resolve();
        });
        
        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            console.error('❌ Failed to parse message:', error);
          }
        });
        
        this.ws.on('close', (code, reason) => {
          console.log(`📡 Connection closed: ${code} - ${reason}`);
          this.isConnected = false;
          this.isRegistered = false;
          this.stopHeartbeat();
          this.emit('disconnected');
          
          // Attempt to reconnect if not intentionally closed
          if (code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        });
        
        this.ws.on('error', (error) => {
          console.error('❌ WebSocket error:', error);
          this.emit('error', error);
          
          if (!this.isConnected) {
            reject(error);
          }
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Worker disconnecting');
      this.ws = null;
    }
    this.isConnected = false;
    this.isRegistered = false;
    this.stopHeartbeat();
  }

  async register(registrationData) {
    if (!this.isConnected) {
      throw new Error('Not connected to admin server');
    }

    const { token, workerInfo } = registrationData;
    this.workerInfo = workerInfo;

    console.log(`🔐 Registering worker with token: ${token}`);
    
    this.send({
      type: 'REGISTER_WORKER',
      token: token,
      workerInfo: workerInfo
    });

    // Wait for registration confirmation
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Registration timeout'));
      }, 10000); // 10 second timeout

      const onRegistered = (workerInfo) => {
        clearTimeout(timeout);
        this.removeListener('registration-failed', onFailed);
        resolve(workerInfo);
      };

      const onFailed = (error) => {
        clearTimeout(timeout);
        this.removeListener('registered', onRegistered);
        reject(new Error(error));
      };

      this.once('registered', onRegistered);
      this.once('registration-failed', onFailed);
    });
  }

  handleMessage(message) {
    const { type, ...payload } = message;
    
    console.log(`📨 Received: ${type}`);
    
    switch (type) {
      case 'CONNECTION_ESTABLISHED':
        // Initial connection established, can now register
        break;
        
      case 'REGISTRATION_CONFIRMED':
        console.log(`✅ Worker registered: ${payload.workerName} (${payload.workerId})`);
        this.isRegistered = true;
        this.emit('registered', {
          workerId: payload.workerId,
          workerName: payload.workerName
        });
        break;
        
      case 'TASK_ASSIGNMENT':
        console.log(`📋 Task assigned: ${payload.task}`);
        this.emit('task-assigned', {
          taskId: payload.taskId,
          task: payload.task,
          credentials: payload.credentials || {}
        });
        break;
        
      case 'CREDENTIAL_RESPONSE':
        this.emit('credentials-received', {
          credentials: payload.credentials,
          requestId: payload.requestId
        });
        break;
        
      case 'HEARTBEAT_ACK':
        // Heartbeat acknowledged
        break;
        
      case 'ERROR':
        console.error(`❌ Server error: ${payload.message}`);
        if (payload.message.includes('Invalid') || payload.message.includes('token')) {
          this.emit('registration-failed', payload.message);
        } else {
          this.emit('error', new Error(payload.message));
        }
        break;
        
      default:
        console.warn(`⚠️ Unknown message type: ${type}`);
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('❌ Cannot send message: WebSocket not connected');
    }
  }

  sendStatusUpdate(status, currentTask = null) {
    this.send({
      type: 'STATUS_UPDATE',
      status: status,
      currentTask: currentTask
    });
  }

  sendExecutionLog(log, level = 'info') {
    this.send({
      type: 'EXECUTION_LOG',
      log: log,
      level: level
    });
  }

  sendTaskComplete(taskId, success, result = null, error = null) {
    this.send({
      type: 'TASK_COMPLETE',
      taskId: taskId,
      success: success,
      result: result,
      error: error
    });
  }

  requestCredentials(requestedKeys = []) {
    const requestId = require('crypto').randomUUID();
    
    this.send({
      type: 'CREDENTIAL_REQUEST',
      requestedKeys: requestedKeys,
      requestId: requestId
    });
    
    // Return promise that resolves when credentials are received
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Credential request timeout'));
      }, 5000);

      const onCredentials = (data) => {
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          this.removeListener('credentials-received', onCredentials);
          resolve(data.credentials);
        }
      };

      this.on('credentials-received', onCredentials);
    });
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        this.send({
          type: 'HEARTBEAT',
          timestamp: new Date().toISOString()
        });
      }
    }, 30000); // Send heartbeat every 30 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      if (!this.isConnected && this.reconnectAttempts <= this.maxReconnectAttempts) {
        try {
          await this.connect();
          
          // Re-register if we had worker info
          if (this.workerInfo) {
            await this.register({
              token: this.lastToken,
              workerInfo: this.workerInfo
            });
          }
        } catch (error) {
          console.error('❌ Reconnect failed:', error);
        }
      }
    }, delay);
  }

  // Store token for reconnection
  setToken(token) {
    this.lastToken = token;
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      registered: this.isRegistered,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

module.exports = AdminConnection; 