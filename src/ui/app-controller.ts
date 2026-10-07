import { ICameraService } from '../services/camera/camera.interface';
import { IFaceTrackerService } from '../services/tracking/tracker.interface';
import { IAICalibratorService } from '../services/calibration/calibrator.interface';
import { IRenderEngine } from '../services/rendering/renderer.interface';
import { IStreamService } from '../services/stream/stream.interface';
import { IVirtualCamService } from '../services/vcam/vcam.interface';
import { IPresetManager } from '../services/presets/preset.interface';
import { ISettingsStorageService } from '../services/storage/storage.interface';
import { EventBus } from '../core/event-bus';
import { AICalibrationData, BeautyParams } from '../core/types';

export class AppController {
  private cameraService: ICameraService;
  private faceTracker: IFaceTrackerService;
  private calibrator: IAICalibratorService;
  private renderEngine: IRenderEngine;
  private streamService: IStreamService;
  private vcamService: IVirtualCamService;
  private presetManager: IPresetManager;
  private storageService: ISettingsStorageService;

  // DOM Elements
  private videoEl: HTMLVideoElement;
  private canvasEl: HTMLCanvasElement;
  private loaderEl: HTMLElement;
  private loaderTextEl: HTMLElement;
  private toastEl: HTMLElement;

  private fpsCounter: HTMLElement | null;
  private faceStatusText: HTMLElement | null;
  private badgeFaceDot: HTMLElement | null;
  private resStatusText: HTMLElement | null;
  private resBadge: HTMLElement | null;
  private aiCalibText: HTMLElement | null;
  private obsStatusText: HTMLElement | null;
  private obsDot: HTMLElement | null;

  // Sliders map
  private sliders: Record<string, { input: HTMLInputElement; val: HTMLElement; param: string; scale: number; unit: string; signed?: boolean; format?: (v: number) => string }> = {};

  // Persistence debounce
  private saveDebounceTimer: number | null = null;

  // Performance metrics
  private frameCount = 0;
  private lastFpsTime = performance.now();
  private isComparing = false;
  private splitX = 0.5;
  private isDraggingSplit = false;

  // Media recording
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording = false;

  constructor(
    cameraService: ICameraService,
    faceTracker: IFaceTrackerService,
    calibrator: IAICalibratorService,
    renderEngine: IRenderEngine,
    streamService: IStreamService,
    vcamService: IVirtualCamService,
    presetManager: IPresetManager,
    storageService: ISettingsStorageService
  ) {
    this.cameraService = cameraService;
    this.faceTracker = faceTracker;
    this.calibrator = calibrator;
    this.renderEngine = renderEngine;
    this.streamService = streamService;
    this.vcamService = vcamService;
    this.presetManager = presetManager;
    this.storageService = storageService;

    this.videoEl = document.getElementById('webcam-video') as HTMLVideoElement;
    this.canvasEl = document.getElementById('gl-canvas') as HTMLCanvasElement;
    this.loaderEl = document.getElementById('camera-loader') as HTMLElement;
    this.loaderTextEl = document.getElementById('camera-loader-text') as HTMLElement;
    this.toastEl = document.getElementById('toast-message') as HTMLElement;

    this.fpsCounter = document.getElementById('fps-counter');
    this.faceStatusText = document.getElementById('face-status-text');
    this.badgeFaceDot = document.querySelector('#badge-face .dot-indicator');
    this.resStatusText = document.getElementById('res-status-text');
    this.resBadge = document.getElementById('res-badge');
    this.aiCalibText = document.getElementById('ai-calib-status-text');
    this.obsStatusText = document.getElementById('obs-status-text');
    this.obsDot = document.getElementById('obs-dot');
  }

