class AdminPanel {
    constructor() {
        this.ws = null;
        this.workers = new Map();
        this.credentials = new Map();
        this.autoScroll = true;
        this.currentTheme = 'dark';
        this.currentLogTab = 'all-logs';
        this.currentControlTab = 'tasks';
        this.logCounts = { all: 0, tasks: 0, system: 0 };
        
        this.initializeElements();
        this.bindEvents();
        this.loadCredentials();
        this.connect();
        this.loadTheme();
        this.updateStats();
    }

    initializeElements() {
        // Connection elements
        this.connectionStatus = document.getElementById('connection-status');
        this.connectionText = document.getElementById('connection-text');
        this.currentToken = document.getElementById('current-token');
        this.tokenExpiry = document.getElementById('token-expiry');
        
        // Theme toggle
        this.themeToggle = document.getElementById('theme-toggle');
        this.themeIcon = document.querySelector('.theme-icon');
        
        // Task elements
        this.taskInput = document.getElementById('task-input');
        this.workerSelect = document.getElementById('worker-select');
        this.sendTaskBtn = document.getElementById('send-task-btn');
        
        // Worker elements
        this.workerCount = document.getElementById('worker-count');
        this.workerCountBadge = document.getElementById('worker-count-badge');
        this.busyCount = document.getElementById('busy-count');
        this.idleCount = document.getElementById('idle-count');
        this.workersGrid = document.getElementById('workers-grid');
        
        // Credential elements
        this.credKeyInput = document.getElementById('cred-key');
        this.credValueInput = document.getElementById('cred-value');
        this.addCredBtn = document.getElementById('add-cred-btn');
        this.credentialsList = document.getElementById('credentials-list');
        
        // Log elements
        this.logsContainer = document.getElementById('logs-container');
        this.tasksContainer = document.getElementById('tasks-container');
        this.systemContainer = document.getElementById('system-container');
        this.clearLogsBtn = document.getElementById('clear-logs-btn');
        this.autoScrollCheckbox = document.getElementById('auto-scroll');
        
        // Log count badges
        this.allLogsCount = document.getElementById('all-logs-count');
        this.tasksLogsCount = document.getElementById('tasks-count');
        this.systemLogsCount = document.getElementById('system-count');
        
        // Templates
        this.workerCardTemplate = document.getElementById('worker-card-template');
        this.credentialItemTemplate = document.getElementById('credential-item-template');
        this.logEntryTemplate = document.getElementById('log-entry-template');

        this.validateTaskInput();
    }

