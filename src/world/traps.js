// Gauntlet traps (piece `gauntlet`): spike strips, swinging axes, fire jets and crumbling tiles.
//
// Every timed trap runs on the corridor's tick clock (seconds = ticks / 60), so a corridor plays out the
// same way for the same seed. Every trap has the same three phases and shows each one:
//
//   safe   idle art, nothing happens
//   warn   the trap is about to bite: it changes shape, glows ember, sparks and shakes (about 0.5 s)
//   live   it hurts (1 hp). Dash i-frames beat it.
//
// Common interface (used by corridor.js and the timing overlay):
//   trap.kind                       'spikes' | 'blades' | 'jet' | 'tile'
//   trap.period                     seconds per cycle (timed traps)
//   trap.stateAt(sec)               'safe' | 'warn' | 'live'   (pure: the overlay samples it)
//   trap.tick(t)                    once per sim tick, t = corridor tick
//   trap.test(hx, hz)               true while the trap overlaps a hero standing there and is live
//   trap.render(alpha)              place meshes (texel-snapped)
//   trap.dispose()
//   trap.label {x, y, z}            where the timing overlay hangs its bar
//
// Events (core/events.js): 'gauntlet:trap' { kind, phase, x, z } on every phase change.

import * as THREE from 'three';
import { voxelMesh, getModel, defineModel, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { events } from '../core/events.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/index.js';
import { ramp, F_STRETCH, F_BOUNCE, F_TWINKLE, F_GROUND } from '../vfx/particles.js';
import { Rng } from '../core/rng.js';

const V = VOXEL;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const R = new Rng('gauntlet/traps');       // cosmetic randomness only (never affects timing or damage)
const rnd = (a, b) => a + (b - a) * R.next();
const snapV = new THREE.Vector3();
const snap = (x, y, z) => look.snap(snapV.set(x, y, z));

// ---- models ------------------------------------------------------------------------------------------

const made = new Set();
const once = (name, fn) => { if (!made.has(name)) { made.add(name); fn(name); } return name; };

/** Spike plate (floor grating with holes). variants: idle | warn | live. */
function plateModel(wv, dv, variant) {
  return once(`gauntlet.plate.${wv}x${dv}.${variant}`, (name) => {
    const g = new VoxelGrid(wv, 1, dv);
    const r = new Rng(`plate/${wv}/${dv}`);
    g.box(0, 0, 0, wv - 1, 0, dv - 1, 'stoneDark');
    for (let x = 0; x < wv; x++) for (let z = 0; z < dv; z++) {
      const edge = x === 0 || z === 0 || x === wv - 1 || z === dv - 1;
      if (edge) g.set(x, 0, z, (x + z) % 5 === 0 ? 'stoneLight' : 'stone');
      else if (x % 4 === 2 && z % 4 === 2) {
        g.set(x, 0, z, variant === 'idle' ? 'ink' : variant === 'warn' ? 'ember' : 'red', variant !== 'idle');
      } else if (r.chance(0.08)) g.set(x, 0, z, 'stone');
    }
    defineModel(name, { grid: g });
  });
}
function spikesModel(wv, dv) {
  return once(`gauntlet.spikes.${wv}x${dv}`, (name) => {
    const g = new VoxelGrid(wv, 6, dv);
    for (let x = 2; x < wv - 1; x += 4) for (let z = 2; z < dv - 1; z += 4) {
      g.box(x - 1, 0, z - 1, x, 1, z, 'mist');
      g.box(x - 1, 0, z - 1, x - 1, 1, z, 'fog');
      g.box(x, 2, z, x, 4, z, 'frost');
      g.set(x, 5, z, 'white');
      g.set(x - 1, 2, z - 1, 'fog');
    }
    defineModel(name, { grid: g, origin: [wv / 2, 0, dv / 2] });
  });
}

const BLADE_W = 14, BLADE_H = 10;
function bladeModel(dv, hot) {
  return once(`gauntlet.blade.${dv}.${hot ? 'hot' : 'cold'}`, (name) => {
    const g = new VoxelGrid(BLADE_W, BLADE_H, dv);
    // a crescent axe head seen from the side: narrow at the neck, wide and curved at the edge
    for (let y = 0; y < BLADE_H; y++) {
      const t = y / (BLADE_H - 1);                       // 0 = cutting edge, 1 = neck
      const half = 1.6 + (1 - t) * 5.2 - (y === 0 ? 1.5 : 0);
      for (let x = 0; x < BLADE_W; x++) {
        const d = Math.abs(x - (BLADE_W - 1) / 2);
        if (d > half) continue;
        for (let z = 0; z < dv; z++) {
          let c = y > BLADE_H - 3 ? 'mist' : (d > half - 1.2 ? 'fog' : 'slate');
          if (y === 0) c = 'white';
          if ((x + z) % 7 === 0 && y > 2 && y < BLADE_H - 2) c = 'blood';      // notches of old blood
          if (z === 0 || z === dv - 1) c = y === 0 ? 'white' : 'fog';
          g.set(x, y, z, c, hot && y === 0);
          if (hot && y === 1 && d < half - 1) g.set(x, y, z, 'ember', true);
        }
      }
    }
    // the eye that the rod goes through
    for (let z = 0; z < dv; z++) { g.set(6, BLADE_H - 1, z, 'stoneDark'); g.set(7, BLADE_H - 1, z, 'stoneDark'); }
    defineModel(name, { grid: g, origin: [BLADE_W / 2, BLADE_H, dv / 2] });
  });
}
function rodModel(len) {
  return once(`gauntlet.rod.${len}`, (name) => {
    const g = new VoxelGrid(2, len, 2);
    for (let y = 0; y < len; y++) g.box(0, y, 0, 1, y, 1, y % 4 === 0 ? 'fog' : 'mist');
    defineModel(name, { grid: g, origin: [1, len, 1] });
  });
}
function beamModel(len) {
  return once(`gauntlet.beam.${len}`, (name) => {
    const g = new VoxelGrid(4, 4, len);
    g.box(0, 0, 0, 3, 3, len - 1, 'stoneDark');
    for (let z = 0; z < len; z++) {
      g.set(1, 3, z, z % 6 < 3 ? 'stone' : 'stoneLight'); g.set(2, 3, z, 'stone');
      g.set(0, 1, z, 'ink'); g.set(3, 1, z, 'ink');
      if (z % 8 === 4) { g.set(1, 1, z, 'mist'); g.set(2, 2, z, 'mist'); }
    }
    defineModel(name, { grid: g, origin: [2, 4, len / 2] });
  });
}
function postModel(h) {
  return once(`gauntlet.post.${h}`, (name) => {
    const g = new VoxelGrid(3, h, 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) g.set(x, y, z, y % 6 === 5 ? 'fog' : (x === 0 ? 'stoneLight' : 'stone'));
    defineModel(name, { grid: g, origin: [1.5, 0, 1.5] });
  });
}
function sweepModel(wv, dv, variant) {
  return once(`gauntlet.sweep.${wv}x${dv}.${variant}`, (name) => {
    const g = new VoxelGrid(wv, 1, dv);
    const live = variant === 'live', warn = variant === 'warn';
    const col = live ? 'red' : warn ? 'flame' : 'slate';
    for (let x = 0; x < wv; x++) for (let z = 0; z < dv; z++) {
      const cap = x < 2 || x >= wv - 2;
      if (cap && z % 4 < 3) g.set(x, 0, z, col, live || warn);                              // the two ends of the sweep, a dashed rail
      else if ((z === 0 || z === dv - 1) && x % 4 < 2) g.set(x, 0, z, live ? 'red' : warn ? 'gold' : 'violet', live || warn);   // the lane's edges
      else if (live && (x + z) % 8 === 0) g.set(x, 0, z, 'red', true);                          // the whole zone is hot
      else if (warn && (x + z) % 12 === 0) g.set(x, 0, z, 'gold', true);
      else if (!live && !warn && (x + z) % 8 === 0) g.set(x, 0, z, 'dusk');
    }
    defineModel(name, { grid: g });
  });
}
function ventModel(variant) {
  return once(`gauntlet.vent.${variant}`, (name) => {
    const g = new VoxelGrid(11, 2, 11);
    for (let x = 0; x < 11; x++) for (let z = 0; z < 11; z++) {
      const d = Math.hypot(x - 5, z - 5);
      if (d > 5.4) continue;
      if (d > 4.3) { g.set(x, 0, z, 'stone'); g.set(x, 1, z, d > 4.9 ? 'stoneLight' : 'stone'); continue; }
      g.set(x, 0, z, 'ink');
      if (variant === 'idle') { if ((x + z) % 2 === 0 && d < 3.6 && d > 0.5) g.set(x, 0, z, 'stoneDark'); if (x === 5 || z === 5) g.set(x, 1, z, 'stoneDark'); }
      else { const c = variant === 'warn' ? (d < 2.2 ? 'flame' : 'ember') : (d < 2.2 ? 'white' : 'gold'); g.set(x, 0, z, c, true); if (x === 5 || z === 5) g.set(x, 1, z, 'stoneDark'); }
    }
    defineModel(name, { grid: g, origin: [5.5, 0, 5.5] });
  });
}
const JET_H = 26;
function jetModel(f) {
  return once(`gauntlet.jet.${f}`, (name) => {
    const g = new VoxelGrid(11, JET_H, 11);
    const r = new Rng(`jet/${f}`);
    const lean = [[0, 0], [1, 0], [-1, 0], [0, 1]][f];
    for (let y = 0; y < JET_H; y++) {
      const t = y / JET_H;
      const rad = (4.4 - t * 3.0) * (1 + Math.sin(y * 0.9 + f * 1.7) * 0.12);
      const cx = 5 + lean[0] * t * 2.4, cz = 5 + lean[1] * t * 2.4;
      for (let x = 0; x < 11; x++) for (let z = 0; z < 11; z++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d > rad + (r.next() < 0.3 ? 0.5 : 0) - (t > 0.75 && r.next() < 0.5 ? 0.9 : 0)) continue;
        const k = (d / Math.max(0.5, rad)) * 0.7 + t * 0.5;
        const c = k < 0.34 ? 'white' : k < 0.5 ? 'torch' : k < 0.68 ? 'gold' : k < 0.88 ? 'flame' : 'ember';
        g.set(x, y, z, c, true);
      }
    }
    defineModel(name, { grid: g, origin: [5.5, 0, 5.5] });
  });
}
/**
 * Crumbling tile, wv x dv voxels. sturdy: pale stone with a cyan rune (safe). fragile: dark, chipped,
 * an ember crack running through it. cracked: the same, mid-shake, the crack blazing.
 */
