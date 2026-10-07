const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execSync } = require('child_process');
const koffi = require('koffi');

class VirtualCamService {
  constructor() {
    this.hMap = null;
    this.pBuf = null;
    this.pDest = null;
    this.hMutex = null;
    this.hWantEvent = null;
    this.hSentEvent = null;

    this.headerBuf = Buffer.alloc(32);
    this.isRunning = false;
    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsCalc = Date.now();
    this.currentWidth = 1920;
    this.currentHeight = 1080;

    // DirectShow UnityCapture filter specifications
    this.SHMEM_NAME = 'UnityCapture_Data';
    this.MUTEX_NAME = 'UnityCapture_Mutx';
    this.EVENT_WANT_NAME = 'UnityCapture_Want';
    this.EVENT_SENT_NAME = 'UnityCapture_Sent';
    // Max buffer: 3840 * 2160 * 4 * 2 = 66,355,200 bytes (~64 MB)
    this.MAX_SIZE = 3840 * 2160 * 4 * 2;
    this.HEADER_SIZE = 32;

    this.initWin32();
  }

  initWin32() {
    try {
      this.k32 = koffi.load('kernel32.dll');
      this.CreateFileMappingW = this.k32.func('void* CreateFileMappingW(void* hFile, void* lpAttributes, uint32 flProtect, uint32 dwMaximumSizeHigh, uint32 dwMaximumSizeLow, str16 lpName)');
      this.MapViewOfFile = this.k32.func('void* MapViewOfFile(void* hFileMappingObject, uint32 dwDesiredAccess, uint32 dwFileOffsetHigh, uint32 dwFileOffsetLow, size_t dwNumberOfBytesToMap)');
      this.UnmapViewOfFile = this.k32.func('int UnmapViewOfFile(void* lpBaseAddress)');
      this.CloseHandle = this.k32.func('int CloseHandle(void* hObject)');
      this.CreateMutexW = this.k32.func('void* CreateMutexW(void* lpMutexAttributes, int bInitialOwner, str16 lpName)');
      this.ReleaseMutex = this.k32.func('int ReleaseMutex(void* hMutex)');
      this.CreateEventW = this.k32.func('void* CreateEventW(void* lpEventAttributes, int bManualReset, int bInitialState, str16 lpName)');
      this.SetEvent = this.k32.func('int SetEvent(void* hEvent)');
      this.WaitForSingleObject = this.k32.func('uint32 WaitForSingleObject(void* hHandle, uint32 dwMilliseconds)');
      this.RtlMoveMemory = this.k32.func('void RtlMoveMemory(void* Destination, const void* Source, size_t Length)');

      this.INVALID_HANDLE_VALUE = koffi.as(-1, 'void*');
      this.PAGE_READWRITE = 0x04;
      this.FILE_MAP_ALL_ACCESS = 0xF001F;
    } catch (err) {
      console.error('[VirtualCamService] Error loading kernel32 Win32 APIs via koffi:', err);
    }
  }

  getDriverPaths() {
    const devDir = path.resolve(__dirname, '../../assets/driver');
    const prodDir = path.resolve(process.resourcesPath || '', 'driver');

    const baseDir = fs.existsSync(prodDir) ? prodDir : devDir;
    const dll64 = path.join(baseDir, 'UnityCaptureFilter64.dll');
    const dll32 = path.join(baseDir, 'UnityCaptureFilter32.dll');

    return {
      dll64: fs.existsSync(dll64) ? dll64 : null,
      dll32: fs.existsSync(dll32) ? dll32 : null
    };
  }

