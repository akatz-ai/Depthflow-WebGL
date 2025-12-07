# Two-Layer Depth Parallax with LaMa Inpainting

## Implementation Plan v2.0

**Goal**: Create a robust two-layer parallax system that uses AI-based inpainting (LaMa) to generate actual background content behind foreground objects, eliminating edge stretching artifacts entirely.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PROCESSING PIPELINE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐   │
│  │  Input   │───▶│Depth Anything│───▶│   Mask      │───▶│    LaMa      │   │
│  │  Image   │    │     V2       │    │ Extraction  │    │  Inpainting  │   │
│  └──────────┘    └──────────────┘    └─────────────┘    └──────────────┘   │
│       │                │                    │                   │           │
│       │                ▼                    │                   ▼           │
│       │         ┌──────────┐               │            ┌──────────────┐   │
│       │         │  Depth   │               │            │  Inpainted   │   │
│       │         │   Map    │               │            │  Background  │   │
│       │         └──────────┘               │            │    Image     │   │
│       │                │                    │            └──────────────┘   │
│       │                ▼                    │                   │           │
│       │         ┌──────────────────────────┴───────────────────┤           │
│       │         │              Layer Separation                 │           │
│       │         └──────────────────────────┬───────────────────┘           │
│       │                                     │                               │
│       ▼                                     ▼                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        WebGL Renderer                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ uImage      │  │ uDepth      │  │ uImageBG    │  │ uDepthBG   │  │   │
│  │  │ (Original)  │  │ (Original)  │  │ (Inpainted) │  │ (BG Layer) │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  │                           │                                          │   │
│  │                           ▼                                          │   │
│  │              ┌───────────────────────────┐                           │   │
│  │              │  Single Ray March with    │                           │   │
│  │              │  Steepness Detection      │                           │   │
│  │              │  + Layer Switching        │                           │   │
│  │              └───────────────────────────┘                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Model Integration

### 1.1 Required Models

| Model | Purpose | Size | Source |
|-------|---------|------|--------|
| Depth Anything V2 Small | Monocular depth estimation | ~20MB | `onnx-community/depth-anything-v2-small` |
| LaMa FP32 | Image inpainting | ~363MB | `https://huggingface.co/g-ronimo/lama/resolve/main/lama_fp32.onnx` |

### 1.2 File Structure

```
two-layer-depth-demo/
├── src/
│   ├── js/
│   │   ├── main.js              # Application orchestration
│   │   ├── renderer.js          # WebGL rendering (modified)
│   │   ├── state.js             # Application state
│   │   ├── ui.js                # User interface
│   │   ├── depth-estimator.js   # NEW: Depth Anything V2 wrapper
│   │   ├── inpainter.js         # NEW: LaMa ONNX wrapper
│   │   ├── layer-processor.js   # NEW: FG/BG layer separation
│   │   ├── imageutils.js        # NEW: Tensor conversion utilities
│   │   └── workers/
│   │       ├── depth-worker.js  # NEW: Depth estimation worker
│   │       └── lama-worker.js   # NEW: LaMa inpainting worker
│   ├── shaders/
│   │   ├── vertex.glsl
│   │   └── fragment.glsl        # Modified for two-layer sampling
│   └── lib/
│       └── ort.webgpu.mjs       # ONNX Runtime WebGPU module
├── index.html
└── IMPLEMENTATION_PLAN.md
```

---

## Phase 2: Processing Pipeline

### 2.1 Step 1: Depth Estimation

**Input**: User's color image (any resolution)
**Output**: Grayscale depth map (same resolution as input)

```javascript
// depth-estimator.js
import { pipeline } from '@huggingface/transformers';

export class DepthEstimator {
    constructor() {
        this.model = null;
    }

    async init(onProgress) {
        this.model = await pipeline(
            'depth-estimation',
            'onnx-community/depth-anything-v2-small',
            {
                device: 'webgpu',
                progress_callback: onProgress
            }
        );
    }

    async estimate(imageSource) {
        const result = await this.model(imageSource);
        return result.depth; // { width, height, data: Float32Array }
    }

    toImageData(depthImage) {
        const { width, height, data } = depthImage;
        const imageData = new ImageData(width, height);

        for (let i = 0; i < data.length; i++) {
            const val = Math.round(data[i] * 255);
            imageData.data[i * 4] = val;     // R
            imageData.data[i * 4 + 1] = val; // G
            imageData.data[i * 4 + 2] = val; // B
            imageData.data[i * 4 + 3] = 255; // A
        }
        return imageData;
    }
}
```

### 2.2 Step 2: Foreground/Background Mask Extraction

