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
    }

    async init() {
        await this.renderer.init();
        this.ui.init();
        this.input.init();
        await this.loadDefaultImages();

        // Wait for next frame to ensure canvas is properly laid out
        requestAnimationFrame(() => {
            this.renderer.resize();
            this.lastTime = performance.now();
            this.render();
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

    render() {
        const now = performance.now();
        const deltaTime = (now - this.lastTime) / 1000;
        this.lastTime = now;

        this.motion.update(deltaTime);
        this.state.update();
        this.ui.syncZoomSlider();
        this.renderer.render();
        requestAnimationFrame(() => this.render());
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new DepthFlowApp();
    app.init().catch(console.error);
});
