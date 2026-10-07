/**
 * SnapJM Renderer - Core Controller
 * Connects UI, Webcam stream, MediaPipe FaceLandmarker,
 * WebGL BeautyEngine, Virtual Cam OBS Stream, and Snap Camera Kit.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const videoEl = document.getElementById('webcam-video');
  const canvasEl = document.getElementById('gl-canvas');
  const cameraLoader = document.getElementById('camera-loader');
  const loaderText = document.getElementById('camera-loader-text');
  const toastEl = document.getElementById('toast-message');

  // Titlebar & Status
  const btnMin = document.getElementById('btn-minimize');
  const btnMax = document.getElementById('btn-maximize');
  const btnClose = document.getElementById('btn-close');
  const fpsCounter = document.getElementById('fps-counter');
  const faceStatusText = document.getElementById('face-status-text');
  const badgeFaceDot = document.querySelector('#badge-face .dot-indicator');
  const resStatusText = document.getElementById('res-status-text');
  const resBadge = document.getElementById('res-badge');
  const obsStatusText = document.getElementById('obs-status-text');
  const obsDot = document.getElementById('obs-dot');
  const aiCalibText = document.getElementById('ai-calib-status-text');

  // Quick Toolbar
  const btnCompare = document.getElementById('btn-compare');
  const btnMirror = document.getElementById('btn-mirror');
  const btnAutoEnhance = document.getElementById('btn-auto-enhance');
  const btnBypass = document.getElementById('btn-bypass');
  const btnSnapshot = document.getElementById('btn-snapshot');
  const btnRecord = document.getElementById('btn-record');
  const recLabel = document.getElementById('rec-label');
  const btnFullscreen = document.getElementById('btn-fullscreen');

  // Split-Screen
  const splitContainer = document.getElementById('split-slider-container');
  const splitLine = document.getElementById('split-line');

  // Sidebar Tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // Sliders & Labels Configuration
  const sliders = {
    // Suavizado
    smooth: { input: document.getElementById('sl-smooth'), val: document.getElementById('val-smooth'), param: 'smoothIntensity', scale: 0.01, unit: '%' },
    radius: { input: document.getElementById('sl-radius'), val: document.getElementById('val-radius'), param: 'smoothRadius', scale: 0.1, unit: '' },
    edge: { input: document.getElementById('sl-edge'), val: document.getElementById('val-edge'), param: 'edgeThreshold', scale: 0.01, unit: '%' },

    // Uniformidad & Anti-Rojeces
    uniformity: { input: document.getElementById('sl-uniformity'), val: document.getElementById('val-uniformity'), param: 'uniformity', scale: 0.01, unit: '%' },
    antiRedness: { input: document.getElementById('sl-anti-redness'), val: document.getElementById('val-anti-redness'), param: 'antiRedness', scale: 0.01, unit: '%' },
    sharpen: { input: document.getElementById('sl-sharpen'), val: document.getElementById('val-sharpen'), param: 'sharpen', scale: 0.01, unit: '%' },
    toneTint: {
      input: document.getElementById('sl-tone-tint'),
      val: document.getElementById('val-tone-tint'),
      param: 'skinToneTint',
      scale: 0.01,
      format: (v) => {
        if (v < 35) return 'Porcelana Fría';
        if (v > 65) return 'Durazno Cálido';
        return 'Natural Luminoso';
      }
    },

    // Dientes y Ojos
    teeth: { input: document.getElementById('sl-teeth'), val: document.getElementById('val-teeth'), param: 'teethWhitening', scale: 0.01, unit: '%' },
    teethBright: { input: document.getElementById('sl-teeth-bright'), val: document.getElementById('val-teeth-bright'), param: 'teethBrightness', scale: 0.01, unit: '%' },
    eyes: { input: document.getElementById('sl-eyes'), val: document.getElementById('val-eyes'), param: 'eyeBrightening', scale: 0.01, unit: '%' },

    // Estudio & Color
    brightness: { input: document.getElementById('sl-brightness'), val: document.getElementById('val-brightness'), param: 'brightness', scale: 0.01, unit: '%', signed: true },
    contrast: { input: document.getElementById('sl-contrast'), val: document.getElementById('val-contrast'), param: 'contrast', scale: 0.01, unit: '' },
    saturation: { input: document.getElementById('sl-saturation'), val: document.getElementById('val-saturation'), param: 'saturation', scale: 0.01, unit: '' },
    temp: { input: document.getElementById('sl-temp'), val: document.getElementById('val-temp'), param: 'temperature', scale: 0.01, unit: '', signed: true },
    glow: { input: document.getElementById('sl-glow'), val: document.getElementById('val-glow'), param: 'glow', scale: 0.01, unit: '%' },
    vignette: { input: document.getElementById('sl-vignette'), val: document.getElementById('val-vignette'), param: 'vignette', scale: 0.01, unit: '%' },

    // AI Denoise (Reducción de Ruido con IA)
    denoiseIntensity: { input: document.getElementById('sl-denoise-intensity'), val: document.getElementById('val-denoise-intensity'), param: 'denoiseIntensity', scale: 0.01, unit: '%' },
    denoiseTemporal: { input: document.getElementById('sl-denoise-temporal'), val: document.getElementById('val-denoise-temporal'), param: 'denoiseTemporal', scale: 0.01, unit: '%' },
    denoiseChroma: { input: document.getElementById('sl-denoise-chroma'), val: document.getElementById('val-denoise-chroma'), param: 'denoiseChroma', scale: 0.01, unit: '%' }
  };

  // OBS Server UI
  const btnToggleServer = document.getElementById('btn-toggle-server');
  const serverDescStatus = document.getElementById('server-desc-status');
  const obsBrowserUrl = document.getElementById('obs-browser-url');
  const obsMjpegUrl = document.getElementById('obs-mjpeg-url');
  const btnCopyObs = document.getElementById('btn-copy-obs');
  const btnCopyMjpeg = document.getElementById('btn-copy-mjpeg');

  // Snap Camera Kit UI
  const snapTokenInput = document.getElementById('snap-token');
  const snapGroupIdInput = document.getElementById('snap-group-id');
  const btnConnectSnap = document.getElementById('btn-connect-snap');
  const snapStatusText = document.getElementById('snap-status-text');
  const snapLensesContainer = document.getElementById('snap-lenses-container');
  const lensesGrid = document.getElementById('lenses-grid');

  // Settings UI
  const selectCamera = document.getElementById('select-camera');
  const selectResolution = document.getElementById('select-resolution');
  const selectFps = document.getElementById('select-fps');
  const btnOpenCaptures = document.getElementById('btn-open-captures');

  // State
  let currentStream = null;
  let beautyEngine = null;
  let tracker = null;
  let snapController = null;
  let isComparing = false;
  let splitX = 0.5;
  let isDraggingSplit = false;
  let isServerRunning = false;
  let isRecording = false;
  let mediaRecorder = null;
  let recordedChunks = [];
  let lastServerFrameTime = 0;
  let frameCount = 0;
  let lastFpsTime = performance.now();
  const cameraResolutionsCache = {};

  // Show Toast Utility
  function showToast(message, duration = 3000) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  }

  // 1. WINDOW CONTROLS
  if (window.electronAPI) {
    btnMin.addEventListener('click', () => window.electronAPI.minimize());
    btnMax.addEventListener('click', () => window.electronAPI.maximize());
    btnClose.addEventListener('click', () => window.electronAPI.close());
  }

  // 2. TABS NAVIGATION
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });

  // 3. INITIALIZE AR ENGINES
  loaderText.textContent = 'Iniciando aceleración gráfica GPU...';
  beautyEngine = new BeautyEngine(canvasEl);
  tracker = new FaceMeshTracker();
  aiCalibrator = new AICameraCalibrator();
  snapController = new SnapCameraKitController();

  if (snapController.apiToken) snapTokenInput.value = snapController.apiToken;
  if (snapController.lensGroupId) snapGroupIdInput.value = snapController.lensGroupId;

  // Initialize MediaPipe asynchronously
  tracker.initialize().then(() => {
    console.log('[App] Face tracker ready');
  });

  // 4. WEBCAM MANAGEMENT & DYNAMIC RESOLUTION DETECTION
  async function populateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      const currentSelected = selectCamera.value;
      selectCamera.innerHTML = '';

      videoDevices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Cámara ${index + 1}`;
        if (device.deviceId === currentSelected) option.selected = true;
        selectCamera.appendChild(option);
      });
    } catch (e) {
      console.warn('Error enumerating cameras:', e);
    }
  }

  function detectCameraResolutions(track) {
    if (!track) return { resolutions: [], maxFps: 30 };

    const candidates = [
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
      { w: 640,  h: 480,  label: 'VGA (640 × 480) [4:3]' },
      { w: 640,  h: 360,  label: '360p (640 × 360) [16:9]' }
    ];

    let maxW = 3840;
    let maxH = 2160;
    let minW = 160;
    let minH = 120;
    let maxFps = 60;

    const caps = (typeof track.getCapabilities === 'function') ? track.getCapabilities() : null;
    if (caps) {
      if (caps.width && caps.width.max) maxW = caps.width.max;
      if (caps.width && caps.width.min) minW = caps.width.min;
      if (caps.height && caps.height.max) maxH = caps.height.max;
      if (caps.height && caps.height.min) minH = caps.height.min;
      if (caps.frameRate && caps.frameRate.max) maxFps = Math.round(caps.frameRate.max);
    }

    const currentSettings = (typeof track.getSettings === 'function') ? track.getSettings() : null;
    const initialW = currentSettings ? currentSettings.width : 1280;
    const initialH = currentSettings ? currentSettings.height : 720;

    // Filter candidate resolutions that lie within the hardware limits
    const filtered = candidates.filter(c => c.w <= maxW && c.h <= maxH && c.w >= minW && c.h >= minH);

    // If native resolution isn't in candidates, include it
    if (initialW && initialH && !filtered.some(v => v.w === initialW && v.h === initialH)) {
      filtered.push({
        w: initialW,
        h: initialH,
        label: `${initialW} × ${initialH} (Nativa)`
      });
    }

    filtered.sort((a, b) => (b.w * b.h) - (a.w * a.h));

    const resolutions = filtered.map(c => ({
      value: `${c.w}x${c.h}`,
      width: c.w,
      height: c.h,
      label: c.label
    }));

    return {
      resolutions,
      maxFps,
      maxW,
      maxH
    };
  }

  async function setupCameraDevice(deviceId, targetResolution, targetFps) {
    cameraLoader.style.display = 'flex';
    loaderText.textContent = 'Configurando sensor de cámara en alta resolución...';

    // Stop existing stream
    if (currentStream) {
      currentStream.getTracks().forEach(t => t.stop());
      currentStream = null;
    }

    // Determine target resolution to request
    let targetW = 1920;
    let targetH = 1080;
    if (targetResolution) {
      [targetW, targetH] = targetResolution.split('x').map(Number);
    }

    const fps = targetFps || Number(selectFps.value) || 60;

    // Build constraints prioritized for high quality
    const streamConstraints = {
      video: {
        width: { ideal: targetW, min: Math.min(targetW, 1280) },
        height: { ideal: targetH, min: Math.min(targetH, 720) },
        frameRate: { ideal: fps }
      },
      audio: true
    };
    if (deviceId) {
      streamConstraints.video.deviceId = { exact: deviceId };
    }

    try {
      try {
        currentStream = await navigator.mediaDevices.getUserMedia(streamConstraints);
      } catch (errMin) {
        // Fallback without min constraint for cameras that don't support 720p+
        console.warn('Fallback without min constraint:', errMin);
        currentStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: targetW },
            height: { ideal: targetH },
            frameRate: { ideal: fps }
          },
          audio: true
        });
      }

      const track = currentStream.getVideoTracks()[0];

      // 1. Detect supported resolutions for this device
      const cacheKey = deviceId || (track.getSettings ? track.getSettings().deviceId : 'default');
      let info = cameraResolutionsCache[cacheKey];

      if (!info) {
        info = detectCameraResolutions(track);
        cameraResolutionsCache[cacheKey] = info;
      }

      // 2. Populate selectResolution dropdown
      selectResolution.innerHTML = '';
      info.resolutions.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.value;
        opt.textContent = r.label;
        selectResolution.appendChild(opt);
      });

      if (resBadge) {
        resBadge.textContent = `${info.resolutions.length} soportadas (Sensor: ${info.maxW}×${info.maxH})`;
      }

      // 3. Populate selectFps
      selectFps.innerHTML = '';
      if (info.maxFps >= 60) {
        selectFps.innerHTML += `<option value="60" ${fps === 60 ? 'selected' : ''}>60 FPS (Máxima Fluidez)</option>`;
        selectFps.innerHTML += `<option value="30" ${fps === 30 ? 'selected' : ''}>30 FPS (Ahorro de Recursos)</option>`;
      } else if (info.maxFps >= 30) {
        selectFps.innerHTML += `<option value="${info.maxFps}" selected>${info.maxFps} FPS (Máximo Soportado)</option>`;
        if (info.maxFps > 30) {
          selectFps.innerHTML += `<option value="30">30 FPS (Estándar)</option>`;
        }
      } else {
        selectFps.innerHTML += `<option value="${info.maxFps}" selected>${info.maxFps} FPS (Máximo)</option>`;
      }

      // 4. Connect to video element & update dimensions
      videoEl.srcObject = currentStream;
      videoEl.onloadedmetadata = () => {
        videoEl.play();
        cameraLoader.style.display = 'none';
        const actualW = videoEl.videoWidth;
        const actualH = videoEl.videoHeight;
        console.log(`[Camera] Started successfully at native ${actualW}x${actualH}`);

        // Update canvas resolution to match true sensor
        canvasEl.width = actualW;
        canvasEl.height = actualH;

        // Set matching resolution option in dropdown
        const activeResVal = `${actualW}x${actualH}`;
        if ([...selectResolution.options].some(o => o.value === activeResVal)) {
          selectResolution.value = activeResVal;
        }

        const resLabel = (actualW >= 1920) ? '1080p Full HD' : (actualW >= 1280 ? '720p HD' : `${actualW}p`);
        if (resStatusText) resStatusText.textContent = `${actualW} × ${actualH} (${resLabel})`;

        showToast(`Cámara activa en ${actualW} × ${actualH} (${resLabel})`);

        if (snapController && snapController.isConnected) {
          snapController.setSourceStream(currentStream);
        }
      };

      await populateCameras();
    } catch (err) {
      console.error('[Camera] Error starting camera:', err);
      loaderText.textContent = 'Error al acceder a la cámara: ' + err.message;
      showToast('Error de cámara: ' + err.message);
    }
  }

  // 5. MAIN RENDER LOOP (60 FPS GPU PIPELINE)
  function renderLoop() {
    requestAnimationFrame(renderLoop);

    if (!videoEl || videoEl.readyState < 2) return;

    const now = performance.now();

    // 1. Determine Source Element (Webcam or Snap Camera Kit)
    let sourceElement = videoEl;
    if (snapController && snapController.isConnected && snapController.activeLens && snapController.outputCanvas) {
      sourceElement = snapController.outputCanvas;
    }

    // 2. Track Facial Landmarks & Build 3-Channel Mask (Skin, Teeth, Eyes)
    const trackResult = tracker.update(sourceElement, now);
    const maskCanvas = trackResult ? trackResult.maskCanvas : null;

    if (trackResult && trackResult.hasFace) {
      badgeFaceDot.className = 'dot-indicator green';
      faceStatusText.textContent = 'Rostro detectado';
    } else {
      badgeFaceDot.className = 'dot-indicator blue';
      faceStatusText.textContent = 'Buscando rostro...';
    }

    // 2.5. AI Computer Vision Auto-Exposure, White Balance & Digital ISO
    const currentTrack = currentStream ? currentStream.getVideoTracks()[0] : null;
    const aiCalib = aiCalibrator.update(sourceElement, trackResult ? trackResult.landmarks : null, currentTrack);

    // Update AI calibration status pill periodically
    if (aiCalibText && (frameCount % 30 === 0)) {
      const expEv = ((aiCalib.exposureGain - 1.0) * 1.5).toFixed(1);
      const expStr = (expEv >= 0 ? '+' : '') + expEv + ' EV';
      aiCalibText.textContent = `AI: ${aiCalib.kelvin}K • ${expStr}`;
    }

    // 3. Render Frame in WebGL GPU Engine
    beautyEngine.render(sourceElement, maskCanvas, aiCalib);

    // 4. FPS Counter update
    frameCount++;
    if (now - lastFpsTime >= 1000) {
      fpsCounter.textContent = Math.round((frameCount * 1000) / (now - lastFpsTime));
      frameCount = 0;
      lastFpsTime = now;
    }

    // 5. Stream frame to OBS Virtual Camera Server (Throttled to 30 FPS to save CPU)
    if (isServerRunning && window.electronAPI && (now - lastServerFrameTime >= 33)) {
      lastServerFrameTime = now;
      canvasEl.toBlob((blob) => {
        if (blob) {
          blob.arrayBuffer().then((buffer) => {
            window.electronAPI.sendStreamFrame(buffer);
          });
        }
      }, 'image/jpeg', 0.88);
    }
  }

  // Start rendering loop immediately
  requestAnimationFrame(renderLoop);
  await populateCameras();
  await setupCameraDevice(selectCamera.value, '1920x1080', 60);

  // 6. SLIDERS & PARAMETER BINDINGS
  Object.keys(sliders).forEach(key => {
    const s = sliders[key];
    if (!s.input) return;

    s.input.addEventListener('input', () => {
      const numVal = parseFloat(s.input.value);
      const scaledVal = numVal * s.scale;
      beautyEngine.updateParam(s.param, scaledVal);

      if (s.format) {
        s.val.textContent = s.format(numVal);
      } else {
        let displayText = '';
        if (s.signed && numVal > 0) displayText += '+';
        displayText += numVal + s.unit;
        s.val.textContent = displayText;
      }
    });
  });

  // 7. PRESET BUTTONS
  const presets = {
    auto: {
      denoiseIntensity: 0.88, denoiseTemporal: 0.82, denoiseChroma: 0.95,
      smoothIntensity: 0.80, smoothRadius: 5.5, edgeThreshold: 0.14,
      uniformity: 0.55, antiRedness: 0.45, sharpen: 0.38, skinToneTint: 0.55,
      teethWhitening: 0.75, teethBrightness: 0.20, eyeBrightening: 0.50, concealer: 0.65,
      brightness: 0.03, contrast: 1.10, saturation: 1.06, temperature: 0.03, glow: 0.22, vignette: 0.00
    },
    natural: {
      denoiseIntensity: 0.60, denoiseTemporal: 0.70, denoiseChroma: 0.75,
      smoothIntensity: 0.50, smoothRadius: 3.0, edgeThreshold: 0.12,
      uniformity: 0.45, antiRedness: 0.40, sharpen: 0.35, skinToneTint: 0.50,
      teethWhitening: 0.55, teethBrightness: 0.12, eyeBrightening: 0.35, concealer: 0.40,
      brightness: 0.02, contrast: 1.05, saturation: 1.04, temperature: 0.01, glow: 0.10, vignette: 0.00
    },
    porcelain: {
      denoiseIntensity: 0.75, denoiseTemporal: 0.80, denoiseChroma: 0.85,
      smoothIntensity: 0.85, smoothRadius: 6.0, edgeThreshold: 0.14,
      uniformity: 0.75, antiRedness: 0.70, sharpen: 0.40, skinToneTint: 0.30,
      teethWhitening: 0.85, teethBrightness: 0.22, eyeBrightening: 0.55, concealer: 0.70,
      brightness: 0.05, contrast: 1.08, saturation: 1.05, temperature: 0.01, glow: 0.25, vignette: 0.00
    },
    streamer: {
      denoiseIntensity: 0.88, denoiseTemporal: 0.82, denoiseChroma: 0.95,
      smoothIntensity: 0.80, smoothRadius: 5.5, edgeThreshold: 0.14,
      uniformity: 0.60, antiRedness: 0.55, sharpen: 0.45, skinToneTint: 0.55,
      teethWhitening: 0.75, teethBrightness: 0.20, eyeBrightening: 0.50, concealer: 0.65,
      brightness: 0.04, contrast: 1.10, saturation: 1.08, temperature: 0.03, glow: 0.22, vignette: 0.00
    },
    glam: {
      denoiseIntensity: 0.80, denoiseTemporal: 0.85, denoiseChroma: 0.90,
      smoothIntensity: 0.90, smoothRadius: 4.8, edgeThreshold: 0.15,
      uniformity: 0.85, antiRedness: 0.80, sharpen: 0.60, skinToneTint: 0.45,
      teethWhitening: 0.95, teethBrightness: 0.28, eyeBrightening: 0.70,
      brightness: 0.07, contrast: 1.12, saturation: 1.15, temperature: 0.02, glow: 0.25, vignette: 0.18
    },
    reset: {
      denoiseIntensity: 0.0, denoiseTemporal: 0.0, denoiseChroma: 0.0,
      smoothIntensity: 0.0, smoothRadius: 3.0, edgeThreshold: 0.12,
      uniformity: 0.0, antiRedness: 0.0, sharpen: 0.0, skinToneTint: 0.50,
      teethWhitening: 0.0, teethBrightness: 0.0, eyeBrightening: 0.0,
      brightness: 0.0, contrast: 1.0, saturation: 1.0, temperature: 0.0, glow: 0.0, vignette: 0.0
    }
  };

  function applyPreset(name) {
    const p = presets[name];
    if (!p) return;

    Object.keys(p).forEach(param => {
      beautyEngine.updateParam(param, p[param]);
    });

    // Update slider UI
    sliders.smooth.input.value = Math.round(p.smoothIntensity * 100);
    sliders.smooth.val.textContent = sliders.smooth.input.value + '%';

    sliders.radius.input.value = Math.round(p.smoothRadius * 10);
    sliders.radius.val.textContent = (p.smoothRadius).toFixed(1);

    sliders.edge.input.value = Math.round(p.edgeThreshold * 100);
    sliders.edge.val.textContent = sliders.edge.input.value + '%';

    if (sliders.denoiseIntensity.input) {
      sliders.denoiseIntensity.input.value = Math.round(p.denoiseIntensity * 100);
      sliders.denoiseIntensity.val.textContent = sliders.denoiseIntensity.input.value + '%';
    }
    if (sliders.denoiseTemporal.input) {
      sliders.denoiseTemporal.input.value = Math.round(p.denoiseTemporal * 100);
      sliders.denoiseTemporal.val.textContent = sliders.denoiseTemporal.input.value + '%';
    }
    if (sliders.denoiseChroma.input) {
      sliders.denoiseChroma.input.value = Math.round(p.denoiseChroma * 100);
      sliders.denoiseChroma.val.textContent = sliders.denoiseChroma.input.value + '%';
    }

    if (sliders.uniformity.input) {
      sliders.uniformity.input.value = Math.round(p.uniformity * 100);
      sliders.uniformity.val.textContent = sliders.uniformity.input.value + '%';
    }

    if (sliders.antiRedness.input) {
      sliders.antiRedness.input.value = Math.round(p.antiRedness * 100);
      sliders.antiRedness.val.textContent = sliders.antiRedness.input.value + '%';
    }

    if (sliders.sharpen.input) {
      sliders.sharpen.input.value = Math.round(p.sharpen * 100);
      sliders.sharpen.val.textContent = sliders.sharpen.input.value + '%';
    }

    if (sliders.toneTint.input) {
      sliders.toneTint.input.value = Math.round(p.skinToneTint * 100);
      sliders.toneTint.val.textContent = sliders.toneTint.format(Math.round(p.skinToneTint * 100));
    }

    sliders.teeth.input.value = Math.round(p.teethWhitening * 100);
    sliders.teeth.val.textContent = sliders.teeth.input.value + '%';

    sliders.teethBright.input.value = Math.round(p.teethBrightness * 100);
    sliders.teethBright.val.textContent = sliders.teethBright.input.value + '%';

    sliders.eyes.input.value = Math.round(p.eyeBrightening * 100);
    sliders.eyes.val.textContent = sliders.eyes.input.value + '%';

    sliders.brightness.input.value = Math.round(p.brightness * 100);
    sliders.brightness.val.textContent = (p.brightness > 0 ? '+' : '') + sliders.brightness.input.value + '%';

    sliders.contrast.input.value = Math.round(p.contrast * 100);
    sliders.contrast.val.textContent = (p.contrast).toFixed(2);

    sliders.saturation.input.value = Math.round(p.saturation * 100);
    sliders.saturation.val.textContent = (p.saturation).toFixed(2);

    sliders.temp.input.value = Math.round(p.temperature * 100);
    sliders.temp.val.textContent = (p.temperature > 0 ? '+' : '') + sliders.temp.input.value;

    sliders.glow.input.value = Math.round(p.glow * 100);
    sliders.glow.val.textContent = sliders.glow.input.value + '%';

    sliders.vignette.input.value = Math.round(p.vignette * 100);
    sliders.vignette.val.textContent = sliders.vignette.input.value + '%';

    showToast(`Preset "${name.toUpperCase()}" aplicado`);
  }

  document.querySelectorAll('.preset-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
    });
  });

  if (btnAutoEnhance) {
    btnAutoEnhance.addEventListener('click', () => {
      document.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));
      const autoPill = document.querySelector('.preset-pill[data-preset="auto"]');
      if (autoPill) autoPill.classList.add('active');
      btnAutoEnhance.classList.add('active-gold');
      applyPreset('auto');
      showToast('✨ Corrección Automática Aplicada: Calidad Óptima');
    });
  }

  // Apply auto-enhance preset by default for best immediate look
  setTimeout(() => {
    applyPreset('auto');
  }, 300);

  // 8. SPLIT-SCREEN COMPARISON
  btnCompare.addEventListener('click', () => {
    isComparing = !isComparing;
    btnCompare.classList.toggle('active', isComparing);
    splitContainer.style.display = isComparing ? 'block' : 'none';
    beautyEngine.updateParam('splitPosition', isComparing ? splitX : -1.0);
    if (isComparing) {
      splitLine.style.left = (splitX * 100) + '%';
      showToast('Modo Comparar: Arrastra la barra para ver Antes / Después');
    }
  });

  const viewportWrapper = document.getElementById('viewport-wrapper');

  viewportWrapper.addEventListener('mousedown', (e) => {
    if (!isComparing) return;
    isDraggingSplit = true;
    updateSplitFromEvent(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingSplit || !isComparing) return;
    updateSplitFromEvent(e);
  });

  window.addEventListener('mouseup', () => {
    isDraggingSplit = false;
  });

  function updateSplitFromEvent(e) {
    const rect = viewportWrapper.getBoundingClientRect();
    const x = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    splitX = x;
    splitLine.style.left = (x * 100) + '%';
    beautyEngine.updateParam('splitPosition', x);
  }

  // 9. MIRROR & BYPASS TOGGLES
  btnMirror.addEventListener('click', () => {
    beautyEngine.params.mirror = !beautyEngine.params.mirror;
    btnMirror.classList.toggle('active', beautyEngine.params.mirror);
    showToast(beautyEngine.params.mirror ? 'Modo Espejo Activado' : 'Modo Espejo Desactivado');
  });
  btnMirror.classList.add('active'); // Default mirrored

  btnBypass.addEventListener('click', () => {
    beautyEngine.params.bypass = !beautyEngine.params.bypass;
    btnBypass.classList.toggle('active', beautyEngine.params.bypass);
    btnBypass.querySelector('span').textContent = beautyEngine.params.bypass ? 'Filtros OFF' : 'Filtros ON';
    showToast(beautyEngine.params.bypass ? 'Bypass: Mostrando cámara original' : 'Filtros de belleza reactivados');
  });

  // 10. SNAPSHOT
  btnSnapshot.addEventListener('click', async () => {
    try {
      const dataUrl = canvasEl.toDataURL('image/png');
      if (window.electronAPI) {
        const res = await window.electronAPI.saveSnapshot(dataUrl);
        if (res.success) {
          showToast(`📸 Foto HD guardada en: ${res.filename}`);
        } else {
          showToast('Error guardando foto: ' + res.error);
        }
      }
    } catch (e) {
      showToast('Error en captura HD');
    }
  });

  // 11. RECORD VIDEO CLIP
  btnRecord.addEventListener('click', () => {
    if (!isRecording) {
      // Start recording
      const stream = canvasEl.captureStream(60);
      if (currentStream && currentStream.getAudioTracks().length > 0) {
        stream.addTrack(currentStream.getAudioTracks()[0]);
      }

      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        if (window.electronAPI) {
          const res = await window.electronAPI.saveVideoRecording(arrayBuffer);
          if (res.success) {
            showToast(`🎥 Grabación guardada en: ${res.filename}`);
          }
        }
      };

      mediaRecorder.start();
      isRecording = true;
      btnRecord.classList.add('recording');
      recLabel.textContent = 'Detener';
      showToast('Grabando video en tiempo real...');
    } else {
      // Stop recording
      mediaRecorder.stop();
      isRecording = false;
      btnRecord.classList.remove('recording');
      recLabel.textContent = 'Grabar';
    }
  });

  // 12. FULLSCREEN
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      viewportWrapper.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // 13. OBS VIRTUAL CAMERA SERVER
  async function toggleServer() {
    if (!window.electronAPI) return;

    if (!isServerRunning) {
      btnToggleServer.textContent = 'Iniciando...';
      const info = await window.electronAPI.startStreamServer(8554);
      isServerRunning = true;
      obsBrowserUrl.value = info.obsUrl;
      obsMjpegUrl.value = info.mjpegUrl;
      btnToggleServer.textContent = 'Detener Servidor';
      serverDescStatus.textContent = `Servidor activo en el puerto ${info.port}`;
      obsStatusText.textContent = `OBS Virtual: Activo (${info.port})`;
      obsDot.className = 'dot-indicator green';
      showToast('Servidor OBS iniciado. Puedes agregar la URL como Browser Source en OBS.');
    } else {
      await window.electronAPI.stopStreamServer();
      isServerRunning = false;
      btnToggleServer.textContent = 'Activar Servidor';
      serverDescStatus.textContent = 'Servidor detenido';
      obsStatusText.textContent = 'OBS Virtual: Inactivo';
      obsDot.className = 'dot-indicator blue';
      showToast('Servidor OBS detenido.');
    }
  }

  btnToggleServer.addEventListener('click', toggleServer);

  // Auto-start server for immediate plug-and-play streaming
  setTimeout(() => {
    toggleServer();
  }, 1000);

  btnCopyObs.addEventListener('click', () => {
    navigator.clipboard.writeText(obsBrowserUrl.value);
    showToast('¡URL para OBS Browser copiada al portapapeles!');
  });

  btnCopyMjpeg.addEventListener('click', () => {
    navigator.clipboard.writeText(obsMjpegUrl.value);
    showToast('¡URL MJPEG copiada al portapapeles!');
  });

  // 14. SNAP CAMERA KIT CONNECT
  function renderSnapLenses(lenses) {
    if (!snapLensesContainer || !lensesGrid) return;
    snapLensesContainer.style.display = 'block';
    lensesGrid.innerHTML = '';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'preset-pill';
    clearBtn.textContent = '❌ Sin Lente (Solo Belleza)';
    clearBtn.style.gridColumn = '1 / -1';
    clearBtn.addEventListener('click', async () => {
      await snapController.clearLens();
      showToast('Lente desactivado');
      document.querySelectorAll('.lens-card').forEach(c => c.classList.remove('active'));
    });
    lensesGrid.appendChild(clearBtn);

    lenses.forEach(lens => {
      const card = document.createElement('div');
      card.className = 'preset-pill lens-card';
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.gap = '8px';
      card.style.padding = '8px';
      card.style.cursor = 'pointer';

      if (lens.iconUrl) {
        const img = document.createElement('img');
        img.src = lens.iconUrl;
        img.style.width = '24px';
        img.style.height = '24px';
        img.style.borderRadius = '50%';
        card.appendChild(img);
      }

      const nameSpan = document.createElement('span');
      nameSpan.textContent = lens.name || ('Lente ' + lens.id.substring(0, 6));
      card.appendChild(nameSpan);

      card.addEventListener('click', async () => {
        document.querySelectorAll('.lens-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        showToast('Cargando lente: ' + (lens.name || ''));
        await snapController.applyLens(lens.id);
      });

      lensesGrid.appendChild(card);
    });
  }

  btnConnectSnap.addEventListener('click', async () => {
    const token = snapTokenInput.value.trim();
    const groupId = snapGroupIdInput.value.trim();

    if (!token) {
      showToast('Ingresa un API Token de Snap Camera Kit');
      return;
    }

    snapStatusText.textContent = 'Conectando con servidores de Snap Inc...';
    btnConnectSnap.disabled = true;

    try {
      const res = await snapController.connect(token, groupId);
      snapStatusText.textContent = 'Conectado a Snap Camera Kit. Sesión lista.';
      showToast('Snap Camera Kit conectado con éxito');

      if (currentStream) {
        await snapController.setSourceStream(currentStream);
      }

      if (res && res.lenses && res.lenses.length > 0) {
        renderSnapLenses(res.lenses);
      }
    } catch (err) {
      console.error('[Snap] Connection error:', err);
      snapStatusText.textContent = 'Error: ' + err.message;
      showToast('Fallo al conectar: ' + err.message);
    } finally {
      btnConnectSnap.disabled = false;
    }
  });

  // 15. SETTINGS LISTENERS
  selectCamera.addEventListener('change', async () => {
    await setupCameraDevice(selectCamera.value);
  });

  selectResolution.addEventListener('change', async () => {
    const val = selectResolution.value;
    if (!val) return;
    const fps = Number(selectFps.value) || 60;
    await setupCameraDevice(selectCamera.value, val, fps);
  });

  selectFps.addEventListener('change', async () => {
    const fps = Number(selectFps.value) || 30;
    const res = selectResolution.value;
    await setupCameraDevice(selectCamera.value, res, fps);
  });

  btnOpenCaptures.addEventListener('click', async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.saveSnapshot(canvasEl.toDataURL());
      if (res && res.folder) {
        window.electronAPI.openFolder(res.folder);
      }
    }
  });
});
