# DepthFlow WebGL

A WebGL-based parallax depth effect renderer, porting the core functionality of [DepthFlow](https://github.com/BrokenSource/DepthFlow) to the web.

## Features

- Upload any image + depth map pair
- Real-time parallax effect with mouse/touch interaction
- Adjustable parameters (height, isometric, zoom, etc.)
- No build step required - pure vanilla JS

## Quick Start

1. Serve the directory with any static file server:
   ```bash
   # Python
   python -m http.server 8000

   # Node.js
   npx serve .

   # PHP
   php -S localhost:8000
   ```

2. Open `http://localhost:8000` in your browser

3. Upload an image and its corresponding depth map

4. Click and drag to move the camera around

## Project Structure

```
├── index.html              # Main page
├── src/
│   ├── js/                 # JavaScript modules
│   ├── shaders/            # GLSL shaders
│   └── css/                # Styling
├── assets/                 # Sample images
└── docs/                   # Documentation
```

## Documentation

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for comprehensive technical documentation including:

- Algorithm deep-dive
- Shader implementation details
- Coordinate system explanations
- Complete code structure

## Requirements

- WebGL 2.0 compatible browser
- ES6 module support

## Credits

Based on [DepthFlow](https://github.com/BrokenSource/DepthFlow) by Tremeschin (CC BY-SA 4.0 / AGPL-3.0)

## License

Shader code: CC BY-SA 4.0
Application code: MIT
