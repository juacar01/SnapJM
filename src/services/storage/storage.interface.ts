import { BeautyParams } from '../../core/types';

export interface UserPreferences {
  deviceId?: string;
  resolution?: string;
  fps?: number;
  params: Partial<BeautyParams>;
  activePreset?: string;
  mirror?: boolean;
}

export interface ISettingsStorageService {
  loadPreferences(): UserPreferences | null;
  savePreferences(prefs: Partial<UserPreferences>): void;
  clearPreferences(): void;
}