**Input**: Depth map (ImageData)
**Output**: Binary mask (ImageData) where white = foreground, black = background

```javascript
// layer-processor.js
export class LayerProcessor {
    constructor() {
        this.foregroundThreshold = 0.4;  // Depth values above this = foreground
        this.edgeDilation = 5;            // Pixels to expand mask edges
        this.gradientThreshold = 0.15;    // Detect depth discontinuities
    }

    /**
     * Extract foreground mask from depth map
     * Uses threshold + gradient-based edge detection
     */
    extractForegroundMask(depthImageData) {
        const { width, height, data } = depthImageData;
        const mask = new Uint8Array(width * height);

        // Convert to normalized depth array
        const depth = new Float32Array(width * height);
        for (let i = 0; i < depth.length; i++) {
            depth[i] = data[i * 4] / 255.0;
        }

        // Pass 1: Threshold-based foreground detection
        for (let i = 0; i < depth.length; i++) {
            mask[i] = depth[i] > this.foregroundThreshold ? 1 : 0;
        }

        // Pass 2: Gradient-based edge detection
        // Mark high-gradient regions as foreground (depth discontinuities)
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const d = depth[idx];

                // Sobel-like gradient
                const dx = Math.abs(depth[idx + 1] - depth[idx - 1]) / 2;
                const dy = Math.abs(depth[idx + width] - depth[idx - width]) / 2;
                const gradient = Math.sqrt(dx * dx + dy * dy);

                if (gradient > this.gradientThreshold && d > this.foregroundThreshold * 0.7) {
                    mask[idx] = 1;
                }
            }
        }

        // Pass 3: Dilate mask to cover edge artifacts
        const dilatedMask = this.dilateMask(mask, width, height, this.edgeDilation);

        return this.maskToImageData(dilatedMask, width, height);
    }

    /**
     * Morphological dilation with circular kernel
     */
    dilateMask(mask, width, height, radius) {
        const output = new Uint8Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                let found = false;

                for (let ky = -radius; ky <= radius && !found; ky++) {
                    for (let kx = -radius; kx <= radius && !found; kx++) {
                        if (kx * kx + ky * ky <= radius * radius) {
                            const sx = Math.min(Math.max(x + kx, 0), width - 1);
                            const sy = Math.min(Math.max(y + ky, 0), height - 1);
                            if (mask[sy * width + sx] === 1) {
                                found = true;
                            }
                        }
                    }
                }
                output[idx] = found ? 1 : 0;
            }
        }
        return output;
    }

    /**
     * Extract background depth by inpainting foreground regions
     * Uses push-pull algorithm for smooth interpolation
     */
    extractBackgroundDepth(depthImageData, maskImageData) {
        // ... existing push-pull implementation from depth-processor.js
    }

    maskToImageData(mask, width, height) {
        const imageData = new ImageData(width, height);
        for (let i = 0; i < mask.length; i++) {
            const val = mask[i] * 255;
            imageData.data[i * 4] = val;
            imageData.data[i * 4 + 1] = val;
            imageData.data[i * 4 + 2] = val;
            imageData.data[i * 4 + 3] = 255;
        }
        return imageData;
    }
}
```

### 2.3 Step 3: Create Masked Image for Inpainting

**Input**: Original image + foreground mask
**Output**: Image with foreground removed (black/transparent holes)

```javascript
// layer-processor.js (continued)
export class LayerProcessor {
    /**
     * Create image with foreground masked out for LaMa inpainting
     */
    createMaskedImage(imageCanvas, maskImageData) {
        const { width, height } = maskImageData;

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = width;
        outputCanvas.height = height;
        const ctx = outputCanvas.getContext('2d');

        // Draw original image
        ctx.drawImage(imageCanvas, 0, 0, width, height);

        // Get image data
        const imageData = ctx.getImageData(0, 0, width, height);

        // Zero out masked (foreground) pixels
        for (let i = 0; i < maskImageData.data.length / 4; i++) {
            const maskVal = maskImageData.data[i * 4]; // R channel = mask
            if (maskVal > 127) { // Foreground
                imageData.data[i * 4] = 0;     // R
                imageData.data[i * 4 + 1] = 0; // G
                imageData.data[i * 4 + 2] = 0; // B
                // Keep alpha = 255 for LaMa
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return outputCanvas;
    }
}
```

### 2.4 Step 4: LaMa Inpainting

**Input**: Masked image (512x512) + binary mask (512x512)
**Output**: Inpainted image with foreground regions filled

