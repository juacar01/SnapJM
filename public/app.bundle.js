"use strict";
(() => {
  // src/services/camera/camera.service.ts
  var CameraService = class {
    currentStream = null;
    resolutionsCache = /* @__PURE__ */ new Map();
    async enumerateDevices() {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === "videoinput");
    }
    detectCapabilities(track) {
      const deviceId = track.getSettings ? track.getSettings().deviceId || "default" : "default";
      if (this.resolutionsCache.has(deviceId)) {
        return this.resolutionsCache.get(deviceId);
      }
      const candidateResolutions = [
        { w: 3840, h: 2160, label: "4K UHD (3840 \xD7 2160) [16:9]" },
        { w: 2560, h: 1440, label: "2K QHD (2560 \xD7 1440) [16:9]" },
        { w: 1920, h: 1080, label: "1080p Full HD (1920 \xD7 1080) [16:9]" },
        { w: 1600, h: 1200, label: "UXGA (1600 \xD7 1200) [4:3]" },
        { w: 1600, h: 900, label: "HD+ (1600 \xD7 900) [16:9]" },
        { w: 1440, h: 900, label: "WXGA+ (1440 \xD7 900) [16:10]" },
        { w: 1366, h: 768, label: "HD (1366 \xD7 768) [16:9]" },
        { w: 1280, h: 960, label: "SXGA (1280 \xD7 960) [4:3]" },
        { w: 1280, h: 720, label: "720p HD (1280 \xD7 720) [16:9]" },
        { w: 1024, h: 768, label: "XGA (1024 \xD7 768) [4:3]" },
        { w: 960, h: 540, label: "qHD (960 \xD7 540) [16:9]" },
        { w: 848, h: 480, label: "WVGA (848 \xD7 480) [16:9]" },
        { w: 800, h: 600, label: "SVGA (800 \xD7 600) [4:3]" },
        { w: 640, h: 480, label: "VGA (640 \xD7 480) [4:3]" }
      ];
      let maxW = 3840;
      let maxH = 2160;
      let minW = 160;
      let minH = 120;
      let maxFps = 60;
      const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() : null;
      if (caps) {
        if (caps.width && caps.width.max) maxW = caps.width.max;
        if (caps.width && caps.width.min) minW = caps.width.min;
        if (caps.height && caps.height.max) maxH = caps.height.max;
        if (caps.height && caps.height.min) minH = caps.height.min;
        if (caps.frameRate && caps.frameRate.max) maxFps = Math.round(caps.frameRate.max);
      }
      const currentSettings = typeof track.getSettings === "function" ? track.getSettings() : null;
      const initialW = currentSettings ? currentSettings.width : 1280;
      const initialH = currentSettings ? currentSettings.height : 720;
      const filtered = candidateResolutions.filter((c) => c.w <= maxW && c.h <= maxH && c.w >= minW && c.h >= minH);
      if (initialW && initialH && !filtered.some((v) => v.w === initialW && v.h === initialH)) {
        filtered.push({
          w: initialW,
          h: initialH,
          label: `${initialW} \xD7 ${initialH} (Nativa)`
        });
      }
      filtered.sort((a, b) => b.w * b.h - a.w * a.h);
      const resolutions = filtered.map((c) => ({
        value: `${c.w}x${c.h}`,
        width: c.w,
        height: c.h,
        label: c.label
      }));
      const info = {
        deviceId,
        label: track.label || "Webcam",
        resolutions,
        maxFps,
        maxW,
        maxH
      };
      this.resolutionsCache.set(deviceId, info);
      return info;
    }
    async startStream(deviceId, targetResolution, targetFps = 60) {
      this.stopStream();
      await new Promise((r) => setTimeout(r, 80));
      let targetW = 1920;
      let targetH = 1080;
      if (targetResolution) {
        const parts = targetResolution.split("x").map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          targetW = parts[0];
          targetH = parts[1];
        }
      }
      const videoConstraints = {
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
        console.warn("[CameraService] Retry 1 (without min constraint):", errFallback);
        try {
          this.currentStream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: deviceId ? { exact: deviceId } : void 0,
              width: { ideal: targetW },
              height: { ideal: targetH },
              frameRate: { ideal: targetFps }
            },
            audio: true
          });
        } catch (errNoExact) {
          console.warn("[CameraService] Retry 2 (ideal deviceId and video-only):", errNoExact);
          try {
            this.currentStream = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: deviceId ? { ideal: deviceId } : void 0,
                width: { ideal: targetW },
                height: { ideal: targetH },
                frameRate: { ideal: targetFps }
              },
              audio: false
            });
          } catch (errFinal) {
            console.warn("[CameraService] Fallback to any default video device:", errFinal);
            this.currentStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false
            });
          }
        }
      }
      return this.currentStream;
    }
    stopStream() {
      if (this.currentStream) {
        this.currentStream.getTracks().forEach((t) => t.stop());
        this.currentStream = null;
      }
    }
    getCurrentStream() {
      return this.currentStream;
    }
    getCurrentTrack() {
      if (!this.currentStream) return null;
      const tracks = this.currentStream.getVideoTracks();
      return tracks.length > 0 ? tracks[0] : null;
    }
    async applyHardwareConstraints(constraints) {
      const track = this.getCurrentTrack();
      if (!track || typeof track.applyConstraints !== "function") return false;
      try {
        await track.applyConstraints(constraints);
        return true;
      } catch (err) {
        console.warn("[CameraService] Hardware constraints rejected:", err);
        return false;
      }
    }
  };

  // src/services/tracking/face-tracker.service.ts
  var FaceTrackerService = class {
    faceLandmarker = null;
    isLoaded = false;
    isLoading = false;
    lastDetection = null;
    hasFace = false;
    // Mask Canvas (Uploaded to WebGL Texture Unit 1)
    maskCanvas;
    maskCtx;
    // Decoupled probe canvas (480x270) to prevent 1440p ML bottleneck
    probeCanvas;
    probeCtx;
    isDetecting = false;
    lastDetectionTimestamp = 0;
    // Facial Landmark Indices (MediaPipe Mesh)
    innerMouthIndices = [
      78,
      191,
      80,
      81,
      82,
      13,
      312,
      311,
      310,
      415,
      308,
      324,
      318,
      402,
      317,
      14,
      87,
      178,
      88,
      95
    ];
    leftEyeIndices = [
      33,
      7,
      163,
      144,
      145,
      153,
      154,
      155,
      133,
      173,
      157,
      158,
      159,
      160,
      161,
      246
    ];
    rightEyeIndices = [
      362,
      382,
      381,
      380,
      374,
      373,
      390,
      249,
      263,
      466,
      388,
      387,
      386,
      385,
      384,
      398
    ];
    faceOvalIndices = [
      10,
      338,
      297,
      332,
      284,
      251,
      389,
      356,
      454,
      323,
      361,
      288,
      397,
      365,
      379,
      378,
      400,
      377,
      152,
      148,
      176,
      149,
      150,
      136,
      172,
      58,
      132,
      93,
      234,
      127,
      162,
      21,
      54,
      103,
      67,
      109
    ];
    // Under-eye bags & dark circles landmarks
    leftEyeBagIndices = [
      33,
      7,
      163,
      144,
      145,
      153,
      154,
      155,
      133,
      111,
      116,
      123,
      147,
      213,
      192,
      207,
      205,
      50,
      101,
      118,
      119,
      100,
      36,
      203
    ];
    rightEyeBagIndices = [
      362,
      382,
      381,
      380,
      374,
      373,
      390,
      249,
      263,
      340,
      345,
      352,
      376,
      433,
      416,
      427,
      425,
      280,
      330,
      347,
      348,
      329,
      266,
      423
    ];
    constructor() {
      this.maskCanvas = document.createElement("canvas");
      this.maskCtx = this.maskCanvas.getContext("2d", { willReadFrequently: false });
      this.probeCanvas = document.createElement("canvas");
      this.probeCanvas.width = 480;
      this.probeCanvas.height = 270;
      this.probeCtx = this.probeCanvas.getContext("2d", { willReadFrequently: false });
    }
    async initialize() {
      if (this.isLoaded || this.isLoading) return this.isLoaded;
      this.isLoading = true;
      try {
        if (typeof window.Vision === "undefined") {
          console.warn("[FaceTrackerService] window.Vision not loaded yet, retrying in 300ms...");
          await new Promise((r) => setTimeout(r, 300));
          return this.initialize();
        }
        console.log("[FaceTrackerService] Initializing MediaPipe FaceLandmarker with GPU delegate...");
        const filesetResolver = await window.Vision.FilesetResolver.forVisionTasks("../public/wasm");
        this.faceLandmarker = await window.Vision.FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "../public/models/face_landmarker.task",
            delegate: "GPU"
          },
          outputFaceBlendshapes: false,
          runningMode: "VIDEO",
          numFaces: 1
        });
        this.isLoaded = true;
        this.isLoading = false;
        console.log("[FaceTrackerService] FaceLandmarker initialized successfully at 60 FPS!");
        return true;
      } catch (err) {
        console.warn("[FaceTrackerService] GPU delegate failed, falling back to CPU...", err);
        try {
          const filesetResolver = await window.Vision.FilesetResolver.forVisionTasks("../public/wasm");
          this.faceLandmarker = await window.Vision.FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
              modelAssetPath: "../public/models/face_landmarker.task",
              delegate: "CPU"
            },
            outputFaceBlendshapes: false,
            runningMode: "VIDEO",
            numFaces: 1
          });
          this.isLoaded = true;
          this.isLoading = false;
          console.log("[FaceTrackerService] FaceLandmarker initialized on CPU fallback.");
          return true;
        } catch (cpuErr) {
          console.error("[FaceTrackerService] Failed to initialize FaceLandmarker:", cpuErr);
          this.isLoading = false;
          return false;
        }
      }
    }
    isReady() {
      return this.isLoaded && this.faceLandmarker !== null;
    }
    /**
     * High performance update: downsamples full 1440p/1080p frame to 480x270 probe,
     * keeping inference time under 3.5ms so main render thread stays at 60 FPS.
     */
    update(sourceElement, timestamp) {
      if (!this.isLoaded || !this.faceLandmarker || !sourceElement) {
        return { hasFace: false, landmarks: null, maskCanvas: null };
      }
      const readyCheck = sourceElement.readyState;
      if (typeof readyCheck === "number" && readyCheck < 2) {
        return { hasFace: false, landmarks: null, maskCanvas: null };
      }
      const width = sourceElement instanceof HTMLVideoElement ? sourceElement.videoWidth : sourceElement.width;
      const height = sourceElement instanceof HTMLVideoElement ? sourceElement.videoHeight : sourceElement.height;
      if (!width || !height) return { hasFace: false, landmarks: null, maskCanvas: null };
      if (!this.isDetecting && timestamp - this.lastDetectionTimestamp >= 24) {
        this.isDetecting = true;
        this.lastDetectionTimestamp = timestamp;
        try {
          this.probeCtx.drawImage(sourceElement, 0, 0, 480, 270);
          const results = this.faceLandmarker.detectForVideo(this.probeCanvas, timestamp);
          if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
            this.lastDetection = results.faceLandmarks[0];
            this.hasFace = true;
            this.renderMaskTexture(width, height, this.lastDetection);
          } else {
            this.hasFace = false;
            this.renderEmptyMask(width, height);
          }
        } catch (e) {
        } finally {
          this.isDetecting = false;
        }
      }
      return {
        hasFace: this.hasFace,
        landmarks: this.lastDetection,
        maskCanvas: this.maskCanvas
      };
    }
    renderMaskTexture(width, height, landmarks) {
      if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
        this.maskCanvas.width = width;
        this.maskCanvas.height = height;
      }
      const ctx = this.maskCtx;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      if (!landmarks || landmarks.length === 0) return;
      ctx.save();
      ctx.filter = "blur(16px)";
      ctx.fillStyle = "rgba(255, 0, 0, 1.0)";
      ctx.beginPath();
      const firstOval = landmarks[this.faceOvalIndices[0]];
      ctx.moveTo(firstOval.x * width, firstOval.y * height);
      for (let i = 1; i < this.faceOvalIndices.length; i++) {
        const pt = landmarks[this.faceOvalIndices[i]];
        ctx.lineTo(pt.x * width, pt.y * height);
      }
      ctx.closePath();
      ctx.fill();
      ctx.filter = "none";
      ctx.globalCompositeOperation = "destination-out";
      this.drawPolygon(ctx, landmarks, this.leftEyeIndices, width, height);
      ctx.fill();
      this.drawPolygon(ctx, landmarks, this.rightEyeIndices, width, height);
      ctx.fill();
      this.drawPolygon(ctx, landmarks, this.innerMouthIndices, width, height);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.filter = "blur(10px)";
      ctx.fillStyle = "rgba(255, 255, 0, 1.0)";
      this.drawPolygon(ctx, landmarks, this.leftEyeBagIndices, width, height);
      ctx.fill();
      this.drawPolygon(ctx, landmarks, this.rightEyeBagIndices, width, height);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0, 255, 0, 1.0)";
      this.drawPolygon(ctx, landmarks, this.innerMouthIndices, width, height);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0, 0, 255, 1.0)";
      this.drawPolygon(ctx, landmarks, this.leftEyeIndices, width, height);
      ctx.fill();
      this.drawPolygon(ctx, landmarks, this.rightEyeIndices, width, height);
      ctx.fill();
      ctx.restore();
    }
    drawPolygon(ctx, landmarks, indices, width, height) {
      ctx.beginPath();
      const first = landmarks[indices[0]];
      ctx.moveTo(first.x * width, first.y * height);
      for (let i = 1; i < indices.length; i++) {
        const pt = landmarks[indices[i]];
        ctx.lineTo(pt.x * width, pt.y * height);
      }
      ctx.closePath();
    }
    renderEmptyMask(width, height) {
      if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
        this.maskCanvas.width = width;
        this.maskCanvas.height = height;
      }
      this.maskCtx.fillStyle = "#000000";
      this.maskCtx.fillRect(0, 0, width, height);
    }
    dispose() {
      if (this.faceLandmarker) {
        try {
          this.faceLandmarker.close();
        } catch (e) {
        }
        this.faceLandmarker = null;
      }
      this.isLoaded = false;
    }
  };

  // src/core/event-bus.ts
  var EventBus = class _EventBus {
    static instance;
    listeners = /* @__PURE__ */ new Map();
    static getInstance() {
      if (!_EventBus.instance) {
        _EventBus.instance = new _EventBus();
      }
      return _EventBus.instance;
    }
    on(event, handler) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, /* @__PURE__ */ new Set());
      }
      this.listeners.get(event).add(handler);
      return () => {
        this.off(event, handler);
      };
    }
    off(event, handler) {
      const handlers = this.listeners.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    }
    emit(event, data) {
      const handlers = this.listeners.get(event);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(data);
          } catch (err) {
            console.error(`[EventBus] Error in handler for event "${event}":`, err);
          }
        });
      }
    }
  };

  // src/services/calibration/ai-calibrator.service.ts
  var AICalibratorService = class {
    enabled = true;
    // Ultra-fast 16x16 offscreen probe for lighting analytics
    sampleCanvas;
    sampleCtx;
    // Target facial luminance in studio broadcast standard (Zone VI: 58-62% IRE)
    targetFaceLum = 0.58;
    // Lighting change detection threshold with hysteresis & debounce
    lightingChangeThreshold = 0.085;
    // 8.5% luminance delta triggers recalibration
    chromaChangeThreshold = 0.12;
    // Significant color cast shift
    kelvinHysteresis = 250;
    // ±250K color temperature dead zone
    cooldownMs = 1500;
    // 1.5s cooldown between automatic recalibrations
    lastRecalibrateTimestamp = 0;
    previousSceneLuminance = 0.5;
    previousChromaRG = 1.25;
    // Smoothed internal parameters (Exponential Moving Average)
    currentExpGain = 1;
    currentWhiteBalance = [1, 1, 1];
    currentShadowLift = 0;
    estimatedKelvin = 5400;
    // Step 2: Auto Denoise parameters reactive to ambient lighting and sensor gain
    currentDenoiseIntensity = 0.75;
    currentDenoiseTemporal = 0.78;
    currentDenoiseChroma = 0.88;
    lastHardwareCheckTime = 0;
    forceRecalibrateFlag = true;
    constructor() {
      this.sampleCanvas = document.createElement("canvas");
      this.sampleCanvas.width = 16;
      this.sampleCanvas.height = 16;
      this.sampleCtx = this.sampleCanvas.getContext("2d", { willReadFrequently: true });
    }
    isEnabled() {
      return this.enabled;
    }
    setEnabled(enabled) {
      this.enabled = enabled;
    }
    forceRecalibrate() {
      this.forceRecalibrateFlag = true;
    }
    update(sourceElement, landmarks, videoTrack) {
      if (!this.enabled || !sourceElement) {
        return this.getDefaultValues();
      }
      const videoW = sourceElement instanceof HTMLVideoElement ? sourceElement.videoWidth : sourceElement.width;
      const videoH = sourceElement instanceof HTMLVideoElement ? sourceElement.videoHeight : sourceElement.height;
      if (!videoW || !videoH) return this.getCurrentValues(false, this.previousSceneLuminance);
      let sx = videoW * 0.25;
      let sy = videoH * 0.2;
      let sw = videoW * 0.5;
      let sh = videoH * 0.5;
      if (landmarks && landmarks.length > 0) {
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
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
      this.sampleCtx.drawImage(sourceElement, sx, sy, sw, sh, 0, 0, 16, 16);
      let imgData;
      try {
        imgData = this.sampleCtx.getImageData(0, 0, 16, 16).data;
      } catch (e) {
        return this.getCurrentValues(false, this.previousSceneLuminance);
      }
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i] / 255;
        const g = imgData[i + 1] / 255;
        const b = imgData[i + 2] / 255;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
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
      const now = performance.now();
      const lumDelta = Math.abs(currentSceneLuminance - this.previousSceneLuminance);
      const chromaDelta = Math.abs(currentChromaRG - this.previousChromaRG);
      const potentialKelvin = Math.round(5200 * (avgB / Math.max(0.01, avgG) / Math.max(0.01, currentChromaRG)));
      const kelvinDelta = Math.abs(potentialKelvin - this.estimatedKelvin);
      const isCooldownElapsed = now - this.lastRecalibrateTimestamp >= this.cooldownMs;
      const isSignificantChange = lumDelta >= this.lightingChangeThreshold || chromaDelta >= this.chromaChangeThreshold && kelvinDelta >= this.kelvinHysteresis;
      const lightingChanged = this.forceRecalibrateFlag || isCooldownElapsed && isSignificantChange;
      if (lightingChanged) {
        this.lastRecalibrateTimestamp = now;
        this.previousSceneLuminance = currentSceneLuminance;
        this.previousChromaRG = currentChromaRG;
        this.forceRecalibrateFlag = false;
        const targetExposure = Math.min(1.4, Math.max(0.9, 0.53 / Math.max(0.22, currentSceneLuminance)));
        const targetShadowLift = Math.min(0.2, Math.max(0, (targetExposure - 1) * 0.25));
        let targetWbR = 1;
        let targetWbG = 1;
        let targetWbB = 1;
        if (avgG > 0.05) {
          const currentBG = avgB / avgG;
          const idealRG = 1.22;
          const idealBG = 0.88;
          targetWbR = Math.min(1.18, Math.max(0.88, idealRG / Math.max(0.6, currentChromaRG)));
          targetWbB = Math.min(1.22, Math.max(0.82, idealBG / Math.max(0.5, currentBG)));
          targetWbG = 1;
          const normLum = 0.299 * targetWbR + 0.587 * targetWbG + 0.114 * targetWbB;
          targetWbR /= normLum;
          targetWbG /= normLum;
          targetWbB /= normLum;
        }
        const noiseLevel = Math.min(1, Math.max(
          0,
          (1 - currentSceneLuminance) * 0.7 + (targetExposure - 1) * 0.55 + targetShadowLift * 0.8
        ));
        const targetDenoiseIntensity = Math.min(0.95, Math.max(0.35, 0.4 + noiseLevel * 0.55));
        const targetDenoiseTemporal = Math.min(0.9, Math.max(0.55, 0.55 + noiseLevel * 0.35));
        const targetDenoiseChroma = Math.min(0.98, Math.max(0.5, 0.52 + noiseLevel * 0.46));
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
        EventBus.getInstance().emit("lighting:changed", this.getCurrentValues(true, currentSceneLuminance));
      }
      if (videoTrack && now - this.lastHardwareCheckTime > 3e3) {
        this.lastHardwareCheckTime = now;
        this.syncHardwareUvc(videoTrack, this.currentExpGain);
      }
      return this.getCurrentValues(lightingChanged, currentSceneLuminance);
    }
    syncHardwareUvc(track, targetGain) {
      if (!track || typeof track.getCapabilities !== "function" || typeof track.applyConstraints !== "function") return;
      try {
        const caps = track.getCapabilities();
        const advanced = {};
        if (caps.exposureCompensation) {
          const minComp = caps.exposureCompensation.min || -2;
          const maxComp = caps.exposureCompensation.max || 2;
          const desiredComp = (targetGain - 1) * 1.5;
          advanced.exposureCompensation = Math.max(minComp, Math.min(maxComp, desiredComp));
        }
        if (caps.colorTemperature && caps.whiteBalanceMode && caps.whiteBalanceMode.includes("continuous")) {
          advanced.whiteBalanceMode = "continuous";
        }
        if (Object.keys(advanced).length > 0) {
          track.applyConstraints({ advanced: [advanced] }).catch(() => {
          });
        }
      } catch (e) {
      }
    }
    getCurrentValues(lightingChanged, ambientLum) {
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
    getDefaultValues() {
      return {
        exposureGain: 1,
        whiteBalance: [1, 1, 1],
        shadowLift: 0,
        kelvin: 5500,
        lightingChanged: false,
        ambientLuminance: 0.5,
        autoDenoiseIntensity: 0.75,
        autoDenoiseTemporal: 0.78,
        autoDenoiseChroma: 0.88
      };
    }
  };

  // src/services/rendering/beauty-engine.service.ts
  var BeautyEngineService = class {
    canvas;
    gl = null;
    program = null;
    cameraTexture = null;
    maskTexture = null;
    uLoc = {};
    params = {
      denoiseEnabled: true,
      denoiseAuto: true,
      denoiseIntensity: 0.65,
      denoiseTemporal: 0.75,
      denoiseChroma: 0.8,
      smoothIntensity: 0.5,
      smoothRadius: 3.5,
      edgeThreshold: 0.14,
      uniformity: 0.5,
      antiRedness: 0.6,
      skinToneTint: 0.5,
      sharpen: 0.25,
      teethWhitening: 0.35,
      teethBrightness: 0.06,
      eyeBrightening: 0.25,
      concealer: 0.5,
      brightness: 0,
      contrast: 1.02,
      saturation: 1.02,
      temperature: 0,
      glow: 0,
      vignette: 0,
      mirror: true,
      splitPosition: -1,
      bypass: false
    };
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl", {
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        antialias: false,
        powerPreference: "high-performance"
      });
      if (!this.gl) {
        console.error("[BeautyEngineService] WebGL not supported!");
        return;
      }
      this.initGL();
    }
    initGL() {
      const gl = this.gl;
      const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      uniform int u_mirror;

      void main() {
        vec2 uv = (a_position + 1.0) * 0.5;
        if (u_mirror == 1) {
          uv.x = 1.0 - uv.x;
        }
        v_texCoord = uv;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;
      const fsSource = `
      precision highp float;
      uniform sampler2D u_cameraTexture;
      uniform sampler2D u_maskTexture;
      uniform vec2 u_resolution;

      // ====================================================
      // UNIFORMS: PASO 1 - CALIBRACION DE BASE (ISO, AWB, EXPOSICION)
      // ====================================================
      uniform vec3 u_aiWhiteBalance;
      uniform float u_aiExposureGain;
      uniform float u_aiShadowLift;

      // ====================================================
      // UNIFORMS: PASO 2 - FILTRO DE RUIDO AUTOMATICO
      // ====================================================
      uniform int u_denoiseAuto;
      uniform float u_aiDenoiseIntensity;
      uniform float u_aiDenoiseTemporal;
      uniform float u_aiDenoiseChroma;
      uniform float u_denoiseIntensity;
      uniform float u_denoiseTemporal;
      uniform float u_denoiseChroma;

      // ====================================================
      // UNIFORMS: PASO 3 - FILTROS DE BELLEZA AR & COLOR
      // ====================================================
      uniform float u_smoothIntensity;
      uniform float u_smoothRadius;
      uniform float u_edgeThreshold;

      uniform float u_uniformity;
      uniform float u_antiRedness;
      uniform float u_skinToneTint;
      uniform float u_sharpen;

      uniform float u_teethWhitening;
      uniform float u_teethBrightness;
      uniform float u_eyeBrightening;
      uniform float u_concealer;

      uniform float u_brightness;
      uniform float u_contrast;
      uniform float u_saturation;
      uniform float u_temperature;
      uniform float u_glow;
      uniform float u_vignette;

      // Controls
      uniform float u_splitPosition;
      uniform int u_bypass;
      uniform int u_mirror;

      varying vec2 v_texCoord;

      // ====================================================
      // PASO 1 HELPER: CALIBRACION BASE (ISO, White Balance, Exposure)
      // ====================================================
      vec3 calibrateBase(vec3 rgb) {
        // 1. Balance de Blancos Von Kries
        rgb = clamp(rgb * u_aiWhiteBalance, 0.0, 1.0);

        // 2. ISO Digital (Shadow Lift) y Compensacion de Exposicion Facial
        if (abs(u_aiExposureGain - 1.0) > 0.005 || u_aiShadowLift > 0.005) {
          float lumRaw = dot(rgb, vec3(0.299, 0.587, 0.114));
          float shadowWeight = clamp(1.0 - lumRaw * 1.7, 0.0, 1.0);
          rgb += rgb * shadowWeight * u_aiShadowLift;

          rgb = (rgb * u_aiExposureGain) / (vec3(1.0) + rgb * max(0.0, u_aiExposureGain - 1.0) * 0.28);
          rgb = clamp(rgb, 0.0, 1.0);
        }
        return rgb;
      }

      vec3 sampleCalibrated(vec2 coord) {
        return calibrateBase(texture2D(u_cameraTexture, coord).rgb);
      }

      float getSkinWeight(vec3 rgb) {
        float cb = -0.16874 * rgb.r - 0.33126 * rgb.g + 0.50000 * rgb.b + 0.5;
        float cr =  0.50000 * rgb.r - 0.41869 * rgb.g - 0.08131 * rgb.b + 0.5;
        
        bool isSkinCandidate = (rgb.r > rgb.b * 0.90) && (rgb.r > 0.12) && (cr > 0.47 && cr < 0.74) && (cb > 0.27 && cb < 0.60);
        if (!isSkinCandidate) return 0.0;
        
        float dCr = (cr - 0.58) / 0.11;
        float dCb = (cb - 0.43) / 0.11;
        return clamp(exp(-(dCr * dCr + dCb * dCb) * 0.6) * 1.30, 0.0, 1.0);
      }

      // ====================================================
      // PASO 2 HELPER: FILTRO DE RUIDO MULTI-ESCALA SOBRE MUESTRAS CALIBRADAS
      // ====================================================
      vec3 applyAIDenoise(vec2 uv, vec3 curCol, float intensity, float fineGrainPower, float chromaPower) {
        if (intensity <= 0.01) return curCol;

        vec2 texel = 1.0 / u_resolution;
        float rInner = 1.2 + intensity * 0.8;
        float rOuter = 2.8 + intensity * 2.2;

        vec3 c = curCol;

        // Sample neighboring pixels already calibrated through Step 1
        vec3 inN  = sampleCalibrated(uv + vec2( 0.0, -1.0) * rInner * texel);
        vec3 inS  = sampleCalibrated(uv + vec2( 0.0,  1.0) * rInner * texel);
        vec3 inE  = sampleCalibrated(uv + vec2( 1.0,  0.0) * rInner * texel);
        vec3 inW  = sampleCalibrated(uv + vec2(-1.0,  0.0) * rInner * texel);
        vec3 inNE = sampleCalibrated(uv + vec2( 0.707, -0.707) * rInner * texel);
        vec3 inNW = sampleCalibrated(uv + vec2(-0.707, -0.707) * rInner * texel);
        vec3 inSE = sampleCalibrated(uv + vec2( 0.707,  0.707) * rInner * texel);
        vec3 inSW = sampleCalibrated(uv + vec2(-0.707,  0.707) * rInner * texel);

        vec3 outN  = sampleCalibrated(uv + vec2( 0.0, -1.0) * rOuter * texel);
        vec3 outS  = sampleCalibrated(uv + vec2( 0.0,  1.0) * rOuter * texel);
        vec3 outE  = sampleCalibrated(uv + vec2( 1.0,  0.0) * rOuter * texel);
        vec3 outW  = sampleCalibrated(uv + vec2(-1.0,  0.0) * rOuter * texel);
        vec3 outNE = sampleCalibrated(uv + vec2( 0.707, -0.707) * rOuter * texel);
        vec3 outNW = sampleCalibrated(uv + vec2(-0.707, -0.707) * rOuter * texel);
        vec3 outSE = sampleCalibrated(uv + vec2( 0.707,  0.707) * rOuter * texel);
        vec3 outSW = sampleCalibrated(uv + vec2(-0.707,  0.707) * rOuter * texel);

        const vec3 lumaWeight = vec3(0.299, 0.587, 0.114);
        float lumC = dot(c, lumaWeight);

        float gradX = abs(dot(inE, lumaWeight) - dot(inW, lumaWeight)) + 0.5 * abs(dot(outE, lumaWeight) - dot(outW, lumaWeight));
        float gradY = abs(dot(inS, lumaWeight) - dot(inN, lumaWeight)) + 0.5 * abs(dot(outS, lumaWeight) - dot(outN, lumaWeight));
        float edgeStrength = gradX + gradY;

        float sigmaRange = 0.08 + (1.0 - intensity) * 0.04;
        float twoSigmaSq = 2.0 * sigmaRange * sigmaRange;

        float wSum = 1.0;
        vec3 colSum = c * 1.0;

        float lumDiff, w;
        lumDiff = dot(inN, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq); colSum += inN * w; wSum += w;
        lumDiff = dot(inS, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq); colSum += inS * w; wSum += w;
        lumDiff = dot(inE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq); colSum += inE * w; wSum += w;
        lumDiff = dot(inW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq); colSum += inW * w; wSum += w;
        lumDiff = dot(inNE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * 0.85; colSum += inNE * w; wSum += w;
        lumDiff = dot(inNW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * 0.85; colSum += inNW * w; wSum += w;
        lumDiff = dot(inSE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * 0.85; colSum += inSE * w; wSum += w;
        lumDiff = dot(inSW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * 0.85; colSum += inSW * w; wSum += w;

        float flatConfidence = clamp(1.0 - (edgeStrength * 7.5), 0.0, 1.0);
        float outerWeight = flatConfidence * 0.95;

        lumDiff = dot(outN, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight; colSum += outN * w; wSum += w;
        lumDiff = dot(outS, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight; colSum += outS * w; wSum += w;
        lumDiff = dot(outE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight; colSum += outE * w; wSum += w;
        lumDiff = dot(outW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight; colSum += outW * w; wSum += w;
        lumDiff = dot(outNE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight * 0.75; colSum += outNE * w; wSum += w;
        lumDiff = dot(outNW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight * 0.75; colSum += outNW * w; wSum += w;
        lumDiff = dot(outSE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight * 0.75; colSum += outSE * w; wSum += w;
        lumDiff = dot(outSW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight * 0.75; colSum += outSW * w; wSum += w;

        vec3 bilateralCol = colSum / wSum;

        vec3 meanCol = (c + inN + inS + inE + inW + inNE + inNW + inSE + inSW) * 0.111111;
        vec2 curChroma = vec2(-0.16874 * bilateralCol.r - 0.33126 * bilateralCol.g + 0.50000 * bilateralCol.b,
                               0.50000 * bilateralCol.r - 0.41869 * bilateralCol.g - 0.08131 * bilateralCol.b);
        vec2 meanChroma = vec2(-0.16874 * meanCol.r - 0.33126 * meanCol.g + 0.50000 * meanCol.b,
                                0.50000 * meanCol.r - 0.41869 * meanCol.g - 0.08131 * meanCol.b);

        float chromaCleanFactor = clamp(chromaPower * (intensity * 1.30), 0.0, 0.98);
        vec2 cleanChroma = mix(curChroma, meanChroma, chromaCleanFactor);

        float lumClean = dot(bilateralCol, lumaWeight);
        float rClean = lumClean + 1.40200 * cleanChroma.y;
        float gClean = lumClean - 0.34414 * cleanChroma.x - 0.71414 * cleanChroma.y;
        float bClean = lumClean + 1.77200 * cleanChroma.x;

        vec3 cleanCol = clamp(vec3(rClean, gClean, bClean), 0.0, 1.0);
        float finalBlend = clamp(intensity * (0.85 + flatConfidence * 0.15), 0.0, 1.0);
        return mix(curCol, cleanCol, finalBlend);
      }

      // ====================================================
      // PASO 3 HELPER: SUAVIZADO BILATERAL DE PIEL
      // ====================================================
      vec3 bilateralFilter(vec2 uv, vec3 centerColor, float radius, float edgeThresh) {
        vec2 texel = 1.0 / u_resolution;
        vec3 sumColor = centerColor;
        float sumWeight = 1.0;
        float centerLum = dot(centerColor, vec3(0.299, 0.587, 0.114));

        // Scale radius so it spans across acne blemishes and pores on 720p/1080p webcams
        float effRadius = max(radius * 2.8, 4.0 + u_smoothIntensity * 6.5);
        // Adaptive range threshold: allows smoothing across acne bumps without blurring face borders
        float effEdgeThresh = max(edgeThresh, 0.14 + u_smoothIntensity * 0.16);
        float twoSigmaSq = 2.0 * effEdgeThresh * effEdgeThresh;

        vec2 offsets[12];
        offsets[0]  = vec2( 1.0,  0.0);
        offsets[1]  = vec2(-1.0,  0.0);
        offsets[2]  = vec2( 0.0,  1.0);
        offsets[3]  = vec2( 0.0, -1.0);
        offsets[4]  = vec2( 0.707,  0.707);
        offsets[5]  = vec2(-0.707,  0.707);
        offsets[6]  = vec2( 0.707, -0.707);
        offsets[7]  = vec2(-0.707, -0.707);
        offsets[8]  = vec2( 1.6,  0.7);
        offsets[9]  = vec2(-1.6, -0.7);
        offsets[10] = vec2( 0.7, -1.6);
        offsets[11] = vec2(-0.7,  1.6);

        for (int i = 0; i < 12; i++) {
          vec2 sampleUv = uv + offsets[i] * effRadius * texel;
          vec3 sampleCol = sampleCalibrated(sampleUv);
          float sampleLum = dot(sampleCol, vec3(0.299, 0.587, 0.114));

          float lumDiff = abs(centerLum - sampleLum);
          float rangeWeight = exp(-(lumDiff * lumDiff) / twoSigmaSq);
          
          sumColor += sampleCol * rangeWeight;
          sumWeight += rangeWeight;
        }

        return sumColor / sumWeight;
      }

      void main() {
        vec2 uv = v_texCoord;
        vec2 texUv = vec2(uv.x, 1.0 - uv.y);

        vec3 rawColor = texture2D(u_cameraTexture, texUv).rgb;

        // ====================================================
        // 1. PASO 1: CALCULO DE ISO, BALANCE DE BLANCOS Y EXPOSICION
        // (Automatico y reactivo a cualquier cambio de iluminacion)
        // ====================================================
        vec3 step1Calibrated = calibrateBase(rawColor);

        // Bypass toggle
        if (u_bypass == 1) {
          gl_FragColor = vec4(step1Calibrated, 1.0);
          return;
        }

        // Split-screen comparison line
        if (u_splitPosition >= 0.0) {
          float screenX = uv.x;
          if (abs(screenX - u_splitPosition) < 0.0025) {
            gl_FragColor = vec4(0.0, 0.95, 1.0, 1.0);
            return;
          }
          if (screenX > u_splitPosition) {
            gl_FragColor = vec4(step1Calibrated, 1.0);
            return;
          }
        }

        // ====================================================
        // 2. PASO 2: FILTRO DE RUIDO DE LA IMAGEN
        // (Automatico y recalculado reactivamente con cada cambio de iluminacion)
        // ====================================================
        float effDenoiseInt = (u_denoiseAuto == 1) ? u_aiDenoiseIntensity : u_denoiseIntensity;
        float effDenoiseTemp = (u_denoiseAuto == 1) ? u_aiDenoiseTemporal : u_denoiseTemporal;
        float effDenoiseChroma = (u_denoiseAuto == 1) ? u_aiDenoiseChroma : u_denoiseChroma;

        vec3 step2Denoised = step1Calibrated;
        if (effDenoiseInt > 0.01) {
          step2Denoised = applyAIDenoise(texUv, step1Calibrated, effDenoiseInt, effDenoiseTemp, effDenoiseChroma);
        }

        // ====================================================
        // 3. PASO 3: APLICAR TODOS LOS DEMAS FILTROS DE BELLEZA
        // CON EL RESULTADO DE LOS AJUSTES ANTERIORES (step2Denoised)
        // ====================================================
        vec4 mask = texture2D(u_maskTexture, texUv);
        vec3 color = step2Denoised;

        // 3.1. Deteccion de piel robusta sobre la imagen limpia y calibrada
        float rawSkinProb = getSkinWeight(step2Denoised);
        float skinFactor = (mask.r > 0.05) ? max(mask.r, rawSkinProb * 0.90) : rawSkinProb;
        // Proteger cavidad bucal (R es bajo, G es alto)
        float mouthArea = (mask.r < 0.25) ? mask.g : 0.0;
        skinFactor *= clamp(1.0 - mouthArea * 2.5, 0.0, 1.0);
        // Proteger cuencas oculares (B es alto)
        skinFactor *= clamp(1.0 - mask.b * 1.8, 0.0, 1.0);
        skinFactor = clamp(skinFactor * 1.25, 0.0, 1.0);

        // 3.2. Suavizado de piel con separacion de frecuencias (elimina acne y preserva micro-poros)
        vec3 smoothed = step2Denoised;
        if (skinFactor > 0.02) {
          smoothed = bilateralFilter(texUv, step2Denoised, u_smoothRadius, u_edgeThreshold);
        }

        if (u_smoothIntensity > 0.01 && skinFactor > 0.02) {
          vec3 rawDiff = step2Denoised - smoothed;
          
          // Separacion de frecuencias inteligente:
          // Los poros autenticos tienen desviacion pequena (< 0.022)
          // El acne, granos y espinillas tienen desviacion grande (> 0.04)
          // Al limitar rawDiff a [-0.020, 0.020], se erradica el 90% del relieve de acne y manchas,
          // reteniendo unicamente la textura fina de micro-poro para que no parezca cera/parafina.
          vec3 microPores = clamp(rawDiff, -0.020, 0.020);
          
          // Retencion de micro-poros que decrece suavemente con la intensidad
          float poreRetention = clamp(1.0 - u_smoothIntensity * 0.70, 0.15, 0.85);
          vec3 naturalSkin = smoothed + microPores * poreRetention;
          
          // Mezcla directa y potente: el slider AHORA SI TIENE EFECTO VISIBLE INMEDIATO
          float blendPower = clamp(skinFactor * u_smoothIntensity * 1.15, 0.0, 0.98);
          color = mix(color, naturalSkin, blendPower);
        }

        // 3.3. FILTRO DE BOLSAS DE OJOS & OJERAS (Under-Eye Bags & Dark Circles)
        float eyeAbove = texture2D(u_maskTexture, texUv + vec2(0.0, 0.024)).b;
        float eyeBelow = texture2D(u_maskTexture, texUv - vec2(0.0, 0.024)).b;
        float geomEyeBag = clamp(max(eyeAbove, eyeBelow) * 1.6 - mask.b * 2.5, 0.0, 1.0);
        float polyEyeBag = (mask.r > 0.25 && mask.g > 0.10 && mask.b < 0.35) ? mask.g : 0.0;
        float eyeBagFactor = max(polyEyeBag, geomEyeBag);

        if (u_concealer > 0.01 && eyeBagFactor > 0.02 && skinFactor > 0.04) {
          float bagPower = clamp(eyeBagFactor * u_concealer * 1.25, 0.0, 1.0);
          
          // 1. Suavizar y desvanecer el pliegue / abultamiento de la bolsa con la piel alisada
          color = mix(color, smoothed, clamp(bagPower * 0.88, 0.0, 0.95));
          
          // 2. Aclarar la sombra oscura de la ojera (brighten under-eye shadow)
          float lumEye = dot(color, vec3(0.299, 0.587, 0.114));
          float shadowEye = clamp(1.0 - smoothstep(0.20, 0.70, lumEye), 0.0, 1.0);
          vec3 concealerBright = vec3(1.0, 0.96, 0.92) * (shadowEye * bagPower * 0.16);
          color = clamp(color + concealerBright, 0.0, 1.0);
          
          // 3. Neutralizar tonos viol\xE1ceos / azulados de fatiga
          float yB  =  0.29900 * color.r + 0.58700 * color.g + 0.11400 * color.b;
          float cbB = -0.16874 * color.r - 0.33126 * color.g + 0.50000 * color.b + 0.5;
          float crB =  0.50000 * color.r - 0.41869 * color.g - 0.08131 * color.b + 0.5;
          if (cbB > 0.49) {
            cbB = mix(cbB, 0.49, clamp(bagPower * 0.75, 0.0, 0.85));
            float rOutB = yB + 1.40200 * (crB - 0.5);
            float gOutB = yB - 0.34414 * (cbB - 0.5) - 0.71414 * (crB - 0.5);
            float bOutB = yB + 1.77200 * (cbB - 0.5);
            color = clamp(vec3(rOutB, gOutB, bOutB), 0.0, 1.0);
          }
        }

        // 3.4. Uniformidad de tono de piel y anti-rojeces (elimina rojeces de acne y empareja manchas)
        if ((u_uniformity > 0.01 || u_antiRedness > 0.01) && skinFactor > 0.04) {
          float y  =  0.29900 * color.r + 0.58700 * color.g + 0.11400 * color.b;
          float cb = -0.16874 * color.r - 0.33126 * color.g + 0.50000 * color.b + 0.5;
          float cr =  0.50000 * color.r - 0.41869 * color.g - 0.08131 * color.b + 0.5;

          float cbSmooth = -0.16874 * smoothed.r - 0.33126 * smoothed.g + 0.50000 * smoothed.b + 0.5;
          float crSmooth =  0.50000 * smoothed.r - 0.41869 * smoothed.g - 0.08131 * smoothed.b + 0.5;

          // Correccion de rojeces (Anti-Acne / Anti-Inflamacion):
          if (u_antiRedness > 0.01) {
            float redExcess = cr - crSmooth;
            if (redExcess > 0.005) {
              cr = mix(cr, crSmooth, clamp(u_antiRedness * 1.50 * skinFactor, 0.0, 0.95));
            }
          }

          // Uniformidad de tono: empareja diferencias cromaticas de manchas y sombras
          if (u_uniformity > 0.01) {
            float uniBlend = clamp(u_uniformity * skinFactor * 1.15, 0.0, 0.95);
            cb = mix(cb, cbSmooth, uniBlend);
            cr = mix(cr, crSmooth, uniBlend);

            float tintShift = (u_skinToneTint - 0.50) * 0.035;
            cb -= tintShift * skinFactor;
            cr += tintShift * skinFactor;
          }

          float rOut = y + 1.40200 * (cr - 0.5);
          float gOut = y - 0.34414 * (cb - 0.5) - 0.71414 * (cr - 0.5);
          float bOut = y + 1.77200 * (cb - 0.5);

          vec3 evenColor = clamp(vec3(rOut, gOut, bOut), 0.0, 1.0);
          color = mix(color, evenColor, clamp(skinFactor * max(u_uniformity, u_antiRedness) * 0.90, 0.0, 0.95));
        }

        // 3.5. Resplandor suave (Porcelain Bloom)
        if (u_glow > 0.01 && skinFactor > 0.10) {
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          float highlight = smoothstep(0.40, 0.78, lum) * (1.0 - smoothstep(0.85, 0.98, lum));
          vec3 warmHighlight = vec3(1.0, 0.97, 0.94);
          color += warmHighlight * (highlight * u_glow * 0.18 * skinFactor);
        }

        // 3.6. Blanqueamiento dental (ESTRICTO dentro de la boca)
        if (u_teethWhitening > 0.01 && mask.g > 0.04) {
          float mouthArea = mask.g;
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          bool isToothCandidate = (lum > 0.32) && 
                                  (color.r > color.b) && 
                                  (color.g > color.b * 0.85) && 
                                  (abs(color.r - color.g) < 0.14);

          if (isToothCandidate) {
            float weight = smoothstep(0.04, 0.30, mouthArea);
            float yellowCast = max(0.0, ((color.r + color.g) * 0.5) - color.b);
            vec3 whitened = color;
            whitened.b += yellowCast * u_teethWhitening * 1.10;
            whitened += vec3(u_teethBrightness * 0.18);
            whitened = clamp(whitened, 0.0, 1.0);
            color = mix(color, whitened, clamp(weight * u_teethWhitening, 0.0, 0.95));
          }
        }

        // 3.7. Realce de ojos (ESTRICTO dentro de los ojos)
        if (u_eyeBrightening > 0.01 && mask.b > 0.08) {
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          if (lum > 0.32) {
            vec3 brightEye = mix(color, vec3(lum + 0.10), 0.45 * u_eyeBrightening);
            color = mix(color, brightEye, mask.b * u_eyeBrightening);
          }
        }

        // 3.8. Enfoque de texturas HD (Sobre la imagen denoised)
        if (u_sharpen > 0.01) {
          vec2 texel = 1.0 / u_resolution;
          vec3 n = sampleCalibrated(texUv + vec2(0.0, -texel.y));
          vec3 s = sampleCalibrated(texUv + vec2(0.0,  texel.y));
          vec3 e = sampleCalibrated(texUv + vec2( texel.x, 0.0));
          vec3 w = sampleCalibrated(texUv + vec2(-texel.x, 0.0));
          vec3 blurred = (n + s + e + w) * 0.25;
          vec3 highPass = step2Denoised - blurred;
          color = clamp(color + highPass * u_sharpen * 1.5, 0.0, 1.0);
        }

        // 3.9. Gradacion de color final (Brillo, contraste, saturacion, temperatura, vineta)
        color += vec3(u_brightness);
        color = (color - 0.5) * u_contrast + 0.5;

        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(gray), color, u_saturation);

        color.r += u_temperature * 0.14;
        color.b -= u_temperature * 0.14;

        if (u_vignette > 0.01) {
          vec2 center = uv - 0.5;
          float dist = length(center);
          float vig = smoothstep(0.75, 0.35, dist * (1.0 + u_vignette));
          color *= vig;
        }

        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }
    `;
      const vertShader = this.compileShader(gl.VERTEX_SHADER, vsSource);
      const fragShader = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertShader);
      gl.attachShader(this.program, fragShader);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.error("[BeautyEngineService] Program link error:", gl.getProgramInfoLog(this.program));
        return;
      }
      const positions = new Float32Array([
        -1,
        -1,
        1,
        -1,
        -1,
        1,
        -1,
        1,
        1,
        -1,
        1,
        1
      ]);
      const posBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      const aPosLoc = gl.getAttribLocation(this.program, "a_position");
      gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
      this.cameraTexture = this.createTexture();
      this.maskTexture = this.createTexture();
      this.uLoc = {
        u_cameraTexture: gl.getUniformLocation(this.program, "u_cameraTexture"),
        u_maskTexture: gl.getUniformLocation(this.program, "u_maskTexture"),
        u_resolution: gl.getUniformLocation(this.program, "u_resolution"),
        u_denoiseAuto: gl.getUniformLocation(this.program, "u_denoiseAuto"),
        u_aiDenoiseIntensity: gl.getUniformLocation(this.program, "u_aiDenoiseIntensity"),
        u_aiDenoiseTemporal: gl.getUniformLocation(this.program, "u_aiDenoiseTemporal"),
        u_aiDenoiseChroma: gl.getUniformLocation(this.program, "u_aiDenoiseChroma"),
        u_denoiseIntensity: gl.getUniformLocation(this.program, "u_denoiseIntensity"),
        u_denoiseTemporal: gl.getUniformLocation(this.program, "u_denoiseTemporal"),
        u_denoiseChroma: gl.getUniformLocation(this.program, "u_denoiseChroma"),
        u_aiWhiteBalance: gl.getUniformLocation(this.program, "u_aiWhiteBalance"),
        u_aiExposureGain: gl.getUniformLocation(this.program, "u_aiExposureGain"),
        u_aiShadowLift: gl.getUniformLocation(this.program, "u_aiShadowLift"),
        u_smoothIntensity: gl.getUniformLocation(this.program, "u_smoothIntensity"),
        u_smoothRadius: gl.getUniformLocation(this.program, "u_smoothRadius"),
        u_edgeThreshold: gl.getUniformLocation(this.program, "u_edgeThreshold"),
        u_uniformity: gl.getUniformLocation(this.program, "u_uniformity"),
        u_antiRedness: gl.getUniformLocation(this.program, "u_antiRedness"),
        u_skinToneTint: gl.getUniformLocation(this.program, "u_skinToneTint"),
        u_sharpen: gl.getUniformLocation(this.program, "u_sharpen"),
        u_teethWhitening: gl.getUniformLocation(this.program, "u_teethWhitening"),
        u_teethBrightness: gl.getUniformLocation(this.program, "u_teethBrightness"),
        u_eyeBrightening: gl.getUniformLocation(this.program, "u_eyeBrightening"),
        u_concealer: gl.getUniformLocation(this.program, "u_concealer"),
        u_brightness: gl.getUniformLocation(this.program, "u_brightness"),
        u_contrast: gl.getUniformLocation(this.program, "u_contrast"),
        u_saturation: gl.getUniformLocation(this.program, "u_saturation"),
        u_temperature: gl.getUniformLocation(this.program, "u_temperature"),
        u_glow: gl.getUniformLocation(this.program, "u_glow"),
        u_vignette: gl.getUniformLocation(this.program, "u_vignette"),
        u_splitPosition: gl.getUniformLocation(this.program, "u_splitPosition"),
        u_bypass: gl.getUniformLocation(this.program, "u_bypass"),
        u_mirror: gl.getUniformLocation(this.program, "u_mirror")
      };
      console.log("[BeautyEngineService] WebGL GPU pipeline initialized at 60 FPS");
    }
    compileShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("[BeautyEngineService] Shader compile error:", gl.getShaderInfoLog(shader));
      }
      return shader;
    }
    createTexture() {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return texture;
    }
    updateParam(key, value) {
      if (key in this.params) {
        this.params[key] = value;
      }
    }
    getParams() {
      return { ...this.params };
    }
    setParams(newParams) {
      Object.assign(this.params, newParams);
    }
    render(videoElement, maskCanvas, aiCalibration) {
      const gl = this.gl;
      if (!gl || !this.program || !videoElement) return;
      if (typeof videoElement.readyState === "number" && videoElement.readyState < 2) return;
      const width = videoElement instanceof HTMLVideoElement ? videoElement.videoWidth : videoElement.width;
      const height = videoElement instanceof HTMLVideoElement ? videoElement.videoHeight : videoElement.height;
      if (width === 0 || height === 0) return;
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.cameraTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);
      gl.uniform1i(this.uLoc.u_cameraTexture, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
      if (maskCanvas && maskCanvas.width > 0 && maskCanvas.height > 0) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
      }
      gl.uniform1i(this.uLoc.u_maskTexture, 1);
      gl.uniform2f(this.uLoc.u_resolution, width, height);
      if (aiCalibration) {
        gl.uniform3f(this.uLoc.u_aiWhiteBalance, aiCalibration.whiteBalance[0], aiCalibration.whiteBalance[1], aiCalibration.whiteBalance[2]);
        gl.uniform1f(this.uLoc.u_aiExposureGain, aiCalibration.exposureGain);
        gl.uniform1f(this.uLoc.u_aiShadowLift, aiCalibration.shadowLift);
      } else {
        gl.uniform3f(this.uLoc.u_aiWhiteBalance, 1, 1, 1);
        gl.uniform1f(this.uLoc.u_aiExposureGain, 1);
        gl.uniform1f(this.uLoc.u_aiShadowLift, 0);
      }
      gl.uniform1i(this.uLoc.u_denoiseAuto, this.params.denoiseAuto ? 1 : 0);
      if (aiCalibration) {
        gl.uniform1f(this.uLoc.u_aiDenoiseIntensity, this.params.denoiseEnabled ? aiCalibration.autoDenoiseIntensity : 0);
        gl.uniform1f(this.uLoc.u_aiDenoiseTemporal, aiCalibration.autoDenoiseTemporal);
        gl.uniform1f(this.uLoc.u_aiDenoiseChroma, aiCalibration.autoDenoiseChroma);
      } else {
        gl.uniform1f(this.uLoc.u_aiDenoiseIntensity, 0.75);
        gl.uniform1f(this.uLoc.u_aiDenoiseTemporal, 0.78);
        gl.uniform1f(this.uLoc.u_aiDenoiseChroma, 0.88);
      }
      gl.uniform1f(this.uLoc.u_denoiseIntensity, this.params.denoiseEnabled ? this.params.denoiseIntensity : 0);
      gl.uniform1f(this.uLoc.u_denoiseTemporal, this.params.denoiseTemporal);
      gl.uniform1f(this.uLoc.u_denoiseChroma, this.params.denoiseChroma);
      gl.uniform1f(this.uLoc.u_smoothIntensity, this.params.smoothIntensity);
      gl.uniform1f(this.uLoc.u_smoothRadius, this.params.smoothRadius);
      gl.uniform1f(this.uLoc.u_edgeThreshold, this.params.edgeThreshold);
      gl.uniform1f(this.uLoc.u_uniformity, this.params.uniformity);
      gl.uniform1f(this.uLoc.u_antiRedness, this.params.antiRedness);
      gl.uniform1f(this.uLoc.u_skinToneTint, this.params.skinToneTint);
      gl.uniform1f(this.uLoc.u_sharpen, this.params.sharpen);
      gl.uniform1f(this.uLoc.u_teethWhitening, this.params.teethWhitening);
      gl.uniform1f(this.uLoc.u_teethBrightness, this.params.teethBrightness);
      gl.uniform1f(this.uLoc.u_eyeBrightening, this.params.eyeBrightening);
      gl.uniform1f(this.uLoc.u_concealer, this.params.concealer);
      gl.uniform1f(this.uLoc.u_brightness, this.params.brightness);
      gl.uniform1f(this.uLoc.u_contrast, this.params.contrast);
      gl.uniform1f(this.uLoc.u_saturation, this.params.saturation);
      gl.uniform1f(this.uLoc.u_temperature, this.params.temperature);
      gl.uniform1f(this.uLoc.u_glow, this.params.glow);
      gl.uniform1f(this.uLoc.u_vignette, this.params.vignette);
      gl.uniform1f(this.uLoc.u_splitPosition, this.params.splitPosition);
      gl.uniform1i(this.uLoc.u_bypass, this.params.bypass ? 1 : 0);
      gl.uniform1i(this.uLoc.u_mirror, this.params.mirror ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    dispose() {
      if (this.gl && this.program) {
        this.gl.deleteProgram(this.program);
      }
    }
  };

  // src/services/stream/stream.service.ts
  var StreamService = class {
    running = false;
    serverInfo = null;
    lastFrameTimestamp = 0;
    isEncoding = false;
    async startServer(port = 8554) {
      if (!window.electronAPI) {
        throw new Error("Electron API not available");
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
    async stopServer() {
      if (!window.electronAPI) return false;
      await window.electronAPI.stopStreamServer();
      this.running = false;
      this.serverInfo = null;
      return true;
    }
    sendFrame(canvas) {
      if (!this.running || !window.electronAPI || this.isEncoding) return;
      const now = performance.now();
      if (now - this.lastFrameTimestamp < 33) return;
      this.lastFrameTimestamp = now;
      this.isEncoding = true;
      canvas.toBlob((blob) => {
        this.isEncoding = false;
        if (blob && window.electronAPI) {
          blob.arrayBuffer().then((buffer) => {
            window.electronAPI.sendStreamFrame(buffer);
          }).catch(() => {
          });
        }
      }, "image/jpeg", 0.88);
    }
    isRunning() {
      return this.running;
    }
    getInfo() {
      return this.serverInfo;
    }
  };

  // src/services/vcam/vcam.service.ts
  var VirtualCamService = class {
    running = false;
    offscreenCanvas = null;
    ctx2d = null;
    lastFrameTimestamp = 0;
    isProcessingFrame = false;
    async getStatus() {
      if (!window.electronAPI) {
        return { installed: false, running: false, fps: 0, width: 1920, height: 1080 };
      }
      const status = await window.electronAPI.vcamGetStatus();
      this.running = status.running;
      return status;
    }
    async installDriver() {
      if (!window.electronAPI) {
        return { success: false, error: "Entorno Electron no detectado." };
      }
      return await window.electronAPI.vcamInstall();
    }
    async uninstallDriver() {
      if (!window.electronAPI) {
        return { success: false, error: "Entorno Electron no detectado." };
      }
      return await window.electronAPI.vcamUninstall();
    }
    async start(width = 1920, height = 1080) {
      if (!window.electronAPI) return false;
      const res = await window.electronAPI.vcamStart(width, height);
      this.running = res.running;
      return this.running;
    }
    async stop() {
      if (!window.electronAPI) return false;
      await window.electronAPI.vcamStop();
      this.running = false;
      return true;
    }
    isRunning() {
      return this.running;
    }
    sendFrame(glCanvas) {
      if (!this.running || !window.electronAPI || this.isProcessingFrame) return;
      const w = glCanvas.width;
      const h = glCanvas.height;
      if (w <= 0 || h <= 0) return;
      const now = performance.now();
      if (now - this.lastFrameTimestamp < 14) return;
      this.lastFrameTimestamp = now;
      if (!this.offscreenCanvas) {
        this.offscreenCanvas = document.createElement("canvas");
        this.ctx2d = this.offscreenCanvas.getContext("2d", { willReadFrequently: true });
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
        console.warn("[VirtualCamService] Error capturing/sending frame:", e);
      } finally {
        this.isProcessingFrame = false;
      }
    }
  };

  // src/services/presets/preset.manager.ts
  var PresetManager = class {
    presets = /* @__PURE__ */ new Map();
    constructor() {
      this.registerDefaultPresets();
    }
    registerDefaultPresets() {
      this.presets.set("auto", {
        denoiseEnabled: true,
        denoiseAuto: true,
        denoiseIntensity: 0.65,
        denoiseTemporal: 0.75,
        denoiseChroma: 0.8,
        smoothIntensity: 0.5,
        smoothRadius: 3.5,
        edgeThreshold: 0.14,
        uniformity: 0.5,
        antiRedness: 0.6,
        sharpen: 0.25,
        skinToneTint: 0.5,
        teethWhitening: 0.35,
        teethBrightness: 0.06,
        eyeBrightening: 0.25,
        concealer: 0.5,
        brightness: 0,
        contrast: 1.02,
        saturation: 1.02,
        temperature: 0,
        glow: 0,
        vignette: 0
      });
      this.presets.set("natural", {
        denoiseEnabled: true,
        denoiseAuto: true,
        denoiseIntensity: 0.55,
        denoiseTemporal: 0.7,
        denoiseChroma: 0.75,
        smoothIntensity: 0.35,
        smoothRadius: 2.8,
        edgeThreshold: 0.12,
        uniformity: 0.35,
        antiRedness: 0.45,
        sharpen: 0.2,
        skinToneTint: 0.5,
        teethWhitening: 0.25,
        teethBrightness: 0.04,
        eyeBrightening: 0.2,
        concealer: 0.35,
        brightness: 0,
        contrast: 1.01,
        saturation: 1.01,
        temperature: 0,
        glow: 0,
        vignette: 0
      });
      this.presets.set("porcelain", {
        denoiseEnabled: true,
        denoiseAuto: true,
        denoiseIntensity: 0.7,
        denoiseTemporal: 0.75,
        denoiseChroma: 0.82,
        smoothIntensity: 0.65,
        smoothRadius: 4.2,
        edgeThreshold: 0.16,
        uniformity: 0.65,
        antiRedness: 0.7,
        sharpen: 0.3,
        skinToneTint: 0.45,
        teethWhitening: 0.4,
        teethBrightness: 0.08,
        eyeBrightening: 0.3,
        concealer: 0.65,
        brightness: 0.01,
        contrast: 1.03,
        saturation: 1.02,
        temperature: 0,
        glow: 0.02,
        vignette: 0
      });
      this.presets.set("streamer", {
        denoiseEnabled: true,
        denoiseAuto: true,
        denoiseIntensity: 0.65,
        denoiseTemporal: 0.75,
        denoiseChroma: 0.8,
        smoothIntensity: 0.55,
        smoothRadius: 3.8,
        edgeThreshold: 0.15,
        uniformity: 0.55,
        antiRedness: 0.6,
        sharpen: 0.32,
        skinToneTint: 0.5,
        teethWhitening: 0.38,
        teethBrightness: 0.08,
        eyeBrightening: 0.3,
        concealer: 0.55,
        brightness: 0.01,
        contrast: 1.03,
        saturation: 1.03,
        temperature: 0,
        glow: 0,
        vignette: 0
      });
      this.presets.set("glam", {
        denoiseEnabled: true,
        denoiseAuto: true,
        denoiseIntensity: 0.7,
        denoiseTemporal: 0.78,
        denoiseChroma: 0.85,
        smoothIntensity: 0.75,
        smoothRadius: 4.5,
        edgeThreshold: 0.18,
        uniformity: 0.75,
        antiRedness: 0.75,
        sharpen: 0.35,
        skinToneTint: 0.48,
        teethWhitening: 0.45,
        teethBrightness: 0.1,
        eyeBrightening: 0.38,
        concealer: 0.7,
        brightness: 0.02,
        contrast: 1.05,
        saturation: 1.05,
        temperature: 0.01,
        glow: 0.03,
        vignette: 0
      });
      this.presets.set("reset", {
        denoiseIntensity: 0,
        denoiseTemporal: 0,
        denoiseChroma: 0,
        smoothIntensity: 0,
        smoothRadius: 3,
        edgeThreshold: 0.12,
        uniformity: 0,
        antiRedness: 0,
        sharpen: 0,
        skinToneTint: 0.5,
        teethWhitening: 0,
        teethBrightness: 0,
        eyeBrightening: 0,
        concealer: 0,
        brightness: 0,
        contrast: 1,
        saturation: 1,
        temperature: 0,
        glow: 0,
        vignette: 0
      });
    }
    getPreset(name) {
      return this.presets.get(name) || null;
    }
    registerPreset(name, params) {
      this.presets.set(name, params);
    }
    getAvailablePresets() {
      return Array.from(this.presets.keys());
    }
  };

  // src/services/storage/storage.service.ts
  var LocalStorageSettingsService = class {
    storageKey = "snapjm_user_preferences_v1";
    clamp(val, min, max, fallback) {
      if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
        return fallback;
      }
      return Math.min(Math.max(val, min), max);
    }
    sanitizeParams(raw) {
      if (typeof raw !== "object" || raw === null) {
        return {};
      }
      const clean = {};
      if ("smoothIntensity" in raw) clean.smoothIntensity = this.clamp(raw.smoothIntensity, 0, 1, 0.5);
      if ("smoothRadius" in raw) clean.smoothRadius = this.clamp(raw.smoothRadius, 0.5, 15, 3.5);
      if ("edgeThreshold" in raw) clean.edgeThreshold = this.clamp(raw.edgeThreshold, 0.01, 1, 0.14);
      if ("uniformity" in raw) clean.uniformity = this.clamp(raw.uniformity, 0, 1, 0.5);
      if ("antiRedness" in raw) clean.antiRedness = this.clamp(raw.antiRedness, 0, 1, 0.6);
      if ("sharpen" in raw) clean.sharpen = this.clamp(raw.sharpen, 0, 1, 0.25);
      if ("skinToneTint" in raw) clean.skinToneTint = this.clamp(raw.skinToneTint, 0, 1, 0.5);
      if ("teethWhitening" in raw) clean.teethWhitening = this.clamp(raw.teethWhitening, 0, 1, 0.35);
      if ("teethBrightness" in raw) clean.teethBrightness = this.clamp(raw.teethBrightness, 0, 1, 0.06);
      if ("eyeBrightening" in raw) clean.eyeBrightening = this.clamp(raw.eyeBrightening, 0, 1, 0.25);
      if ("concealer" in raw) clean.concealer = this.clamp(raw.concealer, 0, 1, 0.5);
      if ("brightness" in raw) clean.brightness = this.clamp(raw.brightness, -1, 1, 0);
      if ("contrast" in raw) clean.contrast = this.clamp(raw.contrast, 0.2, 3, 1.02);
      if ("saturation" in raw) clean.saturation = this.clamp(raw.saturation, 0, 3, 1.02);
      if ("temperature" in raw) clean.temperature = this.clamp(raw.temperature, -1, 1, 0);
      if ("glow" in raw) clean.glow = this.clamp(raw.glow, 0, 1, 0);
      if ("vignette" in raw) clean.vignette = this.clamp(raw.vignette, 0, 1, 0);
      if ("denoiseIntensity" in raw) clean.denoiseIntensity = this.clamp(raw.denoiseIntensity, 0, 1, 0.65);
      if ("denoiseTemporal" in raw) clean.denoiseTemporal = this.clamp(raw.denoiseTemporal, 0, 1, 0.75);
      if ("denoiseChroma" in raw) clean.denoiseChroma = this.clamp(raw.denoiseChroma, 0, 1, 0.8);
      if ("denoiseEnabled" in raw) clean.denoiseEnabled = Boolean(raw.denoiseEnabled);
      if ("denoiseAuto" in raw) clean.denoiseAuto = Boolean(raw.denoiseAuto);
      if ("mirror" in raw) clean.mirror = Boolean(raw.mirror);
      if ("bypass" in raw) clean.bypass = Boolean(raw.bypass);
      return clean;
    }
    sanitizeResolution(res) {
      if (typeof res !== "string") return void 0;
      const match = res.trim().match(/^(\d{2,4})x(\d{2,4})$/);
      if (!match) return void 0;
      const w = parseInt(match[1], 10);
      const h = parseInt(match[2], 10);
      if (w < 160 || w > 7680 || h < 120 || h > 4320) return void 0;
      return `${w}x${h}`;
    }
    sanitizeFps(fps) {
      if (typeof fps !== "number" || isNaN(fps) || !isFinite(fps)) return void 0;
      const intFps = Math.round(fps);
      if (intFps < 10 || intFps > 240) return 60;
      return intFps;
    }
    loadPreferences() {
      try {
        const serialized = localStorage.getItem(this.storageKey);
        if (!serialized) {
          return null;
        }
        const parsed = JSON.parse(serialized);
        if (typeof parsed !== "object" || parsed === null) {
          return null;
        }
        return {
          deviceId: typeof parsed.deviceId === "string" && parsed.deviceId.trim().length > 0 ? parsed.deviceId.trim() : void 0,
          resolution: this.sanitizeResolution(parsed.resolution),
          fps: this.sanitizeFps(parsed.fps),
          params: this.sanitizeParams(parsed.params),
          activePreset: typeof parsed.activePreset === "string" && parsed.activePreset.trim().length > 0 ? parsed.activePreset.trim() : void 0,
          mirror: typeof parsed.mirror === "boolean" ? parsed.mirror : void 0
        };
      } catch (err) {
        console.warn("[LocalStorageSettingsService] Failed to load preferences from storage:", err);
        return null;
      }
    }
    savePreferences(prefs) {
      try {
        const current = this.loadPreferences() || { params: {} };
        const merged = {
          deviceId: prefs.deviceId !== void 0 ? typeof prefs.deviceId === "string" ? prefs.deviceId.trim() : void 0 : current.deviceId,
          resolution: prefs.resolution !== void 0 ? this.sanitizeResolution(prefs.resolution) : current.resolution,
          fps: prefs.fps !== void 0 ? this.sanitizeFps(prefs.fps) : current.fps,
          params: {
            ...current.params,
            ...this.sanitizeParams(prefs.params)
          },
          activePreset: prefs.activePreset !== void 0 ? prefs.activePreset : current.activePreset,
          mirror: prefs.mirror !== void 0 ? prefs.mirror : current.mirror
        };
        localStorage.setItem(this.storageKey, JSON.stringify(merged));
      } catch (err) {
        console.warn("[LocalStorageSettingsService] Failed to save preferences to storage:", err);
      }
    }
    clearPreferences() {
      try {
        localStorage.removeItem(this.storageKey);
      } catch (err) {
        console.warn("[LocalStorageSettingsService] Failed to clear preferences:", err);
      }
    }
  };

  // src/ui/app-controller.ts
  var AppController = class {
    cameraService;
    faceTracker;
    calibrator;
    renderEngine;
    streamService;
    vcamService;
    presetManager;
    storageService;
    // DOM Elements
    videoEl;
    canvasEl;
    loaderEl;
    loaderTextEl;
    toastEl;
    fpsCounter;
    faceStatusText;
    badgeFaceDot;
    resStatusText;
    resBadge;
    aiCalibText;
    obsStatusText;
    obsDot;
    // Sliders map
    sliders = {};
    // Persistence debounce
    saveDebounceTimer = null;
    // Performance metrics
    frameCount = 0;
    lastFpsTime = performance.now();
    isComparing = false;
    splitX = 0.5;
    isDraggingSplit = false;
    // Media recording
    mediaRecorder = null;
    recordedChunks = [];
    isRecording = false;
    constructor(cameraService, faceTracker, calibrator, renderEngine, streamService, vcamService, presetManager, storageService) {
      this.cameraService = cameraService;
      this.faceTracker = faceTracker;
      this.calibrator = calibrator;
      this.renderEngine = renderEngine;
      this.streamService = streamService;
      this.vcamService = vcamService;
      this.presetManager = presetManager;
      this.storageService = storageService;
      this.videoEl = document.getElementById("webcam-video");
      this.canvasEl = document.getElementById("gl-canvas");
      this.loaderEl = document.getElementById("camera-loader");
      this.loaderTextEl = document.getElementById("camera-loader-text");
      this.toastEl = document.getElementById("toast-message");
      this.fpsCounter = document.getElementById("fps-counter");
      this.faceStatusText = document.getElementById("face-status-text");
      this.badgeFaceDot = document.querySelector("#badge-face .dot-indicator");
      this.resStatusText = document.getElementById("res-status-text");
      this.resBadge = document.getElementById("res-badge");
      this.aiCalibText = document.getElementById("ai-calib-status-text");
      this.obsStatusText = document.getElementById("obs-status-text");
      this.obsDot = document.getElementById("obs-dot");
    }
    async initialize() {
      this.bindWindowControls();
      this.bindTabs();
      this.initSliders();
      this.bindToolbarButtons();
      this.bindPresetButtons();
      this.bindVCamControls();
      this.bindOBSControls();
      this.bindLightingEvents();
      this.bindSettingsControls();
      this.bindRecording();
      this.faceTracker.initialize().catch((err) => {
        console.warn("[AppController] Face tracker initialization deferred:", err);
      });
      let savedPrefs = null;
      try {
        savedPrefs = this.storageService.loadPreferences();
      } catch (e) {
        console.warn("[AppController] Error reading stored preferences:", e);
      }
      const targetDeviceId = savedPrefs?.deviceId;
      const targetResolution = savedPrefs?.resolution;
      const targetFps = savedPrefs?.fps || 60;
      await this.startCamera(targetDeviceId, targetResolution, targetFps);
      try {
        if (savedPrefs && savedPrefs.params && Object.keys(savedPrefs.params).length > 0) {
          this.renderEngine.setParams(savedPrefs.params);
          this.syncSlidersFromParams(savedPrefs.params);
          if (savedPrefs.activePreset && savedPrefs.activePreset !== "custom") {
            this.highlightPresetButton(savedPrefs.activePreset);
          } else {
            document.querySelectorAll(".preset-pill").forEach((b) => b.classList.remove("active"));
          }
          if (savedPrefs.mirror !== void 0) {
            this.renderEngine.updateParam("mirror", savedPrefs.mirror);
            const btnMirror = document.getElementById("btn-mirror");
            if (btnMirror) {
              btnMirror.classList.toggle("active", savedPrefs.mirror);
            }
          }
          this.showToast("\u2728 Configuraci\xF3n y sliders restaurados");
        } else {
          this.applyPreset("auto", false);
        }
      } catch (errParams) {
        console.warn("[AppController] Error applying saved parameters, resetting to safe auto preset:", errParams);
        this.applyPreset("auto", false);
      }
      requestAnimationFrame(this.renderLoop.bind(this));
      setTimeout(() => {
        this.toggleServer().catch(() => {
        });
      }, 1200);
    }
    bindLightingEvents() {
      EventBus.getInstance().on("lighting:changed", (data) => {
        this.updateAICalibUI(data);
      });
    }
    updateAICalibUI(data) {
      const expEv = ((data.exposureGain - 1) * 1.5).toFixed(1);
      const expStr = (Number(expEv) >= 0 ? "+" : "") + expEv + " EV";
      const denoisePct = Math.round(data.autoDenoiseIntensity * 100);
      if (this.aiCalibText) {
        this.aiCalibText.textContent = `AI: ${data.kelvin}K \u2022 ${expStr} \u2022 Denoise ${denoisePct}%`;
      }
      const telKelvin = document.getElementById("telemetry-kelvin");
      if (telKelvin) {
        const tone = data.kelvin > 6e3 ? "Fr\xEDa (Corregida)" : data.kelvin < 4500 ? "C\xE1lida (Corregida)" : "\xD3ptimo Neutro";
        telKelvin.textContent = `${data.kelvin} K \u2022 ${tone}`;
      }
      const telExposure = document.getElementById("telemetry-exposure");
      if (telExposure) {
        telExposure.textContent = `${expStr} \u2022 Normalizado`;
      }
      const telDenoise = document.getElementById("telemetry-denoise");
      if (telDenoise) {
        telDenoise.textContent = `Auto (${denoisePct}%) \u2022 Activo`;
      }
      const telLighting = document.getElementById("telemetry-lighting");
      if (telLighting) {
        if (data.lightingChanged) {
          telLighting.textContent = "\u26A1 Cambio detectado \u2022 Re-ajustando";
          telLighting.className = "telemetry-badge";
        } else {
          telLighting.textContent = "Continuo \u2022 En tiempo real";
          telLighting.className = "telemetry-badge green";
        }
      }
    }
    async startCamera(deviceId, resolution, fps = 60) {
      this.loaderEl.style.display = "flex";
      this.loaderTextEl.innerHTML = `<div class="spinner"></div><p id="camera-loader-msg">Configurando sensor de c\xE1mara en ${fps} FPS...</p>`;
      let devices = [];
      try {
        devices = await this.cameraService.enumerateDevices();
      } catch (e) {
        console.warn("[AppController] Failed to enumerate camera devices:", e);
      }
      if (devices.length === 0) {
        this.showCameraDisconnectedUI("No se detect\xF3 ninguna c\xE1mara de video disponible en tu equipo.");
        return;
      }
      let selectedDeviceId = deviceId;
      if (selectedDeviceId && !devices.some((d) => d.deviceId === selectedDeviceId)) {
        console.warn(`[AppController] Stored camera '${selectedDeviceId}' not found. Falling back to primary device.`);
        this.showToast("\u26A0\uFE0F C\xE1mara guardada no detectada. Conectando a c\xE1mara disponible...");
        selectedDeviceId = devices[0].deviceId;
      }
      let stream = null;
      let actualFps = fps;
      try {
        stream = await this.cameraService.startStream(selectedDeviceId, resolution, fps);
      } catch (errTier1) {
        console.warn("[AppController] Tier 1 camera init failed (requested resolution/fps):", errTier1);
        try {
          actualFps = 30;
          this.showToast("\u26A0\uFE0F Ajustando a resoluci\xF3n y tasa de cuadros compatibles...");
          stream = await this.cameraService.startStream(selectedDeviceId, void 0, 30);
        } catch (errTier2) {
          console.warn("[AppController] Tier 2 camera init failed (device-specific fallback):", errTier2);
          try {
            actualFps = 30;
            stream = await this.cameraService.startStream(void 0, void 0, 30);
            this.showToast("\u26A0\uFE0F Conectado con controlador de video seguro.");
          } catch (errTier3) {
            console.error("[AppController] Tier 3 all camera fallbacks failed:", errTier3);
            this.showCameraDisconnectedUI(errTier3.message || "El dispositivo est\xE1 ocupado por otra aplicaci\xF3n o no tiene permisos.");
            return;
          }
        }
      }
      if (!stream) {
        this.showCameraDisconnectedUI("No se pudo inicializar el flujo de video.");
        return;
      }
      try {
        this.videoEl.srcObject = stream;
        await new Promise((resolve) => {
          let resolved = false;
          const onLoaded = () => {
            if (resolved) return;
            resolved = true;
            this.videoEl.removeEventListener("loadedmetadata", onLoaded);
            this.videoEl.play().catch(() => {
            });
            this.loaderEl.style.display = "none";
            const actualW = this.videoEl.videoWidth || 1280;
            const actualH = this.videoEl.videoHeight || 720;
            this.canvasEl.width = actualW;
            this.canvasEl.height = actualH;
            const resLabel = actualW >= 1920 ? "1080p Full HD" : actualW >= 1280 ? "720p HD" : `${actualW}p`;
            if (this.resStatusText) this.resStatusText.textContent = `${actualW} \xD7 ${actualH} (${resLabel})`;
            this.showToast(`C\xE1mara activa a ${actualFps} FPS (${actualW} \xD7 ${actualH})`);
            this.populateResolutions(actualFps);
            resolve();
          };
          if (this.videoEl.readyState >= 1 && this.videoEl.videoWidth > 0) {
            onLoaded();
          } else {
            this.videoEl.addEventListener("loadedmetadata", onLoaded, { once: true });
            setTimeout(() => {
              if (!resolved) onLoaded();
            }, 1200);
          }
        });
        const currentTrack = this.cameraService.getCurrentTrack();
        const currentSettings = currentTrack && typeof currentTrack.getSettings === "function" ? currentTrack.getSettings() : null;
        const activeId = currentSettings && currentSettings.deviceId || selectedDeviceId;
        await this.populateCameraDropdown(activeId);
        if (currentTrack) {
          currentTrack.onended = () => {
            console.warn("[AppController] Active video track ended (hardware disconnected).");
            this.handleCameraDisconnection();
          };
        }
      } catch (err) {
        console.error("[AppController] Error rendering camera stream:", err);
        this.showCameraDisconnectedUI(err.message || "Error al procesar el flujo de video.");
      }
    }
    showCameraDisconnectedUI(message) {
      this.loaderEl.style.display = "flex";
      this.loaderTextEl.innerHTML = `
      <div style="text-align:center;max-width:320px;padding:16px;">
        <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="#ef4444" stroke-width="2" style="margin-bottom:12px;display:inline-block">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"></path>
        </svg>
        <div style="font-weight:600;font-size:15px;color:#f87171;margin-bottom:6px">Problema con la C\xE1mara</div>
        <div style="font-size:12px;color:#94a3b8;line-height:1.4;margin-bottom:16px">${message}</div>
        <button id="btn-retry-camera" class="tool-btn" style="background:#3b82f6;color:#ffffff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-weight:600;margin:0 auto;display:inline-flex;align-items:center;gap:6px">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          Reintentar Conexi\xF3n
        </button>
      </div>
    `;
      const btnRetry = document.getElementById("btn-retry-camera");
      if (btnRetry) {
        btnRetry.addEventListener("click", () => {
          this.showToast("Reintentando conectar a la c\xE1mara...");
          this.startCamera();
        });
      }
    }
    async handleCameraDisconnection() {
      this.showToast("\u26A0\uFE0F C\xE1mara desconectada. Buscando dispositivo de respaldo...");
      try {
        const devices = await this.cameraService.enumerateDevices();
        if (devices.length > 0) {
          await this.startCamera(devices[0].deviceId, void 0, 60);
          this.showToast(`\u2705 Cambiado a c\xE1mara de respaldo: ${devices[0].label || "C\xE1mara secundaria"}`);
        } else {
          this.showCameraDisconnectedUI("C\xE1mara desconectada. Conecta una c\xE1mara USB para continuar.");
        }
      } catch (e) {
        this.showCameraDisconnectedUI("Error al buscar dispositivos de c\xE1mara.");
      }
    }
    async populateCameraDropdown(selectedDeviceId) {
      const selectCamera = document.getElementById("select-camera");
      if (!selectCamera) return;
      try {
        const devices = await this.cameraService.enumerateDevices();
        const currentTrack = this.cameraService.getCurrentTrack();
        const trackSettings = currentTrack && typeof currentTrack.getSettings === "function" ? currentTrack.getSettings() : null;
        const activeId = selectedDeviceId || (trackSettings ? trackSettings.deviceId : null) || selectCamera.value;
        selectCamera.innerHTML = "";
        devices.forEach((device, index) => {
          const opt = document.createElement("option");
          opt.value = device.deviceId;
          opt.textContent = device.label || `C\xE1mara ${index + 1}`;
          if (activeId && device.deviceId === activeId) {
            opt.selected = true;
          }
          selectCamera.appendChild(opt);
        });
        if (activeId && [...selectCamera.options].some((o) => o.value === activeId)) {
          selectCamera.value = activeId;
        }
      } catch (e) {
        console.warn("[AppController] Error populating camera dropdown:", e);
      }
    }
    populateResolutions(currentFpsOverride) {
      const track = this.cameraService.getCurrentTrack();
      if (!track) return;
      const selectResolution = document.getElementById("select-resolution");
      const selectFps = document.getElementById("select-fps");
      if (!selectResolution || !selectFps) return;
      const info = this.cameraService.detectCapabilities(track);
      selectResolution.innerHTML = "";
      info.resolutions.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.value;
        opt.textContent = r.label;
        selectResolution.appendChild(opt);
      });
      const currentResVal = `${this.videoEl.videoWidth}x${this.videoEl.videoHeight}`;
      if ([...selectResolution.options].some((o) => o.value === currentResVal)) {
        selectResolution.value = currentResVal;
      }
      if (this.resBadge) {
        this.resBadge.textContent = `${info.resolutions.length} soportadas (Sensor: ${info.maxW}\xD7${info.maxH})`;
      }
      const currentFps = currentFpsOverride !== void 0 ? currentFpsOverride : Number(selectFps.value) || 60;
      selectFps.innerHTML = "";
      if (info.maxFps >= 60) {
        selectFps.innerHTML += `<option value="60" ${currentFps === 60 ? "selected" : ""}>60 FPS (M\xE1xima Fluidez)</option>`;
        selectFps.innerHTML += `<option value="30" ${currentFps === 30 ? "selected" : ""}>30 FPS (Modo Ahorro de Recursos)</option>`;
      } else if (info.maxFps >= 30) {
        selectFps.innerHTML += `<option value="${info.maxFps}" selected>${info.maxFps} FPS (M\xE1ximo Soportado)</option>`;
        if (info.maxFps > 30) {
          selectFps.innerHTML += `<option value="30" ${currentFps === 30 ? "selected" : ""}>30 FPS (Est\xE1ndar)</option>`;
        }
      } else {
        selectFps.innerHTML += `<option value="${info.maxFps}" selected>${info.maxFps} FPS</option>`;
      }
    }
    // ----------------------------------------------------
    // MAIN 60 FPS GPU RENDER LOOP (Zero Stalls)
    // ----------------------------------------------------
    renderLoop() {
      requestAnimationFrame(this.renderLoop.bind(this));
      if (!this.videoEl || this.videoEl.readyState < 2) return;
      const now = performance.now();
      const trackResult = this.faceTracker.update(this.videoEl, now);
      if (trackResult && trackResult.hasFace) {
        if (this.badgeFaceDot) this.badgeFaceDot.className = "dot-indicator green";
        if (this.faceStatusText) this.faceStatusText.textContent = "Rostro detectado";
      } else {
        if (this.badgeFaceDot) this.badgeFaceDot.className = "dot-indicator blue";
        if (this.faceStatusText) this.faceStatusText.textContent = "Buscando rostro...";
      }
      const track = this.cameraService.getCurrentTrack();
      const aiCalib = this.calibrator.update(this.videoEl, trackResult ? trackResult.landmarks : null, track);
      if (this.frameCount % 20 === 0) {
        this.updateAICalibUI(aiCalib);
      }
      this.renderEngine.render(this.videoEl, trackResult ? trackResult.maskCanvas : null, aiCalib);
      this.frameCount++;
      if (now - this.lastFpsTime >= 1e3) {
        if (this.fpsCounter) {
          this.fpsCounter.textContent = Math.round(this.frameCount * 1e3 / (now - this.lastFpsTime)).toString();
        }
        this.frameCount = 0;
        this.lastFpsTime = now;
      }
      if (this.vcamService.isRunning()) {
        this.vcamService.sendFrame(this.canvasEl);
      }
      if (this.streamService.isRunning()) {
        this.streamService.sendFrame(this.canvasEl);
      }
    }
    applyPreset(name, persist = true) {
      const p = this.presetManager.getPreset(name);
      if (!p) return;
      this.renderEngine.setParams(p);
      this.syncSlidersFromParams(p);
      this.highlightPresetButton(name);
      if (persist) {
        this.saveCurrentPreferences(name);
      }
      this.showToast(`Preset "${name.toUpperCase()}" aplicado`);
    }
    highlightPresetButton(name) {
      document.querySelectorAll(".preset-pill").forEach((b) => {
        b.classList.remove("active");
        if (b.dataset.preset === name) {
          b.classList.add("active");
        }
      });
    }
    syncSlidersFromParams(params) {
      if (!params || typeof params !== "object") return;
      Object.keys(params).forEach((param) => {
        try {
          const slider = Object.values(this.sliders).find((s) => s.param === param);
          if (slider && slider.input && typeof params[param] === "number") {
            const val = params[param];
            if (isNaN(val) || !isFinite(val)) return;
            const displayVal = Math.round(val / slider.scale);
            slider.input.value = displayVal.toString();
            if (slider.val) {
              if (slider.format) {
                slider.val.textContent = slider.format(displayVal);
              } else {
                slider.val.textContent = (slider.signed && displayVal > 0 ? "+" : "") + displayVal + slider.unit;
              }
            }
          }
        } catch (err) {
          console.warn(`[AppController] Error syncing slider '${param}':`, err);
        }
      });
    }
    scheduleSavePreferences(activePreset) {
      if (this.saveDebounceTimer !== null) {
        window.clearTimeout(this.saveDebounceTimer);
      }
      this.saveDebounceTimer = window.setTimeout(() => {
        this.saveDebounceTimer = null;
        this.saveCurrentPreferences(activePreset);
      }, 250);
    }
    saveCurrentPreferences(activePreset) {
      const selectCamera = document.getElementById("select-camera");
      const selectResolution = document.getElementById("select-resolution");
      const selectFps = document.getElementById("select-fps");
      const currentTrack = this.cameraService.getCurrentTrack();
      const trackSettings = currentTrack && typeof currentTrack.getSettings === "function" ? currentTrack.getSettings() : null;
      const deviceId = selectCamera && selectCamera.value || (trackSettings ? trackSettings.deviceId : void 0);
      const resolution = selectResolution ? selectResolution.value : void 0;
      const fps = selectFps ? Number(selectFps.value) || 60 : 60;
      const currentParams = this.renderEngine.getParams();
      this.storageService.savePreferences({
        deviceId,
        resolution,
        fps,
        params: currentParams,
        activePreset,
        mirror: currentParams.mirror
      });
    }
    initSliders() {
      this.sliders = {
        smooth: { input: document.getElementById("sl-smooth"), val: document.getElementById("val-smooth"), param: "smoothIntensity", scale: 0.01, unit: "%" },
        radius: { input: document.getElementById("sl-radius"), val: document.getElementById("val-radius"), param: "smoothRadius", scale: 0.1, unit: "" },
        edge: { input: document.getElementById("sl-edge"), val: document.getElementById("val-edge"), param: "edgeThreshold", scale: 0.01, unit: "%" },
        uniformity: { input: document.getElementById("sl-uniformity"), val: document.getElementById("val-uniformity"), param: "uniformity", scale: 0.01, unit: "%" },
        antiRedness: { input: document.getElementById("sl-anti-redness"), val: document.getElementById("val-anti-redness"), param: "antiRedness", scale: 0.01, unit: "%" },
        sharpen: { input: document.getElementById("sl-sharpen"), val: document.getElementById("val-sharpen"), param: "sharpen", scale: 0.01, unit: "%" },
        toneTint: {
          input: document.getElementById("sl-tone-tint"),
          val: document.getElementById("val-tone-tint"),
          param: "skinToneTint",
          scale: 0.01,
          unit: "",
          format: (v) => v < 35 ? "Porcelana Fr\xEDa" : v > 65 ? "Durazno C\xE1lido" : "Natural Luminoso"
        },
        teeth: { input: document.getElementById("sl-teeth"), val: document.getElementById("val-teeth"), param: "teethWhitening", scale: 0.01, unit: "%" },
        teethBright: { input: document.getElementById("sl-teeth-bright"), val: document.getElementById("val-teeth-bright"), param: "teethBrightness", scale: 0.01, unit: "%" },
        eyes: { input: document.getElementById("sl-eyes"), val: document.getElementById("val-eyes"), param: "eyeBrightening", scale: 0.01, unit: "%" },
        eyeBags: { input: document.getElementById("sl-eye-bags"), val: document.getElementById("val-eye-bags"), param: "concealer", scale: 0.01, unit: "%" },
        brightness: { input: document.getElementById("sl-brightness"), val: document.getElementById("val-brightness"), param: "brightness", scale: 0.01, unit: "%", signed: true },
        contrast: { input: document.getElementById("sl-contrast"), val: document.getElementById("val-contrast"), param: "contrast", scale: 0.01, unit: "" },
        saturation: { input: document.getElementById("sl-saturation"), val: document.getElementById("val-saturation"), param: "saturation", scale: 0.01, unit: "" },
        temp: { input: document.getElementById("sl-temp"), val: document.getElementById("val-temp"), param: "temperature", scale: 0.01, unit: "", signed: true },
        glow: { input: document.getElementById("sl-glow"), val: document.getElementById("val-glow"), param: "glow", scale: 0.01, unit: "%" },
        vignette: { input: document.getElementById("sl-vignette"), val: document.getElementById("val-vignette"), param: "vignette", scale: 0.01, unit: "%" }
      };
      Object.keys(this.sliders).forEach((key) => {
        const s = this.sliders[key];
        if (!s.input) return;
        s.input.addEventListener("input", () => {
          const numVal = parseFloat(s.input.value);
          const scaledVal = numVal * s.scale;
          this.renderEngine.updateParam(s.param, scaledVal);
          if (s.format) {
            s.val.textContent = s.format(numVal);
          } else {
            s.val.textContent = (s.signed && numVal > 0 ? "+" : "") + numVal + s.unit;
          }
          document.querySelectorAll(".preset-pill").forEach((b) => b.classList.remove("active"));
          this.scheduleSavePreferences("custom");
        });
      });
    }
    bindToolbarButtons() {
      const btnCompare = document.getElementById("btn-compare");
      const btnMirror = document.getElementById("btn-mirror");
      const btnAutoEnhance = document.getElementById("btn-auto-enhance");
      const btnBypass = document.getElementById("btn-bypass");
      const btnSnapshot = document.getElementById("btn-snapshot");
      const btnFullscreen = document.getElementById("btn-fullscreen");
      const btnRecalibrate = document.getElementById("btn-recalibrate-lighting");
      const splitContainer = document.getElementById("split-slider-container");
      const splitLine = document.getElementById("split-line");
      const viewportWrapper = document.getElementById("viewport-wrapper");
      if (btnRecalibrate) {
        btnRecalibrate.addEventListener("click", () => {
          this.calibrator.forceRecalibrate();
          this.showToast("\u2728 Sensor recalibrado: Nueva exposici\xF3n y balance calculados");
        });
      }
      if (btnAutoEnhance) {
        btnAutoEnhance.addEventListener("click", () => {
          this.calibrator.forceRecalibrate();
          this.applyPreset("auto", true);
          this.showToast("\u2728 Correcci\xF3n Autom\xE1tica Aplicada: 60 FPS Calidad \xD3ptima");
        });
      }
      if (btnCompare && splitContainer && splitLine) {
        btnCompare.addEventListener("click", () => {
          this.isComparing = !this.isComparing;
          btnCompare.classList.toggle("active", this.isComparing);
          splitContainer.style.display = this.isComparing ? "block" : "none";
          this.renderEngine.updateParam("splitPosition", this.isComparing ? this.splitX : -1);
          if (this.isComparing) {
            splitLine.style.left = this.splitX * 100 + "%";
            this.showToast("Modo Comparar: Arrastra la barra para ver Antes / Despu\xE9s");
          }
        });
      }
      if (viewportWrapper && splitLine) {
        viewportWrapper.addEventListener("mousedown", () => {
          if (!this.isComparing) return;
          this.isDraggingSplit = true;
        });
        window.addEventListener("mousemove", (e) => {
          if (!this.isDraggingSplit || !this.isComparing) return;
          const rect = viewportWrapper.getBoundingClientRect();
          const x = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
          this.splitX = x;
          splitLine.style.left = x * 100 + "%";
          this.renderEngine.updateParam("splitPosition", x);
        });
        window.addEventListener("mouseup", () => {
          this.isDraggingSplit = false;
        });
      }
      if (btnMirror) {
        btnMirror.addEventListener("click", () => {
          const cur = this.renderEngine.getParams().mirror;
          this.renderEngine.updateParam("mirror", !cur);
          btnMirror.classList.toggle("active", !cur);
          this.saveCurrentPreferences();
          this.showToast(!cur ? "Modo Espejo Activado" : "Modo Espejo Desactivado");
        });
        btnMirror.classList.add("active");
      }
      if (btnBypass) {
        btnBypass.addEventListener("click", () => {
          const cur = this.renderEngine.getParams().bypass;
          this.renderEngine.updateParam("bypass", !cur);
          btnBypass.classList.toggle("active", !cur);
          const span = btnBypass.querySelector("span");
          if (span) span.textContent = !cur ? "Filtros OFF" : "Filtros ON";
          this.showToast(!cur ? "Bypass: Mostrando c\xE1mara original" : "Filtros reactivados");
        });
      }
      if (btnSnapshot) {
        btnSnapshot.addEventListener("click", async () => {
          try {
            const dataUrl = this.canvasEl.toDataURL("image/png");
            if (window.electronAPI) {
              const res = await window.electronAPI.saveSnapshot(dataUrl);
              if (res.success) {
                this.showToast(`\u{1F4F8} Foto HD guardada en: ${res.filename}`);
              }
            }
          } catch (e) {
            this.showToast("Error en captura HD");
          }
        });
      }
      if (btnFullscreen && viewportWrapper) {
        btnFullscreen.addEventListener("click", () => {
          if (!document.fullscreenElement) {
            viewportWrapper.requestFullscreen().catch(() => {
            });
          } else {
            document.exitFullscreen().catch(() => {
            });
          }
        });
      }
    }
    bindPresetButtons() {
      document.querySelectorAll(".preset-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
          const presetName = btn.dataset.preset;
          if (presetName) this.applyPreset(presetName, true);
        });
      });
    }
    async bindVCamControls() {
      const btnToggleVCam = document.getElementById("btn-toggle-vcam");
      const btnInstallVCam = document.getElementById("btn-install-vcam");
      if (btnToggleVCam) {
        btnToggleVCam.addEventListener("click", () => this.toggleVCam());
      }
      if (btnInstallVCam) {
        btnInstallVCam.addEventListener("click", () => this.installVCamDriver());
      }
      try {
        const status = await this.vcamService.getStatus();
        this.updateVCamUI(status.installed, status.running);
      } catch (e) {
        console.warn("[AppController] Error checking virtual cam driver status:", e);
      }
    }
    updateVCamUI(installed, running) {
      const btnToggleVCam = document.getElementById("btn-toggle-vcam");
      const vcamToggleLabel = document.getElementById("vcam-toggle-label");
      const btnInstallVCam = document.getElementById("btn-install-vcam");
      const vcamInstallContainer = document.getElementById("vcam-install-container");
      const vcamDriverBadge = document.getElementById("vcam-driver-badge");
      const vcamDriverText = document.getElementById("vcam-driver-text");
      const vcamStreamStatus = document.getElementById("vcam-stream-status");
      const vcamTelemetryStats = document.getElementById("vcam-telemetry-stats");
      if (vcamDriverBadge && vcamDriverText) {
        if (installed) {
          vcamDriverBadge.className = "vcam-badge installed";
          vcamDriverText.textContent = "Instalado (DirectShow)";
          if (vcamInstallContainer) vcamInstallContainer.style.display = "none";
        } else {
          vcamDriverBadge.className = "vcam-badge not-installed";
          vcamDriverText.textContent = "Controlador No Instalado";
          if (vcamInstallContainer) vcamInstallContainer.style.display = "block";
        }
      }
      if (btnToggleVCam && vcamToggleLabel) {
        if (running) {
          btnToggleVCam.className = "vcam-toggle-btn stop";
          vcamToggleLabel.textContent = "Detener C\xE1mara Virtual";
          if (vcamStreamStatus) {
            vcamStreamStatus.textContent = "Transmitiendo en Vivo (60 FPS)";
            vcamStreamStatus.className = "telemetry-badge green";
          }
          if (this.obsStatusText) this.obsStatusText.textContent = "C\xE1mara Virtual: Activa (60 FPS)";
          if (this.obsDot) this.obsDot.className = "dot-indicator green";
        } else {
          btnToggleVCam.className = "vcam-toggle-btn start";
          vcamToggleLabel.textContent = "Iniciar C\xE1mara Virtual de Windows";
          if (vcamStreamStatus) {
            vcamStreamStatus.textContent = "Inactiva";
            vcamStreamStatus.className = "telemetry-badge";
          }
          if (this.obsStatusText) this.obsStatusText.textContent = "C\xE1mara Virtual: OFF";
          if (this.obsDot) this.obsDot.className = "dot-indicator blue";
        }
      }
    }
    async toggleVCam() {
      const btnToggleVCam = document.getElementById("btn-toggle-vcam");
      if (!this.vcamService.isRunning()) {
        let status = await this.vcamService.getStatus();
        if (!status.installed) {
          this.showToast("\u2139\uFE0F Instalando controlador DirectShow en Windows (1 Clic)...");
          await this.installVCamDriver();
          status = await this.vcamService.getStatus();
          if (!status.installed) {
            return;
          }
        }
        const w = this.canvasEl.width || 1920;
        const h = this.canvasEl.height || 1080;
        const success = await this.vcamService.start(w, h);
        if (success) {
          this.updateVCamUI(true, true);
          this.showToast("\u2705 SnapJM Virtual Camera ACTIVA para Zoom, Meet, Teams y Discord");
        } else {
          this.showToast("\u274C Error al iniciar la C\xE1mara Virtual de Windows.");
        }
      } else {
        await this.vcamService.stop();
        this.updateVCamUI(true, false);
        this.showToast("C\xE1mara Virtual de Windows detenida.");
      }
    }
    async installVCamDriver() {
      const btnInstallVCam = document.getElementById("btn-install-vcam");
      if (btnInstallVCam) {
        btnInstallVCam.innerHTML = "<span>Instalando controlador en Windows...</span>";
      }
      try {
        this.showToast("Acepta los permisos de Administrador en el di\xE1logo de Windows...");
        const res = await this.vcamService.installDriver();
        if (res.success) {
          this.showToast("\u2705 Controlador DirectShow registrado con \xE9xito en Windows.");
        } else {
          this.showToast(`\u274C ${res.error || "No se pudo registrar el controlador"}`);
        }
      } catch (e) {
        this.showToast(`\u274C Error al instalar controlador: ${e.message}`);
      } finally {
        const status = await this.vcamService.getStatus();
        this.updateVCamUI(status.installed, status.running);
        if (btnInstallVCam) {
          btnInstallVCam.innerHTML = `
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Instalar Controlador DirectShow de Windows (1 Clic)</span>
        `;
        }
      }
    }
    bindOBSControls() {
      const btnToggleServer = document.getElementById("btn-toggle-server");
      const btnCopyObs = document.getElementById("btn-copy-obs");
      const btnCopyMjpeg = document.getElementById("btn-copy-mjpeg");
      const obsBrowserUrl = document.getElementById("obs-browser-url");
      const obsMjpegUrl = document.getElementById("obs-mjpeg-url");
      if (btnToggleServer) {
        btnToggleServer.addEventListener("click", () => this.toggleServer());
      }
      if (btnCopyObs && obsBrowserUrl) {
        btnCopyObs.addEventListener("click", () => {
          navigator.clipboard.writeText(obsBrowserUrl.value);
          this.showToast("\xA1URL OBS Browser copiada!");
        });
      }
      if (btnCopyMjpeg && obsMjpegUrl) {
        btnCopyMjpeg.addEventListener("click", () => {
          navigator.clipboard.writeText(obsMjpegUrl.value);
          this.showToast("\xA1URL MJPEG copiada!");
        });
      }
    }
    async toggleServer() {
      const btnToggleServer = document.getElementById("btn-toggle-server");
      const serverDescStatus = document.getElementById("server-desc-status");
      const obsBrowserUrl = document.getElementById("obs-browser-url");
      const obsMjpegUrl = document.getElementById("obs-mjpeg-url");
      if (!this.streamService.isRunning()) {
        try {
          const info = await this.streamService.startServer(8554);
          if (btnToggleServer) btnToggleServer.textContent = "Detener Servidor";
          if (serverDescStatus) serverDescStatus.textContent = `Servidor activo en el puerto ${info.port}`;
          if (this.obsStatusText) this.obsStatusText.textContent = `OBS Virtual: Activo (${info.port})`;
          if (this.obsDot) this.obsDot.className = "dot-indicator green";
          if (obsBrowserUrl) obsBrowserUrl.value = info.obsUrl;
          if (obsMjpegUrl) obsMjpegUrl.value = info.mjpegUrl;
        } catch (e) {
        }
      } else {
        await this.streamService.stopServer();
        if (btnToggleServer) btnToggleServer.textContent = "Activar Servidor";
        if (serverDescStatus) serverDescStatus.textContent = "Servidor detenido";
        if (this.obsStatusText) this.obsStatusText.textContent = "OBS Virtual: Inactivo";
        if (this.obsDot) this.obsDot.className = "dot-indicator blue";
      }
    }
    bindSettingsControls() {
      const selectCamera = document.getElementById("select-camera");
      const selectResolution = document.getElementById("select-resolution");
      const selectFps = document.getElementById("select-fps");
      const btnOpenCaptures = document.getElementById("btn-open-captures");
      if (selectCamera) {
        selectCamera.addEventListener("change", async () => {
          const deviceId = selectCamera.value;
          const fps = selectFps ? Number(selectFps.value) || 60 : 60;
          this.showToast("Cambiando de c\xE1mara...");
          await this.startCamera(deviceId, void 0, fps);
          this.saveCurrentPreferences();
        });
      }
      if (selectResolution) {
        selectResolution.addEventListener("change", async () => {
          const val = selectResolution.value;
          if (!val) return;
          const deviceId = selectCamera ? selectCamera.value : void 0;
          const fps = selectFps ? Number(selectFps.value) || 60 : 60;
          this.showToast(`Ajustando resoluci\xF3n a ${val}...`);
          await this.startCamera(deviceId, val, fps);
          this.saveCurrentPreferences();
        });
      }
      if (selectFps) {
        selectFps.addEventListener("change", async () => {
          const fps = Number(selectFps.value) || 60;
          const deviceId = selectCamera ? selectCamera.value : void 0;
          const val = selectResolution ? selectResolution.value : void 0;
          this.showToast(`Ajustando tasa de cuadros a ${fps} FPS...`);
          await this.startCamera(deviceId, val, fps);
          this.saveCurrentPreferences();
        });
      }
      if (btnOpenCaptures) {
        btnOpenCaptures.addEventListener("click", async () => {
          if (window.electronAPI) {
            const api = window.electronAPI;
            if (api.openCapturesFolder) {
              await api.openCapturesFolder();
              this.showToast("Carpeta de capturas abierta");
            } else if (api.openFolder) {
              const res = await api.saveSnapshot(this.canvasEl.toDataURL("image/png"));
              if (res && res.folder) {
                await api.openFolder(res.folder);
              }
            }
          }
        });
      }
      if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === "function") {
        navigator.mediaDevices.addEventListener("devicechange", async () => {
          await this.populateCameraDropdown();
          const curTrack = this.cameraService.getCurrentTrack();
          if (!curTrack || curTrack.readyState === "ended" || this.loaderEl.style.display === "flex") {
            const devices = await this.cameraService.enumerateDevices();
            if (devices.length > 0) {
              this.showToast("\u{1F50C} Nuevo sensor de c\xE1mara detectado. Conectando...");
              await this.startCamera(devices[0].deviceId);
            }
          }
        });
      }
    }
    bindRecording() {
      const btnRecord = document.getElementById("btn-record");
      const recLabel = document.getElementById("rec-label");
      if (!btnRecord) return;
      btnRecord.addEventListener("click", () => {
        if (!this.isRecording) {
          const stream = this.canvasEl.captureStream(60);
          const curStream = this.cameraService.getCurrentStream();
          if (curStream && curStream.getAudioTracks().length > 0) {
            stream.addTrack(curStream.getAudioTracks()[0]);
          }
          this.recordedChunks = [];
          try {
            this.mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus" });
          } catch (e) {
            this.mediaRecorder = new MediaRecorder(stream);
          }
          this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.recordedChunks.push(e.data);
          };
          this.mediaRecorder.onstop = async () => {
            const blob = new Blob(this.recordedChunks, { type: "video/webm" });
            const arrayBuffer = await blob.arrayBuffer();
            if (window.electronAPI && window.electronAPI.saveVideoRecording) {
              const res = await window.electronAPI.saveVideoRecording(arrayBuffer);
              if (res && res.success) {
                this.showToast(`\u{1F3A5} Grabaci\xF3n guardada en: ${res.filename}`);
              }
            }
          };
          this.mediaRecorder.start();
          this.isRecording = true;
          btnRecord.classList.add("recording");
          if (recLabel) recLabel.textContent = "Detener";
          this.showToast("Grabando video en tiempo real...");
        } else {
          if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            this.mediaRecorder.stop();
          }
          this.isRecording = false;
          btnRecord.classList.remove("recording");
          if (recLabel) recLabel.textContent = "Grabar";
        }
      });
    }
    bindWindowControls() {
      const btnMin = document.getElementById("btn-minimize");
      const btnMax = document.getElementById("btn-maximize");
      const btnClose = document.getElementById("btn-close");
      if (window.electronAPI) {
        if (btnMin) btnMin.addEventListener("click", () => window.electronAPI.minimize());
        if (btnMax) btnMax.addEventListener("click", () => window.electronAPI.maximize());
        if (btnClose) btnClose.addEventListener("click", () => window.electronAPI.close());
      }
    }
    bindTabs() {
      const tabButtons = document.querySelectorAll(".tab-btn");
      const tabPanes = document.querySelectorAll(".tab-pane");
      tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          tabButtons.forEach((b) => b.classList.remove("active"));
          tabPanes.forEach((p) => p.classList.remove("active"));
          btn.classList.add("active");
          const target = document.getElementById(btn.dataset.tab || "");
          if (target) target.classList.add("active");
        });
      });
    }
    showToast(message, duration = 3e3) {
      if (!this.toastEl) return;
      this.toastEl.textContent = message;
      this.toastEl.classList.add("show");
      setTimeout(() => {
        this.toastEl.classList.remove("show");
      }, duration);
    }
  };

  // src/index.ts
  document.addEventListener("DOMContentLoaded", async () => {
    const canvasEl = document.getElementById("gl-canvas");
    const cameraService = new CameraService();
    const faceTrackerService = new FaceTrackerService();
    const aiCalibratorService = new AICalibratorService();
    const renderEngine = new BeautyEngineService(canvasEl);
    const streamService = new StreamService();
    const vcamService = new VirtualCamService();
    const presetManager = new PresetManager();
    const storageService = new LocalStorageSettingsService();
    const app = new AppController(
      cameraService,
      faceTrackerService,
      aiCalibratorService,
      renderEngine,
      streamService,
      vcamService,
      presetManager,
      storageService
    );
    await app.initialize();
    console.log("[SnapJM] Modern SOLID TypeScript Architecture initialized at 60 FPS");
  });
})();
//# sourceMappingURL=app.bundle.js.map
