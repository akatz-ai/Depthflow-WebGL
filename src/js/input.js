export class InputHandler {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.isDragging = false;
        this.lastX = 0;
        this.lastY = 0;
        this.sensitivity = 0.003;
    }

    init() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this.onMouseUp());
        this.canvas.addEventListener('mouseleave', () => this.onMouseUp());

        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));
        this.canvas.addEventListener('touchend', () => this.onTouchEnd());

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    onMouseDown(e) {
        if (e.button === 0) {
            this.isDragging = true;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
            this.canvas.style.cursor = 'grabbing';
        }
    }

    onMouseMove(e) {
        if (!this.isDragging) return;

        const dx = (e.clientX - this.lastX) * this.sensitivity;
        const dy = (e.clientY - this.lastY) * this.sensitivity;

        this.lastX = e.clientX;
        this.lastY = e.clientY;

        this.state.setTargetOffset(
            this.state._targetOffsetX - dx,
            this.state._targetOffsetY + dy
        );
    }

    onMouseUp() {
        this.isDragging = false;
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

        this.state.setTargetOffset(
            this.state._targetOffsetX - dx,
            this.state._targetOffsetY + dy
        );
    }

    onTouchEnd() {
        this.isDragging = false;
    }
}
