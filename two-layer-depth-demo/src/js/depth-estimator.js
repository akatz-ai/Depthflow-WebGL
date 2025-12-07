import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

export class DepthEstimator {
    constructor() {
        this.model = null;
        this.loading = false;
    }

    async init(onProgress) {
        if (this.model || this.loading) return;
        this.loading = true;

        this.model = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
            device: 'webgpu',
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

    toCanvas(depthImage) {
        const imageData = this.toImageData(depthImage);
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        canvas.getContext('2d').putImageData(imageData, 0, 0);
        return canvas;
    }
}
