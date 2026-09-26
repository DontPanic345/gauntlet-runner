// The pooled cube-particle core of the shared vfx system (piece `vfx`).
//
// One InstancedMesh of unit cubes, one draw call, structure-of-arrays state, a dense live list
// (swap-remove), and no allocation once built. Everything is written straight into the
// instance buffers each frame.
//
// A particle is described by numbers, not a type: where it starts, how fast it goes, how hard
// the air (drag) and gravity pull it, how long it lives, a size curve (pop, hold, shrink), a
// colour ramp of palette names, and a few flags. The effects library (effects.js) composes
// those into shapes with timing: a fast pop, then a slow fade.
//
// Pixel grid: sizes are in screen pixels at zoom 1 (1 px = 1/32 world unit) and are rounded to
// whole pixels at draw time; positions snap to whole screen texels (same maths as look.snap).

import * as THREE from 'three';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { DT } from '../core/loop.js';

export const PX = 1 / PPU;             // one zoom-1 pixel in world units
export const F_STRETCH = 1;            // cube stretched along its velocity (a spark streak)
export const F_BOUNCE = 2;             // bounces on the floor (y = 0) instead of falling through
export const F_FLAT = 4;               // squashed to a slab (floor rings, scuffs)
export const F_GROUND = 8;             // dies on touching the floor
export const F_TWINKLE = 16;           // flickers between its ramp colours while alive

const cp = Math.cos(CAMERA_PITCH), sp = Math.sin(CAMERA_PITCH);

// ---- colour ramps -------------------------------------------------------------------------
// A ramp is a list of palette names; a particle steps through them (no blending) as it ages.
// Early stops are held shorter than late ones, so the bright flash is quick and the tail lingers.
const ramps = [];                       // { n, rgb: Float32Array(3n) }
const rampIds = new Map();
const _c = new THREE.Color();
export function ramp(names) {
  const key = Array.isArray(names) ? names.join(',') : names;
  let id = rampIds.get(key);
  if (id !== undefined) return id;
  const list = key.split(',');
  const rgb = new Float32Array(list.length * 3);
  list.forEach((nm, i) => { _c.setHex(hex(nm)); rgb[i * 3] = _c.r; rgb[i * 3 + 1] = _c.g; rgb[i * 3 + 2] = _c.b; });
  id = ramps.length;
  ramps.push({ n: list.length, rgb });
  rampIds.set(key, id);
  return id;
}