    bindEvents() {
        // Theme toggle
        this.themeToggle.addEventListener('click', () => this.toggleTheme());
        
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
        
        // Tab functionality
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-btn')) {
                this.switchTab(e.target);
            }
        });
        
        // Input validation
        this.taskInput.addEventListener('input', () => this.validateTaskInput());
    }

    loadTheme() {
        const savedTheme = localStorage.getItem('admin-theme') || 'dark';
        this.setTheme(savedTheme);
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
    }

    setTheme(theme) {
        this.currentTheme = theme;
        document.body.className = `theme-${theme}`;
        this.themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
        localStorage.setItem('admin-theme', theme);
    }

    switchTab(tabBtn) {
        const tabContainer = tabBtn.closest('.tabs-nav').parentElement;
        const tabId = tabBtn.dataset.tab;
        
        // Check if this is a control tab or monitoring tab
        const isControlTab = tabContainer.closest('.control-tabs');
        
        // Update tab buttons
        tabContainer.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        tabBtn.classList.add('active');
        
        // Update tab content
        const parentContainer = isControlTab ? 
            tabContainer.querySelector('.tabs-content') : 
            tabContainer.querySelector('.tabs-content');
            
        parentContainer.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        
        const targetPane = document.getElementById(`tab-${tabId}`);
        if (targetPane) {
            targetPane.classList.add('active');
            
            if (isControlTab) {
                this.currentControlTab = tabId;
            } else {
                this.currentLogTab = tabId;
            }
        }
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
                this.log('system', 'success', 'Admin dashboard connected');
                break;
                
            case 'WORKERS_LIST':
                this.updateWorkers(payload.workers);
                break;
                
            case 'WORKER_CONNECTED':
                this.addWorker(payload.worker);
                this.log('system', 'info', `Worker connected: ${payload.worker.name} (${payload.worker.id})`);
                break;
                
            case 'WORKER_DISCONNECTED':
                this.removeWorker(payload.workerId);
                this.log('system', 'warning', `Worker disconnected: ${payload.workerId}`);
                break;
                
            case 'WORKER_STATUS_UPDATE':
                this.updateWorkerStatus(payload.workerId, payload.status, payload.currentTask);
                break;
                
            case 'TASK_ASSIGNED':
                this.log('tasks', 'info', `Task assigned to ${payload.workerName}: ${payload.task}`);
                break;
                
            case 'TASK_COMPLETED':
                const status = payload.success ? 'success' : 'error';
                const result = payload.success ? 'completed successfully' : `failed: ${payload.error}`;
                this.log('tasks', status, `Task ${result} (${payload.workerName})`);
                break;
                
            case 'EXECUTION_LOG':
                this.log('tasks', payload.level || 'info', `[${payload.workerName}] ${payload.message}`);
                break;
                
            default:
                this.log('system', 'warning', `Unknown message type: ${type}`);
        }
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    updateConnectionStatus(connected) {
        this.connectionStatus.className = `status-dot ${connected ? 'online' : 'offline'}`;
        this.connectionText.textContent = connected ? 'Connected' : 'Disconnected';
    }

    updateToken(token, expiresAt) {
        this.currentToken.textContent = token;
        const expiryDate = new Date(expiresAt);
        this.tokenExpiry.textContent = `Expires: ${expiryDate.toLocaleTimeString()}`;
    }

    updateWorkers(workers) {
        this.workers.clear();
        workers.forEach(worker => {
            this.workers.set(worker.id, worker);
        });
        this.renderWorkers();
        this.updateWorkerSelect();
        this.updateStats();
    }

    addWorker(worker) {
        this.workers.set(worker.id, worker);
        this.renderWorkers();
        this.updateWorkerSelect();
        this.updateStats();
    }

    removeWorker(workerId) {
        this.workers.delete(workerId);
        this.renderWorkers();
        this.updateWorkerSelect();
        this.updateStats();
    }

    updateWorkerStatus(workerId, status, currentTask) {
        const worker = this.workers.get(workerId);
        if (worker) {
            worker.status = status;
            worker.currentTask = currentTask;
            worker.lastSeen = Date.now();
            this.renderWorkers();
            this.updateStats();
        }
    }

    updateStats() {
        const totalWorkers = this.workers.size;
        const busyWorkers = Array.from(this.workers.values()).filter(w => w.status === 'busy').length;
        const idleWorkers = totalWorkers - busyWorkers;

        // Update worker counts
        if (this.workerCount) this.workerCount.textContent = totalWorkers;
        if (this.workerCountBadge) this.workerCountBadge.textContent = totalWorkers;
        if (this.busyCount) this.busyCount.textContent = busyWorkers;
        if (this.idleCount) this.idleCount.textContent = idleWorkers;
    }

    renderWorkers() {
        if (!this.workersGrid) return;

        if (this.workers.size === 0) {
            this.workersGrid.innerHTML = `
                <div class="no-workers">
                    <div class="no-workers-icon">👥</div>
                    <div class="no-workers-text">No workers connected</div>
                    <div class="no-workers-hint">Workers will appear here when they connect using the token above</div>
                </div>
            `;
            return;
        }

        this.workersGrid.innerHTML = '';
        
        this.workers.forEach(worker => {
            const workerCard = this.workerCardTemplate.content.cloneNode(true);
            
            // Basic info
            workerCard.querySelector('.worker-name').textContent = worker.name;
            workerCard.querySelector('.worker-id').textContent = worker.id;
            
            // Status
            const statusBadge = workerCard.querySelector('.worker-status-badge');
            const statusText = workerCard.querySelector('.worker-status-text');
            statusBadge.className = `worker-status-badge ${worker.status}`;
            statusText.textContent = worker.status.charAt(0).toUpperCase() + worker.status.slice(1);
            
            // Task info
            const taskValue = workerCard.querySelector('.task-value');
            taskValue.textContent = worker.currentTask || 'Idle';
            
            // Last seen
            const seenValue = workerCard.querySelector('.seen-value');
            const lastSeen = worker.lastSeen ? new Date(worker.lastSeen) : new Date();
            const timeDiff = Date.now() - lastSeen.getTime();
            const seconds = Math.floor(timeDiff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            
            let timeAgo;
            if (hours > 0) {
                timeAgo = `${hours}h ago`;
            } else if (minutes > 0) {
                timeAgo = `${minutes}m ago`;
            } else {
                timeAgo = 'Just now';
            }
            seenValue.textContent = timeAgo;
            
            this.workersGrid.appendChild(workerCard);
        });
    }

    updateWorkerSelect() {
        if (!this.workerSelect) return;

        // Clear existing options except "All Workers"
        this.workerSelect.innerHTML = '<option value="all">🌐 All Workers</option>';
        
        // Add worker options
        this.workers.forEach(worker => {
            const option = document.createElement('option');
            option.value = worker.id;
            option.textContent = `${worker.name} (${worker.status})`;
            this.workerSelect.appendChild(option);
        });
    }

    validateTaskInput() {
        if (!this.taskInput || !this.sendTaskBtn) return;

        const hasTask = this.taskInput.value.trim().length > 0;
        const hasWorkers = this.workers.size > 0;
        
        this.sendTaskBtn.disabled = !hasTask || !hasWorkers;
    }

    sendTask() {
        if (!this.validateTaskInput()) return;

        const task = this.taskInput.value.trim();
        const targetWorker = this.workerSelect.value;

        if (!task) {
            alert('Please enter a task description');
            return;
        }

        this.send({
            type: 'ASSIGN_TASK',
            task: task,
            targetWorker: targetWorker === 'all' ? null : targetWorker,
            credentials: Object.fromEntries(this.credentials)
        });

        this.log('tasks', 'info', `Task assigned: "${task}" to ${targetWorker === 'all' ? 'all workers' : targetWorker}`);
        this.taskInput.value = '';
        this.validateTaskInput();
    }

    async loadCredentials() {
        try {
            const response = await fetch('/api/credentials');
            const credentials = await response.json();
            
            this.credentials.clear();
            credentials.forEach(cred => {
                this.credentials.set(cred.key, cred.value);
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
            alert('Please enter both key and value');
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
                this.credentials.set(key, value);
                this.renderCredentials();
                this.credKeyInput.value = '';
                this.credValueInput.value = '';
                this.log('system', 'success', `Credential added: ${key}`);
            } else {
                throw new Error('Failed to add credential');
            }
        } catch (error) {
            this.log('system', 'error', 'Failed to add credential: ' + error.message);
            alert('Failed to add credential');
        }
    }

    async deleteCredential(key) {
        if (!confirm(`Delete credential "${key}"?`)) return;

        try {
            const response = await fetch(`/api/credentials/${encodeURIComponent(key)}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.credentials.delete(key);
                this.renderCredentials();
                this.log('system', 'info', `Credential deleted: ${key}`);
            } else {
                throw new Error('Failed to delete credential');
            }
        } catch (error) {
            this.log('system', 'error', 'Failed to delete credential: ' + error.message);
            alert('Failed to delete credential');
        }
    }

    renderCredentials() {
        if (!this.credentialsList) return;

        if (this.credentials.size === 0) {
            this.credentialsList.innerHTML = `
                <div class="no-credentials">
                    <div class="no-credentials-icon">🔐</div>
                    <div class="no-credentials-text">No credentials stored</div>
                    <div class="no-credentials-hint">Add credentials that workers can use for authentication</div>
                </div>
            `;
            return;
        }

        this.credentialsList.innerHTML = '';
        
        this.credentials.forEach((value, key) => {
            const credentialItem = this.credentialItemTemplate.content.cloneNode(true);
            
            credentialItem.querySelector('.credential-key').textContent = key;
            credentialItem.querySelector('.credential-value').textContent = '••••••••';
            
            const deleteBtn = credentialItem.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', () => this.deleteCredential(key));
            
            this.credentialsList.appendChild(credentialItem);
        });
    }

    log(source, level, message) {
        const timestamp = new Date().toLocaleTimeString();
        
        // Update log counts
        this.logCounts.all++;
        if (source === 'tasks') this.logCounts.tasks++;
        if (source === 'system') this.logCounts.system++;
        
        // Update count badges
        if (this.allLogsCount) this.allLogsCount.textContent = this.logCounts.all;
        if (this.tasksLogsCount) this.tasksLogsCount.textContent = this.logCounts.tasks;
        if (this.systemLogsCount) this.systemLogsCount.textContent = this.logCounts.system;

        const logEntry = this.logEntryTemplate.content.cloneNode(true);
        
        logEntry.querySelector('.log-timestamp').textContent = timestamp;
        logEntry.querySelector('.log-source').textContent = source.toUpperCase();
        logEntry.querySelector('.log-level').textContent = level;
        logEntry.querySelector('.log-level').className = `log-level ${level}`;
        logEntry.querySelector('.log-message').textContent = message;

        // Add to appropriate containers
        if (this.logsContainer) {
            this.logsContainer.appendChild(logEntry.cloneNode(true));
        }

        if (source === 'tasks' && this.tasksContainer) {
            this.tasksContainer.appendChild(logEntry.cloneNode(true));
        }

        if (source === 'system' && this.systemContainer) {
            this.systemContainer.appendChild(logEntry.cloneNode(true));
        }

        // Auto-scroll if enabled
        if (this.autoScroll) {
            const activeContainer = this.getActiveLogContainer();
            if (activeContainer) {
                activeContainer.scrollTop = activeContainer.scrollHeight;
            }
        }
    }

    getActiveLogContainer() {
        switch (this.currentLogTab) {
            case 'all-logs': return this.logsContainer;
            case 'tasks': return this.tasksContainer;
            case 'system': return this.systemContainer;
            default: return this.logsContainer;
        }
    }

    clearLogs() {
        if (this.logsContainer) this.logsContainer.innerHTML = '';
        if (this.tasksContainer) this.tasksContainer.innerHTML = '';
        if (this.systemContainer) this.systemContainer.innerHTML = '';
        
        // Reset counts
        this.logCounts = { all: 0, tasks: 0, system: 0 };
        if (this.allLogsCount) this.allLogsCount.textContent = '0';
        if (this.tasksLogsCount) this.tasksLogsCount.textContent = '0';
        if (this.systemLogsCount) this.systemLogsCount.textContent = '0';
        
        this.log('system', 'info', 'Logs cleared');
    }
}

// Initialize the admin panel when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AdminPanel();
}); 