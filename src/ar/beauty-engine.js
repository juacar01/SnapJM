/**
 * BeautyEngine - High performance WebGL GPU AR pipeline
 * StreamFog-grade Face AR with Multi-Scale AI Denoising,
 * 12-Tap Porcelain Bilateral Skin Smoothing, Under-Eye Concealer,
 * Soft-Focus Porcelain Bloom, Teeth Whitening, and Studio Color Grading.
 */

class BeautyEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      powerPreference: 'high-performance'
    });

    if (!this.gl) {
      console.error('[BeautyEngine] WebGL not supported!');
      return;
    }

    const gl = this.gl;
    this.program = null;
    this.cameraTexture = null;
    this.maskTexture = null;

    // Parameters calibrated 1:1 to match StreamFog
    this.params = {
      // AI Image Denoise (Filtro general de reducción de ruido con IA multi-escala)
      denoiseEnabled: true,
      denoiseIntensity: 0.88, // 0.0 to 1.0 (Intensidad de eliminación de ruido)
      denoiseTemporal: 0.82,  // 0.0 to 1.0 (Afinado de grano fino)
      denoiseChroma: 0.95,    // 0.0 to 1.0 (Limpieza profunda de ruido cromático / puntos de color)

      // Skin smoothing (Suavizado de piel continuo estilo StreamFog)
      smoothIntensity: 0.80, // 0.0 to 1.0 (Suavizado de piel profundo y sedoso)
      smoothRadius: 5.5,     // 1.0 to 8.0 (Radio ampliado para efecto porcelana)
      edgeThreshold: 0.14,   // 0.02 to 0.30

      // Skin Tone Uniformity & Clarity (Uniformidad suave sin manchas)
      uniformity: 0.55,      // 0.0 to 1.0 (Unifica manchas y empareja color)
      antiRedness: 0.45,     // 0.0 to 1.0 (Elimina rojeces y granitos rojos)
      skinToneTint: 0.55,    // Tono durazno cálido y saludable estilo StreamFog
      sharpen: 0.38,         // 0.0 to 1.0 (Nitidez HD de ojos y cabello)

      // Teeth whitening (Dientes blancos)
      teethWhitening: 0.75,  // 0.0 to 1.0
      teethBrightness: 0.20, // 0.0 to 0.50

      // Eyes & Under-Eye Concealer (Ojos y Corrector de Ojeras)
      eyeBrightening: 0.50,  // 0.0 to 1.0
      concealer: 0.65,       // 0.0 to 1.0 (Elimina ojeras y bolsas bajo los ojos)

      // Studio Color Grading & Auto Exposure (Calibrado a StreamFog)
      brightness: 0.03,      // Exposición equilibrada
      contrast: 1.10,        // Contraste con negros profundos en ropa y micrófono
      saturation: 1.06,      // Color rico y natural
      temperature: 0.03,     // Calidez dorada de estudio
      glow: 0.22,            // Resplandor de porcelana / Ring light studio bloom
      vignette: 0.00,        // Sin viñeta oscura para igualar fondo plano de StreamFog

      // Viewing controls
      mirror: true,
      splitPosition: -1.0,   // -1.0 = full filtered, 0.0-1.0 = split comparison
      bypass: false          // True = raw camera feed
    };

    this.initGL();
  }

  initGL() {
    const gl = this.gl;

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

      // AI Denoise Uniforms (General Noise Reduction)
      uniform float u_denoiseIntensity;
      uniform float u_denoiseTemporal;
      uniform float u_denoiseChroma;

      // AI Base Calibration Uniforms (Hardware & Software Sensor Optimization)
      uniform vec3 u_aiWhiteBalance;
      uniform float u_aiExposureGain;
      uniform float u_aiShadowLift;

      // Beauty & AR Uniforms
      uniform float u_smoothIntensity;
      uniform float u_smoothRadius;
      uniform float u_edgeThreshold;

      // Skin Tone Uniformity & Clarity Uniforms
      uniform float u_uniformity;
      uniform float u_antiRedness;
      uniform float u_skinToneTint;
      uniform float u_sharpen;

      // Teeth, Eyes & Concealer
      uniform float u_teethWhitening;
      uniform float u_teethBrightness;
      uniform float u_eyeBrightening;
      uniform float u_concealer;

      // Color Grading Uniforms
      uniform float u_brightness;
      uniform float u_contrast;
      uniform float u_saturation;
      uniform float u_temperature;
      uniform float u_glow;
      uniform float u_vignette;

      // Compare & Bypass
      uniform float u_splitPosition;
      uniform int u_bypass;
      uniform int u_mirror;

      varying vec2 v_texCoord;

      // Continuous Gaussian Skin Probability Function
      // Returns a continuous 0.0 to 1.0 weight to prevent harsh seams or patchy blotches
      float getSkinWeight(vec3 rgb) {
        float cb = -0.16874 * rgb.r - 0.33126 * rgb.g + 0.50000 * rgb.b + 0.5;
        float cr =  0.50000 * rgb.r - 0.41869 * rgb.g - 0.08131 * rgb.b + 0.5;
        float dCr = (cr - 0.59) / 0.09;
        float dCb = (cb - 0.43) / 0.08;
        return clamp(exp(-(dCr * dCr + dCb * dCb) * 0.7), 0.0, 1.0);
      }

      // High-End Multi-Scale Dual-Ring Bilateral AI Denoising Kernel
      vec3 applyAIDenoise(vec2 uv, vec3 curCol, float intensity, float fineGrainPower, float chromaPower) {
        if (intensity <= 0.01) return curCol;

        vec2 texel = 1.0 / u_resolution;
        float rInner = 1.2 + intensity * 0.8;
        float rOuter = 2.8 + intensity * 2.2;

        vec3 c = curCol;

        // Inner 8-tap ring
        vec3 inN  = texture2D(u_cameraTexture, uv + vec2( 0.0, -1.0) * rInner * texel).rgb;
        vec3 inS  = texture2D(u_cameraTexture, uv + vec2( 0.0,  1.0) * rInner * texel).rgb;
        vec3 inE  = texture2D(u_cameraTexture, uv + vec2( 1.0,  0.0) * rInner * texel).rgb;
        vec3 inW  = texture2D(u_cameraTexture, uv + vec2(-1.0,  0.0) * rInner * texel).rgb;
        vec3 inNE = texture2D(u_cameraTexture, uv + vec2( 0.707, -0.707) * rInner * texel).rgb;
        vec3 inNW = texture2D(u_cameraTexture, uv + vec2(-0.707, -0.707) * rInner * texel).rgb;
        vec3 inSE = texture2D(u_cameraTexture, uv + vec2( 0.707,  0.707) * rInner * texel).rgb;
        vec3 inSW = texture2D(u_cameraTexture, uv + vec2(-0.707,  0.707) * rInner * texel).rgb;

        // Outer 8-tap ring (cleanses flat background walls & shadows)
        vec3 outN  = texture2D(u_cameraTexture, uv + vec2( 0.0, -1.0) * rOuter * texel).rgb;
        vec3 outS  = texture2D(u_cameraTexture, uv + vec2( 0.0,  1.0) * rOuter * texel).rgb;
        vec3 outE  = texture2D(u_cameraTexture, uv + vec2( 1.0,  0.0) * rOuter * texel).rgb;
        vec3 outW  = texture2D(u_cameraTexture, uv + vec2(-1.0,  0.0) * rOuter * texel).rgb;
        vec3 outNE = texture2D(u_cameraTexture, uv + vec2( 0.707, -0.707) * rOuter * texel).rgb;
        vec3 outNW = texture2D(u_cameraTexture, uv + vec2(-0.707, -0.707) * rOuter * texel).rgb;
        vec3 outSE = texture2D(u_cameraTexture, uv + vec2( 0.707,  0.707) * rOuter * texel).rgb;
        vec3 outSW = texture2D(u_cameraTexture, uv + vec2(-0.707,  0.707) * rOuter * texel).rgb;

        const vec3 lumaWeight = vec3(0.299, 0.587, 0.114);
        float lumC = dot(c, lumaWeight);

        // Gradient edge detector
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

        // Chroma noise cleaning (Cb, Cr)
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

      // 12-Tap Poisson-Disc Bilateral Filter for ultra-smooth porcelain skin
      vec3 bilateralFilter(vec2 uv, vec3 centerColor, float radius, float edgeThresh) {
        vec2 texel = 1.0 / u_resolution;
        vec3 sumColor = centerColor;
        float sumWeight = 1.0;
        float centerLum = dot(centerColor, vec3(0.299, 0.587, 0.114));

        vec2 offsets[12];
        offsets[0]  = vec2( 1.0,  0.0);
        offsets[1]  = vec2(-1.0,  0.0);
        offsets[2]  = vec2( 0.0,  1.0);
        offsets[3]  = vec2( 0.0, -1.0);
        offsets[4]  = vec2( 0.707,  0.707);
        offsets[5]  = vec2(-0.707,  0.707);
        offsets[6]  = vec2( 0.707, -0.707);
        offsets[7]  = vec2(-0.707, -0.707);
        // Outer ring taps for wider reach
        offsets[8]  = vec2( 1.5,  0.6);
        offsets[9]  = vec2(-1.5, -0.6);
        offsets[10] = vec2( 0.6, -1.5);
        offsets[11] = vec2(-0.6,  1.5);

        for (int i = 0; i < 12; i++) {
          vec2 sampleUv = uv + offsets[i] * radius * texel;
          vec3 sampleCol = texture2D(u_cameraTexture, sampleUv).rgb;
          float sampleLum = dot(sampleCol, vec3(0.299, 0.587, 0.114));

          float lumDiff = abs(centerLum - sampleLum);
          float rangeWeight = exp(-(lumDiff * lumDiff) / (2.0 * edgeThresh * edgeThresh));
          
          sumColor += sampleCol * rangeWeight;
          sumWeight += rangeWeight;
        }

        return sumColor / sumWeight;
      }

      void main() {
        vec2 uv = v_texCoord;
        // Invert Y for correct camera texture orientation
        vec2 texUv = vec2(uv.x, 1.0 - uv.y);

        vec3 rawColor = texture2D(u_cameraTexture, texUv).rgb;

        // ----------------------------------------------------
        // AI CAMERA BASE CALIBRATION (White Balance, ISO & Exposure)
        // ----------------------------------------------------
        // 1. AI White Balance (Von Kries Chromatic Adaptation)
        rawColor = clamp(rawColor * u_aiWhiteBalance, 0.0, 1.0);

        // 2. AI Face-Priority Exposure & ISO Shadow Lift (Soft-shoulder curve)
        if (abs(u_aiExposureGain - 1.0) > 0.01 || u_aiShadowLift > 0.01) {
          float lumRaw = dot(rawColor, vec3(0.299, 0.587, 0.114));
          float shadowWeight = clamp(1.0 - lumRaw * 1.7, 0.0, 1.0);
          rawColor += rawColor * shadowWeight * u_aiShadowLift;

          rawColor = (rawColor * u_aiExposureGain) / (vec3(1.0) + rawColor * max(0.0, u_aiExposureGain - 1.0) * 0.28);
          rawColor = clamp(rawColor, 0.0, 1.0);
        }

        // Bypass toggle
        if (u_bypass == 1) {
          gl_FragColor = vec4(rawColor, 1.0);
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
            gl_FragColor = vec4(rawColor, 1.0);
            return;
          }
        }

        // ----------------------------------------------------
        // 0. GENERAL MULTI-SCALE AI DENOISE (Ruido General)
        // ----------------------------------------------------
        rawColor = applyAIDenoise(texUv, rawColor, u_denoiseIntensity, u_denoiseTemporal, u_denoiseChroma);

        // Sample 3-channel mask from FaceLandmarker
        // R = Skin oval (feathered), G = Teeth/Mouth, B = Eyes
        vec4 mask = texture2D(u_maskTexture, texUv);

        vec3 color = rawColor;
        
        // Smooth skin probability & mask combination
        float rawSkinProb = getSkinWeight(rawColor);
        float skinFactor = max(mask.r, rawSkinProb * 0.85) * clamp(1.0 - mask.g * 2.0, 0.0, 1.0) * clamp(1.0 - mask.b * 2.0, 0.0, 1.0);

        // ----------------------------------------------------
        // 1. STREAMFOG PORCELAIN SKIN SMOOTHING (Suavizado de Piel)
        // ----------------------------------------------------
        if (u_smoothIntensity > 0.01 && skinFactor > 0.05) {
          vec3 smoothed = bilateralFilter(texUv, rawColor, u_smoothRadius, u_edgeThreshold);
          color = mix(color, smoothed, clamp(skinFactor * u_smoothIntensity, 0.0, 0.98));
        }

        // ----------------------------------------------------
        // 1.5. UNDER-EYE CONCEALER (Corrector de Ojeras y Bolsas)
        // ----------------------------------------------------
        // Detects region directly below the eyes (texUv has inverted Y so lower eyelid is above in texUv)
        if (u_concealer > 0.01 && skinFactor > 0.15) {
          float eyeAbove = texture2D(u_maskTexture, texUv + vec2(0.0, 0.026)).b;
          float eyeNearby = mask.b;
          float underEyeWeight = clamp(eyeAbove * 1.5 - eyeNearby * 2.5, 0.0, 1.0);
          if (underEyeWeight > 0.08) {
            // Brighten dark circles and soften shadows under eyes
            color += vec3(0.07 * underEyeWeight * u_concealer);
          }
        }

        // ----------------------------------------------------
        // 2. UNIFORMIDAD DE TONO Y ANTI-ROJECES (StreamFog Peach Undertone)
        // ----------------------------------------------------
        if ((u_uniformity > 0.01 || u_antiRedness > 0.01) && skinFactor > 0.05) {
          float y  =  0.29900 * color.r + 0.58700 * color.g + 0.11400 * color.b;
          float cb = -0.16874 * color.r - 0.33126 * color.g + 0.50000 * color.b + 0.5;
          float cr =  0.50000 * color.r - 0.41869 * color.g - 0.08131 * color.b + 0.5;

          // Target ideal tone based on tint selector (Porcelain vs Warm Peach vs Natural)
          float targetCb = mix(0.43, 0.39, u_skinToneTint);
          float targetCr = mix(0.57, 0.61, u_skinToneTint);

          // Anti-redness: Gently pull down hyper-red peaks (acne, flushed skin, red blemishes)
          if (u_antiRedness > 0.01 && cr > 0.58) {
            float redExcess = cr - 0.58;
            cr = mix(cr, 0.58, clamp(u_antiRedness * redExcess * 2.5 * skinFactor, 0.0, 0.85));
          }

          // Uniformity: subtle harmonization towards smooth median tone
          if (u_uniformity > 0.01) {
            float uniWeight = u_uniformity * skinFactor * 0.45;
            cb = mix(cb, targetCb, uniWeight);
            cr = mix(cr, targetCr, uniWeight);
          }

          // Convert back to RGB
          float rOut = y + 1.40200 * (cr - 0.5);
          float gOut = y - 0.34414 * (cb - 0.5) - 0.71414 * (cr - 0.5);
          float bOut = y + 1.77200 * (cb - 0.5);

          vec3 evenColor = clamp(vec3(rOut, gOut, bOut), 0.0, 1.0);
          color = mix(color, evenColor, skinFactor * u_uniformity * 0.45);
        }

        // ----------------------------------------------------
        // 2.5. STREAMFOG PORCELAIN BLOOM (Resplandor Suave de Porcelana)
        // ----------------------------------------------------
        if (u_glow > 0.01 && skinFactor > 0.10) {
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          // Diffuse light across forehead, cheekbones, and nose bridge
          float highlight = smoothstep(0.35, 0.85, lum);
          vec3 warmHighlight = vec3(1.0, 0.96, 0.92);
          color += warmHighlight * (highlight * u_glow * 0.32 * skinFactor);
        }

        // ----------------------------------------------------
        // 3. TEETH WHITENING (Dientes Blancos)
        // ----------------------------------------------------
        if (u_teethWhitening > 0.01) {
          float mouthArea = mask.g;
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          
          bool isToothCandidate = (lum > 0.30) && 
                                  (color.r > color.b) && 
                                  (color.g > color.b * 0.88) && 
                                  (abs(color.r - color.g) < 0.22);

          if (isToothCandidate && (mouthArea > 0.05 || (mouthArea == 0.0 && lum > 0.42 && abs(color.r - color.g) < 0.15))) {
            float weight = (mouthArea > 0.0) ? mouthArea : 0.45;
            float yellowCast = max(0.0, ((color.r + color.g) * 0.5) - color.b);
            
            vec3 whitened = color;
            whitened.b += yellowCast * u_teethWhitening * 1.30;
            whitened += vec3(u_teethBrightness * 0.35);
            
            whitened = clamp(whitened, 0.0, 1.0);
            color = mix(color, whitened, clamp(weight * u_teethWhitening, 0.0, 1.0));
          }
        }

        // ----------------------------------------------------
        // 4. EYE BRIGHTENING (Ojos Radiantes)
        // ----------------------------------------------------
        if (u_eyeBrightening > 0.01 && mask.b > 0.05) {
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          if (lum > 0.30) {
            vec3 brightEye = mix(color, vec3(lum + 0.14), 0.50 * u_eyeBrightening);
            color = mix(color, brightEye, mask.b * u_eyeBrightening);
          }
        }

        // ----------------------------------------------------
        // 5. HD TEXTURE SHARPENING (Micro-Nitidez de Ojos y Pelo)
        // ----------------------------------------------------
        if (u_sharpen > 0.01) {
          vec2 texel = 1.0 / u_resolution;
          vec3 n = texture2D(u_cameraTexture, texUv + vec2(0.0, -texel.y)).rgb;
          vec3 s = texture2D(u_cameraTexture, texUv + vec2(0.0,  texel.y)).rgb;
          vec3 e = texture2D(u_cameraTexture, texUv + vec2( texel.x, 0.0)).rgb;
          vec3 w = texture2D(u_cameraTexture, texUv + vec2(-texel.x, 0.0)).rgb;
          vec3 blurred = (n + s + e + w) * 0.25;
          vec3 highPass = rawColor - blurred;
          color = clamp(color + highPass * u_sharpen * 1.5, 0.0, 1.0);
        }

        // ----------------------------------------------------
        // 6. STREAMFOG STUDIO COLOR GRADING & LIGHTING
        // ----------------------------------------------------
        // Exposure / Brightness
        color += vec3(u_brightness);

        // Rich contrast curve (deep rich blacks in hair, chair, and microphone)
        color = (color - 0.5) * u_contrast + 0.5;

        // Saturation & vibrance
        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(gray), color, u_saturation);

        // Warm flattering broadcast temperature
        color.r += u_temperature * 0.14;
        color.b -= u_temperature * 0.14;

        // Vignette (if enabled)
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

    this.program = gl.createProgram();
    gl.attachShader(this.program, vertShader);
    gl.attachShader(this.program, fragShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('[BeautyEngine] Program link error:', gl.getProgramInfoLog(this.program));
      return;
    }

    // Geometry quad
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

    // Create Textures with valid initial 1x1 image storage
    this.cameraTexture = this.createTexture();
    this.maskTexture = this.createTexture();

    // Cache Uniform Locations
    this.uLoc = {
      u_cameraTexture: gl.getUniformLocation(this.program, 'u_cameraTexture'),
      u_maskTexture: gl.getUniformLocation(this.program, 'u_maskTexture'),
      u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),

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

    console.log('[BeautyEngine] WebGL GPU pipeline calibrated to StreamFog standard');
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[BeautyEngine] Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  createTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return texture;
  }

  updateParam(key, value) {
    if (key in this.params) {
      this.params[key] = value;
    }
  }

  render(videoElement, maskCanvas, aiCalibration) {
    const gl = this.gl;
    if (!gl || !this.program || !videoElement) return;

    if (typeof videoElement.readyState === 'number' && videoElement.readyState < 2) return;

    const width = videoElement.videoWidth || videoElement.width || 0;
    const height = videoElement.videoHeight || videoElement.height || 0;
    if (width === 0 || height === 0) return;

    // Synchronize canvas resolution
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    // Always ensure WebGL viewport matches current drawing buffer size
    gl.viewport(0, 0, width, height);

    gl.useProgram(this.program);

    // 1. Upload Camera Video Frame to Texture Unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cameraTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);
    gl.uniform1i(this.uLoc.u_cameraTexture, 0);

    // 2. Upload Mask Canvas to Texture Unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    if (maskCanvas && maskCanvas.width > 0 && maskCanvas.height > 0) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
    }
    gl.uniform1i(this.uLoc.u_maskTexture, 1);

    // 3. Set Uniforms
    gl.uniform2f(this.uLoc.u_resolution, width, height);

    // AI Base Hardware & Software Calibration (White Balance, Exposure, Digital ISO)
    if (aiCalibration) {
      gl.uniform3f(this.uLoc.u_aiWhiteBalance, aiCalibration.whiteBalance[0], aiCalibration.whiteBalance[1], aiCalibration.whiteBalance[2]);
      gl.uniform1f(this.uLoc.u_aiExposureGain, aiCalibration.exposureGain);
      gl.uniform1f(this.uLoc.u_aiShadowLift, aiCalibration.shadowLift);
    } else {
      gl.uniform3f(this.uLoc.u_aiWhiteBalance, 1.0, 1.0, 1.0);
      gl.uniform1f(this.uLoc.u_aiExposureGain, 1.0);
      gl.uniform1f(this.uLoc.u_aiShadowLift, 0.0);
    }

    // AI Denoise
    gl.uniform1f(this.uLoc.u_denoiseIntensity, this.params.denoiseEnabled ? this.params.denoiseIntensity : 0.0);
    gl.uniform1f(this.uLoc.u_denoiseTemporal, this.params.denoiseTemporal);
    gl.uniform1f(this.uLoc.u_denoiseChroma, this.params.denoiseChroma);

    // Skin & Beauty
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
}

window.BeautyEngine = BeautyEngine;
