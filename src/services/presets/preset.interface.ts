import { BeautyParams } from '../../core/types';

export interface IPresetManager {
  getPreset(name: string): Partial<BeautyParams> | null;
  registerPreset(name: string, params: Partial<BeautyParams>): void;
  getAvailablePresets(): string[];
}
