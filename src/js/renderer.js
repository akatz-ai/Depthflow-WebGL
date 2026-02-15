export class Renderer {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.gl = null;
        this.program = null;
        this.uniforms = {};
        this.textures = { image: null, depth: null };
        this.imageAspect = 1.0;

        // Store original depth for edge fix processing
        this.originalDepth = null;
        this.lastEdgeFix = -1;
        this.dpr = 1;
    }

    async init() {
        this.gl = this.canvas.getContext('webgl2', {
            antialias: false,
            alpha: false,
            preserveDrawingBuffer: false
        });

        if (!this.gl) {
            throw new Error('WebGL 2.0 not supported');
        }

        const [vertSrc, fragSrc] = await Promise.all([
            fetch('src/shaders/vertex.glsl').then(r => r.text()),
            fetch('src/shaders/fragment.glsl').then(r => r.text())
        ]);

        this.program = this.createProgram(vertSrc, fragSrc);
        this.gl.useProgram(this.program);
        this.gl.clearColor(0, 0, 0, 1);

        this.cacheUniformLocations();
        this.createQuad();
        this.createPlaceholderTextures();

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    createProgram(vertSrc, fragSrc) {
        const gl = this.gl;

        const vertShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertShader, vertSrc);
        gl.compileShader(vertShader);
        if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
            throw new Error('Vertex shader error: ' + gl.getShaderInfoLog(vertShader));
        }

        const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragShader, fragSrc);
        gl.compileShader(fragShader);
        if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
            throw new Error('Fragment shader error: ' + gl.getShaderInfoLog(fragShader));
        }

        const program = gl.createProgram();
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
        }

        return program;
    }

    cacheUniformLocations() {
        const gl = this.gl;
        const names = [
            'uImage', 'uDepth', 'uResolution', 'uImageAspect',
            'uHeight', 'uSteady', 'uFocus', 'uZoom', 'uIsometric',
            'uDolly', 'uInvert', 'uMirror', 'uQuality',
            'uOffset', 'uCenter', 'uOrigin', 'uSSAA'
        ];

        for (const name of names) {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
    }

    createQuad() {
        const gl = this.gl;

        // Fullscreen triangle (more efficient than quad)
        const vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(this.program, 'aPosition');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    createPlaceholderTextures() {
        const gl = this.gl;
        const placeholder = new Uint8Array([128, 128, 128, 255]);

        for (const key of ['image', 'depth']) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, placeholder);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            this.textures[key] = tex;
        }
    }

    async loadImage(blob) {
        const img = await createImageBitmap(blob);
        this.imageAspect = img.width / img.height;
        this.uploadTexture('image', img);
        return { width: img.width, height: img.height };
    }

    async loadDepth(blob) {
        const img = await createImageBitmap(blob);

        // Convert to ImageData for storage and processing
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        this.originalDepth = ctx.getImageData(0, 0, img.width, img.height);
        this.lastEdgeFix = -1;  // Force reprocess

        this.applyEdgeFix();
    }

    loadDepthFromImageData(imageData) {
        // Store original for edge fix processing
        this.originalDepth = imageData;
        this.lastEdgeFix = -1;  // Force reprocess

        this.applyEdgeFix();
    }

    // Apply morphological dilation to depth map (CPU-side edge fix)
    applyEdgeFix() {
        if (!this.originalDepth) return;

        const edgeFix = this.state.edgeFix;
        if (edgeFix === this.lastEdgeFix) return;
        this.lastEdgeFix = edgeFix;

        const { width, height, data } = this.originalDepth;

        if (edgeFix <= 0) {
            this.uploadDepthTexture(this.originalDepth);
            return;
        }

        const radius = Math.ceil(edgeFix * 10);

        // Extract single-channel depth values
        const src = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            src[i] = data[i * 4];
        }

        // Pass 1: Horizontal max
        const temp = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            const row = y * width;
            for (let x = 0; x < width; x++) {
                let maxVal = 0;
                const x0 = Math.max(0, x - radius);
                const x1 = Math.min(width - 1, x + radius);
                for (let kx = x0; kx <= x1; kx++) {
                    const v = src[row + kx];
                    if (v > maxVal) maxVal = v;
                }
                temp[row + x] = maxVal;
            }
        }

        // Pass 2: Vertical max
        const dst = new Uint8Array(width * height);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                let maxVal = 0;
                const y0 = Math.max(0, y - radius);
                const y1 = Math.min(height - 1, y + radius);
                for (let ky = y0; ky <= y1; ky++) {
                    const v = temp[ky * width + x];
                    if (v > maxVal) maxVal = v;
                }
                dst[y * width + x] = maxVal;
            }
        }

        // Write back to RGBA ImageData
        const output = new ImageData(width, height);
        for (let i = 0; i < width * height; i++) {
            const v = dst[i];
            const idx = i * 4;
            output.data[idx] = v;
            output.data[idx + 1] = v;
            output.data[idx + 2] = v;
            output.data[idx + 3] = 255;
        }

        this.uploadDepthTexture(output);
    }

    uploadDepthTexture(imageData) {
        const gl = this.gl;

        if (this.textures.depth) {
            gl.deleteTexture(this.textures.depth);
        }

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.textures.depth = tex;
    }

    uploadTexture(name, image) {
        const gl = this.gl;

        if (this.textures[name]) {
            gl.deleteTexture(this.textures[name]);
        }

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.textures[name] = tex;
    }

    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.dpr = dpr;
        const width = this.canvas.clientWidth * dpr;
        const height = this.canvas.clientHeight * dpr;

        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }

    render() {
        const gl = this.gl;
        const s = this.state;

        gl.clear(gl.COLOR_BUFFER_BIT);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.image);
        gl.uniform1i(this.uniforms.uImage, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.depth);
        gl.uniform1i(this.uniforms.uDepth, 1);

        // Set uniforms
        gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.uImageAspect, this.imageAspect);

        gl.uniform1f(this.uniforms.uHeight, s.height);
        gl.uniform1f(this.uniforms.uSteady, s.steady);
        gl.uniform1f(this.uniforms.uFocus, s.focus);
        gl.uniform1f(this.uniforms.uZoom, s.zoom);
        gl.uniform1f(this.uniforms.uIsometric, s.isometric);
        gl.uniform1f(this.uniforms.uDolly, s.dolly);
        gl.uniform1f(this.uniforms.uInvert, s.invert);
        gl.uniform1i(this.uniforms.uMirror, s.mirror ? 1 : 0);
        gl.uniform1f(this.uniforms.uQuality, s.quality);
        const effectiveSSAA = (s.quality > 0.7 || this.dpr > 1) ? 1.0 : s.ssaa;
        gl.uniform1f(this.uniforms.uSSAA, effectiveSSAA);

        // Check if edge fix needs to be reapplied
        this.applyEdgeFix();

        gl.uniform2f(this.uniforms.uOffset, s.offsetX, s.offsetY);
        gl.uniform2f(this.uniforms.uCenter, s.centerX, s.centerY);
        gl.uniform2f(this.uniforms.uOrigin, s.originX, s.originY);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
}