function tileModel(wv, dv, variant) {
  return once(`gauntlet.tile.${wv}x${dv}.${variant}`, (name) => {
    const g = new VoxelGrid(wv, 4, dv);
    const r = new Rng(`tile/${wv}/${dv}/${variant}`);
    const sturdy = variant === 'sturdy';
    for (let x = 0; x < wv; x++) for (let z = 0; z < dv; z++) {
      const edge = x === 0 || z === 0 || x === wv - 1 || z === dv - 1;
      g.box(x, 0, z, x, 2, z, sturdy ? 'stone' : 'stoneDark');
      g.set(x, 3, z, sturdy ? (edge ? 'mist' : (r.chance(0.12) ? 'fog' : 'slate')) : (edge ? 'stone' : (r.chance(0.25) ? 'dusk' : 'stone')));
    }
    if (sturdy) {
      // a cyan rune: this one holds
      const cx = wv >> 1, cz = dv >> 1;
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [2, 1], [0, -1], [1, 2]]) g.set(cx + dx, 3, cz + dz, 'cyan', true);
      for (const [x, z] of [[1, 1], [wv - 2, 1], [1, dv - 2], [wv - 2, dv - 2]]) g.set(x, 3, z, 'fog');
    } else {
      const glow = variant === 'cracked';
      // a thick jagged crack across the tile
      let x = r.int(3, wv - 4), z = 0;
      while (z < dv) {
        for (const dx of [0, 1]) { g.set(clamp(x + dx, 0, wv - 1), 3, z, glow ? 'gold' : 'ember', true); g.set(clamp(x + dx, 0, wv - 1), 2, z, glow ? 'flame' : 'blood', glow); }
        if (r.chance(0.5)) x = clamp(x + r.pick([-1, 1]), 1, wv - 3); else z++;
      }
      // chipped corners and edges
      for (const [cx, cz] of [[0, 0], [wv - 1, 0], [0, dv - 1], [wv - 1, dv - 1]]) if (r.chance(0.7)) { g.set(cx, 3, cz, null); g.set(cx + (cx ? -1 : 1), 3, cz, null); }
      for (let i = 0; i < 5; i++) g.set(r.int(1, wv - 2), 3, r.int(1, dv - 2), 'ink');
    }
    defineModel(name, { grid: g, origin: [wv / 2, 4, dv / 2] });
  });
}

