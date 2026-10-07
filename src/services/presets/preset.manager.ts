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
      lipstickIntensity: 0.0,
      lipstickColor: [0.84, 0.13, 0.42],
      lipstickColorHex: '#d6226c',
      blushIntensity: 0.0,
      blushColor: [0.96, 0.45, 0.53],
      blushColorHex: '#f47287',
      eyebrowIntensity: 0.0,
      eyebrowColor: [0.23, 0.16, 0.11],
      eyebrowColorHex: '#3b281c',
      eyeshadowIntensity: 0.0,
      eyeshadowColor: [0.72, 0.43, 0.47],
      eyeshadowColorHex: '#b76e79',
      eyelinerIntensity: 0.0,
      eyelinerColor: [0.04, 0.04, 0.04],
      eyelinerColorHex: '#0a0a0a',
      mascaraIntensity: 0.0,
      mascaraColor: [0.04, 0.04, 0.04],
      mascaraColorHex: '#0a0a0a',
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
      lipstickIntensity: 0.0,
      lipstickColor: [0.84, 0.13, 0.42],
      lipstickColorHex: '#d6226c',
      blushIntensity: 0.0,
      blushColor: [0.96, 0.45, 0.53],
      blushColorHex: '#f47287',
      eyebrowIntensity: 0.0,
      eyebrowColor: [0.23, 0.16, 0.11],
      eyebrowColorHex: '#3b281c',
      eyeshadowIntensity: 0.0,
      eyeshadowColor: [0.72, 0.43, 0.47],
      eyeshadowColorHex: '#b76e79',
      eyelinerIntensity: 0.0,
      eyelinerColor: [0.04, 0.04, 0.04],
      eyelinerColorHex: '#0a0a0a',
      mascaraIntensity: 0.0,
      mascaraColor: [0.04, 0.04, 0.04],
      mascaraColorHex: '#0a0a0a',
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
      lipstickIntensity: 0.18,
      lipstickColor: [0.85, 0.33, 0.42],
      lipstickColorHex: '#d9546b',
      blushIntensity: 0.20,
      blushColor: [0.97, 0.59, 0.56],
      blushColorHex: '#f8978f',
      eyebrowIntensity: 0.12,
      eyebrowColor: [0.23, 0.16, 0.11],
      eyebrowColorHex: '#3b281c',
      eyeshadowIntensity: 0.15,
      eyeshadowColor: [0.77, 0.61, 0.42],
      eyeshadowColorHex: '#c59b6c',
      eyelinerIntensity: 0.20,
      eyelinerColor: [0.17, 0.11, 0.09],
      eyelinerColorHex: '#2c1b18',
      mascaraIntensity: 0.25,
      mascaraColor: [0.04, 0.04, 0.04],
      mascaraColorHex: '#0a0a0a',
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
      lipstickIntensity: 0.0,
      lipstickColor: [0.84, 0.13, 0.42],
      lipstickColorHex: '#d6226c',
      blushIntensity: 0.0,
      blushColor: [0.96, 0.45, 0.53],
      blushColorHex: '#f47287',
      eyebrowIntensity: 0.0,
      eyebrowColor: [0.23, 0.16, 0.11],
      eyebrowColorHex: '#3b281c',
      eyeshadowIntensity: 0.0,
      eyeshadowColor: [0.72, 0.43, 0.47],
      eyeshadowColorHex: '#b76e79',
      eyelinerIntensity: 0.0,
      eyelinerColor: [0.04, 0.04, 0.04],
      eyelinerColorHex: '#0a0a0a',
      mascaraIntensity: 0.0,
      mascaraColor: [0.04, 0.04, 0.04],
      mascaraColorHex: '#0a0a0a',
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
      lipstickIntensity: 0.40,
      lipstickColor: [0.84, 0.13, 0.42],
      lipstickColorHex: '#d6226c',
      blushIntensity: 0.30,
      blushColor: [0.96, 0.45, 0.53],
      blushColorHex: '#f47287',
      eyebrowIntensity: 0.25,
      eyebrowColor: [0.23, 0.16, 0.11],
      eyebrowColorHex: '#3b281c',
      eyeshadowIntensity: 0.35,
      eyeshadowColor: [0.72, 0.43, 0.47],
      eyeshadowColorHex: '#b76e79',
      eyelinerIntensity: 0.45,
      eyelinerColor: [0.04, 0.04, 0.04],
      eyelinerColorHex: '#0a0a0a',
      mascaraIntensity: 0.50,
      mascaraColor: [0.04, 0.04, 0.04],
      mascaraColorHex: '#0a0a0a',
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
      lipstickIntensity: 0.0,
      blushIntensity: 0.0,
      eyebrowIntensity: 0.0,
      eyeshadowIntensity: 0.0,
      eyelinerIntensity: 0.0,
      mascaraIntensity: 0.0,
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
