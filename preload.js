const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Stream Server controls (Virtual Camera / OBS)
  startStreamServer: (port) => ipcRenderer.invoke('stream:start', port),
  stopStreamServer: () => ipcRenderer.invoke('stream:stop'),
  getStreamInfo: () => ipcRenderer.invoke('stream:get-info'),
  sendStreamFrame: (arrayBuffer) => ipcRenderer.send('stream:frame', arrayBuffer),

  // File system & Media
  saveSnapshot: (base64Data) => ipcRenderer.invoke('media:save-snapshot', base64Data),
  saveVideoRecording: (buffer, filename) => ipcRenderer.invoke('media:save-video', buffer, filename),
  openFolder: (folderPath) => ipcRenderer.invoke('system:open-folder', folderPath),
  openCapturesFolder: () => ipcRenderer.invoke('system:open-captures'),

  // Paths
  getAppPaths: () => ipcRenderer.invoke('system:get-paths'),

  // DirectShow Windows Virtual Camera
  vcamGetStatus: () => ipcRenderer.invoke('vcam:get-status'),
  vcamInstall: () => ipcRenderer.invoke('vcam:install'),
  vcamUninstall: () => ipcRenderer.invoke('vcam:uninstall'),
  vcamStart: (width, height) => ipcRenderer.invoke('vcam:start', width, height),
  vcamStop: () => ipcRenderer.invoke('vcam:stop'),
  vcamSendFrame: (arrayBuffer, width, height) => ipcRenderer.send('vcam:frame', arrayBuffer, width, height)
});
