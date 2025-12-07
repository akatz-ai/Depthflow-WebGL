import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.mjs';

const LAMA_URL = 'https://huggingface.co/g-ronimo/lama/resolve/main/lama_fp32.onnx';
const INPAINT_SIZE = 512;

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';

export class Inpainter {
    constructor() {
        this.modelBuffer = null;
        this.session = null;
        this.device = null;
    }

    async downloadModel(onProgress) {
        const root = await navigator.storage.getDirectory();
        const filename = 'lama_fp32.onnx';

        try {
            const fileHandle = await root.getFileHandle(filename);
            const file = await fileHandle.getFile();
            if (file.size > 0) {
                onProgress?.({ status: 'cached', progress: 100 });
                this.modelBuffer = await file.arrayBuffer();
                return;
            }
        } catch (e) {
            // File doesn't exist, download it
        }

        onProgress?.({ status: 'downloading', progress: 0 });

        const response = await fetch(LAMA_URL, { mode: 'cors' });
        const reader = response.body.getReader();
        const contentLength = +response.headers.get('Content-Length');

        let receivedLength = 0;
        const chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedLength += value.length;

            onProgress?.({
                status: 'downloading',
                progress: Math.round((receivedLength / contentLength) * 100)
            });
        }

        // Combine chunks
        const buffer = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
            buffer.set(chunk, position);
            position += chunk.length;
        }
        this.modelBuffer = buffer.buffer;

        // Cache for future use
        try {
            const fileHandle = await root.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(this.modelBuffer);
            await writable.close();
        } catch (e) {
            console.warn('Failed to cache model:', e);
        }

        onProgress?.({ status: 'cached', progress: 100 });
    }

    async createSession() {
        // Try CPU first - WebGPU has compatibility issues with LaMa model on some browsers
        for (const ep of ['cpu', 'webgpu']) {
            try {
                this.session = await ort.InferenceSession.create(
                    this.modelBuffer,
                    { executionProviders: [ep] }
                );
                this.device = ep;
                console.log(`LaMa loaded on ${ep}`);
                return { success: true, device: ep };
            } catch (e) {
                console.warn(`Failed to load on ${ep}:`, e);
            }
        }
        return { success: false, device: null };
    }

    async inpaint(imageCanvas, maskCanvas) {
        const resizedImage = resizeCanvas(imageCanvas, INPAINT_SIZE, INPAINT_SIZE);
        const resizedMask = resizeCanvas(maskCanvas, INPAINT_SIZE, INPAINT_SIZE);

        const imageTensor = canvasToImageTensor(resizedImage);
        const maskTensor = canvasToMaskTensor(resizedMask);

        console.log('Image tensor shape:', imageTensor.dims);
        console.log('Mask tensor shape:', maskTensor.dims);

        let results;
        try {
            results = await this.session.run({
                image: imageTensor,
                mask: maskTensor
            });
        } catch (e) {
            // If WebGPU fails, fall back to CPU
            if (this.device === 'webgpu') {
                console.warn('WebGPU inference failed, falling back to CPU:', e.message);
                this.session = await ort.InferenceSession.create(
                    this.modelBuffer,
                    { executionProviders: ['cpu'] }
                );
                this.device = 'cpu';
                results = await this.session.run({
                    image: imageTensor,
                    mask: maskTensor
                });
            } else {
                throw e;
            }
        }

        console.log('Output tensor shape:', results.output.dims);
        const outputCanvas = tensorToCanvas(results.output);
        return resizeCanvas(outputCanvas, imageCanvas.width, imageCanvas.height);
    }
}

function resizeCanvas(canvas, width, height) {
    const resized = document.createElement('canvas');
    resized.width = width;
    resized.height = height;
    resized.getContext('2d').drawImage(canvas, 0, 0, width, height);
    return resized;
}

// LaMa uses shape [batch, channels, width, height] - note width before height!
function canvasToImageTensor(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    // Shape: [1, 3, width, height] per LaMa convention
    const float32 = new Float32Array(3 * width * height);
    const stride = width * height;

    for (let i = 0; i < width * height; i++) {
        float32[i] = data[i * 4] / 255.0;
        float32[i + stride] = data[i * 4 + 1] / 255.0;
        float32[i + stride * 2] = data[i * 4 + 2] / 255.0;
    }

    return new ort.Tensor('float32', float32, [1, 3, width, height]);
}

function canvasToMaskTensor(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    // Shape: [1, 1, width, height] per LaMa convention
    const float32 = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
        const rgb = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2];
        float32[i] = rgb > 0 ? 1.0 : 0.0;
    }

    return new ort.Tensor('float32', float32, [1, 1, width, height]);
}

function tensorToCanvas(tensor) {
    // Output is [batch, channels, width, height]
    const [, , width, height] = tensor.dims;
    const data = tensor.cpuData;
    const stride = width * height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const imageData = ctx.createImageData(width, height);

    for (let i = 0; i < width * height; i++) {
        imageData.data[i * 4] = Math.round(data[i]);
        imageData.data[i * 4 + 1] = Math.round(data[i + stride]);
        imageData.data[i * 4 + 2] = Math.round(data[i + stride * 2]);
        imageData.data[i * 4 + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
}
