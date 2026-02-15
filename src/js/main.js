import { Renderer } from './renderer.js';
import { State } from './state.js';
import { InputHandler } from './input.js';
import { UI } from './ui.js';
import { DepthEstimator } from './depth.js';
import { MotionController } from './motion.js';

class DepthFlowApp {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.state = new State();
        this.renderer = new Renderer(this.canvas, this.state);
        this.input = new InputHandler(this.canvas, this.state);
        this.depthEstimator = new DepthEstimator();
        this.motion = new MotionController(this.state);
        this.ui = new UI(this.state, this.renderer, this.depthEstimator, this.motion);
        this.lastTime = performance.now();
        this.rafId = null;
        this.needsRender = true;
        this.lastActivityTime = performance.now();
        this.lastStateKey = '';
    }

    async init() {
        await this.renderer.init();
        this.ui.init();
        this.input.init();
        this.setupRenderTriggers();
        await this.loadDefaultImages();

        // Wait for next frame to ensure canvas is properly laid out
        requestAnimationFrame(() => {
            this.renderer.resize();
            this.lastTime = performance.now();
            this.lastStateKey = this.buildRenderKey();
            this.requestRender();
        });
    }

    async loadDefaultImages() {
        try {
            const [imageResponse, depthResponse] = await Promise.all([
                fetch('assets/sample-image.jpg'),
                fetch('assets/sample-depth.jpg')
            ]);

            if (imageResponse.ok && depthResponse.ok) {
                const imageBlob = await imageResponse.blob();
                const depthBlob = await depthResponse.blob();
                await this.renderer.loadImage(imageBlob);
                await this.renderer.loadDepth(depthBlob);
            }
        } catch (e) {
            console.log('No default images found, waiting for upload');
        }
    }

    requestRender() {
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => this.render());
    }

    markActive() {
        this.lastActivityTime = performance.now();
        this.needsRender = true;
        this.requestRender();
    }

    setupRenderTriggers() {
        const wakeEvents = [
            'input', 'change', 'mousedown', 'mousemove', 'mouseup',
            'touchstart', 'touchmove', 'touchend', 'wheel'
        ];

        for (const eventName of wakeEvents) {
            document.addEventListener(eventName, () => this.markActive(), true);
        }

        window.addEventListener('resize', () => this.markActive());
    }

    buildRenderKey() {
        const s = this.state;
        const values = [
            s.height, s.steady, s.focus, s.zoom, s.isometric, s.dolly,
            s.invert, s.mirror ? 1 : 0, s.quality, s.smoothing, s.edgeFix, s.ssaa,
            s.offsetX, s.offsetY, s._targetOffsetX, s._targetOffsetY,
            s.centerX, s.centerY, s.originX, s.originY
        ];
        return values.map((v) => typeof v === 'number' ? v.toFixed(3) : v).join('|');
    }

    render() {
        this.rafId = null;
        const now = performance.now();
        const deltaTime = (now - this.lastTime) / 1000;
        this.lastTime = now;

        this.motion.update(deltaTime);
        this.state.update();
        this.ui.syncZoomSlider();

        const stateKey = this.buildRenderKey();
        const stateChanged = stateKey !== this.lastStateKey;
        if (stateChanged) {
            this.lastStateKey = stateKey;
            this.lastActivityTime = now;
        }

        if (!this.needsRender && !this.motion.running && !stateChanged && (now - this.lastActivityTime) > 100) {
            return;
        }

        this.needsRender = false;
        this.renderer.render();

        const stillActive = this.motion.running || stateChanged || (performance.now() - this.lastActivityTime) <= 100;
        if (this.needsRender || stillActive) {
            this.requestRender();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new DepthFlowApp();
    app.init().catch(console.error);
});
