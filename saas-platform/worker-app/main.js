const { app, BrowserWindow, ipcMain, Menu, Tray, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fetch = require('node-fetch');
const WebSocket = require('ws');
const Store = require('electron-store');

class BrowserUseWorker {
  constructor() {
    this.mainWindow = null;
    this.tray = null;
    this.ws = null;
    this.config = new Store();
    this.isQuitting = false;
    this.heartbeatInterval = null;
    this.currentTask = null;
    
    // Platform connection details
    this.platformApiUrl = process.env.PLATFORM_API_URL || 'https://cautious-jail-production.up.railway.app';
    this.platformWsUrl = process.env.PLATFORM_WS_URL || 'wss://cautious-jail-production.up.railway.app';
    
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    app.on('ready', () => this.onReady());
    app.on('window-all-closed', () => this.onWindowAllClosed());
    app.on('activate', () => this.onActivate());
    app.on('before-quit', () => this.onBeforeQuit());

    // IPC handlers
    ipcMain.handle('get-device-info', () => this.getDeviceInfo());
    ipcMain.handle('get-config', () => this.getConfig());
    ipcMain.handle('save-config', (event, config) => this.saveConfig(config));
    ipcMain.handle('connect-to-platform', (event, connectionData) => this.connectToPlatform(connectionData));
    ipcMain.handle('disconnect-from-platform', () => this.disconnectFromPlatform());
    ipcMain.handle('test-api-key', (event, apiKey) => this.testApiKey(apiKey));
    ipcMain.handle('get-connection-status', () => this.getConnectionStatus());
  }

  async onReady() {
    this.createMainWindow();
    this.createTray();
    
    // Check if already configured and try to auto-connect
    const config = this.getConfig();
    if (config.authToken && config.workspaceId) {
      this.connectWebSocket(config.authToken);
    }
  }

  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      title: 'Browser Use Worker',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      show: false
    });

    // Load the appropriate page based on setup status
    const config = this.getConfig();
    const startPage = config.authToken ? 'dashboard.html' : 'setup.html';
    
    this.mainWindow.loadFile(path.join(__dirname, 'renderer', startPage));
    
    this.mainWindow.once('ready-to-show', () => {
      if (!config.authToken) {
        this.mainWindow.show();
      }
    });

    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.mainWindow.hide();
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  createTray() {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    this.tray = new Tray(iconPath);
    
    this.updateTrayMenu();
    
    this.tray.on('click', () => {
      if (this.mainWindow) {
        if (this.mainWindow.isVisible()) {
          this.mainWindow.hide();
        } else {
          this.mainWindow.show();
          this.mainWindow.focus();
        }
      }
    });
  }

  updateTrayMenu() {
    const config = this.getConfig();
    const isConnected = this.ws && this.ws.readyState === WebSocket.OPEN;
    
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: config.workerName || 'Browser Use Worker', 
        enabled: false 
      },
      { type: 'separator' },
      { 
        label: `Status: ${isConnected ? 'Connected' : 'Disconnected'}`, 
        enabled: false 
      },
      { 
        label: `Workspace: ${config.workspaceName || 'Not set'}`, 
        enabled: false 
      },
      { type: 'separator' },
      { 
        label: 'Show Dashboard', 
        click: () => this.showMainWindow() 
      },
      { 
        label: 'Settings', 
        click: () => this.showSettings() 
      },
      { type: 'separator' },
      { 
        label: 'Quit', 
        click: () => this.quit() 
      }
    ]);
    
    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip(`Browser Use Worker - ${isConnected ? 'Connected' : 'Disconnected'}`);
  }

  getDeviceInfo() {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      app_version: app.getVersion(),
      node_version: process.version
    };
  }

  getConfig() {
    return {
      connectionCode: this.config.get('connectionCode'),
      workerName: this.config.get('workerName'),
      openaiApiKey: this.config.get('openaiApiKey'),
      preferredModel: this.config.get('preferredModel', 'gpt-4o-mini'),
      authToken: this.config.get('authToken'),
      workerId: this.config.get('workerId'),
      workspaceId: this.config.get('workspaceId'),
      workspaceName: this.config.get('workspaceName'),
      capabilities: this.config.get('capabilities', ['web-automation', 'form-filling', 'data-extraction'])
    };
  }

  saveConfig(config) {
    // Store configuration securely
    Object.keys(config).forEach(key => {
      this.config.set(key, config[key]);
    });
    
    this.updateTrayMenu();
    return { success: true };
  }

  async connectToPlatform(connectionData) {
    try {
      const { connectionCode, workerName, openaiApiKey, preferredModel } = connectionData;
      
      // Test OpenAI API key first
      const apiKeyValid = await this.testApiKey(openaiApiKey);
      if (!apiKeyValid) {
        throw new Error('Invalid OpenAI API key');
      }

      // Connect to platform
      const response = await fetch(`${this.platformApiUrl}/workers/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          connection_code: connectionCode,
          worker_name: workerName,
          device_info: this.getDeviceInfo(),
          capabilities: ['web-automation', 'form-filling', 'data-extraction']
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Connection failed');
      }

      const result = await response.json();

      // Save connection details
      this.saveConfig({
        connectionCode,
        workerName,
        openaiApiKey,
        preferredModel,
        authToken: result.auth_token,
        workerId: result.worker.id,
        workspaceId: result.workspace.id,
        workspaceName: result.workspace.name
      });

      // Connect WebSocket
      await this.connectWebSocket(result.auth_token);

      return {
        success: true,
        worker: result.worker,
        workspace: result.workspace
      };

    } catch (error) {
      console.error('Platform connection failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async connectWebSocket(authToken) {
    try {
      if (this.ws) {
        this.ws.close();
      }

      this.ws = new WebSocket(`${this.platformWsUrl}/workers`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      this.ws.on('open', () => {
        console.log('Connected to platform');
        this.startHeartbeat();
        this.updateTrayMenu();
        this.notifyRenderer('connection-status', { connected: true });
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      this.ws.on('close', () => {
        console.log('Disconnected from platform');
        this.stopHeartbeat();
        this.updateTrayMenu();
        this.notifyRenderer('connection-status', { connected: false });
        
        // Try to reconnect after 5 seconds
        setTimeout(() => {
          const config = this.getConfig();
          if (config.authToken) {
            this.connectWebSocket(config.authToken);
          }
        }, 5000);
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.notifyRenderer('connection-error', { error: error.message });
      });

    } catch (error) {
      console.error('WebSocket connection failed:', error);
    }
  }

  handleWebSocketMessage(message) {
    switch (message.type || message.event) {
      case 'task_assigned':
        this.handleTaskAssigned(message);
        break;
      
      case 'task_cancelled':
        this.handleTaskCancelled(message);
        break;
        
      case 'ping':
        this.ws.send(JSON.stringify({ type: 'pong' }));
        break;
        
      default:
        console.log('Unhandled message:', message);
    }
    
    // Forward all messages to renderer
    this.notifyRenderer('websocket-message', message);
  }

  async handleTaskAssigned(taskData) {
    try {
      this.currentTask = taskData;
      console.log('Task assigned:', taskData.title);
      
      // Notify renderer about new task
      this.notifyRenderer('task-assigned', taskData);
      
      // Send task start confirmation
      this.ws.send(JSON.stringify({
        type: 'task_start',
        task_id: taskData.id
      }));

      // Update worker status to running
      this.updateWorkerStatus('busy');

      // Execute the task
      const result = await this.executeTask(taskData);
      
      // Send completion result
      this.ws.send(JSON.stringify({
        type: 'task_complete',
        task_id: taskData.id,
        status: result.success ? 'completed' : 'failed',
        result: result.output,
        error_message: result.error,
        execution_time: result.executionTime
      }));

      // Update worker status back to online
      this.updateWorkerStatus('online');
      this.currentTask = null;

    } catch (error) {
      console.error('Task execution failed:', error);
      
      // Send failure result
      this.ws.send(JSON.stringify({
        type: 'task_complete',
        task_id: taskData.id,
        status: 'failed',
        error_message: error.message,
        execution_time: 0
      }));

      this.updateWorkerStatus('online');
      this.currentTask = null;
    }
  }

  async executeTask(taskData) {
    const startTime = Date.now();
    
    try {
      // Import and use browser automation library
      const { BrowserUseAgent } = require('./lib/browser-use-agent');
      
      const config = this.getConfig();
      const agent = new BrowserUseAgent({
        apiKey: config.openaiApiKey,
        model: config.preferredModel
      });

      // Execute the browser automation task
      const result = await agent.execute(taskData.description);
      
      const executionTime = (Date.now() - startTime) / 1000;
      
      return {
        success: true,
        output: result.formatted_output || result.output,
        executionTime: executionTime
      };

    } catch (error) {
      const executionTime = (Date.now() - startTime) / 1000;
      
      return {
        success: false,
        error: error.message,
        executionTime: executionTime
      };
    }
  }

  updateWorkerStatus(status) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'status_update',
        status: status,
        timestamp: Date.now()
      }));
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const config = this.getConfig();
        
        fetch(`${this.platformApiUrl}/workers/${config.workerId}/heartbeat`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.authToken}`,
            'Content-Type': 'application/json'
          }
        }).then(response => response.json()).then(data => {
          if (data.pending_tasks && data.pending_tasks.length > 0) {
            this.notifyRenderer('pending-tasks', data.pending_tasks);
          }
        }).catch(error => {
          console.error('Heartbeat failed:', error);
        });
      }
    }, 60000); // Send heartbeat every minute
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async testApiKey(apiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  getConnectionStatus() {
    return {
      connected: this.ws && this.ws.readyState === WebSocket.OPEN,
      currentTask: this.currentTask,
      config: this.getConfig()
    };
  }

  disconnectFromPlatform() {
    if (this.ws) {
      this.ws.close();
    }
    
    this.stopHeartbeat();
    
    // Clear stored auth data but keep basic config
    this.config.delete('authToken');
    this.config.delete('workerId');
    this.config.delete('workspaceId');
    this.config.delete('workspaceName');
    
    this.updateTrayMenu();
    
    return { success: true };
  }

  notifyRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  showMainWindow() {
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  showSettings() {
    this.showMainWindow();
    this.notifyRenderer('show-settings');
  }

  onWindowAllClosed() {
    // Keep app running in tray on all platforms
  }

  onActivate() {
    if (this.mainWindow === null) {
      this.createMainWindow();
    } else {
      this.mainWindow.show();
    }
  }

  onBeforeQuit() {
    this.isQuitting = true;
    
    if (this.ws) {
      this.ws.close();
    }
    
    this.stopHeartbeat();
  }

  quit() {
    this.isQuitting = true;
    app.quit();
  }
}

// Create and initialize the worker
const worker = new BrowserUseWorker();

module.exports = worker; 