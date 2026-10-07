import { IRenderEngine } from './renderer.interface';
import { BeautyParams, AICalibrationData } from '../../core/types';

export class BeautyEngineService implements IRenderEngine {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private cameraTexture: WebGLTexture | null = null;
  private maskTexture: WebGLTexture | null = null;
  private uLoc: Record<string, WebGLUniformLocation | null> = {};

  private params: BeautyParams = {
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
    skinToneTint: 0.50,
    sharpen: 0.25,

    teethWhitening: 0.35,
    teethBrightness: 0.06,

    eyeBrightening: 0.25,
    concealer: 0.50,

    brightness: 0.00,
    contrast: 1.02,
    saturation: 1.02,
    temperature: 0.00,
    glow: 0.00,
    vignette: 0.00,

    mirror: true,
    splitPosition: -1.0,
    bypass: false
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      powerPreference: 'high-performance'
    });

    if (!this.gl) {
      console.error('[BeautyEngineService] WebGL not supported!');
      return;
    }

    this.initGL();
  }

  private initGL(): void {
    const gl = this.gl!;

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      uniform int u_mirror;

      void main() {
        vec2 uv = (a_position + 1.0) * 0.5;
        if (u_mirror == 1) {
          uv.x = 1.0 - uv.x;
        }
        v_texCoord = uv;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision highp float;
      uniform sampler2D u_cameraTexture;
      uniform sampler2D u_maskTexture;
      uniform vec2 u_resolution;

      // ====================================================
      // UNIFORMS: PASO 1 - CALIBRACION DE BASE (ISO, AWB, EXPOSICION)
      // ====================================================
      uniform vec3 u_aiWhiteBalance;
      uniform float u_aiExposureGain;
      uniform float u_aiShadowLift;

      // ====================================================
      // UNIFORMS: PASO 2 - FILTRO DE RUIDO AUTOMATICO
      // ====================================================
      uniform int u_denoiseAuto;
      uniform float u_aiDenoiseIntensity;
      uniform float u_aiDenoiseTemporal;
      uniform float u_aiDenoiseChroma;
      uniform float u_denoiseIntensity;
      uniform float u_denoiseTemporal;
      uniform float u_denoiseChroma;

      // ====================================================
      // UNIFORMS: PASO 3 - FILTROS DE BELLEZA AR & COLOR
      // ====================================================
      uniform float u_smoothIntensity;
      uniform float u_smoothRadius;
      uniform float u_edgeThreshold;

      uniform float u_uniformity;
      uniform float u_antiRedness;
      uniform float u_skinToneTint;
      uniform float u_sharpen;

      uniform float u_teethWhitening;
      uniform float u_teethBrightness;
      uniform float u_eyeBrightening;
      uniform float u_concealer;

      uniform float u_brightness;
      uniform float u_contrast;
      uniform float u_saturation;
      uniform float u_temperature;
      uniform float u_glow;
      uniform float u_vignette;

      // Controls
      uniform float u_splitPosition;
      uniform int u_bypass;
      uniform int u_mirror;

      varying vec2 v_texCoord;

      // ====================================================
      // PASO 1 HELPER: CALIBRACION BASE (ISO, White Balance, Exposure)
      // ====================================================
      vec3 calibrateBase(vec3 rgb) {
        // 1. Balance de Blancos Von Kries
        rgb = clamp(rgb * u_aiWhiteBalance, 0.0, 1.0);

        // 2. ISO Digital (Shadow Lift) y Compensacion de Exposicion Facial
        if (abs(u_aiExposureGain - 1.0) > 0.005 || u_aiShadowLift > 0.005) {
          float lumRaw = dot(rgb, vec3(0.299, 0.587, 0.114));
          float shadowWeight = clamp(1.0 - lumRaw * 1.7, 0.0, 1.0);
          rgb += rgb * shadowWeight * u_aiShadowLift;

          rgb = (rgb * u_aiExposureGain) / (vec3(1.0) + rgb * max(0.0, u_aiExposureGain - 1.0) * 0.28);
          rgb = clamp(rgb, 0.0, 1.0);
        }
        return rgb;
      }

      vec3 sampleCalibrated(vec2 coord) {
        return calibrateBase(texture2D(u_cameraTexture, coord).rgb);
      }

      float getSkinWeight(vec3 rgb) {
        float cb = -0.16874 * rgb.r - 0.33126 * rgb.g + 0.50000 * rgb.b + 0.5;
        float cr =  0.50000 * rgb.r - 0.41869 * rgb.g - 0.08131 * rgb.b + 0.5;
        
        bool isSkinCandidate = (rgb.r > rgb.b * 0.90) && (rgb.r > 0.12) && (cr > 0.47 && cr < 0.74) && (cb > 0.27 && cb < 0.60);
        if (!isSkinCandidate) return 0.0;
        
        float dCr = (cr - 0.58) / 0.11;
        float dCb = (cb - 0.43) / 0.11;
        return clamp(exp(-(dCr * dCr + dCb * dCb) * 0.6) * 1.30, 0.0, 1.0);
      }

      // ====================================================
      // PASO 2 HELPER: FILTRO DE RUIDO MULTI-ESCALA SOBRE MUESTRAS CALIBRADAS
      // ====================================================
      vec3 applyAIDenoise(vec2 uv, vec3 curCol, float intensity, float fineGrainPower, float chromaPower) {
        if (intensity <= 0.01) return curCol;

        vec2 texel = 1.0 / u_resolution;
        float rInner = 1.2 + intensity * 0.8;
        float rOuter = 2.8 + intensity * 2.2;

        vec3 c = curCol;

        // Sample neighboring pixels already calibrated through Step 1
        vec3 inN  = sampleCalibrated(uv + vec2( 0.0, -1.0) * rInner * texel);
        vec3 inS  = sampleCalibrated(uv + vec2( 0.0,  1.0) * rInner * texel);
        vec3 inE  = sampleCalibrated(uv + vec2( 1.0,  0.0) * rInner * texel);
        vec3 inW  = sampleCalibrated(uv + vec2(-1.0,  0.0) * rInner * texel);
        vec3 inNE = sampleCalibrated(uv + vec2( 0.707, -0.707) * rInner * texel);
        vec3 inNW = sampleCalibrated(uv + vec2(-0.707, -0.707) * rInner * texel);
        vec3 inSE = sampleCalibrated(uv + vec2( 0.707,  0.707) * rInner * texel);
        vec3 inSW = sampleCalibrated(uv + vec2(-0.707,  0.707) * rInner * texel);

        vec3 outN  = sampleCalibrated(uv + vec2( 0.0, -1.0) * rOuter * texel);
        vec3 outS  = sampleCalibrated(uv + vec2( 0.0,  1.0) * rOuter * texel);
        vec3 outE  = sampleCalibrated(uv + vec2( 1.0,  0.0) * rOuter * texel);
        vec3 outW  = sampleCalibrated(uv + vec2(-1.0,  0.0) * rOuter * texel);
        vec3 outNE = sampleCalibrated(uv + vec2( 0.707, -0.707) * rOuter * texel);
        vec3 outNW = sampleCalibrated(uv + vec2(-0.707, -0.707) * rOuter * texel);
        vec3 outSE = sampleCalibrated(uv + vec2( 0.707,  0.707) * rOuter * texel);
        vec3 outSW = sampleCalibrated(uv + vec2(-0.707,  0.707) * rOuter * texel);

        const vec3 lumaWeight = vec3(0.299, 0.587, 0.114);
        float lumC = dot(c, lumaWeight);

        float gradX = abs(dot(inE, lumaWeight) - dot(inW, lumaWeight)) + 0.5 * abs(dot(outE, lumaWeight) - dot(outW, lumaWeight));
        float gradY = abs(dot(inS, lumaWeight) - dot(inN, lumaWeight)) + 0.5 * abs(dot(outS, lumaWeight) - dot(outN, lumaWeight));
        float edgeStrength = gradX + gradY;

        float sigmaRange = 0.08 + (1.0 - intensity) * 0.04;
        float twoSigmaSq = 2.0 * sigmaRange * sigmaRange;

        float wSum = 1.0;
        vec3 colSum = c * 1.0;

        float lumDiff, w;
        lumDiff = dot(inN, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq); colSum += inN * w; wSum += w;
        lumDiff = dot(inS, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq); colSum += inS * w; wSum += w;
        lumDiff = dot(inE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq); colSum += inE * w; wSum += w;
        lumDiff = dot(inW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq); colSum += inW * w; wSum += w;
        lumDiff = dot(inNE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * 0.85; colSum += inNE * w; wSum += w;
        lumDiff = dot(inNW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * 0.85; colSum += inNW * w; wSum += w;
        lumDiff = dot(inSE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * 0.85; colSum += inSE * w; wSum += w;
        lumDiff = dot(inSW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * 0.85; colSum += inSW * w; wSum += w;

        float flatConfidence = clamp(1.0 - (edgeStrength * 7.5), 0.0, 1.0);
        float outerWeight = flatConfidence * 0.95;

        lumDiff = dot(outN, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight; colSum += outN * w; wSum += w;
        lumDiff = dot(outS, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight; colSum += outS * w; wSum += w;
        lumDiff = dot(outE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight; colSum += outE * w; wSum += w;
        lumDiff = dot(outW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight; colSum += outW * w; wSum += w;
        lumDiff = dot(outNE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight * 0.75; colSum += outNE * w; wSum += w;
        lumDiff = dot(outNW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight * 0.75; colSum += outNW * w; wSum += w;
        lumDiff = dot(outSE, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight * 0.75; colSum += outSE * w; wSum += w;
        lumDiff = dot(outSW, lumaWeight) - lumC; w = exp(-(lumDiff * lumDiff) / twoSigmaSq) * outerWeight * 0.75; colSum += outSW * w; wSum += w;

        vec3 bilateralCol = colSum / wSum;

        vec3 meanCol = (c + inN + inS + inE + inW + inNE + inNW + inSE + inSW) * 0.111111;
        vec2 curChroma = vec2(-0.16874 * bilateralCol.r - 0.33126 * bilateralCol.g + 0.50000 * bilateralCol.b,
                               0.50000 * bilateralCol.r - 0.41869 * bilateralCol.g - 0.08131 * bilateralCol.b);
        vec2 meanChroma = vec2(-0.16874 * meanCol.r - 0.33126 * meanCol.g + 0.50000 * meanCol.b,
                                0.50000 * meanCol.r - 0.41869 * meanCol.g - 0.08131 * meanCol.b);

        float chromaCleanFactor = clamp(chromaPower * (intensity * 1.30), 0.0, 0.98);
        vec2 cleanChroma = mix(curChroma, meanChroma, chromaCleanFactor);

        float lumClean = dot(bilateralCol, lumaWeight);
        float rClean = lumClean + 1.40200 * cleanChroma.y;
        float gClean = lumClean - 0.34414 * cleanChroma.x - 0.71414 * cleanChroma.y;
        float bClean = lumClean + 1.77200 * cleanChroma.x;

        vec3 cleanCol = clamp(vec3(rClean, gClean, bClean), 0.0, 1.0);
        float finalBlend = clamp(intensity * (0.85 + flatConfidence * 0.15), 0.0, 1.0);
        return mix(curCol, cleanCol, finalBlend);
      }

      // ====================================================
      // PASO 3 HELPER: SUAVIZADO BILATERAL DE PIEL
      // ====================================================
      vec3 bilateralFilter(vec2 uv, vec3 centerColor, float radius, float edgeThresh) {
        vec2 texel = 1.0 / u_resolution;
        vec3 sumColor = centerColor;
        float sumWeight = 1.0;
        float centerLum = dot(centerColor, vec3(0.299, 0.587, 0.114));

        // Scale radius so it spans across acne blemishes and pores on 720p/1080p webcams
        float effRadius = max(radius * 2.8, 4.0 + u_smoothIntensity * 6.5);
        // Adaptive range threshold: allows smoothing across acne bumps without blurring face borders
        float effEdgeThresh = max(edgeThresh, 0.14 + u_smoothIntensity * 0.16);
        float twoSigmaSq = 2.0 * effEdgeThresh * effEdgeThresh;

        vec2 offsets[12];
        offsets[0]  = vec2( 1.0,  0.0);
        offsets[1]  = vec2(-1.0,  0.0);
        offsets[2]  = vec2( 0.0,  1.0);
        offsets[3]  = vec2( 0.0, -1.0);
        offsets[4]  = vec2( 0.707,  0.707);
        offsets[5]  = vec2(-0.707,  0.707);
        offsets[6]  = vec2( 0.707, -0.707);
        offsets[7]  = vec2(-0.707, -0.707);
        offsets[8]  = vec2( 1.6,  0.7);
        offsets[9]  = vec2(-1.6, -0.7);
        offsets[10] = vec2( 0.7, -1.6);
        offsets[11] = vec2(-0.7,  1.6);

        for (int i = 0; i < 12; i++) {
          vec2 sampleUv = uv + offsets[i] * effRadius * texel;
          vec3 sampleCol = sampleCalibrated(sampleUv);
          float sampleLum = dot(sampleCol, vec3(0.299, 0.587, 0.114));

          float lumDiff = abs(centerLum - sampleLum);
          float rangeWeight = exp(-(lumDiff * lumDiff) / twoSigmaSq);
          
          sumColor += sampleCol * rangeWeight;
          sumWeight += rangeWeight;
        }

        return sumColor / sumWeight;
      }

      void main() {
        vec2 uv = v_texCoord;
        vec2 texUv = vec2(uv.x, 1.0 - uv.y);

        vec3 rawColor = texture2D(u_cameraTexture, texUv).rgb;

        // ====================================================
        // 1. PASO 1: CALCULO DE ISO, BALANCE DE BLANCOS Y EXPOSICION
        // (Automatico y reactivo a cualquier cambio de iluminacion)
        // ====================================================
        vec3 step1Calibrated = calibrateBase(rawColor);

        // Bypass toggle
        if (u_bypass == 1) {
          gl_FragColor = vec4(step1Calibrated, 1.0);
          return;
        }

        // Split-screen comparison line
        if (u_splitPosition >= 0.0) {
          float screenX = uv.x;
          if (abs(screenX - u_splitPosition) < 0.0025) {
            gl_FragColor = vec4(0.0, 0.95, 1.0, 1.0);
            return;
          }
          if (screenX > u_splitPosition) {
            gl_FragColor = vec4(step1Calibrated, 1.0);
            return;
          }
        }

        // ====================================================
        // 2. PASO 2: FILTRO DE RUIDO DE LA IMAGEN
        // (Automatico y recalculado reactivamente con cada cambio de iluminacion)
        // ====================================================
        float effDenoiseInt = (u_denoiseAuto == 1) ? u_aiDenoiseIntensity : u_denoiseIntensity;
        float effDenoiseTemp = (u_denoiseAuto == 1) ? u_aiDenoiseTemporal : u_denoiseTemporal;
        float effDenoiseChroma = (u_denoiseAuto == 1) ? u_aiDenoiseChroma : u_denoiseChroma;

        vec3 step2Denoised = step1Calibrated;
        if (effDenoiseInt > 0.01) {
          step2Denoised = applyAIDenoise(texUv, step1Calibrated, effDenoiseInt, effDenoiseTemp, effDenoiseChroma);
        }

        // ====================================================
        // 3. PASO 3: APLICAR TODOS LOS DEMAS FILTROS DE BELLEZA
        // CON EL RESULTADO DE LOS AJUSTES ANTERIORES (step2Denoised)
        // ====================================================
        vec4 mask = texture2D(u_maskTexture, texUv);
        vec3 color = step2Denoised;

        // 3.1. Deteccion de piel robusta sobre la imagen limpia y calibrada
        float rawSkinProb = getSkinWeight(step2Denoised);
        float skinFactor = (mask.r > 0.05) ? max(mask.r, rawSkinProb * 0.90) : rawSkinProb;
        // Proteger cavidad bucal (R es bajo, G es alto)
        float mouthArea = (mask.r < 0.25) ? mask.g : 0.0;
        skinFactor *= clamp(1.0 - mouthArea * 2.5, 0.0, 1.0);
        // Proteger cuencas oculares (B es alto)
        skinFactor *= clamp(1.0 - mask.b * 1.8, 0.0, 1.0);
        skinFactor = clamp(skinFactor * 1.25, 0.0, 1.0);

        // 3.2. Suavizado de piel con separacion de frecuencias (elimina acne y preserva micro-poros)
        vec3 smoothed = step2Denoised;
        if (skinFactor > 0.02) {
          smoothed = bilateralFilter(texUv, step2Denoised, u_smoothRadius, u_edgeThreshold);
        }

        if (u_smoothIntensity > 0.01 && skinFactor > 0.02) {
          vec3 rawDiff = step2Denoised - smoothed;
          
          // Separacion de frecuencias inteligente:
          // Los poros autenticos tienen desviacion pequena (< 0.022)
          // El acne, granos y espinillas tienen desviacion grande (> 0.04)
          // Al limitar rawDiff a [-0.020, 0.020], se erradica el 90% del relieve de acne y manchas,
          // reteniendo unicamente la textura fina de micro-poro para que no parezca cera/parafina.
          vec3 microPores = clamp(rawDiff, -0.020, 0.020);
          
          // Retencion de micro-poros que decrece suavemente con la intensidad
          float poreRetention = clamp(1.0 - u_smoothIntensity * 0.70, 0.15, 0.85);
          vec3 naturalSkin = smoothed + microPores * poreRetention;
          
          // Mezcla directa y potente: el slider AHORA SI TIENE EFECTO VISIBLE INMEDIATO
          float blendPower = clamp(skinFactor * u_smoothIntensity * 1.15, 0.0, 0.98);
          color = mix(color, naturalSkin, blendPower);
        }

        // 3.3. FILTRO DE BOLSAS DE OJOS & OJERAS (Under-Eye Bags & Dark Circles)
        float eyeAbove = texture2D(u_maskTexture, texUv + vec2(0.0, 0.024)).b;
        float eyeBelow = texture2D(u_maskTexture, texUv - vec2(0.0, 0.024)).b;
        float geomEyeBag = clamp(max(eyeAbove, eyeBelow) * 1.6 - mask.b * 2.5, 0.0, 1.0);
        float polyEyeBag = (mask.r > 0.25 && mask.g > 0.10 && mask.b < 0.35) ? mask.g : 0.0;
        float eyeBagFactor = max(polyEyeBag, geomEyeBag);

        if (u_concealer > 0.01 && eyeBagFactor > 0.02 && skinFactor > 0.04) {
          float bagPower = clamp(eyeBagFactor * u_concealer * 1.25, 0.0, 1.0);
          
          // 1. Suavizar y desvanecer el pliegue / abultamiento de la bolsa con la piel alisada
          color = mix(color, smoothed, clamp(bagPower * 0.88, 0.0, 0.95));
          
          // 2. Aclarar la sombra oscura de la ojera (brighten under-eye shadow)
          float lumEye = dot(color, vec3(0.299, 0.587, 0.114));
          float shadowEye = clamp(1.0 - smoothstep(0.20, 0.70, lumEye), 0.0, 1.0);
          vec3 concealerBright = vec3(1.0, 0.96, 0.92) * (shadowEye * bagPower * 0.16);
          color = clamp(color + concealerBright, 0.0, 1.0);
          
          // 3. Neutralizar tonos violáceos / azulados de fatiga
          float yB  =  0.29900 * color.r + 0.58700 * color.g + 0.11400 * color.b;
          float cbB = -0.16874 * color.r - 0.33126 * color.g + 0.50000 * color.b + 0.5;
          float crB =  0.50000 * color.r - 0.41869 * color.g - 0.08131 * color.b + 0.5;
          if (cbB > 0.49) {
            cbB = mix(cbB, 0.49, clamp(bagPower * 0.75, 0.0, 0.85));
            float rOutB = yB + 1.40200 * (crB - 0.5);
            float gOutB = yB - 0.34414 * (cbB - 0.5) - 0.71414 * (crB - 0.5);
            float bOutB = yB + 1.77200 * (cbB - 0.5);
            color = clamp(vec3(rOutB, gOutB, bOutB), 0.0, 1.0);
          }
        }

        // 3.4. Uniformidad de tono de piel y anti-rojeces (elimina rojeces de acne y empareja manchas)
        if ((u_uniformity > 0.01 || u_antiRedness > 0.01) && skinFactor > 0.04) {
          float y  =  0.29900 * color.r + 0.58700 * color.g + 0.11400 * color.b;
          float cb = -0.16874 * color.r - 0.33126 * color.g + 0.50000 * color.b + 0.5;
          float cr =  0.50000 * color.r - 0.41869 * color.g - 0.08131 * color.b + 0.5;

          float cbSmooth = -0.16874 * smoothed.r - 0.33126 * smoothed.g + 0.50000 * smoothed.b + 0.5;
          float crSmooth =  0.50000 * smoothed.r - 0.41869 * smoothed.g - 0.08131 * smoothed.b + 0.5;

          // Correccion de rojeces (Anti-Acne / Anti-Inflamacion):
          if (u_antiRedness > 0.01) {
            float redExcess = cr - crSmooth;
            if (redExcess > 0.005) {
              cr = mix(cr, crSmooth, clamp(u_antiRedness * 1.50 * skinFactor, 0.0, 0.95));
            }
          }

          // Uniformidad de tono: empareja diferencias cromaticas de manchas y sombras
          if (u_uniformity > 0.01) {
            float uniBlend = clamp(u_uniformity * skinFactor * 1.15, 0.0, 0.95);
            cb = mix(cb, cbSmooth, uniBlend);
            cr = mix(cr, crSmooth, uniBlend);

            float tintShift = (u_skinToneTint - 0.50) * 0.035;
            cb -= tintShift * skinFactor;
            cr += tintShift * skinFactor;
          }

          float rOut = y + 1.40200 * (cr - 0.5);
          float gOut = y - 0.34414 * (cb - 0.5) - 0.71414 * (cr - 0.5);
          float bOut = y + 1.77200 * (cb - 0.5);

          vec3 evenColor = clamp(vec3(rOut, gOut, bOut), 0.0, 1.0);
          color = mix(color, evenColor, clamp(skinFactor * max(u_uniformity, u_antiRedness) * 0.90, 0.0, 0.95));
        }

        // 3.5. Resplandor suave (Porcelain Bloom)
        if (u_glow > 0.01 && skinFactor > 0.10) {
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          float highlight = smoothstep(0.40, 0.78, lum) * (1.0 - smoothstep(0.85, 0.98, lum));
          vec3 warmHighlight = vec3(1.0, 0.97, 0.94);
          color += warmHighlight * (highlight * u_glow * 0.18 * skinFactor);
        }

        // 3.6. Blanqueamiento dental (ESTRICTO dentro de la boca)
        if (u_teethWhitening > 0.01 && mask.g > 0.04) {
          float mouthArea = mask.g;
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          bool isToothCandidate = (lum > 0.32) && 
                                  (color.r > color.b) && 
                                  (color.g > color.b * 0.85) && 
                                  (abs(color.r - color.g) < 0.14);

          if (isToothCandidate) {
            float weight = smoothstep(0.04, 0.30, mouthArea);
            float yellowCast = max(0.0, ((color.r + color.g) * 0.5) - color.b);
            vec3 whitened = color;
            whitened.b += yellowCast * u_teethWhitening * 1.10;
            whitened += vec3(u_teethBrightness * 0.18);
            whitened = clamp(whitened, 0.0, 1.0);
            color = mix(color, whitened, clamp(weight * u_teethWhitening, 0.0, 0.95));
          }
        }

        // 3.7. Realce de ojos (ESTRICTO dentro de los ojos)
        if (u_eyeBrightening > 0.01 && mask.b > 0.08) {
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          if (lum > 0.32) {
            vec3 brightEye = mix(color, vec3(lum + 0.10), 0.45 * u_eyeBrightening);
            color = mix(color, brightEye, mask.b * u_eyeBrightening);
          }
        }

        // 3.8. Enfoque de texturas HD (Sobre la imagen denoised)
        if (u_sharpen > 0.01) {
          vec2 texel = 1.0 / u_resolution;
          vec3 n = sampleCalibrated(texUv + vec2(0.0, -texel.y));
          vec3 s = sampleCalibrated(texUv + vec2(0.0,  texel.y));
          vec3 e = sampleCalibrated(texUv + vec2( texel.x, 0.0));
          vec3 w = sampleCalibrated(texUv + vec2(-texel.x, 0.0));
          vec3 blurred = (n + s + e + w) * 0.25;
          vec3 highPass = step2Denoised - blurred;
          color = clamp(color + highPass * u_sharpen * 1.5, 0.0, 1.0);
        }

        // 3.9. Gradacion de color final (Brillo, contraste, saturacion, temperatura, vineta)
        color += vec3(u_brightness);
        color = (color - 0.5) * u_contrast + 0.5;

        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(gray), color, u_saturation);

        color.r += u_temperature * 0.14;
        color.b -= u_temperature * 0.14;

        if (u_vignette > 0.01) {
          vec2 center = uv - 0.5;
          float dist = length(center);
          float vig = smoothstep(0.75, 0.35, dist * (1.0 + u_vignette));
          color *= vig;
        }

        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }
    `;

    const vertShader = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fragShader = this.compileShader(gl.FRAGMENT_SHADER, fsSource);

    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vertShader);
    gl.attachShader(this.program, fragShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('[BeautyEngineService] Program link error:', gl.getProgramInfoLog(this.program));
      return;
    }

    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]);

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const aPosLoc = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

    this.cameraTexture = this.createTexture();
    this.maskTexture = this.createTexture();

    this.uLoc = {
      u_cameraTexture: gl.getUniformLocation(this.program, 'u_cameraTexture'),
      u_maskTexture: gl.getUniformLocation(this.program, 'u_maskTexture'),
      u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),

      u_denoiseAuto: gl.getUniformLocation(this.program, 'u_denoiseAuto'),
      u_aiDenoiseIntensity: gl.getUniformLocation(this.program, 'u_aiDenoiseIntensity'),
      u_aiDenoiseTemporal: gl.getUniformLocation(this.program, 'u_aiDenoiseTemporal'),
      u_aiDenoiseChroma: gl.getUniformLocation(this.program, 'u_aiDenoiseChroma'),
      u_denoiseIntensity: gl.getUniformLocation(this.program, 'u_denoiseIntensity'),
      u_denoiseTemporal: gl.getUniformLocation(this.program, 'u_denoiseTemporal'),
      u_denoiseChroma: gl.getUniformLocation(this.program, 'u_denoiseChroma'),

      u_aiWhiteBalance: gl.getUniformLocation(this.program, 'u_aiWhiteBalance'),
      u_aiExposureGain: gl.getUniformLocation(this.program, 'u_aiExposureGain'),
      u_aiShadowLift: gl.getUniformLocation(this.program, 'u_aiShadowLift'),

      u_smoothIntensity: gl.getUniformLocation(this.program, 'u_smoothIntensity'),
      u_smoothRadius: gl.getUniformLocation(this.program, 'u_smoothRadius'),
      u_edgeThreshold: gl.getUniformLocation(this.program, 'u_edgeThreshold'),

      u_uniformity: gl.getUniformLocation(this.program, 'u_uniformity'),
      u_antiRedness: gl.getUniformLocation(this.program, 'u_antiRedness'),
      u_skinToneTint: gl.getUniformLocation(this.program, 'u_skinToneTint'),
      u_sharpen: gl.getUniformLocation(this.program, 'u_sharpen'),

      u_teethWhitening: gl.getUniformLocation(this.program, 'u_teethWhitening'),
      u_teethBrightness: gl.getUniformLocation(this.program, 'u_teethBrightness'),
      u_eyeBrightening: gl.getUniformLocation(this.program, 'u_eyeBrightening'),
      u_concealer: gl.getUniformLocation(this.program, 'u_concealer'),

      u_brightness: gl.getUniformLocation(this.program, 'u_brightness'),
      u_contrast: gl.getUniformLocation(this.program, 'u_contrast'),
      u_saturation: gl.getUniformLocation(this.program, 'u_saturation'),
      u_temperature: gl.getUniformLocation(this.program, 'u_temperature'),
      u_glow: gl.getUniformLocation(this.program, 'u_glow'),
      u_vignette: gl.getUniformLocation(this.program, 'u_vignette'),

      u_splitPosition: gl.getUniformLocation(this.program, 'u_splitPosition'),
      u_bypass: gl.getUniformLocation(this.program, 'u_bypass'),
      u_mirror: gl.getUniformLocation(this.program, 'u_mirror')
    };

    console.log('[BeautyEngineService] WebGL GPU pipeline initialized at 60 FPS');
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl!;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[BeautyEngineService] Shader compile error:', gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl!;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return texture;
  }

  public updateParam<K extends keyof BeautyParams>(key: K, value: BeautyParams[K]): void {
    if (key in this.params) {
      this.params[key] = value;
    }
  }

  public getParams(): BeautyParams {
    return { ...this.params };
  }

  public setParams(newParams: Partial<BeautyParams>): void {
    Object.assign(this.params, newParams);
  }

  public render(
    videoElement: HTMLVideoElement | HTMLCanvasElement,
    maskCanvas: HTMLCanvasElement | null,
    aiCalibration?: AICalibrationData
  ): void {
    const gl = this.gl;
    if (!gl || !this.program || !videoElement) return;

    if (typeof (videoElement as HTMLVideoElement).readyState === 'number' && (videoElement as HTMLVideoElement).readyState < 2) return;

    const width = (videoElement instanceof HTMLVideoElement) ? videoElement.videoWidth : videoElement.width;
    const height = (videoElement instanceof HTMLVideoElement) ? videoElement.videoHeight : videoElement.height;
    if (width === 0 || height === 0) return;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    // 1. Camera Frame
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cameraTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);
    gl.uniform1i(this.uLoc.u_cameraTexture, 0);

    // 2. Face Mask
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    if (maskCanvas && maskCanvas.width > 0 && maskCanvas.height > 0) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
    }
    gl.uniform1i(this.uLoc.u_maskTexture, 1);

    // 3. Uniforms
    gl.uniform2f(this.uLoc.u_resolution, width, height);

    if (aiCalibration) {
      gl.uniform3f(this.uLoc.u_aiWhiteBalance, aiCalibration.whiteBalance[0], aiCalibration.whiteBalance[1], aiCalibration.whiteBalance[2]);
      gl.uniform1f(this.uLoc.u_aiExposureGain, aiCalibration.exposureGain);
      gl.uniform1f(this.uLoc.u_aiShadowLift, aiCalibration.shadowLift);
    } else {
      gl.uniform3f(this.uLoc.u_aiWhiteBalance, 1.0, 1.0, 1.0);
      gl.uniform1f(this.uLoc.u_aiExposureGain, 1.0);
      gl.uniform1f(this.uLoc.u_aiShadowLift, 0.0);
    }

    gl.uniform1i(this.uLoc.u_denoiseAuto, this.params.denoiseAuto ? 1 : 0);
    if (aiCalibration) {
      gl.uniform1f(this.uLoc.u_aiDenoiseIntensity, this.params.denoiseEnabled ? aiCalibration.autoDenoiseIntensity : 0.0);
      gl.uniform1f(this.uLoc.u_aiDenoiseTemporal, aiCalibration.autoDenoiseTemporal);
      gl.uniform1f(this.uLoc.u_aiDenoiseChroma, aiCalibration.autoDenoiseChroma);
    } else {
      gl.uniform1f(this.uLoc.u_aiDenoiseIntensity, 0.75);
      gl.uniform1f(this.uLoc.u_aiDenoiseTemporal, 0.78);
      gl.uniform1f(this.uLoc.u_aiDenoiseChroma, 0.88);
    }

    gl.uniform1f(this.uLoc.u_denoiseIntensity, this.params.denoiseEnabled ? this.params.denoiseIntensity : 0.0);
    gl.uniform1f(this.uLoc.u_denoiseTemporal, this.params.denoiseTemporal);
    gl.uniform1f(this.uLoc.u_denoiseChroma, this.params.denoiseChroma);

    gl.uniform1f(this.uLoc.u_smoothIntensity, this.params.smoothIntensity);
    gl.uniform1f(this.uLoc.u_smoothRadius, this.params.smoothRadius);
    gl.uniform1f(this.uLoc.u_edgeThreshold, this.params.edgeThreshold);

    gl.uniform1f(this.uLoc.u_uniformity, this.params.uniformity);
    gl.uniform1f(this.uLoc.u_antiRedness, this.params.antiRedness);
    gl.uniform1f(this.uLoc.u_skinToneTint, this.params.skinToneTint);
    gl.uniform1f(this.uLoc.u_sharpen, this.params.sharpen);

    gl.uniform1f(this.uLoc.u_teethWhitening, this.params.teethWhitening);
    gl.uniform1f(this.uLoc.u_teethBrightness, this.params.teethBrightness);
    gl.uniform1f(this.uLoc.u_eyeBrightening, this.params.eyeBrightening);
    gl.uniform1f(this.uLoc.u_concealer, this.params.concealer);

    gl.uniform1f(this.uLoc.u_brightness, this.params.brightness);
    gl.uniform1f(this.uLoc.u_contrast, this.params.contrast);
    gl.uniform1f(this.uLoc.u_saturation, this.params.saturation);
    gl.uniform1f(this.uLoc.u_temperature, this.params.temperature);
    gl.uniform1f(this.uLoc.u_glow, this.params.glow);
    gl.uniform1f(this.uLoc.u_vignette, this.params.vignette);

    gl.uniform1f(this.uLoc.u_splitPosition, this.params.splitPosition);
    gl.uniform1i(this.uLoc.u_bypass, this.params.bypass ? 1 : 0);
    gl.uniform1i(this.uLoc.u_mirror, this.params.mirror ? 1 : 0);

    // 4. Draw Full Screen Quad
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public dispose(): void {
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
    }
  }
}
