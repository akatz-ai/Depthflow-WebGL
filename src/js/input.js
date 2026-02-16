export class InputHandler {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.isDragging = false;
        this.isRightDragging = false;
        this.lastX = 0;
        this.lastY = 0;
        this.panSensitivity = 0.002;
        this.orbitSensitivity = 0.004;
        this.touchOrbitMultiplier = 1.35;
        this.touchMode = 'none';
        this.touchAnchorX = 0;
        this.touchAnchorY = 0;
        this.touchAnchorCenterX = 0;
        this.touchAnchorCenterY = 0;
        this.pinchStartDistance = 1;
        this.pinchStartZoom = 1;
        this.lastPinchMidX = 0;
        this.lastPinchMidY = 0;
        this.preventBrowserGesture = (e) => {
            if (e && e.cancelable) {
                e.preventDefault();
            }
        };
    }

    init() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mouseleave', () => this.onMouseLeave());

        this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        this.canvas.style.touchAction = 'none';
        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });
        this.canvas.addEventListener('gesturestart', this.preventBrowserGesture, { passive: false });
        this.canvas.addEventListener('gesturechange', this.preventBrowserGesture, { passive: false });
        this.canvas.addEventListener('gestureend', this.preventBrowserGesture, { passive: false });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    clampZoom(value) {
        return Math.max(0.1, Math.min(3.0, value));
    }

    getTouchPair(touches) {
        if (!touches || touches.length < 2) return null;
        return [touches[0], touches[1]];
    }

    getTouchDistance(t1, t2) {
        return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    }

    getTouchMidpoint(t1, t2) {
        return {
            x: (t1.clientX + t2.clientX) * 0.5,
            y: (t1.clientY + t2.clientY) * 0.5
        };
    }

    startSingleTouch(touch) {
        this.touchMode = 'pan';
        this.isDragging = true;
        this.touchAnchorX = touch.clientX;
        this.touchAnchorY = touch.clientY;
        this.touchAnchorCenterX = this.state.centerX;
        this.touchAnchorCenterY = this.state.centerY;
    }

    startMultiTouch(t1, t2) {
        this.touchMode = 'multitouch';
        this.isDragging = false;
        this.pinchStartDistance = Math.max(1, this.getTouchDistance(t1, t2));
        this.pinchStartZoom = this.state._targetZoom;
        const mid = this.getTouchMidpoint(t1, t2);
        this.lastPinchMidX = mid.x;
        this.lastPinchMidY = mid.y;
    }

    applyTouchPan(touch) {
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        const aspect = width / height;

        const dx = touch.clientX - this.touchAnchorX;
        const dy = touch.clientY - this.touchAnchorY;

        const panX = (dx / width) * aspect * 2.0;
        const panY = (dy / height) * 2.0;

        // Keep panning directly under the finger, instead of lagging behind.
        this.state.centerX = this.touchAnchorCenterX - panX;
        this.state.centerY = this.touchAnchorCenterY + panY;
    }

    onMouseDown(e) {
        this.lastX = e.clientX;
        this.lastY = e.clientY;

        if (e.button === 0) {
            this.isDragging = true;
            this.canvas.style.cursor = 'grabbing';
        } else if (e.button === 2) {
            this.isRightDragging = true;
            this.canvas.style.cursor = 'move';
        }
    }

    onMouseMove(e) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;

        this.lastX = e.clientX;
        this.lastY = e.clientY;

        if (this.isDragging) {
            // Left drag: pan the scene
            this.state.centerX -= dx * this.panSensitivity;
            this.state.centerY += dy * this.panSensitivity;
        } else if (this.isRightDragging) {
            // Right drag: orbit/tilt camera angle (parallax offset)
            this.state.setTargetOffset(
                this.state._targetOffsetX - dx * this.orbitSensitivity,
                this.state._targetOffsetY + dy * this.orbitSensitivity
            );
        }
    }

    onWheel(e) {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 1.05 : 0.95;
        const newZoom = this.state._targetZoom * zoomFactor;
        this.state._targetZoom = Math.max(0.1, Math.min(3.0, newZoom));
    }

    onMouseUp(e) {
        if (e.button === 0) this.isDragging = false;
        if (e.button === 2) this.isRightDragging = false;
        this.canvas.style.cursor = 'grab';
    }

    onMouseLeave() {
        this.isDragging = false;
        this.isRightDragging = false;
        this.canvas.style.cursor = 'grab';
    }

    onTouchStart(e) {
        if (e.cancelable) {
            e.preventDefault();
        }

        if (e.touches.length === 1) {
            this.startSingleTouch(e.touches[0]);
            return;
        }

        if (e.touches.length >= 2) {
            const pair = this.getTouchPair(e.touches);
            if (pair) {
                this.startMultiTouch(pair[0], pair[1]);
            }
        }
    }

    onTouchMove(e) {
        if (e.cancelable) {
            e.preventDefault();
        }

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            if (this.touchMode !== 'pan') {
                this.startSingleTouch(touch);
            }
            this.applyTouchPan(touch);
            return;
        }

        if (e.touches.length >= 2) {
            const pair = this.getTouchPair(e.touches);
            if (!pair) return;

            const [t1, t2] = pair;
            if (this.touchMode !== 'multitouch') {
                this.startMultiTouch(t1, t2);
                return;
            }

            const distance = this.getTouchDistance(t1, t2);
            const scale = distance / Math.max(1, this.pinchStartDistance);
            this.state._targetZoom = this.clampZoom(this.pinchStartZoom / Math.max(0.01, scale));

            const mid = this.getTouchMidpoint(t1, t2);
            const dx = mid.x - this.lastPinchMidX;
            const dy = mid.y - this.lastPinchMidY;
            this.lastPinchMidX = mid.x;
            this.lastPinchMidY = mid.y;

            if (!this.state.motionEnabled) {
                this.state.setTargetOffset(
                    this.state._targetOffsetX - dx * this.orbitSensitivity * this.touchOrbitMultiplier,
                    this.state._targetOffsetY + dy * this.orbitSensitivity * this.touchOrbitMultiplier
                );
            }
        }
    }

    onTouchEnd(e) {
        if (e && e.cancelable) {
            e.preventDefault();
        }

        const remaining = e ? e.touches.length : 0;
        if (remaining === 0) {
            this.isDragging = false;
            this.touchMode = 'none';
            return;
        }

        if (remaining === 1) {
            this.startSingleTouch(e.touches[0]);
            return;
        }

        const pair = this.getTouchPair(e.touches);
        if (pair) {
            this.startMultiTouch(pair[0], pair[1]);
        }
    }
}
