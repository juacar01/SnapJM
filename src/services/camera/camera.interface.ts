import { CameraResolution, CameraDeviceInfo } from '../../core/types';

export interface ICameraService {
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  detectCapabilities(track: MediaStreamTrack): CameraDeviceInfo;
  startStream(deviceId?: string, targetResolution?: string, targetFps?: number): Promise<MediaStream>;
  stopStream(): void;
  getCurrentStream(): MediaStream | null;
  getCurrentTrack(): MediaStreamTrack | null;
  applyHardwareConstraints(constraints: MediaTrackConstraints): Promise<boolean>;
}