export function createParticles(root, capacity = 2600) {
  const N = capacity;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  look.noOutline(mesh);
  root.add(mesh);

  const f = (k = 1) => new Float32Array(N * k);
  const X = f(), Y = f(), Z = f(), PX_ = f(), PY = f(), PZ = f();
  const VX = f(), VY = f(), VZ = f();
  const LIFE = f(), MAX = f(), S0 = f(), S1 = f(), POP = f(), DRAG = f(), GRAV = f(), STRETCH = f(), DELAY = f();
  const RAMP = new Uint16Array(N), FLAGS = new Uint16Array(N), BOUNCES = new Uint8Array(N);
  let n = 0, peak = 0, dropped = 0;

  /**
   * Add one particle. Sizes in px at zoom 1. drag is the fraction of velocity kept per tick
   * (0.9 = heavy air). Returns its slot so callers can set extras (pop, stretch, delay).
   * When the pool is full the oldest-dying slot is recycled (slot 0 style ring), never grown.
   */
  function add(x, y, z, vx, vy, vz, life, s0, s1, rampId, flags = 0, drag = 1, grav = 0) {
    let i;
    if (n >= N) { i = (dropped++) % N; } else i = n++;
    X[i] = PX_[i] = x; Y[i] = PY[i] = y; Z[i] = PZ[i] = z;
    VX[i] = vx; VY[i] = vy; VZ[i] = vz;
    LIFE[i] = 0; MAX[i] = Math.max(DT, life);
    S0[i] = s0 * PX; S1[i] = s1 * PX;
    POP[i] = 0.12; STRETCH[i] = 1.6; DELAY[i] = 0;
    RAMP[i] = rampId; FLAGS[i] = flags; BOUNCES[i] = 0;
    DRAG[i] = drag; GRAV[i] = grav;
    if (n > peak) peak = n;
    return i;
  }

  function kill(i) {
    const l = --n;
    if (i === l) return;
    X[i] = X[l]; Y[i] = Y[l]; Z[i] = Z[l]; PX_[i] = PX_[l]; PY[i] = PY[l]; PZ[i] = PZ[l];
    VX[i] = VX[l]; VY[i] = VY[l]; VZ[i] = VZ[l];
    LIFE[i] = LIFE[l]; MAX[i] = MAX[l]; S0[i] = S0[l]; S1[i] = S1[l]; POP[i] = POP[l];
    DRAG[i] = DRAG[l]; GRAV[i] = GRAV[l]; STRETCH[i] = STRETCH[l]; DELAY[i] = DELAY[l];
    RAMP[i] = RAMP[l]; FLAGS[i] = FLAGS[l]; BOUNCES[i] = BOUNCES[l];
  }

  function tick() {
    for (let i = n - 1; i >= 0; i--) {
      PX_[i] = X[i]; PY[i] = Y[i]; PZ[i] = Z[i];
      if (DELAY[i] > 0) { DELAY[i] -= DT; continue; }
      LIFE[i] += DT;
      if (LIFE[i] >= MAX[i]) { kill(i); continue; }
      const d = DRAG[i];
      VX[i] *= d; VZ[i] *= d; VY[i] = VY[i] * d - GRAV[i] * DT;
      X[i] += VX[i] * DT; Y[i] += VY[i] * DT; Z[i] += VZ[i] * DT;
      const fl = FLAGS[i];
      if (Y[i] < 0.02) {
        if (fl & F_GROUND) { kill(i); continue; }
        if (fl & F_BOUNCE) {
          Y[i] = 0.02;
          if (VY[i] < 0) { VY[i] = BOUNCES[i]++ < 2 ? -VY[i] * 0.4 : 0; VX[i] *= 0.6; VZ[i] *= 0.6; }
        }
      }
    }
  }

  const arr = mesh.instanceMatrix.array;
  const carr = mesh.instanceColor.array;
  const sizeAt = (i, k) => {
    // pop up from half size over the first POP of life (ease out), hold, then shrink late (ease in)
    const p = POP[i];
    if (k < p) { const u = k / p; return S0[i] * (0.45 + 0.55 * (1 - (1 - u) * (1 - u))); }
    const u = (k - p) / (1 - p);
    return S0[i] + (S1[i] - S0[i]) * u * u;
  };

  function render(alpha, tSec) {
    const zoom = display.zoom, P = PPU * zoom;
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (DELAY[i] > 0) continue;
      const k = LIFE[i] / MAX[i];
      let px = PX_[i] + (X[i] - PX_[i]) * alpha, py = PY[i] + (Y[i] - PY[i]) * alpha, pz = PZ[i] + (Z[i] - PZ[i]) * alpha;
      // whole-pixel size; anything under half a pixel is gone
      const px0 = sizeAt(i, k) * P;
      const s = Math.round(px0);
      if (s < 1) continue;
      const w = s / P;
      // snap to screen texels
      const u = py * cp - pz * sp, b = py * sp + pz * cp;
      const us = Math.round(u * P) / P;
      px = Math.round(px * P) / P;
      py = us * cp + b * sp; pz = -us * sp + b * cp;
      const fl = FLAGS[i];
      const o = m * 16;
      let sx = w, sy = w, sz = w;
      if (fl & F_FLAT) sy = Math.min(w, 0.03);
      if (fl & F_STRETCH) {
        const vx = VX[i], vy = VY[i], vz = VZ[i];
        const sp2 = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const len = Math.max(w, sp2 * DT * STRETCH[i] * (1 - k * 0.5));
        if (sp2 > 1e-3 && len > w * 1.2) {
          // basis: z = velocity dir, x = up x z, y = z x x
          const dx = vx / sp2, dy = vy / sp2, dz = vz / sp2;
          let ax = dz, ay = 0, az = -dx;                       // (0,1,0) x d
          let al = Math.hypot(ax, az);
          if (al < 1e-4) { ax = 1; az = 0; al = 1; }
          ax /= al; az /= al;
          const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax; // d x a
          arr[o] = ax * w; arr[o + 1] = 0; arr[o + 2] = az * w; arr[o + 3] = 0;
          arr[o + 4] = bx * w; arr[o + 5] = by * w; arr[o + 6] = bz * w; arr[o + 7] = 0;
          arr[o + 8] = dx * len; arr[o + 9] = dy * len; arr[o + 10] = dz * len; arr[o + 11] = 0;
          arr[o + 12] = px; arr[o + 13] = py; arr[o + 14] = pz; arr[o + 15] = 1;
          writeColor(m, i, k, tSec, carr);
          m++;
          continue;
        }
      }
      arr[o] = sx; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = sz; arr[o + 11] = 0;
      arr[o + 12] = px; arr[o + 13] = py; arr[o + 14] = pz; arr[o + 15] = 1;
      writeColor(m, i, k, tSec, carr);
      m++;
    }
    mesh.count = m;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  function writeColor(slot, i, k, tSec, out) {
    const r = ramps[RAMP[i]];
    let idx = Math.min(r.n - 1, Math.floor(Math.pow(k, 0.8) * r.n));
    if ((FLAGS[i] & F_TWINKLE) && r.n > 1 && ((Math.floor(tSec * 24) + i) & 3) === 0) idx = Math.max(0, idx - 1);
    out[slot * 3] = r.rgb[idx * 3]; out[slot * 3 + 1] = r.rgb[idx * 3 + 1]; out[slot * 3 + 2] = r.rgb[idx * 3 + 2];
  }

  return {
    add, tick, render,
    // extras on the last added slot
    set(i, { pop, stretch, delay } = {}) { if (pop !== undefined) POP[i] = pop; if (stretch !== undefined) STRETCH[i] = stretch; if (delay !== undefined) DELAY[i] = delay; },
    clear() { n = 0; },
    get count() { return n; },
    get peak() { return peak; },
    get capacity() { return N; },
    get recycled() { return dropped; },
    resetPeak() { peak = n; dropped = 0; },
    dispose() { root.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
}
