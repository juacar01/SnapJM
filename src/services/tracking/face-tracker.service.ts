import { IFaceTrackerService } from './tracker.interface';
import { TrackResult, LandmarkPoint } from '../../core/types';

declare global {
  interface Window {
    Vision?: any;
  }
}

export class FaceTrackerService implements IFaceTrackerService {
  private faceLandmarker: any = null;
  private isLoaded = false;
  private isLoading = false;
  private lastDetection: LandmarkPoint[] | null = null;
  private hasFace = false;

  // Mask Canvas (Uploaded to WebGL Texture Unit 1)
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;

  // Decoupled probe canvas (480x270) to prevent 1440p ML bottleneck
  private probeCanvas: HTMLCanvasElement;
  private probeCtx: CanvasRenderingContext2D;
  private isDetecting = false;
  private lastDetectionTimestamp = 0;

  // Facial Landmark Indices (MediaPipe Mesh)
  private readonly innerMouthIndices = [
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
    324, 318, 402, 317, 14, 87, 178, 88, 95
  ];

  private readonly leftEyeIndices = [
    33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
  ];

  private readonly rightEyeIndices = [
    362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398
  ];

  private readonly faceOvalIndices = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
    400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
    54, 103, 67, 109
  ];

  // Under-eye bags & dark circles landmarks
  private readonly leftEyeBagIndices = [
    33, 7, 163, 144, 145, 153, 154, 155, 133, 111, 116, 123, 147, 213, 192, 207, 205, 50, 101, 118, 119, 100, 36, 203
  ];

  private readonly rightEyeBagIndices = [
    362, 382, 381, 380, 374, 373, 390, 249, 263, 340, 345, 352, 376, 433, 416, 427, 425, 280, 330, 347, 348, 329, 266, 423
  ];

  constructor() {
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: false })!;

    // Probe canvas: 480x270 ensures 60 FPS throughput even on 4K/2K cameras
    this.probeCanvas = document.createElement('canvas');
    this.probeCanvas.width = 480;
    this.probeCanvas.height = 270;
    this.probeCtx = this.probeCanvas.getContext('2d', { willReadFrequently: false })!;
  }

  public async initialize(): Promise<boolean> {
    if (this.isLoaded || this.isLoading) return this.isLoaded;
    this.isLoading = true;

    try {
      if (typeof window.Vision === 'undefined') {
        console.warn('[FaceTrackerService] window.Vision not loaded yet, retrying in 300ms...');
        await new Promise(r => setTimeout(r, 300));
        return this.initialize();
      }

      console.log('[FaceTrackerService] Initializing MediaPipe FaceLandmarker with GPU delegate...');
      const filesetResolver = await window.Vision.FilesetResolver.forVisionTasks('../public/wasm');

      this.faceLandmarker = await window.Vision.FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: '../public/models/face_landmarker.task',
          delegate: 'GPU'
        },
        outputFaceBlendshapes: false,
        runningMode: 'VIDEO',
        numFaces: 1
      });

      this.isLoaded = true;
      this.isLoading = false;
      console.log('[FaceTrackerService] FaceLandmarker initialized successfully at 60 FPS!');
      return true;
    } catch (err) {
      console.warn('[FaceTrackerService] GPU delegate failed, falling back to CPU...', err);
      try {
        const filesetResolver = await window.Vision.FilesetResolver.forVisionTasks('../public/wasm');
        this.faceLandmarker = await window.Vision.FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: '../public/models/face_landmarker.task',
            delegate: 'CPU'
          },
          outputFaceBlendshapes: false,
          runningMode: 'VIDEO',
          numFaces: 1
        });
        this.isLoaded = true;
        this.isLoading = false;
        console.log('[FaceTrackerService] FaceLandmarker initialized on CPU fallback.');
        return true;
      } catch (cpuErr) {
        console.error('[FaceTrackerService] Failed to initialize FaceLandmarker:', cpuErr);
        this.isLoading = false;
        return false;
      }
    }
  }

  public isReady(): boolean {
    return this.isLoaded && this.faceLandmarker !== null;
  }

  /**
   * High performance update: downsamples full 1440p/1080p frame to 480x270 probe,
   * keeping inference time under 3.5ms so main render thread stays at 60 FPS.
   */
  public update(sourceElement: HTMLVideoElement | HTMLCanvasElement, timestamp: number): TrackResult {
    if (!this.isLoaded || !this.faceLandmarker || !sourceElement) {
      return { hasFace: false, landmarks: null, maskCanvas: null };
    }

    const readyCheck = (sourceElement as HTMLVideoElement).readyState;
    if (typeof readyCheck === 'number' && readyCheck < 2) {
      return { hasFace: false, landmarks: null, maskCanvas: null };
    }

    const width = (sourceElement instanceof HTMLVideoElement) ? sourceElement.videoWidth : sourceElement.width;
    const height = (sourceElement instanceof HTMLVideoElement) ? sourceElement.videoHeight : sourceElement.height;
    if (!width || !height) return { hasFace: false, landmarks: null, maskCanvas: null };

    // Run inference if not currently stalled and enough time has elapsed
    if (!this.isDetecting && (timestamp - this.lastDetectionTimestamp >= 24)) {
      this.isDetecting = true;
      this.lastDetectionTimestamp = timestamp;

      try {
        // Downscale to 480x270 probe canvas
        this.probeCtx.drawImage(sourceElement, 0, 0, 480, 270);
        const results = this.faceLandmarker.detectForVideo(this.probeCanvas, timestamp);

        if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
          this.lastDetection = results.faceLandmarks[0];
          this.hasFace = true;
          this.renderMaskTexture(width, height, this.lastDetection!);
        } else {
          this.hasFace = false;
          this.renderEmptyMask(width, height);
        }
      } catch (e) {
        // Drop occasionally dropped frame
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

  private renderMaskTexture(width: number, height: number, landmarks: LandmarkPoint[]): void {
    if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
      this.maskCanvas.width = width;
      this.maskCanvas.height = height;
    }

    const ctx = this.maskCtx;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    if (!landmarks || landmarks.length === 0) return;

    // 1. Channel RED: Face oval with smooth feathered Gaussian blur (Skin Smoothing region)
    ctx.save();
    ctx.filter = 'blur(16px)';
    ctx.fillStyle = 'rgba(255, 0, 0, 1.0)';
    ctx.beginPath();
    const firstOval = landmarks[this.faceOvalIndices[0]];
    ctx.moveTo(firstOval.x * width, firstOval.y * height);
    for (let i = 1; i < this.faceOvalIndices.length; i++) {
      const pt = landmarks[this.faceOvalIndices[i]];
      ctx.lineTo(pt.x * width, pt.y * height);
    }
    ctx.closePath();
    ctx.fill();

    // Subtract eyes and mouth from the Red skin mask to keep them razor sharp
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'destination-out';

    this.drawPolygon(ctx, landmarks, this.leftEyeIndices, width, height);
    ctx.fill();

    this.drawPolygon(ctx, landmarks, this.rightEyeIndices, width, height);
    ctx.fill();

    this.drawPolygon(ctx, landmarks, this.innerMouthIndices, width, height);
    ctx.fill();

    ctx.restore();

    // 2. Channel RED + GREEN (Yellow): Under-eye bags & dark circles (Feathered)
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'blur(10px)';
    ctx.fillStyle = 'rgba(255, 255, 0, 1.0)';
    this.drawPolygon(ctx, landmarks, this.leftEyeBagIndices, width, height);
    ctx.fill();
    this.drawPolygon(ctx, landmarks, this.rightEyeBagIndices, width, height);
    ctx.fill();
    ctx.restore();

    // 3. Channel GREEN: Inner mouth & Teeth (Crisp)
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 255, 0, 1.0)';
    this.drawPolygon(ctx, landmarks, this.innerMouthIndices, width, height);
    ctx.fill();
    ctx.restore();

    // 4. Channel BLUE: Eyes / Sclera (Crisp)
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 255, 1.0)';
    this.drawPolygon(ctx, landmarks, this.leftEyeIndices, width, height);
    ctx.fill();
    this.drawPolygon(ctx, landmarks, this.rightEyeIndices, width, height);
    ctx.fill();
    ctx.restore();
  }

  private drawPolygon(ctx: CanvasRenderingContext2D, landmarks: LandmarkPoint[], indices: number[], width: number, height: number): void {
    ctx.beginPath();
    const first = landmarks[indices[0]];
    ctx.moveTo(first.x * width, first.y * height);
    for (let i = 1; i < indices.length; i++) {
      const pt = landmarks[indices[i]];
      ctx.lineTo(pt.x * width, pt.y * height);
    }
    ctx.closePath();
  }

  private renderEmptyMask(width: number, height: number): void {
    if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
      this.maskCanvas.width = width;
      this.maskCanvas.height = height;
    }
    this.maskCtx.fillStyle = '#000000';
    this.maskCtx.fillRect(0, 0, width, height);
  }

  public dispose(): void {
    if (this.faceLandmarker) {
      try {
        this.faceLandmarker.close();
      } catch (e) {}
      this.faceLandmarker = null;
    }
    this.isLoaded = false;
  }
}