  public async initialize(): Promise<void> {
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

    // 1. Initialize MediaPipe FaceLandmarker asynchronously
    this.faceTracker.initialize().catch(err => {
      console.warn('[AppController] Face tracker initialization deferred:', err);
    });

    // 2. Load stored user preferences with fail-safe error recovery
    let savedPrefs: any = null;
    try {
      savedPrefs = this.storageService.loadPreferences();
    } catch (e) {
      console.warn('[AppController] Error reading stored preferences:', e);
    }

    // 3. Start Camera with saved preference or optimal default with fail-safe fallbacks
    const targetDeviceId = savedPrefs?.deviceId;
    const targetResolution = savedPrefs?.resolution;
    const targetFps = savedPrefs?.fps || 60;
    await this.startCamera(targetDeviceId, targetResolution, targetFps);

    // 4. Restore slider values, mirror and active preset with fail-safe sanitization
    try {
      if (savedPrefs && savedPrefs.params && Object.keys(savedPrefs.params).length > 0) {
        this.renderEngine.setParams(savedPrefs.params);
        this.syncSlidersFromParams(savedPrefs.params);

        if (savedPrefs.activePreset && savedPrefs.activePreset !== 'custom') {
          this.highlightPresetButton(savedPrefs.activePreset);
        } else {
          document.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));
        }

        if (savedPrefs.mirror !== undefined) {
          this.renderEngine.updateParam('mirror', savedPrefs.mirror);
          const btnMirror = document.getElementById('btn-mirror');
          if (btnMirror) {
            btnMirror.classList.toggle('active', savedPrefs.mirror);
          }
        }

        this.showToast('✨ Configuración y sliders restaurados');
      } else {
        // Safe default: StreamFog auto preset
        this.applyPreset('auto', false);
      }
    } catch (errParams) {
      console.warn('[AppController] Error applying saved parameters, resetting to safe auto preset:', errParams);
      this.applyPreset('auto', false);
    }

    // 5. Start 60 FPS Render Loop
    requestAnimationFrame(this.renderLoop.bind(this));

    // 6. Auto-start OBS Server
    setTimeout(() => {
      this.toggleServer().catch(() => {});
    }, 1200);
  }

  private bindLightingEvents(): void {
    EventBus.getInstance().on<AICalibrationData>('lighting:changed', (data) => {
      this.updateAICalibUI(data);
    });
  }

  private updateAICalibUI(data: AICalibrationData): void {
    const expEv = ((data.exposureGain - 1.0) * 1.5).toFixed(1);
    const expStr = (Number(expEv) >= 0 ? '+' : '') + expEv + ' EV';
    const denoisePct = Math.round(data.autoDenoiseIntensity * 100);

    if (this.aiCalibText) {
      this.aiCalibText.textContent = `AI: ${data.kelvin}K • ${expStr} • Denoise ${denoisePct}%`;
    }

    const telKelvin = document.getElementById('telemetry-kelvin');
    if (telKelvin) {
      const tone = data.kelvin > 6000 ? 'Fría (Corregida)' : (data.kelvin < 4500 ? 'Cálida (Corregida)' : 'Óptimo Neutro');
      telKelvin.textContent = `${data.kelvin} K • ${tone}`;
    }

    const telExposure = document.getElementById('telemetry-exposure');
    if (telExposure) {
      telExposure.textContent = `${expStr} • Normalizado`;
    }

    const telDenoise = document.getElementById('telemetry-denoise');
    if (telDenoise) {
      telDenoise.textContent = `Auto (${denoisePct}%) • Activo`;
    }

    const telLighting = document.getElementById('telemetry-lighting');
    if (telLighting) {
      if (data.lightingChanged) {
        telLighting.textContent = '⚡ Cambio detectado • Re-ajustando';
        telLighting.className = 'telemetry-badge';
      } else {
        telLighting.textContent = 'Continuo • En tiempo real';
        telLighting.className = 'telemetry-badge green';
      }
    }
  }

  private async startCamera(deviceId?: string, resolution?: string, fps: number = 60): Promise<void> {
    this.loaderEl.style.display = 'flex';
    this.loaderTextEl.innerHTML = `<div class="spinner"></div><p id="camera-loader-msg">Configurando sensor de cámara en ${fps} FPS...</p>`;

    // Step A: Hardware presence check
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await this.cameraService.enumerateDevices();
    } catch (e) {
      console.warn('[AppController] Failed to enumerate camera devices:', e);
    }

    if (devices.length === 0) {
      this.showCameraDisconnectedUI('No se detectó ninguna cámara de video disponible en tu equipo.');
      return;
    }

    // Step B: Hardware change verification (if saved camera was disconnected or unplugged)
    let selectedDeviceId = deviceId;
    if (selectedDeviceId && !devices.some(d => d.deviceId === selectedDeviceId)) {
      console.warn(`[AppController] Stored camera '${selectedDeviceId}' not found. Falling back to primary device.`);
      this.showToast('⚠️ Cámara guardada no detectada. Conectando a cámara disponible...');
      selectedDeviceId = devices[0].deviceId;
    }

    // Step C: Progressive multi-tier fail-safe stream initiation
    let stream: MediaStream | null = null;
    let actualFps = fps;

    // Tier 1: Try requested device, resolution, and FPS
    try {
      stream = await this.cameraService.startStream(selectedDeviceId, resolution, fps);
    } catch (errTier1: any) {
      console.warn('[AppController] Tier 1 camera init failed (requested resolution/fps):', errTier1);

      // Tier 2: Try same device with auto-resolution at 30 FPS
      try {
        actualFps = 30;
        this.showToast('⚠️ Ajustando a resolución y tasa de cuadros compatibles...');
        stream = await this.cameraService.startStream(selectedDeviceId, undefined, 30);
      } catch (errTier2: any) {
        console.warn('[AppController] Tier 2 camera init failed (device-specific fallback):', errTier2);

        // Tier 3: Try generic video stream on any available camera
        try {
          actualFps = 30;
          stream = await this.cameraService.startStream(undefined, undefined, 30);
          this.showToast('⚠️ Conectado con controlador de video seguro.');
        } catch (errTier3: any) {
          console.error('[AppController] Tier 3 all camera fallbacks failed:', errTier3);
          this.showCameraDisconnectedUI(errTier3.message || 'El dispositivo está ocupado por otra aplicación o no tiene permisos.');
          return;
        }
      }
    }

    if (!stream) {
      this.showCameraDisconnectedUI('No se pudo inicializar el flujo de video.');
      return;
    }

    // Step D: Attach stream to videoEl & verify metadata
    try {
      this.videoEl.srcObject = stream;

      await new Promise<void>((resolve) => {
        let resolved = false;
        const onLoaded = () => {
          if (resolved) return;
          resolved = true;
          this.videoEl.removeEventListener('loadedmetadata', onLoaded);
          this.videoEl.play().catch(() => {});
          this.loaderEl.style.display = 'none';

          const actualW = this.videoEl.videoWidth || 1280;
          const actualH = this.videoEl.videoHeight || 720;
          this.canvasEl.width = actualW;
          this.canvasEl.height = actualH;

          const resLabel = actualW >= 1920 ? '1080p Full HD' : (actualW >= 1280 ? '720p HD' : `${actualW}p`);
          if (this.resStatusText) this.resStatusText.textContent = `${actualW} × ${actualH} (${resLabel})`;
          this.showToast(`Cámara activa a ${actualFps} FPS (${actualW} × ${actualH})`);

          this.populateResolutions(actualFps);
          resolve();
        };

        if (this.videoEl.readyState >= 1 && this.videoEl.videoWidth > 0) {
          onLoaded();
        } else {
          this.videoEl.addEventListener('loadedmetadata', onLoaded, { once: true });
          setTimeout(() => {
            if (!resolved) onLoaded();
          }, 1200);
        }
      });

      // Step E: Update dropdown with verified active track
      const currentTrack = this.cameraService.getCurrentTrack();
      const currentSettings = currentTrack && typeof currentTrack.getSettings === 'function' ? currentTrack.getSettings() : null;
      const activeId = (currentSettings && currentSettings.deviceId) || selectedDeviceId;
      await this.populateCameraDropdown(activeId);

      // Step F: Hot-unplug hardware listener (fail-safe recovery)
      if (currentTrack) {
        currentTrack.onended = () => {
          console.warn('[AppController] Active video track ended (hardware disconnected).');
          this.handleCameraDisconnection();
        };
      }
    } catch (err: any) {
      console.error('[AppController] Error rendering camera stream:', err);
      this.showCameraDisconnectedUI(err.message || 'Error al procesar el flujo de video.');
    }
  }

  private showCameraDisconnectedUI(message: string): void {
    this.loaderEl.style.display = 'flex';
    this.loaderTextEl.innerHTML = `
      <div style="text-align:center;max-width:320px;padding:16px;">
        <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="#ef4444" stroke-width="2" style="margin-bottom:12px;display:inline-block">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"></path>
        </svg>
        <div style="font-weight:600;font-size:15px;color:#f87171;margin-bottom:6px">Problema con la Cámara</div>
        <div style="font-size:12px;color:#94a3b8;line-height:1.4;margin-bottom:16px">${message}</div>
        <button id="btn-retry-camera" class="tool-btn" style="background:#3b82f6;color:#ffffff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-weight:600;margin:0 auto;display:inline-flex;align-items:center;gap:6px">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          Reintentar Conexión
        </button>
      </div>
    `;

    const btnRetry = document.getElementById('btn-retry-camera');
    if (btnRetry) {
      btnRetry.addEventListener('click', () => {
        this.showToast('Reintentando conectar a la cámara...');
        this.startCamera();
      });
    }
  }

  private async handleCameraDisconnection(): Promise<void> {
    this.showToast('⚠️ Cámara desconectada. Buscando dispositivo de respaldo...');
    try {
      const devices = await this.cameraService.enumerateDevices();
      if (devices.length > 0) {
        await this.startCamera(devices[0].deviceId, undefined, 60);
        this.showToast(`✅ Cambiado a cámara de respaldo: ${devices[0].label || 'Cámara secundaria'}`);
      } else {
        this.showCameraDisconnectedUI('Cámara desconectada. Conecta una cámara USB para continuar.');
      }
    } catch (e) {
      this.showCameraDisconnectedUI('Error al buscar dispositivos de cámara.');
    }
  }

  private async populateCameraDropdown(selectedDeviceId?: string): Promise<void> {
    const selectCamera = document.getElementById('select-camera') as HTMLSelectElement;
    if (!selectCamera) return;

    try {
      const devices = await this.cameraService.enumerateDevices();
      const currentTrack = this.cameraService.getCurrentTrack();
      const trackSettings = currentTrack && typeof currentTrack.getSettings === 'function' ? currentTrack.getSettings() : null;
      const activeId = selectedDeviceId || (trackSettings ? trackSettings.deviceId : null) || selectCamera.value;

      selectCamera.innerHTML = '';

      devices.forEach((device, index) => {
        const opt = document.createElement('option');
        opt.value = device.deviceId;
        opt.textContent = device.label || `Cámara ${index + 1}`;
        if (activeId && device.deviceId === activeId) {
          opt.selected = true;
        }
        selectCamera.appendChild(opt);
      });

      if (activeId && [...selectCamera.options].some(o => o.value === activeId)) {
        selectCamera.value = activeId;
      }
    } catch (e) {
      console.warn('[AppController] Error populating camera dropdown:', e);
    }
  }

  private populateResolutions(currentFpsOverride?: number): void {
    const track = this.cameraService.getCurrentTrack();
    if (!track) return;

    const selectResolution = document.getElementById('select-resolution') as HTMLSelectElement;
    const selectFps = document.getElementById('select-fps') as HTMLSelectElement;
    if (!selectResolution || !selectFps) return;

    const info = this.cameraService.detectCapabilities(track);

    selectResolution.innerHTML = '';
    info.resolutions.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      selectResolution.appendChild(opt);
    });

    const currentResVal = `${this.videoEl.videoWidth}x${this.videoEl.videoHeight}`;
    if ([...selectResolution.options].some(o => o.value === currentResVal)) {
      selectResolution.value = currentResVal;
    }

    if (this.resBadge) {
      this.resBadge.textContent = `${info.resolutions.length} soportadas (Sensor: ${info.maxW}×${info.maxH})`;
    }

    const currentFps = currentFpsOverride !== undefined ? currentFpsOverride : (Number(selectFps.value) || 60);
    selectFps.innerHTML = '';
    if (info.maxFps >= 60) {
      selectFps.innerHTML += `<option value="60" ${currentFps === 60 ? 'selected' : ''}>60 FPS (Máxima Fluidez)</option>`;
      selectFps.innerHTML += `<option value="30" ${currentFps === 30 ? 'selected' : ''}>30 FPS (Modo Ahorro de Recursos)</option>`;
    } else if (info.maxFps >= 30) {
      selectFps.innerHTML += `<option value="${info.maxFps}" selected>${info.maxFps} FPS (Máximo Soportado)</option>`;
      if (info.maxFps > 30) {
        selectFps.innerHTML += `<option value="30" ${currentFps === 30 ? 'selected' : ''}>30 FPS (Estándar)</option>`;
      }
    } else {
      selectFps.innerHTML += `<option value="${info.maxFps}" selected>${info.maxFps} FPS</option>`;
    }
  }

  // ----------------------------------------------------
  // MAIN 60 FPS GPU RENDER LOOP (Zero Stalls)
  // ----------------------------------------------------
  private renderLoop(): void {
    requestAnimationFrame(this.renderLoop.bind(this));

    if (!this.videoEl || this.videoEl.readyState < 2) return;

    const now = performance.now();

    // 1. Decoupled Face Landmark Tracking
    const trackResult = this.faceTracker.update(this.videoEl, now);

    if (trackResult && trackResult.hasFace) {
      if (this.badgeFaceDot) this.badgeFaceDot.className = 'dot-indicator green';
      if (this.faceStatusText) this.faceStatusText.textContent = 'Rostro detectado';
    } else {
      if (this.badgeFaceDot) this.badgeFaceDot.className = 'dot-indicator blue';
      if (this.faceStatusText) this.faceStatusText.textContent = 'Buscando rostro...';
    }

    // 2. Real-time AI Lighting & Base Calibration
    const track = this.cameraService.getCurrentTrack();
    const aiCalib = this.calibrator.update(this.videoEl, trackResult ? trackResult.landmarks : null, track);

    // Dynamic AI calibration status text & studio telemetry
    if (this.frameCount % 20 === 0) {
      this.updateAICalibUI(aiCalib);
    }

    // 3. WebGL GPU 60 FPS Render Pass
    this.renderEngine.render(this.videoEl, trackResult ? trackResult.maskCanvas : null, aiCalib);

    // 4. Smooth 60 FPS Counter
    this.frameCount++;
    if (now - this.lastFpsTime >= 1000) {
      if (this.fpsCounter) {
        this.fpsCounter.textContent = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime)).toString();
      }
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    // 5. Stream Frame to Windows DirectShow Virtual Camera & OBS Server
    if (this.vcamService.isRunning()) {
      this.vcamService.sendFrame(this.canvasEl);
    }
    if (this.streamService.isRunning()) {
      this.streamService.sendFrame(this.canvasEl);
    }
  }

  private applyPreset(name: string, persist: boolean = true): void {
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

  private highlightPresetButton(name: string): void {
    document.querySelectorAll('.preset-pill').forEach(b => {
      b.classList.remove('active');
      if ((b as HTMLElement).dataset.preset === name) {
        b.classList.add('active');
      }
    });
  }

  private syncSlidersFromParams(params: Partial<BeautyParams>): void {
    if (!params || typeof params !== 'object') return;
    Object.keys(params).forEach(param => {
      try {
        const slider = Object.values(this.sliders).find(s => s.param === param);
        if (slider && slider.input && typeof (params as any)[param] === 'number') {
          const val = (params as any)[param];
          if (isNaN(val) || !isFinite(val)) return;
          const displayVal = Math.round(val / slider.scale);
          slider.input.value = displayVal.toString();
          if (slider.val) {
            if (slider.format) {
              slider.val.textContent = slider.format(displayVal);
            } else {
              slider.val.textContent = (slider.signed && displayVal > 0 ? '+' : '') + displayVal + slider.unit;
            }
          }
        }
      } catch (err) {
        console.warn(`[AppController] Error syncing slider '${param}':`, err);
      }
    });
  }

  private scheduleSavePreferences(activePreset?: string): void {
    if (this.saveDebounceTimer !== null) {
      window.clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = window.setTimeout(() => {
      this.saveDebounceTimer = null;
      this.saveCurrentPreferences(activePreset);
    }, 250);
  }

  private saveCurrentPreferences(activePreset?: string): void {
    const selectCamera = document.getElementById('select-camera') as HTMLSelectElement | null;
    const selectResolution = document.getElementById('select-resolution') as HTMLSelectElement | null;
    const selectFps = document.getElementById('select-fps') as HTMLSelectElement | null;

    const currentTrack = this.cameraService.getCurrentTrack();
    const trackSettings = currentTrack && typeof currentTrack.getSettings === 'function' ? currentTrack.getSettings() : null;
    const deviceId = (selectCamera && selectCamera.value) || (trackSettings ? trackSettings.deviceId : undefined);
    const resolution = selectResolution ? selectResolution.value : undefined;
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

  private initSliders(): void {
    this.sliders = {
      smooth: { input: document.getElementById('sl-smooth') as HTMLInputElement, val: document.getElementById('val-smooth') as HTMLElement, param: 'smoothIntensity', scale: 0.01, unit: '%' },
      radius: { input: document.getElementById('sl-radius') as HTMLInputElement, val: document.getElementById('val-radius') as HTMLElement, param: 'smoothRadius', scale: 0.1, unit: '' },
      edge: { input: document.getElementById('sl-edge') as HTMLInputElement, val: document.getElementById('val-edge') as HTMLElement, param: 'edgeThreshold', scale: 0.01, unit: '%' },

      uniformity: { input: document.getElementById('sl-uniformity') as HTMLInputElement, val: document.getElementById('val-uniformity') as HTMLElement, param: 'uniformity', scale: 0.01, unit: '%' },
      antiRedness: { input: document.getElementById('sl-anti-redness') as HTMLInputElement, val: document.getElementById('val-anti-redness') as HTMLElement, param: 'antiRedness', scale: 0.01, unit: '%' },
      sharpen: { input: document.getElementById('sl-sharpen') as HTMLInputElement, val: document.getElementById('val-sharpen') as HTMLElement, param: 'sharpen', scale: 0.01, unit: '%' },
      toneTint: {
        input: document.getElementById('sl-tone-tint') as HTMLInputElement,
        val: document.getElementById('val-tone-tint') as HTMLElement,
        param: 'skinToneTint',
        scale: 0.01,
        unit: '',
        format: (v) => v < 35 ? 'Porcelana Fría' : (v > 65 ? 'Durazno Cálido' : 'Natural Luminoso')
      },

      teeth: { input: document.getElementById('sl-teeth') as HTMLInputElement, val: document.getElementById('val-teeth') as HTMLElement, param: 'teethWhitening', scale: 0.01, unit: '%' },
      teethBright: { input: document.getElementById('sl-teeth-bright') as HTMLInputElement, val: document.getElementById('val-teeth-bright') as HTMLElement, param: 'teethBrightness', scale: 0.01, unit: '%' },
      eyes: { input: document.getElementById('sl-eyes') as HTMLInputElement, val: document.getElementById('val-eyes') as HTMLElement, param: 'eyeBrightening', scale: 0.01, unit: '%' },
      eyeBags: { input: document.getElementById('sl-eye-bags') as HTMLInputElement, val: document.getElementById('val-eye-bags') as HTMLElement, param: 'concealer', scale: 0.01, unit: '%' },

      brightness: { input: document.getElementById('sl-brightness') as HTMLInputElement, val: document.getElementById('val-brightness') as HTMLElement, param: 'brightness', scale: 0.01, unit: '%', signed: true },
      contrast: { input: document.getElementById('sl-contrast') as HTMLInputElement, val: document.getElementById('val-contrast') as HTMLElement, param: 'contrast', scale: 0.01, unit: '' },
      saturation: { input: document.getElementById('sl-saturation') as HTMLInputElement, val: document.getElementById('val-saturation') as HTMLElement, param: 'saturation', scale: 0.01, unit: '' },
      temp: { input: document.getElementById('sl-temp') as HTMLInputElement, val: document.getElementById('val-temp') as HTMLElement, param: 'temperature', scale: 0.01, unit: '', signed: true },
      glow: { input: document.getElementById('sl-glow') as HTMLInputElement, val: document.getElementById('val-glow') as HTMLElement, param: 'glow', scale: 0.01, unit: '%' },
      vignette: { input: document.getElementById('sl-vignette') as HTMLInputElement, val: document.getElementById('val-vignette') as HTMLElement, param: 'vignette', scale: 0.01, unit: '%' }
    };

    Object.keys(this.sliders).forEach(key => {
      const s = this.sliders[key];
      if (!s.input) return;

      s.input.addEventListener('input', () => {
        const numVal = parseFloat(s.input.value);
        const scaledVal = numVal * s.scale;
        this.renderEngine.updateParam(s.param as any, scaledVal);

        if (s.format) {
          s.val.textContent = s.format(numVal);
        } else {
          s.val.textContent = (s.signed && numVal > 0 ? '+' : '') + numVal + s.unit;
        }

        // Custom tweaking removes preset pill highlight
        document.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));

        // Debounced persistence of current parameters
        this.scheduleSavePreferences('custom');
      });
    });
  }

  private bindToolbarButtons(): void {
    const btnCompare = document.getElementById('btn-compare');
    const btnMirror = document.getElementById('btn-mirror');
    const btnAutoEnhance = document.getElementById('btn-auto-enhance');
    const btnBypass = document.getElementById('btn-bypass');
    const btnSnapshot = document.getElementById('btn-snapshot');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnRecalibrate = document.getElementById('btn-recalibrate-lighting');
    const splitContainer = document.getElementById('split-slider-container');
    const splitLine = document.getElementById('split-line');
    const viewportWrapper = document.getElementById('viewport-wrapper');

    if (btnRecalibrate) {
      btnRecalibrate.addEventListener('click', () => {
        this.calibrator.forceRecalibrate();
        this.showToast('✨ Sensor recalibrado: Nueva exposición y balance calculados');
      });
    }

    if (btnAutoEnhance) {
      btnAutoEnhance.addEventListener('click', () => {
        this.calibrator.forceRecalibrate();
        this.applyPreset('auto', true);
        this.showToast('✨ Corrección Automática Aplicada: 60 FPS Calidad Óptima');
      });
    }

    if (btnCompare && splitContainer && splitLine) {
      btnCompare.addEventListener('click', () => {
        this.isComparing = !this.isComparing;
        btnCompare.classList.toggle('active', this.isComparing);
        splitContainer.style.display = this.isComparing ? 'block' : 'none';
        this.renderEngine.updateParam('splitPosition', this.isComparing ? this.splitX : -1.0);
        if (this.isComparing) {
          splitLine.style.left = (this.splitX * 100) + '%';
          this.showToast('Modo Comparar: Arrastra la barra para ver Antes / Después');
        }
      });
    }

    if (viewportWrapper && splitLine) {
      viewportWrapper.addEventListener('mousedown', () => {
        if (!this.isComparing) return;
        this.isDraggingSplit = true;
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDraggingSplit || !this.isComparing) return;
        const rect = viewportWrapper.getBoundingClientRect();
        const x = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
        this.splitX = x;
        splitLine.style.left = (x * 100) + '%';
        this.renderEngine.updateParam('splitPosition', x);
      });

      window.addEventListener('mouseup', () => {
        this.isDraggingSplit = false;
      });
    }

    if (btnMirror) {
      btnMirror.addEventListener('click', () => {
        const cur = this.renderEngine.getParams().mirror;
        this.renderEngine.updateParam('mirror', !cur);
        btnMirror.classList.toggle('active', !cur);
        this.saveCurrentPreferences();
        this.showToast(!cur ? 'Modo Espejo Activado' : 'Modo Espejo Desactivado');
      });
      btnMirror.classList.add('active');
    }

    if (btnBypass) {
      btnBypass.addEventListener('click', () => {
        const cur = this.renderEngine.getParams().bypass;
        this.renderEngine.updateParam('bypass', !cur);
        btnBypass.classList.toggle('active', !cur);
        const span = btnBypass.querySelector('span');
        if (span) span.textContent = !cur ? 'Filtros OFF' : 'Filtros ON';
        this.showToast(!cur ? 'Bypass: Mostrando cámara original' : 'Filtros reactivados');
      });
    }

    if (btnSnapshot) {
      btnSnapshot.addEventListener('click', async () => {
        try {
          const dataUrl = this.canvasEl.toDataURL('image/png');
          if ((window as any).electronAPI) {
            const res = await (window as any).electronAPI.saveSnapshot(dataUrl);
            if (res.success) {
              this.showToast(`📸 Foto HD guardada en: ${res.filename}`);
            }
          }
        } catch (e) {
          this.showToast('Error en captura HD');
        }
      });
    }

    if (btnFullscreen && viewportWrapper) {
      btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          viewportWrapper.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }
  }

  private bindPresetButtons(): void {
    document.querySelectorAll('.preset-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const presetName = (btn as HTMLElement).dataset.preset;
        if (presetName) this.applyPreset(presetName, true);
      });
    });
  }

  private async bindVCamControls(): Promise<void> {
    const btnToggleVCam = document.getElementById('btn-toggle-vcam');
    const btnInstallVCam = document.getElementById('btn-install-vcam');

    if (btnToggleVCam) {
      btnToggleVCam.addEventListener('click', () => this.toggleVCam());
    }

    if (btnInstallVCam) {
      btnInstallVCam.addEventListener('click', () => this.installVCamDriver());
    }

    // Initial driver status check
    try {
      const status = await this.vcamService.getStatus();
      this.updateVCamUI(status.installed, status.running);
    } catch (e) {
      console.warn('[AppController] Error checking virtual cam driver status:', e);
    }
  }

  private updateVCamUI(installed: boolean, running: boolean): void {
    const btnToggleVCam = document.getElementById('btn-toggle-vcam');
    const vcamToggleLabel = document.getElementById('vcam-toggle-label');
    const btnInstallVCam = document.getElementById('btn-install-vcam');
    const vcamInstallContainer = document.getElementById('vcam-install-container');
    const vcamDriverBadge = document.getElementById('vcam-driver-badge');
    const vcamDriverText = document.getElementById('vcam-driver-text');
    const vcamStreamStatus = document.getElementById('vcam-stream-status');
    const vcamTelemetryStats = document.getElementById('vcam-telemetry-stats');

    if (vcamDriverBadge && vcamDriverText) {
      if (installed) {
        vcamDriverBadge.className = 'vcam-badge installed';
        vcamDriverText.textContent = 'Instalado (DirectShow)';
        if (vcamInstallContainer) vcamInstallContainer.style.display = 'none';
      } else {
        vcamDriverBadge.className = 'vcam-badge not-installed';
        vcamDriverText.textContent = 'Controlador No Instalado';
        if (vcamInstallContainer) vcamInstallContainer.style.display = 'block';
      }
    }

    if (btnToggleVCam && vcamToggleLabel) {
      if (running) {
        btnToggleVCam.className = 'vcam-toggle-btn stop';
        vcamToggleLabel.textContent = 'Detener Cámara Virtual';
        if (vcamStreamStatus) {
          vcamStreamStatus.textContent = 'Transmitiendo en Vivo (60 FPS)';
          vcamStreamStatus.className = 'telemetry-badge green';
        }
        if (this.obsStatusText) this.obsStatusText.textContent = 'Cámara Virtual: Activa (60 FPS)';
        if (this.obsDot) this.obsDot.className = 'dot-indicator green';
      } else {
        btnToggleVCam.className = 'vcam-toggle-btn start';
        vcamToggleLabel.textContent = 'Iniciar Cámara Virtual de Windows';
        if (vcamStreamStatus) {
          vcamStreamStatus.textContent = 'Inactiva';
          vcamStreamStatus.className = 'telemetry-badge';
        }
        if (this.obsStatusText) this.obsStatusText.textContent = 'Cámara Virtual: OFF';
        if (this.obsDot) this.obsDot.className = 'dot-indicator blue';
      }
    }
  }

  private async toggleVCam(): Promise<void> {
    const btnToggleVCam = document.getElementById('btn-toggle-vcam');

    if (!this.vcamService.isRunning()) {
      let status = await this.vcamService.getStatus();
      if (!status.installed) {
        this.showToast('ℹ️ Instalando controlador DirectShow en Windows (1 Clic)...');
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
        this.showToast('✅ SnapJM Virtual Camera ACTIVA para Zoom, Meet, Teams y Discord');
      } else {
        this.showToast('❌ Error al iniciar la Cámara Virtual de Windows.');
      }
    } else {
      await this.vcamService.stop();
      this.updateVCamUI(true, false);
      this.showToast('Cámara Virtual de Windows detenida.');
    }
  }

  private async installVCamDriver(): Promise<void> {
    const btnInstallVCam = document.getElementById('btn-install-vcam');
    if (btnInstallVCam) {
      btnInstallVCam.innerHTML = '<span>Instalando controlador en Windows...</span>';
    }

    try {
      this.showToast('Acepta los permisos de Administrador en el diálogo de Windows...');
      const res = await this.vcamService.installDriver();
      if (res.success) {
        this.showToast('✅ Controlador DirectShow registrado con éxito en Windows.');
      } else {
        this.showToast(`❌ ${res.error || 'No se pudo registrar el controlador'}`);
      }
    } catch (e: any) {
      this.showToast(`❌ Error al instalar controlador: ${e.message}`);
    } finally {
      // Ground truth sync
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

  private bindOBSControls(): void {
    const btnToggleServer = document.getElementById('btn-toggle-server');
    const btnCopyObs = document.getElementById('btn-copy-obs');
    const btnCopyMjpeg = document.getElementById('btn-copy-mjpeg');
    const obsBrowserUrl = document.getElementById('obs-browser-url') as HTMLInputElement;
    const obsMjpegUrl = document.getElementById('obs-mjpeg-url') as HTMLInputElement;

    if (btnToggleServer) {
      btnToggleServer.addEventListener('click', () => this.toggleServer());
    }

    if (btnCopyObs && obsBrowserUrl) {
      btnCopyObs.addEventListener('click', () => {
        navigator.clipboard.writeText(obsBrowserUrl.value);
        this.showToast('¡URL OBS Browser copiada!');
      });
    }

    if (btnCopyMjpeg && obsMjpegUrl) {
      btnCopyMjpeg.addEventListener('click', () => {
        navigator.clipboard.writeText(obsMjpegUrl.value);
        this.showToast('¡URL MJPEG copiada!');
      });
    }
  }

  private async toggleServer(): Promise<void> {
    const btnToggleServer = document.getElementById('btn-toggle-server');
    const serverDescStatus = document.getElementById('server-desc-status');
    const obsBrowserUrl = document.getElementById('obs-browser-url') as HTMLInputElement;
    const obsMjpegUrl = document.getElementById('obs-mjpeg-url') as HTMLInputElement;

    if (!this.streamService.isRunning()) {
      try {
        const info = await this.streamService.startServer(8554);
        if (btnToggleServer) btnToggleServer.textContent = 'Detener Servidor';
        if (serverDescStatus) serverDescStatus.textContent = `Servidor activo en el puerto ${info.port}`;
        if (this.obsStatusText) this.obsStatusText.textContent = `OBS Virtual: Activo (${info.port})`;
        if (this.obsDot) this.obsDot.className = 'dot-indicator green';
        if (obsBrowserUrl) obsBrowserUrl.value = info.obsUrl;
        if (obsMjpegUrl) obsMjpegUrl.value = info.mjpegUrl;
      } catch (e) {}
    } else {
      await this.streamService.stopServer();
      if (btnToggleServer) btnToggleServer.textContent = 'Activar Servidor';
      if (serverDescStatus) serverDescStatus.textContent = 'Servidor detenido';
      if (this.obsStatusText) this.obsStatusText.textContent = 'OBS Virtual: Inactivo';
      if (this.obsDot) this.obsDot.className = 'dot-indicator blue';
    }
  }

  private bindSettingsControls(): void {
    const selectCamera = document.getElementById('select-camera') as HTMLSelectElement;
    const selectResolution = document.getElementById('select-resolution') as HTMLSelectElement;
    const selectFps = document.getElementById('select-fps') as HTMLSelectElement;
    const btnOpenCaptures = document.getElementById('btn-open-captures');

    if (selectCamera) {
      selectCamera.addEventListener('change', async () => {
        const deviceId = selectCamera.value;
        const fps = selectFps ? Number(selectFps.value) || 60 : 60;
        this.showToast('Cambiando de cámara...');
        await this.startCamera(deviceId, undefined, fps);
        this.saveCurrentPreferences();
      });
    }

    if (selectResolution) {
      selectResolution.addEventListener('change', async () => {
        const val = selectResolution.value;
        if (!val) return;
        const deviceId = selectCamera ? selectCamera.value : undefined;
        const fps = selectFps ? Number(selectFps.value) || 60 : 60;
        this.showToast(`Ajustando resolución a ${val}...`);
        await this.startCamera(deviceId, val, fps);
        this.saveCurrentPreferences();
      });
    }

    if (selectFps) {
      selectFps.addEventListener('change', async () => {
        const fps = Number(selectFps.value) || 60;
        const deviceId = selectCamera ? selectCamera.value : undefined;
        const val = selectResolution ? selectResolution.value : undefined;
        this.showToast(`Ajustando tasa de cuadros a ${fps} FPS...`);
        await this.startCamera(deviceId, val, fps);
        this.saveCurrentPreferences();
      });
    }

    if (btnOpenCaptures) {
      btnOpenCaptures.addEventListener('click', async () => {
        if ((window as any).electronAPI) {
          const api = (window as any).electronAPI;
          if (api.openCapturesFolder) {
            await api.openCapturesFolder();
            this.showToast('Carpeta de capturas abierta');
          } else if (api.openFolder) {
            const res = await api.saveSnapshot(this.canvasEl.toDataURL('image/png'));
            if (res && res.folder) {
              await api.openFolder(res.folder);
            }
          }
        }
      });
    }

    if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        await this.populateCameraDropdown();

        // Fail-safe auto-reconnection: If camera was unplugged or in error state, auto-reconnect!
        const curTrack = this.cameraService.getCurrentTrack();
        if (!curTrack || curTrack.readyState === 'ended' || this.loaderEl.style.display === 'flex') {
          const devices = await this.cameraService.enumerateDevices();
          if (devices.length > 0) {
            this.showToast('🔌 Nuevo sensor de cámara detectado. Conectando...');
            await this.startCamera(devices[0].deviceId);
          }
        }
      });
    }
  }

  private bindRecording(): void {
    const btnRecord = document.getElementById('btn-record');
    const recLabel = document.getElementById('rec-label');
    if (!btnRecord) return;

    btnRecord.addEventListener('click', () => {
      if (!this.isRecording) {
        const stream = this.canvasEl.captureStream(60);
        const curStream = this.cameraService.getCurrentStream();
        if (curStream && curStream.getAudioTracks().length > 0) {
          stream.addTrack(curStream.getAudioTracks()[0]);
        }

        this.recordedChunks = [];
        try {
          this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
        } catch (e) {
          this.mediaRecorder = new MediaRecorder(stream);
        }

        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.recordedChunks.push(e.data);
        };

        this.mediaRecorder.onstop = async () => {
          const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          if ((window as any).electronAPI && (window as any).electronAPI.saveVideoRecording) {
            const res = await (window as any).electronAPI.saveVideoRecording(arrayBuffer);
            if (res && res.success) {
              this.showToast(`🎥 Grabación guardada en: ${res.filename}`);
            }
          }
        };

        this.mediaRecorder.start();
        this.isRecording = true;
        btnRecord.classList.add('recording');
        if (recLabel) recLabel.textContent = 'Detener';
        this.showToast('Grabando video en tiempo real...');
      } else {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
        this.isRecording = false;
        btnRecord.classList.remove('recording');
        if (recLabel) recLabel.textContent = 'Grabar';
      }
    });
  }

  private bindWindowControls(): void {
    const btnMin = document.getElementById('btn-minimize');
    const btnMax = document.getElementById('btn-maximize');
    const btnClose = document.getElementById('btn-close');

    if ((window as any).electronAPI) {
      if (btnMin) btnMin.addEventListener('click', () => (window as any).electronAPI.minimize());
      if (btnMax) btnMax.addEventListener('click', () => (window as any).electronAPI.maximize());
      if (btnClose) btnClose.addEventListener('click', () => (window as any).electronAPI.close());
    }
  }

  private bindTabs(): void {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const target = document.getElementById((btn as HTMLElement).dataset.tab || '');
        if (target) target.classList.add('active');
      });
    });
  }

  private showToast(message: string, duration = 3000): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, duration);
  }
}
