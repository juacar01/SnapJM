import { IPresetManager } from './preset.interface';
import { BeautyParams } from '../../core/types';

export class PresetManager implements IPresetManager {
  private presets: Map<string, Partial<BeautyParams>> = new Map();

  constructor() {
    this.registerDefaultPresets();
  }

  private registerDefaultPresets(): void {
    // 1. StreamFog-calibrated Optimal Auto Preset (Natural broadcast studio quality)
    this.presets.set('auto', {
      denoiseEnabled: true,
      denoiseAuto: true,
      denoiseIntensity: 0.65,
      denoiseTemporal: 0.75,
      denoiseChroma: 0.80,
      smoothIntensity: 0.50,
      smoothRadius: 3.5,
      edgeThreshold: 0.14,
      uniformity: 0.50,
      antiRedness: 0.60,
      sharpen: 0.25,
      skinToneTint: 0.50,
      teethWhitening: 0.35,
      teethBrightness: 0.06,
      eyeBrightening: 0.25,
      concealer: 0.50,
      brightness: 0.00,
      contrast: 1.02,
      saturation: 1.02,
      temperature: 0.00,
      glow: 0.00,
      vignette: 0.00
    });

    // 2. Natural (Light enhancement, maximum pore authenticity)
    this.presets.set('natural', {
      denoiseEnabled: true,
      denoiseAuto: true,
      denoiseIntensity: 0.55,
      denoiseTemporal: 0.70,
      denoiseChroma: 0.75,
      smoothIntensity: 0.35,
      smoothRadius: 2.8,
      edgeThreshold: 0.12,
      uniformity: 0.35,
      antiRedness: 0.45,
      sharpen: 0.20,
      skinToneTint: 0.50,
      teethWhitening: 0.25,
      teethBrightness: 0.04,
      eyeBrightening: 0.20,
      concealer: 0.35,
      brightness: 0.00,
      contrast: 1.01,
      saturation: 1.01,
      temperature: 0.00,
      glow: 0.00,
      vignette: 0.00
    });

    // 3. Porcelain (Subtle refined smoothing without wax sheen)
    this.presets.set('porcelain', {
      denoiseEnabled: true,
      denoiseAuto: true,
      denoiseIntensity: 0.70,
      denoiseTemporal: 0.75,
      denoiseChroma: 0.82,
      smoothIntensity: 0.65,
      smoothRadius: 4.2,
      edgeThreshold: 0.16,
      uniformity: 0.65,
      antiRedness: 0.70,
      sharpen: 0.30,
      skinToneTint: 0.45,
      teethWhitening: 0.40,
      teethBrightness: 0.08,
      eyeBrightening: 0.30,
      concealer: 0.65,
      brightness: 0.01,
      contrast: 1.03,
      saturation: 1.02,
      temperature: 0.00,
      glow: 0.02,
      vignette: 0.00
    });

    // 4. Streamer Pro (Optimized for 60 FPS live broadcast)
    this.presets.set('streamer', {
      denoiseEnabled: true,
      denoiseAuto: true,
      denoiseIntensity: 0.65,
      denoiseTemporal: 0.75,
      denoiseChroma: 0.80,
      smoothIntensity: 0.55,
      smoothRadius: 3.8,
      edgeThreshold: 0.15,
      uniformity: 0.55,
      antiRedness: 0.60,
      sharpen: 0.32,
      skinToneTint: 0.50,
      teethWhitening: 0.38,
      teethBrightness: 0.08,
      eyeBrightening: 0.30,
      concealer: 0.55,
      brightness: 0.01,
      contrast: 1.03,
      saturation: 1.03,
      temperature: 0.00,
      glow: 0.00,
      vignette: 0.00
    });

    // 5. Ultra Glam (Polished studio look with natural pores)
    this.presets.set('glam', {
      denoiseEnabled: true,
      denoiseAuto: true,
      denoiseIntensity: 0.70,
      denoiseTemporal: 0.78,
      denoiseChroma: 0.85,
      smoothIntensity: 0.75,
      smoothRadius: 4.5,
      edgeThreshold: 0.18,
      uniformity: 0.75,
      antiRedness: 0.75,
      sharpen: 0.35,
      skinToneTint: 0.48,
      teethWhitening: 0.45,
      teethBrightness: 0.10,
      eyeBrightening: 0.38,
      concealer: 0.70,
      brightness: 0.02,
      contrast: 1.05,
      saturation: 1.05,
      temperature: 0.01,
      glow: 0.03,
      vignette: 0.00
    });

    // 6. Reset (Raw bypass)
    this.presets.set('reset', {
      denoiseIntensity: 0.0,
      denoiseTemporal: 0.0,
      denoiseChroma: 0.0,
      smoothIntensity: 0.0,
      smoothRadius: 3.0,
      edgeThreshold: 0.12,
      uniformity: 0.0,
      antiRedness: 0.0,
      sharpen: 0.0,
      skinToneTint: 0.50,
      teethWhitening: 0.0,
      teethBrightness: 0.0,
      eyeBrightening: 0.0,
      concealer: 0.0,
      brightness: 0.0,
      contrast: 1.0,
      saturation: 1.0,
      temperature: 0.0,
      glow: 0.0,
      vignette: 0.0
    });
  }

  public getPreset(name: string): Partial<BeautyParams> | null {
    return this.presets.get(name) || null;
  }

  public registerPreset(name: string, params: Partial<BeautyParams>): void {
    this.presets.set(name, params);
  }

  public getAvailablePresets(): string[] {
    return Array.from(this.presets.keys());
  }
}
