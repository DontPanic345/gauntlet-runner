// VFX core (piece `vfx`): the one pooled particle and effect system. Everything that sparkles,
// puffs, bursts or rings in the game goes through here. Effects live in effects.js; this file
// is the machinery: three fixed pools drawn in three draw calls, stepped by the sim.
//
//   particles  up to CAP voxel particles in one InstancedMesh. Structure-of-arrays in typed
//              arrays, swap-remove on death: no allocation per frame, ever.
//              mode SPRITE  a camera-facing square, exactly n x n screen texels
//                   CUBE    an axis-aligned voxel cube: lit top face, shaded sides
//                   STREAK  a camera-facing line stretched along its screen velocity
//   shapes     up to SHAPES flat shapes in one InstancedMesh, drawn per fragment at the
//              internal resolution, so every edge is a hard pixel edge: shockwave rings,
//              flash discs, star flares, slash arcs, portals. Floor-flat or camera-facing.
//   ghosts     GHOSTS afterimage slots: flat-coloured copies of any posed Object3D.
//
// Every colour is a palette colour (ramps are lists of palette names). Every particle and
// shape centre is snapped to the screen texel grid, and every size is a whole number of
// texels. Fades are ordered-dither dissolves anchored to the world (look's ditherOrigin),
// never alpha blends, so nothing leaves the palette.
//
// Driven by the loop: tick() runs on every sim tick (events 'tick'); render(alpha) is called
// by main.js each frame. Everything is cleared when the base scene exits.

import * as THREE from 'three';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { DT } from '../core/loop.js';
import { events } from '../core/events.js';
import { PALETTE } from '../render/palette.js';
import { voxelUniforms } from '../render/voxel/index.js';
import { LAYER_NO_OUTLINE } from '../render/post.js';

export const CAP = 4096;
export const SHAPES = 256;
export const GHOSTS = 24;

export const SPRITE = 0, CUBE = 1, STREAK = 2;
export const RING = 0, DISC = 1, STAR = 2, ARC = 3, PORTAL = 4;
export const FLOOR = 0, FACING = 1;

const cp = Math.cos(CAMERA_PITCH), sp = Math.sin(CAMERA_PITCH);

// ---- colours ------------------------------------------------------------------------------

/** One step darker along the palette, for the shaded sides of voxel cubes. */
export const SHADE = {
  white: 'bone', bone: 'frost', torch: 'gold', gold: 'flame', flame: 'ember', ember: 'red', red: 'blood',
  blood: 'plum', rose: 'plum', plum: 'violet', frost: 'fog', fog: 'mist', mist: 'slate', slate: 'violet',
  violet: 'dusk', dusk: 'shadow', shadow: 'night', night: 'ink', ink: 'ink', sky: 'cyan', cyan: 'teal',
  teal: 'navy', navy: 'shadow', blue: 'navy', leaf: 'moss', moss: 'stoneDark', stoneLight: 'stone',
  stone: 'stoneDark', stoneDark: 'night', woodLight: 'wood', wood: 'dirt', dirt: 'stoneDark',
};

const NAMES = Object.keys(PALETTE);
const LIN = new Float32Array(NAMES.length * 3);  // linear rgb per palette index
const INDEX = {};
{
  const c = new THREE.Color();
  NAMES.forEach((n, i) => { INDEX[n] = i; c.set(PALETTE[n]); LIN[i * 3] = c.r; LIN[i * 3 + 1] = c.g; LIN[i * 3 + 2] = c.b; });
}
export const colorIndex = (name) => {
  const i = INDEX[name];
  if (i === undefined) throw new Error(`vfx: unknown palette colour "${name}"`);
  return i;
};

// ramps: a colour over a particle's life, as [[name, untilFraction], ...]. Stepped, never blended.
const RAMP_MAX = 8;
const rampStops = [];      // Float32Array(RAMP_MAX) per ramp
const rampCols = [];       // Uint8Array(RAMP_MAX): palette index
const rampShade = [];      // Uint8Array(RAMP_MAX): palette index of the shaded side
const rampLen = [];
const RAMPS = {};
/** Define (or redefine) a named ramp. Returns its id. A bare colour name is a one-step ramp. */
export function ramp(name, steps) {
  let id = RAMPS[name];
  if (id === undefined) { id = rampLen.length; RAMPS[name] = id; rampStops.push(new Float32Array(RAMP_MAX)); rampCols.push(new Uint8Array(RAMP_MAX)); rampShade.push(new Uint8Array(RAMP_MAX)); rampLen.push(0); }
  steps = steps.slice(0, RAMP_MAX);
  steps.forEach(([c, until], k) => {
    const [base, shade] = c.split('/');
    rampStops[id][k] = k === steps.length - 1 ? 2 : until;
    rampCols[id][k] = colorIndex(base);
    rampShade[id][k] = colorIndex(shade || SHADE[base] || base);
  });
  rampLen[id] = steps.length;
  return id;
}
/** Ramp id by name; a palette name that is not yet a ramp becomes a one-colour ramp. */
export function rampId(name) {
  if (typeof name === 'number') return name;
  const id = RAMPS[name];
  if (id !== undefined) return id;
  if (name.split('/')[0] in PALETTE) return ramp(name, [[name, 1]]);
  throw new Error(`vfx: unknown ramp "${name}"`);
}
export const rampNames = () => Object.keys(RAMPS);

