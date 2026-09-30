// Gauntlet traps (piece `gauntlet`): spike plates, swinging blades, fire jets and crumbling
// floor, for the corridors (corridor.js builds them from a layout).
//
//   import { createTrap, gauntletSfx } from './traps.js';
//   const trap = createTrap(spec, ctx);   // ctx: { group, D, tele (enemies' floor tiles) }
//   per tick:  trap.tick(t, hero)          // t: corridor ticks (the one clock every trap reads)
//              trap.tele(tele, t)          // draw its floor telegraph into the shared tiles
//   render:    trap.render(alpha, t)
//   the danger: trap.hits(x, z, r, t) -> false | { source: {x, z}, cause }
//               trap.timing()             -> { period, offset, segs: [[from, to, 'warn'|'hot'|'rest']] }
//               trap.phase(t)             -> 'rest' | 'warn' | 'hot' | 'cool'
//
// Every periodic trap is a pure function of the corridor clock t, so the demo pilot and the
// timing overlay can ask "is this spot hot at tick t + k?" without running anything.
// Crumbling floor is the one stateful trap: a column of tiles starts to shake the first
// tick the hero stands on it (not while dashing) and drops FALL ticks later.
//
// The telegraph language is the enemies' (enemies/telegraph.js): the danger zone's outline
// comes up in red at once, a checker fill grows toward the moment it bites, the outline
// blinks gold over the last quarter, and the zone flashes gold and red on the frame it hits.

import * as THREE from 'three';
import { defineModel, voxelMesh, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { feedback } from '../core/feedback.js';
import { events } from '../core/events.js';
import { settings } from '../core/settings.js';
import { display } from '../core/display.js';

const V = VOXEL;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------
// sound (stand-ins until the `audio` piece: gauntletSfx.enabled = false silences them)
// ---------------------------------------------------------------------------------------
let actx = null, aout = null, anoise = null, an = 0;
function ac() {
  if (!gauntletSfx.enabled) return null;
  if (actx) { if (actx.state === 'suspended') actx.resume().catch(() => {}); return actx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    actx = new AudioContext();
    aout = actx.createGain();
    aout.gain.value = 0.8;
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5;
    aout.connect(comp).connect(actx.destination);
    anoise = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = anoise.getChannelData(0);
    let s = 29;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  } catch { actx = null; return null; }
  return actx;
}
const avol = () => (settings.get('masterVolume') ?? 0.8) * (settings.get('sfxVolume') ?? 0.9);
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function nz(c, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.3, attack = 0.003 } = {}) {
  const src = c.createBufferSource(); src.buffer = anoise;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  const g = c.createGain(); env(g, t, attack, gain * avol(), dur);
  src.connect(f).connect(g).connect(aout);
  src.start(t, (an++ * 0.173) % 1.5, dur + attack + 0.05);
}
function tone(c, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 0.3, attack = 0.003 } = {}) {
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  const g = c.createGain(); env(g, t, attack, gain * avol(), dur);
  o.connect(g).connect(aout); o.start(t); o.stop(t + attack + dur + 0.05);
}
// v: 0..1 loudness (distance to the view), j: a small random pitch jitter
const play = (v, fn) => { if (v <= 0.02) return; const c = ac(); if (c) fn(c, c.currentTime, 1 + ((an++ * 37) % 9 - 4) * 0.02, v); };
/** How loud a sound at world x is, from the middle of the view (0 far off screen, 1 centred). */
export function near(x) { const cx = display.cameraTarget?.x ?? x; return Math.max(0, Math.min(1, 1.25 - Math.abs(x - cx) / 12)); }

