import { PRESETS } from './motion.js';
import { ASPECT_PRESETS } from './recorder.js';

export class UI {
    constructor(state, renderer, depthEstimator, motion) {
        this.state = state;
        this.renderer = renderer;
        this.depthEstimator = depthEstimator;
        this.motion = motion;
        this.autoDepthEnabled = true;
        this.devMode = new URLSearchParams(window.location.search).has('dev');
        this.state.devMode = this.devMode;
        this.recorder = null;
        this.initialized = false;
        this.exportControlsBound = false;
        this.settingsStorageKey = 'depthflow.settings.v1';
        this.mediaDbName = 'depthflow-media.v1';
        this.mediaStoreName = 'files';
        this.mediaDbPromise = null;
        this.settingsSaveTimer = null;
        this.persistedSettings = this.loadPersistedSettings();
    }

    init() {
        this.applyPersistedSettings();

        // File uploads
        this.bindImageUpload();
        this.bindFileUpload('depth-upload', async (file) => {
            await this.renderer.loadDepth(file);
            await this.saveMediaBlob('depth', file);
        });

        // Auto-depth checkbox
        const autoDepthCheckbox = document.getElementById('auto-depth-checkbox');
        const depthUploadGroup = document.getElementById('depth-upload-group');
        autoDepthCheckbox.checked = this.autoDepthEnabled;

        autoDepthCheckbox.addEventListener('change', (e) => {
            this.autoDepthEnabled = e.target.checked;
            depthUploadGroup.classList.toggle('disabled', e.target.checked);
            this.scheduleSettingsSave();
        });
        depthUploadGroup.classList.toggle('disabled', this.autoDepthEnabled);

        const maxResSelect = document.getElementById('max-resolution');
        maxResSelect.value = String(this.state.maxResolution);
        maxResSelect.addEventListener('change', (e) => {
            this.state.maxResolution = parseInt(e.target.value, 10);
            this.scheduleSettingsSave();
        });

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
            this.scheduleSettingsSave(0);
        });

        // Toggle controls panel
        const toggleBtn = document.getElementById('toggle-controls');
        const controls = document.getElementById('controls');
        toggleBtn.addEventListener('click', () => {
            controls.classList.toggle('hidden');
            toggleBtn.classList.toggle('shifted');
        });

        this.bindPersistenceTriggers();
        window.addEventListener('beforeunload', () => this.saveSettings());

        this.initialized = true;
        if (this.recorder) {
            this.bindExportControls();
        }
        this.scheduleSettingsSave(0);
    }

    setRecorder(recorder) {
        this.recorder = recorder;
        if (this.initialized) {
            this.bindExportControls();
        }
    }

    bindImageUpload() {
        const input = document.getElementById('image-upload');
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const resized = await this.resizeImage(file, this.state.maxResolution);
            await this.renderer.loadImage(resized);
            await this.saveMediaBlob('image', resized);
            this.scheduleSettingsSave();

            if (this.autoDepthEnabled) {
                try {
                    this.showLoadingOverlay('Loading AI model (~20MB)...');
                    this.showProgress('Loading AI model (~20MB)...');
                    await this.depthEstimator.init((p) => {
                        this.updateProgress(p);
                        if (p.status === 'progress') {
                            const pct = Math.round((p.loaded / p.total) * 100);
                            this.showLoadingOverlay(`Downloading model: ${pct}%`);
                        }
                    });

                    this.showLoadingOverlay('Estimating depth...');
                    this.showProgress('Estimating depth...');
                    const depthImage = await this.depthEstimator.estimate(resized);
                    const depthData = this.depthEstimator.toImageData(depthImage);

                    this.renderer.loadDepthFromImageData(depthData);
                    await this.saveDepthImageData(depthData);
                } catch (err) {
                    console.error('Depth estimation failed:', err);
                } finally {
                    this.hideProgress();
                    this.hideLoadingOverlay();
                }
            }
        });
    }

    async resizeImage(file, maxRes) {
        if (maxRes <= 0) return file;

        const img = await createImageBitmap(file);
        const { width, height } = img;

        if (width <= maxRes && height <= maxRes) {
            img.close();
            return file;
        }

        const scale = maxRes / Math.max(width, height);
        const newWidth = Math.round(width * scale);
        const newHeight = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            img.close();
            return file;
        }
        ctx.drawImage(img, 0, 0, newWidth, newHeight);
        img.close();

        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.95);
        });
    }

    bindFileUpload(id, callback) {
        const input = document.getElementById(id);
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await callback(file);
                this.scheduleSettingsSave();
            }
        });
    }

    showProgress(text) {
        const container = document.getElementById('depth-progress');
        const textEl = document.getElementById('progress-text');
        container.style.display = 'block';
        textEl.textContent = text;
    }

    showLoadingOverlay(text) {
        const overlay = document.getElementById('loading-overlay');
        const textEl = document.getElementById('loading-text');
        overlay.style.display = 'flex';
        textEl.textContent = text;
    }

    hideLoadingOverlay() {
        document.getElementById('loading-overlay').style.display = 'none';
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
            this.scheduleSettingsSave();
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
            this.scheduleSettingsSave();
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
                this.scheduleSettingsSave();
            }, delay);
        });
    }

    bindCheckbox(name) {
        const checkbox = document.getElementById(`${name}-checkbox`);
        checkbox.checked = this.state[name];

        checkbox.addEventListener('change', (e) => {
            this.state[name] = e.target.checked;
            this.scheduleSettingsSave();
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

        if (this.motion.preset in PRESETS) {
            select.value = this.motion.preset;
        } else {
            select.value = 'none';
            this.motion.preset = 'none';
            this.motion.running = false;
        }

        intensitySlider.value = String(this.motion.intensity);
        intensityValue.textContent = this.motion.intensity.toFixed(1);
        speedSlider.value = String(this.motion.speed);
        speedValue.textContent = this.motion.speed.toFixed(1);

        select.addEventListener('change', (e) => {
            this.motion.setPreset(e.target.value);
            this.updateAllSliders();
            this.updateExportDurationText();
            this.scheduleSettingsSave();
        });

        // Intensity slider
        intensitySlider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.motion.intensity = v;
            intensityValue.textContent = v.toFixed(1);
            this.scheduleSettingsSave();
        });

        // Speed slider
        speedSlider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.motion.speed = v;
            speedValue.textContent = v.toFixed(1);
            this.updateExportDurationText();
            this.scheduleSettingsSave();
        });
    }

    bindExportControls() {
        if (this.exportControlsBound || !this.recorder) return;
        this.exportControlsBound = true;

        const aspectSelect = document.getElementById('aspect-ratio');
        const loopsSlider = document.getElementById('loops-slider');
        const loopsValue = document.getElementById('loops-value');
        const formatSelect = document.getElementById('export-format');
        const previewBtn = document.getElementById('preview-btn');
        const exportBtn = document.getElementById('export-btn');

        const setPreviewButtonState = (previewing) => {
            previewBtn.classList.toggle('active', previewing);
            previewBtn.textContent = previewing ? 'Stop Preview' : 'Preview';
        };

        const applyAspectPreset = (value, showGuides = true) => {
            const preset = ASPECT_PRESETS[value] || ASPECT_PRESETS.full;

            if (preset.w > 0 && preset.h > 0) {
                this.recorder.aspectRatio = { w: preset.w, h: preset.h };
            } else {
                this.recorder.aspectRatio = { w: 0, h: 0 };
            }

            const { width, height } = this.getDefaultExportSize(this.recorder.aspectRatio);
            this.recorder.exportWidth = width;
            this.recorder.exportHeight = height;

            if (showGuides) {
                this.recorder.showCropGuides();
            }

            this.updateExportDurationText();
        };

        const gifOption = formatSelect.querySelector('option[value="gif"]');
        if (gifOption && typeof window.GIF === 'undefined') {
            gifOption.title = 'GIF export is not available in this browser session.';
        }

        this.recorder.loops = parseInt(loopsSlider.value, 10) || 1;
        this.recorder.format = formatSelect.value;
        loopsValue.textContent = String(this.recorder.loops);

        applyAspectPreset(aspectSelect.value, false);

        aspectSelect.addEventListener('change', (e) => {
            applyAspectPreset(e.target.value, true);
            this.scheduleSettingsSave();
        });

        loopsSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10) || 1;
            this.recorder.loops = value;
            loopsValue.textContent = String(value);
            this.recorder.showCropGuides();
            this.updateExportDurationText();
            this.scheduleSettingsSave();
        });

        formatSelect.addEventListener('change', (e) => {
            this.recorder.format = e.target.value;
            this.recorder.showCropGuides();
            this.scheduleSettingsSave();
        });

        previewBtn.addEventListener('click', () => {
            if (this.recorder.isRecording) return;

            if (this.recorder.isPreviewing) {
                this.recorder.stopPreview();
                setPreviewButtonState(false);
            } else {
                this.recorder.startPreview();
                setPreviewButtonState(true);
            }
        });

        exportBtn.addEventListener('click', async () => {
            if (this.recorder.isRecording) return;

            if (this.recorder.isPreviewing) {
                this.recorder.stopPreview();
                setPreviewButtonState(false);
            }

            previewBtn.disabled = true;
            exportBtn.disabled = true;
            aspectSelect.disabled = true;
            loopsSlider.disabled = true;
            formatSelect.disabled = true;

            const total = this.recorder.getRecordingDuration();
            this.showLoadingOverlay(`Recording... 0.0s / ${total.toFixed(1)}s`);

            try {
                let exportPhase = 'recording';
                await this.recorder.startRecording((progress) => {
                    if (progress.phase === 'encoding') {
                        exportPhase = 'encoding';
                        this.showLoadingOverlay('Encoding GIF...');
                    } else if (progress.phase === 'recording' && exportPhase !== 'encoding') {
                        this.showLoadingOverlay(`Recording... ${progress.elapsedSec.toFixed(1)}s / ${progress.totalSec.toFixed(1)}s`);
                    }
                });
            } catch (err) {
                console.error('Export failed:', err);
                this.showLoadingOverlay('Export failed. See console for details.');
                await new Promise((resolve) => setTimeout(resolve, 1200));
            } finally {
                this.hideLoadingOverlay();
                previewBtn.disabled = false;
                exportBtn.disabled = false;
                aspectSelect.disabled = false;
                loopsSlider.disabled = false;
                formatSelect.disabled = false;
            }
        });
    }

    getDefaultExportSize(aspectRatio) {
        let ratio;
        if (aspectRatio && aspectRatio.w > 0 && aspectRatio.h > 0) {
            ratio = aspectRatio.w / aspectRatio.h;
        } else {
            const rect = this.renderer.canvas.getBoundingClientRect();
            ratio = rect.height > 0 ? rect.width / rect.height : (16 / 9);
        }

        const isLandscape = ratio > 1;
        const width = isLandscape ? 1920 : 1080;
        const height = Math.max(1, Math.round(width / ratio));
        return { width, height };
    }

    updateExportDurationText() {
        const durationEl = document.getElementById('export-duration');
        if (!durationEl || !this.recorder) return;

        const loops = Math.max(1, this.recorder.loops);
        const label = loops === 1 ? 'loop' : 'loops';
        const duration = this.recorder.getRecordingDuration();
        durationEl.textContent = `Duration: ~${duration.toFixed(1)}s (${loops} ${label})`;
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
        document.getElementById('max-resolution').value = String(this.state.maxResolution);
        document.getElementById('auto-depth-checkbox').checked = this.autoDepthEnabled;
        document.getElementById('motion-intensity').value = String(this.motion.intensity);
        document.getElementById('motion-intensity-value').textContent = this.motion.intensity.toFixed(1);
        document.getElementById('motion-speed').value = String(this.motion.speed);
        document.getElementById('motion-speed-value').textContent = this.motion.speed.toFixed(1);

        const presetSelect = document.getElementById('motion-preset');
        if (this.motion.preset in PRESETS) {
            presetSelect.value = this.motion.preset;
        } else {
            presetSelect.value = 'none';
        }
    }

    loadPersistedSettings() {
        try {
            const raw = localStorage.getItem(this.settingsStorageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (err) {
            console.warn('Failed to read persisted settings:', err);
            return null;
        }
    }

    applyPersistedSettings() {
        const persisted = this.persistedSettings;
        if (!persisted) return;

        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const numOrNull = (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };

        const stateData = persisted.state || {};
        const applyStateNumber = (key, min = null, max = null) => {
            const value = numOrNull(stateData[key]);
            if (value === null) return;
            this.state[key] = (min === null || max === null) ? value : clamp(value, min, max);
        };

        applyStateNumber('height', 0, 2);
        applyStateNumber('steady', 0, 1);
        applyStateNumber('focus', 0, 1);
        applyStateNumber('zoom', 0.1, 3);
        applyStateNumber('_targetZoom', 0.1, 3);
        applyStateNumber('isometric', 0, 1);
        applyStateNumber('dolly', 0, 20);
        applyStateNumber('invert', 0, 1);
        applyStateNumber('quality', 0.1, 1);
        applyStateNumber('smoothing', 0, 0.99);
        applyStateNumber('edgeFix', 0, 1);
        applyStateNumber('ssaa', 1, 2);

        applyStateNumber('offsetX');
        applyStateNumber('offsetY');
        applyStateNumber('_targetOffsetX');
        applyStateNumber('_targetOffsetY');
        applyStateNumber('centerX');
        applyStateNumber('centerY');
        applyStateNumber('originX');
        applyStateNumber('originY');

        if (typeof stateData.mirror === 'boolean') {
            this.state.mirror = stateData.mirror;
        }

        const maxResolution = parseInt(stateData.maxResolution, 10);
        if ([0, 1024, 1920, 2560, 3840].includes(maxResolution)) {
            this.state.maxResolution = maxResolution;
        }

        if (typeof persisted.autoDepthEnabled === 'boolean') {
            this.autoDepthEnabled = persisted.autoDepthEnabled;
        }

        const motionData = persisted.motion || {};
        if (typeof motionData.preset === 'string' && motionData.preset in PRESETS) {
            this.motion.preset = motionData.preset;
        } else {
            this.motion.preset = 'none';
        }

        const intensity = numOrNull(motionData.intensity);
        if (intensity !== null) {
            this.motion.intensity = clamp(intensity, 0.1, 3);
        }

        const speed = numOrNull(motionData.speed);
        if (speed !== null) {
            this.motion.speed = clamp(speed, 0.1, 3);
        }

        this.motion.running = this.motion.preset !== 'none';
        this.motion.time = 0;

        const exportData = persisted.export || {};
        const aspectSelect = document.getElementById('aspect-ratio');
        if (aspectSelect && typeof exportData.aspect === 'string' && exportData.aspect in ASPECT_PRESETS) {
            aspectSelect.value = exportData.aspect;
        }

        const loopsSlider = document.getElementById('loops-slider');
        const loopsValue = document.getElementById('loops-value');
        const loops = parseInt(exportData.loops, 10);
        if (loopsSlider && Number.isFinite(loops)) {
            const clampedLoops = String(Math.min(5, Math.max(1, loops)));
            loopsSlider.value = clampedLoops;
            if (loopsValue) {
                loopsValue.textContent = clampedLoops;
            }
        }

        const formatSelect = document.getElementById('export-format');
        if (formatSelect && ['webm', 'mp4', 'gif'].includes(exportData.format)) {
            formatSelect.value = exportData.format;
        }
    }

    bindPersistenceTriggers() {
        const save = () => this.scheduleSettingsSave();
        this.renderer.canvas.addEventListener('mouseup', save);
        this.renderer.canvas.addEventListener('touchend', save);
        this.renderer.canvas.addEventListener('mouseleave', save);
        this.renderer.canvas.addEventListener('wheel', save, { passive: true });
    }

    scheduleSettingsSave(delay = 120) {
        clearTimeout(this.settingsSaveTimer);

        if (delay <= 0) {
            this.settingsSaveTimer = null;
            this.saveSettings();
            return;
        }

        this.settingsSaveTimer = setTimeout(() => {
            this.settingsSaveTimer = null;
            this.saveSettings();
        }, delay);
    }

    saveSettings() {
        const snapshot = this.buildSettingsSnapshot();
        if (!snapshot) return;

        try {
            localStorage.setItem(this.settingsStorageKey, JSON.stringify(snapshot));
        } catch (err) {
            console.warn('Failed to persist settings:', err);
        }
    }

    buildSettingsSnapshot() {
        const aspectSelect = document.getElementById('aspect-ratio');
        const loopsSlider = document.getElementById('loops-slider');
        const formatSelect = document.getElementById('export-format');

        return {
            version: 1,
            autoDepthEnabled: this.autoDepthEnabled,
            state: {
                height: this.state.height,
                steady: this.state.steady,
                focus: this.state.focus,
                zoom: this.state.zoom,
                _targetZoom: this.state._targetZoom,
                isometric: this.state.isometric,
                dolly: this.state.dolly,
                invert: this.state.invert,
                mirror: this.state.mirror,
                quality: this.state.quality,
                smoothing: this.state.smoothing,
                edgeFix: this.state.edgeFix,
                ssaa: this.state.ssaa,
                maxResolution: this.state.maxResolution,
                offsetX: this.state.offsetX,
                offsetY: this.state.offsetY,
                _targetOffsetX: this.state._targetOffsetX,
                _targetOffsetY: this.state._targetOffsetY,
                centerX: this.state.centerX,
                centerY: this.state.centerY,
                originX: this.state.originX,
                originY: this.state.originY
            },
            motion: {
                preset: this.motion.preset,
                intensity: this.motion.intensity,
                speed: this.motion.speed
            },
            export: {
                aspect: aspectSelect ? aspectSelect.value : '16:9',
                loops: loopsSlider ? (parseInt(loopsSlider.value, 10) || 1) : 1,
                format: formatSelect ? formatSelect.value : 'webm'
            }
        };
    }

    async openMediaDb() {
        if (typeof indexedDB === 'undefined') return null;
        if (this.mediaDbPromise) return this.mediaDbPromise;

        this.mediaDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.mediaDbName, 1);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.mediaStoreName)) {
                    db.createObjectStore(this.mediaStoreName);
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };

            request.onerror = () => {
                reject(request.error || new Error('Could not open media database'));
            };
        });

        return this.mediaDbPromise;
    }

    async saveMediaBlob(key, blob) {
        if (!(blob instanceof Blob)) return;

        try {
            const db = await this.openMediaDb();
            if (!db) return;

            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.mediaStoreName, 'readwrite');
                tx.objectStore(this.mediaStoreName).put(blob, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error(`Failed to save media: ${key}`));
                tx.onabort = () => reject(tx.error || new Error(`Aborted saving media: ${key}`));
            });
        } catch (err) {
            console.warn(`Failed to persist media asset "${key}":`, err);
        }
    }

    async loadMediaBlob(key) {
        try {
            const db = await this.openMediaDb();
            if (!db) return null;

            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.mediaStoreName, 'readonly');
                const request = tx.objectStore(this.mediaStoreName).get(key);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error || new Error(`Failed to load media: ${key}`));
            });
        } catch (err) {
            console.warn(`Failed to read media asset "${key}":`, err);
            return null;
        }
    }

    async imageDataToBlob(imageData) {
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Could not create canvas context for depth persistence');
        }

        ctx.putImageData(imageData, 0, 0);
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Failed to convert depth image to blob'));
            }, 'image/png');
        });
    }

    async saveDepthImageData(imageData) {
        try {
            const blob = await this.imageDataToBlob(imageData);
            await this.saveMediaBlob('depth', blob);
        } catch (err) {
            console.warn('Failed to persist generated depth map:', err);
        }
    }

    async restorePersistedMedia() {
        const imageBlob = await this.loadMediaBlob('image');
        if (!imageBlob) {
            return false;
        }

        await this.renderer.loadImage(imageBlob);

        const depthBlob = await this.loadMediaBlob('depth');
        if (depthBlob) {
            await this.renderer.loadDepth(depthBlob);
        }

        return true;
    }

    // Sync zoom slider with state (called from render loop for mouse wheel sync)
    syncZoomSlider() {
        const slider = document.getElementById('zoom-slider');
        const value = document.getElementById('zoom-value');
        const target = this.state._targetZoom;
        if (Math.abs(parseFloat(slider.value) - target) > 0.005) {
            slider.value = target;
            value.textContent = target.toFixed(2);
            this.scheduleSettingsSave();
        }
    }
}
