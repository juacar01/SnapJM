const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const StreamServer = require('./src/server/stream-server');
const vcamService = require('./src/server/vcam-service');

// Performance & GPU optimization flags
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-certificate-errors');

let mainWindow = null;
let streamServer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0c0f17',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allows local wasm and model loading seamlessly
      backgroundThrottling: false // Keep AR rendering smooth even when window is in background
    },
    icon: path.join(__dirname, 'public', 'icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (streamServer) {
      streamServer.stop();
    }
    if (vcamService) {
      vcamService.stop();
    }
  });
}

// Window controls IPC
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// Stream Server IPC (Virtual Cam output for OBS)
ipcMain.handle('stream:start', async (event, port = 8554) => {
  if (!streamServer) {
    streamServer = new StreamServer(port);
  }
  const actualPort = await streamServer.start();
  return {
    running: true,
    port: actualPort,
    obsUrl: `http://localhost:${actualPort}`,
    mjpegUrl: `http://localhost:${actualPort}/stream.mjpeg`
  };
});

ipcMain.handle('stream:stop', () => {
  if (streamServer) {
    streamServer.stop();
  }
  return { running: false };
});

ipcMain.handle('stream:get-info', () => {
  if (streamServer && streamServer.isRunning) {
    return {
      running: true,
      port: streamServer.port,
      clients: streamServer.mjpegClients.size,
      fps: streamServer.fps,
      obsUrl: `http://localhost:${streamServer.port}`,
      mjpegUrl: `http://localhost:${streamServer.port}/stream.mjpeg`
    };
  }
  return { running: false };
});

ipcMain.on('stream:frame', (event, buffer) => {
  if (streamServer && streamServer.isRunning && buffer) {
    streamServer.pushFrame(Buffer.from(buffer));
  }
});

// DirectShow Windows Virtual Camera IPC
ipcMain.handle('vcam:get-status', () => {
  return vcamService.getStatus();
});

ipcMain.handle('vcam:install', async () => {
  try {
    const res = await vcamService.installDriver();
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('vcam:uninstall', async () => {
  try {
    const res = await vcamService.uninstallDriver();
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('vcam:start', (event, width, height) => {
  const success = vcamService.start(width, height);
  return { running: success, ...vcamService.getStatus() };
});

ipcMain.handle('vcam:stop', () => {
  vcamService.stop();
  return { running: false };
});

ipcMain.on('vcam:frame', (event, buffer, width, height) => {
  if (vcamService && vcamService.isRunning && buffer) {
    vcamService.pushFrame(Buffer.from(buffer), width, height);
  }
});

// Snapshot & Media Saver IPC
ipcMain.handle('media:save-snapshot', async (event, base64Data) => {
  try {
    const picturesDir = app.getPath('pictures') || app.getPath('documents');
    const snapDir = path.join(picturesDir, 'SnapJM_Captures');
    if (!fs.existsSync(snapDir)) {
      fs.mkdirSync(snapDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `SnapJM_${timestamp}.png`;
    const filePath = path.join(snapDir, filename);

    // Strip header if present
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64Image, 'base64'));

    return { success: true, filePath, filename, folder: snapDir };
  } catch (error) {
    console.error('Error saving snapshot:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('media:save-video', async (event, arrayBuffer, originalFilename) => {
  try {
    const videosDir = app.getPath('videos') || app.getPath('documents');
    const snapDir = path.join(videosDir, 'SnapJM_Recordings');
    if (!fs.existsSync(snapDir)) {
      fs.mkdirSync(snapDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = originalFilename || `SnapJM_Rec_${timestamp}.webm`;
    const filePath = path.join(snapDir, filename);

    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    return { success: true, filePath, filename, folder: snapDir };
  } catch (error) {
    console.error('Error saving video:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:open-folder', (event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
    return true;
  }
  return false;
});

ipcMain.handle('system:open-captures', () => {
  const picturesDir = app.getPath('pictures') || app.getPath('documents');
  const snapDir = path.join(picturesDir, 'SnapJM_Captures');
  if (!fs.existsSync(snapDir)) {
    fs.mkdirSync(snapDir, { recursive: true });
  }
  shell.openPath(snapDir);
  return true;
});

ipcMain.handle('system:get-paths', () => {
  return {
    appPath: app.getAppPath(),
    wasmPath: path.join(__dirname, 'public', 'wasm'),
    modelPath: path.join(__dirname, 'public', 'models', 'face_landmarker.task')
  };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
