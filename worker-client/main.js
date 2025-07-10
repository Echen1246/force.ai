const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');

// Import our worker modules
const AdminConnection = require('./lib/adminConnection');
const BrowserUseManager = require('./lib/browserUseManager');

class WorkerApp {
  constructor() {
    this.mainWindow = null;
    this.tray = null;
    this.adminConnection = null;
    this.browserUseManager = null;
    this.isDevMode = process.argv.includes('--dev');
    
    // Worker state
    this.workerConfig = {
      adminUrl: process.env.ADMIN_URL || 'wss://cautious-jail-production.up.railway.app',
      workerName: '',
      adminToken: '',
      workerId: null
    };
    
    this.workerStatus = {
      connected: false,
      registered: false,
      currentTask: null,
      status: 'offline'
    };
  }

  async initialize() {
    await app.whenReady();
    
    this.createMainWindow();
    this.createSystemTray();
    this.setupIPC();
    this.initializeWorkerModules();
    
    // Handle app activation (macOS)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow();
      }
    });
    
    // Prevent app from quitting when all windows are closed (except on macOS)
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
    
    // Handle app quit
    app.on('before-quit', () => {
      this.cleanup();
    });
  }

  createMainWindow() {
    // Create the overlay window
    this.mainWindow = new BrowserWindow({
      width: 400,
      height: 120,
      x: 100,
      y: 50,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: false,
      minimizable: true,
      maximizable: false,
      transparent: true,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    // Load the overlay interface
    this.mainWindow.loadFile('renderer/index.html');

    // Open DevTools in development mode
    if (this.isDevMode) {
      this.mainWindow.webContents.openDevTools();
    }

    // Handle window events
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // Prevent navigation to external URLs
    this.mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      const parsedUrl = new URL(navigationUrl);
      if (parsedUrl.origin !== 'file://') {
        event.preventDefault();
        shell.openExternal(navigationUrl);
      }
    });
  }

  createSystemTray() {
    // Create system tray icon with fallback for missing icon
    try {
      // Try to create tray with icon file if it exists
      const iconPath = path.join(__dirname, 'assets/tray-icon.png');
      if (require('fs').existsSync(iconPath)) {
        this.tray = new Tray(iconPath);
      } else {
        // Create a simple text-based tray icon as fallback
        const { nativeImage } = require('electron');
        const icon = nativeImage.createEmpty();
        this.tray = new Tray(icon);
      }
    } catch (error) {
      console.warn('Failed to create system tray:', error.message);
      return; // Skip tray creation if it fails
    }

    this.updateTrayMenu();

    // Handle tray click
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
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Status: ${this.workerStatus.status}`,
        enabled: false
      },
      {
        label: this.workerStatus.connected ? 'Connected' : 'Disconnected',
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Show/Hide Window',
        click: () => {
          if (this.mainWindow) {
            if (this.mainWindow.isVisible()) {
              this.mainWindow.hide();
            } else {
              this.mainWindow.show();
              this.mainWindow.focus();
            }
          }
        }
      },
      {
        label: 'Settings',
        click: () => this.showSettings()
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit()
      }
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip(`Browser Use Worker - ${this.workerStatus.status}`);
  }

  setupIPC() {
    // Handle connection requests from renderer
    ipcMain.handle('connect-to-admin', async (event, config) => {
      try {
        this.workerConfig = { ...this.workerConfig, ...config };
        await this.connectToAdmin();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Handle disconnect requests
    ipcMain.handle('disconnect-from-admin', async () => {
      this.disconnectFromAdmin();
      return { success: true };
    });

    // Get current worker status
    ipcMain.handle('get-worker-status', () => {
      return {
        config: this.workerConfig,
        status: this.workerStatus
      };
    });

    // Handle task execution
    ipcMain.handle('execute-task', async (event, task) => {
      try {
        if (this.browserUseManager) {
          const result = await this.browserUseManager.executeTask(task);
          return { success: true, result };
        } else {
          throw new Error('Browser Use manager not initialized');
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Open external links
    ipcMain.handle('open-external', (event, url) => {
      shell.openExternal(url);
    });
  }

  initializeWorkerModules() {
    // Initialize Browser Use manager
    this.browserUseManager = new BrowserUseManager();
    
    // Set up Browser Use event handlers
    this.browserUseManager.on('log', (log) => {
      this.sendToRenderer('browser-use-log', log);
      if (this.adminConnection) {
        this.adminConnection.sendExecutionLog(log);
      }
    });

    this.browserUseManager.on('status-change', (status) => {
      this.updateWorkerStatus({ status });
    });
  }

  async connectToAdmin() {
    if (this.adminConnection) {
      this.adminConnection.disconnect();
    }

    this.adminConnection = new AdminConnection(this.workerConfig.adminUrl);
    
    // Set up admin connection event handlers
    this.adminConnection.on('connected', () => {
      this.updateWorkerStatus({ connected: true });
      this.sendToRenderer('admin-connected');
    });

    this.adminConnection.on('disconnected', () => {
      this.updateWorkerStatus({ connected: false, registered: false });
      this.sendToRenderer('admin-disconnected');
    });

    this.adminConnection.on('registered', (workerInfo) => {
      this.updateWorkerStatus({ 
        registered: true, 
        status: 'online' 
      });
      this.workerConfig.workerId = workerInfo.workerId;
      this.sendToRenderer('worker-registered', workerInfo);
    });

    this.adminConnection.on('task-assigned', (task) => {
      this.updateWorkerStatus({ 
        currentTask: task,
        status: 'busy' 
      });
      this.sendToRenderer('task-assigned', task);
      this.executeTask(task);
    });

    this.adminConnection.on('error', (error) => {
      this.sendToRenderer('connection-error', error);
    });

    // Connect and register
    await this.adminConnection.connect();
    await this.adminConnection.register({
      token: this.workerConfig.adminToken,
      workerInfo: {
        name: this.workerConfig.workerName || `Worker-${require('os').hostname()}`,
        capabilities: ['web-automation', 'form-filling', 'data-extraction']
      }
    });
  }

  disconnectFromAdmin() {
    if (this.adminConnection) {
      this.adminConnection.disconnect();
      this.adminConnection = null;
    }
    this.updateWorkerStatus({
      connected: false,
      registered: false,
      status: 'offline',
      currentTask: null
    });
  }

  async executeTask(task) {
    try {
      if (!this.browserUseManager) {
        throw new Error('Browser Use manager not available');
      }

      // Set task execution status for smart heartbeat
      if (this.adminConnection) {
        this.adminConnection.setTaskExecutionStatus(true);
      }

      // Execute the task
      const result = await this.browserUseManager.executeTask(task);
      
      // Report completion to admin
      if (this.adminConnection) {
        this.adminConnection.sendTaskComplete(task.taskId, true, result);
        this.adminConnection.setTaskExecutionStatus(false);
      }
      
      this.updateWorkerStatus({ 
        status: 'online',
        currentTask: null 
      });
      
      this.sendToRenderer('task-completed', { success: true, result });
      
    } catch (error) {
      // Report error to admin
      if (this.adminConnection) {
        this.adminConnection.sendTaskComplete(task.taskId, false, null, error.message);
        this.adminConnection.setTaskExecutionStatus(false);
      }
      
      this.updateWorkerStatus({ 
        status: 'online',
        currentTask: null 
      });
      
      this.sendToRenderer('task-completed', { success: false, error: error.message });
    }
  }

  updateWorkerStatus(updates) {
    this.workerStatus = { ...this.workerStatus, ...updates };
    this.updateTrayMenu();
    this.sendToRenderer('status-update', this.workerStatus);
  }

  sendToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  showSettings() {
    // For now, just show the main window
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  cleanup() {
    if (this.adminConnection) {
      this.adminConnection.disconnect();
    }
    if (this.browserUseManager) {
      this.browserUseManager.cleanup();
    }
  }
}

// Create and initialize the app
const workerApp = new WorkerApp();
workerApp.initialize().catch(console.error);

// Export for testing
module.exports = WorkerApp; 