/**
 * Two-Layer Depth Processor
 *
 * Creates a background depth layer by detecting foreground objects
 * and inpainting the depth values underneath them using a push-pull algorithm.
 *
 * This enables proper parallax rendering without edge stretching artifacts.
 */

export class DepthProcessor {
    constructor() {
        this.foregroundThreshold = 0.4;
        this.edgeDilation = 5;
        this.gradientThreshold = 0.15;
    }

    /**
     * Process depth map to create two layers
     * @param {ImageData} depthImageData - Original depth map
     * @returns {Object} { foreground: ImageData, background: ImageData, mask: ImageData }
     */
    process(depthImageData) {
        const { width, height, data } = depthImageData;

        // Extract depth as float array (0-1)
        const depth = new Float32Array(width * height);
        for (let i = 0; i < depth.length; i++) {
            depth[i] = data[i * 4] / 255.0;
        }

        // Step 1: Create foreground mask with edge detection
        const mask = this.createForegroundMask(depth, width, height);

        // Step 2: Dilate mask to ensure we cover edge artifacts
        const dilatedMask = this.dilateMask(mask, width, height, this.edgeDilation);

        // Step 3: Create background layer via push-pull inpainting
        const backgroundDepth = this.inpaintBackground(depth, dilatedMask, width, height);

        // Step 4: Convert back to ImageData
        const foregroundImageData = this.floatToImageData(depth, width, height);
        const backgroundImageData = this.floatToImageData(backgroundDepth, width, height);
        const maskImageData = this.maskToImageData(dilatedMask, width, height);

        return {
            foreground: foregroundImageData,
            background: backgroundImageData,
            mask: maskImageData
        };
    }

