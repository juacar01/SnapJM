import { ISettingsStorageService, UserPreferences } from './storage.interface';
import { BeautyParams } from '../../core/types';

export class LocalStorageSettingsService implements ISettingsStorageService {
  private readonly storageKey = 'snapjm_user_preferences_v1';

  private clamp(val: any, min: number, max: number, fallback: number): number {
    if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
      return fallback;
    }
    return Math.min(Math.max(val, min), max);
  }

  private sanitizeParams(raw: any): Partial<BeautyParams> {
    if (typeof raw !== 'object' || raw === null) {
      return {};
    }

    const clean: Partial<BeautyParams> = {};

    if ('smoothIntensity' in raw) clean.smoothIntensity = this.clamp(raw.smoothIntensity, 0, 1, 0.50);
    if ('smoothRadius' in raw) clean.smoothRadius = this.clamp(raw.smoothRadius, 0.5, 15, 3.5);
    if ('edgeThreshold' in raw) clean.edgeThreshold = this.clamp(raw.edgeThreshold, 0.01, 1.0, 0.14);
    if ('uniformity' in raw) clean.uniformity = this.clamp(raw.uniformity, 0, 1, 0.50);
    if ('antiRedness' in raw) clean.antiRedness = this.clamp(raw.antiRedness, 0, 1, 0.60);
    if ('sharpen' in raw) clean.sharpen = this.clamp(raw.sharpen, 0, 1, 0.25);
    if ('skinToneTint' in raw) clean.skinToneTint = this.clamp(raw.skinToneTint, 0, 1, 0.50);

    if ('teethWhitening' in raw) clean.teethWhitening = this.clamp(raw.teethWhitening, 0, 1, 0.35);
    if ('teethBrightness' in raw) clean.teethBrightness = this.clamp(raw.teethBrightness, 0, 1, 0.06);
    if ('eyeBrightening' in raw) clean.eyeBrightening = this.clamp(raw.eyeBrightening, 0, 1, 0.25);
    if ('concealer' in raw) clean.concealer = this.clamp(raw.concealer, 0, 1, 0.50);

    if ('brightness' in raw) clean.brightness = this.clamp(raw.brightness, -1.0, 1.0, 0.0);
    if ('contrast' in raw) clean.contrast = this.clamp(raw.contrast, 0.2, 3.0, 1.02);
    if ('saturation' in raw) clean.saturation = this.clamp(raw.saturation, 0.0, 3.0, 1.02);
    if ('temperature' in raw) clean.temperature = this.clamp(raw.temperature, -1.0, 1.0, 0.0);
    if ('glow' in raw) clean.glow = this.clamp(raw.glow, 0, 1, 0.0);
    if ('vignette' in raw) clean.vignette = this.clamp(raw.vignette, 0, 1, 0.0);

    if ('denoiseIntensity' in raw) clean.denoiseIntensity = this.clamp(raw.denoiseIntensity, 0, 1, 0.65);
    if ('denoiseTemporal' in raw) clean.denoiseTemporal = this.clamp(raw.denoiseTemporal, 0, 1, 0.75);
    if ('denoiseChroma' in raw) clean.denoiseChroma = this.clamp(raw.denoiseChroma, 0, 1, 0.80);

    if ('denoiseEnabled' in raw) clean.denoiseEnabled = Boolean(raw.denoiseEnabled);
    if ('denoiseAuto' in raw) clean.denoiseAuto = Boolean(raw.denoiseAuto);
    if ('mirror' in raw) clean.mirror = Boolean(raw.mirror);
    if ('bypass' in raw) clean.bypass = Boolean(raw.bypass);

    return clean;
  }

  private sanitizeResolution(res: any): string | undefined {
    if (typeof res !== 'string') return undefined;
    const match = res.trim().match(/^(\d{2,4})x(\d{2,4})$/);
    if (!match) return undefined;
    const w = parseInt(match[1], 10);
    const h = parseInt(match[2], 10);
    if (w < 160 || w > 7680 || h < 120 || h > 4320) return undefined;
    return `${w}x${h}`;
  }

  private sanitizeFps(fps: any): number | undefined {
    if (typeof fps !== 'number' || isNaN(fps) || !isFinite(fps)) return undefined;
    const intFps = Math.round(fps);
    if (intFps < 10 || intFps > 240) return 60;
    return intFps;
  }

  public loadPreferences(): UserPreferences | null {
    try {
      const serialized = localStorage.getItem(this.storageKey);
      if (!serialized) {
        return null;
      }

      const parsed = JSON.parse(serialized);
      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }

      return {
        deviceId: typeof parsed.deviceId === 'string' && parsed.deviceId.trim().length > 0 ? parsed.deviceId.trim() : undefined,
        resolution: this.sanitizeResolution(parsed.resolution),
        fps: this.sanitizeFps(parsed.fps),
        params: this.sanitizeParams(parsed.params),
        activePreset: typeof parsed.activePreset === 'string' && parsed.activePreset.trim().length > 0 ? parsed.activePreset.trim() : undefined,
        mirror: typeof parsed.mirror === 'boolean' ? parsed.mirror : undefined
      };
    } catch (err) {
      console.warn('[LocalStorageSettingsService] Failed to load preferences from storage:', err);
      return null;
    }
  }

  public savePreferences(prefs: Partial<UserPreferences>): void {
    try {
      const current = this.loadPreferences() || { params: {} };
      const merged: UserPreferences = {
        deviceId: prefs.deviceId !== undefined ? (typeof prefs.deviceId === 'string' ? prefs.deviceId.trim() : undefined) : current.deviceId,
        resolution: prefs.resolution !== undefined ? this.sanitizeResolution(prefs.resolution) : current.resolution,
        fps: prefs.fps !== undefined ? this.sanitizeFps(prefs.fps) : current.fps,
        params: {
          ...current.params,
          ...this.sanitizeParams(prefs.params)
        },
        activePreset: prefs.activePreset !== undefined ? prefs.activePreset : current.activePreset,
        mirror: prefs.mirror !== undefined ? prefs.mirror : current.mirror
      };

      localStorage.setItem(this.storageKey, JSON.stringify(merged));
    } catch (err) {
      console.warn('[LocalStorageSettingsService] Failed to save preferences to storage:', err);
    }
  }

  public clearPreferences(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (err) {
      console.warn('[LocalStorageSettingsService] Failed to clear preferences:', err);
    }
  }
}
