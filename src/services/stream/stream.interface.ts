import { ServerInfo } from '../../core/types';

export interface IStreamService {
  startServer(port?: number): Promise<ServerInfo>;
  stopServer(): Promise<boolean>;
  sendFrame(canvas: HTMLCanvasElement): void;
  isRunning(): boolean;
  getInfo(): ServerInfo | null;
}
