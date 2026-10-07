/**
 * AICameraCalibrator - Real-time AI Hardware & Software Calibration
 * Calculates optimal White Balance (Von Kries Chromatic Adaptation),
 * Face-Priority Auto-Exposure (Zone VI skin metering), and Digital ISO / Shadow Lift.
 */

class AICameraCalibrator {
  constructor() {
    this.enabled = true;

    // Fast 16x16 sampling canvas for zero-latency frame analytics
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = 16;
    this.sampleCanvas.height = 16;
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });

    // Target facial skin luminance in studio broadcast standard (Zone VI: 58-62% IRE)
    this.targetFaceLum = 0.58;

    // Filtered internal state with Exponential Moving Average (EMA)
    this.currentExpGain = 1.0;
    this.currentWhiteBalance = [1.0, 1.0, 1.0];
    this.currentShadowLift = 0.0;
    this.estimatedKelvin = 5400;

    // Hardware camera constraint throttling
    this.lastHardwareCheckTime = 0;
    this.hardwareSupported = false;
  }

  /**
   * Main calibration step executed once per frame (or throttled to every 2 frames)
   * @param {HTMLVideoElement|HTMLCanvasElement} sourceElement 
   * @param {Array} landmarks - MediaPipe 468 facial landmarks
   * @param {MediaStreamTrack} videoTrack - WebRTC video track for hardware UVC
   * @returns {Object} calibration parameters
   */
  update(sourceElement, landmarks, videoTrack) {
    if (!this.enabled || !sourceElement) {
      return {
        exposureGain: 1.0,
        whiteBalance: [1.0, 1.0, 1.0],
        shadowLift: 0.0,
        kelvin: 5500
      };
    }

    const videoW = sourceElement.videoWidth || sourceElement.width;
    const videoH = sourceElement.videoHeight || sourceElement.height;
    if (!videoW || !videoH) return this.getValues();

    // 1. Determine facial sampling bounding box
    let sx = videoW * 0.25;
    let sy = videoH * 0.20;
    let sw = videoW * 0.50;
    let sh = videoH * 0.50;

    if (landmarks && landmarks.length > 0) {
      let minX = 1.0, maxX = 0.0, minY = 1.0, maxY = 0.0;
      // Sample key skin landmarks: forehead (10), cheeks (234, 454), nose (168), chin (152)
      const keyIndices = [10, 234, 454, 168, 152, 116, 345, 1, 4];
      for (let i = 0; i < keyIndices.length; i++) {
        const pt = landmarks[keyIndices[i]];
        if (pt) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }
      }

      // Add safety padding around face center
      const padW = (maxX - minX) * 0.20;
      const padH = (maxY - minY) * 0.20;
      minX = Math.max(0.05, minX - padW);
      maxX = Math.min(0.95, maxX + padW);
      minY = Math.max(0.05, minY - padH);
      maxY = Math.min(0.95, maxY + padH);

      sx = minX * videoW;
      sy = minY * videoH;
      sw = (maxX - minX) * videoW;
      sh = (maxY - minY) * videoH;
    }

    // 2. Sample 16x16 downscaled skin region
    this.sampleCtx.drawImage(sourceElement, sx, sy, sw, sh, 0, 0, 16, 16);
    let imgData;
    try {
      imgData = this.sampleCtx.getImageData(0, 0, 16, 16).data;
    } catch (e) {
      return this.getValues();
    }

    // Compute average R, G, B and Luminance
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      const r = imgData[i] / 255.0;
      const g = imgData[i + 1] / 255.0;
      const b = imgData[i + 2] / 255.0;
      
      // Filter out extreme highlights (specular reflections) or pitch blacks
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 0.08 && lum < 0.95) {
        sumR += r;
        sumG += g;
        sumB += b;
        count++;
      }
    }

    if (count < 20) return this.getValues();

    const avgR = sumR / count;
    const avgG = sumG / count;
    const avgB = sumB / count;
    const faceLum = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;

    // ----------------------------------------------------
    // A. AI FACE-PRIORITY AUTO EXPOSURE
    // ----------------------------------------------------
    // Computes digital exposure multiplier to place skin at studio Zone VI (~0.58)
    const targetExposure = Math.min(1.85, Math.max(0.85, this.targetFaceLum / Math.max(0.18, faceLum)));

    // Shadow lift / digital ISO curve when face is underexposed relative to room
    const targetShadowLift = Math.min(0.35, Math.max(0.0, (targetExposure - 1.0) * 0.40));

    // ----------------------------------------------------
    // B. AI AUTO WHITE BALANCE (VON KRIES CHROMATIC ADAPTATION)
    // ----------------------------------------------------
    // In neutral D65 studio light, human skin has an average chromaticity ratio:
    // Red/Green ~ 1.28, Blue/Green ~ 0.85
    let targetWbR = 1.0;
    let targetWbG = 1.0;
    let targetWbB = 1.0;

    if (avgG > 0.05) {
      const currentRG = avgR / avgG;
      const currentBG = avgB / avgG;

      // Correct cold/blue or warm/yellow color casts
      const idealRG = 1.26;
      const idealBG = 0.86;

      targetWbR = Math.min(1.30, Math.max(0.80, idealRG / Math.max(0.5, currentRG)));
      targetWbB = Math.min(1.45, Math.max(0.75, idealBG / Math.max(0.4, currentBG)));
      targetWbG = 1.0;

      // Normalize vector so luminance is preserved
      const normLum = 0.299 * targetWbR + 0.587 * targetWbG + 0.114 * targetWbB;
      targetWbR /= normLum;
      targetWbG /= normLum;
      targetWbB /= normLum;
    }

    // ----------------------------------------------------
    // C. SMOOTH EXPONENTIAL MOVING AVERAGE (EMA)
    // ----------------------------------------------------
    const alpha = 0.06; // Smooth cinematic transition over ~0.5s
    this.currentExpGain += (targetExposure - this.currentExpGain) * alpha;
    this.currentShadowLift += (targetShadowLift - this.currentShadowLift) * alpha;
    this.currentWhiteBalance[0] += (targetWbR - this.currentWhiteBalance[0]) * alpha;
    this.currentWhiteBalance[1] += (targetWbG - this.currentWhiteBalance[1]) * alpha;
    this.currentWhiteBalance[2] += (targetWbB - this.currentWhiteBalance[2]) * alpha;

    // Estimate Kelvin (approximate color temperature)
    this.estimatedKelvin = Math.round(5200 * (this.currentWhiteBalance[2] / this.currentWhiteBalance[0]));

    // ----------------------------------------------------
    // D. HARDWARE UVC SYNCHRONIZATION (OPTIONAL)
    // ----------------------------------------------------
    const now = performance.now();
    if (videoTrack && now - this.lastHardwareCheckTime > 3000) {
      this.lastHardwareCheckTime = now;
      this.syncHardwareTrack(videoTrack, targetExposure);
    }

    return this.getValues();
  }

  syncHardwareTrack(track, targetGain) {
    if (!track || typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') return;

    try {
      const caps = track.getCapabilities();
      const advanced = {};

      // If hardware supports exposureCompensation, apply gentle compensation
      if (caps.exposureCompensation) {
        const minComp = caps.exposureCompensation.min || -2;
        const maxComp = caps.exposureCompensation.max || 2;
        const desiredComp = (targetGain - 1.0) * 1.5;
        advanced.exposureCompensation = Math.max(minComp, Math.min(maxComp, desiredComp));
      }

      // If hardware supports colorTemperature, ensure it's in continuous or balanced
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

  getValues() {
    return {
      exposureGain: this.currentExpGain,
      whiteBalance: this.currentWhiteBalance,
      shadowLift: this.currentShadowLift,
      kelvin: this.estimatedKelvin
    };
  }
}

window.AICameraCalibrator = AICameraCalibrator;
