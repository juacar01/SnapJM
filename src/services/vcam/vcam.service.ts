import { IVirtualCamService, VCamStatus } from './vcam.interface';
import '../../core/types';

export class VirtualCamService implements IVirtualCamService {
  private running = false;
  private worker: Worker | null = null;
  private isWorkerBusy = false;
  private lastFrameTimestamp = 0;

  // Fallback 2D canvas if Web Worker is unavailable in environment
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof Worker === 'undefined') return;

    try {
      // Background worker running on an independent OS thread
      // Offloads all scaling, vertical flip and synchronous getImageData()
      // from the main UI / WebGL render loop.
      const workerCode = `
        let canvas = null;
        let ctx = null;

        self.onmessage = function(e) {
          const { bitmap, targetW, targetH } = e.data;
          if (!bitmap) return;

          try {
            if (!canvas || canvas.width !== targetW || canvas.height !== targetH) {
              canvas = new OffscreenCanvas(targetW, targetH);
              ctx = canvas.getContext('2d', { willReadFrequently: true });
            }

            if (ctx) {
              ctx.save();
              ctx.translate(0, targetH);
              ctx.scale(1, -1);
              ctx.drawImage(bitmap, 0, 0, targetW, targetH);
              ctx.restore();

              const imgData = ctx.getImageData(0, 0, targetW, targetH);
              const buffer = imgData.data.buffer;
              // Zero-copy transfer back to the main thread
              self.postMessage({ buffer, width: targetW, height: targetH }, [buffer]);
            }
          } catch (err) {
            self.postMessage({ error: err.message });
          } finally {
            bitmap.close();
          }
        };
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (e: MessageEvent) => {
        this.isWorkerBusy = false;
        if (e.data && e.data.buffer && window.electronAPI && this.running) {
          window.electronAPI.vcamSendFrame(e.data.buffer, e.data.width, e.data.height);
        }
      };

      this.worker.onerror = (err) => {
        console.warn('[VirtualCamService] Background Worker error, using fallback:', err);
        this.isWorkerBusy = false;
      };
    } catch (e) {
      console.warn('[VirtualCamService] Could not initialize Worker, fallback mode active:', e);
      this.worker = null;
    }
  }

  public async getStatus(): Promise<VCamStatus> {
    if (!window.electronAPI) {
      return { installed: false, running: false, fps: 0, width: 1920, height: 1080 };
    }
    const status = await window.electronAPI.vcamGetStatus();
    this.running = status.running;
    return status;
  }

  public async installDriver(): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!window.electronAPI) {
      return { success: false, error: 'Entorno Electron no detectado.' };
    }
    return await window.electronAPI.vcamInstall();
  }

  public async uninstallDriver(): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!window.electronAPI) {
      return { success: false, error: 'Entorno Electron no detectado.' };
    }
    return await window.electronAPI.vcamUninstall();
  }

  public async start(width: number = 1920, height: number = 1080): Promise<boolean> {
    if (!window.electronAPI) return false;
    this.isWorkerBusy = false;
    const res = await window.electronAPI.vcamStart(width, height);
    this.running = res.running;
    return this.running;
  }

  public async stop(): Promise<boolean> {
    if (!window.electronAPI) return false;
    await window.electronAPI.vcamStop();
    this.running = false;
    this.isWorkerBusy = false;
    return true;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public sendFrame(glCanvas: HTMLCanvasElement): void {
    if (!this.running || !window.electronAPI) return;

    const sourceW = glCanvas.width;
    const sourceH = glCanvas.height;
    if (sourceW <= 0 || sourceH <= 0) return;

    const now = performance.now();
    // Maintain smooth 60 FPS output (interval ~15ms allows ~60 FPS without dropping frames on minor timer jitter)
    if (now - this.lastFrameTimestamp < 15) return;

    // Downscale target output to max 1920x1080 maintaining exact aspect ratio
    let targetW = sourceW;
    let targetH = sourceH;
    const maxVcamW = 1920;
    const maxVcamH = 1080;
    if (targetW > maxVcamW || targetH > maxVcamH) {
      const scale = Math.min(maxVcamW / targetW, maxVcamH / targetH);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }

    // MULTITHREADED PATH (Dedicated Web Worker + Transferable ImageBitmap)
    if (this.worker) {
      if (this.isWorkerBusy) return; // Background thread is working on a frame, never stall the main UI/WebGL thread
      this.isWorkerBusy = true;
      this.lastFrameTimestamp = now;

      // createImageBitmap takes an instant GPU snapshot on a background thread without blocking JavaScript
      window.createImageBitmap(glCanvas).then(bitmap => {
        if (!this.running || !this.worker) {
          bitmap.close();
          this.isWorkerBusy = false;
          return;
        }
        // Zero-copy transfer of ImageBitmap handle to the background Worker thread
        this.worker.postMessage({ bitmap, targetW, targetH }, [bitmap]);
      }).catch(() => {
        this.isWorkerBusy = false;
      });
      return;
    }

    // FALLBACK SYNCHRONOUS PATH (Only used if Web Worker is unavailable)
    if (this.isWorkerBusy) return;
    this.lastFrameTimestamp = now;

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.ctx2d = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
      this.offscreenCanvas.width = targetW;
      this.offscreenCanvas.height = targetH;
    }

    if (!this.ctx2d) return;

    this.isWorkerBusy = true;
    try {
      this.ctx2d.save();
      this.ctx2d.translate(0, targetH);
      this.ctx2d.scale(1, -1);
      this.ctx2d.drawImage(glCanvas, 0, 0, targetW, targetH);
      this.ctx2d.restore();
      const imgData = this.ctx2d.getImageData(0, 0, targetW, targetH);
      window.electronAPI.vcamSendFrame(imgData.data.buffer, targetW, targetH);
    } catch (e) {
      console.warn('[VirtualCamService] Error capturing/sending frame:', e);
    } finally {
      this.isWorkerBusy = false;
    }
  }
}
