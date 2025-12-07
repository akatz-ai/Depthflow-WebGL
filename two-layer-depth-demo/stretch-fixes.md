 Deep Dive: DepthFlow Ray Marching Algorithm & Stretching Solutions

  How the Current Algorithm Works

  The Core Ray March (fragment.glsl:94-210)

  The algorithm is a displacement-based parallax occlusion mapping with ray
  marching. Here's the precise mechanism:

  1. Ray Setup (lines 105-127)
  rayOrigin = camPos + screenOffset×zoom×isometric - (0,0,dolly) + (origin,0)
  rayTarget = camPos + screenOffset×zoom + (0,0,focalLength)
  intersect = center + screenGluv - cameraXY/(1-relSteady)

  The ray travels from rayOrigin toward an intersect plane at z=1. The
  isometric parameter blends between:
  - Perspective (0): All rays originate from single camera point → strong
  parallax
  - Orthographic (1): Rays originate spread across screen → reduced parallax,
   less stretching

  2. Two-Pass March (lines 154-196)
  - Pass 1 (Coarse): Steps forward in 1/50 to 1/120 increments until the ray
  "penetrates" the depth surface (when ceiling < surface)
  - Pass 2 (Fine): Steps backward in 1/200 to 1/2000 increments until it
  exits, finding precise intersection

  3. The Surface Test
  float surface = uHeight * depth;  // Height field from depth map
  float ceiling = 1.0 - point.z;     // How far from base plane
  // Hit when ray goes "inside" the surface: ceiling < surface

  Current Edge Mitigation: Morphological Dilation (renderer.js:146-194)

  The edgeFix parameter applies circular morphological dilation to the depth
  map:
  - Takes max depth within a radius (0-10 pixels)
  - Expands foreground objects to fill gaps behind them

  Problem: This is isotropic—it expands equally in all directions, which:
  1. Over-expands in directions that don't need it
  2. Doesn't account for camera movement direction
  3. Creates "fuzzy" silhouettes

  ---
  The Root Cause of Stretching

  The stretching isn't a bug—it's a fundamental limitation of single-image 
  depth. The depth map only captures what the original camera saw. When you
  shift the virtual camera:

  Original View:          Shifted View:
      ████                     ████
      █FG█ ←foreground        █FG█
      ████                     ████
  ████████████            ████████████
  ██BACKGROUND██          ██BG█????██  ← What goes here?

  The "????" region was occluded in the original image. The depth map has no
  information there. Current behavior: the ray continues sampling from the
  foreground edge → stretching.

  ---
  Novel Solutions (Ranked by Potential Impact)

  🏆 1. View-Dependent Anisotropic Dilation (Most Practical)

  The key insight: we know which direction occlusion will appear based on
  uOffset.

  Algorithm:
  1. Compute dilation direction as normalize(-uOffset) (opposite of camera
  movement)
  2. Only dilate depth in that directional cone
  3. Dilation amount scales with |uOffset| and local depth gradient

  Why it's genius:
  - Fills gaps only where they'll appear
  - Doesn't over-expand silhouettes in non-problematic directions
  - Can be done in preprocessing (faster) or per-frame (adaptive)

  Shader modification concept:
  // In ray march, when near edge:
  vec2 dilationDir = -normalize(uOffset);
  vec2 sampleOffset = dilationDir * edgeFactor * depthGradientMagnitude;
  float dilatedDepth = texture(uDepth, gluv + sampleOffset).r;

  ---
  🏆 2. Depth Gradient Detection + Background Fallback

  During ray march, detect depth discontinuities and handle them specially:

  Algorithm:
  1. At each ray step, compute depth gradient: dDepth/dUV
  2. If gradient magnitude exceeds threshold → silhouette edge detected
  3. When crossing a silhouette from foreground→background:
    - Sample depth in perpendicular direction to edge
    - Use that "continuation" depth instead of edge-stretched value

  Implementation insight:
  vec2 grad = vec2(
      texture(uDepth, gluv + vec2(0.01,0)).r - texture(uDepth, gluv -
  vec2(0.01,0)).r,
      texture(uDepth, gluv + vec2(0,0.01)).r - texture(uDepth, gluv -
  vec2(0,0.01)).r
  );
  float gradMag = length(grad);
  if (gradMag > 0.3) { // Silhouette detected
      // Edge normal points toward lower depth (background)
      vec2 edgeNormal = normalize(grad);
      // Sample further into background
      float bgDepth = texture(uDepth, gluv + edgeNormal * 0.05).r;
      // Use bgDepth for continuation
  }

  ---
  🏆 3. Two-Layer Depth Synthesis (Preprocessing)

  Preprocess the depth map to create a "background layer":

  1. Detect foreground mask (depth > threshold or connected high-depth
  islands)
  2. Inpaint background depth under foreground:
    - Use Navier-Stokes inpainting or push-pull algorithm
    - Propagate surrounding background depth "under" the foreground
  3. Store as second texture or use high bits of depth

  During ray march:
  - First check foreground layer
  - If ray passes through foreground without hit, continue with background
  layer

  This essentially creates a Layered Depth Image (LDI) from a single depth
  map.

  ---
  4. Cone Marching / Stochastic Sampling

  Instead of single ray, sample a cone:

  // At each step, sample multiple nearby depths
  float depths[5];
  depths[0] = texture(uDepth, gluv).r;
  depths[1] = texture(uDepth, gluv + vec2(0.01,0)).r;
  // ... etc
  float maxDepth = max(max(depths[0], depths[1]), ...);
  // Use maxDepth at edges - naturally "looks around" foreground

  Variance analysis: If depth variance within cone is high → edge region. Use
   maximum (deepest) value to avoid foreground stretching.

  ---
  5. Soft Fade at Depth Discontinuities

  Rather than preventing stretching, make it invisible:

  1. Detect silhouette proximity during ray march
  2. Apply depth-dependent blur to color sampling:
  float blurRadius = silhouetteProximity * parallaxAmount * 0.05;
  vec4 color = blur(uImage, hitGluv, blurRadius);
  3. The blur masks the stretching artifact

  Enhancement: Fade to a tinted version of the background color sampled
  further from the edge, creating a convincing "atmosphere" effect.

  ---
  6. Foreground/Background Compositing

  Separate rendering:
  1. Create foreground mask from depth threshold
  2. Render foreground parallax at full quality
  3. Render background parallax separately
  4. Composite: foreground always on top, background fills gaps
  5. Add subtle ambient occlusion shadow at foreground base

  ---
  7. Depth-Guided Texture Extrapolation

  Smart continuation of the color texture:
  - At depth edges, extrapolate the background color in the direction of the
  camera offset
  - Use the actual color gradient at the edge to guide extrapolation
  - This creates plausible "guesses" for what's behind foreground

  ---
  Hybrid Solution: My Recommended Approach

  Combine #1 + #2 + #5 for a robust solution:

  1. Preprocessing: Apply view-dependent anisotropic dilation (computed
  on-demand or per-frame for the current uOffset)
  2. Shader modification: Add depth gradient analysis during ray march:
    - Detect edges
    - At edges, sample in direction of depth decrease (toward background)
    - Use background depth for continuation
  3. Fallback: Where all else fails, apply soft blur proportional to:
    - Distance from silhouette
    - Magnitude of camera offset
    - Local depth gradient

  ---
  Technical Feasibility Assessment

  | Approach                    | Complexity | Performance Impact    |
  Effectiveness               |
  |-----------------------------|------------|-----------------------|-------
  ----------------------|
  | View-dependent dilation     | Medium     | Low (preprocessing)   | High
                        |
  | Gradient detection/fallback | Medium     | Medium (more samples) | High
                        |
  | Two-layer depth             | High       | Low (texture fetch)   | Very
  High                   |
  | Cone marching               | Low        | High (5x samples)     | Medium
                        |
  | Soft fade                   | Low        | Low                   | Medium
   (masks, doesn't fix) |

  ---
  Key Parameters to Expose

  If implementing these solutions, new user controls could include:
  - Edge detection threshold (depth gradient sensitivity)
  - Background extrapolation distance
  - Silhouette blur amount
  - Adaptive dilation strength

  ---
  Would you like me to dive deeper into any of these approaches, or shall I
  sketch out shader code for the most promising solution (view-dependent
  anisotropic dilation + gradient-based background fallback)?