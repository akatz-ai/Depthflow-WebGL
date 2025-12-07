import { State } from './state.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { DepthEstimator } from './depth-estimator.js';
import { Inpainter } from './inpainter.js';
import { DepthProcessor } from './depth-processor.js';

class TwoLayerDepthDemo {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.state = new State();
        this.renderer = new Renderer(this.canvas, this.state);
        this.ui = new UI(this.state, this.renderer, this);

        this.depthEstimator = new DepthEstimator();
        this.inpainter = new Inpainter();
        this.depthProcessor = new DepthProcessor();

        this.isMouseDown = false;
        this.lastMousePos = { x: 0, y: 0 };

        // Processing state
        this.originalImage = null;
        this.depthMap = null;
        this.modelsLoaded = false;
    }

    async init() {
        try {
            this.updateStatus('Initializing WebGL...');
            await this.renderer.init();
            this.ui.init();
            this.setupInputHandlers();
            this.setupFileHandlers();
            this.startRenderLoop();

            this.updateStatus('Ready! Load an image to begin, or load models for AI processing.');
            console.log('Two-Layer Depth Demo initialized');
        } catch (err) {
            console.error('Initialization failed:', err);
            this.updateStatus('Failed to initialize: ' + err.message);
        }
    }

    async loadModels() {
        if (this.modelsLoaded) {
            this.updateStatus('Models already loaded!');
            return;
        }

        try {
            this.updateStatus('Loading depth model (~20MB)...');
            await this.depthEstimator.init((p) => {
                if (p.progress) {
                    this.updateStatus(`Loading depth model: ${Math.round(p.progress)}%`);
                }
            });

            this.updateStatus('Downloading LaMa model (~363MB)...');
            await this.inpainter.downloadModel((p) => {
                this.updateStatus(`Downloading LaMa: ${p.progress}%`);
            });

            this.updateStatus('Creating LaMa session...');
            const result = await this.inpainter.createSession();

            if (result.success) {
                this.modelsLoaded = true;
                this.updateStatus(`Models loaded! LaMa running on ${result.device}`);
            } else {
                this.updateStatus('Failed to create LaMa session');
            }
        } catch (err) {
            console.error('Model loading failed:', err);
            this.updateStatus('Model loading failed: ' + err.message);
        }
    }

    async processImage(file) {
        if (!this.modelsLoaded) {
            this.updateStatus('Loading models first...');
            await this.loadModels();
        }

        try {
            // Step 1: Load original image
            this.updateStatus('Loading image...');
            this.originalImage = await this.loadImageAsCanvas(file);
            this.renderer.imageAspect = this.originalImage.width / this.originalImage.height;
            this.renderer.uploadTexture('image', this.originalImage);

            // Step 2: Estimate depth
            this.updateStatus('Estimating depth...');
            const depthImage = await this.depthEstimator.estimate(file);
            this.depthMap = this.depthEstimator.toImageData(depthImage);

            // Step 3: Process layers
            await this.processLayers();

        } catch (err) {
            console.error('Processing failed:', err);
            this.updateStatus('Processing failed: ' + err.message);
        }
    }

    async processLayers() {
        if (!this.originalImage || !this.depthMap) {
            this.updateStatus('No image or depth map loaded');
            return;
        }

        try {
            this.updateStatus('Extracting foreground mask...');
            this.depthProcessor.setThreshold(this.state.foregroundThreshold);
            this.depthProcessor.setDilation(this.state.maskDilation);

            const maskCanvas = this.depthProcessor.getMaskCanvas(this.depthMap);
            const maskedImage = this.depthProcessor.createMaskedImage(this.originalImage, maskCanvas);

            // Step 4: Extract background depth
            this.updateStatus('Processing depth layers...');
            const layers = this.depthProcessor.process(this.depthMap);

            // Step 5: Run LaMa inpainting
            this.updateStatus('Running AI inpainting...');
            const inpaintedBG = await this.inpainter.inpaint(maskedImage, maskCanvas);

            // Step 6: Upload all textures
            this.updateStatus('Uploading to GPU...');
            this.renderer.loadLayers({
                image: this.originalImage,
                depth: layers.foreground,
                imageBG: inpaintedBG,
                depthBG: layers.background,
                mask: layers.mask
            });

            this.updateStatus('Done! Drag to move camera.');

        } catch (err) {
            console.error('Layer processing failed:', err);
            this.updateStatus('Layer processing failed: ' + err.message);
        }
    }

    setupInputHandlers() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.isMouseDown = true;
            this.lastMousePos = { x: e.clientX, y: e.clientY };
        });

        window.addEventListener('mouseup', () => {
            this.isMouseDown = false;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isMouseDown) return;

            const dx = (e.clientX - this.lastMousePos.x) / this.canvas.clientWidth;
            const dy = (e.clientY - this.lastMousePos.y) / this.canvas.clientHeight;

            this.state._targetOffsetX += dx * 2;
            this.state._targetOffsetY -= dy * 2;

            this.state._targetOffsetX = Math.max(-1, Math.min(1, this.state._targetOffsetX));
            this.state._targetOffsetY = Math.max(-1, Math.min(1, this.state._targetOffsetY));

            this.lastMousePos = { x: e.clientX, y: e.clientY };
        });

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                this.isMouseDown = true;
                this.lastMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        });

        window.addEventListener('touchend', () => {
            this.isMouseDown = false;
        });

        window.addEventListener('touchmove', (e) => {
            if (!this.isMouseDown || e.touches.length !== 1) return;

            const dx = (e.touches[0].clientX - this.lastMousePos.x) / this.canvas.clientWidth;
            const dy = (e.touches[0].clientY - this.lastMousePos.y) / this.canvas.clientHeight;

            this.state._targetOffsetX += dx * 2;
            this.state._targetOffsetY -= dy * 2;

            this.state._targetOffsetX = Math.max(-1, Math.min(1, this.state._targetOffsetX));
            this.state._targetOffsetY = Math.max(-1, Math.min(1, this.state._targetOffsetY));

            this.lastMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        });

        this.canvas.addEventListener('dblclick', () => {
            this.state._targetOffsetX = 0;
            this.state._targetOffsetY = 0;
        });
    }

    setupFileHandlers() {
        const imageInput = document.getElementById('imageInput');
        const depthInput = document.getElementById('depthInput');
        const dropZone = document.getElementById('dropZone');
        const loadModelsBtn = document.getElementById('loadModelsBtn');
        const processBtn = document.getElementById('processBtn');

        loadModelsBtn?.addEventListener('click', () => this.loadModels());
        processBtn?.addEventListener('click', () => this.processLayers());

        imageInput?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                if (this.modelsLoaded) {
                    await this.processImage(file);
                } else {
                    await this.loadImageOnly(file);
                }
            }
        });

        depthInput?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.loadDepth(file);
            }
        });

        if (dropZone) {
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
            });

            dropZone.addEventListener('dragover', () => {
                dropZone.classList.add('dragover');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('dragover');
            });

            dropZone.addEventListener('drop', async (e) => {
                dropZone.classList.remove('dragover');
                const files = Array.from(e.dataTransfer.files);

                for (const file of files) {
                    const name = file.name.toLowerCase();
                    if (name.includes('depth') || name.includes('_d.') || name.includes('-d.')) {
                        await this.loadDepth(file);
                    } else {
                        if (this.modelsLoaded) {
                            await this.processImage(file);
                        } else {
                            await this.loadImageOnly(file);
                        }
                    }
                }
            });
        }
    }

    async loadImageOnly(file) {
        try {
            this.originalImage = await this.loadImageAsCanvas(file);
            this.renderer.imageAspect = this.originalImage.width / this.originalImage.height;
            this.renderer.uploadTexture('image', this.originalImage);
            this.updateStatus(`Image loaded: ${this.originalImage.width}x${this.originalImage.height}. Load depth map or click "Load Models" for AI processing.`);
        } catch (err) {
            console.error('Failed to load image:', err);
            this.updateStatus('Failed to load image');
        }
    }

    async loadDepth(file) {
        try {
            const img = await createImageBitmap(file);
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            this.depthMap = canvas.getContext('2d').getImageData(0, 0, img.width, img.height);

            this.renderer.loadDepthFromImageData(this.depthMap);
            this.updateStatus('Depth map loaded. Click "Re-process Layers" to run inpainting.');
        } catch (err) {
            console.error('Failed to load depth:', err);
            this.updateStatus('Failed to load depth map');
        }
    }

    loadImageAsCanvas(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
                resolve(canvas);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    updateStatus(msg) {
        const status = document.getElementById('status');
        if (status) {
            status.textContent = msg;
        }
        console.log('[Status]', msg);
    }

    startRenderLoop() {
        const loop = () => {
            this.state.update();
            this.renderer.render();
            requestAnimationFrame(loop);
        };
        loop();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const app = new TwoLayerDepthDemo();
    app.init();
});
