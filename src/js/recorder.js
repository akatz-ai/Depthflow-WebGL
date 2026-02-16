export const ASPECT_PRESETS = {
    '9:16': { w: 9, h: 16, label: '9:16 (Reels/TikTok)' },
    '1:1': { w: 1, h: 1, label: '1:1 (Instagram)' },
    '4:5': { w: 4, h: 5, label: '4:5 (Instagram Feed)' },
    '16:9': { w: 16, h: 9, label: '16:9 (YouTube)' },
    '4:3': { w: 4, h: 3, label: '4:3 (Classic)' },
    full: { w: 0, h: 0, label: 'Full Canvas' },
    custom: { w: 0, h: 0, label: 'Custom...' }
};

export class Recorder {
    constructor(canvas, state, motion) {
        this.canvas = canvas;
        this.state = state;
        this.motion = motion;
        this.isRecording = false;
        this.isPreviewing = false;
        this.mediaRecorder = null;
        this.chunks = [];

        // Recording settings
        this.aspectRatio = null;
        this.exportWidth = 1080;
        this.exportHeight = 1920;
        this.duration = 5;
        this.loops = 1;
        this.format = 'webm';
        this.fps = 30;
        this.videoCaptureFps = 60;

        // Crop guide state
        this.showGuides = false;
        this.guideOpacity = 0;
        this.guideFadeTimer = null;

        this.overlay = null;
        this.overlayCtx = null;
        this.overlayResizeObserver = null;
        this.previewStartTime = null;
        this.previewPendingStart = false;
        this.previewOriginalRunning = false;

        this.offscreenCanvas = null;
        this.offscreenCtx = null;
        this.recordingStartTime = 0;
        this.recordingPendingStart = false;
        this.recordingDuration = 0;
        this.recordingOriginalRunning = false;
        this.recordingProgress = null;
        this.recordedMimeType = 'video/webm';

        this.fadeAnimationToken = 0;

        // GIF recording state
        this.gifRecording = false;
        this.gifFrames = null;
        this.gifOffscreen = null;
        this.gifOffCtx = null;
        this.gifDoneResolve = null;
        this.gifFrameDelay = 0;
        this.gifTotalFrames = 0;
        this.gifCapturedCount = 0;
    }

    snapCameraToTargets() {
        // Prevent the first preview/recording frames from capturing smoothing convergence.
        this.state.offsetX = this.state._targetOffsetX;
        this.state.offsetY = this.state._targetOffsetY;
        this.state.zoom = this.state._targetZoom;
        this.state._lastTime = performance.now();
    }

    getCycleDuration() {
        const speed = Number(this.motion.speed) || 0;
        if (speed <= 0) {
            return this.duration;
        }
        return (2 * Math.PI) / speed;
    }

    getBoundaryAlignedFrameCount(durationSec, fps) {
        return Math.max(1, Math.round(durationSec * fps) + 1);
    }

    warmupSmoothingForCycle(cycleDurationSec) {
        if (cycleDurationSec <= 0 || !Number.isFinite(cycleDurationSec) || this.state.smoothing <= 0) {
            return;
        }

        // Advance one hidden cycle so smoothing reaches a periodic state before capture starts.
        const steps = Math.max(1, Math.min(2400, Math.round(cycleDurationSec * 120)));
        const stepSec = cycleDurationSec / steps;

        for (let i = 0; i < steps; i++) {
            this.motion.update(stepSec);
            const t = 1 - Math.pow(this.state.smoothing, stepSec * 60);
            this.state.offsetX += (this.state._targetOffsetX - this.state.offsetX) * t;
            this.state.offsetY += (this.state._targetOffsetY - this.state.offsetY) * t;
            this.state.zoom += (this.state._targetZoom - this.state.zoom) * t;
        }
    }

    resetLoopToStartPose() {
        // Evaluate motion at t=0 so preset-dependent targets/params are applied immediately.
        this.motion.time = 0;
        this.motion.running = true;
        this.motion.update(0);

        const cycleDuration = this.getCycleDuration();
        if (this.motion.preset !== 'none' && this.state.smoothing > 0) {
            this.warmupSmoothingForCycle(cycleDuration);
            // Re-anchor phase to exact loop start while preserving warmed smoothed state.
            this.motion.time = 0;
            this.motion.update(0);
            this.state._lastTime = performance.now();
            return;
        }

        this.snapCameraToTargets();
    }

