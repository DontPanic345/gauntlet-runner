// Post-processing for the frame (owned by `look`). Two scene passes and one full-screen pass,
// all at the internal resolution (display.width x display.height), so every effect lands on
// whole internal pixels and the CSS nearest-neighbour upscale keeps them crisp.
//
//   1. colour pass   every layer, into a half-float target (linear light)
//   2. edge pass     layer 0 only (see LAYER_NO_OUTLINE), view-space normals + depth
//   3. composite     outlines, crease highlights, torch glow, pit fog, vignette, colour
//                    grade, then quantise to the 32-colour palette with world-anchored
//                    ordered dithering. The screen only ever shows palette colours.
//
// Every tunable is in `postOptions`, and changes apply on the next frame.

import * as THREE from 'three';
import { PALETTE, NAMES } from './palette.js';

/** Objects on this layer are drawn but get no outline and cast no edge (particles, glows). */
export const LAYER_NO_OUTLINE = 1;

export const postOptions = {
  enabled: true,
  outline: true,       // 1-px outer outline on depth edges
  outlineColor: 'ink',
  outlineStrength: 0.88, // 0..1 mix toward outlineColor (1 = flat ink)
  outlineDepth: 0.2,   // world units: a neighbour this much nearer draws an outline
  crease: true,        // lighten convex edges between faces (normal edges)
  creaseStrength: 0.45,
  rim: 0.8,            // top silhouette edge lit (reads against dark floors); 0 = off
  rimColor: 'frost',
  quantize: true,      // snap every pixel to the palette
  dither: true,        // ordered dither between the two nearest palette colours
  ditherBand: 0.3,    // 0..0.5: how far from the midpoint between two colours dithering starts
  vignette: 0.55,      // 0 = off
  fog: true,           // pits and the void fade to fogColor below y = 0
  fogColor: 'night',
  fogDepth: 2.5,       // world units below the floor to fully fogged
  glow: 0.16,          // torch haze in screen space (0 = off)
  exposure: 1.0,
  shoulder: 0.75,      // soft highlight roll-off above this (linear); keeps lit surfaces from clipping to white
  shadowTint: 'violet', // lifted into the darkest tones, so shadow reads cool, not black
  shadowLift: 0.08,
  whiteHot: true,      // pixels lit to pure white (hit flashes) skip the shoulder and stay exact `white`
  impact: true,        // kill frame: a two-tone ink/white frame around a kill for ~3 frames (settings.flashes scales it)
};

// ---- palette LUT: 64^3 cells, each holding the nearest and second-nearest palette
// indices (OKLab distance) and how close the colour sits to the midpoint between them.
const LUT_N = 64;
// ember and flame are reserved for danger and fire (GAME.md): lit surfaces never
// quantise into them. Pixels that already are one of them (emissive voxels, fire
// particles) pass through untouched.
const RESERVED = ['ember', 'flame'];
const LUT_WL = 1.0, LUT_WC = 1.8;   // OKLab distance weights: lightness, chroma
const LUT_HUE_GAP = 0.07;           // max a/b distance between two colours that may dither together
const LUT_DARK = 0.3;               // no dithering where both colours are darker than this (OKLab L)

function srgbToOklab(r, g, b) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

