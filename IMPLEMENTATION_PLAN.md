# DepthFlow WebGL Implementation Plan

## Executive Summary

This document provides a comprehensive implementation plan for creating a WebGL-based parallax depth effect renderer, faithfully porting the core functionality of the [DepthFlow](https://github.com/BrokenSource/DepthFlow) project to the web.

**Goal**: Create an MVP web page where users can:
1. Upload an image and its corresponding depth map
2. Click and drag to move the camera around
3. Adjust parallax parameters in real-time
4. Experience the 3D parallax effect in the browser

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Core Algorithm Deep Dive](#2-core-algorithm-deep-dive)
3. [Coordinate Systems](#3-coordinate-systems)
4. [Shader Implementation](#4-shader-implementation)
5. [JavaScript Application Structure](#5-javascript-application-structure)
6. [User Interface Design](#6-user-interface-design)
7. [File Structure](#7-file-structure)
8. [Implementation Phases](#8-implementation-phases)
9. [Testing Strategy](#9-testing-strategy)
10. [Performance Considerations](#10-performance-considerations)
11. [Reference: Original DepthFlow Parameters](#11-reference-original-depthflow-parameters)

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Application                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   UI Layer   │  │ State Manager│  │   WebGL Renderer     │  │
│  │  (Controls)  │──│  (Uniforms)  │──│  (Shader Pipeline)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                 │                    │                │
│         ▼                 ▼                    ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ File Upload  │  │  Animation   │  │   Fragment Shader    │  │
│  │  Handler     │  │    Loop      │  │  (Parallax Effect)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Rendering | Raw WebGL 2.0 | Maximum control, no dependencies |
| UI | Vanilla JS + CSS | Keep MVP simple, no build step |
| Shader | GLSL ES 3.00 | WebGL 2.0 compatibility |
| Alternative | Three.js | Optional: easier integration, larger bundle |

### 1.3 Core Files

```
Depthflow-WebGL/
├── index.html              # Main HTML page
├── src/
│   ├── js/
│   │   ├── main.js         # Entry point, initialization
│   │   ├── renderer.js     # WebGL setup and render loop
│   │   ├── state.js        # Uniform state management
│   │   ├── input.js        # Mouse/touch input handling
│   │   └── ui.js           # Control panel bindings
│   ├── shaders/
│   │   ├── vertex.glsl     # Vertex shader (fullscreen quad)
│   │   ├── fragment.glsl   # Fragment shader (parallax effect)
│   │   └── utils.glsl      # Shared utility functions
│   └── css/
│       └── style.css       # UI styling
├── assets/
│   ├── sample-image.jpg    # Default sample image
│   └── sample-depth.jpg    # Default sample depth map
└── docs/
    └── IMPLEMENTATION_PLAN.md  # This document
```

---

## 2. Core Algorithm Deep Dive

### 2.1 The Parallax Effect Concept

The DepthFlow effect treats an image + depth map as a **2.5D scene**:
- The color image provides the visual content
- The depth map defines a height field (white = near, black = far, or vice versa)
- A virtual camera casts rays through each screen pixel
- Rays intersect with the height field surface
- The color is sampled at the intersection point

This creates the illusion of 3D depth from a 2D image.

### 2.2 Ray Marching Algorithm

The core algorithm uses **two-pass ray marching**:

```
For each pixel:
  1. Calculate ray origin and direction based on camera parameters
  2. PASS 1 (Forward/Coarse): Take large steps until we go INSIDE the surface
  3. PASS 2 (Backward/Fine): Take small steps backward until we're OUTSIDE
  4. Sample the color texture at the final UV coordinate
```

**Why two passes?**
- Forward pass quickly finds approximate intersection (fast but overshoots)
- Backward pass refines to precise intersection (accurate but slow)
- Combined: optimal balance of speed and quality

### 2.3 Pseudo-code (from original DepthFlow)

```glsl
// Quality controls step sizes
float probe = 1.0 / mix(50, 120, quality);   // Coarse step
float fine  = 1.0 / mix(200, 2000, quality); // Fine step

float walk = 0.0;
float safe = 1.0 - height;  // Guaranteed safe starting distance

// Pass 1: Forward march with coarse steps
for (int i = 0; i < 1000; i++) {
    if (walk > 1.0) break;
    walk += probe;

    vec3 point = mix(origin, target, mix(safe, 1.0, walk));
    float depth_value = texture(depthMap, point.xy).r;
    float surface = height * depth_value;
    float ceiling = 1.0 - point.z;

    if (ceiling < surface) break;  // We're inside!
}

// Pass 2: Backward march with fine steps
for (int i = 0; i < 1000; i++) {
    walk -= fine;

    vec3 point = mix(origin, target, mix(safe, 1.0, walk));
    float depth_value = texture(depthMap, point.xy).r;
    float surface = height * depth_value;
    float ceiling = 1.0 - point.z;

    if (ceiling >= surface) break;  // We're outside!
}

// Final UV coordinate
vec2 finalUV = point.xy;
vec4 color = texture(colorImage, finalUV);
```

### 2.4 Camera Ray Construction

The camera system creates rays that blend between **perspective** and **orthographic** projection:

```glsl
// Ray origin: camera position + screen offset (scaled by isometric)
vec3 origin = cameraPosition
    + screenOffset * zoom * isometric  // Ortho component
    + backward * dolly;                 // Distance offset

// Ray target: camera position + screen offset + focal depth
vec3 target = cameraPosition
    + screenOffset * zoom              // Screen position
    + forward * focalLength;           // Depth target

// The ray direction
vec3 ray = target - origin;
```

**Key insight**: `isometric` interpolates between:
- `isometric = 0`: All rays converge (perspective) - feels like looking through a window
- `isometric = 1`: All rays parallel (orthographic) - feels like a diorama

---

## 3. Coordinate Systems

### 3.1 Coordinate Spaces

The original DepthFlow uses several coordinate systems. We must faithfully replicate them:

| Name | Range | Description | WebGL Equivalent |
|------|-------|-------------|------------------|
| `stuv` | (0,0) to (1,1) | Standard texture UV | `gl_FragCoord.xy / resolution` |
| `gluv` | (-ar,-1) to (ar,1) | GL coords with aspect | `(stuv * 2.0 - 1.0) * vec2(aspect, 1.0)` |
| `agluv` | (-1,-1) to (1,1) | Aspect-corrected GL | `(stuv * 2.0 - 1.0)` |

Where `ar` = aspect ratio = width/height

### 3.2 Conversion Functions

```glsl
// Standard UV to GL UV (with aspect ratio)
vec2 stuv2gluv(vec2 stuv, float aspect) {
    return (stuv * 2.0 - 1.0) * vec2(aspect, 1.0);
}

// GL UV to Standard UV
vec2 gluv2stuv(vec2 gluv, float aspect) {
    return (gluv / vec2(aspect, 1.0) + 1.0) / 2.0;
}

// Apply aspect correction
vec2 gluv2agluv(vec2 gluv, float aspect) {
    return gluv / vec2(aspect, 1.0);
}
```

### 3.3 Texture Sampling with Aspect Ratio

The original uses a custom `gtexture` function that handles aspect ratio:

```glsl
vec4 gtexture(sampler2D tex, vec2 gluv, float imageAspect) {
    // Scale gluv to match image aspect ratio
    vec2 scale = vec2(1.0 / imageAspect, 1.0);
    vec2 stuv = (gluv * scale + 1.0) / 2.0;
    return texture(tex, stuv);
}
```

### 3.4 Mirrored Repeat

For out-of-bounds coordinates, DepthFlow uses a triangle wave for mirrored repeat:

```glsl
float triangleWave(float x, float period) {
    return 2.0 * abs(mod(2.0 * x / period - 0.5, 2.0) - 1.0) - 1.0;
}

vec2 mirroredRepeat(vec2 gluv, float aspect) {
    return vec2(
        aspect * triangleWave(gluv.x, 4.0 * aspect),
        triangleWave(gluv.y, 4.0)
    );
}
```

---

## 4. Shader Implementation

### 4.1 Vertex Shader (`vertex.glsl`)

Simple fullscreen quad shader:

```glsl
#version 300 es
precision highp float;

// Fullscreen triangle/quad vertices
in vec2 aPosition;

out vec2 vUV;
out vec2 vGluv;

uniform vec2 uResolution;

void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);

    // Standard UV (0-1)
    vUV = aPosition * 0.5 + 0.5;

    // GL UV with aspect ratio
    float aspect = uResolution.x / uResolution.y;
    vGluv = aPosition * vec2(aspect, 1.0);
}
```

### 4.2 Fragment Shader (`fragment.glsl`)

Complete parallax implementation:

```glsl
#version 300 es
precision highp float;

// Inputs
in vec2 vUV;
in vec2 vGluv;

// Outputs
out vec4 fragColor;

// Textures
uniform sampler2D uImage;
uniform sampler2D uDepth;

// Resolution
uniform vec2 uResolution;
uniform float uImageAspect;  // Source image aspect ratio

// Parallax Parameters
uniform float uHeight;      // 0.0 - 0.5, default 0.2
uniform float uSteady;      // 0.0 - 1.0, default 0.3
uniform float uFocus;       // 0.0 - 1.0, default 0.0
uniform float uZoom;        // 0.5 - 2.0, default 1.0
uniform float uIsometric;   // 0.0 - 1.0, default 0.5
uniform float uDolly;       // 0.0 - 5.0, default 0.0
uniform float uInvert;      // 0.0 - 1.0, default 0.0
uniform bool uMirror;       // default true
uniform float uQuality;     // 0.0 - 1.0, default 0.5

// Camera offset (animated by mouse)
uniform vec2 uOffset;       // -2.0 to 2.0
uniform vec2 uCenter;       // True camera center
uniform vec2 uOrigin;       // Ray origin shift

// Constants
const float PI = 3.14159265359;
const float TAU = 6.28318530718;

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

vec4 sampleTexture(sampler2D tex, vec2 gluv, bool mirror, float aspect) {
    // Handle mirrored repeat
    if (mirror) {
        gluv = mirroredRepeat(gluv, aspect);
    }

    // Convert gluv to stuv with aspect ratio correction
    vec2 scale = vec2(1.0 / aspect, 1.0);
    vec2 stuv = (gluv * scale + 1.0) / 2.0;

    return texture(tex, stuv);
}

// ============================================
// Main Parallax Algorithm
// ============================================

struct DepthResult {
    vec2 gluv;          // Final UV coordinate
    float depthValue;   // Depth at intersection
    bool outOfBounds;   // Ray missed the scene
};

DepthResult computeParallax(vec2 screenGluv) {
    DepthResult result;
    result.outOfBounds = false;

    float aspect = uResolution.x / uResolution.y;

    // Convert absolute to relative values
    float relFocus = uFocus * uHeight;
    float relSteady = uSteady * uHeight;

    // Camera position with offset
    vec2 cameraXY = uOffset + uCenter;

    // Camera vectors (simplified 2D mode - camera always faces forward)
    vec3 forward = vec3(0.0, 0.0, 1.0);
    vec3 backward = vec3(0.0, 0.0, -1.0);
    vec3 right = vec3(1.0, 0.0, 0.0);
    vec3 up = vec3(0.0, 1.0, 0.0);

    // Build camera position
    vec3 camPos = vec3(cameraXY, 0.0);

    // Focal length adjusted by focus
    float focalLength = 1.0 - relFocus;

    // Screen rectangle offset
    vec2 screenOffset = screenGluv;

    // Ray origin: blends between perspective (0) and orthographic (1)
    vec3 rayOrigin = camPos
        + vec3(screenOffset * uZoom * uIsometric, 0.0)
        + backward * uDolly
        + vec3(uOrigin, 0.0);

    // Ray target
    vec3 rayTarget = camPos
        + vec3(screenOffset * uZoom, 0.0)
        + forward * focalLength;

    // Intersection point calculation for "glued" focal plane
    vec3 intersect = vec3(uCenter + screenGluv, 1.0)
        - vec3(cameraXY, 0.0) * (1.0 / (1.0 - relSteady));

    // Quality-dependent step sizes
    float probeStep = 1.0 / mix(50.0, 120.0, uQuality);   // Coarse
    float fineStep = 1.0 / mix(200.0, 2000.0, uQuality);  // Fine

    // Safe distance (guaranteed not to hit surface)
    float safe = 1.0 - uHeight;

    float walk = 0.0;
    float lastDepth = 0.0;
    vec2 hitGluv = screenGluv;
    float hitDepth = 0.0;

    // Pass 1: Forward march (coarse)
    for (int i = 0; i < 200; i++) {
        if (walk > 1.0) break;
        walk += probeStep;

        vec3 point = mix(rayOrigin, intersect, mix(safe, 1.0, walk));
        hitGluv = point.xy;

        // Sample depth
        lastDepth = hitDepth;
        hitDepth = sampleTexture(uDepth, hitGluv, uMirror, uImageAspect).r;

        // Apply invert
        float surface = uHeight * mix(hitDepth, 1.0 - hitDepth, uInvert);
        float ceiling = 1.0 - point.z;

        // Check if we're inside the surface
        if (ceiling < surface) {
            break;  // Overshoot, now refine
        }
    }

    // Pass 2: Backward march (fine)
    for (int i = 0; i < 100; i++) {
        walk -= fineStep;

        vec3 point = mix(rayOrigin, intersect, mix(safe, 1.0, walk));
        hitGluv = point.xy;

        hitDepth = sampleTexture(uDepth, hitGluv, uMirror, uImageAspect).r;
        float surface = uHeight * mix(hitDepth, 1.0 - hitDepth, uInvert);
        float ceiling = 1.0 - point.z;

        if (ceiling >= surface) {
            break;  // Found precise intersection
        }
    }

    result.gluv = hitGluv;
    result.depthValue = hitDepth;

    // Check out of bounds
    vec2 agluv = hitGluv / vec2(uImageAspect, 1.0);
    if (!uMirror && (abs(agluv.x) > 1.0 || abs(agluv.y) > 1.0)) {
        result.outOfBounds = true;
    }

    return result;
}

// ============================================
// Main
// ============================================

void main() {
    DepthResult depth = computeParallax(vGluv);

    if (depth.outOfBounds) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Sample the color texture at the parallax-adjusted UV
    fragColor = sampleTexture(uImage, depth.gluv, uMirror, uImageAspect);
}
```

### 4.3 WebGL 1.0 Compatibility Version

If WebGL 1.0 support is needed, key changes:
- `#version 100` instead of `#version 300 es`
- `attribute` instead of `in` (vertex)
- `varying` instead of `in`/`out`
- `gl_FragColor` instead of custom output
- `texture2D` instead of `texture`

---

## 5. JavaScript Application Structure

### 5.1 Main Entry Point (`main.js`)

```javascript
// main.js - Application entry point

import { Renderer } from './renderer.js';
import { State } from './state.js';
import { InputHandler } from './input.js';
import { UI } from './ui.js';

class DepthFlowApp {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.state = new State();
        this.renderer = new Renderer(this.canvas, this.state);
        this.input = new InputHandler(this.canvas, this.state);
        this.ui = new UI(this.state, this.renderer);
    }

    async init() {
        await this.renderer.init();
        this.ui.init();
        this.input.init();

        // Load default images if available
        await this.loadDefaultImages();

        // Start render loop
        this.render();
    }

    async loadDefaultImages() {
        try {
            const [imageResponse, depthResponse] = await Promise.all([
                fetch('assets/sample-image.jpg'),
                fetch('assets/sample-depth.jpg')
            ]);

            if (imageResponse.ok && depthResponse.ok) {
                const imageBlob = await imageResponse.blob();
                const depthBlob = await depthResponse.blob();

                await this.renderer.loadImage(imageBlob);
                await this.renderer.loadDepth(depthBlob);
            }
        } catch (e) {
            console.log('No default images found, waiting for upload');
        }
    }

    render() {
        this.state.update();  // Update animations/smoothing
        this.renderer.render();
        requestAnimationFrame(() => this.render());
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new DepthFlowApp();
    app.init();
});
```

### 5.2 WebGL Renderer (`renderer.js`)

```javascript
// renderer.js - WebGL setup and rendering

export class Renderer {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.gl = null;
        this.program = null;
        this.uniforms = {};
        this.textures = {
            image: null,
            depth: null
        };
        this.imageAspect = 1.0;
    }

    async init() {
        // Get WebGL 2 context
        this.gl = this.canvas.getContext('webgl2', {
            antialias: false,
            alpha: false,
            preserveDrawingBuffer: false
        });

        if (!this.gl) {
            throw new Error('WebGL 2.0 not supported');
        }

        // Load and compile shaders
        const [vertSrc, fragSrc] = await Promise.all([
            fetch('src/shaders/vertex.glsl').then(r => r.text()),
            fetch('src/shaders/fragment.glsl').then(r => r.text())
        ]);

        this.program = this.createProgram(vertSrc, fragSrc);
        this.gl.useProgram(this.program);

        // Get uniform locations
        this.cacheUniformLocations();

        // Create fullscreen quad
        this.createQuad();

        // Create placeholder textures
        this.createPlaceholderTextures();

        // Handle resize
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    createProgram(vertSrc, fragSrc) {
        const gl = this.gl;

        const vertShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertShader, vertSrc);
        gl.compileShader(vertShader);

        if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
            throw new Error('Vertex shader error: ' + gl.getShaderInfoLog(vertShader));
        }

        const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragShader, fragSrc);
        gl.compileShader(fragShader);

        if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
            throw new Error('Fragment shader error: ' + gl.getShaderInfoLog(fragShader));
        }

        const program = gl.createProgram();
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
        }

        return program;
    }

    cacheUniformLocations() {
        const gl = this.gl;
        const uniformNames = [
            'uImage', 'uDepth', 'uResolution', 'uImageAspect',
            'uHeight', 'uSteady', 'uFocus', 'uZoom', 'uIsometric',
            'uDolly', 'uInvert', 'uMirror', 'uQuality',
            'uOffset', 'uCenter', 'uOrigin'
        ];

        for (const name of uniformNames) {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
    }

    createQuad() {
        const gl = this.gl;

        // Fullscreen triangle (more efficient than quad)
        const vertices = new Float32Array([
            -1, -1,
             3, -1,
            -1,  3
        ]);

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(this.program, 'aPosition');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    createPlaceholderTextures() {
        const gl = this.gl;

        // Create 1x1 white texture as placeholder
        const placeholder = new Uint8Array([255, 255, 255, 255]);

        for (const key of ['image', 'depth']) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, placeholder);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            this.textures[key] = tex;
        }
    }

    async loadImage(blob) {
        const img = await createImageBitmap(blob);
        this.imageAspect = img.width / img.height;
        this.uploadTexture('image', img);
        return { width: img.width, height: img.height };
    }

    async loadDepth(blob) {
        const img = await createImageBitmap(blob);
        this.uploadTexture('depth', img);
    }

    uploadTexture(name, image) {
        const gl = this.gl;

        if (this.textures[name]) {
            gl.deleteTexture(this.textures[name]);
        }

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        // Clamp to edge (we handle repeat in shader)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.textures[name] = tex;
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const width = this.canvas.clientWidth * dpr;
        const height = this.canvas.clientHeight * dpr;

        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }

    render() {
        const gl = this.gl;
        const s = this.state;

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.image);
        gl.uniform1i(this.uniforms.uImage, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.depth);
        gl.uniform1i(this.uniforms.uDepth, 1);

        // Set uniforms
        gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.uImageAspect, this.imageAspect);

        gl.uniform1f(this.uniforms.uHeight, s.height);
        gl.uniform1f(this.uniforms.uSteady, s.steady);
        gl.uniform1f(this.uniforms.uFocus, s.focus);
        gl.uniform1f(this.uniforms.uZoom, s.zoom);
        gl.uniform1f(this.uniforms.uIsometric, s.isometric);
        gl.uniform1f(this.uniforms.uDolly, s.dolly);
        gl.uniform1f(this.uniforms.uInvert, s.invert);
        gl.uniform1i(this.uniforms.uMirror, s.mirror ? 1 : 0);
        gl.uniform1f(this.uniforms.uQuality, s.quality);

        gl.uniform2f(this.uniforms.uOffset, s.offsetX, s.offsetY);
        gl.uniform2f(this.uniforms.uCenter, s.centerX, s.centerY);
        gl.uniform2f(this.uniforms.uOrigin, s.originX, s.originY);

        // Draw
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
}
```

### 5.3 State Management (`state.js`)

```javascript
// state.js - Uniform state with smoothing

export class State {
    constructor() {
        // Parallax parameters (current values)
        this.height = 0.2;
        this.steady = 0.3;
        this.focus = 0.0;
        this.zoom = 1.0;
        this.isometric = 0.5;
        this.dolly = 0.0;
        this.invert = 0.0;
        this.mirror = true;
        this.quality = 0.5;

        // Camera offset (animated)
        this.offsetX = 0.0;
        this.offsetY = 0.0;
        this.centerX = 0.0;
        this.centerY = 0.0;
        this.originX = 0.0;
        this.originY = 0.0;

        // Target values for smoothing
        this._targetOffsetX = 0.0;
        this._targetOffsetY = 0.0;

        // Smoothing factor (0 = instant, 1 = never)
        this.smoothing = 0.85;

        // Last update time
        this._lastTime = performance.now();
    }

    // Set target offset (from input)
    setTargetOffset(x, y) {
        this._targetOffsetX = x;
        this._targetOffsetY = y;
    }

    // Update with smoothing
    update() {
        const now = performance.now();
        const dt = (now - this._lastTime) / 1000;
        this._lastTime = now;

        // Exponential smoothing
        const t = 1 - Math.pow(this.smoothing, dt * 60);

        this.offsetX += (this._targetOffsetX - this.offsetX) * t;
        this.offsetY += (this._targetOffsetY - this.offsetY) * t;
    }

    // Reset to defaults
    reset() {
        this.height = 0.2;
        this.steady = 0.3;
        this.focus = 0.0;
        this.zoom = 1.0;
        this.isometric = 0.5;
        this.dolly = 0.0;
        this.invert = 0.0;
        this.mirror = true;
        this.quality = 0.5;
        this.offsetX = 0.0;
        this.offsetY = 0.0;
        this._targetOffsetX = 0.0;
        this._targetOffsetY = 0.0;
        this.centerX = 0.0;
        this.centerY = 0.0;
    }

    // Export state as JSON
    toJSON() {
        return {
            height: this.height,
            steady: this.steady,
            focus: this.focus,
            zoom: this.zoom,
            isometric: this.isometric,
            dolly: this.dolly,
            invert: this.invert,
            mirror: this.mirror,
            quality: this.quality
        };
    }

    // Import state from JSON
    fromJSON(json) {
        Object.assign(this, json);
    }
}
```

### 5.4 Input Handler (`input.js`)

```javascript
// input.js - Mouse and touch input handling

export class InputHandler {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;

        this.isDragging = false;
        this.lastX = 0;
        this.lastY = 0;

        // Sensitivity
        this.sensitivity = 0.003;
    }

    init() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this.onMouseUp());
        this.canvas.addEventListener('mouseleave', () => this.onMouseUp());

        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));
        this.canvas.addEventListener('touchend', () => this.onTouchEnd());

        // Prevent context menu
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    onMouseDown(e) {
        if (e.button === 0) {  // Left click
            this.isDragging = true;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
            this.canvas.style.cursor = 'grabbing';
        }
    }

    onMouseMove(e) {
        if (!this.isDragging) return;

        const dx = (e.clientX - this.lastX) * this.sensitivity;
        const dy = (e.clientY - this.lastY) * this.sensitivity;

        this.lastX = e.clientX;
        this.lastY = e.clientY;

        // Update target offset (inverted for natural feel)
        this.state.setTargetOffset(
            this.state._targetOffsetX - dx,
            this.state._targetOffsetY + dy  // Y is inverted in GL
        );
    }

    onMouseUp() {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
    }

    onTouchStart(e) {
        if (e.touches.length === 1) {
            this.isDragging = true;
            this.lastX = e.touches[0].clientX;
            this.lastY = e.touches[0].clientY;
        }
    }

    onTouchMove(e) {
        if (!this.isDragging || e.touches.length !== 1) return;
        e.preventDefault();

        const touch = e.touches[0];
        const dx = (touch.clientX - this.lastX) * this.sensitivity;
        const dy = (touch.clientY - this.lastY) * this.sensitivity;

        this.lastX = touch.clientX;
        this.lastY = touch.clientY;

        this.state.setTargetOffset(
            this.state._targetOffsetX - dx,
            this.state._targetOffsetY + dy
        );
    }

    onTouchEnd() {
        this.isDragging = false;
    }
}
```

### 5.5 UI Controller (`ui.js`)

```javascript
// ui.js - Control panel bindings

export class UI {
    constructor(state, renderer) {
        this.state = state;
        this.renderer = renderer;
    }

    init() {
        // File uploads
        this.bindFileUpload('image-upload', (file) => this.renderer.loadImage(file));
        this.bindFileUpload('depth-upload', (file) => this.renderer.loadDepth(file));

        // Sliders
        this.bindSlider('height', 0, 0.5, 0.01);
        this.bindSlider('steady', 0, 1, 0.01);
        this.bindSlider('focus', 0, 1, 0.01);
        this.bindSlider('zoom', 0.5, 2, 0.01);
        this.bindSlider('isometric', 0, 1, 0.01);
        this.bindSlider('dolly', 0, 5, 0.1);
        this.bindSlider('invert', 0, 1, 0.01);
        this.bindSlider('quality', 0.1, 1, 0.01);
        this.bindSlider('smoothing', 0, 0.99, 0.01);

        // Checkboxes
        this.bindCheckbox('mirror');

        // Reset button
        document.getElementById('reset-btn').addEventListener('click', () => {
            this.state.reset();
            this.updateAllSliders();
        });
    }

    bindFileUpload(id, callback) {
        const input = document.getElementById(id);
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await callback(file);
            }
        });
    }

    bindSlider(name, min, max, step) {
        const slider = document.getElementById(`${name}-slider`);
        const value = document.getElementById(`${name}-value`);

        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = this.state[name];
        value.textContent = this.state[name].toFixed(2);

        slider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.state[name] = v;
            value.textContent = v.toFixed(2);
        });
    }

    bindCheckbox(name) {
        const checkbox = document.getElementById(`${name}-checkbox`);
        checkbox.checked = this.state[name];

        checkbox.addEventListener('change', (e) => {
            this.state[name] = e.target.checked;
        });
    }

    updateAllSliders() {
        const names = ['height', 'steady', 'focus', 'zoom', 'isometric',
                       'dolly', 'invert', 'quality', 'smoothing'];

        for (const name of names) {
            const slider = document.getElementById(`${name}-slider`);
            const value = document.getElementById(`${name}-value`);
            slider.value = this.state[name];
            value.textContent = this.state[name].toFixed(2);
        }

        document.getElementById('mirror-checkbox').checked = this.state.mirror;
    }
}
```

---

## 6. User Interface Design

### 6.1 HTML Structure (`index.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DepthFlow WebGL</title>
    <link rel="stylesheet" href="src/css/style.css">
</head>
<body>
    <div class="container">
        <!-- Main canvas -->
        <canvas id="canvas"></canvas>

        <!-- Control panel -->
        <div class="controls" id="controls">
            <h2>DepthFlow WebGL</h2>

            <!-- File uploads -->
            <div class="section">
                <h3>Images</h3>
                <div class="upload-group">
                    <label for="image-upload">Color Image</label>
                    <input type="file" id="image-upload" accept="image/*">
                </div>
                <div class="upload-group">
                    <label for="depth-upload">Depth Map</label>
                    <input type="file" id="depth-upload" accept="image/*">
                </div>
            </div>

            <!-- Parallax controls -->
            <div class="section">
                <h3>Parallax</h3>

                <div class="slider-group">
                    <label>Height <span id="height-value">0.20</span></label>
                    <input type="range" id="height-slider">
                </div>

                <div class="slider-group">
                    <label>Steady <span id="steady-value">0.30</span></label>
                    <input type="range" id="steady-slider">
                </div>

                <div class="slider-group">
                    <label>Focus <span id="focus-value">0.00</span></label>
                    <input type="range" id="focus-slider">
                </div>

                <div class="slider-group">
                    <label>Zoom <span id="zoom-value">1.00</span></label>
                    <input type="range" id="zoom-slider">
                </div>

                <div class="slider-group">
                    <label>Isometric <span id="isometric-value">0.50</span></label>
                    <input type="range" id="isometric-slider">
                </div>

                <div class="slider-group">
                    <label>Dolly <span id="dolly-value">0.00</span></label>
                    <input type="range" id="dolly-slider">
                </div>

                <div class="slider-group">
                    <label>Invert <span id="invert-value">0.00</span></label>
                    <input type="range" id="invert-slider">
                </div>
            </div>

            <!-- Quality controls -->
            <div class="section">
                <h3>Quality & Behavior</h3>

                <div class="slider-group">
                    <label>Quality <span id="quality-value">0.50</span></label>
                    <input type="range" id="quality-slider">
                </div>

                <div class="slider-group">
                    <label>Smoothing <span id="smoothing-value">0.85</span></label>
                    <input type="range" id="smoothing-slider">
                </div>

                <div class="checkbox-group">
                    <input type="checkbox" id="mirror-checkbox">
                    <label for="mirror-checkbox">Mirror edges</label>
                </div>
            </div>

            <!-- Actions -->
            <div class="section">
                <button id="reset-btn">Reset Defaults</button>
            </div>

            <!-- Instructions -->
            <div class="section instructions">
                <p><strong>Click and drag</strong> to move the camera</p>
            </div>
        </div>

        <!-- Toggle controls button -->
        <button class="toggle-controls" id="toggle-controls">
            <span>&#9776;</span>
        </button>
    </div>

    <script type="module" src="src/js/main.js"></script>
</body>
</html>
```

### 6.2 CSS Styling (`style.css`)

```css
/* style.css - DepthFlow WebGL styling */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e;
    color: #eee;
    overflow: hidden;
}

.container {
    display: flex;
    width: 100vw;
    height: 100vh;
}

#canvas {
    flex: 1;
    cursor: grab;
}

#canvas:active {
    cursor: grabbing;
}

/* Control Panel */
.controls {
    width: 280px;
    background: rgba(26, 26, 46, 0.95);
    border-left: 1px solid #333;
    padding: 20px;
    overflow-y: auto;
    transition: transform 0.3s ease;
}

.controls.hidden {
    transform: translateX(100%);
}

.controls h2 {
    font-size: 1.4em;
    margin-bottom: 20px;
    color: #7f8fff;
    border-bottom: 1px solid #333;
    padding-bottom: 10px;
}

.controls h3 {
    font-size: 0.9em;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin: 15px 0 10px;
}

.section {
    margin-bottom: 20px;
}

/* File uploads */
.upload-group {
    margin-bottom: 10px;
}

.upload-group label {
    display: block;
    font-size: 0.85em;
    margin-bottom: 5px;
    color: #aaa;
}

.upload-group input[type="file"] {
    width: 100%;
    padding: 8px;
    background: #2a2a4e;
    border: 1px solid #444;
    border-radius: 4px;
    color: #eee;
    font-size: 0.85em;
}

/* Sliders */
.slider-group {
    margin-bottom: 12px;
}

.slider-group label {
    display: flex;
    justify-content: space-between;
    font-size: 0.85em;
    margin-bottom: 4px;
    color: #ccc;
}

.slider-group label span {
    color: #7f8fff;
    font-family: monospace;
}

.slider-group input[type="range"] {
    width: 100%;
    height: 4px;
    background: #333;
    border-radius: 2px;
    outline: none;
    -webkit-appearance: none;
}

.slider-group input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    background: #7f8fff;
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.2s;
}

.slider-group input[type="range"]::-webkit-slider-thumb:hover {
    background: #9faeff;
}

/* Checkboxes */
.checkbox-group {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0;
}

.checkbox-group input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: #7f8fff;
}

/* Buttons */
button {
    background: #7f8fff;
    color: #1a1a2e;
    border: none;
    padding: 10px 20px;
    border-radius: 4px;
    font-size: 0.9em;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    width: 100%;
}

button:hover {
    background: #9faeff;
}

/* Instructions */
.instructions {
    font-size: 0.85em;
    color: #888;
    text-align: center;
    padding: 10px;
    background: #2a2a4e;
    border-radius: 4px;
}

/* Toggle button */
.toggle-controls {
    position: fixed;
    top: 10px;
    right: 10px;
    width: 40px;
    height: 40px;
    padding: 0;
    background: rgba(127, 143, 255, 0.9);
    border-radius: 4px;
    z-index: 100;
}

.toggle-controls span {
    font-size: 1.2em;
}

/* Mobile responsive */
@media (max-width: 768px) {
    .controls {
        position: fixed;
        right: 0;
        top: 0;
        height: 100vh;
        z-index: 50;
    }

    .controls.hidden {
        transform: translateX(100%);
    }
}
```

---

## 7. File Structure

```
Depthflow-WebGL/
├── index.html                    # Main HTML page
├── IMPLEMENTATION_PLAN.md        # This document
├── README.md                     # Quick start guide
├── src/
│   ├── js/
│   │   ├── main.js              # Entry point (~50 lines)
│   │   ├── renderer.js          # WebGL setup (~200 lines)
│   │   ├── state.js             # State management (~100 lines)
│   │   ├── input.js             # Input handling (~100 lines)
│   │   └── ui.js                # UI bindings (~100 lines)
│   ├── shaders/
│   │   ├── vertex.glsl          # Vertex shader (~20 lines)
│   │   └── fragment.glsl        # Fragment shader (~200 lines)
│   └── css/
│       └── style.css            # Styling (~200 lines)
├── assets/
│   ├── sample-image.jpg         # Default test image
│   └── sample-depth.jpg         # Default depth map
└── docs/
    └── IMPLEMENTATION_PLAN.md   # Detailed technical docs
```

**Total estimated lines of code: ~1000 lines**

---

## 8. Implementation Phases

### Phase 1: Core Rendering (Day 1)
- [ ] Set up project structure
- [ ] Implement WebGL context initialization
- [ ] Create vertex shader (fullscreen quad)
- [ ] Create basic fragment shader (display image)
- [ ] Implement texture loading

**Deliverable**: Can display an uploaded image on screen

### Phase 2: Parallax Algorithm (Day 1-2)
- [ ] Port ray marching algorithm from DepthFlow
- [ ] Implement coordinate system conversions
- [ ] Add depth texture support
- [ ] Implement basic parallax with static offset
- [ ] Add mirrored repeat handling

**Deliverable**: Static parallax effect working

### Phase 3: Interactivity (Day 2)
- [ ] Implement mouse drag input
- [ ] Add touch support
- [ ] Implement smooth interpolation
- [ ] Connect offset to mouse movement

**Deliverable**: Can drag to look around

### Phase 4: UI & Controls (Day 2-3)
- [ ] Create control panel HTML
- [ ] Style with CSS
- [ ] Bind sliders to state
- [ ] Implement file upload handlers
- [ ] Add reset functionality

**Deliverable**: Full MVP with adjustable parameters

### Phase 5: Polish (Day 3)
- [ ] Add sample images
- [ ] Mobile responsiveness
- [ ] Performance optimization
- [ ] Error handling
- [ ] Documentation

**Deliverable**: Production-ready MVP

---

## 9. Testing Strategy

### 9.1 Manual Test Cases

| Test | Expected Result |
|------|-----------------|
| Load image only | Displays image without parallax |
| Load image + depth | Parallax effect visible |
| Drag left | Scene shifts right |
| Drag up | Scene shifts down |
| Height = 0 | No parallax effect |
| Height = 0.5 | Strong parallax effect |
| Isometric = 0 | Perspective projection |
| Isometric = 1 | Orthographic projection |
| Mirror = false | Black edges when dragged |
| Mirror = true | Mirrored edges |
| Quality = 0.1 | Fast but blocky |
| Quality = 1.0 | Smooth but slower |

### 9.2 Browser Compatibility

| Browser | Minimum Version | Notes |
|---------|-----------------|-------|
| Chrome | 56+ | Full support |
| Firefox | 51+ | Full support |
| Safari | 15+ | WebGL 2.0 support |
| Edge | 79+ | Full support |
| Mobile Chrome | 58+ | Touch support |
| Mobile Safari | 15+ | Touch support |

### 9.3 Test Images

Recommended test cases:
1. **Portrait photo** - Test aspect ratio handling
2. **Landscape scene** - Test typical use case
3. **High contrast depth** - Test extreme values
4. **Gradual depth** - Test smooth transitions
5. **Wrong depth** (e.g., inverted) - Test invert parameter

---

## 10. Performance Considerations

### 10.1 Optimization Strategies

1. **Quality Slider**: Primary performance control
   - Low (0.1): 50 forward + 20 backward iterations
   - High (1.0): 120 forward + 100 backward iterations

2. **Resolution Scaling**:
   ```javascript
   // Render at lower resolution on mobile
   const dpr = window.devicePixelRatio;
   const scale = isMobile ? 0.5 : 1.0;
   canvas.width = canvas.clientWidth * dpr * scale;
   ```

3. **Texture Size Limits**:
   ```javascript
   const MAX_SIZE = 2048;
   if (img.width > MAX_SIZE || img.height > MAX_SIZE) {
       // Downscale before uploading
   }
   ```

### 10.2 Performance Targets

| Device | Target FPS | Quality Setting |
|--------|------------|-----------------|
| Desktop | 60 | 0.5 - 1.0 |
| Mobile | 30 | 0.2 - 0.5 |
| Low-end | 30 | 0.1 - 0.3 |

### 10.3 Memory Management

- Release old textures when uploading new ones
- Use `createImageBitmap` for efficient image loading
- Consider texture compression for large images

---

## 11. Reference: Original DepthFlow Parameters

### 11.1 Default Values (from `state.py`)

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `height` | 0.20 | 0-2 | Parallax intensity |
| `steady` | 0.0 | 0-1 | Focal depth for offsets |
| `focus` | 0.0 | 0-1 | Focal depth for perspective |
| `zoom` | 1.0 | 0-2 | Camera zoom factor |
| `isometric` | 0.0 | 0-1 | Perspective vs orthographic |
| `dolly` | 0.0 | 0-20 | Ray origin push back |
| `invert` | 0.0 | 0-1 | Depth map inversion |
| `mirror` | true | bool | Mirror edges |
| `offset_x` | 0.0 | -4 to 4 | Horizontal parallax |
| `offset_y` | 0.0 | -1 to 1 | Vertical parallax |
| `center_x` | 0.0 | -4 to 4 | True camera X |
| `center_y` | 0.0 | -1 to 1 | True camera Y |
| `origin_x` | 0.0 | -4 to 4 | Ray origin shift X |
| `origin_y` | 0.0 | -1 to 1 | Ray origin shift Y |

### 11.2 Animation Presets (from `animation.py`)

**Orbital (default)**:
```python
steady = 0.3
focus = 0.3
zoom = 0.98
isometric = oscillates 0.5 to 0.75 (cosine)
offset_x = oscillates ±0.25 (sine)
```

**Horizontal**:
```python
steady = 0.3
isometric = 0.6
offset_x = oscillates ±0.8 (sine)
```

**Vertical**:
```python
steady = 0.3
isometric = 0.6
offset_y = oscillates ±0.8 (sine)
```

**Circle**:
```python
steady = 0.3
isometric = 0.6
offset_x = 0.5 * sin(t)
offset_y = 0.5 * cos(t)  # 90° phase shift
```

### 11.3 Quality Mapping (from `depthflow.glsl`)

```glsl
float probe = 1.0 / mix(50, 120, quality);   // Forward step
float fine  = 1.0 / mix(200, 2000, quality); // Backward step
```

At `quality = 0.5`:
- Forward step: 1/85 ≈ 0.0118
- Backward step: 1/1100 ≈ 0.0009

---

## Appendix A: Shader Debugging Tips

1. **Visualize depth**: Output depth value as color
   ```glsl
   fragColor = vec4(vec3(depth.depthValue), 1.0);
   ```

2. **Visualize UV**: Show final UV coordinates
   ```glsl
   fragColor = vec4(depth.gluv * 0.5 + 0.5, 0.0, 1.0);
   ```

3. **Visualize ray direction**: Color-code ray direction
   ```glsl
   fragColor = vec4(normalize(rayTarget - rayOrigin) * 0.5 + 0.5, 1.0);
   ```

---

## Appendix B: Future Enhancements

1. **Post-processing effects**:
   - Vignette
   - Depth of field blur
   - Chromatic aberration

2. **Animation presets**:
   - Auto-animation toggle
   - Preset selector (orbital, horizontal, circle, etc.)

3. **Export features**:
   - Save current view as image
   - Export animation as video/GIF

4. **Advanced features**:
   - Multiple depth layers
   - Normal map support for lighting
   - Stereoscopic VR output

---

## Appendix C: License Notes

The original DepthFlow is licensed under:
- **CC BY-SA 4.0** for the shader code
- **AGPL-3.0** for the full project

This WebGL port should maintain compatible licensing. The shader algorithm (ray marching approach) is the core intellectual property to respect.

---

*Document created: December 2024*
*For use with: DepthFlow WebGL MVP Implementation*
