import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

export class DepthEstimator {
    constructor() {
        this.model = null;
        this.loading = false;
    }

    async init(onProgress) {
        if (this.model || this.loading) return;
        this.loading = true;

        try {
            // Try WebGPU first — navigator.gpu may exist but adapter creation can still fail
            if (navigator.gpu) {
                const adapter = await navigator.gpu.requestAdapter();
                if (adapter) {
                    this.model = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
                        device: 'webgpu',
                        progress_callback: onProgress
                    });
                    this.loading = false;
                    return;
                }
            }
        } catch (e) {
            console.warn('WebGPU init failed, falling back to WASM:', e.message);
        }

        // Fallback to WASM
        this.model = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
            device: 'wasm',
            progress_callback: onProgress
        });

        this.loading = false;
    }

    async estimate(imageSource) {
        if (!this.model) throw new Error('Model not initialized');
        const result = await this.model(imageSource);
        return result.depth;
    }

    toImageData(depthImage) {
        const { width, height, data } = depthImage;
        const imageData = new ImageData(width, height);

        for (let i = 0; i < data.length; i++) {
            const val = data[i];
            imageData.data[i * 4] = val;
            imageData.data[i * 4 + 1] = val;
            imageData.data[i * 4 + 2] = val;
            imageData.data[i * 4 + 3] = 255;
        }

        return imageData;
    }
}