// ---- base ----------------------------------------------------------------------------------------------

class TimedTrap {
  constructor({ period, warn, live, offset = 0 }) {
    this.period = period; this.warnLen = warn; this.liveLen = live; this.offset = offset;
    this.phase = 'safe';
    this.sec = 0;
  }
  /** Cycle order: safe ... warn, live. So the warning always sits right before the bite. */
  stateAt(sec) {
    const u = (((sec + this.offset) % this.period) + this.period) % this.period;
    const s = this.period - this.warnLen - this.liveLen;
    return u < s ? 'safe' : u < s + this.warnLen ? 'warn' : 'live';
  }
  /** 0..1 through the current phase. */
  progressAt(sec) {
    const u = (((sec + this.offset) % this.period) + this.period) % this.period;
    const s = this.period - this.warnLen - this.liveLen;
    return u < s ? u / s : u < s + this.warnLen ? (u - s) / this.warnLen : (u - s - this.warnLen) / this.liveLen;
  }
  cursor(sec) { return ((((sec + this.offset) % this.period) + this.period) % this.period) / this.period; }
  step(t) {
    this.sec = t / 60;
    if (this.buried) { this.phase = 'safe'; return; }
    const p = this.stateAt(this.sec);
    if (p !== this.phase) { const old = this.phase; this.phase = p; this.onPhase(p, old); events.emit('gauntlet:trap', { kind: this.kind, phase: p, x: this.x, z: this.z }); }
  }
  onPhase() {}
  /** The collapse has run over it: it is gone (hidden, silent, harmless). */
  bury() {
    if (this.buried) return;
    this.buried = true;
    for (const o of [this.group, this.beamMesh, this.sweep]) if (o) o.visible = false;
    this.light?.remove(); this.light = null;
    vfx.dust({ x: this.x, z: this.z, n: 4, size: 7, speed: 1.4, dx: 1, dz: 0 });
  }
}

