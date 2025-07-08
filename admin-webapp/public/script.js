class AdminPanel {
    constructor() {
        this.ws = null;
        this.workers = new Map();
        this.credentials = new Map();
        this.autoScroll = true;
        
        this.initializeElements();
        this.bindEvents();
        this.connect();
        this.loadCredentials();
    }

    initializeElements() {
        // Connection elements
        this.connectionIndicator = document.getElementById('connection-indicator');
        this.currentTokenEl = document.getElementById('current-token');
        this.tokenExpiryEl = document.getElementById('token-expiry');
        
        // Workers elements
        this.workersGrid = document.getElementById('workers-list');
        this.workerSelect = document.getElementById('worker-select');
        
        // Task elements
        this.taskInput = document.getElementById('task-input');
        this.sendTaskBtn = document.getElementById('send-task-btn');
        
        // Credentials elements
        this.credKeyInput = document.getElementById('cred-key');
        this.credValueInput = document.getElementById('cred-value');
        this.addCredBtn = document.getElementById('add-cred-btn');
        this.credentialsList = document.getElementById('credentials-list');
        
        // Logs elements
        this.logsContainer = document.getElementById('logs-container');
        this.clearLogsBtn = document.getElementById('clear-logs-btn');
        this.autoScrollCheckbox = document.getElementById('auto-scroll');
        
        // Templates
        this.workerCardTemplate = document.getElementById('worker-card-template');
        this.credentialItemTemplate = document.getElementById('credential-item-template');
        this.logEntryTemplate = document.getElementById('log-entry-template');
    }

    bindEvents() {
        // Task assignment
        this.sendTaskBtn.addEventListener('click', () => this.sendTask());
        this.taskInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.sendTask();
            }
        });
        
        // Credentials
        this.addCredBtn.addEventListener('click', () => this.addCredential());
        this.credKeyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.addCredential();
        });
        this.credValueInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.addCredential();
        });
        
        // Logs
        this.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        this.autoScrollCheckbox.addEventListener('change', (e) => {
            this.autoScroll = e.target.checked;
        });
        
        // Input validation
        this.taskInput.addEventListener('input', () => this.validateTaskInput());
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.log('system', 'info', `Connecting to ${wsUrl}...`);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                this.log('system', 'success', 'Connected to admin server');
                this.updateConnectionStatus(true);
                
                // Identify as admin
                this.send({
                    type: 'ADMIN_CONNECT'
                });
                
                // Request current workers list
                this.send({
                    type: 'GET_WORKERS'
                });
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    this.log('system', 'error', 'Failed to parse message: ' + error.message);
                }
            };
            
            this.ws.onclose = () => {
                this.log('system', 'warning', 'Connection closed. Attempting to reconnect...');
                this.updateConnectionStatus(false);
                
                // Reconnect after 3 seconds
                setTimeout(() => this.connect(), 3000);
            };
            
            this.ws.onerror = (error) => {
                this.log('system', 'error', 'WebSocket error: ' + error.message);
            };
            
        } catch (error) {
            this.log('system', 'error', 'Failed to create WebSocket: ' + error.message);
            setTimeout(() => this.connect(), 5000);
        }
    }

    handleMessage(message) {
        const { type, ...payload } = message;
        
        switch (type) {
            case 'CONNECTION_ESTABLISHED':
                this.updateToken(payload.currentToken, payload.tokenExpiresAt);
                break;
                
            case 'TOKEN_UPDATE':
                this.updateToken(payload.token, payload.expiresAt);
                break;
                
            case 'ADMIN_CONNECTED':
                this.updateWorkers(payload.workers);
                break;
                
            case 'WORKERS_LIST':
                this.updateWorkers(payload.workers);
                break;
                
            case 'WORKER_REGISTERED':
                this.addWorker(payload.worker);
                this.log('system', 'success', `Worker registered: ${payload.worker.name}`);
                break;
                
            case 'WORKER_STATUS_UPDATE':
                this.updateWorkerStatus(payload.workerId, payload.status, payload.currentTask);
                break;
                
            case 'TASK_ASSIGNED':
                this.log('tasks', 'info', `Task assigned: "${payload.task}" to ${payload.assignedTo.length} worker(s)`);
                break;
                
            case 'TASK_COMPLETE':
                const status = payload.success ? 'success' : 'error';
                const result = payload.success ? payload.result : payload.error;
                this.log('tasks', status, `Task completed by ${payload.workerName}: ${result}`);
                break;
                
            case 'EXECUTION_LOG':
                this.log(`worker-${payload.workerName}`, payload.level, payload.log);
                break;
                
            case 'ERROR':
                this.log('system', 'error', payload.message);
                break;
                
            default:
                this.log('system', 'warning', `Unknown message type: ${type}`);
        }
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            this.log('system', 'error', 'Cannot send message: not connected');
        }
    }

    updateConnectionStatus(connected) {
        this.connectionIndicator.textContent = connected ? 'Connected' : 'Disconnected';
        this.connectionIndicator.className = connected ? 'status-online' : 'status-offline';
        this.sendTaskBtn.disabled = !connected;
    }

    updateToken(token, expiresAt) {
        this.currentTokenEl.textContent = token;
        
        if (expiresAt) {
            const expiryDate = new Date(expiresAt);
            const now = new Date();
            const minutesLeft = Math.max(0, Math.floor((expiryDate - now) / 60000));
            this.tokenExpiryEl.textContent = `(Expires in ${minutesLeft} minutes)`;
        }
    }

    updateWorkers(workers) {
        this.workers.clear();
        
        workers.forEach(worker => {
            this.workers.set(worker.id, worker);
        });
        
        this.renderWorkers();
        this.updateWorkerSelect();
    }

    addWorker(worker) {
        this.workers.set(worker.id, worker);
        this.renderWorkers();
        this.updateWorkerSelect();
    }

    updateWorkerStatus(workerId, status, currentTask) {
        const worker = this.workers.get(workerId);
        if (worker) {
            worker.status = status;
            worker.currentTask = currentTask;
            this.renderWorkers();
        }
    }

    renderWorkers() {
        if (this.workers.size === 0) {
            this.workersGrid.innerHTML = '<div class="no-workers">No workers connected</div>';
            return;
        }
        
        this.workersGrid.innerHTML = '';
        
        this.workers.forEach(worker => {
            const card = this.workerCardTemplate.content.cloneNode(true);
            
            card.querySelector('.worker-name').textContent = worker.name;
            card.querySelector('.worker-status').textContent = worker.status;
            card.querySelector('.worker-status').className = `worker-status status-${worker.status}`;
            card.querySelector('.worker-id').textContent = `ID: ${worker.id.slice(0, 8)}`;
            card.querySelector('.worker-task').textContent = worker.currentTask ? 
                `Task: ${worker.currentTask.description || 'Running task...'}` : 'No active task';
            card.querySelector('.worker-last-seen').textContent = worker.lastSeen ? 
                `Last seen: ${new Date(worker.lastSeen).toLocaleTimeString()}` : '';
            
            this.workersGrid.appendChild(card);
        });
    }

    updateWorkerSelect() {
        // Keep "All Workers" option and add individual workers
        this.workerSelect.innerHTML = '<option value="all">All Workers</option>';
        
        this.workers.forEach(worker => {
            if (worker.status === 'online') {
                const option = document.createElement('option');
                option.value = worker.id;
                option.textContent = worker.name;
                this.workerSelect.appendChild(option);
            }
        });
    }

    validateTaskInput() {
        const hasTask = this.taskInput.value.trim().length > 0;
        const hasConnection = this.ws && this.ws.readyState === WebSocket.OPEN;
        this.sendTaskBtn.disabled = !hasTask || !hasConnection;
    }

    sendTask() {
        const task = this.taskInput.value.trim();
        const selectedWorker = this.workerSelect.value;
        
        if (!task) {
            this.log('system', 'error', 'Task description is required');
            return;
        }
        
        const message = {
            type: 'TASK_ASSIGNMENT',
            task: task,
            targetAll: selectedWorker === 'all',
            workerId: selectedWorker !== 'all' ? selectedWorker : null
        };
        
        this.send(message);
        this.taskInput.value = '';
        this.validateTaskInput();
        
        this.log('system', 'info', `Task sent: "${task}" to ${selectedWorker === 'all' ? 'all workers' : 'selected worker'}`);
    }

    async loadCredentials() {
        try {
            const response = await fetch('/api/credentials');
            const credentials = await response.json();
            
            this.credentials.clear();
            Object.entries(credentials).forEach(([key, value]) => {
                this.credentials.set(key, value);
            });
            
            this.renderCredentials();
        } catch (error) {
            this.log('system', 'error', 'Failed to load credentials: ' + error.message);
        }
    }

    async addCredential() {
        const key = this.credKeyInput.value.trim();
        const value = this.credValueInput.value.trim();
        
        if (!key || !value) {
            this.log('system', 'error', 'Both credential key and value are required');
            return;
        }
        
        try {
            const response = await fetch('/api/credentials', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ key, value })
            });
            
            if (response.ok) {
                this.credentials.set(key.toLowerCase().replace(/\s+/g, '_'), value);
                this.renderCredentials();
                this.credKeyInput.value = '';
                this.credValueInput.value = '';
                this.log('system', 'success', `Credential added: ${key}`);
            } else {
                throw new Error('Failed to save credential');
            }
        } catch (error) {
            this.log('system', 'error', 'Failed to add credential: ' + error.message);
        }
    }

    async deleteCredential(key) {
        try {
            const response = await fetch(`/api/credentials/${encodeURIComponent(key)}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.credentials.delete(key);
                this.renderCredentials();
                this.log('system', 'success', `Credential deleted: ${key}`);
            } else {
                throw new Error('Failed to delete credential');
            }
        } catch (error) {
            this.log('system', 'error', 'Failed to delete credential: ' + error.message);
        }
    }

    renderCredentials() {
        this.credentialsList.innerHTML = '';
        
        if (this.credentials.size === 0) {
            this.credentialsList.innerHTML = '<div style="text-align: center; color: #64748b; padding: 20px;">No credentials stored</div>';
            return;
        }
        
        this.credentials.forEach((value, key) => {
            const item = this.credentialItemTemplate.content.cloneNode(true);
            
            item.querySelector('.credential-key').textContent = key;
            
            // Mask passwords for display
            const displayValue = key.includes('password') ? '*'.repeat(value.length) : value;
            item.querySelector('.credential-value').textContent = displayValue;
            
            const deleteBtn = item.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', () => this.deleteCredential(key));
            
            this.credentialsList.appendChild(item);
        });
    }

    log(source, level, message) {
        const entry = this.logEntryTemplate.content.cloneNode(true);
        
        entry.querySelector('.log-timestamp').textContent = new Date().toLocaleTimeString();
        entry.querySelector('.log-source').textContent = source;
        entry.querySelector('.log-level').textContent = level;
        entry.querySelector('.log-level').className = `log-level ${level}`;
        entry.querySelector('.log-message').textContent = message;
        
        this.logsContainer.appendChild(entry);
        
        // Auto-scroll to bottom if enabled
        if (this.autoScroll) {
            this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
        }
        
        // Limit log entries to prevent memory issues
        while (this.logsContainer.children.length > 500) {
            this.logsContainer.removeChild(this.logsContainer.firstChild);
        }
    }

    clearLogs() {
        this.logsContainer.innerHTML = '';
        this.log('system', 'info', 'Logs cleared');
    }
}

// Initialize the admin panel when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AdminPanel();
}); 