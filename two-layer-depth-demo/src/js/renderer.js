import { DepthProcessor } from './depth-processor.js';

export class Renderer {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.gl = null;
        this.program = null;
        this.uniforms = {};
        this.textures = {
            image: null,
            depth: null,
            imageBG: null,
            depthBG: null,
            mask: null
        };
        this.imageAspect = 1.0;
        this.depthProcessor = new DepthProcessor();
        this.originalDepth = null;
        this.lastProcessParams = null;
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
            'uImage', 'uDepth', 'uImageBG', 'uDepthBG', 'uMask',
            'uResolution', 'uImageAspect',
            'uHeight', 'uSteady', 'uFocus', 'uZoom', 'uIsometric',
            'uDolly', 'uInvert', 'uMirror', 'uQuality',
            'uLayerBlend', 'uSteepnessLimit', 'uBlendSoftness', 'uVisualization',
            'uOffset', 'uCenter', 'uOrigin'
        ];

        for (const name of names) {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
    }

    createQuad() {
        const gl = this.gl;
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

        for (const key of ['image', 'depth', 'imageBG', 'depthBG', 'mask']) {
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

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        this.originalDepth = ctx.getImageData(0, 0, img.width, img.height);

        this.processDepthLayers();
    }

    loadDepthFromImageData(imageData) {
        this.originalDepth = imageData;
        this.processDepthLayers();
    }

    processDepthLayers() {
        if (!this.originalDepth) return;

        this.depthProcessor.setThreshold(this.state.foregroundThreshold);
        this.depthProcessor.setDilation(this.state.maskDilation);

        const currentParams = `${this.state.foregroundThreshold}-${this.state.maskDilation}`;
        if (currentParams === this.lastProcessParams) return;
        this.lastProcessParams = currentParams;

        console.log('Processing depth layers...');
        const startTime = performance.now();

        const layers = this.depthProcessor.process(this.originalDepth);

        console.log(`Depth processing took ${(performance.now() - startTime).toFixed(0)}ms`);

        this.uploadImageDataTexture('depth', layers.foreground);
        this.uploadImageDataTexture('depthBG', layers.background);
        this.uploadImageDataTexture('mask', layers.mask);
    }

    loadLayers({ image, depth, imageBG, depthBG, mask }) {
        if (image) this.uploadTexture('image', image);
        if (depth) this.uploadImageDataTexture('depth', depth);
        if (imageBG) this.uploadTexture('imageBG', imageBG);
        if (depthBG) this.uploadImageDataTexture('depthBG', depthBG);
        if (mask) this.uploadImageDataTexture('mask', mask);
    }

    uploadImageDataTexture(name, imageData) {
        const gl = this.gl;

        if (this.textures[name]) {
            gl.deleteTexture(this.textures[name]);
        }

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.textures[name] = tex;
    }

    uploadTexture(name, source) {
        const gl = this.gl;

        if (this.textures[name]) {
            gl.deleteTexture(this.textures[name]);
        }

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.textures[name] = tex;
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const width = this.canvas.clientWidth * dpr;
        const height = this.canvas.clientHeight * dpr;

        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }

    render() {
        const gl = this.gl;
        const s = this.state;

        this.processDepthLayers();

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Bind all 5 textures
        const textureUnits = [
            ['image', 'uImage', 0],
            ['depth', 'uDepth', 1],
            ['imageBG', 'uImageBG', 2],
            ['depthBG', 'uDepthBG', 3],
            ['mask', 'uMask', 4]
        ];

        for (const [texName, uniformName, unit] of textureUnits) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, this.textures[texName]);
            gl.uniform1i(this.uniforms[uniformName], unit);
        }

        gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.uImageAspect, this.imageAspect);

        gl.uniform1f(this.uniforms.uHeight, s.height);
        gl.uniform1f(this.uniforms.uSteady, s.steady);
        gl.uniform1f(this.uniforms.uFocus, s.focus);
        gl.uniform1f(this.uniforms.uZoom, Math.pow(2, s.zoom / 100));
        gl.uniform1f(this.uniforms.uIsometric, s.isometric);
        gl.uniform1f(this.uniforms.uDolly, s.dolly);
        gl.uniform1f(this.uniforms.uInvert, s.invert);
        gl.uniform1i(this.uniforms.uMirror, s.mirror ? 1 : 0);
        gl.uniform1f(this.uniforms.uQuality, s.quality);

        gl.uniform1f(this.uniforms.uLayerBlend, s.layerBlend);
        gl.uniform1f(this.uniforms.uSteepnessLimit, s.steepnessLimit);
        gl.uniform1f(this.uniforms.uBlendSoftness, s.blendSoftness);
        gl.uniform1i(this.uniforms.uVisualization, s.visualization);

        gl.uniform2f(this.uniforms.uOffset, s.offsetX, s.offsetY);
        gl.uniform2f(this.uniforms.uCenter, s.centerX, s.centerY);
        gl.uniform2f(this.uniforms.uOrigin, s.originX, s.originY);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
}
