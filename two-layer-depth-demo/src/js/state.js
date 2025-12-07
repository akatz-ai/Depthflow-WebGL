export class State {
    constructor() {
        // Parallax parameters
        this.height = 0.25;
        this.steady = 0.3;
        this.focus = 0.0;
        this.zoom = 0;
        this.isometric = 0.5;
        this.dolly = 0.0;
        this.invert = 0.0;
        this.mirror = true;
        this.quality = 0.6;

        // Two-layer blending parameters
        this.layerBlend = 1.0;
        this.steepnessLimit = 1.0;
        this.blendSoftness = 0.5;
        this.visualization = 0;

        // Depth processing parameters
        this.foregroundThreshold = 0.4;
        this.maskDilation = 5;

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

        // Smoothing
        this.smoothing = 0.85;
        this._lastTime = performance.now();
    }

    setTargetOffset(x, y) {
        this._targetOffsetX = x;
        this._targetOffsetY = y;
    }

    update() {
        const now = performance.now();
        const dt = (now - this._lastTime) / 1000;
        this._lastTime = now;

        const t = 1 - Math.pow(this.smoothing, dt * 60);
        this.offsetX += (this._targetOffsetX - this.offsetX) * t;
        this.offsetY += (this._targetOffsetY - this.offsetY) * t;
    }

    reset() {
        this.height = 0.25;
        this.steady = 0.3;
        this.focus = 0.0;
        this.zoom = 0;
        this.isometric = 0.5;
        this.dolly = 0.0;
        this.invert = 0.0;
        this.mirror = true;
        this.quality = 0.6;
        this.layerBlend = 1.0;
        this.steepnessLimit = 1.0;
        this.blendSoftness = 0.5;
        this.foregroundThreshold = 0.4;
        this.maskDilation = 5;
        this.visualization = 0;
        this.smoothing = 0.85;
        this.offsetX = 0.0;
        this.offsetY = 0.0;
        this._targetOffsetX = 0.0;
        this._targetOffsetY = 0.0;
        this.centerX = 0.0;
        this.centerY = 0.0;
    }
}
