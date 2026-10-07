import { BeautyParams, AICalibrationData } from '../../core/types';

export interface IRenderEngine {
  render(
    videoElement: HTMLVideoElement | HTMLCanvasElement,
    maskCanvas: HTMLCanvasElement | null,
    aiCalibration?: AICalibrationData
  ): void;
  updateParam<K extends keyof BeautyParams>(key: K, value: BeautyParams[K]): void;
  getParams(): BeautyParams;
  setParams(params: Partial<BeautyParams>): void;
  dispose(): void;
}
