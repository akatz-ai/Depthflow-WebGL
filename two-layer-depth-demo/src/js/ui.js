export class UI {
    constructor(state, renderer, app) {
        this.state = state;
        this.renderer = renderer;
        this.app = app;
    }

    init() {
        this.bindSliders();
        this.bindButtons();
        this.bindVisualization();
        this.updateAllDisplays();
    }

    bindSliders() {
        const sliders = [
            // Parallax
            { id: 'height', prop: 'height', display: v => v.toFixed(2) },
            { id: 'steady', prop: 'steady', display: v => v.toFixed(2) },
            { id: 'focus', prop: 'focus', display: v => v.toFixed(2) },
            { id: 'zoom', prop: 'zoom', display: v => `${Math.pow(2, v/100).toFixed(2)}x` },
            { id: 'isometric', prop: 'isometric', display: v => v.toFixed(2) },
            { id: 'dolly', prop: 'dolly', display: v => v.toFixed(2) },
            { id: 'quality', prop: 'quality', display: v => v.toFixed(2) },

            // Two-layer blending
            { id: 'layerBlend', prop: 'layerBlend', display: v => v.toFixed(2) },
            { id: 'steepnessLimit', prop: 'steepnessLimit', display: v => v.toFixed(2) },
            { id: 'blendSoftness', prop: 'blendSoftness', display: v => v.toFixed(2) },

            // Depth processing
            { id: 'foregroundThreshold', prop: 'foregroundThreshold', display: v => v.toFixed(2) },
            { id: 'maskDilation', prop: 'maskDilation', display: v => `${v}px` },
            { id: 'smoothing', prop: 'smoothing', display: v => v.toFixed(2) },
        ];

        for (const cfg of sliders) {
            const slider = document.getElementById(cfg.id);
            const display = document.getElementById(cfg.id + 'Value');

            if (!slider) continue;

            slider.value = this.state[cfg.prop];

            slider.addEventListener('input', () => {
                this.state[cfg.prop] = parseFloat(slider.value);
                if (display) {
                    display.textContent = cfg.display(this.state[cfg.prop]);
                }
            });

            if (display) {
                display.textContent = cfg.display(this.state[cfg.prop]);
            }
        }

        // Mirror checkbox
        const mirror = document.getElementById('mirror');
        if (mirror) {
            mirror.checked = this.state.mirror;
            mirror.addEventListener('change', () => {
                this.state.mirror = mirror.checked;
            });
        }

        // Invert checkbox
        const invert = document.getElementById('invert');
        if (invert) {
            invert.checked = this.state.invert > 0.5;
            invert.addEventListener('change', () => {
                this.state.invert = invert.checked ? 1.0 : 0.0;
            });
        }
    }

    bindButtons() {
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.state.reset();
                this.updateAllDisplays();
                if (this.renderer) {
                    this.renderer.lastProcessParams = null;
                }
            });
        }
    }

    bindVisualization() {
        const select = document.getElementById('visualization');
        if (select) {
            select.value = this.state.visualization;
            select.addEventListener('change', () => {
                this.state.visualization = parseInt(select.value);
            });
        }
    }

    updateAllDisplays() {
        const sliders = [
            { id: 'height', prop: 'height', display: v => v.toFixed(2) },
            { id: 'steady', prop: 'steady', display: v => v.toFixed(2) },
            { id: 'focus', prop: 'focus', display: v => v.toFixed(2) },
            { id: 'zoom', prop: 'zoom', display: v => `${Math.pow(2, v/100).toFixed(2)}x` },
            { id: 'isometric', prop: 'isometric', display: v => v.toFixed(2) },
            { id: 'dolly', prop: 'dolly', display: v => v.toFixed(2) },
            { id: 'quality', prop: 'quality', display: v => v.toFixed(2) },
            { id: 'layerBlend', prop: 'layerBlend', display: v => v.toFixed(2) },
            { id: 'steepnessLimit', prop: 'steepnessLimit', display: v => v.toFixed(2) },
            { id: 'blendSoftness', prop: 'blendSoftness', display: v => v.toFixed(2) },
            { id: 'foregroundThreshold', prop: 'foregroundThreshold', display: v => v.toFixed(2) },
            { id: 'maskDilation', prop: 'maskDilation', display: v => `${v}px` },
            { id: 'smoothing', prop: 'smoothing', display: v => v.toFixed(2) },
        ];

        for (const cfg of sliders) {
            const slider = document.getElementById(cfg.id);
            const display = document.getElementById(cfg.id + 'Value');

            if (slider) {
                slider.value = this.state[cfg.prop];
            }
            if (display) {
                display.textContent = cfg.display(this.state[cfg.prop]);
            }
        }

        const mirror = document.getElementById('mirror');
        if (mirror) mirror.checked = this.state.mirror;

        const invert = document.getElementById('invert');
        if (invert) invert.checked = this.state.invert > 0.5;

        const vis = document.getElementById('visualization');
        if (vis) vis.value = this.state.visualization;
    }
}
