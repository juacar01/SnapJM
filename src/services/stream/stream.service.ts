import { IStreamService } from './stream.interface';
import { ServerInfo } from '../../core/types';

export class StreamService implements IStreamService {
  private running = false;
  private serverInfo: ServerInfo | null = null;
  private lastFrameTimestamp = 0;
  private isEncoding = false;

  public async startServer(port: number = 8554): Promise<ServerInfo> {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }

    const info = await window.electronAPI.startStreamServer(port);
    this.running = true;
    this.serverInfo = {
      running: true,
      port: info.port,
      obsUrl: info.obsUrl,
      mjpegUrl: info.mjpegUrl
    };
    return this.serverInfo;
  }

  public async stopServer(): Promise<boolean> {
    if (!window.electronAPI) return false;
    await window.electronAPI.stopStreamServer();
    this.running = false;
    this.serverInfo = null;
    return true;
  }

  public sendFrame(canvas: HTMLCanvasElement): void {
    if (!this.running || !window.electronAPI || this.isEncoding) return;

    const now = performance.now();
    // Throttle to 30 FPS for OBS transmission to conserve network & CPU, leaving main thread at 60 FPS
    if (now - this.lastFrameTimestamp < 33) return;
    this.lastFrameTimestamp = now;

    this.isEncoding = true;
    canvas.toBlob(blob => {
      this.isEncoding = false;
      if (blob && window.electronAPI) {
        blob.arrayBuffer().then(buffer => {
          window.electronAPI!.sendStreamFrame(buffer);
        }).catch(() => {});
      }
    }, 'image/jpeg', 0.88);
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getInfo(): ServerInfo | null {
    return this.serverInfo;
  }
}