    /**
     * Create foreground mask based on depth threshold and gradient analysis
     */
    createForegroundMask(depth, width, height) {
        const mask = new Uint8Array(width * height);

        // First pass: threshold-based detection
        for (let i = 0; i < depth.length; i++) {
            mask[i] = depth[i] > this.foregroundThreshold ? 1 : 0;
        }

        // Second pass: detect high-gradient edges and mark them as foreground
        // This catches silhouette edges where stretching would occur
        const gradientThreshold = 0.15;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const d = depth[idx];

                // Compute gradient magnitude using Sobel-like operator
                const dx = Math.abs(depth[idx + 1] - depth[idx - 1]) / 2;
                const dy = Math.abs(depth[idx + width] - depth[idx - width]) / 2;
                const gradient = Math.sqrt(dx * dx + dy * dy);

                // If high gradient AND on the foreground side, mark as foreground
                if (gradient > gradientThreshold && d > this.foregroundThreshold * 0.7) {
                    mask[idx] = 1;
                }
            }
        }

        return mask;
    }

    /**
     * Dilate the foreground mask to ensure edges are covered
     */
    dilateMask(mask, width, height, radius) {
        if (radius <= 0) return mask;

        const output = new Uint8Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                let found = false;

                // Check circular kernel
                for (let ky = -radius; ky <= radius && !found; ky++) {
                    for (let kx = -radius; kx <= radius && !found; kx++) {
                        if (kx * kx + ky * ky <= radius * radius) {
                            const sx = Math.min(Math.max(x + kx, 0), width - 1);
                            const sy = Math.min(Math.max(y + ky, 0), height - 1);
                            if (mask[sy * width + sx] === 1) {
                                found = true;
                            }
                        }
                    }
                }

                output[idx] = found ? 1 : 0;
            }
        }

        return output;
    }

    /**
     * Inpaint background depth using push-pull algorithm
     * This fills in foreground regions with estimated background depth
     */
    inpaintBackground(depth, mask, width, height) {
        // Create output initialized with original depth where not masked
        const output = new Float32Array(width * height);
        const valid = new Uint8Array(width * height);  // Track which pixels have valid data

        for (let i = 0; i < depth.length; i++) {
            if (mask[i] === 0) {
                // Background pixel - keep original depth
                output[i] = depth[i];
                valid[i] = 1;
            } else {
                // Foreground pixel - needs inpainting
                output[i] = 0;
                valid[i] = 0;
            }
        }

        // Push-Pull Algorithm
        // Phase 1 (Push): Build mipmap pyramid, averaging only valid pixels
        const pyramid = this.buildPyramid(output, valid, width, height);

        // Phase 2 (Pull): Reconstruct from coarse to fine, filling holes
        const result = this.reconstructFromPyramid(pyramid, mask, width, height);

        return result;
    }

    /**
     * Build a mipmap pyramid with validity tracking
     */
    buildPyramid(data, valid, width, height) {
        const levels = [];
        levels.push({ data: data.slice(), valid: valid.slice(), width, height });

        let w = width;
        let h = height;
        let currentData = data;
        let currentValid = valid;

        // Build pyramid until smallest dimension is 1
        while (w > 1 || h > 1) {
            const newW = Math.max(1, Math.floor(w / 2));
            const newH = Math.max(1, Math.floor(h / 2));
            const newData = new Float32Array(newW * newH);
            const newValid = new Uint8Array(newW * newH);

            for (let y = 0; y < newH; y++) {
                for (let x = 0; x < newW; x++) {
                    const dstIdx = y * newW + x;

                    // Sample 2x2 block from previous level
                    let sum = 0;
                    let count = 0;

                    for (let dy = 0; dy < 2; dy++) {
                        for (let dx = 0; dx < 2; dx++) {
                            const sx = Math.min(x * 2 + dx, w - 1);
                            const sy = Math.min(y * 2 + dy, h - 1);
                            const srcIdx = sy * w + sx;

                            if (currentValid[srcIdx]) {
                                sum += currentData[srcIdx];
                                count++;
                            }
                        }
                    }

                    if (count > 0) {
                        newData[dstIdx] = sum / count;
                        newValid[dstIdx] = 1;
                    } else {
                        newData[dstIdx] = 0;
                        newValid[dstIdx] = 0;
                    }
                }
            }

            levels.push({ data: newData, valid: newValid, width: newW, height: newH });
            w = newW;
            h = newH;
            currentData = newData;
            currentValid = newValid;
        }

        return levels;
    }

    /**
     * Reconstruct image from pyramid, filling holes with interpolated values
     */
    reconstructFromPyramid(pyramid, originalMask, targetWidth, targetHeight) {
        // Start from coarsest level
        let currentLevel = pyramid.length - 1;
        let result = pyramid[currentLevel].data.slice();
        let resultValid = pyramid[currentLevel].valid.slice();
        let w = pyramid[currentLevel].width;
        let h = pyramid[currentLevel].height;

        // Pull phase: upsample and fill
        while (currentLevel > 0) {
            currentLevel--;
            const nextLevel = pyramid[currentLevel];
            const newW = nextLevel.width;
            const newH = nextLevel.height;
            const newResult = new Float32Array(newW * newH);
            const newValid = new Uint8Array(newW * newH);

            for (let y = 0; y < newH; y++) {
                for (let x = 0; x < newW; x++) {
                    const dstIdx = y * newW + x;

                    // If original level had valid data, use it
                    if (nextLevel.valid[dstIdx]) {
                        newResult[dstIdx] = nextLevel.data[dstIdx];
                        newValid[dstIdx] = 1;
                    } else {
                        // Interpolate from coarser level
                        const sx = Math.min(Math.floor(x / 2), w - 1);
                        const sy = Math.min(Math.floor(y / 2), h - 1);
                        const srcIdx = sy * w + sx;

                        if (resultValid[srcIdx]) {
                            newResult[dstIdx] = result[srcIdx];
                            newValid[dstIdx] = 1;
                        }
                    }
                }
            }

            result = newResult;
            resultValid = newValid;
            w = newW;
            h = newH;
        }

        // Final smoothing pass for masked regions to reduce blockiness
        const smoothed = this.smoothMaskedRegions(result, originalMask, targetWidth, targetHeight);

        return smoothed;
    }

    /**
     * Smooth the inpainted regions to reduce blocky artifacts
     */
    smoothMaskedRegions(data, mask, width, height) {
        const output = data.slice();
        const kernelSize = 2;

        // Multiple passes for smoother result
        for (let pass = 0; pass < 3; pass++) {
            const temp = output.slice();

            for (let y = kernelSize; y < height - kernelSize; y++) {
                for (let x = kernelSize; x < width - kernelSize; x++) {
                    const idx = y * width + x;

                    // Only smooth within masked (inpainted) regions
                    if (mask[idx] === 0) continue;

                    let sum = 0;
                    let count = 0;

                    for (let ky = -kernelSize; ky <= kernelSize; ky++) {
                        for (let kx = -kernelSize; kx <= kernelSize; kx++) {
                            const sidx = (y + ky) * width + (x + kx);
                            sum += temp[sidx];
                            count++;
                        }
                    }

                    output[idx] = sum / count;
                }
            }
        }

        return output;
    }

    /**
     * Convert float array to ImageData (grayscale)
     */
    floatToImageData(data, width, height) {
        const imageData = new ImageData(width, height);
        for (let i = 0; i < data.length; i++) {
            const val = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
            imageData.data[i * 4] = val;
            imageData.data[i * 4 + 1] = val;
            imageData.data[i * 4 + 2] = val;
            imageData.data[i * 4 + 3] = 255;
        }
        return imageData;
    }

    /**
     * Convert mask to ImageData for visualization
     */
    maskToImageData(mask, width, height) {
        const imageData = new ImageData(width, height);
        for (let i = 0; i < mask.length; i++) {
            const val = mask[i] * 255;
            imageData.data[i * 4] = val;
            imageData.data[i * 4 + 1] = 0;
            imageData.data[i * 4 + 2] = 0;
            imageData.data[i * 4 + 3] = 255;
        }
        return imageData;
    }

    /**
     * Set foreground detection threshold
     */
    setThreshold(threshold) {
        this.foregroundThreshold = Math.max(0.1, Math.min(0.9, threshold));
    }

    /**
     * Set edge dilation radius
     */
    setDilation(radius) {
        this.edgeDilation = Math.max(0, Math.min(20, Math.round(radius)));
    }

    /**
     * Get mask as canvas for LaMa inpainting
     */
    getMaskCanvas(depthImageData) {
        const { width, height, data } = depthImageData;

        const depth = new Float32Array(width * height);
        for (let i = 0; i < depth.length; i++) {
            depth[i] = data[i * 4] / 255.0;
        }

        const mask = this.createForegroundMask(depth, width, height);
        const dilatedMask = this.dilateMask(mask, width, height, this.edgeDilation);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);

        for (let i = 0; i < dilatedMask.length; i++) {
            const val = dilatedMask[i] * 255;
            imageData.data[i * 4] = val;
            imageData.data[i * 4 + 1] = val;
            imageData.data[i * 4 + 2] = val;
            imageData.data[i * 4 + 3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Create masked image with foreground zeroed out for LaMa
     */
    createMaskedImage(imageCanvas, maskCanvas) {
        const { width, height } = maskCanvas;

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = width;
        outputCanvas.height = height;
        const ctx = outputCanvas.getContext('2d');

        ctx.drawImage(imageCanvas, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);

        const maskCtx = maskCanvas.getContext('2d');
        const maskData = maskCtx.getImageData(0, 0, width, height);

        for (let i = 0; i < width * height; i++) {
            if (maskData.data[i * 4] > 127) {
                imageData.data[i * 4] = 0;
                imageData.data[i * 4 + 1] = 0;
                imageData.data[i * 4 + 2] = 0;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return outputCanvas;
    }
}
