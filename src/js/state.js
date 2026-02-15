export class State {
    constructor() {
        // Parallax parameters
        this.height = 0.2;
        this.steady = 0.0;
        this.focus = 0.0;
        this.zoom = 1.0;
        this.isometric = 0.0;
        this.dolly = 0.0;
        this.invert = 0.0;
        this.mirror = true;
        this.quality = 0.5;
        this.edgeFix = 0.2;     // Depth dilation intensity (0-1)
        this.ssaa = 1.0;        // Supersampling AA multiplier (1-2)

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
        this._targetZoom = 1.0;

        // Smoothing factor (0 = instant, 1 = never)
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

        // Exponential smoothing
        const t = 1 - Math.pow(this.smoothing, dt * 60);
        this.offsetX += (this._targetOffsetX - this.offsetX) * t;
        this.offsetY += (this._targetOffsetY - this.offsetY) * t;
        this.zoom += (this._targetZoom - this.zoom) * t;
    }

    reset() {
        this.height = 0.2;
        this.steady = 0.0;
        this.focus = 0.0;
        this.zoom = 1.0;
        this.isometric = 0.0;
        this.dolly = 0.0;
        this.invert = 0.0;
        this.mirror = true;
        this.quality = 0.5;
        this.edgeFix = 0.2;
        this.ssaa = 1.0;
        this.smoothing = 0.85;
        this.offsetX = 0.0;
        this.offsetY = 0.0;
        this._targetOffsetX = 0.0;
        this._targetOffsetY = 0.0;
        this._targetZoom = 1.0;
        this.centerX = 0.0;
        this.centerY = 0.0;
    }
}