// ---- spike strip ---------------------------------------------------------------------------------------

export class SpikeStrip extends TimedTrap {
  constructor(root, { x, z = 0, w = 1.1, d = 3.9, period = 2.2, warn = 0.6, live = 0.5, offset = 0 }) {
    super({ period, warn, live, offset });
    this.kind = 'spikes'; this.x = x; this.z = z; this.w = w; this.d = d;
    this.wv = Math.round(w * 8); this.dv = Math.round(d * 8);
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    root.add(this.group);
    this.plate = voxelMesh(plateModel(this.wv, this.dv, 'idle'));
    this.group.add(this.plate);
    this.spikes = voxelMesh(spikesModel(this.wv, this.dv));
    this.spikes.position.y = 1 * V;
    this.spikes.visible = false;
    this.group.add(this.spikes);
    this.ext = 0; this.extQ = 0; this.variant = 'idle';
    this.label = { x, y: 0.5, z: z - d / 2 - 0.1 };
  }
  onPhase(p) {
    if (p === 'live') {
      vfx.dust({ x: this.x, z: this.z + rnd(-1, 1), n: 6, size: 3, speed: 0.7 });
      const pp = vfx.pool;
      if (pp) for (let i = 0; i < 8; i++) pp.add(this.x + rnd(-this.w / 2, this.w / 2), 0.25, this.z + rnd(-this.d / 2, this.d / 2), rnd(-0.6, 0.6), rnd(1.4, 3), rnd(-0.6, 0.6), 0.35, 2, 1, ramp('white,frost,mist'), F_STRETCH, 0.94, 12);
    }
    if (p === 'warn') {
      const pp = vfx.pool;
      if (pp) for (let i = 0; i < 6; i++) pp.add(this.x + rnd(-this.w / 2, this.w / 2), 0.1, this.z + rnd(-this.d / 2, this.d / 2), 0, rnd(0.8, 1.6), 0, 0.5, 2, 1, ramp('gold,flame,ember'), F_TWINKLE, 0.96, 2);
    }
  }
  tick(t) {
    this.step(t);
    const p = this.phase;
    const target = p === 'live' ? 1 : p === 'warn' ? (Math.floor(t / 4) % 2 ? 0.34 : 0) : 0;
    this.ext += clamp(target - this.ext, -0.34, 0.34);
    this.extQ = Math.round(this.ext * 3) / 3;
    if (p === 'warn' && t % 9 === 0) {
      const pp = vfx.pool;
      if (pp) pp.add(this.x + rnd(-this.w / 2, this.w / 2), 0.1, this.z + rnd(-this.d / 2, this.d / 2), 0, rnd(0.6, 1.2), 0, 0.4, 2, 1, ramp('flame,ember'), F_TWINKLE, 0.96, 1);
    }
  }
  hitAt(sec, hx, hz, m = 0) { return this.stateAt(sec) === 'live' && Math.abs(hx - this.x) < this.w / 2 + 0.12 + m && Math.abs(hz - this.z) < this.d / 2 + 0.05 + m; }
  test(hx, hz) { return this.extQ >= 0.66 && this.hitAt(this.sec, hx, hz); }
  render() {
    const v = this.phase === 'live' ? 'live' : this.phase === 'warn' ? 'warn' : 'idle';
    if (v !== this.variant) { this.variant = v; this.plate.geometry = getModel(plateModel(this.wv, this.dv, v)).geometry; }
    this.spikes.visible = this.extQ > 0.01;
    this.spikes.scale.y = Math.max(0.01, this.extQ);
    // shake in the warning: the spikes rattle by a voxel
    this.spikes.position.x = this.phase === 'warn' ? ((Math.floor(this.sec * 30) % 2) ? V : -V) : 0;
  }
  dispose() { this.group.parent?.remove(this.group); }
}

