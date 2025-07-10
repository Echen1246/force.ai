const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

class WorkerManager {
  constructor() {
    this.workers = new Map(); // workerId -> worker info
    this.connections = new Map(); // WebSocket -> workerId
    this.dataFile = path.join(__dirname, '../data/workers.json');
    this.loadWorkers();
    
    // Auto-cleanup inactive workers every hour
    this.setupAutoCleanup();
  }

  setupAutoCleanup() {
    // Clean up workers that haven't been seen for over 24 hours
    const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
    const INACTIVE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
    
    setInterval(() => {
      this.cleanupInactiveWorkers(INACTIVE_THRESHOLD);
    }, CLEANUP_INTERVAL);
    
    console.log('🧹 Auto-cleanup enabled: removing workers inactive for >24 hours');
  }

  cleanupInactiveWorkers(thresholdMs) {
    const now = Date.now();
    let cleanupCount = 0;
    
    for (const [workerId, worker] of this.workers.entries()) {
      if (worker.status === 'offline' && worker.lastSeen) {
        const lastSeenTime = new Date(worker.lastSeen).getTime();
        const timeSinceLastSeen = now - lastSeenTime;
        
        if (timeSinceLastSeen > thresholdMs) {
          console.log(`🧹 Cleaning up inactive worker: ${worker.name} (last seen ${Math.round(timeSinceLastSeen / (60 * 60 * 1000))} hours ago)`);
          this.workers.delete(workerId);
          cleanupCount++;
        }
      }
    }
    
    if (cleanupCount > 0) {
      this.saveWorkers();
      console.log(`🧹 Cleaned up ${cleanupCount} inactive workers`);
    }
  }

  loadWorkers() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = fs.readFileSync(this.dataFile, 'utf8');
        const savedWorkers = JSON.parse(data);
        // Reset all workers to offline status on startup
        for (const [id, worker] of Object.entries(savedWorkers)) {
          this.workers.set(id, {
            ...worker,
            status: 'offline',
            connection: null,
            lastSeen: null
          });
        }
      }
    } catch (error) {
      console.error('❌ Error loading workers:', error);
    }
  }

  saveWorkers() {
    try {
      const workersToSave = {};
      for (const [id, worker] of this.workers.entries()) {
        // Don't save the WebSocket connection object
        workersToSave[id] = {
          id: worker.id,
          name: worker.name,
          capabilities: worker.capabilities,
          registeredAt: worker.registeredAt,
          status: worker.status,
          lastSeen: worker.lastSeen
        };
      }
      fs.writeFileSync(this.dataFile, JSON.stringify(workersToSave, null, 2));
    } catch (error) {
      console.error('❌ Error saving workers:', error);
    }
  }

  registerWorker(ws, token, workerInfo) {
    const workerId = uuidv4();
    const worker = {
      id: workerId,
      name: workerInfo.name || `Worker-${workerId.slice(0, 8)}`,
      capabilities: workerInfo.capabilities || [],
      connection: ws,
      status: 'online',
      registeredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      currentTask: null
    };

    this.workers.set(workerId, worker);
    this.connections.set(ws, workerId);
    
    console.log(`✅ Worker registered: ${worker.name} (${workerId})`);
    this.saveWorkers();
    
    return worker;
  }

  removeWorker(ws) {
    const workerId = this.connections.get(ws);
    if (workerId) {
      const worker = this.workers.get(workerId);
      if (worker) {
        worker.status = 'offline';
        worker.connection = null;
        worker.currentTask = null;
        console.log(`👋 Worker disconnected: ${worker.name} (${workerId})`);
        this.saveWorkers();
      }
      this.connections.delete(ws);
    }
  }

  getWorkerByConnection(ws) {
    const workerId = this.connections.get(ws);
    return workerId ? this.workers.get(workerId) : null;
  }

  getWorkerById(workerId) {
    return this.workers.get(workerId);
  }

  getConnectedWorkers() {
    const workers = [];
    for (const [id, worker] of this.workers.entries()) {
      // Only return workers that are either online or have been seen recently (within 24 hours)
      const isRecentlyActive = worker.lastSeen && 
        (Date.now() - new Date(worker.lastSeen).getTime()) < (24 * 60 * 60 * 1000);
      
      if (worker.status === 'online' || isRecentlyActive) {
        workers.push({
          id: worker.id,
          name: worker.name,
          status: worker.status,
          capabilities: worker.capabilities,
          registeredAt: worker.registeredAt,
          lastSeen: worker.lastSeen,
          currentTask: worker.currentTask
        });
      }
    }
    return workers;
  }

  getOnlineWorkers() {
    return Array.from(this.workers.values()).filter(worker => worker.status === 'online');
  }

  getWorker(workerId) {
    return this.workers.get(workerId);
  }

  updateWorkerStatus(workerId, status, currentTask = null) {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = status;
      worker.lastSeen = new Date().toISOString();
      if (currentTask !== null) {
        worker.currentTask = currentTask;
      }
      this.saveWorkers();
      return true;
    }
    return false;
  }

  assignTask(workerId, task) {
    const worker = this.workers.get(workerId);
    if (worker && worker.status === 'online') {
      worker.currentTask = task;
      worker.status = 'busy';
      this.saveWorkers();
      
      if (worker.connection) {
        worker.connection.send(JSON.stringify({
          type: 'TASK_ASSIGNMENT',
          taskId: task.id,
          task: task.task, // Changed from task.description to task.task
          credentials: task.credentials || {}
        }));
        return true;
      }
    }
    return false;
  }

  broadcastTask(task) {
    const onlineWorkers = this.getOnlineWorkers();
    const results = [];
    
    for (const worker of onlineWorkers) {
      if (this.assignTask(worker.id, task)) {
        results.push(worker.id);
      }
    }
    
    return results;
  }

  heartbeat(workerId) {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.lastSeen = new Date().toISOString();
      this.saveWorkers();
    }
  }
}

module.exports = WorkerManager; 