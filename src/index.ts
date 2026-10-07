/**
 * Application Bootstrap & Dependency Injection Root
 * Adheres to SOLID principles: Dependency Inversion, Single Responsibility,
 * Open/Closed, Liskov Substitution, Interface Segregation.
 */

import { CameraService } from './services/camera/camera.service';
import { FaceTrackerService } from './services/tracking/face-tracker.service';
import { AICalibratorService } from './services/calibration/ai-calibrator.service';
import { BeautyEngineService } from './services/rendering/beauty-engine.service';
import { StreamService } from './services/stream/stream.service';
import { VirtualCamService } from './services/vcam/vcam.service';
import { PresetManager } from './services/presets/preset.manager';
import { LocalStorageSettingsService } from './services/storage/storage.service';
import { AppController } from './ui/app-controller';

document.addEventListener('DOMContentLoaded', async () => {
  const canvasEl = document.getElementById('gl-canvas') as HTMLCanvasElement;

  // 1. Instantiate concrete service implementations
  const cameraService = new CameraService();
  const faceTrackerService = new FaceTrackerService();
  const aiCalibratorService = new AICalibratorService();
  const renderEngine = new BeautyEngineService(canvasEl);
  const streamService = new StreamService();
  const vcamService = new VirtualCamService();
  const presetManager = new PresetManager();
  const storageService = new LocalStorageSettingsService();

  // 2. Inject dependencies into AppController (Dependency Inversion Principle)
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

  // 3. Initialize application
  await app.initialize();
  console.log('[SnapJM] Modern SOLID TypeScript Architecture initialized at 60 FPS');
});
