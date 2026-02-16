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
        this.touchOrbitMultiplier = 2.2;
        this.touchMode = 'none';
        this.touchSessionActive = false;
        this.touchAnchorX = 0;
        this.touchAnchorY = 0;
        this.touchAnchorCenterX = 0;
        this.touchAnchorCenterY = 0;
        this.pinchStartDistance = 1;
        this.pinchStartZoom = 1;
        this.lastPinchMidX = 0;
        this.lastPinchMidY = 0;
        this.boundTouchMove = (e) => this.onTouchMove(e);
        this.boundTouchEnd = (e) => this.onTouchEnd(e);
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
        window.addEventListener('touchmove', this.boundTouchMove, { passive: false });
        window.addEventListener('touchend', this.boundTouchEnd, { passive: false });
        window.addEventListener('touchcancel', this.boundTouchEnd, { passive: false });

        this.canvas.addEventListener('gesturestart', this.preventBrowserGesture, { passive: false });
        this.canvas.addEventListener('gesturechange', this.preventBrowserGesture, { passive: false });
        this.canvas.addEventListener('gestureend', this.preventBrowserGesture, { passive: false });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    clampZoom(value) {
        return Math.max(0.1, Math.min(3.0, value));
    }

    clampCameraRange(value) {
        return Math.max(-8, Math.min(8, value));
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
        this.state.centerX = this.clampCameraRange(this.touchAnchorCenterX - panX);
        this.state.centerY = this.clampCameraRange(this.touchAnchorCenterY + panY);
    }

    applyMultiTouchGesture(t1, t2) {
        const distance = this.getTouchDistance(t1, t2);
        const scale = distance / Math.max(1, this.pinchStartDistance);
        // Lower zoom values are visually "closer" in this renderer.
        const nextZoom = this.clampZoom(this.pinchStartZoom / Math.max(0.01, scale));
        this.state._targetZoom = nextZoom;
        this.state.zoom = nextZoom;

        const mid = this.getTouchMidpoint(t1, t2);
        const dx = mid.x - this.lastPinchMidX;
        const dy = mid.y - this.lastPinchMidY;
        this.lastPinchMidX = mid.x;
        this.lastPinchMidY = mid.y;

        if (!this.state.motionEnabled) {
            const nextOffsetX = this.clampCameraRange(
                this.state._targetOffsetX - dx * this.orbitSensitivity * this.touchOrbitMultiplier
            );
            const nextOffsetY = this.clampCameraRange(
                this.state._targetOffsetY + dy * this.orbitSensitivity * this.touchOrbitMultiplier
            );
            this.state.setTargetOffset(nextOffsetX, nextOffsetY);
            this.state.offsetX = nextOffsetX;
            this.state.offsetY = nextOffsetY;
        }
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

        this.touchSessionActive = true;

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
        if (!this.touchSessionActive) return;
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

            this.applyMultiTouchGesture(t1, t2);
        }
    }

    onTouchEnd(e) {
        if (!this.touchSessionActive) return;
        if (e && e.cancelable) {
            e.preventDefault();
        }

        const remaining = e ? e.touches.length : 0;
        if (remaining === 0) {
            this.isDragging = false;
            this.touchMode = 'none';
            this.touchSessionActive = false;
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
