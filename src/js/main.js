import { Renderer } from './renderer.js';
import { State } from './state.js';
import { InputHandler } from './input.js';
import { UI } from './ui.js';
import { DepthEstimator } from './depth.js';

class DepthFlowApp {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.state = new State();
        this.renderer = new Renderer(this.canvas, this.state);
        this.input = new InputHandler(this.canvas, this.state);
        this.depthEstimator = new DepthEstimator();
        this.ui = new UI(this.state, this.renderer, this.depthEstimator);
    }

    async init() {
        await this.renderer.init();
        this.ui.init();
        this.input.init();
        await this.loadDefaultImages();
        this.render();
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
        this.state.update();
        this.renderer.render();
        requestAnimationFrame(() => this.render());
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new DepthFlowApp();
    app.init().catch(console.error);
});