export const gauntletSfx = {
  enabled: true,
  /** spikes rattling in their holes before they fire */
  rattle: (v) => play(v, (c, t, j, k) => { for (let i = 0; i < 3; i++) nz(c, t + i * 0.05, 0.03, { f0: 3800 * j, q: 8, gain: 0.07 * k }); }),
  /** spikes shooting up */
  spikes: (v) => play(v, (c, t, j, k) => {
    nz(c, t, 0.12, { type: 'highpass', f0: 4200 * j, f1: 2400, gain: 0.3 * k });
    tone(c, t, 0.22, { type: 'triangle', f0: 1480 * j, f1: 1400, gain: 0.05 * k });
    tone(c, t, 0.1, { f0: 140, f1: 60, gain: 0.25 * k });
  }),
  /** a blade passing the bottom of its arc */
  whoosh: (v) => play(v, (c, t, j, k) => { nz(c, t, 0.3, { f0: 500 * j, f1: 1900 * j, q: 2.5, gain: 0.22 * k, attack: 0.1 }); }),
  /** a fire jet's pilot hiss before it fires */
  hiss: (v) => play(v, (c, t, j, k) => { nz(c, t, 0.55, { type: 'highpass', f0: 2500 * j, f1: 5000, gain: 0.08 * k, attack: 0.3 }); }),
  /** the jet roaring out */
  roar: (v) => play(v, (c, t, j, k) => {
    nz(c, t, 0.75, { type: 'lowpass', f0: 1400 * j, f1: 300, gain: 0.4 * k, attack: 0.02 });
    nz(c, t, 0.6, { f0: 700 * j, f1: 400, q: 1.2, gain: 0.25 * k, attack: 0.01 });
    tone(c, t, 0.2, { f0: 90, f1: 50, gain: 0.25 * k });
  }),
  /** stone cracking under a foot */
  crack: (v) => play(v, (c, t, j, k) => {
    nz(c, t, 0.08, { f0: 2600 * j, q: 3, gain: 0.3 * k });
    nz(c, t + 0.06, 0.1, { f0: 1500 * j, q: 2, gain: 0.2 * k });
    tone(c, t, 0.12, { type: 'square', f0: 90 * j, f1: 55, gain: 0.05 * k });
  }),
  /** a floor tile dropping away */
  drop: (v) => play(v, (c, t, j, k) => {
    nz(c, t, 0.35, { type: 'lowpass', f0: 900 * j, f1: 120, gain: 0.35 * k });
    tone(c, t + 0.02, 0.4, { f0: 70, f1: 35, gain: 0.3 * k });
  }),
  /** the hero falling into a pit */
  fall: () => play(1, (c, t) => { tone(c, t, 0.6, { type: 'triangle', f0: 700, f1: 110, gain: 0.12 }); nz(c, t, 0.5, { f0: 900, f1: 300, q: 1, gain: 0.12, attack: 0.1 }); }),
  /** a boulder landing */
  thud: (v, big = false) => play(v, (c, t, j, k) => {
    tone(c, t, big ? 0.45 : 0.2, { f0: (big ? 70 : 110) * j, f1: 38, gain: (big ? 0.45 : 0.2) * k });
    nz(c, t, big ? 0.4 : 0.15, { type: 'lowpass', f0: 1400 * j, f1: 150, gain: (big ? 0.35 : 0.15) * k });
  }),
  /** the collapse cracking open: the start of the chase */
  quake: () => play(1, (c, t) => {
    tone(c, t, 1.2, { f0: 60, f1: 28, gain: 0.6 });
    nz(c, t, 1.4, { type: 'lowpass', f0: 1800, f1: 80, gain: 0.55 });
    for (let k = 0; k < 6; k++) nz(c, t + 0.1 + k * 0.13, 0.12, { f0: 1800 + (k % 3) * 600, q: 3, gain: 0.15 });
  }),
  /** the end gate slamming down */
  slam: () => play(1, (c, t) => {
    tone(c, t, 0.6, { f0: 85, f1: 30, gain: 0.75 });
    nz(c, t, 0.55, { type: 'lowpass', f0: 1800, f1: 90, gain: 0.55 });
    tone(c, t + 0.01, 0.9, { type: 'triangle', f0: 1175, f1: 1150, gain: 0.07 });
    tone(c, t + 0.01, 0.6, { type: 'square', f0: 392, f1: 388, gain: 0.04 });
  }),
  /** the collapse hitting the shut gate: a last muffled boom, then pebbles */
  boom: () => play(1, (c, t) => {
    tone(c, t, 1.1, { f0: 55, f1: 25, gain: 0.55 });
    nz(c, t, 0.9, { type: 'lowpass', f0: 600, f1: 60, gain: 0.5 });
    for (let k = 0; k < 7; k++) nz(c, t + 0.5 + k * 0.17 + (k % 2) * 0.05, 0.05, { f0: 2200 + k * 300, q: 6, gain: 0.08 / (1 + k * 0.3) });
  }),
  /** the release: a low, open chord that swells and fades */
  release: () => play(1, (c, t) => {
    [110, 164.8, 220, 277.2, 329.6].forEach((f, k) => tone(c, t + k * 0.09, 2.2 - k * 0.2, { type: k < 2 ? 'sine' : 'triangle', f0: f, gain: k < 2 ? 0.12 : 0.05, attack: 0.25 }));
  }),
  ctx: () => ac(),
  out: () => aout,
  noise: () => anoise,
  vol: avol,
};

