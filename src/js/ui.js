export class UI {
    constructor(state, renderer, depthEstimator) {
        this.state = state;
        this.renderer = renderer;
        this.depthEstimator = depthEstimator;
        this.autoDepthEnabled = true;
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

        // Checkbox
        this.bindCheckbox('mirror');

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
