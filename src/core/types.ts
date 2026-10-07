/**
 * Core Domain Contracts and Types
 * Defines immutable data models and contracts across the application.
 */

export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

export interface TrackResult {
  hasFace: boolean;
  landmarks: LandmarkPoint[] | null;
  maskCanvas: HTMLCanvasElement | null;
}

export interface AICalibrationData {
  exposureGain: number;      // Digital gain multiplier (e.g., 1.0 - 1.85)
  whiteBalance: [number, number, number]; // [R, G, B] chromatic gains
  shadowLift: number;        // Digital ISO shadow lift factor (0.0 - 0.40)
  kelvin: number;            // Estimated color temperature in Kelvin
  lightingChanged: boolean;  // True when a sudden ambient lighting transition is detected
  ambientLuminance: number;  // Current measured ambient level

  // Step 2: Automatic Noise Filter calculated from lighting & ISO level
  autoDenoiseIntensity: number; // Dynamic intensity (0.35 - 0.95)
  autoDenoiseTemporal: number;  // Dynamic temporal filter (0.55 - 0.90)
  autoDenoiseChroma: number;    // Dynamic chromatic noise filter (0.50 - 0.98)
}

export interface BeautyParams {
  // AI Image Denoise (Multi-scale kernel)
  denoiseEnabled: boolean;
  denoiseAuto: boolean;         // Automatic denoise reactive to lighting
  denoiseIntensity: number;
  denoiseTemporal: number;
  denoiseChroma: number;

  // StreamFog Porcelain Skin Smoothing
  smoothIntensity: number;
  smoothRadius: number;
  edgeThreshold: number;

  // Uniformity & Anti-redness
  uniformity: number;
  antiRedness: number;
  skinToneTint: number;
  sharpen: number;

  // Teeth, Eyes & Concealer
  teethWhitening: number;
  teethBrightness: number;
  eyeBrightening: number;
  concealer: number;

  // Studio Lighting & Grading
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  glow: number;
  vignette: number;

  // View controls
  mirror: boolean;
  splitPosition: number;
  bypass: boolean;
}

export interface CameraResolution {
  value: string;
  width: number;
  height: number;
  label: string;
}

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
  resolutions: CameraResolution[];
  maxFps: number;
  maxW: number;
  maxH: number;
}

export interface ServerInfo {
  running: boolean;
  port: number;
  obsUrl: string;
  mjpegUrl: string;
  clients?: number;
  fps?: number;
}

export interface ElectronAPI {
  // Window controls
  minimize(): void;
  maximize(): void;
  close(): void;

  // Stream Server controls (Virtual Camera / OBS HTTP)
  startStreamServer(port?: number): Promise<any>;
  stopStreamServer(): Promise<any>;
  getStreamInfo?(): Promise<any>;
  getStreamServerInfo?(): Promise<any>;
  sendStreamFrame(buffer: ArrayBuffer): void;

  // DirectShow Windows Virtual Camera
  vcamGetStatus(): Promise<{ installed: boolean; running: boolean; fps: number; width: number; height: number }>;
  vcamInstall(): Promise<{ success: boolean; message?: string; error?: string }>;
  vcamUninstall(): Promise<{ success: boolean; message?: string; error?: string }>;
  vcamStart(width?: number, height?: number): Promise<{ running: boolean }>;
  vcamStop(): Promise<{ running: boolean }>;
  vcamSendFrame(buffer: ArrayBuffer, width: number, height: number): void;

  // File system & Media
  saveSnapshot?(base64Data: string): Promise<any>;
  saveVideoRecording?(buffer: ArrayBuffer, filename?: string): Promise<any>;
  openFolder?(folderPath: string): Promise<boolean>;
  openCapturesFolder?(): Promise<boolean>;

  // Paths
  getAppPaths?(): Promise<any>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