    initOverlay() {
        this.overlay = document.getElementById('recording-overlay');
        if (!this.overlay) return;

        this.overlayCtx = this.overlay.getContext('2d');
        this.syncOverlaySize();

        if (typeof ResizeObserver !== 'undefined') {
            this.overlayResizeObserver = new ResizeObserver(() => this.syncOverlaySize());
            this.overlayResizeObserver.observe(this.canvas);
        }

        window.addEventListener('resize', () => this.syncOverlaySize());
    }

    syncOverlaySize() {
        if (!this.overlay) return;

        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));

        this.overlay.width = width;
        this.overlay.height = height;
        this.overlay.style.width = `${width}px`;
        this.overlay.style.height = `${height}px`;

        if (this.showGuides || this.isPreviewing) {
            this.drawGuides();
        } else {
            this.clearOverlay();
        }
    }

    clearOverlay() {
        if (!this.overlayCtx || !this.overlay) return;
        this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }

    getOverlayRecordingRegion() {
        const cw = this.overlay ? this.overlay.width : 0;
        const ch = this.overlay ? this.overlay.height : 0;

        if (!cw || !ch) {
            return {
                rx: 0,
                ry: 0,
                rw: 0,
                rh: 0,
                cw,
                ch
            };
        }

        if (!this.aspectRatio || this.aspectRatio.w === 0) {
            return {
                rx: 0,
                ry: 0,
                rw: cw,
                rh: ch,
                cw,
                ch
            };
        }

        const targetRatio = this.aspectRatio.w / this.aspectRatio.h;
        const canvasRatio = cw / ch;

        let rw;
        let rh;

        if (targetRatio > canvasRatio) {
            rw = cw;
            rh = cw / targetRatio;
        } else {
            rh = ch;
            rw = ch * targetRatio;
        }

        return {
            rx: (cw - rw) / 2,
            ry: (ch - rh) / 2,
            rw,
            rh,
            cw,
            ch
        };
    }

    drawGuides() {
        if (!this.overlayCtx || !this.overlay) return;

        if (!this.showGuides || !this.aspectRatio || this.aspectRatio.w === 0) {
            this.clearOverlay();
            return;
        }

        const ctx = this.overlayCtx;
        const { rx, ry, rw, rh, cw, ch } = this.getOverlayRecordingRegion();

        ctx.clearRect(0, 0, cw, ch);

        ctx.fillStyle = `rgba(0, 0, 0, ${0.6 * this.guideOpacity})`;
        ctx.fillRect(0, 0, cw, ry);
        ctx.fillRect(0, ry + rh, cw, ch - (ry + rh));
        ctx.fillRect(0, ry, rx, rh);
        ctx.fillRect(rx + rw, ry, cw - (rx + rw), rh);

        ctx.strokeStyle = `rgba(127, 143, 255, ${this.guideOpacity})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
        ctx.setLineDash([]);

        ctx.fillStyle = `rgba(127, 143, 255, ${this.guideOpacity})`;
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillText(`${this.exportWidth}x${this.exportHeight}`, rx + 8, ry + 18);
    }

    showCropGuides() {
        clearTimeout(this.guideFadeTimer);

        const token = ++this.fadeAnimationToken;
        const start = performance.now();

        this.showGuides = true;
        this.guideOpacity = 0;

        const fadeIn = () => {
            if (token !== this.fadeAnimationToken) return;

            const elapsed = performance.now() - start;
            this.guideOpacity = Math.min(1, elapsed / 200);
            this.drawGuides();

            if (this.guideOpacity < 1) {
                requestAnimationFrame(fadeIn);
                return;
            }

            if (!this.isPreviewing) {
                this.guideFadeTimer = setTimeout(() => this.fadeOutGuides(), 3000);
            }
        };

        requestAnimationFrame(fadeIn);
    }

    fadeOutGuides() {
        if (this.isPreviewing || !this.showGuides) return;

        const token = ++this.fadeAnimationToken;
        const start = performance.now();

        const fade = () => {
            if (token !== this.fadeAnimationToken || this.isPreviewing) return;

            const elapsed = performance.now() - start;
            this.guideOpacity = Math.max(0, 1 - elapsed / 500);
            this.drawGuides();

            if (this.guideOpacity > 0) {
                requestAnimationFrame(fade);
            } else {
                this.showGuides = false;
                this.clearOverlay();
            }
        };

        requestAnimationFrame(fade);
    }

    startPreview() {
        if (this.isRecording) return;

        this.previewOriginalRunning = this.motion.running;
        this.isPreviewing = true;
        this.previewStartTime = null;
        this.previewPendingStart = true;
        this.resetLoopToStartPose();
        // Hold motion for one render so the start pose is shown instantly.
        this.motion.running = false;
        this.showCropGuides();
    }

    stopPreview() {
        if (!this.isPreviewing) return;

        this.isPreviewing = false;
        this.previewStartTime = null;
        this.previewPendingStart = false;
        this.motion.running = this.previewOriginalRunning;
        this.fadeOutGuides();
    }

    updatePreview() {
        if (!this.isPreviewing) return;

        if (this.previewPendingStart) {
            this.previewPendingStart = false;
            this.previewStartTime = performance.now();
            this.motion.running = true;
        }

        if (this.previewStartTime === null) {
            this.previewStartTime = performance.now();
        }

        const total = this.getRecordingDuration();
        const now = performance.now();
        const elapsed = (now - this.previewStartTime) / 1000;

        if (elapsed >= total) {
            this.motion.time = 0;
            this.previewStartTime = now;
        }

        this.drawGuides();
        this.drawPreviewTimer(elapsed % total, total);
    }

    drawPreviewTimer(elapsed, total) {
        if (!this.overlayCtx || !this.overlay) return;

        const ctx = this.overlayCtx;
        const text = `Preview: ${elapsed.toFixed(1)}s / ${total.toFixed(1)}s`;
        const { rx, ry, rw, rh } = this.getOverlayRecordingRegion();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(rx + rw - 200, ry + rh - 34, 194, 24);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.font = 'bold 14px -apple-system, sans-serif';
        const metrics = ctx.measureText(text);
        ctx.fillText(text, rx + rw - metrics.width - 10, ry + rh - 16);
    }

    getRecordingDuration() {
        const loops = Math.max(1, Number(this.loops) || 1);
        return this.getCycleDuration() * loops;
    }

    async startRecording(onProgress) {
        if (this.isRecording) return;

        if (this.isPreviewing) {
            this.stopPreview();
        }

        this.recordingProgress = typeof onProgress === 'function' ? onProgress : null;

        this.isRecording = true;
        this.fadeAnimationToken++;
        this.showGuides = false;
        this.guideOpacity = 0;
        clearTimeout(this.guideFadeTimer);
        this.clearOverlay();

        const duration = this.getRecordingDuration();

        this.recordingOriginalRunning = this.motion.running;
        this.recordingPendingStart = true;
        this.resetLoopToStartPose();
        // Hold motion for one render so the first captured frame is the loop start.
        this.motion.running = false;

        const offscreen = document.createElement('canvas');
        offscreen.width = Math.max(1, Math.round(this.exportWidth));
        offscreen.height = Math.max(1, Math.round(this.exportHeight));

        const offCtx = offscreen.getContext('2d', { alpha: false });
        if (!offCtx) {
            this.isRecording = false;
            this.recordingPendingStart = false;
            this.motion.running = this.recordingOriginalRunning;
            throw new Error('Could not create recording context');
        }

        this.offscreenCanvas = offscreen;
        this.offscreenCtx = offCtx;

        this.recordingStartTime = 0;
        this.recordingDuration = duration * 1000;
        if (this.format !== 'gif' || typeof window.GIF === 'undefined') {
            const videoFrames = this.getBoundaryAlignedFrameCount(duration, this.videoCaptureFps);
            this.recordingDuration = (videoFrames * 1000) / this.videoCaptureFps;
        }

        try {
            if (this.format === 'gif') {
                if (typeof window.GIF === 'undefined') {
                    this.recordedMimeType = 'video/webm';
                    await this.recordVideo(offscreen, true);
                } else {
                    await this.recordGif(offscreen, offCtx, duration);
                }
            } else {
                await this.recordVideo(offscreen, false);
            }
        } finally {
            this.isRecording = false;
            this.motion.running = this.recordingOriginalRunning;
            this.offscreenCanvas = null;
            this.offscreenCtx = null;
            this.mediaRecorder = null;
            this.chunks = [];
            this.recordingProgress = null;
            this.recordingStartTime = 0;
            this.recordingPendingStart = false;
            this.recordingDuration = 0;
            this.gifRecording = false;
            this.gifFrames = null;
            this.gifOffscreen = null;
            this.gifOffCtx = null;
            this.gifDoneResolve = null;
            this.gifFrameDelay = 0;
            this.gifTotalFrames = 0;
            this.gifCapturedCount = 0;
            this.previewPendingStart = false;
        }
    }

    async recordVideo(offscreen, forceWebm) {
        const stream = offscreen.captureStream(this.videoCaptureFps);

        const mimeCandidates = forceWebm
            ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
            : this.format === 'mp4'
                ? [
                    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
                    'video/mp4',
                    'video/webm;codecs=vp9',
                    'video/webm;codecs=vp8',
                    'video/webm'
                ]
                : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

        const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
        const recorderOptions = {
            videoBitsPerSecond: 8_000_000
        };

        if (mimeType) {
            recorderOptions.mimeType = mimeType;
        }

        this.recordedMimeType = mimeType || 'video/webm';

        this.mediaRecorder = new MediaRecorder(stream, recorderOptions);
        this.chunks = [];

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                this.chunks.push(event.data);
            }
        };

        const done = new Promise((resolve, reject) => {
            this.mediaRecorder.onstop = () => {
                const blobType = this.recordedMimeType.includes('mp4') ? 'video/mp4' : 'video/webm';
                const blob = new Blob(this.chunks, { type: blobType });
                const ext = blobType === 'video/mp4' ? 'mp4' : 'webm';
                this.downloadBlob(blob, `depthflow-export.${ext}`);
                stream.getTracks().forEach((track) => track.stop());
                resolve();
            };

            this.mediaRecorder.onerror = (err) => {
                stream.getTracks().forEach((track) => track.stop());
                reject(err.error || new Error('Recording failed'));
            };
        });

        this.mediaRecorder.start(100);

        if (this.recordingProgress) {
            this.recordingProgress({
                phase: 'recording',
                elapsedSec: 0,
                totalSec: this.recordingDuration / 1000
            });
        }

        await done;
    }

    async recordGif(offscreen, offCtx, duration) {
        // GIF frames are captured from the main render loop (via captureGifFrame),
        // then encoded all at once after recording finishes.
        this.gifFrames = [];
        this.gifOffscreen = offscreen;
        this.gifOffCtx = offCtx;
        this.gifFrameDelay = 1000 / this.fps;
        this.gifTotalFrames = this.getBoundaryAlignedFrameCount(duration, this.fps);
        this.gifCapturedCount = 0;
        this.recordingDuration = this.gifTotalFrames * this.gifFrameDelay;
        this.gifRecording = true;

        // Wait for the main render loop to capture all frames
        await new Promise((resolve) => {
            this.gifDoneResolve = resolve;
        });
        this.gifRecording = false;
        this.gifDoneResolve = null;

        if (this.recordingProgress) {
            const totalSec = this.recordingDuration / 1000;
            this.recordingProgress({ phase: 'encoding', elapsedSec: totalSec, totalSec });
        }

        // Encode all captured frames
        const gif = new window.GIF({
            workers: 2,
            quality: 10,
            width: offscreen.width,
            height: offscreen.height,
            workerScript: 'src/vendor/gif.worker.js'
        });

        for (const frame of this.gifFrames) {
            gif.addFrame(frame, { delay: this.gifFrameDelay });
        }

        await new Promise((resolve) => {
            gif.on('finished', (blob) => {
                this.downloadBlob(blob, 'depthflow-export.gif');
                resolve();
            });
            gif.render();
        });

        this.gifFrames = null;
        this.gifOffscreen = null;
        this.gifOffCtx = null;
        this.gifDoneResolve = null;
        this.gifRecording = false;
        this.gifFrameDelay = 0;
        this.gifTotalFrames = 0;
        this.gifCapturedCount = 0;
    }

    captureFrame() {
        if (!this.isRecording || !this.offscreenCanvas || !this.offscreenCtx) {
            return false;
        }

        if (this.recordingPendingStart) {
            this.recordingPendingStart = false;
            this.recordingStartTime = performance.now();
            this.motion.running = true;
            if (this.recordingProgress) {
                this.recordingProgress({
                    phase: 'recording',
                    elapsedSec: 0,
                    totalSec: this.recordingDuration / 1000
                });
            }
        }

        const elapsed = performance.now() - this.recordingStartTime;

        // GIF frame capture: sample at this.fps rate from the render loop
        if (this.gifRecording) {
            const framePeriod = 1000 / this.fps;
            const totalFrames = this.gifTotalFrames || this.getBoundaryAlignedFrameCount(this.recordingDuration / 1000, this.fps);

            while (this.gifCapturedCount < totalFrames && elapsed >= this.gifCapturedCount * framePeriod) {
                const { sx, sy, sw, sh } = this.getRecordingRegionPixels();
                this.gifOffCtx.drawImage(
                    this.canvas, sx, sy, sw, sh,
                    0, 0, this.gifOffscreen.width, this.gifOffscreen.height
                );

                // Copy the pixel data for this frame (gif.js needs ImageData)
                const imageData = this.gifOffCtx.getImageData(
                    0, 0, this.gifOffscreen.width, this.gifOffscreen.height
                );
                this.gifFrames.push(imageData);
                this.gifCapturedCount += 1;
            }

            if (this.recordingProgress) {
                const recordedMs = Math.min(this.gifCapturedCount * framePeriod, this.recordingDuration);
                this.recordingProgress({
                    phase: 'recording',
                    elapsedSec: recordedMs / 1000,
                    totalSec: this.recordingDuration / 1000
                });
            }

            if (this.gifCapturedCount >= totalFrames) {
                if (this.gifDoneResolve) {
                    const resolve = this.gifDoneResolve;
                    this.gifDoneResolve = null;
                    resolve();
                }
                return false;
            }

            return true;
        }

        // Video frame capture
        if (!this.mediaRecorder) {
            return false;
        }

        if (elapsed >= this.recordingDuration) {
            if (this.recordingProgress) {
                this.recordingProgress({
                    phase: 'recording',
                    elapsedSec: this.recordingDuration / 1000,
                    totalSec: this.recordingDuration / 1000
                });
            }

            if (this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
            }

            return false;
        }

        const { sx, sy, sw, sh } = this.getRecordingRegionPixels();
        this.offscreenCtx.drawImage(
            this.canvas,
            sx,
            sy,
            sw,
            sh,
            0,
            0,
            this.offscreenCanvas.width,
            this.offscreenCanvas.height
        );

        if (this.recordingProgress) {
            this.recordingProgress({
                phase: 'recording',
                elapsedSec: elapsed / 1000,
                totalSec: this.recordingDuration / 1000
            });
        }

        return true;
    }

    getRecordingRegionPixels() {
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        if (!this.aspectRatio || this.aspectRatio.w === 0) {
            return { sx: 0, sy: 0, sw: cw, sh: ch };
        }

        const targetRatio = this.aspectRatio.w / this.aspectRatio.h;
        const canvasRatio = cw / ch;

        let sw;
        let sh;

        if (targetRatio > canvasRatio) {
            sw = cw;
            sh = cw / targetRatio;
        } else {
            sh = ch;
            sw = ch * targetRatio;
        }

        return {
            sx: (cw - sw) / 2,
            sy: (ch - sh) / 2,
            sw,
            sh
        };
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
