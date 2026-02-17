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
        this.layoutSyncTimer = null;
        this.pendingExportQuality = {
            webm: 50,
            mp4: 50,
            gif: 70
        };
        this.pendingExportFps = 24;
        this.mobileMediaQuery = window.matchMedia('(max-width: 768px)');
        this.isMobileLayout = this.mobileMediaQuery.matches;
        this.desktopControlsOpen = true;
        this.mobileDrawerDetent = 'collapsed';
        this.drawerPeekHeight = 88;
        this.drawerMidVisibleRatio = 0.48;
        this.drawerDragging = false;
        this.drawerPointerId = null;
        this.drawerStartY = 0;
        this.drawerStartOffset = 0;
        this.drawerCurrentOffset = 0;
        this.controlsEl = null;
        this.controlsHeaderEl = null;
        this.controlsScrollEl = null;
        this.toggleControlsBtn = null;
        this.drawerHandleEl = null;
        this.drawerPointerTarget = null;
        this.regenerateDepthBtn = null;
        this.currentImageBlob = null;
        this.currentOriginalImageBlob = null;
        this.depthGenerationInProgress = false;
        this.zoomSliderMin = 0.1;
        this.zoomSliderMax = 3.0;
        this.drawerSuppressTap = false;
        this.boundDrawerPointerMove = (event) => this.onDrawerPointerMove(event);
        this.boundDrawerPointerUp = (event) => this.onDrawerPointerUp(event);
        this.boundControlsTransitionEnd = (event) => this.onControlsTransitionEnd(event);
        this.boundViewportModeChange = () => this.applyResponsiveLayoutMode({ persist: false });
        this.boundViewportResize = () => {
            if (this.isMobileLayout) {
                this.setMobileDrawerDetent(this.mobileDrawerDetent, {
                    persist: false,
                    sync: false,
                    animate: false
                });
            }
        };
        this.state.motionEnabled = false;
        this.persistedSettings = this.loadPersistedSettings();
    }

    init() {
        this.applyPersistedSettings();
        this.sanitizeCameraState();

        // File uploads
        this.bindImageUpload();
        this.bindRegenerateDepthButton();
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
        maxResSelect.addEventListener('change', async (e) => {
            this.state.maxResolution = parseInt(e.target.value, 10);
            try {
                await this.applyMaxResolutionToCurrentImage();
            } catch (err) {
                console.error('Failed to apply max resolution change:', err);
            }
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
            this.recenterView();
            this.updateAllSliders();
            this.scheduleSettingsSave(0);
        });

        const recenterViewBtn = document.getElementById('recenter-view-btn');
        if (recenterViewBtn) {
            recenterViewBtn.addEventListener('click', () => {
                this.recenterCenterOnly();
                this.scheduleSettingsSave(0);
            });
        }

        this.initResponsiveLayout();

        this.bindPersistenceTriggers();
        window.addEventListener('beforeunload', () => this.saveSettings());

        this.initialized = true;
        if (this.recorder) {
            this.bindExportControls();
        }
        this.scheduleSettingsSave(0);
    }

    sanitizeCameraState() {
        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const cameraLimit = 8;
        let dirty = false;

        const clampField = (key, min, max, fallback = 0) => {
            const raw = this.state[key];
            const numeric = Number(raw);
            const finite = Number.isFinite(numeric) ? numeric : fallback;
            const next = clamp(finite, min, max);
            if (this.state[key] !== next) {
                this.state[key] = next;
                dirty = true;
            }
        };

        clampField('offsetX', -cameraLimit, cameraLimit, 0);
        clampField('offsetY', -cameraLimit, cameraLimit, 0);
        clampField('_targetOffsetX', -cameraLimit, cameraLimit, 0);
        clampField('_targetOffsetY', -cameraLimit, cameraLimit, 0);
        clampField('centerX', -cameraLimit, cameraLimit, 0);
        clampField('centerY', -cameraLimit, cameraLimit, 0);
        clampField('originX', -cameraLimit, cameraLimit, 0);
        clampField('originY', -cameraLimit, cameraLimit, 0);
        clampField('zoom', 0.1, 3, 1);
        clampField('_targetZoom', 0.1, 3, 1);

        if (dirty) {
            this.scheduleSettingsSave(0);
        }
    }

    recenterView() {
        this.recenterCenterOnly();
        this.state.originX = 0;
        this.state.originY = 0;
        this.state.offsetX = 0;
        this.state.offsetY = 0;
        this.state._targetOffsetX = 0;
        this.state._targetOffsetY = 0;
    }

    recenterCenterOnly() {
        this.state.centerX = 0;
        this.state.centerY = 0;
    }

    setRecorder(recorder) {
        this.recorder = recorder;
        if (this.initialized) {
            this.bindExportControls();
            this.triggerLayoutSync();
        }
    }

    initResponsiveLayout() {
        this.controlsEl = document.getElementById('controls');
        this.controlsHeaderEl = document.getElementById('controls-header');
        this.controlsScrollEl = document.getElementById('controls-scroll');
        this.toggleControlsBtn = document.getElementById('toggle-controls');
        this.drawerHandleEl = document.getElementById('drawer-handle');
        if (!this.controlsEl || !this.controlsHeaderEl || !this.controlsScrollEl || !this.toggleControlsBtn) return;

        this.toggleControlsBtn.addEventListener('click', () => {
            if (this.isMobileLayout) {
                const nextDetent = this.mobileDrawerDetent === 'collapsed' ? 'full' : 'collapsed';
                this.setMobileDrawerDetent(nextDetent);
            } else {
                this.setDesktopControlsOpen(!this.desktopControlsOpen);
            }
        });

        if (this.controlsHeaderEl) {
            this.controlsHeaderEl.addEventListener('pointerdown', (event) => this.onDrawerPointerDown(event));
        }

        if (this.drawerHandleEl) {
            this.drawerHandleEl.addEventListener('click', () => {
                if (!this.isMobileLayout || this.drawerSuppressTap) return;

                const order = ['collapsed', 'mid', 'full'];
                const index = order.indexOf(this.mobileDrawerDetent);
                const nextDetent = order[(index + 1) % order.length];
                this.setMobileDrawerDetent(nextDetent);
            });
        }

        if (this.mobileMediaQuery.addEventListener) {
            this.mobileMediaQuery.addEventListener('change', this.boundViewportModeChange);
        } else {
            this.mobileMediaQuery.addListener(this.boundViewportModeChange);
        }
        window.addEventListener('orientationchange', this.boundViewportModeChange);
        window.addEventListener('resize', this.boundViewportResize);
        this.controlsEl.addEventListener('transitionend', this.boundControlsTransitionEnd);

        this.applyResponsiveLayoutMode({ persist: false });
    }

    onControlsTransitionEnd(event) {
        if (!event || event.target !== this.controlsEl) return;
        if (event.propertyName !== 'transform' && event.propertyName !== 'top') return;
        this.triggerLayoutSync();
    }

    applyResponsiveLayoutMode({ persist = true } = {}) {
        this.isMobileLayout = this.mobileMediaQuery.matches;
        document.body.classList.toggle('mobile-layout', this.isMobileLayout);

        if (this.isMobileLayout) {
            document.body.classList.remove('controls-collapsed');
            if (this.controlsEl) {
                this.controlsEl.classList.remove('hidden');
            }
            if (this.toggleControlsBtn) {
                this.toggleControlsBtn.classList.remove('shifted');
            }
            this.setMobileDrawerDetent(this.mobileDrawerDetent, {
                persist: false,
                sync: false,
                animate: false
            });
        } else {
            document.body.classList.remove('drawer-collapsed', 'drawer-mid', 'drawer-full');
            if (this.controlsEl) {
                this.controlsEl.classList.remove('dragging');
                this.controlsEl.style.removeProperty('--drawer-top');
            }
            if (this.controlsScrollEl) {
                this.controlsScrollEl.scrollTop = 0;
            }
            this.setDesktopControlsOpen(this.desktopControlsOpen, {
                persist: false,
                sync: false
            });
        }

        if (persist) {
            this.scheduleSettingsSave();
        }
        this.triggerLayoutSync();
    }

    setDesktopControlsOpen(open, { persist = true, sync = true } = {}) {
        this.desktopControlsOpen = !!open;

        if (!this.isMobileLayout) {
            const collapsed = !this.desktopControlsOpen;
            document.body.classList.toggle('controls-collapsed', collapsed);

            if (this.controlsEl) {
                this.controlsEl.classList.toggle('hidden', collapsed);
            }
            if (this.toggleControlsBtn) {
                this.toggleControlsBtn.classList.toggle('shifted', collapsed);
            }
        }

        if (persist) {
            this.scheduleSettingsSave();
        }
        if (sync) {
            this.triggerLayoutSync();
        }
    }

    getMobileDrawerOffsets() {
        const viewportHeight = Math.max(
            320,
            Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight || 0)
        );
        const collapsed = Math.max(0, viewportHeight - this.drawerPeekHeight);
        const midVisible = Math.round(viewportHeight * this.drawerMidVisibleRatio);
        const rawMid = Math.max(0, viewportHeight - midVisible);
        const maxMid = Math.max(0, collapsed - 48);
        const mid = Math.min(maxMid, Math.max(64, rawMid));

        return {
            full: 0,
            mid,
            collapsed
        };
    }

    applyMobileDrawerOffset(offset, animate = true) {
        if (!this.controlsEl) return;

        if (!animate) {
            this.controlsEl.classList.add('dragging');
            this.controlsEl.style.setProperty('--drawer-top', `${Math.round(offset)}px`);
            requestAnimationFrame(() => {
                if (!this.drawerDragging && this.controlsEl) {
                    this.controlsEl.classList.remove('dragging');
                }
            });
            return;
        }

        this.controlsEl.classList.remove('dragging');
        this.controlsEl.style.setProperty('--drawer-top', `${Math.round(offset)}px`);
    }

    setMobileDrawerDetent(detent, { persist = true, sync = false, animate = true } = {}) {
        const valid = ['collapsed', 'mid', 'full'];
        this.mobileDrawerDetent = valid.includes(detent) ? detent : 'collapsed';

        if (this.isMobileLayout) {
            const offsets = this.getMobileDrawerOffsets();
            const offset = offsets[this.mobileDrawerDetent];
            this.drawerCurrentOffset = offset;

            document.body.classList.remove('drawer-collapsed', 'drawer-mid', 'drawer-full');
            document.body.classList.add(`drawer-${this.mobileDrawerDetent}`);
            this.applyMobileDrawerOffset(offset, animate);

            if (this.mobileDrawerDetent === 'collapsed' && this.controlsScrollEl) {
                this.controlsScrollEl.scrollTop = 0;
            }
        }

        if (persist) {
            this.scheduleSettingsSave();
        }
        if (sync) {
            this.triggerLayoutSync();
        }
    }

    onDrawerPointerDown(event) {
        if (!this.isMobileLayout || !this.controlsEl) return;

        event.preventDefault();
        this.drawerDragging = true;
        this.drawerSuppressTap = false;
        this.drawerPointerId = event.pointerId;
        this.drawerPointerTarget = event.currentTarget || null;
        this.drawerStartY = event.clientY;

        const offsets = this.getMobileDrawerOffsets();
        this.drawerStartOffset = offsets[this.mobileDrawerDetent] ?? offsets.collapsed;
        this.drawerCurrentOffset = this.drawerStartOffset;

        this.controlsEl.classList.add('dragging');
        this.controlsEl.style.setProperty('--drawer-top', `${Math.round(this.drawerStartOffset)}px`);

        if (this.drawerPointerTarget && this.drawerPointerTarget.setPointerCapture) {
            this.drawerPointerTarget.setPointerCapture(event.pointerId);
        }

        window.addEventListener('pointermove', this.boundDrawerPointerMove);
        window.addEventListener('pointerup', this.boundDrawerPointerUp);
        window.addEventListener('pointercancel', this.boundDrawerPointerUp);
    }

    onDrawerPointerMove(event) {
        if (!this.drawerDragging || event.pointerId !== this.drawerPointerId || !this.controlsEl) return;

        const offsets = this.getMobileDrawerOffsets();
        const delta = event.clientY - this.drawerStartY;
        const unclamped = this.drawerStartOffset + delta;
        const nextOffset = Math.min(offsets.collapsed, Math.max(offsets.full, unclamped));

        if (Math.abs(delta) > 4) {
            this.drawerSuppressTap = true;
        }

        this.drawerCurrentOffset = nextOffset;
        this.controlsEl.style.setProperty('--drawer-top', `${Math.round(nextOffset)}px`);
    }

    onDrawerPointerUp(event) {
        if (!this.drawerDragging || event.pointerId !== this.drawerPointerId) return;

        this.drawerDragging = false;
        this.drawerPointerId = null;

        if (this.drawerPointerTarget && this.drawerPointerTarget.releasePointerCapture) {
            this.drawerPointerTarget.releasePointerCapture(event.pointerId);
        }
        this.drawerPointerTarget = null;

        window.removeEventListener('pointermove', this.boundDrawerPointerMove);
        window.removeEventListener('pointerup', this.boundDrawerPointerUp);
        window.removeEventListener('pointercancel', this.boundDrawerPointerUp);

        if (this.controlsEl) {
            this.controlsEl.classList.remove('dragging');
        }

        const offsets = this.getMobileDrawerOffsets();
        const candidates = ['collapsed', 'mid', 'full'];
        let nearest = 'collapsed';
        let bestDistance = Infinity;

        for (const detent of candidates) {
            const distance = Math.abs(this.drawerCurrentOffset - offsets[detent]);
            if (distance < bestDistance) {
                bestDistance = distance;
                nearest = detent;
            }
        }

        this.setMobileDrawerDetent(nearest, { persist: true, animate: true });

        if (this.drawerSuppressTap) {
            setTimeout(() => {
                this.drawerSuppressTap = false;
            }, 0);
        }
    }

    triggerLayoutSync() {
        if (this.renderer && typeof this.renderer.resize === 'function') {
            this.renderer.resize();
        }
        if (this.recorder && typeof this.recorder.syncOverlaySize === 'function') {
            this.recorder.syncOverlaySize();
        }
        window.dispatchEvent(new Event('resize'));

        clearTimeout(this.layoutSyncTimer);
        this.layoutSyncTimer = setTimeout(() => {
            if (this.renderer && typeof this.renderer.resize === 'function') {
                this.renderer.resize();
            }
            if (this.recorder && typeof this.recorder.syncOverlaySize === 'function') {
                this.recorder.syncOverlaySize();
            }
            window.dispatchEvent(new Event('resize'));
            this.layoutSyncTimer = null;
        }, 320);
    }

    bindImageUpload() {
        const input = document.getElementById('image-upload');
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                this.currentOriginalImageBlob = file;
                await this.saveMediaBlob('image-original', file);

                const resized = await this.resizeImage(this.currentOriginalImageBlob, this.state.maxResolution);
                this.currentImageBlob = resized;
                await this.renderer.loadImage(resized);
                this.recenterView();
                await this.saveMediaBlob('image', resized);
                this.scheduleSettingsSave();

                if (this.autoDepthEnabled) {
                    await this.generateDepthMapFromImage(resized);
                }
            } catch (err) {
                console.error('Image upload failed:', err);
                this.showLoadingOverlay('Image/depth processing failed. See console for details.');
                await new Promise((resolve) => setTimeout(resolve, 1200));
                this.hideProgress();
                this.hideLoadingOverlay();
            } finally {
                input.value = '';
            }
        });
    }

    async applyMaxResolutionToCurrentImage() {
        const original = await this.getBestOriginalImageBlob();
        if (!(original instanceof Blob)) return;

        const resized = await this.resizeImage(original, this.state.maxResolution);
        this.currentImageBlob = resized;
        await this.renderer.loadImage(resized);
        await this.saveMediaBlob('image', resized);
    }

    async getBestOriginalImageBlob() {
        if (this.currentOriginalImageBlob instanceof Blob) {
            return this.currentOriginalImageBlob;
        }

        const storedOriginal = await this.loadMediaBlob('image-original');
        if (storedOriginal instanceof Blob) {
            this.currentOriginalImageBlob = storedOriginal;
            return storedOriginal;
        }

        if (this.currentImageBlob instanceof Blob) {
            return this.currentImageBlob;
        }

        const storedImage = await this.loadMediaBlob('image');
        if (storedImage instanceof Blob) {
            this.currentImageBlob = storedImage;
            this.currentOriginalImageBlob = storedImage;
            await this.saveMediaBlob('image-original', storedImage);
            return storedImage;
        }

        return null;
    }

    bindRegenerateDepthButton() {
        this.regenerateDepthBtn = document.getElementById('regenerate-depth-btn');
        if (!this.regenerateDepthBtn) return;

        this.regenerateDepthBtn.addEventListener('click', async () => {
            if (this.depthGenerationInProgress) return;

            let imageBlob = this.currentImageBlob;
            if (!(imageBlob instanceof Blob)) {
                imageBlob = await this.loadMediaBlob('image');
            }

            if (!(imageBlob instanceof Blob)) {
                this.showLoadingOverlay('Upload an image before regenerating depth.');
                await new Promise((resolve) => setTimeout(resolve, 1000));
                this.hideLoadingOverlay();
                return;
            }

            this.currentImageBlob = imageBlob;

            try {
                await this.generateDepthMapFromImage(imageBlob);
            } catch (err) {
                console.error('Depth regeneration failed:', err);
                this.showLoadingOverlay('Depth regeneration failed. See console for details.');
                await new Promise((resolve) => setTimeout(resolve, 1200));
                this.hideLoadingOverlay();
            }
        });
    }

    setDepthGenerationBusy(busy) {
        this.depthGenerationInProgress = busy;

        if (this.regenerateDepthBtn) {
            this.regenerateDepthBtn.disabled = busy;
            this.regenerateDepthBtn.textContent = busy ? 'Generating Depth...' : 'Regenerate Depth Map';
        }
    }

    async generateDepthMapFromImage(imageBlob) {
        if (!(imageBlob instanceof Blob)) {
            throw new Error('No image available for depth generation');
        }
        if (this.depthGenerationInProgress) {
            return;
        }

        this.setDepthGenerationBusy(true);

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

            const depthImage = await this.depthEstimator.estimate(imageBlob);
            const depthData = this.depthEstimator.toImageData(depthImage);

            this.renderer.loadDepthFromImageData(depthData);
            await this.saveDepthImageData(depthData);
        } finally {
            this.hideProgress();
            this.hideLoadingOverlay();
            this.setDepthGenerationBusy(false);
        }
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
            try {
                if (file) {
                    await callback(file);
                    this.scheduleSettingsSave();
                }
            } finally {
                input.value = '';
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

    zoomToSliderValue(zoom) {
        const z = Number(zoom);
        const clamped = Math.min(this.zoomSliderMax, Math.max(this.zoomSliderMin, Number.isFinite(z) ? z : 1));
        return this.zoomSliderMin + this.zoomSliderMax - clamped;
    }

    sliderValueToZoom(sliderValue) {
        const v = Number(sliderValue);
        const mapped = this.zoomSliderMin + this.zoomSliderMax - (Number.isFinite(v) ? v : 1);
        return Math.min(this.zoomSliderMax, Math.max(this.zoomSliderMin, mapped));
    }

    bindZoomSlider() {
        const slider = document.getElementById('zoom-slider');
        const value = document.getElementById('zoom-value');

        slider.min = this.zoomSliderMin;
        slider.max = this.zoomSliderMax;
        slider.step = 0.01;
        slider.value = this.zoomToSliderValue(this.state._targetZoom);
        value.textContent = this.state._targetZoom.toFixed(2);

        slider.addEventListener('input', (e) => {
            const nextZoom = this.sliderValueToZoom(parseFloat(e.target.value));
            this.state._targetZoom = nextZoom;
            value.textContent = nextZoom.toFixed(2);
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
            this.state.motionEnabled = this.motion.running;
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
        const exportQualitySlider = document.getElementById('export-quality-slider');
        const exportQualityLabel = document.getElementById('export-quality-label');
        const exportQualityValue = document.getElementById('export-quality-value');
        const exportFpsSlider = document.getElementById('export-fps-slider');
        const exportFpsValue = document.getElementById('export-fps-value');

        const clampQuality = (value, fallback = 50) => {
            const parsed = Number.parseInt(String(value), 10);
            if (!Number.isFinite(parsed)) return fallback;
            return Math.max(1, Math.min(100, parsed));
        };

        const clampFps = (value, fallback = 24) => {
            const parsed = Number.parseInt(String(value), 10);
            if (!Number.isFinite(parsed)) return fallback;
            return Math.max(12, Math.min(60, parsed));
        };

        const normalizeFormat = (value) => {
            if (value === 'mp4' || value === 'gif' || value === 'webm') return value;
            return 'webm';
        };

        const formatLabel = (format) => {
            if (format === 'mp4') return 'MP4';
            if (format === 'gif') return 'GIF';
            return 'WebM';
        };

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
            syncQualityUIForFormat(this.recorder.format);
        };

        const applyPersistedExportQuality = () => {
            const persistedQuality = this.persistedSettings?.export?.quality || {};
            for (const format of ['webm', 'mp4', 'gif']) {
                const fallback = this.pendingExportQuality[format];
                const quality = clampQuality(persistedQuality[format], fallback);
                this.pendingExportQuality[format] = quality;
                this.recorder.setExportQuality(format, quality);
            }
        };

        const applyPersistedExportFps = () => {
            const persistedFps = this.persistedSettings?.export?.fps;
            const fps = clampFps(persistedFps, this.pendingExportFps);
            this.pendingExportFps = fps;
            this.recorder.setExportFps(fps);
        };

        const syncQualityUIForFormat = (format) => {
            const normalized = normalizeFormat(format);
            const quality = this.recorder.getExportQuality(normalized);
            this.pendingExportQuality[normalized] = quality;

            if (exportQualitySlider) {
                exportQualitySlider.value = String(quality);
            }
            if (exportQualityLabel) {
                exportQualityLabel.textContent = `${formatLabel(normalized)} Quality`;
            }
            if (exportQualityValue) {
                exportQualityValue.textContent = this.getExportQualityLabel(normalized, quality);
            }
        };

        const syncFpsUI = () => {
            const fps = this.recorder.getExportFps();
            this.pendingExportFps = fps;

            if (exportFpsSlider) {
                exportFpsSlider.value = String(fps);
            }
            if (exportFpsValue) {
                exportFpsValue.textContent = `${fps} fps`;
            }
        };

        const gifOption = formatSelect.querySelector('option[value="gif"]');
        if (gifOption && typeof window.GIF === 'undefined') {
            gifOption.title = 'GIF export is not available in this browser session.';
        }

        applyPersistedExportQuality();
        applyPersistedExportFps();

        this.recorder.loops = parseInt(loopsSlider.value, 10) || 1;
        this.recorder.format = normalizeFormat(formatSelect.value);
        formatSelect.value = this.recorder.format;
        loopsValue.textContent = String(this.recorder.loops);
        syncQualityUIForFormat(this.recorder.format);
        syncFpsUI();

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
            this.recorder.format = normalizeFormat(e.target.value);
            formatSelect.value = this.recorder.format;
            this.recorder.showCropGuides();
            syncQualityUIForFormat(this.recorder.format);
            this.scheduleSettingsSave();
        });

        if (exportQualitySlider) {
            exportQualitySlider.addEventListener('input', (e) => {
                const activeFormat = normalizeFormat(this.recorder.format || formatSelect.value);
                const quality = clampQuality(e.target.value, this.recorder.getExportQuality(activeFormat));
                this.recorder.setExportQuality(activeFormat, quality);
                this.pendingExportQuality[activeFormat] = quality;
                syncQualityUIForFormat(activeFormat);
                this.scheduleSettingsSave();
            });
        }

        if (exportFpsSlider) {
            exportFpsSlider.addEventListener('input', (e) => {
                const fps = clampFps(e.target.value, this.recorder.getExportFps());
                this.recorder.setExportFps(fps);
                this.pendingExportFps = fps;
                syncFpsUI();
                syncQualityUIForFormat(normalizeFormat(this.recorder.format || formatSelect.value));
                this.scheduleSettingsSave();
            });
        }

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
            if (exportQualitySlider) {
                exportQualitySlider.disabled = true;
            }
            if (exportFpsSlider) {
                exportFpsSlider.disabled = true;
            }

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
                if (exportQualitySlider) {
                    exportQualitySlider.disabled = false;
                }
                if (exportFpsSlider) {
                    exportFpsSlider.disabled = false;
                }
            }
        });
    }

    getExportQualityLabel(format, quality) {
        const clampedQuality = Math.max(1, Math.min(100, Math.round(Number(quality) || 50)));

        if (format === 'gif') {
            const sampleStep = this.recorder.getGifEncoderQualityFromSlider(clampedQuality);
            return `${clampedQuality}% (sample ${sampleStep})`;
        }

        const bitrate = this.recorder.getVideoBitrateMbpsForQuality(clampedQuality, format);
        if (this.recorder.isVideoLosslessQuality(clampedQuality)) {
            return `Lossless (target ${bitrate.toFixed(0)} Mbps)`;
        }
        return `${clampedQuality}% (${bitrate.toFixed(1)} Mbps)`;
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
                slider.value = this.zoomToSliderValue(this.state._targetZoom);
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
        this.state.motionEnabled = this.motion.running;
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

        const exportQuality = exportData.quality || {};
        const parseExportQuality = (value, fallback) => {
            const parsed = Number.parseInt(String(value), 10);
            return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : fallback;
        };
        const parseExportFps = (value, fallback) => {
            const parsed = Number.parseInt(String(value), 10);
            return Number.isFinite(parsed) ? Math.max(12, Math.min(60, parsed)) : fallback;
        };

        this.pendingExportQuality = {
            webm: parseExportQuality(exportQuality.webm, 50),
            mp4: parseExportQuality(exportQuality.mp4, 50),
            gif: parseExportQuality(exportQuality.gif, 70)
        };
        this.pendingExportFps = parseExportFps(exportData.fps, this.pendingExportFps);

        const activeExportFormat = formatSelect && ['webm', 'mp4', 'gif'].includes(formatSelect.value)
            ? formatSelect.value
            : 'webm';
        const exportQualitySlider = document.getElementById('export-quality-slider');
        if (exportQualitySlider) {
            exportQualitySlider.value = String(this.pendingExportQuality[activeExportFormat]);
        }
        const exportFpsSlider = document.getElementById('export-fps-slider');
        if (exportFpsSlider) {
            exportFpsSlider.value = String(this.pendingExportFps);
        }
        const exportFpsValue = document.getElementById('export-fps-value');
        if (exportFpsValue) {
            exportFpsValue.textContent = `${this.pendingExportFps} fps`;
        }

        const layoutData = persisted.layout || {};
        if (typeof layoutData.desktopControlsOpen === 'boolean') {
            this.desktopControlsOpen = layoutData.desktopControlsOpen;
        }
        if (['collapsed', 'mid', 'full'].includes(layoutData.mobileDrawerDetent)) {
            this.mobileDrawerDetent = layoutData.mobileDrawerDetent;
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
        const sanitizeQuality = (value, fallback) => {
            const parsed = Number.parseInt(String(value), 10);
            return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : fallback;
        };
        const sanitizeFps = (value, fallback) => {
            const parsed = Number.parseInt(String(value), 10);
            return Number.isFinite(parsed) ? Math.max(12, Math.min(60, parsed)) : fallback;
        };
        const fps = this.recorder
            ? this.recorder.getExportFps()
            : sanitizeFps(this.pendingExportFps, 24);
        const quality = this.recorder
            ? {
                webm: this.recorder.getExportQuality('webm'),
                mp4: this.recorder.getExportQuality('mp4'),
                gif: this.recorder.getExportQuality('gif')
            }
            : {
                webm: sanitizeQuality(this.pendingExportQuality.webm, 50),
                mp4: sanitizeQuality(this.pendingExportQuality.mp4, 50),
                gif: sanitizeQuality(this.pendingExportQuality.gif, 70)
            };

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
                format: formatSelect ? formatSelect.value : 'webm',
                fps,
                quality
            },
            layout: {
                desktopControlsOpen: this.desktopControlsOpen,
                mobileDrawerDetent: this.mobileDrawerDetent
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
        const originalBlob = await this.loadMediaBlob('image-original');
        const imageBlob = await this.loadMediaBlob('image');

        const sourceBlob = originalBlob || imageBlob;
        if (!sourceBlob) {
            return false;
        }

        this.currentOriginalImageBlob = sourceBlob;
        const resized = await this.resizeImage(sourceBlob, this.state.maxResolution);
        this.currentImageBlob = resized;
        await this.renderer.loadImage(resized);
        await this.saveMediaBlob('image', resized);
        if (!originalBlob) {
            await this.saveMediaBlob('image-original', sourceBlob);
        }

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
        const sliderTarget = this.zoomToSliderValue(target);
        if (Math.abs(parseFloat(slider.value) - sliderTarget) > 0.005) {
            slider.value = sliderTarget;
            value.textContent = target.toFixed(2);
            this.scheduleSettingsSave();
        }
    }
}
