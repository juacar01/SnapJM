import { IVirtualCamService, VCamStatus } from './vcam.interface';
import '../../core/types';

export class VirtualCamService implements IVirtualCamService {
  private running = false;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private lastFrameTimestamp = 0;
  private isProcessingFrame = false;

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
    const res = await window.electronAPI.vcamStart(width, height);
    this.running = res.running;
    return this.running;
  }

  public async stop(): Promise<boolean> {
    if (!window.electronAPI) return false;
    await window.electronAPI.vcamStop();
    this.running = false;
    return true;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public sendFrame(glCanvas: HTMLCanvasElement): void {
    if (!this.running || !window.electronAPI || this.isProcessingFrame) return;

    const w = glCanvas.width;
    const h = glCanvas.height;
    if (w <= 0 || h <= 0) return;

    const now = performance.now();
    // Maintain smooth 60 FPS output (interval ~14ms allows 60 FPS without dropping frames on minor timer jitter)
    if (now - this.lastFrameTimestamp < 14) return;
    this.lastFrameTimestamp = now;

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.ctx2d = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (this.offscreenCanvas.width !== w || this.offscreenCanvas.height !== h) {
      this.offscreenCanvas.width = w;
      this.offscreenCanvas.height = h;
    }

    if (!this.ctx2d) return;

    this.isProcessingFrame = true;
    try {
      this.ctx2d.save();
      this.ctx2d.translate(0, h);
      this.ctx2d.scale(1, -1);
      this.ctx2d.drawImage(glCanvas, 0, 0, w, h);
      this.ctx2d.restore();
      const imgData = this.ctx2d.getImageData(0, 0, w, h);
      window.electronAPI.vcamSendFrame(imgData.data.buffer, w, h);
    } catch (e) {
      console.warn('[VirtualCamService] Error capturing/sending frame:', e);
    } finally {
      this.isProcessingFrame = false;
    }
  }
}