```javascript
// inpainter.js
import * as ort from '../lib/ort.webgpu.mjs';

const MODEL_URL = 'https://huggingface.co/g-ronimo/lama/resolve/main/lama_fp32.onnx';

export class Inpainter {
    constructor() {
        this.modelSession = null;
        this.modelBuffer = null;
        this.device = null;
    }

    /**
     * Download and cache the LaMa model (~363MB)
     */
    async downloadModel(onProgress) {
        // Check browser cache first
        const root = await navigator.storage.getDirectory();
        const filename = 'lama_fp32.onnx';

        try {
            const fileHandle = await root.getFileHandle(filename);
            const file = await fileHandle.getFile();
            if (file.size > 0) {
                onProgress?.({ status: 'cached', progress: 100 });
                this.modelBuffer = await file.arrayBuffer();
                return;
            }
        } catch (e) {
            // File doesn't exist, download it
        }

        // Download from HuggingFace
        onProgress?.({ status: 'downloading', progress: 0 });

        const response = await fetch(MODEL_URL, { mode: 'cors' });
        const reader = response.body.getReader();
        const contentLength = +response.headers.get('Content-Length');

        let receivedLength = 0;
        const chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedLength += value.length;

            onProgress?.({
                status: 'downloading',
                progress: Math.round((receivedLength / contentLength) * 100)
            });
        }

        // Combine chunks
        this.modelBuffer = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
            this.modelBuffer.set(chunk, position);
            position += chunk.length;
        }

        // Cache for future use
        const fileHandle = await root.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(this.modelBuffer);
        await writable.close();

        onProgress?.({ status: 'cached', progress: 100 });
    }

    /**
     * Create ONNX inference session (tries WebGPU, falls back to CPU)
     */
    async createSession() {
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';

        for (const ep of ['webgpu', 'cpu']) {
            try {
                this.modelSession = await ort.InferenceSession.create(
                    this.modelBuffer,
                    { executionProviders: [ep] }
                );
                this.device = ep;
                console.log(`LaMa model loaded on ${ep}`);
                return { success: true, device: ep };
            } catch (e) {
                console.warn(`Failed to load on ${ep}:`, e);
            }
        }

        return { success: false, device: null };
    }

    /**
     * Run inpainting inference
     * @param {Canvas} imageCanvas - Image with holes to fill
     * @param {Canvas} maskCanvas - Binary mask (white = areas to inpaint)
     * @returns {Canvas} - Inpainted result
     */
    async inpaint(imageCanvas, maskCanvas) {
        const INPAINT_SIZE = 512;

        // Resize to 512x512 (LaMa fixed size)
        const resizedImage = this.resizeCanvas(imageCanvas, INPAINT_SIZE, INPAINT_SIZE);
        const resizedMask = this.resizeCanvas(maskCanvas, INPAINT_SIZE, INPAINT_SIZE);

        // Convert to tensors
        const imageTensor = this.canvasToImageTensor(resizedImage);
        const maskTensor = this.canvasToMaskTensor(resizedMask);

        // Run inference
        const results = await this.modelSession.run({
            image: imageTensor,
            mask: maskTensor
        });

        // Convert output tensor to canvas
        const outputCanvas = this.tensorToCanvas(results.output);

        // Resize back to original dimensions
        return this.resizeCanvas(outputCanvas, imageCanvas.width, imageCanvas.height);
    }

    /**
     * Convert canvas to CHW float32 tensor [1, 3, H, W]
     */
    canvasToImageTensor(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data, width, height } = imageData;

        const float32 = new Float32Array(3 * width * height);
        const stride = width * height;

        for (let i = 0; i < width * height; i++) {
            float32[i] = data[i * 4] / 255.0;                 // R
            float32[i + stride] = data[i * 4 + 1] / 255.0;    // G
            float32[i + stride * 2] = data[i * 4 + 2] / 255.0; // B
        }

        return new ort.Tensor('float32', float32, [1, 3, height, width]);
    }

    /**
     * Convert canvas to 1HW float32 mask tensor [1, 1, H, W]
     */
    canvasToMaskTensor(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data, width, height } = imageData;

        const float32 = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
            // Any non-black pixel = mask
            const rgb = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2];
            float32[i] = rgb > 0 ? 1.0 : 0.0;
        }

        return new ort.Tensor('float32', float32, [1, 1, height, width]);
    }

    /**
     * Convert output tensor [1, 3, H, W] to canvas
     */
    tensorToCanvas(tensor) {
        const [, , height, width] = tensor.dims;
        const data = tensor.cpuData;
        const stride = width * height;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const imageData = ctx.createImageData(width, height);

        for (let i = 0; i < width * height; i++) {
            imageData.data[i * 4] = Math.round(data[i]);                 // R
            imageData.data[i * 4 + 1] = Math.round(data[i + stride]);    // G
            imageData.data[i * 4 + 2] = Math.round(data[i + stride * 2]); // B
            imageData.data[i * 4 + 3] = 255;                              // A
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    resizeCanvas(canvas, width, height) {
        const resized = document.createElement('canvas');
        resized.width = width;
        resized.height = height;
        resized.getContext('2d').drawImage(canvas, 0, 0, width, height);
        return resized;
    }
}
```