// ---- particle pool (structure of arrays) -----------------------------------------------------

const f32 = () => new Float32Array(CAP);
export const P = {
  n: 0,
  x: f32(), y: f32(), z: f32(), px: f32(), py: f32(), pz: f32(), vx: f32(), vy: f32(), vz: f32(),
  age: f32(), life: f32(), size: f32(), grav: f32(), drag: f32(), bounce: f32(), wob: f32(), ph: f32(),
  stretch: f32(), pop: f32(), fadeIn: f32(), fadeAt: f32(), shrinkAt: f32(), floorY: f32(), delay: f32(),
  ramp: new Uint8Array(CAP), mode: new Uint8Array(CAP), owner: new Uint8Array(CAP), rest: new Uint8Array(CAP),
};
const FIELDS = ['x', 'y', 'z', 'px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 'size', 'grav', 'drag', 'bounce',
  'wob', 'ph', 'stretch', 'pop', 'fadeIn', 'fadeAt', 'shrinkAt', 'floorY', 'delay', 'ramp', 'mode', 'owner', 'rest'];
const FIELD_ARRAYS = FIELDS.map((f) => P[f]);
export const stats = { spawned: 0, dropped: 0, tickMs: 0, renderMs: 0, peak: 0 };
const ownerDeath = [];     // per owner id: callback(count) on death (ambient layers track their own)

/**
 * Add one particle. Returns its index, valid until the next tick (for setting extra fields),
 * or -1 when the pool is full (the particle is dropped, never an old one stolen mid-flight).
 * Defaults: a sprite that pops for 2 ticks, holds, then shrinks and dissolves over its last 40%.
 *   size: px at zoom 1 (world size * PPU). life: seconds.
 */
export function add(x, y, z, vx, vy, vz, life, size, rampName, mode = SPRITE) {
  if (P.n >= CAP) { stats.dropped++; return -1; }
  const i = P.n++;
  P.x[i] = P.px[i] = x; P.y[i] = P.py[i] = y; P.z[i] = P.pz[i] = z;
  P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
  P.age[i] = 0; P.life[i] = life; P.size[i] = size;
  P.grav[i] = 0; P.drag[i] = 1; P.bounce[i] = -1; P.wob[i] = 0; P.ph[i] = 0; P.stretch[i] = 0;
  P.pop[i] = 1.6; P.fadeIn[i] = 0; P.fadeAt[i] = 0.6; P.shrinkAt[i] = 0.6; P.floorY[i] = 0; P.delay[i] = 0;
  P.ramp[i] = rampId(rampName); P.mode[i] = mode; P.owner[i] = 0; P.rest[i] = 0;
  stats.spawned++;
  if (P.n > stats.peak) stats.peak = P.n;
  return i;
}

function kill(i) {
  const last = --P.n;
  const o = P.owner[i];
  if (o) ownerDeath[o]?.();
  if (i !== last) for (let k = 0; k < FIELD_ARRAYS.length; k++) FIELD_ARRAYS[k][i] = FIELD_ARRAYS[k][last];
}

/** Register an owner id for particles (P.owner[i] = id); fn runs when one of them dies. */
export function ownerSlot(fn) {
  for (let id = 1; id < 255; id++) if (!ownerDeath[id]) { ownerDeath[id] = fn; return id; }
  return 0;
}
export function freeOwner(id) {
  if (!id) return;
  ownerDeath[id] = null;
  for (let i = 0; i < P.n; i++) if (P.owner[i] === id) P.owner[i] = 0;
}