// ---- swinging axe ----------------------------------------------------------------------------------------

const PIVOT_Y = 3.4, ROD = 22, AXE_L = ROD * V + 0.15, DANGER_Y = 0.95;

export class Blades extends TimedTrap {
  /** A pendulum hung from a beam over the lane band centred on z. period is the full swing there and back. */
  constructor(root, { x, z = 0, band = 1.7, period = 2.4, amp = 1.05, phase = 0, beam = true, D = 5 }) {
    super({ period, warn: 0, live: 0, offset: phase * period });
    this.kind = 'blades'; this.x = x; this.z = z; this.band = band; this.amp = amp; this.D = D;
    this.dv = Math.round(band * 8);
    this.group = new THREE.Group();
    this.group.position.set(x, PIVOT_Y, z);
    root.add(this.group);
    this.rod = voxelMesh(rodModel(ROD));
    this.group.add(this.rod);
    this.blade = voxelMesh(bladeModel(this.dv, false));
    this.blade.position.y = -ROD * V;
    this.group.add(this.blade);
    if (beam) {
      const len = Math.round((D + 0.5) * 8);
      this.beamMesh = voxelMesh(beamModel(len));
      this.beamMesh.rotation.y = 0;
      this.beamMesh.position.set(x, PIVOT_Y + 0.5, 0.05);
      this.beamMesh.rotation.y = Math.PI / 2 * 0;
      root.add(this.beamMesh);
    }
    this.sweepHalf = AXE_L * Math.sin(Math.acos((PIVOT_Y - DANGER_Y) / AXE_L)) + 0.35;
    const swv = Math.round(this.sweepHalf * 16);
    this.sweeps = { idle: sweepModel(swv, this.dv, 'idle'), warn: sweepModel(swv, this.dv, 'warn'), live: sweepModel(swv, this.dv, 'live') };
    this.sweep = voxelMesh(this.sweeps.idle);
    this.sweep.position.set(x - swv * V / 2, 0.01, z - this.dv * V / 2);
    look.noShadow(this.sweep);
    root.add(this.sweep);
    this.theta = 0; this.variant = 'idle'; this.hot = false; this.prevTheta = 0;
    this.label = { x, y: 0.2, z: z + band / 2 + 0.3 };
    this.root = root;
  }
  thetaAt(sec) { return this.amp * Math.sin(((sec + this.offset) / this.period) * TAU); }
  dangerAt(sec) { const th = this.thetaAt(sec); return PIVOT_Y - AXE_L * Math.cos(th) < DANGER_Y; }
  /** live: the axe is low. warn: it will be within 0.42 s. */
  stateAt(sec) {
    if (this.dangerAt(sec)) return 'live';
    for (let k = 1; k <= 6; k++) if (this.dangerAt(sec + k * 0.07)) return 'warn';
    return 'safe';
  }
  progressAt() { return 0; }
  bladeX() { return this.x + AXE_L * Math.sin(this.theta); }
  onPhase(p) {
    if (p === 'live') events.emit('gauntlet:whoosh', { x: this.x, z: this.z });
  }
  tick(t) {
    this.step(t);
    this.prevTheta = this.theta;
    this.theta = this.thetaAt(this.sec);
    // sparks and grit off the edge when it is low
    if (this.phase === 'live' && t % 3 === 0) {
      const pp = vfx.pool;
      if (pp) pp.add(this.bladeX() + rnd(-0.4, 0.4), 0.15, this.z + rnd(-this.band / 2, this.band / 2), Math.sign(this.theta - this.prevTheta) * rnd(0.5, 1.5), rnd(0.4, 1.4), 0, 0.28, 2, 1, ramp('white,gold,ember'), F_STRETCH, 0.92, 9);
    }
  }
  hitAt(sec, hx, hz, m = 0) {
    if (!this.dangerAt(sec)) return false;
    return Math.abs(hx - (this.x + AXE_L * Math.sin(this.thetaAt(sec)))) < 0.78 + m && Math.abs(hz - this.z) < this.band / 2 + 0.12 + m;
  }
  test(hx, hz) { return this.hitAt(this.sec, hx, hz); }
  render(alpha) {
    const th = this.prevTheta + (this.theta - this.prevTheta) * alpha;
    this.group.rotation.z = Math.round(th / 0.07) * 0.07;
    const hot = this.phase !== 'safe' && Math.abs(this.theta) < 0.75;
    if (hot !== this.hot) { this.hot = hot; this.blade.geometry = getModel(bladeModel(this.dv, hot)).geometry; }
    const v = this.phase === 'live' ? 'live' : this.phase === 'warn' ? 'warn' : 'idle';
    if (v !== this.variant) { this.variant = v; this.sweep.geometry = getModel(this.sweeps[v]).geometry; }
  }
  dispose() { this.group.parent?.remove(this.group); this.beamMesh?.parent?.remove(this.beamMesh); this.sweep.parent?.remove(this.sweep); }
}