---

## Phase 3: Shader Implementation

### 3.1 Two-Layer Fragment Shader

The shader performs a single ray march but switches between foreground and background texture sampling based on the steepness heuristic.

```glsl
#version 300 es
precision highp float;

// ============================================
// Two-Layer Depth Parallax with LaMa Inpainting
// v4: True two-layer texture switching
// ============================================

in vec2 vUV;
in vec2 vGluv;

out vec4 fragColor;

// Foreground layer (original)
uniform sampler2D uImage;         // Original color image
uniform sampler2D uDepth;         // Original depth map

// Background layer (inpainted)
uniform sampler2D uImageBG;       // LaMa-inpainted background image
uniform sampler2D uDepthBG;       // Push-pull inpainted background depth

// Foreground mask (for reference/visualization)
uniform sampler2D uMask;

// Resolution & aspect
uniform vec2 uResolution;
uniform float uImageAspect;

// Parallax parameters
uniform float uHeight;
uniform float uSteady;
uniform float uFocus;
uniform float uZoom;
uniform float uIsometric;
uniform float uDolly;
uniform float uInvert;
uniform bool uMirror;
uniform float uQuality;

// Two-layer blending parameters
uniform float uLayerBlend;        // 0 = FG only, 1 = full two-layer mode
uniform float uSteepnessLimit;    // Threshold for layer switching
uniform float uBlendSoftness;     // Transition smoothness
uniform int uVisualization;

// Camera
uniform vec2 uOffset;
uniform vec2 uCenter;
uniform vec2 uOrigin;

// ============================================
// Utility Functions
// ============================================

float triangleWave(float x, float period) {
    return 2.0 * abs(mod(2.0 * x / period - 0.5, 2.0) - 1.0) - 1.0;
}

vec2 mirroredRepeat(vec2 gluv, float aspect) {
    return vec2(
        aspect * triangleWave(gluv.x, 4.0 * aspect),
        triangleWave(gluv.y, 4.0)
    );
}

vec2 gluvToStuv(vec2 gluv, float aspect) {
    vec2 scale = vec2(1.0 / aspect, 1.0);
    vec2 stuv = (gluv * scale + 1.0) / 2.0;
    stuv.y = 1.0 - stuv.y;
    return stuv;
}

vec4 sampleTex(sampler2D tex, vec2 gluv) {
    if (uMirror) {
        gluv = mirroredRepeat(gluv, uImageAspect);
    }
    return texture(tex, gluvToStuv(gluv, uImageAspect));
}

float sampleDepthFG(vec2 gluv) {
    float d = sampleTex(uDepth, gluv).r;
    return mix(d, 1.0 - d, uInvert);
}

float sampleDepthBG(vec2 gluv) {
    float d = sampleTex(uDepthBG, gluv).r;
    return mix(d, 1.0 - d, uInvert);
}

float vectorAngle(vec3 a, vec3 b) {
    return acos(clamp(dot(normalize(a), normalize(b)), -1.0, 1.0));
}

// ============================================
// Ray March with Layer Detection
// ============================================

struct RayHit {
    vec2 uv;
    float depth;
    float derivative;
    float steep;
    vec3 normal;
    bool valid;
    bool isBackground;  // True if hit is in steep/inpaint region
};

RayHit rayMarch(vec2 screenGluv) {
    RayHit hit;
    hit.valid = true;
    hit.isBackground = false;

    float relFocus = uFocus * uHeight;
    float relSteady = uSteady * uHeight;

    vec2 cameraXY = uOffset + uCenter;
    vec3 camPos = vec3(cameraXY, 0.0);

    vec3 rayOrigin = camPos
        + vec3(screenGluv * uZoom * uIsometric, 0.0)
        + vec3(0.0, 0.0, -uDolly)
        + vec3(uOrigin, 0.0);

    vec3 intersect = vec3(uCenter + screenGluv, 1.0);
    if (abs(1.0 - relSteady) > 0.001) {
        intersect -= vec3(cameraXY, 0.0) * (1.0 / (1.0 - relSteady));
    }

    float probeStep = 1.0 / mix(50.0, 120.0, uQuality);
    float fineStep = 1.0 / mix(200.0, 2000.0, uQuality);
    float safe = 1.0 - uHeight;

    float walk = 0.0;
    vec2 hitUV = screenGluv;
    float hitDepth = 0.0;
    float lastDepth = 0.0;

    // Forward march (coarse)
    for (int i = 0; i < 200; i++) {
        if (walk > 1.0) break;
        walk += probeStep;

        vec3 point = mix(rayOrigin, intersect, mix(safe, 1.0, walk));
        hitUV = point.xy;

        lastDepth = hitDepth;
        hitDepth = sampleDepthFG(hitUV);

        float surface = uHeight * hitDepth;
        float ceiling = 1.0 - point.z;

        if (ceiling < surface) {
            break;
        }
    }

    // Backward refinement (fine)
    for (int i = 0; i < 100; i++) {
        walk -= fineStep;

        vec3 point = mix(rayOrigin, intersect, mix(safe, 1.0, walk));
        hitUV = point.xy;

        lastDepth = hitDepth;
        hitDepth = sampleDepthFG(hitUV);

        float surface = uHeight * hitDepth;
        float ceiling = 1.0 - point.z;

        if (ceiling >= surface) {
            hit.derivative = (lastDepth - hitDepth) / fineStep;
            break;
        }
    }

    hit.uv = hitUV;
    hit.depth = hitDepth;

    // Compute surface normal and steepness
    float gradStep = fineStep;
    hit.normal = normalize(vec3(
        (sampleDepthFG(hitUV - vec2(gradStep, 0.0)) - hitDepth) / gradStep,
        (sampleDepthFG(hitUV - vec2(0.0, gradStep)) - hitDepth) / gradStep,
        max(uHeight, gradStep)
    ));

    float normalAngle = vectorAngle(hit.normal, vec3(0.0, 0.0, 1.0));
    hit.steep = abs(hit.derivative) * normalAngle;

    // Determine if this is a background region
    hit.isBackground = hit.steep > uSteepnessLimit;

    // Bounds check
    if (!uMirror) {
        vec2 normalized = hitUV / vec2(uImageAspect, 1.0);
        if (abs(normalized.x) > 1.0 || abs(normalized.y) > 1.0) {
            hit.valid = false;
        }
    }

    return hit;
}

// ============================================
// Background Layer Ray March
// ============================================

vec2 rayMarchBackground(vec2 screenGluv) {
    // Same ray march but using background depth map
    float relFocus = uFocus * uHeight;
    float relSteady = uSteady * uHeight;

    vec2 cameraXY = uOffset + uCenter;
    vec3 camPos = vec3(cameraXY, 0.0);

    vec3 rayOrigin = camPos
        + vec3(screenGluv * uZoom * uIsometric, 0.0)
        + vec3(0.0, 0.0, -uDolly)
        + vec3(uOrigin, 0.0);

    vec3 intersect = vec3(uCenter + screenGluv, 1.0);
    if (abs(1.0 - relSteady) > 0.001) {
        intersect -= vec3(cameraXY, 0.0) * (1.0 / (1.0 - relSteady));
    }

    float probeStep = 1.0 / mix(50.0, 120.0, uQuality);
    float fineStep = 1.0 / mix(200.0, 2000.0, uQuality);
    float safe = 1.0 - uHeight;

    float walk = 0.0;
    vec2 hitUV = screenGluv;
    float hitDepth = 0.0;

    // Forward march using BACKGROUND depth
    for (int i = 0; i < 200; i++) {
        if (walk > 1.0) break;
        walk += probeStep;

        vec3 point = mix(rayOrigin, intersect, mix(safe, 1.0, walk));
        hitUV = point.xy;
        hitDepth = sampleDepthBG(hitUV);  // <-- Background depth!

        float surface = uHeight * hitDepth;
        float ceiling = 1.0 - point.z;

        if (ceiling < surface) {
            break;
        }
    }

    // Backward refinement
    for (int i = 0; i < 100; i++) {
        walk -= fineStep;

        vec3 point = mix(rayOrigin, intersect, mix(safe, 1.0, walk));
        hitUV = point.xy;
        hitDepth = sampleDepthBG(hitUV);

        float surface = uHeight * hitDepth;
        float ceiling = 1.0 - point.z;

        if (ceiling >= surface) {
            break;
        }
    }

    return hitUV;
}

// ============================================
// Main
// ============================================

void main() {
    // Ray march foreground layer (with steepness detection)
    RayHit hit = rayMarch(vGluv);

    if (!hit.valid) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Sample foreground color
    vec4 fgColor = sampleTex(uImage, hit.uv);

    // If two-layer mode disabled, just use foreground
    if (uLayerBlend < 0.01) {
        fragColor = fgColor;
        return;
    }

    // If in steep/inpaint region, blend with background layer
    if (hit.isBackground) {
        // Ray march background layer to get proper UV
        vec2 bgUV = rayMarchBackground(vGluv);

        // Sample from LaMa-inpainted background image
        vec4 bgColor = sampleTex(uImageBG, bgUV);

        // Smooth blend based on steepness amount
        float overThreshold = (hit.steep - uSteepnessLimit) / max(uSteepnessLimit, 0.01);
        float blendFactor = smoothstep(0.0, 1.0 + uBlendSoftness, overThreshold);
        blendFactor *= uLayerBlend;

        fragColor = mix(fgColor, bgColor, blendFactor);
    } else {
        fragColor = fgColor;
    }
}
```