// ---------------------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------------------
const PIN_H = 5;
const built = new Set();
function once(name, fn) { if (!built.has(name)) { built.add(name); defineModel(name, fn()); } return name; }

/** Where the spike pins stand in a plate (voxel offsets from its corner): the floor's holes match. */
export const pinAt = (vx, vz) => {
  const row = Math.floor(vz / 4);
  const px = (vx + (row % 2) * 2) % 4;
  return px >= 1 && px <= 2 && vz % 4 >= 1 && vz % 4 <= 2;
};

/** A bed of spikes covering w x d tiles: chunky pins every 4 voxels, rows staggered. Origin: the (x0, 0, z0) corner. */
function spikeModel(w, d) {
  return once(`gauntlet.spikes.${w}x${d}`, () => {
    const gx = Math.round(w * 8), gz = Math.round(d * 8);
    const g = new VoxelGrid(gx, PIN_H + 1, gz);
    for (let z = 1; z + 1 < gz; z += 4) for (let x = 1 - ((Math.floor(z / 4) % 2) * 2); x + 1 < gx; x += 4) {
      if (x < 1) continue;
      const tall = PIN_H - ((x * 7 + z * 13) % 3 === 0 ? 1 : 0);
      for (let y = 0; y < tall - 2; y++) g.box(x, y, z, x + 1, y, z + 1, y < 1 ? 'slate' : 'fog');
      const tx = x + ((x + z) % 2), tz = z + 1;
      g.set(tx, tall - 2, tz, 'frost'); g.set(tx, tall - 1, tz, 'white');
    }
    return { grid: g, origin: [0, 0, 0] };
  });
}

/** The swinging blade: a rod from the pivot and a crescent axe head. Origin: the pivot. */
const ROD = 28;         // voxels from the pivot to the head's top
const HEAD_H = 8;
const HEAD_W = 13;
export const BLADE = { length: (ROD + HEAD_H) * V, pivotY: 4.8, halfW: HEAD_W * V / 2 };
function bladeModel() {
  return once('gauntlet.blade', () => {
    const W = HEAD_W, H = ROD + HEAD_H + 2;
    const g = new VoxelGrid(W, H, 3);
    const cx = (W - 1) / 2;
    // rod: two voxels of dark iron with bands
    for (let y = HEAD_H; y < H - 1; y++) { g.set(cx, y, 1, y % 5 === 0 ? 'mist' : 'slate'); g.set(cx, y, 0, 'violet'); }
    // pivot collar
    g.box(cx - 1, H - 2, 0, cx + 1, H - 1, 2, 'slate'); g.set(cx, H - 1, 2, 'mist');
    // the head: a crescent, its cutting edge at the bottom
    for (let y = 0; y < HEAD_H; y++) for (let x = 0; x < W; x++) {
      const u = (x - cx) / (W / 2), v = y / HEAD_H;
      const lower = 0.05 + 0.5 * u * u;              // the curve of the edge
      const upper = 0.72 + 0.28 * (1 - Math.abs(u));
      if (v < lower || v > upper) continue;
      const edge = v < lower + 0.16;
      const col = edge ? (y === 0 || Math.abs(u) > 0.8 ? 'white' : 'frost') : (x + y) % 5 === 0 ? 'mist' : 'fog';
      g.set(x, y, 1, col);
      if (!edge) { g.set(x, y, 0, 'slate'); g.set(x, y, 2, 'slate'); }
    }
    // a rivet and old blood
    g.set(cx, HEAD_H - 2, 2, 'ink'); g.set(cx + 3, 2, 2, 'blood'); g.set(cx + 4, 3, 1, 'red');
    return { grid: g, origin: [cx + 0.5, H - 1, 1.5] };
  });
}

/** The beam a blade hangs from, across the corridor at the pivot height (built by corridor.js). */

/** Fire-jet nozzle: a skull set in the wall, its mouth dark, glowing, or blazing. */
function nozzleModel(state) {
  return once(`gauntlet.nozzle.${state}`, () => {
    const g = new VoxelGrid(9, 9, 4);
    const pat = [
      '..#####..',
      '.#######.',
      '##oo#oo##',
      '##oo#oo##',
      '#########',
      '.##.#.##.',
      '..#mmm#..',
      '..#mmm#..',
      '...###...',
    ];
    const mouth = state === 'dark' ? 'ink' : state === 'warm' ? 'blood' : 'torch';
    const eye = state === 'dark' ? 'ink' : state === 'warm' ? 'ember' : 'gold';
    pat.forEach((row, k) => {
      const y = 8 - k;
      for (let x = 0; x < 9; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        const c = ch === '#' ? ((x + y) % 4 === 0 ? 'frost' : 'bone') : ch === 'o' ? eye : mouth;
        const em = ch !== '#' && state !== 'dark';
        g.set(x, y, 2, c, em);
        if (ch === '#') g.set(x, y, 1, 'bone');
        if (ch === 'm') { g.set(x, y, 3, c, em); g.set(x, y, 1, c, em); }
      }
    });
    // a soot stain above
    return { grid: g, origin: [4.5, 0, 0] };
  });
}

