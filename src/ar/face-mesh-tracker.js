/**
 * FaceMeshTracker - Real-time facial landmark detection using MediaPipe FaceLandmarker
 * Provides precise coordinates for skin region, inner mouth/teeth, and eyes.
 */

class FaceMeshTracker {
  constructor() {
    this.faceLandmarker = null;
    this.isLoaded = false;
    this.isLoading = false;
    this.lastDetection = null;
    this.hasFace = false;

    // Canvas used to render the 3-channel GPU mask:
    // Red   = Face Skin Region (for bilateral smoothing)
    // Green = Inner Mouth / Teeth Region (for teeth whitening)
    // Blue  = Eyes / Sclera Region (for eye brightening)
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: false });

    // Inner mouth landmark indexes (MediaPipe 468/478 mesh)
    this.innerMouthIndices = [
      78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
      324, 318, 402, 317, 14, 87, 178, 88, 95
    ];

    // Left eye contour indices
    this.leftEyeIndices = [
      33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
    ];

    // Right eye contour indices
    this.rightEyeIndices = [
      362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398
    ];

    // Face contour indices for skin boundary
    this.faceOvalIndices = [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
      400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
      54, 103, 67, 109
    ];
  }

  async initialize() {
    if (this.isLoaded || this.isLoading) return;
    this.isLoading = true;

    try {
      if (typeof window.Vision === 'undefined') {
        console.warn('[FaceMeshTracker] window.Vision not found yet, retrying...');
        setTimeout(() => this.initialize(), 500);
        return;
      }

      console.log('[FaceMeshTracker] Initializing MediaPipe FaceLandmarker...');
      const filesetResolver = await window.Vision.FilesetResolver.forVisionTasks('../public/wasm');

      this.faceLandmarker = await window.Vision.FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: '../public/models/face_landmarker.task',
          delegate: 'GPU'
        },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 1
      });

      this.isLoaded = true;
      this.isLoading = false;
      console.log('[FaceMeshTracker] FaceLandmarker initialized successfully with GPU acceleration!');
    } catch (err) {
      console.error('[FaceMeshTracker] GPU initialization failed, attempting CPU fallback...', err);
      try {
        const filesetResolver = await window.Vision.FilesetResolver.forVisionTasks('../public/wasm');
        this.faceLandmarker = await window.Vision.FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: '../public/models/face_landmarker.task',
            delegate: 'CPU'
          },
          outputFaceBlendshapes: true,
          runningMode: 'VIDEO',
          numFaces: 1
        });
        this.isLoaded = true;
        this.isLoading = false;
        console.log('[FaceMeshTracker] FaceLandmarker initialized on CPU fallback.');
      } catch (cpuErr) {
        console.error('[FaceMeshTracker] Failed to initialize FaceLandmarker:', cpuErr);
        this.isLoading = false;
      }
    }
  }

  update(videoElement, timestamp) {
    if (!this.isLoaded || !this.faceLandmarker || !videoElement || videoElement.readyState < 2) {
      return null;
    }

    try {
      const results = this.faceLandmarker.detectForVideo(videoElement, timestamp);

      if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
        this.lastDetection = results.faceLandmarks[0];
        this.hasFace = true;
        this.renderMaskTexture(videoElement.videoWidth, videoElement.videoHeight, this.lastDetection);
      } else {
        this.hasFace = false;
        this.renderEmptyMask(videoElement.videoWidth, videoElement.videoHeight);
      }
    } catch (e) {
      // Ignore occasional frame drop
      this.hasFace = false;
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

    // Default black background (no effect)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    if (!landmarks || landmarks.length === 0) return;

    // 1. Channel RED: Face oval with smooth feathered edge (Skin Smoothing region)
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

    // Subtract eyes and mouth from the Red skin mask to keep them extra sharp
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'destination-out';

    // Cut left eye
    this.drawPolygon(ctx, landmarks, this.leftEyeIndices, width, height);
    ctx.fill();

    // Cut right eye
    this.drawPolygon(ctx, landmarks, this.rightEyeIndices, width, height);
    ctx.fill();

    // Cut inner mouth
    this.drawPolygon(ctx, landmarks, this.innerMouthIndices, width, height);
    ctx.fill();

    ctx.restore();

    // 2. Channel GREEN: Inner mouth & Teeth
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 255, 0, 1.0)';
    this.drawPolygon(ctx, landmarks, this.innerMouthIndices, width, height);
    ctx.fill();
    ctx.restore();

    // 3. Channel BLUE: Eyes / Sclera
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 255, 1.0)';
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
    this.maskCtx.fillStyle = '#000000';
    this.maskCtx.fillRect(0, 0, width, height);
  }
}

window.FaceMeshTracker = FaceMeshTracker;
