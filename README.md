# DepthFlow WebGL

In-browser depth-parallax renderer that generates depth maps locally and renders interactive 3D motion from a single image.

![Demo](assets/demo.png)

## Features

- Auto depth generation in-browser with Depth Anything V2
- Interactive 3D parallax rendering with displacement mapping
- Input controls for mouse, touch, and gyroscope motion
- Export to video (WebM/MP4 where supported) and GIF
- WebGPU acceleration for depth estimation with WASM fallback

## Quick Start

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd Depthflow-WebGL
   ```
2. Serve the project with any static server:
   ```bash
   # Node.js
   npx serve .

   # Python
   python -m http.server 8000
   ```
3. Open the served URL in your browser.

## Browser Support

- WebGL2 is required for rendering
- WebGPU is optional and used when available to accelerate depth estimation
- MediaRecorder is required for video export

## How It Works

1. Upload an image
2. Generate a depth map in-browser with Depth Anything V2
3. Render parallax by displacing pixels in a WebGL shader based on depth

## Credits

- [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2)
- [Transformers.js](https://github.com/huggingface/transformers.js)
- Original [DepthFlow](https://github.com/BrokenSource/DepthFlow) by Tremeschin

## License

AGPL-3.0
