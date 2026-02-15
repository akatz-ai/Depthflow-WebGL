export class InputHandler {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.isDragging = false;
        this.isRightDragging = false;
        this.lastX = 0;
        this.lastY = 0;
        this.sensitivity = 0.003;
    }

    init() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mouseleave', () => this.onMouseLeave());

        this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));
        this.canvas.addEventListener('touchend', () => this.onTouchEnd());

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
        const dx = (e.clientX - this.lastX) * this.sensitivity;
        const dy = (e.clientY - this.lastY) * this.sensitivity;

        this.lastX = e.clientX;
        this.lastY = e.clientY;

        if (this.isDragging) {
            // Left drag: pan the scene
            this.state.centerX -= dx;
            this.state.centerY += dy;
        } else if (this.isRightDragging) {
            // Right drag: orbit/tilt camera angle (parallax offset)
            this.state.setTargetOffset(
                this.state._targetOffsetX - dx,
                this.state._targetOffsetY + dy
            );
        }
    }

    onWheel(e) {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
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
        if (e.touches.length === 1) {
            this.isDragging = true;
            this.lastX = e.touches[0].clientX;
            this.lastY = e.touches[0].clientY;
        }
    }

    onTouchMove(e) {
        if (!this.isDragging || e.touches.length !== 1) return;
        e.preventDefault();

        const touch = e.touches[0];
        const dx = (touch.clientX - this.lastX) * this.sensitivity;
        const dy = (touch.clientY - this.lastY) * this.sensitivity;

        this.lastX = touch.clientX;
        this.lastY = touch.clientY;

        // Touch drag: pan the scene
        this.state.centerX -= dx;
        this.state.centerY += dy;
    }

    onTouchEnd() {
        this.isDragging = false;
    }
}
