class WorkerRenderer {
  constructor() {
    this.isConnected = false;
    this.isRegistered = false;
    this.currentTask = null;
    this.workerConfig = {
      adminUrl: 'ws://localhost:3000',
      workerName: '',
      adminToken: ''
    };
    
    this.initializeElements();
    this.bindEvents();
    this.setupEventListeners();
    this.loadSavedSettings();
    this.updateStatus();
  }

  initializeElements() {
    // Status elements
    this.connectionDot = document.getElementById('connection-dot');
    this.connectionStatus = document.getElementById('connection-status');
    this.connectBtn = document.getElementById('connect-btn');
    this.workerName = document.getElementById('worker-name');
    this.workerIdDisplay = document.getElementById('worker-id-display');
    
    // Task elements
    this.taskRow = document.getElementById('task-row');
    this.currentTaskEl = document.getElementById('current-task');
    this.taskProgress = document.getElementById('task-progress');
    
    // Settings elements
    this.settingsPanel = document.getElementById('settings-panel');
    this.settingsToggle = document.getElementById('settings-toggle');
    this.adminUrlInput = document.getElementById('admin-url');
    this.workerNameInput = document.getElementById('worker-name-input');
    this.adminTokenInput = document.getElementById('admin-token');
    this.saveSettingsBtn = document.getElementById('save-settings-btn');
    this.cancelSettingsBtn = document.getElementById('cancel-settings-btn');
    
    // Window controls
    this.minimizeBtn = document.getElementById('minimize-btn');
    this.closeBtn = document.getElementById('close-btn');
    
    // Status message
    this.statusMessage = document.getElementById('status-message');
  }

