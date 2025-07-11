const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Connection management
  connectToAdmin: (config) => ipcRenderer.invoke('connect-to-admin', config),
  disconnectFromAdmin: () => ipcRenderer.invoke('disconnect-from-admin'),
  getWorkerStatus: () => ipcRenderer.invoke('get-worker-status'),
  
  // Task execution
  executeTask: (task) => ipcRenderer.invoke('execute-task', task),
  
  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Window management
  resizeWindow: (dimensions) => ipcRenderer.invoke('resize-window', dimensions),
  
  // Event listeners for main process communications
  on: (channel, callback) => {
    const validChannels = [
      'admin-connected',
      'admin-disconnected', 
      'worker-registered',
      'task-assigned',
      'task-completed',
      'browser-use-log',
      'status-update',
      'connection-error'
    ];
    
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    } else {
      console.warn(`Invalid channel: ${channel}`);
    }
  },
  
  // Remove event listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  
  // Platform info
  platform: process.platform,
  versions: process.versions
}); 