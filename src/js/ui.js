import { PRESETS } from './motion.js';

export class UI {
    constructor(state, renderer, depthEstimator, motion) {
        this.state = state;
        this.renderer = renderer;
        this.depthEstimator = depthEstimator;
        this.motion = motion;
        this.autoDepthEnabled = true;
        this.devMode = new URLSearchParams(window.location.search).has('dev');
        this.state.devMode = this.devMode;
    }

    init() {
        // File uploads
        this.bindImageUpload();
        this.bindFileUpload('depth-upload', (file) => this.renderer.loadDepth(file));

        // Auto-depth checkbox
        const autoDepthCheckbox = document.getElementById('auto-depth-checkbox');
        const depthUploadGroup = document.getElementById('depth-upload-group');

        autoDepthCheckbox.addEventListener('change', (e) => {
            this.autoDepthEnabled = e.target.checked;
            depthUploadGroup.classList.toggle('disabled', e.target.checked);
        });
        depthUploadGroup.classList.toggle('disabled', this.autoDepthEnabled);

        // Sliders - ranges aligned with upstream DepthFlow defaults
        this.bindSlider('height', 0, 2.0, 0.01);
        this.bindSlider('steady', 0, 1, 0.01);
        this.bindSlider('focus', 0, 1, 0.01);
        this.bindZoomSlider();
        this.bindSlider('isometric', 0, 1, 0.01);
        this.bindSlider('dolly', 0, 20, 0.1);
        this.bindSlider('invert', 0, 1, 0.01);
        this.bindSlider('quality', 0.1, 1, 0.01);
        this.bindSlider('smoothing', 0, 0.99, 0.01);
        this.bindSliderDebounced('edgeFix', 0, 1.0, 0.1, 150);  // Depth dilation (debounced)
        this.bindSlider('ssaa', 1, 2.0, 0.1);                   // Supersampling AA

        // Checkbox
        this.bindCheckbox('mirror');

        // Motion presets
        this.bindMotionPresets();

        // Reset button
        document.getElementById('reset-btn').addEventListener('click', () => {
            this.state.reset();
            this.updateAllSliders();
        });

        // Toggle controls panel
        const toggleBtn = document.getElementById('toggle-controls');
        const controls = document.getElementById('controls');
        toggleBtn.addEventListener('click', () => {
            controls.classList.toggle('hidden');
            toggleBtn.classList.toggle('shifted');
        });
    }

    bindImageUpload() {
        const input = document.getElementById('image-upload');
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            await this.renderer.loadImage(file);

            if (this.autoDepthEnabled) {
                this.showProgress('Loading AI model (~20MB)...');
                await this.depthEstimator.init((p) => this.updateProgress(p));

                this.showProgress('Estimating depth...');
                const depthImage = await this.depthEstimator.estimate(file);
                const depthData = this.depthEstimator.toImageData(depthImage);

                this.renderer.loadDepthFromImageData(depthData);
                this.hideProgress();
            }
        });
    }

    bindFileUpload(id, callback) {
        const input = document.getElementById(id);
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) await callback(file);
        });
    }

    showProgress(text) {
        const container = document.getElementById('depth-progress');
        const textEl = document.getElementById('progress-text');
        container.style.display = 'block';
        textEl.textContent = text;
    }

    hideProgress() {
        document.getElementById('depth-progress').style.display = 'none';
        document.getElementById('progress-bar').style.width = '0%';
    }

    updateProgress(progress) {
        if (progress.status === 'progress') {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            document.getElementById('progress-bar').style.width = pct + '%';
            document.getElementById('progress-text').textContent = `Downloading model: ${pct}%`;
        }
    }

    bindSlider(name, min, max, step, isInt = false) {
        const slider = document.getElementById(`${name}-slider`);
        const value = document.getElementById(`${name}-value`);

        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = this.state[name];
        value.textContent = isInt ? this.state[name] : this.state[name].toFixed(2);

        slider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.state[name] = v;
            value.textContent = isInt ? v : v.toFixed(2);
        });
    }

    bindZoomSlider() {
        const slider = document.getElementById('zoom-slider');
        const value = document.getElementById('zoom-value');

        slider.min = 0.1;
        slider.max = 3.0;
        slider.step = 0.01;
        slider.value = this.state._targetZoom;
        value.textContent = this.state._targetZoom.toFixed(2);

        slider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.state._targetZoom = v;
            value.textContent = v.toFixed(2);
        });
    }

    bindSliderDebounced(name, min, max, step, delay) {
        const slider = document.getElementById(`${name}-slider`);
        const value = document.getElementById(`${name}-value`);

        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = this.state[name];
        value.textContent = this.state[name].toFixed(2);

        let timeout = null;
        slider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            value.textContent = v.toFixed(2);

            // Debounce the state update
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                this.state[name] = v;
            }, delay);
        });
    }

    bindCheckbox(name) {
        const checkbox = document.getElementById(`${name}-checkbox`);
        checkbox.checked = this.state[name];

        checkbox.addEventListener('change', (e) => {
            this.state[name] = e.target.checked;
        });
    }

    bindMotionPresets() {
        const select = document.getElementById('motion-preset');
        const intensitySlider = document.getElementById('motion-intensity');
        const intensityValue = document.getElementById('motion-intensity-value');
        const speedSlider = document.getElementById('motion-speed');
        const speedValue = document.getElementById('motion-speed-value');

        // Populate preset options
        select.innerHTML = '';
        for (const [key, preset] of Object.entries(PRESETS)) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = preset.name;
            select.appendChild(option);
        }

        select.addEventListener('change', (e) => {
            this.motion.setPreset(e.target.value);
            this.updateAllSliders();
        });

        // Intensity slider
        intensitySlider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.motion.intensity = v;
            intensityValue.textContent = v.toFixed(1);
        });

        // Speed slider
        speedSlider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.motion.speed = v;
            speedValue.textContent = v.toFixed(1);
        });
    }

    updateAllSliders() {
        const names = ['height', 'steady', 'focus', 'zoom', 'isometric',
                       'dolly', 'invert', 'quality', 'smoothing', 'edgeFix', 'ssaa'];

        for (const name of names) {
            const slider = document.getElementById(`${name}-slider`);
            const value = document.getElementById(`${name}-value`);
            if (name === 'zoom') {
                slider.value = this.state._targetZoom;
                value.textContent = this.state._targetZoom.toFixed(2);
            } else {
                slider.value = this.state[name];
                value.textContent = this.state[name].toFixed(2);
            }
        }

        document.getElementById('mirror-checkbox').checked = this.state.mirror;
    }

    // Sync zoom slider with state (called from render loop for mouse wheel sync)
    syncZoomSlider() {
        const slider = document.getElementById('zoom-slider');
        const value = document.getElementById('zoom-value');
        const target = this.state._targetZoom;
        if (Math.abs(parseFloat(slider.value) - target) > 0.005) {
            slider.value = target;
            value.textContent = target.toFixed(2);
        }
    }
}