---

## Phase 4: Renderer Integration

### 4.1 Updated Renderer Class

```javascript
// renderer.js
export class Renderer {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.gl = null;
        this.program = null;
        this.uniforms = {};

        // Four textures for two-layer system
        this.textures = {
            image: null,        // Original color image
            depth: null,        // Original depth map
            imageBG: null,      // LaMa-inpainted background
            depthBG: null,      // Push-pull inpainted background depth
            mask: null          // Foreground mask (for visualization)
        };

        this.imageAspect = 1.0;
    }

    async init() {
        this.gl = this.canvas.getContext('webgl2', {
            antialias: false,
            alpha: false,
            preserveDrawingBuffer: false
        });

        if (!this.gl) {
            throw new Error('WebGL 2.0 not supported');
        }

        const [vertSrc, fragSrc] = await Promise.all([
            fetch('src/shaders/vertex.glsl').then(r => r.text()),
            fetch('src/shaders/fragment.glsl').then(r => r.text())
        ]);

        this.program = this.createProgram(vertSrc, fragSrc);
        this.gl.useProgram(this.program);

        this.cacheUniformLocations();
        this.createQuad();
        this.createPlaceholderTextures();

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    cacheUniformLocations() {
        const gl = this.gl;
        const names = [
            // Textures
            'uImage', 'uDepth', 'uImageBG', 'uDepthBG', 'uMask',
            // Resolution
            'uResolution', 'uImageAspect',
            // Parallax
            'uHeight', 'uSteady', 'uFocus', 'uZoom', 'uIsometric',
            'uDolly', 'uInvert', 'uMirror', 'uQuality',
            // Two-layer
            'uLayerBlend', 'uSteepnessLimit', 'uBlendSoftness', 'uVisualization',
            // Camera
            'uOffset', 'uCenter', 'uOrigin'
        ];

        for (const name of names) {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
    }

    /**
     * Load all four layer textures
     */
    loadLayers({ image, depth, imageBG, depthBG, mask }) {
        if (image) this.uploadTexture('image', image);
        if (depth) this.uploadTexture('depth', depth);
        if (imageBG) this.uploadTexture('imageBG', imageBG);
        if (depthBG) this.uploadTexture('depthBG', depthBG);
        if (mask) this.uploadTexture('mask', mask);
    }

    uploadTexture(name, source) {
        const gl = this.gl;

        if (this.textures[name]) {
            gl.deleteTexture(this.textures[name]);
        }

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);

        // Handle different source types
        if (source instanceof ImageData) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        } else if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.textures[name] = tex;
    }

    render() {
        const gl = this.gl;
        const s = this.state;

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Bind all 5 textures
        const textureUnits = [
            ['image', 'uImage', 0],
            ['depth', 'uDepth', 1],
            ['imageBG', 'uImageBG', 2],
            ['depthBG', 'uDepthBG', 3],
            ['mask', 'uMask', 4]
        ];

        for (const [texName, uniformName, unit] of textureUnits) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, this.textures[texName]);
            gl.uniform1i(this.uniforms[uniformName], unit);
        }

        // Set uniforms
        gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.uImageAspect, this.imageAspect);

        gl.uniform1f(this.uniforms.uHeight, s.height);
        gl.uniform1f(this.uniforms.uSteady, s.steady);
        gl.uniform1f(this.uniforms.uFocus, s.focus);
        gl.uniform1f(this.uniforms.uZoom, Math.pow(2, s.zoom / 100));
        gl.uniform1f(this.uniforms.uIsometric, s.isometric);
        gl.uniform1f(this.uniforms.uDolly, s.dolly);
        gl.uniform1f(this.uniforms.uInvert, s.invert);
        gl.uniform1i(this.uniforms.uMirror, s.mirror ? 1 : 0);
        gl.uniform1f(this.uniforms.uQuality, s.quality);

        // Two-layer parameters
        gl.uniform1f(this.uniforms.uLayerBlend, s.layerBlend);
        gl.uniform1f(this.uniforms.uSteepnessLimit, s.steepnessLimit);
        gl.uniform1f(this.uniforms.uBlendSoftness, s.blendSoftness);
        gl.uniform1i(this.uniforms.uVisualization, s.visualization);

        gl.uniform2f(this.uniforms.uOffset, s.offsetX, s.offsetY);
        gl.uniform2f(this.uniforms.uCenter, s.centerX, s.centerY);
        gl.uniform2f(this.uniforms.uOrigin, s.originX, s.originY);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ... other methods (createProgram, createQuad, resize, etc.)
}
```