// ---- fire jet ------------------------------------------------------------------------------------------------

export class FireJet extends TimedTrap {
  constructor(root, { x, z = 0, period = 2.4, warn = 0.65, live = 0.6, offset = 0, r = 0.55 }) {
    super({ period, warn, live, offset });
    this.kind = 'jet'; this.x = x; this.z = z; this.r = r;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    root.add(this.group);
    this.vent = voxelMesh(ventModel('idle'));
    look.noShadow(this.vent);
    this.group.add(this.vent);
    this.flame = voxelMesh(jetModel(0));
    for (let f = 1; f < 4; f++) jetModel(f);
    look.noShadow(this.flame);
    this.flame.visible = false;
    this.group.add(this.flame);
    this.small = voxelMesh('arena.flameS.0');
    this.small.visible = false;
    look.noShadow(this.small);
    this.group.add(this.small);
    this.ext = 0; this.light = null; this.variant = 'idle'; this.root = root;
    this.label = { x, y: 0.2, z: z + 0.8 };
  }
  onPhase(p, old) {
    if (p === 'warn') {
      this.light = look.torch(this.group, { x: 0, y: 0.5, z: 0, color: 'ember', intensity: 0.1, radius: 4.2, haze: 0, flicker: 0.6 });
    }
    if (p === 'live') {
      vfx.flash({ x: this.x, y: 0.5, z: this.z, color: 'flame', radius: 1.6, ms: 140 });
      vfx.dust({ x: this.x, z: this.z, n: 5, size: 3 });
    }
    if (p === 'safe' && this.light) { this.light.remove(); this.light = null; }
  }
  tick(t) {
    this.step(t);
    const p = this.phase;
    const target = p === 'live' ? 1 : 0;
    // ignite in 4 ticks, then die back in 6
    this.ext = clamp(this.ext + (target > this.ext ? 0.28 : -0.17), 0, 1);
    if (this.light) this.light.intensity = p === 'live' ? 1.5 : p === 'warn' ? 0.15 + 0.5 * this.progressAt(this.sec) : Math.max(0.1, this.ext * 1.5);
    const pp = vfx.pool;
    if (!pp) return;
    if (p === 'warn' && t % 2 === 0) pp.add(this.x + rnd(-0.25, 0.25), 0.1, this.z + rnd(-0.25, 0.25), rnd(-0.3, 0.3), rnd(1.4, 2.6), rnd(-0.3, 0.3), 0.5, 2, 1, ramp('gold,flame,ember'), F_TWINKLE, 0.95, 0);
    if (p === 'live') {
      for (let i = 0; i < 2; i++) pp.add(this.x + rnd(-0.3, 0.3), 1.0 + rnd(0, 1.4), this.z + rnd(-0.3, 0.3), rnd(-0.5, 0.5), rnd(1, 3), rnd(-0.5, 0.5), 0.6, 3, 1, ramp('white,gold,flame,ember,red'), F_TWINKLE, 0.96, -1);
    }
  }
  hitAt(sec, hx, hz, m = 0) { return this.stateAt(sec) === 'live' && Math.hypot(hx - this.x, hz - this.z) < this.r + 0.25 + m; }
  test(hx, hz) { return this.ext > 0.55 && this.hitAt(this.sec, hx, hz); }
  render() {
    const v = this.phase === 'live' ? 'live' : this.phase === 'warn' ? 'warn' : 'idle';
    if (v !== this.variant) { this.variant = v; this.vent.geometry = getModel(ventModel(v)).geometry; }
    const f = Math.floor(this.sec * 15) % 4;
    const big = this.ext > 0.05;
    this.flame.visible = big;
    if (big) {
      this.flame.geometry = getModel(jetModel((f + Math.round(this.x * 3)) & 3)).geometry;
      const q = Math.ceil(this.ext * 4) / 4;
      this.flame.scale.set(1, q * 1.12, 1);
    }
    const sm = this.phase === 'warn' && !big;
    this.small.visible = sm;
    if (sm) {
      this.small.geometry = getModel(`arena.flameS.${f}`).geometry;
      const k = this.progressAt(this.sec);
      this.small.scale.setScalar(0.7 + k * 1.1);
      this.small.position.y = 0.12;
    }
  }
  dispose() { this.light?.remove(); this.group.parent?.remove(this.group); }
}

