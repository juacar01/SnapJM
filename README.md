# 🌟 SnapJM - Studio AR Camera & Virtual Webcam

> **Alternativa moderna a StreamFog y Snap Camera desarrollada en Electron**, con procesamiento en tiempo real acelerado por GPU (WebGL), inteligencia artificial para detección facial (MediaPipe Face Mesh) y compatibilidad con **Snap Camera Kit SDK**.

---

## 🚀 Características Principales

### ✨ 1. Filtros de Belleza y Realidad Aumentada (GPU WebGL)
- **Suavizado de Piel Inteligente (Skin Smoothing)**:
  - Filtro bilateral adaptativo de 9 muestras que elimina poros marcados, acné, imperfecciones y rojeces.
  - **Preservación inteligente de bordes**: Mantiene nítidos ojos, pestañas, cejas, labios, barba, contornos y fondo sin crear el efecto "borroso" o "muñeco de cera".
  - Control de intensidad (0-100%), radio de desenfoque y sensibilidad de bordes.
- **Dientes Blancos (Teeth Whitening)**:
  - Detección precisa de la región bucal y esmalte dental en tiempo real.
  - Neutraliza los tonos amarillos y resalta el brillo del esmalte dental de forma natural, sin decolorar encías ni labios.
  - Control de intensidad de blanqueamiento y brillo dental.
- **Ojos Radiantes (Eye Brighten)**:
  - Ilumina la esclerótica (blanco de los ojos) eliminando la fatiga y realza la pupila y el iris.

### 🎨 2. Estudio de Iluminación y Color Grading
- Controles de exposición / brillo, contraste, saturación, temperatura cromática (cálido/frío), resplandor suave (*Soft Glow / Bloom*) y viñeta cinematográfica.
- **Presets instantáneos de un clic**:
  - `Natural`: Realce sutil para videollamadas del día a día.
  - `Porcelana`: Piel de seda y sonrisa brillante.
  - `Streamer Pro`: Look dinámico y vibrante para transmisiones en directo.
  - `Ultra Glam`: Máxima suavidad y glamour.
  - `Reset`: Vuelve a la señal de cámara original en neutro.

### 📡 3. Cámara Virtual y Compatibilidad Total con OBS Studio / Streamlabs
- Incluye un **Servidor de Transmisión Local embebido** (por defecto en el puerto `8554`):
  - **OBS Browser Source**: `http://localhost:8554` (Página de vista limpia a pantalla completa y cero latencia).
  - **Stream MJPEG**: `http://localhost:8554/stream.mjpeg` (Compatible con VLC, OBS Media Source, etc.).
- **Cómo usar en OBS Studio en 3 pasos**:
  1. Abre OBS Studio y añade una nueva fuente: **Navegador (Browser)**.
  2. En URL escribe `http://localhost:8554`.
  3. Establece la resolución (ej. `1920` x `1080`) y ¡listo! Tu cámara con filtros en tiempo real estará disponible en tu escena. Si pulsas **"Iniciar Cámara Virtual"** en OBS, cualquier app (Discord, Google Meet, Zoom, TikTok Live Studio) la recibirá como cámara web.

### 👻 4. Integración con Snap Camera Kit Oficial (Snap Inc.)
- Pestaña dedicada para conectar con el SDK oficial `@snap/camera-kit`.
- Permite ingresar tu API Token de desarrollador de Snap y tu Lens Group ID para cargar y aplicar lentes oficiales creados con Snapchat Lens Studio.

### ⚡ 5. Herramientas Rápidas de Estudio
- **Modo Comparación (Antes / Después)**: Barra divisoria interactiva deslizable para contrastar la imagen original vs la imagen procesada.
- **Modo Espejo (Mirror)**: Invierte la cámara horizontalmente con un clic.
- **Bypass instantáneo**: Activa o desactiva todos los filtros al instante para verificar el resultado.
- **Captura de Foto HD**: Toma fotos en alta resolución y las guarda automáticamente en tu carpeta de imágenes (`SnapJM_Captures`).
- **Grabador de Video en Vivo**: Graba clips en tiempo real (`.webm` / VP9) con un indicador de grabación rojo pulsante.

---

## 🛠️ Tecnologías Utilizadas

| Componente | Tecnología |
| :--- | :--- |
| **Framework Desktop** | [Electron](https://www.electronjs.org/) (Multiplataforma, aceleración por hardware Chromium) |
| **Motor de Renderizado AR** | WebGL Shaders (Bilateral Filter, Color space transform, Fragment Pipeline en GPU) |
| **Tracking Facial 3D** | MediaPipe FaceLandmarker (478 puntos faciales tridimensionales, 100% offline local) |
| **Snapchat Lenses** | Snap Camera Kit Web SDK (`@snap/camera-kit`) |
| **Streaming Output** | Node.js HTTP Streaming Server (MJPEG & OBS Browser Source) |

---

## 📦 Ejecución del Proyecto

1. Para iniciar la aplicación directamente desde la consola:
```powershell
npm start
```
2. O haz doble clic en el archivo `iniciar.bat` en Windows.