function buildLut() {
  const cols = NAMES.map((n) => hexRgb(PALETTE[n]));
  const labs = cols.map(([r, g, b]) => srgbToOklab(r, g, b));
  const allowed = NAMES.map((n) => !RESERVED.includes(n));
  const W = LUT_N * 8, H = LUT_N * 8;
  const data = new Uint8Array(W * H * 4);
  for (let b = 0; b < LUT_N; b++) {
    const tx = (b % 8) * LUT_N, ty = Math.floor(b / 8) * LUT_N;
    for (let g = 0; g < LUT_N; g++) for (let r = 0; r < LUT_N; r++) {
      const [L, A, B] = srgbToOklab(r / (LUT_N - 1), g / (LUT_N - 1), b / (LUT_N - 1));
      let i1 = 0, i2 = 0, d1 = 1e9, d2 = 1e9;
      for (let i = 0; i < labs.length; i++) {
        if (!allowed[i]) continue;
        const p = labs[i];
        // hue errors read worse than value errors in pixel art: weight chroma up
        const dl = (L - p[0]) * LUT_WL, da = (A - p[1]) * LUT_WC, db = (B - p[2]) * LUT_WC;
        const d = Math.sqrt(dl * dl + da * da + db * db);
        if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i; } else if (d < d2) { d2 = d; i2 = i; }
      }
      // only dither between two colours of a similar hue (a ramp step), and not in the
      // deep darks: that is where checkerboards read as noise instead of shading
      const p1 = labs[i1], p2 = labs[i2];
      const hueGap = Math.hypot(p1[1] - p2[1], p1[2] - p2[2]);
      const ok = hueGap < LUT_HUE_GAP && Math.max(p1[0], p2[0]) > LUT_DARK;
      const o = ((ty + g) * W + tx + r) * 4;
      data[o] = i1; data[o + 1] = i2;
      data[o + 2] = ok ? Math.round((d1 / Math.max(1e-6, d1 + d2)) * 2 * 255) : 0; // 0 = on p1, 255 = midpoint
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const MAX_GLOWS = 8;

const vertexShader = /* glsl */`
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const fragmentShader = /* glsl */`
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tLut;
uniform vec3 palette[${NAMES.length}];
uniform vec3 reserved[${RESERVED.length}];
uniform vec2 resolution;
uniform vec2 ditherOrigin;
uniform float cameraNear, cameraFar;
uniform mat4 invViewProj;
uniform float outlineOn, outlineStrength, outlineDepth;
uniform vec3 outlineColor;
uniform float creaseOn, creaseStrength;
uniform float rimAmount;
uniform vec3 rimColor;
uniform float shoulder;
uniform float quantizeOn, ditherOn, ditherBand;
uniform float vignette;
uniform float fogOn, fogDepth;
uniform vec3 fogColor;
uniform float glowAmount;
uniform vec4 glowPos[${MAX_GLOWS}];   // xy = pixel position, z = radius px, w = strength
uniform vec3 glowColor[${MAX_GLOWS}];
uniform float exposure, shadowLift;
uniform vec3 shadowTint;
uniform float whiteHotOn;
uniform vec3 whiteCol;
uniform vec4 impact;        // xy = pixel centre, z = radius px, w = 0 off, else threshold scale
uniform vec3 impactHi, impactLo;

float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x) + int(q.y) * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float viewDepth(ivec2 p) {
  float d = texelFetch(tDepth, p, 0).r;
  return cameraNear + d * (cameraFar - cameraNear); // orthographic: depth buffer is linear
}
vec3 viewNormal(ivec2 p) { return texelFetch(tNormal, p, 0).xyz * 2.0 - 1.0; }

// crease (normal edge) test after t3ssel8r: only the convex side of a fold lights up
float creaseIndicator(vec3 n, vec3 nn, float depthDiff) {
  float normalDiff = dot(n - nn, vec3(1.0, 1.0, 1.0));
  float normalIndicator = clamp(smoothstep(-0.01, 0.01, normalDiff), 0.0, 1.0);
  float depthIndicator = clamp(sign(depthDiff * 0.25 + 0.0025), 0.0, 1.0);
  return (1.0 - dot(n, nn)) * depthIndicator * normalIndicator;
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  ivec2 maxP = ivec2(resolution) - 1;
  vec3 col = texelFetch(tColor, P, 0).rgb;
  bool hot = whiteHotOn > 0.5 && all(greaterThanEqual(col, vec3(0.985)));
  float rawDepth = texelFetch(tDepth, P, 0).r;
  float d = viewDepth(P);
  vec3 n = viewNormal(P);
  bool empty = rawDepth >= 1.0;

  // ---- outlines and creases
  float outer = 0.0, crease = 0.0;
  ivec2 offs[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
  float nearest = d;
  for (int k = 0; k < 4; k++) {
    ivec2 q = clamp(P + offs[k], ivec2(0), maxP);
    if (texelFetch(tDepth, q, 0).r >= 1.0) continue;
    float dq = viewDepth(q);
    if (d - dq > outlineDepth) { outer = 1.0; nearest = min(nearest, dq); }
    if (!empty) crease += creaseIndicator(n, viewNormal(q), dq - d);
  }

  // ---- world position of this pixel (for pit fog)
  vec4 ndc = vec4(vUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
  vec4 wp = invViewProj * ndc; wp /= wp.w;

  if (creaseOn > 0.5 && outer < 0.5 && !empty) col *= 1.0 + creaseStrength * step(0.2, crease);
  // rim: the top edge of a silhouette (the pixel above is much further away, or empty)
  if (rimAmount > 0.0 && !empty && outer < 0.5) {
    ivec2 up = clamp(P + ivec2(0, 1), ivec2(0), maxP);
    float ru = texelFetch(tDepth, up, 0).r;
    if (ru >= 1.0 || viewDepth(up) - d > outlineDepth * 2.0) col = col * (1.0 + rimAmount) + rimColor * rimAmount * 0.06;
  }
  if (fogOn > 0.5) col = mix(col, fogColor, smoothstep(0.0, -fogDepth, empty ? -1e3 : wp.y));

  // ---- torch haze: soft pools of warm air around lights, dithered by the quantise step
  vec2 px = gl_FragCoord.xy;
  for (int i = 0; i < ${MAX_GLOWS}; i++) {
    vec4 g = glowPos[i];
    if (g.w <= 0.0) continue;
    float r = length((px - g.xy) * vec2(1.0, 1.25)) / g.z;
    float k = max(0.0, 1.0 - r);
    col += glowColor[i] * (k * k * g.w * glowAmount);
  }

  // ---- vignette
  vec2 v = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
  // in three discrete rings, not a gradient: a smooth screen-fixed ramp would make the
  // world-anchored dither crawl at the edges while the camera pans
  if (!empty) col *= 1.0 - vignette * floor(smoothstep(0.5, 1.05, length(v)) * 3.0 + 0.5) / 3.0;

  if (outlineOn > 0.5 && outer > 0.5) col = mix(col, outlineColor, outlineStrength);

  col *= exposure;
  // soft shoulder: roll highlights off toward (not into) white, per channel
  vec3 over = max(col - shoulder, 0.0);
  col = min(col, vec3(shoulder)) + over / (1.0 + over / (1.0 - shoulder + 0.35));
  vec3 srgb = toSrgb(col);
  // cool lift in the darks so shadow reads blue-violet, never dead black
  float lum = dot(srgb, vec3(0.299, 0.587, 0.114));
  srgb += shadowTint * shadowLift * (1.0 - smoothstep(0.0, 0.35, lum));
  srgb = clamp(srgb, 0.0, 1.0);
  if (hot && outer < 0.5) srgb = whiteCol;

  // kill frame: inside the radius the world drops to two tones for a few frames
  if (impact.w > 0.0) {
    float ir = length((px - impact.xy) * vec2(1.0, 1.3));
    if (ir < impact.z) {
      float l = dot(srgb, vec3(0.299, 0.587, 0.114));
      bool edge = ir > impact.z - 2.0;
      fragColor = vec4(edge ? impactHi : (l > impact.w ? impactHi : impactLo), 1.0);
      return;
    }
  }

  if (quantizeOn < 0.5) { fragColor = vec4(srgb, 1.0); return; }

  // reserved fire colours pass through untouched (emissive voxels, fire particles)
  for (int i = 0; i < ${RESERVED.length}; i++) {
    if (all(lessThan(abs(srgb - reserved[i]), vec3(0.03)))) { fragColor = vec4(reserved[i], 1.0); return; }
  }
  ivec3 q = ivec3(srgb * ${LUT_N - 1}.0 + 0.5);
  ivec2 tc = ivec2((q.b % 8) * ${LUT_N} + q.r, (q.b / 8) * ${LUT_N} + q.g);
  vec4 L = texelFetch(tLut, tc, 0);
  int i1 = int(L.r * 255.0 + 0.5), i2 = int(L.g * 255.0 + 0.5);
  float t = L.b * 0.5; // 0 on the nearest colour, 0.5 at the midpoint
  float p = ditherOn > 0.5 ? clamp((t - ditherBand) / max(0.001, 0.5 - ditherBand), 0.0, 1.0) * 0.5 : 0.0;
  // world-anchored threshold: the pattern moves with the (texel-snapped) camera, so it never crawls
  int idx = bayer4(px + ditherOrigin) < p ? i2 : i1;
  fragColor = vec4(palette[idx], 1.0);
}`;

const srgbVec = (name) => new THREE.Vector3(...hexRgb(PALETTE[name]));
const linColor = (name) => new THREE.Color(PALETTE[name]); // THREE converts sRGB hex to linear

export function createPost(renderer) {
  const colorRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
  colorRT.texture.minFilter = colorRT.texture.magFilter = THREE.NearestFilter;
  const edgeRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: true });
  edgeRT.texture.minFilter = edgeRT.texture.magFilter = THREE.NearestFilter;
  edgeRT.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const normalMat = new THREE.MeshNormalMaterial();

  const glowPos = Array.from({ length: MAX_GLOWS }, () => new THREE.Vector4());
  const glowColor = Array.from({ length: MAX_GLOWS }, () => new THREE.Color());

  const uniforms = {
    tColor: { value: colorRT.texture },
    tNormal: { value: edgeRT.texture },
    tDepth: { value: edgeRT.depthTexture },
    tLut: { value: buildLut() },
    palette: { value: NAMES.map(srgbVec) },
    reserved: { value: RESERVED.map(srgbVec) },
    resolution: { value: new THREE.Vector2(1, 1) },
    ditherOrigin: { value: new THREE.Vector2() },
    cameraNear: { value: 0.1 }, cameraFar: { value: 200 },
    invViewProj: { value: new THREE.Matrix4() },
    outlineOn: { value: 1 }, outlineStrength: { value: 1 }, outlineDepth: { value: 0.2 },
    outlineColor: { value: new THREE.Color() },
    creaseOn: { value: 1 }, creaseStrength: { value: 0.4 },
    rimAmount: { value: 0.5 }, rimColor: { value: new THREE.Color() }, shoulder: { value: 0.75 },
    quantizeOn: { value: 1 }, ditherOn: { value: 1 }, ditherBand: { value: 0.2 },
    vignette: { value: 0.5 },
    fogOn: { value: 1 }, fogDepth: { value: 2.5 }, fogColor: { value: new THREE.Color() },
    glowAmount: { value: 0.2 }, glowPos: { value: glowPos }, glowColor: { value: glowColor },
    exposure: { value: 1 }, shadowLift: { value: 0.05 }, shadowTint: { value: new THREE.Vector3() },
    whiteHotOn: { value: 1 }, whiteCol: { value: srgbVec('white') },
    impact: { value: new THREE.Vector4() }, impactHi: { value: srgbVec('white') }, impactLo: { value: srgbVec('ink') },
  };
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: 'precision highp float;\nin vec3 position;\nin vec2 uv;\n' + vertexShader,
    fragmentShader,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vp = new THREE.Matrix4();
  const clear = new THREE.Color();

  return {
    uniforms,
    glowPos,
    glowColor,
    /**
     * Render scene through the post chain to the canvas.
     * @param {{x:number,y:number}} origin  camera position in whole internal pixels (dither anchor)
     */
    render(scene, camera, origin) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const w = size.x, h = size.y;
      if (colorRT.width !== w || colorRT.height !== h) {
        colorRT.setSize(w, h);
        edgeRT.setSize(w, h);
      }
      const o = postOptions;
      const U = uniforms;
      U.resolution.value.set(w, h);
      U.ditherOrigin.value.set(origin.x, origin.y);
      U.cameraNear.value = camera.near; U.cameraFar.value = camera.far;
      vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      U.invViewProj.value.copy(vp).invert();
      U.outlineOn.value = o.outline ? 1 : 0;
      U.outlineStrength.value = o.outlineStrength;
      U.outlineDepth.value = o.outlineDepth;
      U.outlineColor.value.copy(linColor(o.outlineColor));
      U.creaseOn.value = o.crease ? 1 : 0;
      U.creaseStrength.value = o.creaseStrength;
      U.rimAmount.value = o.rim;
      U.rimColor.value.copy(linColor(o.rimColor));
      U.shoulder.value = o.shoulder;
      U.quantizeOn.value = o.quantize ? 1 : 0;
      U.ditherOn.value = o.dither ? 1 : 0;
      U.ditherBand.value = o.ditherBand;
      U.vignette.value = o.vignette;
      U.fogOn.value = o.fog ? 1 : 0;
      U.fogDepth.value = o.fogDepth;
      U.fogColor.value.copy(linColor(o.fogColor));
      U.glowAmount.value = o.glow;
      U.exposure.value = o.exposure;
      U.shadowLift.value = o.shadowLift;
      U.shadowTint.value.copy(srgbVec(o.shadowTint));
      U.whiteHotOn.value = o.whiteHot ? 1 : 0;
      if (!o.impact) U.impact.value.w = 0;

      // 1. colour (all layers)
      const layers = camera.layers.mask;
      camera.layers.enableAll();
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(colorRT);
      renderer.render(scene, camera);

      // 2. normals + depth (layer 0 only, no background)
      camera.layers.set(0);
      const bg = scene.background;
      scene.background = null;
      renderer.getClearColor(clear);
      const ca = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      scene.overrideMaterial = normalMat;
      renderer.setRenderTarget(edgeRT);
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
      scene.background = bg;
      renderer.setClearColor(clear, ca);
      camera.layers.mask = layers;

      // 3. composite to the canvas
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCam);
    },
  };
}