// ---- crumbling tiles --------------------------------------------------------------------------------------------

export class CrumbleTile {
  constructor(root, { x, z, w = 1.35, d = 1.3, fragile = false }) {
    this.kind = 'tile'; this.x = x; this.z = z; this.w = w; this.d = d; this.fragile = fragile;
    this.wv = Math.round(w * 8); this.dv = Math.round(d * 8);
    this.mesh = voxelMesh(tileModel(this.wv, this.dv, fragile ? 'fragile' : 'sturdy'));
    this.mesh.position.set(x, -4 * V + 0.0 + 4 * V, z);
    root.add(this.mesh);
    this.state = 'solid';     // solid | shake | fall | gone
    this.st = 0; this.y = 0; this.vy = 0; this.spin = 0; this.spinV = 0; this.cracked = false;
    this.root = root;
  }
  get solid() { return this.state === 'solid' || this.state === 'shake'; }
  covers(hx, hz, grow = 0.1) { return Math.abs(hx - this.x) <= this.w / 2 + grow && Math.abs(hz - this.z) <= this.d / 2 + grow; }
  /** Step on it (fragile ones only start to go; sturdy ones stay). */
  touch() { if (this.fragile && this.state === 'solid') this.begin('shake'); }
  /** The collapse arrives: every tile goes, sturdy or not. */
  doom() { if (this.state === 'solid') this.begin('shake', 6); }
  begin(s, len) {
    this.state = s; this.st = 0; this.len = len ?? 14;
    if (s === 'shake') {
      this.mesh.geometry = getModel(tileModel(this.wv, this.dv, 'cracked')).geometry;
      events.emit('gauntlet:trap', { kind: 'tile', phase: 'warn', x: this.x, z: this.z });
    }
    if (s === 'fall') {
      this.vy = 0.5; this.spinV = (this.x * 7.3 % 1 - 0.5) * 0.06;
      vfx.dust({ x: this.x, z: this.z, n: 8, size: 4, speed: 0.8 });
      const pp = vfx.pool;
      if (pp) for (let i = 0; i < 9; i++) pp.add(this.x + rnd(-this.w / 2, this.w / 2), 0.1, this.z + rnd(-this.d / 2, this.d / 2), rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1), 0.7, 4, 2, ramp('stone,stoneDark'), F_BOUNCE, 0.97, 14);
      events.emit('gauntlet:trap', { kind: 'tile', phase: 'live', x: this.x, z: this.z });
    }
  }
  tick() {
    this.st++;
    if (this.state === 'shake') {
      if (this.st % 5 === 0) {
        const pp = vfx.pool;
        if (pp) pp.add(this.x + rnd(-this.w / 2, this.w / 2), 0.05, this.z + rnd(-this.d / 2, this.d / 2), 0, -0.4, 0, 0.5, 2, 1, ramp('stone,stoneDark'), 0, 0.96, 5);
      }
      if (this.st >= this.len) this.begin('fall');
    } else if (this.state === 'fall') {
      this.vy -= 0.045; this.y += this.vy * 0.5 - 0.02; this.spin += this.spinV;
      if (this.y < -5) { this.state = 'gone'; this.mesh.visible = false; }
    }
  }
  render() {
    if (this.state === 'shake') {
      const j = (Math.floor(this.st / 2) % 2 ? 1 : -1) * V;
      this.mesh.position.set(this.x + j * (this.st % 4 < 2 ? 1 : 0), 0, this.z + (this.st % 6 < 3 ? j : 0));
      this.mesh.position.y = (Math.floor(this.st / 3) % 2 ? -V : 0);
    } else if (this.state === 'fall') {
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.z = this.spin * this.st * 0.6; this.mesh.rotation.x = this.spin * this.st * 0.4;
    }
  }
  reset() {
    this.state = 'solid'; this.mesh.visible = true; this.mesh.position.set(this.x, 0, this.z); this.mesh.rotation.set(0, 0, 0);
    this.mesh.geometry = getModel(tileModel(this.wv, this.dv, this.fragile ? 'fragile' : 'sturdy')).geometry;
    this.y = 0;
  }
  dispose() { this.mesh.parent?.remove(this.mesh); }
}