/** One crumbling floor tile (a unit square, 3 voxels thick) with its cracks. */
function crumbleModel(v) {
  return once(`gauntlet.crumble.${v}`, () => {
    const g = new VoxelGrid(8, 3, 8);
    let s = 17 + v * 101;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
      const edge = x === 0 || z === 0 || x === 7 || z === 7;
      if (edge && r() < 0.18) continue;
      const c = r() < 0.12 ? 'stoneLight' : (x + z + v) % 7 === 0 ? 'dusk' : 'stone';
      g.set(x, 2, z, c); g.set(x, 1, z, 'stoneDark'); g.set(x, 0, z, 'stoneDark');
    }
    // cracks: a jagged line across the slab, clearly different from sound floor
    let x = 1 + (v % 3), z = 0;
    while (z < 8) {
      g.set(x, 2, z, 'ink');
      if (r() < 0.45) { x = Math.max(0, Math.min(7, x + (r() < 0.5 ? -1 : 1))); g.set(x, 2, z, 'ink'); }
      z++;
    }
    for (let k = 0; k < 4; k++) g.set(Math.min(7, k + 3 + (v % 2)), 2, 2 + v % 4 + (k >> 1), 'shadow');
    return { grid: g, origin: [0, 3, 0] };
  });
}

// ---------------------------------------------------------------------------------------
// traps
// ---------------------------------------------------------------------------------------
const mod = (a, n) => ((a % n) + n) % n;

class Periodic {
  constructor(spec) {
    this.spec = spec;
    this.kind = spec.kind;
    this.period = spec.period;
    this.offset = spec.offset ?? 0;
    this.last = 'rest';
  }
  u(t) { return mod(t + this.offset, this.period); }
  timing() { return { period: this.period, offset: this.offset, segs: this.segs }; }
  phase(t) {
    const u = this.u(t);
    for (const [a, b, s] of this.segs) if (u >= a && u < b) return s;
    return 'rest';
  }
  /** Ticks until the trap next turns hot (0 when hot now). */
  untilHot(t) {
    for (let k = 0; k < this.period; k++) if (this.phase(t + k) === 'hot') return k;
    return Infinity;
  }
}

