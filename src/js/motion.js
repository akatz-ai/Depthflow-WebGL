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
        defaults: { height: 0.15, isometric: 0.8 }
    },
    dolly: {
        name: 'Dolly',
        defaults: { height: 0.2, focus: 0.5 }
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
        defaults: { height: 0.2, steady: 0.5 }
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
        // Oscillate zoom between -50 and 50 (maps to 0.7x - 1.4x)
        const z = Math.sin(t) * intensity * 50;
        this.state.zoom = z;
    }

    animateDolly(t, intensity) {
        // Oscillate dolly
        const d = (Math.sin(t) + 1) * 0.5 * intensity * 3;
        this.state.dolly = d;
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
        // Combination: circle motion + slight zoom pulse
        const x = Math.sin(t) * intensity * 0.25;
        const y = Math.cos(t) * intensity * 0.15;
        const z = Math.sin(t * 0.5) * intensity * 20;

        this.state._targetOffsetX = x;
        this.state._targetOffsetY = y;
        this.state.zoom = z;
    }
}
