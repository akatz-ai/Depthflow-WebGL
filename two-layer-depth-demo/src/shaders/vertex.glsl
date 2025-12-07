#version 300 es
precision highp float;

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