  bindEvents() {
    // Connection
    this.connectBtn.addEventListener('click', () => this.toggleConnection());
    
    // Settings
    this.settingsToggle.addEventListener('click', () => this.toggleSettings());
    this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
    this.cancelSettingsBtn.addEventListener('click', () => this.cancelSettings());
    
    // Window controls
    this.minimizeBtn.addEventListener('click', () => this.minimizeWindow());
    this.closeBtn.addEventListener('click', () => this.closeWindow());
    
    // Enter key to save settings
    [this.adminUrlInput, this.workerNameInput, this.adminTokenInput].forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.saveSettings();
        }
      });
    });
  }

  setupEventListeners() {
    // Listen for events from main process
    window.electronAPI.on('admin-connected', () => {
      this.isConnected = true;
      this.updateStatus();
      this.showMessage('Connected to admin server', 'success');
    });

    window.electronAPI.on('admin-disconnected', () => {
      this.isConnected = false;
      this.isRegistered = false;
      this.currentTask = null;
      this.updateStatus();
      this.showMessage('Disconnected from admin server', 'error');
    });

    window.electronAPI.on('worker-registered', (workerInfo) => {
      this.isRegistered = true;
      this.workerName.textContent = workerInfo.workerName;
      this.workerIdDisplay.textContent = `ID: ${workerInfo.workerId.slice(0, 8)}`;
      this.updateStatus();
      this.showMessage(`Worker registered: ${workerInfo.workerName}`, 'success');
    });

    window.electronAPI.on('task-assigned', (task) => {
      this.currentTask = task;
      this.currentTaskEl.textContent = task.task;
      this.taskRow.style.display = 'block';
      this.updateStatus();
      this.showMessage(`New task: ${task.task.slice(0, 30)}...`, 'info');
    });

    window.electronAPI.on('task-completed', (result) => {
      this.currentTask = null;
      this.taskRow.style.display = 'none';
      this.updateStatus();
      
      if (result.success) {
        this.showMessage('Task completed successfully', 'success');
      } else {
        this.showMessage(`Task failed: ${result.error}`, 'error');
      }
    });

    window.electronAPI.on('browser-use-log', (log) => {
      // Could show logs in a tooltip or mini console
      console.log('Browser Use:', log);
    });

    window.electronAPI.on('status-update', (status) => {
      this.isConnected = status.connected;
      this.isRegistered = status.registered;
      this.currentTask = status.currentTask;
      this.updateStatus();
    });

    window.electronAPI.on('connection-error', (error) => {
      this.showMessage(`Connection error: ${error}`, 'error');
    });
  }

  async toggleConnection() {
    if (this.isConnected) {
      await this.disconnect();
    } else {
      await this.connect();
    }
  }

  async connect() {
    if (!this.workerConfig.adminToken) {
      this.showMessage('Please enter admin token in settings', 'error');
      this.showSettings();
      return;
    }

    try {
      this.connectBtn.disabled = true;
      this.connectBtn.textContent = 'Connecting...';
      
      const result = await window.electronAPI.connectToAdmin(this.workerConfig);
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
    } catch (error) {
      this.showMessage(`Connection failed: ${error.message}`, 'error');
    } finally {
      this.connectBtn.disabled = false;
      this.updateConnectionButton();
    }
  }

  async disconnect() {
    try {
      await window.electronAPI.disconnectFromAdmin();
      this.isConnected = false;
      this.isRegistered = false;
      this.currentTask = null;
      this.taskRow.style.display = 'none';
      this.updateStatus();
    } catch (error) {
      this.showMessage(`Disconnect failed: ${error.message}`, 'error');
    }
  }

  updateStatus() {
    // Update connection status
    if (this.isRegistered) {
      this.connectionDot.className = 'status-dot online';
      this.connectionStatus.textContent = 'Registered';
    } else if (this.isConnected) {
      this.connectionDot.className = 'status-dot busy';
      this.connectionStatus.textContent = 'Connected';
    } else {
      this.connectionDot.className = 'status-dot offline';
      this.connectionStatus.textContent = 'Offline';
    }

    // Update task status
    if (this.currentTask) {
      this.connectionDot.className = 'status-dot busy';
      this.taskRow.style.display = 'block';
    } else {
      this.taskRow.style.display = 'none';
    }

    this.updateConnectionButton();
  }

  updateConnectionButton() {
    if (this.isConnected) {
      this.connectBtn.textContent = 'Disconnect';
      this.connectBtn.className = 'action-btn secondary';
    } else {
      this.connectBtn.textContent = 'Connect';
      this.connectBtn.className = 'action-btn';
    }
  }

  async toggleSettings() {
    const isHidden = this.settingsPanel.style.display === 'none';
    this.settingsPanel.style.display = isHidden ? 'block' : 'none';
    
    // Auto-resize window based on settings panel visibility
    const normalHeight = 120;
    const expandedHeight = 300;
    const width = 400;
    
    try {
      await window.electronAPI.resizeWindow({
        width: width,
        height: isHidden ? expandedHeight : normalHeight
      });
    } catch (error) {
      console.error('Failed to resize window:', error);
    }
    
    if (isHidden) {
      this.showSettings();
    }
  }

  showSettings() {
    this.settingsPanel.style.display = 'block';
    
    // Populate current settings
    this.adminUrlInput.value = this.workerConfig.adminUrl;
    this.workerNameInput.value = this.workerConfig.workerName;
    this.adminTokenInput.value = this.workerConfig.adminToken;
    
    // Focus on the first empty field
    if (!this.adminTokenInput.value) {
      this.adminTokenInput.focus();
    } else if (!this.workerNameInput.value) {
      this.workerNameInput.focus();
    }
  }

  async saveSettings() {
    // Validate required fields
    if (!this.adminTokenInput.value.trim()) {
      this.showMessage('Admin token is required', 'error');
      this.adminTokenInput.focus();
      return;
    }

    // Update config
    this.workerConfig = {
      adminUrl: this.adminUrlInput.value.trim() || 'ws://localhost:3000',
      workerName: this.workerNameInput.value.trim(),
      adminToken: this.adminTokenInput.value.trim()
    };

    // Save to localStorage
    localStorage.setItem('workerConfig', JSON.stringify(this.workerConfig));
    
    this.settingsPanel.style.display = 'none';
    
    // Resize window back to normal size
    try {
      await window.electronAPI.resizeWindow({
        width: 400,
        height: 120
      });
    } catch (error) {
      console.error('Failed to resize window:', error);
    }
    
    this.showMessage('Settings saved', 'success');
    
    // Auto-connect if not connected
    if (!this.isConnected) {
      await this.connect();
    }
  }

  async cancelSettings() {
    this.settingsPanel.style.display = 'none';
    
    // Resize window back to normal size
    try {
      await window.electronAPI.resizeWindow({
        width: 400,
        height: 120
      });
    } catch (error) {
      console.error('Failed to resize window:', error);
    }
  }

  loadSavedSettings() {
    try {
      const saved = localStorage.getItem('workerConfig');
      if (saved) {
        this.workerConfig = { ...this.workerConfig, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.error('Failed to load saved settings:', error);
    }
  }

  showMessage(message, type = 'info') {
    this.statusMessage.textContent = message;
    this.statusMessage.className = `status-message ${type} show`;
    
    setTimeout(() => {
      this.statusMessage.classList.remove('show');
    }, 3000);
  }

  minimizeWindow() {
    // Hide the window (minimize to system tray)
    if (window.electronAPI.minimizeWindow) {
      window.electronAPI.minimizeWindow();
    } else {
      window.close(); // Fallback
    }
  }

  closeWindow() {
    window.close();
  }

  // Initialize worker status on load
  async initialize() {
    try {
      const status = await window.electronAPI.getWorkerStatus();
      this.isConnected = status.status.connected;
      this.isRegistered = status.status.registered;
      this.currentTask = status.status.currentTask;
      
      if (status.config.workerId) {
        this.workerIdDisplay.textContent = `ID: ${status.config.workerId.slice(0, 8)}`;
      }
      
      this.updateStatus();
    } catch (error) {
      console.error('Failed to get initial status:', error);
    }
  }
}

// Initialize the renderer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const renderer = new WorkerRenderer();
  renderer.initialize();
  
  // Expose globally for debugging
  window.workerRenderer = renderer;
}); 