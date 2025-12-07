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
uniform sampler2D uImage;
uniform sampler2D uDepth;

// Background layer (inpainted)
uniform sampler2D uImageBG;
uniform sampler2D uDepthBG;

// Foreground mask
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
uniform float uLayerBlend;
uniform float uSteepnessLimit;
uniform float uBlendSoftness;
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
    bool isBackground;
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
        hitDepth = sampleDepthBG(hitUV);

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
// Visualization Modes
// ============================================

vec4 visualize(int mode) {
    if (mode == 1) {
        return sampleTex(uDepth, vGluv);
    } else if (mode == 2) {
        return sampleTex(uDepthBG, vGluv);
    } else if (mode == 3) {
        return sampleTex(uMask, vGluv);
    } else if (mode == 4) {
        float fg = sampleTex(uDepth, vGluv).r;
        float bg = sampleTex(uDepthBG, vGluv).r;
        float diff = abs(fg - bg);
        return vec4(diff * 3.0, diff, 0.0, 1.0);
    } else if (mode == 5) {
        // Steepness heatmap
        RayHit hit = rayMarch(vGluv);
        vec4 color = sampleTex(uImage, hit.uv);
        float normalizedSteep = clamp(hit.steep / (uSteepnessLimit * 2.0), 0.0, 1.0);
        if (hit.steep > uSteepnessLimit) {
            color.rgb = mix(color.rgb, vec3(1.0, 0.2, 0.1), 0.7);
        } else {
            color.rgb = mix(color.rgb, vec3(normalizedSteep, 1.0 - normalizedSteep * 0.5, 0.0), 0.3);
        }
        return color;
    } else if (mode == 6) {
        // Surface normals
        RayHit hit = rayMarch(vGluv);
        return vec4(hit.normal * 0.5 + 0.5, 1.0);
    } else if (mode == 7) {
        // Background image only
        vec2 bgUV = rayMarchBackground(vGluv);
        return sampleTex(uImageBG, bgUV);
    } else if (mode == 8) {
        // Raw parallax (no blending)
        RayHit hit = rayMarch(vGluv);
        return sampleTex(uImage, hit.uv);
    } else if (mode == 9) {
        // Side by side FG/BG
        if (vGluv.x < 0.0) {
            RayHit hit = rayMarch(vGluv + vec2(uImageAspect * 0.5, 0.0));
            return sampleTex(uImage, hit.uv);
        } else {
            vec2 bgUV = rayMarchBackground(vGluv - vec2(uImageAspect * 0.5, 0.0));
            return sampleTex(uImageBG, bgUV);
        }
    }
    return vec4(0.0);
}

// ============================================
// Main
// ============================================

void main() {
    if (uVisualization > 0) {
        fragColor = visualize(uVisualization);
        return;
    }

    // Ray march foreground layer
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
