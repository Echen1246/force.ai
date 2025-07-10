const { v4: uuidv4 } = require('uuid');

class MessageRouter {
  constructor(wss, workerManager, credentialStore) {
    this.wss = wss;
    this.workerManager = workerManager;
    this.credentialStore = credentialStore;
    this.adminConnections = new Set();
  }

  handleMessage(ws, message) {
    const { type, ...payload } = message;
    
    console.log(`📨 Received message: ${type}`);
    
    switch (type) {
      case 'ADMIN_CONNECT':
        this.handleAdminConnect(ws);
        break;
        
      case 'REGISTER_WORKER':
        this.handleWorkerRegistration(ws, payload);
        break;
        
      case 'TASK_ASSIGNMENT':
        this.handleTaskAssignment(payload);
        break;
        
      case 'STATUS_UPDATE':
        this.handleStatusUpdate(ws, payload);
        break;
        
      case 'EXECUTION_LOG':
        this.handleExecutionLog(ws, payload);
        break;
        
      case 'CREDENTIAL_REQUEST':
        this.handleCredentialRequest(ws, payload);
        break;
        
      case 'TASK_COMPLETE':
        this.handleTaskComplete(ws, payload);
        break;
        
      case 'HEARTBEAT':
        this.handleHeartbeat(ws, payload);
        break;
        
      case 'GET_WORKERS':
        this.handleGetWorkers(ws);
        break;
        
      default:
        console.warn(`⚠️ Unknown message type: ${type}`);
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }

  handleAdminConnect(ws) {
    this.adminConnections.add(ws);
    console.log('👑 Admin connected');
    
    // Send current status to admin
    ws.send(JSON.stringify({
      type: 'ADMIN_CONNECTED',
      workers: this.workerManager.getConnectedWorkers(),
      timestamp: new Date().toISOString()
    }));
    
    // Remove admin connection when disconnected
    ws.on('close', () => {
      this.adminConnections.delete(ws);
      console.log('👑 Admin disconnected');
    });
  }

  handleWorkerRegistration(ws, payload) {
    const { token, workerInfo } = payload;
    
    // In a real implementation, you'd validate the token here
    // For MVP, we'll accept any non-empty token
    if (!token || token.trim() === '') {
      this.sendError(ws, 'Invalid or missing token');
      return;
    }
    
    try {
      const worker = this.workerManager.registerWorker(ws, token, workerInfo);
      
      // Send registration confirmation to worker
      ws.send(JSON.stringify({
        type: 'REGISTRATION_CONFIRMED',
        workerId: worker.id,
        workerName: worker.name,
        timestamp: new Date().toISOString()
      }));
      
      // Notify all admins about new worker
      this.broadcastToAdmins({
        type: 'WORKER_REGISTERED',
        worker: {
          id: worker.id,
          name: worker.name,
          status: worker.status,
          capabilities: worker.capabilities,
          registeredAt: worker.registeredAt
        }
      });
      
    } catch (error) {
      console.error('❌ Worker registration failed:', error);
      this.sendError(ws, 'Registration failed');
    }
  }

  handleTaskAssignment(payload) {
    const { task, targetWorker } = payload;
    
    if (!task) {
      console.error('❌ No task provided in assignment');
      return;
    }
    
    console.log(`📋 Assigning task: "${task}" to ${targetWorker || 'all workers'}`);
    
    // Get all available credentials for the task
    const credentials = this.credentialStore ? this.credentialStore.getAllCredentials() : {};
    console.log(`🔑 Including ${Object.keys(credentials).length} credentials with task`);
    
    const taskData = {
      id: require('crypto').randomUUID(),
      task: task,
      credentials: credentials,
      assignedAt: new Date().toISOString()
    };
    
    const assignedWorkers = [];
    
    if (targetWorker === 'all' || !targetWorker) {
      // Broadcast to all online workers
      const onlineWorkers = this.workerManager.getOnlineWorkers();
      for (const worker of onlineWorkers) {
        if (this.workerManager.assignTask(worker.id, taskData)) {
          assignedWorkers.push(worker);
        }
      }
    } else {
      // Assign to specific worker
      if (this.workerManager.assignTask(targetWorker, taskData)) {
        const worker = this.workerManager.getWorker(targetWorker);
        if (worker) {
          assignedWorkers.push(worker);
        }
      }
    }
    
    // Notify admins about task assignment
    this.broadcastToAdmins({
      type: 'TASK_ASSIGNED',
      task: task,
      assignedTo: assignedWorkers.map(w => ({ id: w.id, name: w.name })),
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Task assigned to ${assignedWorkers.length} worker(s)`);
  }

  handleStatusUpdate(ws, payload) {
    const worker = this.workerManager.getWorkerByConnection(ws);
    if (!worker) {
      this.sendError(ws, 'Worker not registered');
      return;
    }
    
    const { status, currentTask } = payload;
    this.workerManager.updateWorkerStatus(worker.id, status, currentTask);
    
    // Notify admins about status change
    this.broadcastToAdmins({
      type: 'WORKER_STATUS_UPDATE',
      workerId: worker.id,
      status: status,
      currentTask: currentTask,
      timestamp: new Date().toISOString()
    });
  }

  handleExecutionLog(ws, payload) {
    const worker = this.workerManager.getWorkerByConnection(ws);
    if (!worker) {
      this.sendError(ws, 'Worker not registered');
      return;
    }
    
    // Forward execution logs to all admins
    this.broadcastToAdmins({
      type: 'EXECUTION_LOG',
      workerId: worker.id,
      workerName: worker.name,
      log: payload.log,
      level: payload.level || 'info',
      timestamp: new Date().toISOString()
    });
  }

  handleCredentialRequest(ws, payload) {
    const worker = this.workerManager.getWorkerByConnection(ws);
    if (!worker) {
      this.sendError(ws, 'Worker not registered');
      return;
    }
    
    const { requestedKeys, requestId } = payload;
    
    console.log(`🔑 Credential request from ${worker.name}: ${requestedKeys ? requestedKeys.join(', ') : 'all credentials'}`);
    
    // Get credentials from credential store
    const credentials = this.credentialStore ? this.credentialStore.getCredentialsForWorker(requestedKeys) : {};
    
    console.log(`🔑 Sending ${Object.keys(credentials).length} credentials to ${worker.name}`);
    
    ws.send(JSON.stringify({
      type: 'CREDENTIAL_RESPONSE',
      credentials: credentials,
      requestId: requestId,
      timestamp: new Date().toISOString()
    }));
  }

  handleTaskComplete(ws, payload) {
    const worker = this.workerManager.getWorkerByConnection(ws);
    if (!worker) {
      this.sendError(ws, 'Worker not registered');
      return;
    }
    
    const { taskId, success, result, error } = payload;
    
    // Update worker status back to online
    this.workerManager.updateWorkerStatus(worker.id, 'online', null);
    
    // Notify admins about task completion
    this.broadcastToAdmins({
      type: 'TASK_COMPLETE',
      workerId: worker.id,
      workerName: worker.name,
      taskId: taskId,
      success: success,
      result: result,
      error: error,
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Task ${taskId} completed by ${worker.name}: ${success ? 'SUCCESS' : 'FAILED'}`);
  }

  handleHeartbeat(ws, payload) {
    const worker = this.workerManager.getWorkerByConnection(ws);
    if (worker) {
      this.workerManager.heartbeat(worker.id);
      
      // Send heartbeat acknowledgment
      ws.send(JSON.stringify({
        type: 'HEARTBEAT_ACK',
        timestamp: new Date().toISOString()
      }));
    }
  }

  handleGetWorkers(ws) {
    // Send current workers list to requesting client
    ws.send(JSON.stringify({
      type: 'WORKERS_LIST',
      workers: this.workerManager.getConnectedWorkers(),
      timestamp: new Date().toISOString()
    }));
  }

  broadcastToAdmins(message) {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;
    
    this.adminConnections.forEach(adminWs => {
      if (adminWs.readyState === adminWs.OPEN) {
        adminWs.send(messageStr);
        sentCount++;
      }
    });
    
    if (sentCount > 0) {
      console.log(`📡 Broadcasted to ${sentCount} admin(s): ${message.type}`);
    }
  }

  broadcastToWorkers(message) {
    const messageStr = JSON.stringify(message);
    const workers = this.workerManager.getOnlineWorkers();
    let sentCount = 0;
    
    workers.forEach(worker => {
      if (worker.connection && worker.connection.readyState === worker.connection.OPEN) {
        worker.connection.send(messageStr);
        sentCount++;
      }
    });
    
    if (sentCount > 0) {
      console.log(`📡 Broadcasted to ${sentCount} worker(s): ${message.type}`);
    }
  }

  sendError(ws, errorMessage) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: errorMessage,
      timestamp: new Date().toISOString()
    }));
  }
}

module.exports = MessageRouter; 