import { ICameraService } from './camera.interface';
import { CameraResolution, CameraDeviceInfo } from '../../core/types';

export class CameraService implements ICameraService {
  private currentStream: MediaStream | null = null;
  private resolutionsCache: Map<string, CameraDeviceInfo> = new Map();

  public async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  }

  public detectCapabilities(track: MediaStreamTrack): CameraDeviceInfo {
    const deviceId = track.getSettings ? (track.getSettings().deviceId || 'default') : 'default';
    if (this.resolutionsCache.has(deviceId)) {
      return this.resolutionsCache.get(deviceId)!;
    }

    const candidateResolutions = [
      { w: 3840, h: 2160, label: '4K UHD (3840 × 2160) [16:9]' },
      { w: 2560, h: 1440, label: '2K QHD (2560 × 1440) [16:9]' },
      { w: 1920, h: 1080, label: '1080p Full HD (1920 × 1080) [16:9]' },
      { w: 1600, h: 1200, label: 'UXGA (1600 × 1200) [4:3]' },
      { w: 1600, h: 900,  label: 'HD+ (1600 × 900) [16:9]' },
      { w: 1440, h: 900,  label: 'WXGA+ (1440 × 900) [16:10]' },
      { w: 1366, h: 768,  label: 'HD (1366 × 768) [16:9]' },
      { w: 1280, h: 960,  label: 'SXGA (1280 × 960) [4:3]' },
      { w: 1280, h: 720,  label: '720p HD (1280 × 720) [16:9]' },
      { w: 1024, h: 768,  label: 'XGA (1024 × 768) [4:3]' },
      { w: 960,  h: 540,  label: 'qHD (960 × 540) [16:9]' },
      { w: 848,  h: 480,  label: 'WVGA (848 × 480) [16:9]' },
      { w: 800,  h: 600,  label: 'SVGA (800 × 600) [4:3]' },
      { w: 640,  h: 480,  label: 'VGA (640 × 480) [4:3]' }
    ];

    let maxW = 3840;
    let maxH = 2160;
    let minW = 160;
    let minH = 120;
    let maxFps = 60;

    const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
    if (caps) {
      if (caps.width && caps.width.max) maxW = caps.width.max;
      if (caps.width && caps.width.min) minW = caps.width.min;
      if (caps.height && caps.height.max) maxH = caps.height.max;
      if (caps.height && caps.height.min) minH = caps.height.min;
      if (caps.frameRate && caps.frameRate.max) maxFps = Math.round(caps.frameRate.max);
    }

    const currentSettings = typeof track.getSettings === 'function' ? track.getSettings() : null;
    const initialW = currentSettings ? currentSettings.width : 1280;
    const initialH = currentSettings ? currentSettings.height : 720;

    const filtered = candidateResolutions.filter(c => c.w <= maxW && c.h <= maxH && c.w >= minW && c.h >= minH);

    if (initialW && initialH && !filtered.some(v => v.w === initialW && v.h === initialH)) {
      filtered.push({
        w: initialW,
        h: initialH,
        label: `${initialW} × ${initialH} (Nativa)`
      });
    }

    filtered.sort((a, b) => (b.w * b.h) - (a.w * a.h));

    const resolutions: CameraResolution[] = filtered.map(c => ({
      value: `${c.w}x${c.h}`,
      width: c.w,
      height: c.h,
      label: c.label
    }));

    const info: CameraDeviceInfo = {
      deviceId,
      label: track.label || 'Webcam',
      resolutions,
      maxFps,
      maxW,
      maxH
    };

    this.resolutionsCache.set(deviceId, info);
    return info;
  }

  public async startStream(deviceId?: string, targetResolution?: string, targetFps: number = 60): Promise<MediaStream> {
    this.stopStream();
    // Allow Windows DirectShow / MediaFoundation to release the camera handle
    await new Promise(r => setTimeout(r, 80));

    let targetW = 1920;
    let targetH = 1080;
    if (targetResolution) {
      const parts = targetResolution.split('x').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        targetW = parts[0];
        targetH = parts[1];
      }
    }

    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: targetW, min: Math.min(targetW, 1280) },
      height: { ideal: targetH, min: Math.min(targetH, 720) },
      frameRate: { ideal: targetFps }
    };

    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    }

    try {
      this.currentStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: true
      });
    } catch (errFallback) {
      console.warn('[CameraService] Retry 1 (without min constraint):', errFallback);
      try {
        this.currentStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: targetW },
            height: { ideal: targetH },
            frameRate: { ideal: targetFps }
          },
          audio: true
        });
      } catch (errNoExact) {
        console.warn('[CameraService] Retry 2 (ideal deviceId and video-only):', errNoExact);
        try {
          this.currentStream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: deviceId ? { ideal: deviceId } : undefined,
              width: { ideal: targetW },
              height: { ideal: targetH },
              frameRate: { ideal: targetFps }
            },
            audio: false
          });
        } catch (errFinal) {
          console.warn('[CameraService] Fallback to any default video device:', errFinal);
          this.currentStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        }
      }
    }

    return this.currentStream;
  }

  public stopStream(): void {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
      this.currentStream = null;
    }
  }

  public getCurrentStream(): MediaStream | null {
    return this.currentStream;
  }

  public getCurrentTrack(): MediaStreamTrack | null {
    if (!this.currentStream) return null;
    const tracks = this.currentStream.getVideoTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  public async applyHardwareConstraints(constraints: MediaTrackConstraints): Promise<boolean> {
    const track = this.getCurrentTrack();
    if (!track || typeof track.applyConstraints !== 'function') return false;

    try {
      await track.applyConstraints(constraints);
      return true;
    } catch (err) {
      console.warn('[CameraService] Hardware constraints rejected:', err);
      return false;
    }
  }
}