// ---- spike plate ------------------------------------------------------------------------
export const SPIKE = { warn: 32, up: 44, down: 6 };
class Spikes extends Periodic {
  constructor(spec, ctx) {
    super(spec);
    const { x0, x1, z0, z1 } = spec;
    Object.assign(this, { x0, x1, z0, z1 });
    const W = SPIKE.warn, U = SPIKE.up;
    this.segs = [[0, W, 'warn'], [W, W + U + 3, 'hot'], [W + U + 3, W + U + SPIKE.down, 'cool'], [W + U + SPIKE.down, this.period, 'rest']];
    this.mesh = voxelMesh(spikeModel(x1 - x0, z1 - z0));
    this.mesh.position.set(x0, -0.72, z0);
    ctx.group.add(this.mesh);
    this.y = -0.72; this.py = -0.72;
    this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2;
  }
  heightAt(t) {
    const u = this.u(t), W = SPIKE.warn, U = SPIKE.up;
    if (u < W) return u > W * 0.5 ? (u % 4 < 2 ? -0.5 : -0.55) : -0.72;              // tips peek and rattle
    if (u < W + U) { const k = u - W; return k === 0 ? -0.2 : k === 1 ? 0.06 : k === 2 ? 0.02 : 0; }   // shoot, overshoot, settle
    if (u < W + U + SPIKE.down) return -0.72 * (u - W - U + 1) / SPIKE.down;
    return -0.72;
  }
  hits(x, z, r, t) {
    // they hurt while they stand up out of the floor (the up phase and the start of the drop)
    if (this.heightAt(t) < -0.36 || this.phase(t) === 'warn') return false;
    const m = r * 0.6;
    if (x < this.x0 - m || x > this.x1 + m || z < this.z0 - m || z > this.z1 + m) return false;
    return { source: { x: x - 0.8, z }, cause: 'spikes' };
  }
  tick(t) {
    this.py = this.y; this.y = this.heightAt(t);
    const u = this.u(t), W = SPIKE.warn;
    const v = near(this.cx);
    if (u === Math.round(W * 0.55) && v > 0) gauntletSfx.rattle(v * 0.8);
    if (u === W) {
      gauntletSfx.spikes(v);
      if (v > 0.3) feedback.shake(1, 80);
      // grit thrown up out of the holes
      for (let k = 0; k < 4; k++) vfx.dust(this.x0 + (k + 0.5) * (this.x1 - this.x0) / 4, this.cz + ((k * 7) % 5 - 2) * 0.35, { n: 2, size: 0.8, palette: 'dustDark', spread: 0.5 });
      for (let k = 0; k < 3; k++) vfx.core.add(this.x0 + (k + 0.5) * (this.x1 - this.x0) / 3, 0.65, this.cz + (k - 1) * 0.8, 0, 0.1, 0, 0.12, 2, 'sparkCool');
    }
    if (u === W - 1 && v > 0.3) for (let k = 0; k < 2; k++) vfx.dust(this.cx + (k - 0.5) * 0.6, this.cz, { n: 2, size: 0.6, palette: 'dustDark', spread: 0.8 });
  }
  tele(tele, t) {
    const u = this.u(t), W = SPIKE.warn;
    const ph = this.phase(t);
    if (ph === 'warn') this.rect(tele, u / W, t, false);
    else if (ph === 'hot' && u - W < 3) this.rect(tele, 1, t, true);
  }
  rect(tele, p, t, firing) {
    const { x0, x1, z0, z1 } = this;
    const cx = (x0 + x1) / 2;
    // the fill grows from the plate's centre outward, like a disc filling
    tele.lane(cx, z0, 0, z1 - z0, x1 - x0, p, { firing, t, start: 0.001 });
  }
  render(alpha) {
    this.mesh.position.y = this.py + (this.y - this.py) * alpha;
    this.mesh.visible = this.mesh.position.y > -0.71;
  }
  dispose() { this.mesh.removeFromParent(); }
}

// ---- swinging blade ---------------------------------------------------------------------
class Blade extends Periodic {
  constructor(spec, ctx) {
    super(spec);
    this.x = spec.x;
    this.A = spec.amp ?? 0.72;
    this.x0 = this.x - BLADE.halfW; this.x1 = this.x + BLADE.halfW;
    this.z0 = -ctx.D / 2; this.z1 = ctx.D / 2;
    this.mesh = voxelMesh(bladeModel());
    this.mesh.position.set(this.x, BLADE.pivotY, 0);
    ctx.group.add(this.mesh);
    this.th = 0; this.pth = 0;
    // "hot" for the overlay: the head is low enough to hit something standing
    const segs = [];
    let prev = null, from = 0;
    for (let u = 0; u <= this.period; u++) {
      const th = this.angle(u - this.offset);
      const s = u === this.period ? null : (this.tipY(th) < 1.3 && Math.abs(this.tipZ(th)) < 1.1 ? 'hot' : 'rest');
      if (s !== prev) { if (prev) segs.push([from, u, prev]); prev = s; from = u; }
    }
    this.segs = segs;
  }
  angle(t) { return this.A * Math.sin(TAU * this.u(t) / this.period); }
  tipZ(th) { return BLADE.length * Math.sin(th); }
  tipY(th) { return BLADE.pivotY - BLADE.length * Math.cos(th); }
  hits(x, z, r, t) {
    if (Math.abs(x - this.x) > BLADE.halfW + r * 0.7) return false;
    const th = this.angle(t);
    if (this.tipY(th) > 1.3) return false;
    // the head spans the last HEAD_H voxels of the arm, so it covers a short run of z
    const zA = this.tipZ(th), zB = (BLADE.length - HEAD_H * V) * Math.sin(th);
    const lo = Math.min(zA, zB) - 0.18 - r * 0.7, hi = Math.max(zA, zB) + 0.18 + r * 0.7;
    if (z < lo || z > hi) return false;
    const w = this.angle(t + 1) - th;
    return { source: { x: this.x, z: z - Math.sign(w || 1) * 0.8 }, cause: 'blade' };
  }
  tick(t) {
    this.pth = this.th; this.th = this.angle(t);
    const prev = this.angle(t - 1);
    // the whoosh as the head sweeps through the bottom of its arc
    if ((prev < 0) !== (this.th < 0)) {
      gauntletSfx.whoosh(near(this.x) * 0.9);
      if (near(this.x) > 0.4) {
        const dir = Math.sign(this.th - prev);
        for (let k = 0; k < 3; k++) {
          const i = vfx.core.add(this.x + (k - 1) * 0.5, 0.55, 0, 0, 0.3, dir * 6, 0.1, 1, 'soul', vfx.core.STREAK);
          if (i >= 0) { vfx.core.P.stretch[i] = 0.05; vfx.core.P.pop[i] = 1; }
        }
      }
    }
  }
  tele(tele, t) {
    const th = this.angle(t);
    // the head's shadow: a dark bar under it, red while it is low enough to cut
    const low = this.tipY(th) < 1.3;
    const z = this.tipZ(th);
    for (let dx = -BLADE.halfW + V / 2; dx < BLADE.halfW; dx += V) {
      tele.dot(this.x + dx, z, low ? 'red' : 'plum');
      if (low) tele.dot(this.x + dx, z + (this.angle(t + 1) > th ? -V : V), 'blood');
    }
    // the sweep's ends, marked on the floor at both walls
    for (const zz of [this.z0 + V / 2, this.z1 - V / 2]) { tele.dot(this.x - BLADE.halfW + V / 2, zz, 'plum'); tele.dot(this.x + BLADE.halfW - V / 2, zz, 'plum'); }
  }
  render(alpha) {
    const th = this.pth + (this.th - this.pth) * alpha;
    this.mesh.rotation.x = -th;
  }
  dispose() { this.mesh.removeFromParent(); }
}

