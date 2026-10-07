export interface VCamStatus {
  installed: boolean;
  running: boolean;
  fps: number;
  width: number;
  height: number;
}

export interface IVirtualCamService {
  getStatus(): Promise<VCamStatus>;
  installDriver(): Promise<{ success: boolean; message?: string; error?: string }>;
  uninstallDriver(): Promise<{ success: boolean; message?: string; error?: string }>;
  start(width?: number, height?: number): Promise<boolean>;
  stop(): Promise<boolean>;
  sendFrame(glCanvas: HTMLCanvasElement): void;
  isRunning(): boolean;
}