function tickParticles() {
  for (let i = P.n - 1; i >= 0; i--) {
    if (P.delay[i] > 0) { P.delay[i] -= DT; continue; }
    P.px[i] = P.x[i]; P.py[i] = P.y[i]; P.pz[i] = P.z[i];
    const age = (P.age[i] += DT);
    if (age >= P.life[i]) { kill(i); continue; }
    if (P.rest[i]) continue;
    const d = P.drag[i];
    let vx = P.vx[i] * d, vy = P.vy[i] * d - P.grav[i] * DT, vz = P.vz[i] * d;
    const w = P.wob[i];
    if (w) { vx += Math.sin(age * 5.3 + P.ph[i]) * w * DT; vz += Math.cos(age * 4.1 + P.ph[i] * 1.7) * w * 0.5 * DT; }
    let y = P.y[i] + vy * DT;
    const fy = P.floorY[i];
    if (y < fy && P.bounce[i] >= 0 && vy < 0) {
      y = fy;
      if (-vy * P.bounce[i] > 0.9) { vy = -vy * P.bounce[i]; vx *= 0.6; vz *= 0.6; }
      else { vy = 0; vx = 0; vz = 0; P.rest[i] = 1; }
    }
    P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.x[i] += vx * DT; P.y[i] = y; P.z[i] += vz * DT;
  }
}

// ---- shape pool ------------------------------------------------------------------------------

const s32 = () => new Float32Array(SHAPES);
export const S = {
  n: 0,
  x: s32(), y: s32(), z: s32(), age: s32(), life: s32(), delay: s32(), yaw: s32(),
  a: s32(), b: s32(), c: s32(), d: s32(),            // per-type parameters
  type: new Uint8Array(SHAPES), orient: new Uint8Array(SHAPES), mirror: new Int8Array(SHAPES),
  col: new Uint8Array(SHAPES), col2: new Uint8Array(SHAPES), col3: new Uint8Array(SHAPES),
};
const SFIELDS = ['x', 'y', 'z', 'age', 'life', 'delay', 'yaw', 'a', 'b', 'c', 'd', 'type', 'orient', 'mirror', 'col', 'col2', 'col3'].map((f) => S[f]);

/**
 * Add one shape. Per-type parameters a..d (see shapeFrame below for what each type reads).
 * Returns its index or -1 when full.
 */
export function addShape(type, orient, x, y, z, life, col, col2, a = 0, b = 0, c = 0, d = 0) {
  if (S.n >= SHAPES) { stats.dropped++; return -1; }
  const i = S.n++;
  S.type[i] = type; S.orient[i] = orient; S.x[i] = x; S.y[i] = y; S.z[i] = z;
  S.age[i] = 0; S.life[i] = life; S.delay[i] = 0; S.yaw[i] = 0; S.mirror[i] = 1;
  S.col[i] = colorIndex(col); S.col2[i] = colorIndex(col2); S.col3[i] = INDEX.ink;
  S.a[i] = a; S.b[i] = b; S.c[i] = c; S.d[i] = d;
  return i;
}

function tickShapes() {
  for (let i = S.n - 1; i >= 0; i--) {
    if (S.delay[i] > 0) { S.delay[i] -= DT; continue; }
    S.age[i] += DT;
    if (S.age[i] >= S.life[i]) {
      const last = --S.n;
      if (i !== last) for (const arr of SFIELDS) arr[i] = arr[last];
    }
  }
}

// ---- ghosts (afterimages) --------------------------------------------------------------------

