import { TrackResult } from '../../core/types';

export interface IFaceTrackerService {
  initialize(): Promise<boolean>;
  update(sourceElement: HTMLVideoElement | HTMLCanvasElement, timestamp: number): TrackResult;
  isReady(): boolean;
  dispose(): void;
}
