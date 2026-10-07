import { AICalibrationData, LandmarkPoint } from '../../core/types';

export interface IAICalibratorService {
  update(
    sourceElement: HTMLVideoElement | HTMLCanvasElement,
    landmarks: LandmarkPoint[] | null,
    videoTrack: MediaStreamTrack | null
  ): AICalibrationData;
  forceRecalibrate(): void;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}