  isInstalled() {
    try {
      // 1. Direct registry check for UnityCapture CLSID
      const out1 = execSync('reg query "HKCR\\CLSID\\{5c2cd55c-92ad-4999-8666-912bd3e70010}" 2>nul', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (out1 && out1.includes('5c2cd55c')) return true;
    } catch (e) {}

    try {
      // 2. Direct registry check for DirectShow Video Input Category (x64)
      const out2 = execSync('reg query "HKLM\\SOFTWARE\\Classes\\CLSID\\{860BB310-5D01-11d0-BD3B-00A0C911CE86}\\Instance" /s /f "SnapJM" 2>nul', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (out2 && out2.includes('SnapJM')) return true;
    } catch (e) {}

    try {
      // 3. Direct registry check for DirectShow Video Input Category (WOW6432Node)
      const out3 = execSync('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Classes\\CLSID\\{860BB310-5D01-11d0-BD3B-00A0C911CE86}\\Instance" /s /f "SnapJM" 2>nul', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (out3 && out3.includes('SnapJM')) return true;
    } catch (e) {}

    try {
      // 4. Fallback check under HKCU
      const out4 = execSync('reg query "HKCU\\Software\\Classes\\CLSID\\{860BB310-5D01-11d0-BD3B-00A0C911CE86}\\Instance" /s /f "SnapJM" 2>nul', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (out4 && out4.includes('SnapJM')) return true;
    } catch (e) {}

    return false;
  }

  async installDriver() {
    const { dll64, dll32 } = this.getDriverPaths();
    if (!dll64 && !dll32) {
      throw new Error('No se encontraron los controladores DirectShow en assets/driver ni en resources.');
    }

    const tempDir = os.tmpdir();
    const batPath = path.join(tempDir, 'snapjm_register_driver.cmd');
    const vbsPath = path.join(tempDir, 'snapjm_elevate.vbs');

    // Create .cmd with regsvr32 commands for both 64-bit and 32-bit
    const batLines = ['@echo off'];
    if (dll64) {
      batLines.push(`regsvr32.exe /s "${dll64}" "/i:UnityCaptureName=SnapJM Virtual Camera"`);
    }
    if (dll32) {
      batLines.push(`regsvr32.exe /s "${dll32}" "/i:UnityCaptureName=SnapJM Virtual Camera"`);
    }
    batLines.push('exit /b 0');
    fs.writeFileSync(batPath, batLines.join('\r\n'));

    // Create VBScript elevation helper
    const vbsContent = [
      'Set UAC = CreateObject("Shell.Application")',
      'UAC.ShellExecute "cmd.exe", "/c """ & WScript.Arguments(0) & """", "", "runas", 1'
    ].join('\r\n');
    fs.writeFileSync(vbsPath, vbsContent);

    return new Promise((resolve, reject) => {
      // Execute via wscript (opens Windows UAC prompt directly on user desktop)
      exec(`wscript.exe //B "${vbsPath}" "${batPath}"`, (err) => {
        // Wait for Windows to complete COM registration
        setTimeout(() => {
          try {
            if (fs.existsSync(batPath)) fs.unlinkSync(batPath);
            if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath);
          } catch (e) {}

          if (this.isInstalled()) {
            resolve({ success: true, message: 'SnapJM Virtual Camera registrada con éxito en Windows.' });
          } else {
            reject(new Error('No se completó la instalación del controlador. Por favor acepta el diálogo de Administrador (UAC) de Windows.'));
          }
        }, 1500);
      });
    });
  }

  async uninstallDriver() {
    const { dll64, dll32 } = this.getDriverPaths();
    const tempDir = os.tmpdir();
    const batPath = path.join(tempDir, 'snapjm_unregister_driver.cmd');
    const vbsPath = path.join(tempDir, 'snapjm_elevate.vbs');

    const batLines = ['@echo off'];
    if (dll64) {
      batLines.push(`regsvr32.exe /u /s "${dll64}"`);
    }
    if (dll32) {
      batLines.push(`regsvr32.exe /u /s "${dll32}"`);
    }
    batLines.push('exit /b 0');
    fs.writeFileSync(batPath, batLines.join('\r\n'));

    const vbsContent = [
      'Set UAC = CreateObject("Shell.Application")',
      'UAC.ShellExecute "cmd.exe", "/c """ & WScript.Arguments(0) & """", "", "runas", 1'
    ].join('\r\n');
    fs.writeFileSync(vbsPath, vbsContent);

    return new Promise((resolve, reject) => {
      exec(`wscript.exe //B "${vbsPath}" "${batPath}"`, (err) => {
        setTimeout(() => {
          try {
            if (fs.existsSync(batPath)) fs.unlinkSync(batPath);
            if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath);
          } catch (e) {}

          if (!this.isInstalled()) {
            resolve({ success: true, message: 'SnapJM Virtual Camera desregistrada de Windows.' });
          } else {
            resolve({ success: true, message: 'Comando de desinstalación ejecutado.' });
          }
        }, 1500);
      });
    });
  }

  start(width = 1920, height = 1080) {
    if (this.isRunning) return true;

    try {
      this.currentWidth = width;
      this.currentHeight = height;

      const totalSize = this.HEADER_SIZE + this.MAX_SIZE;

      this.hMap = this.CreateFileMappingW(
        this.INVALID_HANDLE_VALUE,
        null,
        this.PAGE_READWRITE,
        0,
        totalSize,
        this.SHMEM_NAME
      );

      if (!this.hMap) {
        console.error('[VirtualCamService] CreateFileMappingW falló');
        return false;
      }

      this.pBuf = this.MapViewOfFile(
        this.hMap,
        this.FILE_MAP_ALL_ACCESS,
        0,
        0,
        0 // 0 = map entire section
      );

      if (!this.pBuf) {
        console.error('[VirtualCamService] MapViewOfFile falló');
        this.CloseHandle(this.hMap);
        this.hMap = null;
        return false;
      }

      // Pre-calculate destination pointer for pixel writes
      this.pDest = koffi.as(BigInt(this.pBuf) + BigInt(this.HEADER_SIZE), 'void*');

      // Mutex and Event synchronization primitives
      this.hMutex = this.CreateMutexW(null, 0, this.MUTEX_NAME);
      this.hWantEvent = this.CreateEventW(null, 0, 0, this.EVENT_WANT_NAME);
      this.hSentEvent = this.CreateEventW(null, 0, 0, this.EVENT_SENT_NAME);

      // Write SharedMemHeader
      this.updateHeader(width, height);

      this.isRunning = true;
      this.frameCount = 0;
      this.lastFpsCalc = Date.now();
      console.log(`[VirtualCamService] Windows DirectShow Virtual Camera iniciada (${width}x${height}) vía Shared Memory`);
      return true;
    } catch (err) {
      console.error('[VirtualCamService] Error al iniciar:', err);
      return false;
    }
  }

  updateHeader(width, height) {
    if (!this.pBuf) return;
    // SharedMemHeader layout:
    // 0: DWORD maxSize
    // 4: int width
    // 8: int height
    // 12: int stride (in pixels)
    // 16: int format (0 = FORMAT_UINT8)
    // 20: int resizemode (1 = RESIZEMODE_LINEAR: autoscales to match OBS/Zoom resolution)
    // 24: int mirrormode (0 = MIRRORMODE_DISABLED)
    // 28: int timeout (1000 ms)
    this.headerBuf.writeUInt32LE(this.MAX_SIZE, 0);
    this.headerBuf.writeInt32LE(width, 4);
    this.headerBuf.writeInt32LE(height, 8);
    this.headerBuf.writeInt32LE(width, 12);
    this.headerBuf.writeInt32LE(0, 16);
    this.headerBuf.writeInt32LE(1, 20); // RESIZEMODE_LINEAR = 1
    this.headerBuf.writeInt32LE(0, 24);
    this.headerBuf.writeInt32LE(1000, 28);

    if (this.hMutex) {
      this.WaitForSingleObject(this.hMutex, 5);
      this.RtlMoveMemory(this.pBuf, this.headerBuf, this.HEADER_SIZE);
      this.ReleaseMutex(this.hMutex);
    } else {
      this.RtlMoveMemory(this.pBuf, this.headerBuf, this.HEADER_SIZE);
    }
  }

  pushFrame(pixelBuffer, width, height) {
    if (!this.isRunning || !this.pBuf || !this.pDest || !pixelBuffer) return;

    try {
      if (width !== this.currentWidth || height !== this.currentHeight) {
        this.currentWidth = width;
        this.currentHeight = height;
        this.updateHeader(width, height);
      }

      if (this.hMutex) {
        this.WaitForSingleObject(this.hMutex, 50);
      }

      // Always keep header alive with latest dimensions
      this.headerBuf.writeUInt32LE(this.MAX_SIZE, 0);
      this.headerBuf.writeInt32LE(width, 4);
      this.headerBuf.writeInt32LE(height, 8);
      this.headerBuf.writeInt32LE(width, 12);
      this.headerBuf.writeInt32LE(0, 16);
      this.headerBuf.writeInt32LE(1, 20); // RESIZEMODE_LINEAR = 1
      this.headerBuf.writeInt32LE(0, 24);
      this.headerBuf.writeInt32LE(1000, 28);
      this.RtlMoveMemory(this.pBuf, this.headerBuf, this.HEADER_SIZE);

      // Copy raw RGBA pixel buffer to shared memory offset 32
      const byteLen = Math.min(pixelBuffer.length || pixelBuffer.byteLength || 0, width * height * 4);
      if (byteLen > 0) {
        this.RtlMoveMemory(this.pDest, pixelBuffer, byteLen);
      }

      if (this.hMutex) {
        this.ReleaseMutex(this.hMutex);
      }

      // Signal the waiting DirectShow filter that a fresh frame is ready
      if (this.hSentEvent) {
        this.SetEvent(this.hSentEvent);
      }

      // Telemetry FPS
      this.frameCount++;
      const now = Date.now();
      if (now - this.lastFpsCalc >= 1000) {
        this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsCalc));
        this.frameCount = 0;
        this.lastFpsCalc = now;
      }
    } catch (e) {
      console.warn('[VirtualCamService] Error in pushFrame:', e);
    }
  }

  stop() {
    if (!this.isRunning) return;

    if (this.pBuf) {
      this.UnmapViewOfFile(this.pBuf);
      this.pBuf = null;
      this.pDest = null;
    }

    if (this.hMap) {
      this.CloseHandle(this.hMap);
      this.hMap = null;
    }

    if (this.hMutex) {
      this.CloseHandle(this.hMutex);
      this.hMutex = null;
    }

    if (this.hWantEvent) {
      this.CloseHandle(this.hWantEvent);
      this.hWantEvent = null;
    }

    if (this.hSentEvent) {
      this.CloseHandle(this.hSentEvent);
      this.hSentEvent = null;
    }

    this.isRunning = false;
    this.fps = 0;
    console.log('[VirtualCamService] Virtual Camera detenida');
  }

  getStatus() {
    return {
      installed: this.isInstalled(),
      running: this.isRunning,
      fps: this.fps,
      width: this.currentWidth,
      height: this.currentHeight
    };
  }
}

module.exports = new VirtualCamService();
