const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

class WorkerManager {
  constructor() {
    this.workers = new Map(); // workerId -> worker info
    this.connections = new Map(); // WebSocket -> workerId
    this.dataFile = path.join(__dirname, '../data/workers.json');
    this.loadWorkers();
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
    return workers;
  }

  getOnlineWorkers() {
    return Array.from(this.workers.values()).filter(worker => worker.status === 'online');
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
          task: task.description,
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