// ---- fire jet -----------------------------------------------------------------------------
export const JET = { warn: 38, fire: 56 };
class Jet extends Periodic {
  constructor(spec, ctx) {
    super(spec);
    this.x = spec.x;
    this.D = ctx.D;
    this.reach = spec.reach ?? ctx.D;          // how far from the wall the flame reaches
    this.wz = -ctx.D / 2;
    this.x0 = this.x - 0.45; this.x1 = this.x + 0.45; this.z0 = this.wz; this.z1 = this.wz + this.reach;
    this.segs = [[0, JET.warn, 'warn'], [JET.warn, JET.warn + JET.fire, 'hot'], [JET.warn + JET.fire, this.period, 'rest']];
    this.models = ['dark', 'warm', 'hot'].map((s) => {
      const m = voxelMesh(nozzleModel(s));
      m.position.set(this.x, 0.2, this.wz - 3 * V);
      m.visible = s === 'dark';
      ctx.group.add(m);
      return m;
    });
    this.state = 'dark';
    this.anchor = new THREE.Object3D();
    this.anchor.position.set(this.x, 0, this.wz + this.reach * 0.45);
    ctx.group.add(this.anchor);
    this.light = null;
    this.group = ctx.group;
  }
  /** How far the flame has got out of the nozzle, 0..1 (it takes 4 ticks to reach full length). */
  flameK(t) {
    const u = this.u(t) - JET.warn;
    if (u < 0 || u >= JET.fire) return 0;
    return Math.min(1, (u + 1) / 4);
  }
  hits(x, z, r, t) {
    const k = this.flameK(t);
    if (!k) return false;
    if (Math.abs(x - this.x) > 0.45 + r * 0.7) return false;
    if (z - r * 0.6 > this.wz + this.reach * k) return false;
    return { source: { x: this.x, z: this.wz }, cause: 'fire' };
  }
  setModel(s) { if (s === this.state) return; this.state = s; this.models.forEach((m, k) => { m.visible = ['dark', 'warm', 'hot'][k] === s; }); }
  tick(t) {
    const u = this.u(t);
    const v = near(this.x);
    const W = JET.warn, F = JET.fire;
    const mz = this.wz + 0.12, my = 0.6;
    if (u < W) {
      this.setModel(u > W * 0.3 ? 'warm' : 'dark');
      if (u === 2) gauntletSfx.hiss(v * 0.8);
      // the pilot flame: drips of fire, then sputters over the last third
      if (u > W * 0.3 && u % 6 === 0) { const i = vfx.core.add(this.x + (u % 12 ? 0.1 : -0.1), my - 0.05, mz, 0, -0.6, 0.4, 0.4, 1, 'ember'); if (i >= 0) { vfx.core.P.grav[i] = 6; vfx.core.P.floorY[i] = 0.02; vfx.core.P.bounce[i] = 0.2; } }
      if (u > W * 0.66 && u % 3 === 0) {
        const i = vfx.core.add(this.x + ((u * 7) % 3 - 1) * 0.06, my, mz + 0.05, 0, 0.3, 1.8, 0.16, 3, 'fire', vfx.core.CUBE);
        if (i >= 0) vfx.core.P.pop[i] = 1.4;
      }
    } else if (u < W + F) {
      this.setModel('hot');
      const k = u - W;
      if (k === 0) {
        gauntletSfx.roar(v);
        if (v > 0.3) feedback.shake(1.5, 120);
        vfx.flash(this.x, my, mz + 0.2, { color: 'flame', size: 0.8, light: false });
        if (!this.light && look.lights) this.light = look.torch(this.anchor, { y: 0.7, color: 'flame', intensity: 2.2, radius: 5.5, flicker: 1.5 });
      }
      // the jet: hot cubes blasting out of the mouth, fanning and burning down the ramp
      const len = this.reach * this.flameK(t);
      const n = 5;
      for (let q = 0; q < n; q++) {
        const spd = 11 + ((q * 5 + k) % 4);
        const life = Math.max(0.06, (len + 0.2) / spd);
        const i = vfx.core.add(this.x + ((q * 3 + k) % 5 - 2) * 0.05, my + ((q + k) % 3 - 1) * 0.04, mz, ((q * 7 + k * 3) % 5 - 2) * 0.35, 0.6 + (q % 3) * 0.4, spd,
          life, q % 2 ? 4 : 5, 'fire', vfx.core.CUBE);
        if (i < 0) break;
        vfx.core.P.pop[i] = 1.2; vfx.core.P.shrinkAt[i] = 0.5; vfx.core.P.fadeAt[i] = 0.85; vfx.core.P.wob[i] = 2;
      }
      // the flame's end curls up into embers and smoke
      if (k % 2 === 0 && len > 1) {
        const i = vfx.core.add(this.x + ((k * 3) % 5 - 2) * 0.08, 0.5, this.wz + len, 0, 1.5, 0.5, 0.5, 3, 'fire', vfx.core.CUBE);
        if (i >= 0) { vfx.core.P.wob[i] = 3; vfx.core.P.pop[i] = 1; }
        if (k % 6 === 0) vfx.embers(this.x, 0.6, this.wz + len, { n: 3, spread: 0.3, up: 1 });
      }
      if (this.light) this.light.intensity = 2.2 + ((k * 5) % 3) * 0.3;
      if (k === F - 1) this.endLight();
    } else {
      this.setModel('dark');
      if (u === W + F + 2) vfx.dust(this.x, this.wz + 0.4, { dz: 1, n: 3, size: 0.9, palette: 'dustDark' });
      this.endLight();
    }
  }
  endLight() { if (this.light) { this.light.remove(); this.light = null; } }
  tele(tele, t) {
    const u = this.u(t), W = JET.warn;
    if (u < W) tele.lane(this.x, this.wz, 0, this.reach, 0.9, u / W, { firing: false, t, start: 0.12 });
    else if (u < W + 3) tele.lane(this.x, this.wz, 0, this.reach, 0.9, 1, { firing: true, t, start: 0.12 });
    else if (u < W + JET.fire) {
      // scorch under the flame while it burns
      const len = this.reach * this.flameK(t);
      for (let z = this.wz + V; z < this.wz + len; z += V) if ((Math.floor(z / V) + u) % 3 === 0) tele.dot(this.x + ((Math.floor(z / V) * 3) % 5 - 2) * V, z, 'blood');
    }
  }
  render() {}
  dispose() { this.endLight(); for (const m of this.models) m.removeFromParent(); this.anchor.removeFromParent(); }
}