---

## Phase 5: Complete Application Flow

### 5.1 Main Application Class

```javascript
// main.js
import { DepthEstimator } from './depth-estimator.js';
import { Inpainter } from './inpainter.js';
import { LayerProcessor } from './layer-processor.js';
import { Renderer } from './renderer.js';
import { State } from './state.js';
import { UI } from './ui.js';

export class TwoLayerDepthApp {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.state = new State();
        this.renderer = new Renderer(this.canvas, this.state);
        this.ui = new UI(this.state, this);

        this.depthEstimator = new DepthEstimator();
        this.inpainter = new Inpainter();
        this.layerProcessor = new LayerProcessor();

        // Processing state
        this.originalImage = null;
        this.depthMap = null;
    }

    async init() {
        this.ui.showStatus('Initializing WebGL...');
        await this.renderer.init();

        this.ui.showStatus('Loading depth estimation model (~20MB)...');
        await this.depthEstimator.init((p) => {
            this.ui.showStatus(`Loading depth model: ${Math.round(p.progress || 0)}%`);
        });

        this.ui.showStatus('Loading LaMa inpainting model (~363MB)...');
        await this.inpainter.downloadModel((p) => {
            this.ui.showStatus(`Loading LaMa model: ${p.progress}%`);
        });
        await this.inpainter.createSession();

        this.ui.showStatus('Ready! Load an image to begin.');
        this.ui.init();
        this.startRenderLoop();
    }

    /**
     * Main processing pipeline
     */
    async processImage(imageFile) {
        try {
            // Step 1: Load original image
            this.ui.showStatus('Loading image...');
            this.originalImage = await this.loadImageAsCanvas(imageFile);
            this.renderer.imageAspect = this.originalImage.width / this.originalImage.height;

            // Step 2: Estimate depth
            this.ui.showStatus('Estimating depth...');
            const depthImage = await this.depthEstimator.estimate(imageFile);
            this.depthMap = this.depthEstimator.toImageData(depthImage);

            // Step 3: Extract foreground mask
            this.ui.showStatus('Extracting layers...');
            const mask = this.layerProcessor.extractForegroundMask(this.depthMap);

            // Step 4: Create masked image for inpainting
            const maskedImage = this.layerProcessor.createMaskedImage(
                this.originalImage,
                mask
            );

            // Step 5: Extract background depth (push-pull inpainting)
            const backgroundDepth = this.layerProcessor.extractBackgroundDepth(
                this.depthMap,
                mask
            );

            // Step 6: Run LaMa inpainting to fill foreground holes
            this.ui.showStatus('Running AI inpainting (this may take a moment)...');
            const inpaintedBackground = await this.inpainter.inpaint(
                maskedImage,
                mask  // Use same mask for LaMa
            );

            // Step 7: Upload all textures to GPU
            this.ui.showStatus('Uploading to GPU...');
            this.renderer.loadLayers({
                image: this.originalImage,
                depth: this.depthMap,
                imageBG: inpaintedBackground,
                depthBG: backgroundDepth,
                mask: mask
            });

            this.ui.showStatus('Done! Move mouse to see parallax effect.');

        } catch (error) {
            console.error('Processing failed:', error);
            this.ui.showStatus(`Error: ${error.message}`);
        }
    }

    /**
     * Alternative: User provides their own depth map
     */
    async processWithCustomDepth(imageFile, depthFile) {
        // Step 1: Load both images
        this.ui.showStatus('Loading images...');
        this.originalImage = await this.loadImageAsCanvas(imageFile);
        const depthCanvas = await this.loadImageAsCanvas(depthFile);

        // Convert depth canvas to ImageData
        const depthCtx = depthCanvas.getContext('2d');
        this.depthMap = depthCtx.getImageData(0, 0, depthCanvas.width, depthCanvas.height);

        // Continue with same pipeline from step 3...
        await this.processFromDepthMap();
    }

    async processFromDepthMap() {
        // Steps 3-7 from processImage()
        // ... (same code)
    }

    loadImageAsCanvas(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
                resolve(canvas);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    startRenderLoop() {
        const loop = () => {
            this.state.update();
            this.renderer.render();
            requestAnimationFrame(loop);
        };
        loop();
    }
}

// Entry point
document.addEventListener('DOMContentLoaded', async () => {
    const app = new TwoLayerDepthApp();
    await app.init();
});
```

