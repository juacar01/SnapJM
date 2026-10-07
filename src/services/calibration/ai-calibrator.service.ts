import { IAICalibratorService } from './calibrator.interface';
import { AICalibrationData, LandmarkPoint } from '../../core/types';
import { EventBus } from '../../core/event-bus';

export class AICalibratorService implements IAICalibratorService {
  private enabled = true;

  // Ultra-fast 16x16 offscreen probe for lighting analytics
  private sampleCanvas: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D;

  // Target facial luminance in studio broadcast standard (Zone VI: 58-62% IRE)
  private readonly targetFaceLum = 0.58;

  // Lighting change detection threshold with hysteresis & debounce
  private readonly lightingChangeThreshold = 0.085; // 8.5% luminance delta triggers recalibration
  private readonly chromaChangeThreshold = 0.12;    // Significant color cast shift
  private readonly kelvinHysteresis = 250;           // ±250K color temperature dead zone
  private readonly cooldownMs = 1500;                // 1.5s cooldown between automatic recalibrations
  private lastRecalibrateTimestamp = 0;

  private previousSceneLuminance = 0.50;
  private previousChromaRG = 1.25;

  // Smoothed internal parameters (Exponential Moving Average)
  private currentExpGain = 1.0;
  private currentWhiteBalance: [number, number, number] = [1.0, 1.0, 1.0];
  private currentShadowLift = 0.0;
  private estimatedKelvin = 5400;

  // Step 2: Auto Denoise parameters reactive to ambient lighting and sensor gain
  private currentDenoiseIntensity = 0.75;
  private currentDenoiseTemporal = 0.78;
  private currentDenoiseChroma = 0.88;

  private lastHardwareCheckTime = 0;
  private forceRecalibrateFlag = true;

  constructor() {
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = 16;
    this.sampleCanvas.height = 16;
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public forceRecalibrate(): void {
    this.forceRecalibrateFlag = true;
  }

  public update(
    sourceElement: HTMLVideoElement | HTMLCanvasElement,
    landmarks: LandmarkPoint[] | null,
    videoTrack: MediaStreamTrack | null
  ): AICalibrationData {
    if (!this.enabled || !sourceElement) {
      return this.getDefaultValues();
    }

    const videoW = (sourceElement instanceof HTMLVideoElement) ? sourceElement.videoWidth : sourceElement.width;
    const videoH = (sourceElement instanceof HTMLVideoElement) ? sourceElement.videoHeight : sourceElement.height;
    if (!videoW || !videoH) return this.getCurrentValues(false, this.previousSceneLuminance);

    // 1. Determine facial bounding box for face-priority metering
    let sx = videoW * 0.25;
    let sy = videoH * 0.20;
    let sw = videoW * 0.50;
    let sh = videoH * 0.50;

    if (landmarks && landmarks.length > 0) {
      let minX = 1.0, maxX = 0.0, minY = 1.0, maxY = 0.0;
      // Focus strictly on inner facial skin (cheeks, nose bridge, glabella)
      // to eliminate any bleed from background RGB/neon/purple lights
      const innerSkinIndices = [1, 4, 168, 151, 197, 117, 346, 205, 425, 50, 280];
      for (let i = 0; i < innerSkinIndices.length; i++) {
        const pt = landmarks[innerSkinIndices[i]];
        if (pt) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }
      }

      sx = Math.max(0, minX * videoW);
      sy = Math.max(0, minY * videoH);
      sw = Math.min(videoW - sx, (maxX - minX) * videoW);
      sh = Math.min(videoH - sy, (maxY - minY) * videoH);
    }

    // 2. Sample 16x16 skin region
    this.sampleCtx.drawImage(sourceElement, sx, sy, sw, sh, 0, 0, 16, 16);
    let imgData: Uint8ClampedArray;
    try {
      imgData = this.sampleCtx.getImageData(0, 0, 16, 16).data;
    } catch (e) {
      return this.getCurrentValues(false, this.previousSceneLuminance);
    }

    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      const r = imgData[i] / 255.0;
      const g = imgData[i + 1] / 255.0;
      const b = imgData[i + 2] / 255.0;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Filter extreme highlights or deep black pixels
      if (lum > 0.08 && lum < 0.95) {
        sumR += r;
        sumG += g;
        sumB += b;
        count++;
      }
    }

    if (count < 20) return this.getCurrentValues(false, this.previousSceneLuminance);

    const avgR = sumR / count;
    const avgG = sumG / count;
    const avgB = sumB / count;
    const currentSceneLuminance = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
    const currentChromaRG = avgG > 0 ? avgR / avgG : 1.25;

    // ----------------------------------------------------
    // LIGHTING CHANGE DETECTOR (Hysteresis + Debounce)
    // ----------------------------------------------------
    const now = performance.now();
    const lumDelta = Math.abs(currentSceneLuminance - this.previousSceneLuminance);
    const chromaDelta = Math.abs(currentChromaRG - this.previousChromaRG);
    const potentialKelvin = Math.round(5200 * ((avgB / Math.max(0.01, avgG)) / Math.max(0.01, currentChromaRG)));
    const kelvinDelta = Math.abs(potentialKelvin - this.estimatedKelvin);

    const isCooldownElapsed = (now - this.lastRecalibrateTimestamp) >= this.cooldownMs;
    const isSignificantChange = (lumDelta >= this.lightingChangeThreshold) ||
                                (chromaDelta >= this.chromaChangeThreshold && kelvinDelta >= this.kelvinHysteresis);

    const lightingChanged = this.forceRecalibrateFlag || (isCooldownElapsed && isSignificantChange);

