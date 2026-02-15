// Motion presets based on ComfyUI DepthFlow implementation

export const PRESETS = {
    none: {
        name: 'None',
        defaults: {}
    },
    circle: {
        name: 'Circle',
        defaults: { height: 0.2, steady: 0.3, isometric: 0.6 }
    },
    zoom: {
        name: 'Zoom',
        defaults: { isometric: 0.8 }
    },
    dolly: {
        name: 'Dolly',
        defaults: { height: 0.33, steady: 0.35, focus: 0.35 }
    },
    vertical: {
        name: 'Vertical',
        defaults: { height: 0.2, steady: 0.3, isometric: 0.6 }
    },
    horizontal: {
        name: 'Horizontal',
        defaults: { height: 0.2, steady: 0.3, isometric: 0.6 }
    },
    orbital: {
        name: 'Orbital',
        defaults: { steady: 0.3, focus: 0.3, zoom: 0.98 }
    }
};

export class MotionController {
    constructor(state) {
        this.state = state;
        this.preset = 'none';
        this.intensity = 1.0;
        this.speed = 1.0;
        this.time = 0;
        this.running = false;
    }

    setPreset(presetName) {
        this.preset = presetName;
        this.time = 0;

        // Apply preset defaults
        const preset = PRESETS[presetName];
        if (preset && preset.defaults) {
            Object.assign(this.state, preset.defaults);
            if (preset.defaults.zoom !== undefined) {
                this.state._targetZoom = preset.defaults.zoom;
                this.state.zoom = preset.defaults.zoom;
            } else {
                this.state._targetZoom = 1.0;
                this.state.zoom = 1.0;
            }
        } else {
            this.state._targetZoom = 1.0;
            this.state.zoom = 1.0;
        }

        // Reset animation state
        this.state._targetOffsetX = 0;
        this.state._targetOffsetY = 0;
        this.state.offsetX = 0;
        this.state.offsetY = 0;

        this.running = presetName !== 'none';
    }

    update(deltaTime) {
        if (!this.running) return;

        this.time += deltaTime * this.speed;
        const t = this.time;
        const i = this.intensity;

        switch (this.preset) {
            case 'circle':
                this.animateCircle(t, i);
                break;
            case 'zoom':
                this.animateZoom(t, i);
                break;
            case 'dolly':
                this.animateDolly(t, i);
                break;
            case 'vertical':
                this.animateVertical(t, i);
                break;
            case 'horizontal':
                this.animateHorizontal(t, i);
                break;
            case 'orbital':
                this.animateOrbital(t, i);
                break;
        }
    }

    // Smooth easing function
    ease(t) {
        return (1 - Math.cos(t * Math.PI)) / 2;
    }

    animateCircle(t, intensity) {
        const x = Math.sin(t) * intensity * 0.3;
        const y = Math.cos(t) * intensity * 0.3;
        this.state._targetOffsetX = x;
        this.state._targetOffsetY = y;
    }

    animateZoom(t, intensity) {
        // Upstream zoom preset modulates height with isometric=0.8
        this.state.height = Math.max(0, Math.sin(t) * intensity * 0.5);
    }

    animateDolly(t, intensity) {
        // Upstream dolly preset modulates isometric with steady/focus defaults
        this.state.isometric = Math.max(0, Math.sin(t) * intensity * 0.5 + intensity * 0.5);
    }

    animateVertical(t, intensity) {
        const y = Math.sin(t) * intensity * 0.4;
        this.state._targetOffsetX = 0;
        this.state._targetOffsetY = y;
    }

    animateHorizontal(t, intensity) {
        const x = Math.sin(t) * intensity * 0.4;
        this.state._targetOffsetX = x;
        this.state._targetOffsetY = 0;
    }

    animateOrbital(t, intensity) {
        // Upstream orbital preset: cosine isometric + sine offsetX
        this.state.isometric = Math.max(0, intensity / 4 * Math.cos(t) + intensity / 2 + 0.5);
        this.state._targetOffsetX = intensity / 4 * Math.sin(t);
        this.state._targetOffsetY = 0;
    }
}