---

## Phase 6: Performance Optimizations

### 6.1 Web Worker Architecture

Move heavy processing off main thread:

```javascript
// workers/processing-worker.js
import { LayerProcessor } from '../layer-processor.js';

const processor = new LayerProcessor();

self.onmessage = async (e) => {
    const { type, data } = e.data;

    switch (type) {
        case 'extractMask':
            const mask = processor.extractForegroundMask(data.depthImageData);
            self.postMessage({ type: 'maskDone', data: mask });
            break;

        case 'extractBackgroundDepth':
            const bgDepth = processor.extractBackgroundDepth(
                data.depthImageData,
                data.maskImageData
            );
            self.postMessage({ type: 'bgDepthDone', data: bgDepth });
            break;
    }
};
```

### 6.2 Caching Strategy

```javascript
// Cache processed layers for parameter changes
class LayerCache {
    constructor() {
        this.cache = new Map();
    }

    getKey(imageHash, params) {
        return `${imageHash}-${params.threshold}-${params.dilation}`;
    }

    get(imageHash, params) {
        return this.cache.get(this.getKey(imageHash, params));
    }

    set(imageHash, params, layers) {
        this.cache.set(this.getKey(imageHash, params), layers);
    }
}
```

---

## Phase 7: User Interface

### 7.1 Controls