// The gate that slams behind the hero: a thick stone slab with iron straps and a spiked foot, spanning the corridor.
export function gateModel(dv) {
  return once(`gauntlet.gate.${dv}`, (name) => {
    const H = 30, T = 9;
    const g = new VoxelGrid(T, H, dv);
    const r = new Rng('gate');
    for (let z = 0; z < dv; z++) for (let y = 0; y < H; y++) for (let x = 0; x < T; x++) {
      const face = x === 0 || x === T - 1;
      let c = face ? (((z >> 2) + (y >> 2)) % 3 === 0 ? 'dusk' : 'stone') : 'stoneDark';
      if (face && (y % 5 === 4 || (z + (y >> 2) * 3) % 8 === 7)) c = 'stoneDark';
      if (y < 3 && face) c = 'slate';
      g.set(x, y, z, c);
    }
    // iron straps and rivets, spikes along the foot
    for (const y of [6, 14, 22, H - 3]) for (let z = 0; z < dv; z++) for (const x of [0, T - 1]) { g.set(x, y, z, 'slate'); g.set(x, y + 1, z, z % 5 === 2 ? 'fog' : 'mist'); }
    for (let z = 1; z < dv; z += 4) for (let x = 1; x < T - 1; x += 3) { g.set(x, 0, z, null); g.set(x, 1, z, null); }
    for (let i = 0; i < 26; i++) g.set(r.pick([0, T - 1]), r.int(3, H - 2), r.int(1, dv - 2), 'ink');
    defineModel(name, { grid: g, origin: [T / 2, 0, dv / 2] });
  });
}

/** Support pillar for a swing beam's front end. */
export function beamPost(root, x, zFront, hUnits) {
  const m = voxelMesh(postModel(Math.round(hUnits * 8)));
  m.position.set(x, 0, zFront);
  root.add(m);
  return m;
}

export const TRAP_KINDS = { spikes: SpikeStrip, blades: Blades, jet: FireJet };
export { PIVOT_Y, AXE_L, DANGER_Y };
