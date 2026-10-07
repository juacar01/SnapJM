import { bootstrapCameraKit, createMediaStreamSource } from '@snap/camera-kit';

if (typeof window !== 'undefined') {
  window.SnapCameraKit = {
    bootstrapCameraKit,
    createMediaStreamSource
  };
}

export { bootstrapCameraKit, createMediaStreamSource };