const ghostSlots = [];
let ghostRoot = null;
const ghostVert = /* glsl */`
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ghostFrag = /* glsl */`
uniform vec3 uCol; uniform float uFade; uniform vec2 ditherOrigin;
${bayerGLSL()}
void main() {
  if (uFade < 0.999 && uFade <= bayer4(gl_FragCoord.xy + ditherOrigin)) discard;
  gl_FragColor = vec4(uCol, 1.0);
  #include <colorspace_fragment>
}`;

function makeGhostSlot() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color() }, uFade: { value: 1 }, ditherOrigin: voxelUniforms.ditherOrigin },
    vertexShader: ghostVert, fragmentShader: ghostFrag,
    // pushed back in depth so the live body always draws over its own trail
    polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: 40000,
  });
  const group = new THREE.Group();
  group.visible = false;
  group.matrixAutoUpdate = false;
  group.layers.set(LAYER_NO_OUTLINE);
  group.userData.noShadow = true;
  ghostRoot.add(group);
  return { group, mat, meshes: [], used: 0, age: 0, life: 1, ramp: 0, delay: 0 };
}

const stack = [];
function collectMeshes(obj, slot) {
  // depth-first over visible, outlined (layer 0) meshes: the body, not its smears or particles
  stack.length = 0;
  stack.push(obj);
  while (stack.length) {
    const o = stack.pop();
    if (!o.visible) continue;
    if (o.isMesh && (o.layers.mask & 1) && o.geometry) {
      let m = slot.meshes[slot.used];
      if (!m) {
        m = new THREE.Mesh(o.geometry, slot.mat);
        m.matrixAutoUpdate = false;
        m.frustumCulled = false;
        m.layers.set(LAYER_NO_OUTLINE);
        slot.meshes.push(m);
        slot.group.add(m);
      }
      m.geometry = o.geometry;
      m.matrix.copy(o.matrixWorld);
      m.matrixWorld.copy(o.matrixWorld);
      m.visible = true;
      slot.used++;
    }
    const ch = o.children;
    for (let k = ch.length - 1; k >= 0; k--) stack.push(ch[k]);
  }
  for (let k = slot.used; k < slot.meshes.length; k++) slot.meshes[k].visible = false;
}

let ghostNext = 0;
/** Stamp an afterimage of obj's current pose. Returns the slot, or null. */
export function stampGhost(obj, rampName = 'ghost', life = 0.3, delay = 0) {
  ensure();
  const slot = ghostSlots[ghostNext];
  ghostNext = (ghostNext + 1) % GHOSTS;
  obj.updateWorldMatrix(true, true);
  slot.used = 0;
  collectMeshes(obj, slot);
  slot.age = 0; slot.life = life; slot.delay = delay; slot.ramp = rampId(rampName);
  slot.group.visible = delay <= 0 && slot.used > 0;
  return slot;
}

function tickGhosts() {
  for (const g of ghostSlots) {
    if (g.used === 0) continue;
    if (g.delay > 0) { g.delay -= DT; if (g.delay <= 0) g.group.visible = true; continue; }
    g.age += DT;
    if (g.age >= g.life) { g.used = 0; g.group.visible = false; }
  }
}

// ---- GPU side ---------------------------------------------------------------------------------

function bayerGLSL() {
  return /* glsl */`
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  int i = q.x + q.y * 4;
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i] + 0.5) / 16.0;
}`;
}

const partVert = /* glsl */`
#define DEPTH_BIAS 0.008
attribute vec3 aCol; attribute vec3 aShade; attribute float aFade;
varying vec3 vCol; varying float vFade;
void main() {
  vec3 n = normalize(mat3(instanceMatrix) * normal);
  vCol = n.y > 0.5 ? aCol : aShade;          // voxel cubes: lit top, shaded sides
  vFade = aFade;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position.z -= DEPTH_BIAS * gl_Position.w;   // effects sit in front of the body they burst from
}`;
const partFrag = /* glsl */`
uniform vec2 ditherOrigin;
varying vec3 vCol; varying float vFade;
${bayerGLSL()}
void main() {
  if (vFade < 0.999 && vFade <= bayer4(gl_FragCoord.xy + ditherOrigin)) discard;
  gl_FragColor = vec4(vCol, 1.0);
  #include <colorspace_fragment>
}`;

const shapeVert = /* glsl */`
attribute vec3 aCol; attribute vec3 aCol2; attribute vec3 aCol3; attribute vec4 aP; attribute vec4 aQ;
varying vec3 vCol; varying vec3 vCol2; varying vec3 vCol3; varying vec4 vP; varying vec4 vQ; varying vec2 vUv;
void main() {
  vCol = aCol; vCol2 = aCol2; vCol3 = aCol3; vP = aP; vQ = aQ; vUv = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position.z -= aQ.w * gl_Position.w;          // per-shape depth bias (facing shapes pull forward)
}`;
// aP = (type, fade, p1, p2)   aQ = (p3, p4, texelsPerUnitRadius, 0)
const shapeFrag = /* glsl */`
uniform vec2 ditherOrigin;
varying vec3 vCol; varying vec3 vCol2; varying vec3 vCol3; varying vec4 vP; varying vec4 vQ; varying vec2 vUv;
${bayerGLSL()}
const float TAU = 6.2831853;
void main() {
  // quantise the local coordinate to the texel grid of this shape, so edges step in whole pixels
  float tpr = max(vQ.z, 1.0);
  vec2 uv = (floor(vUv * tpr) + 0.5) / tpr;
  float r = length(uv);
  float px = 1.0 / tpr;                     // one texel, in local units
  int type = int(vP.x + 0.5);
  float fade = vP.y;
  vec3 col = vCol;
  if (type == 0) {                          // RING: p1 = inner radius, p2 = rim texels
    if (r > 1.0 || r < vP.z) discard;
    col = r > 1.0 - vP.w * px ? vCol2 : vCol;
  } else if (type == 1) {                   // DISC: p1 = hot core radius, p2 = rim texels (ink)
    if (r > 1.0) discard;
    col = r < vP.z ? vCol2 : vCol;
    if (vP.w > 0.0 && r > 1.0 - vP.w * px) col = vCol3;
  } else if (type == 2) {                   // STAR: p1 = arm width, p2 = diagonal length
    // drawn inside a 1-texel ink outline, so a flare reads on any background (even a white flash)
    vec2 a = abs(uv);
    float w = vP.z;
    float L = 1.0 - px * 1.5;                // arms stop short of the quad so the outline fits
    vec2 d = abs(vec2(uv.x + uv.y, uv.x - uv.y)) * 0.7071;
    bool arm = (a.y < w * (L - a.x) + px * 0.5 && a.x < L) || (a.x < w * (L - a.y) + px * 0.5 && a.y < L);
    bool diag = (d.y < px * 0.75 && d.x < vP.w) || (d.x < px * 0.75 && d.y < vP.w);
    float o = px * 1.2;
    bool armO = (a.y < w * (L - a.x) + px * 0.5 + o && a.x < L + o) || (a.x < w * (L - a.y) + px * 0.5 + o && a.y < L + o);
    bool diagO = (d.y < px * 0.75 + o && d.x < vP.w + o) || (d.x < px * 0.75 + o && d.y < vP.w + o);
    if (arm || diag) col = r < max(w * 0.9, px * 1.5) ? vCol2 : vCol;
    else if (armO || diagO) col = vCol3;
    else discard;
  } else if (type == 3) {                   // ARC: p1 = span (rad), p2 = thickness, p3 = head 0..1, p4 = tail 0..1
    if (r > 1.0) discard;
    float a = atan(uv.y, uv.x);
    if (a < 0.0) a += TAU;
    float t = a / vP.z;
    float head = vQ.x, tail = vQ.y;
    if (t > head || t < tail) discard;
    float k = clamp((t - tail) / max(head - tail, 1e-3), 0.0, 1.0);
    float th = vP.w * pow(k, 0.55);
    if (r < 1.0 - th - px * 0.5) discard;
    bool edge = r > 1.0 - px * 1.5 || t > head - px * 2.0 / max(vP.z, 0.1);
    col = edge ? vCol2 : (k > 0.45 ? vCol : vCol3);
  } else if (type == 4) {                   // PORTAL: p1 = spin phase, p2 = rim texels
    if (r > 1.0) discard;
    float a = atan(uv.y, uv.x) / TAU;
    float rim = 1.0 - vP.w * px;
    if (r > rim) {
      col = fract(a * 10.0 + vP.z) < 0.62 ? vCol2 : vCol;
    } else {
      float s = fract(a * 3.0 + r * 1.6 - vP.z * 1.5);
      col = s < 0.28 ? vCol : (s < 0.36 && r > 0.35 ? vCol2 : vCol3);
      if (r < 0.18) col = vCol3;
    }
  }
  if (fade < 0.999 && fade <= bayer4(gl_FragCoord.xy + ditherOrigin)) discard;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

let partMesh = null, shapeMesh = null;
let aCol, aShade, aFade, sCol, sCol2, sCol3, sP, sQ;

function ensure() {
  if (partMesh || !display.scene) return !!partMesh;
  const pg = new THREE.BoxGeometry(1, 1, 1);
  aCol = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  aShade = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  aFade = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  for (const a of [aCol, aShade, aFade]) a.setUsage(THREE.DynamicDrawUsage);
  pg.setAttribute('aCol', aCol); pg.setAttribute('aShade', aShade); pg.setAttribute('aFade', aFade);
  const pm = new THREE.ShaderMaterial({ uniforms: { ditherOrigin: voxelUniforms.ditherOrigin }, vertexShader: partVert, fragmentShader: partFrag });
  partMesh = new THREE.InstancedMesh(pg, pm, CAP);
  partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  partMesh.name = 'vfx.particles';

  const sg = new THREE.PlaneGeometry(2, 2);
  sCol = new THREE.InstancedBufferAttribute(new Float32Array(SHAPES * 3), 3);
  sCol2 = new THREE.InstancedBufferAttribute(new Float32Array(SHAPES * 3), 3);
  sCol3 = new THREE.InstancedBufferAttribute(new Float32Array(SHAPES * 3), 3);
  sP = new THREE.InstancedBufferAttribute(new Float32Array(SHAPES * 4), 4);
  sQ = new THREE.InstancedBufferAttribute(new Float32Array(SHAPES * 4), 4);
  for (const a of [sCol, sCol2, sCol3, sP, sQ]) a.setUsage(THREE.DynamicDrawUsage);
  sg.setAttribute('aCol', sCol); sg.setAttribute('aCol2', sCol2); sg.setAttribute('aCol3', sCol3);
  sg.setAttribute('aP', sP); sg.setAttribute('aQ', sQ);
  const sm = new THREE.ShaderMaterial({ uniforms: { ditherOrigin: voxelUniforms.ditherOrigin }, vertexShader: shapeVert, fragmentShader: shapeFrag, side: THREE.DoubleSide });
  shapeMesh = new THREE.InstancedMesh(sg, sm, SHAPES);
  shapeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shapeMesh.name = 'vfx.shapes';

  ghostRoot = new THREE.Group();
  ghostRoot.name = 'vfx.ghosts';
  for (const m of [partMesh, shapeMesh]) {
    m.frustumCulled = false;
    m.count = 0;
    m.layers.set(LAYER_NO_OUTLINE);   // drawn, but no outline, no edge, no shadow
    m.userData.noShadow = true;
  }
  display.scene.add(partMesh, shapeMesh, ghostRoot);
  for (let i = 0; i < GHOSTS; i++) ghostSlots.push(makeGhostSlot());
  return true;
}

// ---- render: interpolate, snap to texels, write instance buffers --------------------------------

function colInto(arr, o, idx) { arr[o] = LIN[idx * 3]; arr[o + 1] = LIN[idx * 3 + 1]; arr[o + 2] = LIN[idx * 3 + 2]; }

/** Snap a point so a box of nx by ny texels centred on it lands on whole texels. Writes into out. */
const snapped = { x: 0, y: 0, z: 0 };
function snapTexel(x, y, z, nx, ny, P2) {
  const r = x, u = y * cp - z * sp, b = y * sp + z * cp;
  const ox = (display.width & 1) * 0.5, oy = (display.height & 1) * 0.5;
  const rs = (Math.round(r * P2 - nx * 0.5 + ox) + nx * 0.5 - ox) / P2;
  const us = (Math.round(u * P2 - ny * 0.5 + oy) + ny * 0.5 - oy) / P2;
  snapped.x = rs; snapped.y = us * cp + b * sp; snapped.z = -us * sp + b * cp;
  return snapped;
}

function writeMat(m, o, Xx, Xy, Xz, Yx, Yy, Yz, Zx, Zy, Zz, tx, ty, tz) {
  m[o] = Xx; m[o + 1] = Xy; m[o + 2] = Xz; m[o + 3] = 0;
  m[o + 4] = Yx; m[o + 5] = Yy; m[o + 6] = Yz; m[o + 7] = 0;
  m[o + 8] = Zx; m[o + 9] = Zy; m[o + 10] = Zz; m[o + 11] = 0;
  m[o + 12] = tx; m[o + 13] = ty; m[o + 14] = tz; m[o + 15] = 1;
}

function renderParticles(alpha) {
  const zoom = display.zoom, Pz = PPU * zoom;
  const M = partMesh.instanceMatrix.array, C = aCol.array, SH = aShade.array, F = aFade.array;
  let j = 0;
  for (let i = 0; i < P.n; i++) {
    if (P.delay[i] > 0) continue;
    const life = P.life[i];
    const age = Math.min(life, P.age[i] + (P.rest[i] ? 0 : 0));
    const k = age / life;
    // stepped colour ramp
    const rid = P.ramp[i], stops = rampStops[rid];
    let s = 0;
    const len = rampLen[rid];
    while (s < len - 1 && k >= stops[s]) s++;
    // size: a fast pop for the first 2 ticks, hold, then shrink in whole texels
    let size = P.size[i];
    if (age < DT * 2) size *= P.pop[i];
    const sa = P.shrinkAt[i];
    if (k > sa) size *= 1 - (k - sa) / (1 - sa) * 0.85;
    const n = Math.max(1, Math.round(size * zoom));
    // fade: dither in, dither out
    let f = 1;
    const fi = P.fadeIn[i], fa = P.fadeAt[i];
    if (fi > 0 && k < fi) f = k / fi;
    else if (k > fa) f = 1 - (k - fa) / (1 - fa);
    if (f <= 0.02) continue;
    const x = P.px[i] + (P.x[i] - P.px[i]) * alpha;
    const y = P.py[i] + (P.y[i] - P.py[i]) * alpha;
    const z = P.pz[i] + (P.z[i] - P.pz[i]) * alpha;
    const o = j * 16;
    const w = n / Pz;
    const mode = P.mode[i];
    if (mode === CUBE) {
      const q = snapTexel(x, y, z, n, n, Pz);
      writeMat(M, o, w, 0, 0, 0, w, 0, 0, 0, w, q.x, q.y, q.z);
    } else if (mode === STREAK) {
      const vr = P.vx[i], vu = P.vy[i] * cp - P.vz[i] * sp;
      const spd = Math.hypot(vr, vu);
      const L = Math.max(w, Math.round(spd * P.stretch[i] * Pz) / Pz);
      const dr = spd > 1e-4 ? vr / spd : 1, du = spd > 1e-4 ? vu / spd : 0;
      // head at the particle, tail trailing behind along the screen velocity
      const cxr = x - dr * L * 0.5, cu = -du * L * 0.5;
      const q = snapTexel(cxr, y + cu * cp, z - cu * sp, 1, 1, Pz);
      writeMat(M, o, dr * L, du * cp * L, -du * sp * L, -du * w, dr * cp * w, -dr * sp * w, 0, sp * w * 0.2, cp * w * 0.2, q.x, q.y, q.z);
    } else {
      const q = snapTexel(x, y, z, n, n, Pz);
      writeMat(M, o, w, 0, 0, 0, cp * w, -sp * w, 0, sp * w * 0.1, cp * w * 0.1, q.x, q.y, q.z);
    }
    colInto(C, j * 3, rampCols[rid][s]);
    colInto(SH, j * 3, mode === CUBE ? rampShade[rid][s] : rampCols[rid][s]);
    F[j] = f;
    j++;
  }
  partMesh.count = j;
  partMesh.instanceMatrix.needsUpdate = true;
  aCol.needsUpdate = aShade.needsUpdate = aFade.needsUpdate = true;
}

const ease = {
  out: (t) => 1 - (1 - t) * (1 - t) * (1 - t),
  back: (t) => { const c = 2.2; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

/**
 * Per-type animation of a shape at life fraction k. Writes radius (world), fade and shader
 * params. Parameters a..d are set by the effect that spawned the shape:
 *   RING   a = start radius, b = end radius, c = start thickness (0..1 of radius), d = rim texels
 *   DISC   a = radius, b = core fraction, d = ink rim texels
 *   STAR   a = radius, b = arm width
 *   ARC    a = radius, b = span (rad), c = thickness, d = head time (fraction of life)
 *   PORTAL a = radius, b = open time (s), c = close time (s, from the end), d = spin speed
 */
const fr = { R: 0, fade: 1, p1: 0, p2: 0, p3: 0, p4: 0 };
function shapeFrame(i, k, age) {
  const a = S.a[i], b = S.b[i], c = S.c[i], d = S.d[i];
  const life = S.life[i];
  fr.fade = 1; fr.p1 = fr.p2 = fr.p3 = fr.p4 = 0;
  switch (S.type[i]) {
    case RING: {
      const e = ease.out(k);
      fr.R = a + (b - a) * e;
      const th = c * (1 - e * 0.8);
      fr.p1 = 1 - th; fr.p2 = d;
      fr.fade = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
      break;
    }
    case DISC: {
      // pops to full on frame 0, then shrinks fast in steps
      const steps = [1, 0.85, 0.6, 0.35, 0.2];
      const f = Math.min(steps.length - 1, Math.floor(k * steps.length));
      fr.R = a * steps[f];
      fr.p1 = b * (1 - k * 0.5); fr.p2 = d;
      fr.fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      break;
    }
    case STAR: {
      const steps = [0.8, 1.2, 1, 0.7, 0.45, 0.25];
      const f = Math.min(steps.length - 1, Math.floor(k * steps.length));
      fr.R = a * steps[f];
      fr.p1 = b * (f === 0 ? 1.3 : 1 - k * 0.5); fr.p2 = 0.55 * (1 - k);
      break;
    }
    case ARC: {
      fr.R = a;
      fr.p1 = b; fr.p2 = c;
      const ht = d;
      fr.p3 = k < ht ? ease.out(k / ht) : 1;                        // head sweeps fast
      fr.p4 = k < ht ? 0 : Math.pow((k - ht) / (1 - ht), 0.8);      // tail eats toward the head
      break;
    }
    case PORTAL: {
      const open = b, close = c;
      let s;
      if (age < open) s = ease.back(age / open);
      else if (age > life - close) s = Math.pow(Math.max(0, (life - age) / close), 0.5) * 1.0;
      else s = 1 + Math.sin(age * 9) * 0.03;
      fr.R = a * Math.max(0, s);
      fr.p1 = age * d; fr.p2 = 2;
      break;
    }
  }
  return fr;
}

function renderShapes() {
  const zoom = display.zoom, Pz = PPU * zoom;
  const M = shapeMesh.instanceMatrix.array, A = sCol.array, B = sCol2.array, C3 = sCol3.array, PA = sP.array, QA = sQ.array;
  let j = 0;
  for (let i = 0; i < S.n; i++) {
    if (S.delay[i] > 0) continue;
    const age = S.age[i], k = Math.min(1, age / S.life[i]);
    const f = shapeFrame(i, k, age);
    const texR = Math.round(f.R * Pz);      // radius in whole texels
    if (texR < 1 || f.fade <= 0.02) continue;
    const R = texR / Pz;
    const o = j * 16;
    const mir = S.mirror[i];
    if (S.orient[i] === FLOOR) {
      const yaw = S.yaw[i], cy = Math.cos(yaw), sy = Math.sin(yaw);
      // local x -> (cos, 0, -sin), local y (back) -> (-sin, 0, -cos); floor normal up
      const q = snapTexel(S.x[i], S.y[i], S.z[i], 1, 1, Pz);
      writeMat(M, o, cy * R, 0, -sy * R, -sy * R * mir, 0, -cy * R * mir, 0, 1, 0, q.x, q.y, q.z);
    } else {
      const q = snapTexel(S.x[i], S.y[i], S.z[i], 0, 0, Pz);
      writeMat(M, o, R * mir, 0, 0, 0, cp * R, -sp * R, 0, sp, cp, q.x, q.y, q.z);
    }
    colInto(A, j * 3, S.col[i]); colInto(B, j * 3, S.col2[i]); colInto(C3, j * 3, S.col3[i]);
    PA[j * 4] = S.type[i]; PA[j * 4 + 1] = f.fade; PA[j * 4 + 2] = f.p1; PA[j * 4 + 3] = f.p2;
    QA[j * 4] = f.p3; QA[j * 4 + 1] = f.p4; QA[j * 4 + 2] = texR; QA[j * 4 + 3] = S.orient[i] === FLOOR ? 0.0005 : 0.01;
    j++;
  }
  shapeMesh.count = j;
  shapeMesh.instanceMatrix.needsUpdate = true;
  sCol.needsUpdate = sCol2.needsUpdate = sCol3.needsUpdate = sP.needsUpdate = sQ.needsUpdate = true;
}

function renderGhosts() {
  for (const g of ghostSlots) {
    if (g.used === 0 || g.delay > 0) continue;
    const k = g.age / g.life;
    const rid = g.ramp, stops = rampStops[rid];
    let s = 0;
    while (s < rampLen[rid] - 1 && k >= stops[s]) s++;
    const ci = rampCols[rid][s] * 3;
    g.mat.uniforms.uCol.value.setRGB(LIN[ci], LIN[ci + 1], LIN[ci + 2]);
    g.mat.uniforms.uFade.value = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65;
  }
}

// ---- loop hooks -------------------------------------------------------------------------------

const tickHooks = [];
/** Run fn(dt) on every vfx tick (ambient layers, timed sequences). Returns an unsubscribe. */
export function onTick(fn) { tickHooks.push(fn); return () => { const i = tickHooks.indexOf(fn); if (i >= 0) tickHooks.splice(i, 1); }; }

// timed calls: a fixed ring of slots, so sequenced effects (a burst 6 ticks after a flash) allocate nothing per frame
const LATER = 128;
const laterT = new Int32Array(LATER), laterFn = new Array(LATER).fill(null), laterArgs = new Array(LATER).fill(null);
/** Call fn(args) after `ticks` sim ticks. Paused and hitstopped along with the sim. */
export function later(ticks, fn, args) {
  for (let i = 0; i < LATER; i++) if (!laterFn[i]) { laterT[i] = Math.max(1, ticks | 0); laterFn[i] = fn; laterArgs[i] = args; return; }
  fn(args);
}

let ticks = 0;
export function tick() {
  const t0 = performance.now();
  ticks++;
  for (let i = 0; i < LATER; i++) {
    if (laterFn[i] && --laterT[i] <= 0) { const fn = laterFn[i], a = laterArgs[i]; laterFn[i] = null; laterArgs[i] = null; fn(a); }
  }
  for (let i = 0; i < tickHooks.length; i++) tickHooks[i](DT);
  tickParticles();
  tickShapes();
  tickGhosts();
  stats.tickMs = performance.now() - t0;
}

export function render(alpha) {
  if (!ensure()) return;
  const t0 = performance.now();
  renderParticles(alpha);
  renderShapes();
  renderGhosts();
  stats.renderMs = performance.now() - t0;
}

/** Remove every particle, shape, ghost and pending call (scene change). Ambient layers stop too. */
export function clear() {
  while (P.n) kill(P.n - 1);
  S.n = 0;
  for (const g of ghostSlots) { g.used = 0; g.group.visible = false; }
  for (let i = 0; i < LATER; i++) { laterFn[i] = null; laterArgs[i] = null; }
  events.emit('vfx:clear', {});
}

export const tickCount = () => ticks;

events.on('tick', tick);
events.on('scene:exit', (e) => { if (e.name !== 'pause') clear(); });