// ---- crumbling floor --------------------------------------------------------------------
export const CRUMBLE = { fall: 26 };
class Crumble {
  constructor(spec, ctx) {
    this.spec = spec;
    this.kind = 'crumble';
    this.D = ctx.D;
    this.x0 = spec.x0; this.x1 = spec.x1; this.z0 = -ctx.D / 2; this.z1 = ctx.D / 2;
    this.rows = Math.round(ctx.D);
    this.cols = [];     // per column: { x, state: 'solid'|'shake'|'fall'|'gone', t, tiles: [{mesh, y, vy, py, spin}] }
    const broken = new Set(spec.broken ?? []);
    for (let x = this.x0; x < this.x1; x++) {
      const gone = broken.has(x - this.x0);
      const col = { x, state: gone ? 'gone' : 'solid', t: 0, fallAt: gone ? -9999 : Infinity, tiles: [] };
      if (!gone) for (let j = 0; j < this.rows; j++) {
        const m = voxelMesh(crumbleModel((x * 3 + j * 5) % 4));
        const z = -ctx.D / 2 + j;
        m.position.set(x, 0, z);
        ctx.group.add(m);
        col.tiles.push({ mesh: m, x, z, y: 0, py: 0, vy: 0, jig: 0 });
      }
      this.cols.push(col);
    }
  }
  col(x) { const i = Math.floor(x - this.x0); return i >= 0 && i < this.cols.length ? this.cols[i] : null; }
  /** Is there a hole under (x, z) at tick t (predicted for tiles already set to fall)? */
  pitAt(x, z, t) {
    const c = this.col(x);
    if (!c || z < this.z0 || z > this.z1) return false;
    return t >= c.fallAt;
  }
  /** Tiles you may stand on now (the pilot never plans to wait on these). */
  crumbly(x) { return !!this.col(x); }
  phase() { return 'rest'; }
  timing() { return null; }
  hits() { return false; }
  /** A column starts to go (the hero stepped on it, or the collapse reached it). */
  trigger(c, t, delay = CRUMBLE.fall) {
    if (c.state !== 'solid') return;
    c.state = 'shake'; c.t = 0; c.fallAt = t + delay;
    gauntletSfx.crack(near(c.x));
    for (let j = 0; j < this.rows; j += 2) vfx.dust(c.x + 0.5, -this.D / 2 + j + 0.5, { n: 2, size: 0.7, palette: 'dustDark', spread: 0.6 });
    events.emit('gauntlet:crumble', { x: c.x + 0.5 });
  }
  tick(t, hero, front = -Infinity) {
    if (hero && !hero.dashing) {
      const c = this.col(hero.x);
      if (c && c.state === 'solid' && hero.z > this.z0 && hero.z < this.z1) this.trigger(c, t);
    }
    for (const c of this.cols) {
      if (c.state === 'solid' && c.x < front + 0.5) this.trigger(c, t, 4);
      if (c.state === 'shake') {
        c.t++;
        for (const s of c.tiles) s.jig = (c.t + s.z * 3) % 4 < 2 ? V * 0.5 : -V * 0.5;
        if (c.t % 7 === 3) vfx.core.add(c.x + 0.2 + (c.t % 3) * 0.3, -0.1, -this.D / 2 + ((c.t * 3) % this.rows) + 0.5, 0, -1, 0, 0.5, 1, 'grit');
        if (t >= c.fallAt) {
          c.state = 'fall'; c.t = 0;
          gauntletSfx.drop(near(c.x));
          vfx.dust(c.x + 0.5, 0, { n: 5, size: 1.1, palette: 'dust', spread: 1.2 });
          c.tiles.forEach((s, j) => { s.vy = -0.5 - j * 0.3; s.jig = 0; s.spin = ((j * 5 + c.x) % 3 - 1) * 0.05; });
        }
      } else if (c.state === 'fall') {
        c.t++;
        for (const s of c.tiles) { s.py = s.y; s.vy -= 0.022; s.y += s.vy * 0.18; s.mesh.rotation.x += s.spin; }
        if (c.t > 45) { c.state = 'gone'; for (const s of c.tiles) s.mesh.visible = false; }
      }
    }
  }
  tele(tele, t) {
    // a shaking column is outlined red, filling as it gets closer to dropping
    for (const c of this.cols) {
      if (c.state !== 'shake') continue;
      const p = Math.min(1, c.t / CRUMBLE.fall);
      tele.lane(c.x + 0.5, this.z0, 0, this.D, 1, p, { t, start: 0.001 });
    }
  }
  render(alpha) {
    for (const c of this.cols) for (const s of c.tiles) {
      if (!s.mesh.visible) continue;
      s.mesh.position.set(s.x + (c.state === 'shake' ? s.jig : 0), s.py + (s.y - s.py) * alpha, s.z);
    }
  }
  dispose() { for (const c of this.cols) for (const s of c.tiles) s.mesh.removeFromParent(); }
}

const KINDS = { spikes: Spikes, blade: Blade, jet: Jet, crumble: Crumble };
/** Build a trap from a layout spec (corridor.js). */
export function createTrap(spec, ctx) {
  const K = KINDS[spec.kind];
  if (!K) throw new Error(`gauntlet: no trap kind "${spec.kind}"`);
  return new K(spec, ctx);
}
export const TRAP_KINDS = Object.keys(KINDS);