| Control | Description | Range | Default |
|---------|-------------|-------|---------|
| Layer Blend | Enable two-layer mode | 0-1 | 1.0 |
| Steepness Limit | Threshold for BG switching | 0.1-5.0 | 1.0 |
| Blend Softness | Transition smoothness | 0-2 | 0.5 |
| FG Threshold | Depth threshold for mask | 0.1-0.9 | 0.4 |
| Mask Dilation | Edge expansion pixels | 0-20 | 5 |

### 7.2 Visualization Modes

| Mode | Description |
|------|-------------|
| 0 | Normal render (two-layer composite) |
| 1 | Original depth map |
| 2 | Background depth (inpainted) |
| 3 | Foreground mask |
| 4 | Depth difference (FG - BG) |
| 5 | Steepness heatmap |
| 6 | Foreground only (no blending) |
| 7 | Background only (LaMa inpainted) |
| 8 | Side-by-side comparison |

---

## Summary

### Key Innovations

1. **AI-Powered Background Generation**: Uses LaMa ONNX model to generate plausible background content where foreground objects occlude the view, instead of just blurring or stretching.

2. **Gradient-Based Layer Switching**: Real-time steepness detection in the shader determines when to sample from the inpainted background layer vs. the original foreground.

3. **True Two-Layer Texture System**: Four textures (2 images + 2 depths) enable proper parallax for both layers independently.

4. **Client-Side Processing**: Entire pipeline runs in the browser with WebGPU acceleration.

### Processing Pipeline Summary

```
Image → Depth Anything V2 → Depth Map
                              ↓
                        Mask Extraction
                              ↓
              ┌───────────────┴───────────────┐
              ↓                               ↓
        Push-Pull Depth              Masked Image + Mask
         Inpainting                         ↓
              ↓                        LaMa Inpaint
       Background Depth                     ↓
              ↓                    Background Image
              └───────────────┬───────────────┘
                              ↓
                     WebGL Two-Layer Renderer
                              ↓
                   Real-time Parallax Effect
```

### Expected Results

- **No edge stretching**: Background content is actual inpainted imagery, not stretched foreground
- **Smooth transitions**: Gradient-based blending prevents hard edges
- **Realistic parallax**: Background moves independently from foreground
- **Client-side**: No server required, works offline after model download

---

## Next Steps

1. [ ] Implement `depth-estimator.js` wrapper
2. [ ] Port LaMa integration from `next-lama` reference
3. [ ] Implement `layer-processor.js` with push-pull algorithm
4. [ ] Update `fragment.glsl` with two-layer ray march
5. [ ] Update `renderer.js` for four-texture system
6. [ ] Create Web Workers for background processing
7. [ ] Update UI with new controls
8. [ ] Test with various images and depth scenarios
9. [ ] Optimize for mobile/low-end devices
