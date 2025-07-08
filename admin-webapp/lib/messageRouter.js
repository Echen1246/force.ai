const { v4: uuidv4 } = require('uuid');

class MessageRouter {
  constructor(wss, workerManager) {
    this.wss = wss;
    this.workerManager = workerManager;
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
    const { workerId, task, targetAll } = payload;
    
    try {
      const taskObj = {
        id: uuidv4(),
        description: task,
        assignedAt: new Date().toISOString(),
        credentials: payload.credentials || {}
      };
      
      let results = [];
      
      if (targetAll) {
        // Broadcast to all workers
        results = this.workerManager.broadcastTask(taskObj);
        console.log(`📤 Task broadcasted to ${results.length} workers`);
      } else if (workerId) {
        // Send to specific worker
        const success = this.workerManager.assignTask(workerId, taskObj);
        if (success) {
          results = [workerId];
          console.log(`📤 Task assigned to worker: ${workerId}`);
        }
      }
      
      // Notify admins about task assignment
      this.broadcastToAdmins({
        type: 'TASK_ASSIGNED',
        taskId: taskObj.id,
        task: taskObj.description,
        assignedTo: results,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Task assignment failed:', error);
      this.broadcastToAdmins({
        type: 'TASK_ASSIGNMENT_FAILED',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
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
    
    // In a real implementation, you'd get credentials from the credential store
    // For now, send back requested credentials
    const { requestedKeys } = payload;
    
    ws.send(JSON.stringify({
      type: 'CREDENTIAL_RESPONSE',
      credentials: {}, // Would be populated from credential store
      requestId: payload.requestId,
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