    if (lightingChanged) {
      this.lastRecalibrateTimestamp = now;
      this.previousSceneLuminance = currentSceneLuminance;
      this.previousChromaRG = currentChromaRG;
      this.forceRecalibrateFlag = false;

      // 1. Calculate Target Face Exposure Gain (Zone VI IRE Standard: 0.52 - 0.55)
      const targetExposure = Math.min(1.40, Math.max(0.90, 0.53 / Math.max(0.22, currentSceneLuminance)));

      // 2. Calculate Digital ISO / Shadow Lift (subtle shadow detail recovery)
      const targetShadowLift = Math.min(0.20, Math.max(0.0, (targetExposure - 1.0) * 0.25));

      // 3. Calculate Von Kries Chromatic Adaptation (AWB)
      let targetWbR = 1.0;
      let targetWbG = 1.0;
      let targetWbB = 1.0;

      if (avgG > 0.05) {
        const currentBG = avgB / avgG;
        const idealRG = 1.22; // Healthy natural skin chrominance
        const idealBG = 0.88;

        targetWbR = Math.min(1.18, Math.max(0.88, idealRG / Math.max(0.6, currentChromaRG)));
        targetWbB = Math.min(1.22, Math.max(0.82, idealBG / Math.max(0.5, currentBG)));
        targetWbG = 1.0;

        const normLum = 0.299 * targetWbR + 0.587 * targetWbG + 0.114 * targetWbB;
        targetWbR /= normLum;
        targetWbG /= normLum;
        targetWbB /= normLum;
      }

      // 4. Calculate Step 2: Automatic Noise Filter based on lighting & ISO / Exposure gain
      const noiseLevel = Math.min(1.0, Math.max(0.0,
        (1.0 - currentSceneLuminance) * 0.70 + (targetExposure - 1.0) * 0.55 + targetShadowLift * 0.80
      ));
      const targetDenoiseIntensity = Math.min(0.95, Math.max(0.35, 0.40 + noiseLevel * 0.55));
      const targetDenoiseTemporal = Math.min(0.90, Math.max(0.55, 0.55 + noiseLevel * 0.35));
      const targetDenoiseChroma = Math.min(0.98, Math.max(0.50, 0.52 + noiseLevel * 0.46));

      // Smooth adaptation response
      const fastAlpha = 0.22;
      this.currentExpGain += (targetExposure - this.currentExpGain) * fastAlpha;
      this.currentShadowLift += (targetShadowLift - this.currentShadowLift) * fastAlpha;
      this.currentWhiteBalance[0] += (targetWbR - this.currentWhiteBalance[0]) * fastAlpha;
      this.currentWhiteBalance[1] += (targetWbG - this.currentWhiteBalance[1]) * fastAlpha;
      this.currentWhiteBalance[2] += (targetWbB - this.currentWhiteBalance[2]) * fastAlpha;

      this.currentDenoiseIntensity += (targetDenoiseIntensity - this.currentDenoiseIntensity) * fastAlpha;
      this.currentDenoiseTemporal += (targetDenoiseTemporal - this.currentDenoiseTemporal) * fastAlpha;
      this.currentDenoiseChroma += (targetDenoiseChroma - this.currentDenoiseChroma) * fastAlpha;

      this.estimatedKelvin = Math.round(5200 * (this.currentWhiteBalance[2] / this.currentWhiteBalance[0]));

      EventBus.getInstance().emit('lighting:changed', this.getCurrentValues(true, currentSceneLuminance));
    }

    // Hardware camera constraint sync (throttled every 3s)
    if (videoTrack && now - this.lastHardwareCheckTime > 3000) {
      this.lastHardwareCheckTime = now;
      this.syncHardwareUvc(videoTrack, this.currentExpGain);
    }

    return this.getCurrentValues(lightingChanged, currentSceneLuminance);
  }

  private syncHardwareUvc(track: MediaStreamTrack, targetGain: number): void {
    if (!track || typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') return;

    try {
      const caps = track.getCapabilities() as any;
      const advanced: any = {};

      if (caps.exposureCompensation) {
        const minComp = caps.exposureCompensation.min || -2;
        const maxComp = caps.exposureCompensation.max || 2;
        const desiredComp = (targetGain - 1.0) * 1.5;
        advanced.exposureCompensation = Math.max(minComp, Math.min(maxComp, desiredComp));
      }

      if (caps.colorTemperature && caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) {
        advanced.whiteBalanceMode = 'continuous';
      }

      if (Object.keys(advanced).length > 0) {
        track.applyConstraints({ advanced: [advanced] }).catch(() => {});
      }
    } catch (e) {
      // Ignore hardware constraint rejection
    }
  }

  private getCurrentValues(lightingChanged: boolean, ambientLum: number): AICalibrationData {
    return {
      exposureGain: this.currentExpGain,
      whiteBalance: this.currentWhiteBalance,
      shadowLift: this.currentShadowLift,
      kelvin: this.estimatedKelvin,
      lightingChanged,
      ambientLuminance: ambientLum,
      autoDenoiseIntensity: this.currentDenoiseIntensity,
      autoDenoiseTemporal: this.currentDenoiseTemporal,
      autoDenoiseChroma: this.currentDenoiseChroma
    };
  }

  private getDefaultValues(): AICalibrationData {
    return {
      exposureGain: 1.0,
      whiteBalance: [1.0, 1.0, 1.0],
      shadowLift: 0.0,
      kelvin: 5500,
      lightingChanged: false,
      ambientLuminance: 0.5,
      autoDenoiseIntensity: 0.75,
      autoDenoiseTemporal: 0.78,
      autoDenoiseChroma: 0.88
    };
  }
}
