#version 300 es
precision highp float;

// ============================================
// DepthFlow WebGL - Fragment Shader
// Port of DepthFlow parallax algorithm
// Original: (c) 2023-2025 CC BY-SA 4.0, Tremeschin
// ============================================

// Inputs from vertex shader
in vec2 vUV;
in vec2 vGluv;

// Output
out vec4 fragColor;

// Textures
uniform sampler2D uImage;
uniform sampler2D uDepth;

// Resolution & aspect
uniform vec2 uResolution;
uniform float uImageAspect;  // Source image width/height

// Parallax parameters
uniform float uHeight;      // 0.0 - 0.5, default 0.2 - parallax intensity
uniform float uSteady;      // 0.0 - 1.0, default 0.3 - focal depth for offsets
uniform float uFocus;       // 0.0 - 1.0, default 0.0 - focal depth for perspective
uniform float uZoom;        // 0.5 - 2.0, default 1.0 - camera zoom
uniform float uIsometric;   // 0.0 - 1.0, default 0.5 - perspective vs orthographic
uniform float uDolly;       // 0.0 - 5.0, default 0.0 - ray origin push back
uniform float uInvert;      // 0.0 - 1.0, default 0.0 - depth map inversion blend
uniform bool uMirror;       // default true - mirror edges
uniform float uQuality;     // 0.0 - 1.0, default 0.5 - ray march quality

// Camera position (animated by mouse)
uniform vec2 uOffset;       // -2.0 to 2.0 - parallax displacement
uniform vec2 uCenter;       // True camera center position
uniform vec2 uOrigin;       // Ray origin shift

// ============================================
// Constants
// ============================================

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

// ============================================
// Utility Functions
// ============================================

// Triangle wave for mirrored repeat: oscillates between -1 and 1
float triangleWave(float x, float period) {
    return 2.0 * abs(mod(2.0 * x / period - 0.5, 2.0) - 1.0) - 1.0;
}

// Apply GL_MIRRORED_REPEAT to gluv coordinates
vec2 mirroredRepeat(vec2 gluv, float aspect) {
    return vec2(
        aspect * triangleWave(gluv.x, 4.0 * aspect),
        triangleWave(gluv.y, 4.0)
    );
}

// Sample texture with aspect ratio correction and optional mirroring
vec4 sampleTexture(sampler2D tex, vec2 gluv, bool mirror, float aspect) {
    // Handle mirrored repeat
    if (mirror) {
        gluv = mirroredRepeat(gluv, aspect);
    }

    // Convert gluv to stuv with aspect ratio correction
    // gluv is in range (-aspect, -1) to (aspect, 1)
    // We need to map to (0, 0) to (1, 1) accounting for image aspect
    vec2 scale = vec2(1.0 / aspect, 1.0);
    vec2 stuv = (gluv * scale + 1.0) / 2.0;

    return texture(tex, stuv);
}

// ============================================
// Parallax Ray Marching
// ============================================

struct DepthResult {
    vec2 gluv;          // Final UV coordinate after parallax
    float depthValue;   // Depth value at intersection
    bool outOfBounds;   // Ray missed the scene
};

DepthResult computeParallax(vec2 screenGluv) {
    DepthResult result;
    result.outOfBounds = false;

    float screenAspect = uResolution.x / uResolution.y;

    // Convert absolute to relative values
    float relFocus = uFocus * uHeight;
    float relSteady = uSteady * uHeight;

    // Camera position with offset
    vec2 cameraXY = uOffset + uCenter;

    // Camera vectors (simplified 2D mode - camera always faces Z+)
    vec3 camPos = vec3(cameraXY, 0.0);

    // Focal length adjusted by focus parameter
    float focalLength = 1.0 - relFocus;

    // Screen offset in world space
    vec2 screenOffset = screenGluv;

    // Ray origin: blends between perspective (0) and orthographic (1)
    // - At isometric=0: all rays originate from camera position
    // - At isometric=1: rays originate spread out on the screen plane
    vec3 rayOrigin = camPos
        + vec3(screenOffset * uZoom * uIsometric, 0.0)  // Ortho spread
        + vec3(0.0, 0.0, -uDolly)                        // Dolly back
        + vec3(uOrigin, 0.0);                            // Origin shift

    // Ray target: point on the focal plane
    vec3 rayTarget = camPos
        + vec3(screenOffset * uZoom, 0.0)
        + vec3(0.0, 0.0, focalLength);

    // Intersection point calculation for "glued" focal plane
    // This makes depth=steady appear stationary during camera movement
    vec3 intersect = vec3(uCenter + screenGluv, 1.0);
    if (abs(1.0 - relSteady) > 0.001) {
        intersect -= vec3(cameraXY, 0.0) * (1.0 / (1.0 - relSteady));
    }

    // Quality-dependent step sizes
    // Higher quality = more iterations, smaller steps
    float probeStep = 1.0 / mix(50.0, 120.0, uQuality);   // Coarse forward step
    float fineStep = 1.0 / mix(200.0, 2000.0, uQuality);  // Fine backward step

    // Safe starting distance: guaranteed not to hit surface at z=0
    float safe = 1.0 - uHeight;

    // Ray march state
    float walk = 0.0;
    float lastDepth = 0.0;
    vec2 hitGluv = screenGluv;
    float hitDepth = 0.0;

    // ========================================
    // Pass 1: Forward march with coarse steps
    // Find approximate intersection by overshooting
    // ========================================
    for (int i = 0; i < 200; i++) {
        if (walk > 1.0) break;
        walk += probeStep;

        // Interpolate between origin and intersection plane
        vec3 point = mix(rayOrigin, intersect, mix(safe, 1.0, walk));
        hitGluv = point.xy;

        // Sample depth at current position
        lastDepth = hitDepth;
        hitDepth = sampleTexture(uDepth, hitGluv, uMirror, uImageAspect).r;

        // Apply depth inversion blend
        float surface = uHeight * mix(hitDepth, 1.0 - hitDepth, uInvert);

        // How high above the base plane are we?
        float ceiling = 1.0 - point.z;

        // Check if we're inside the surface (ray went through)
        if (ceiling < surface) {
            break;  // Overshoot detected, proceed to refinement
        }
    }

    // ========================================
    // Pass 2: Backward march with fine steps
    // Refine intersection by stepping backward
    // ========================================
    for (int i = 0; i < 100; i++) {
        walk -= fineStep;

        vec3 point = mix(rayOrigin, intersect, mix(safe, 1.0, walk));
        hitGluv = point.xy;

        hitDepth = sampleTexture(uDepth, hitGluv, uMirror, uImageAspect).r;
        float surface = uHeight * mix(hitDepth, 1.0 - hitDepth, uInvert);
        float ceiling = 1.0 - point.z;

        // Stop when we exit the surface
        if (ceiling >= surface) {
            break;  // Found precise intersection
        }
    }

    result.gluv = hitGluv;
    result.depthValue = hitDepth;

    // Check if final UV is out of bounds (only matters when not mirroring)
    if (!uMirror) {
        vec2 agluv = hitGluv / vec2(uImageAspect, 1.0);
        if (abs(agluv.x) > 1.0 || abs(agluv.y) > 1.0) {
            result.outOfBounds = true;
        }
    }

    return result;
}

// ============================================
// Main
// ============================================

void main() {
    // Compute parallax-adjusted UV coordinates
    DepthResult depth = computeParallax(vGluv);

    // Handle out of bounds
    if (depth.outOfBounds) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Sample the color texture at the parallax-adjusted UV
    fragColor = sampleTexture(uImage, depth.gluv, uMirror, uImageAspect);
}
