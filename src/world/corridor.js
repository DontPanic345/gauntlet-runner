// Gauntlet corridors (piece `gauntlet`): a short, trap-filled run from an arch on the left to an arch on the
// right, chased by the collapse.
//
//   import { generateCorridor, Corridor, gauntletSfx } from '../world/corridor.js';
//   const layout = generateCorridor(seed, index);        // pure data: same seed and index give the same corridor
//   const cor = new Corridor(root, layout);
//   cor.bind({ hero });                                  // hero: a HeroHealth (x, z, ctl, hurt(), dead)
//   // hero.ctl.collision = cor.cw; setCollision(cor.cw); place the hero at cor.entryPoint, yaw = Math.PI / 2 (faces +x)
//   // each sim tick, AFTER combat/hero: cor.tick();   each render: cor.render(alpha);   each ui: cor.ui(g);
//   // exit: cor.dispose()
//
// State: ready -> chase -> escape -> escaped -> exited    (or -> failed if the hero dies)
//   ready     about 0.75 s of tremor and falling grit before the wall starts to move ("RUN!")
//   chase     the collapse advances; traps cycle; the pit tiles crumble
//   escape    the hero crossed the threshold: the gate slams behind, the collapse runs into it
//   escaped   the release beat: the rumble is gone, the light turns cyan, the exit arch is lit
//   exited    the hero walked into the arch (event 'gauntlet:exit')
//
// Events (core/events.js):
//   gauntlet:enter {index}          built and bound         gauntlet:go {index}           the chase begins
//   gauntlet:trap {kind,phase,x,z}  a trap changed phase    gauntlet:trapHit {kind,x,z}   a trap hurt the hero
//   gauntlet:dodge {kind,x,z}       a dash i-frame beat a live trap
//   gauntlet:fall {x,z}             the hero fell through the pit
//   gauntlet:catch {x,z}            the collapse reached the hero (lethal)
//   gauntlet:slam {x}               the gate hits the floor   gauntlet:collapseSlam {x}     the collapse hits the gate
//   gauntlet:release {time}         the release beat starts   gauntlet:exit {index}         run-flow should move on
//   gauntlet:fail {index}           the hero died here
// ('gauntlet:whoosh' and 'gauntlet:collapseStart' exist for sound.)

import * as THREE from 'three';
import { voxelMesh, getModel, disposeModel } from '../render/voxel/index.js';
import { Rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { world } from '../core/world.js';
import { loop } from '../core/loop.js';
import { debug } from '../core/debug.js';
import { display } from '../core/display.js';
import { feedback } from '../core/feedback.js';
import { settings } from '../core/settings.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { CollisionWorld } from '../core/collision.js';
import { look } from '../render/look.js';
import { css, hex } from '../render/palette.js';
import { vfx } from '../vfx/index.js';
import { buildFloor, buildBackWall, buildSideWall, ARCH, SW } from './tiles.js';
import './props.js';   // registers arena.sconce and the flame models
import { SpikeStrip, Blades, FireJet, CrumbleTile, beamPost, gateModel } from './traps.js';
import { Collapse, chase, TUNING } from './collapse.js';
import { ramp as vfxRamp } from '../vfx/particles.js';
import { sfxContext, makeNoiseBuffer } from '../audio/mixer.js';

export const D = 5;                       // corridor depth (units); the back wall's face is at z = -D/2
const HW = ARCH.hw / 8;
const ALCOVE = ARCH.depth / 8;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const TICK = 1 / 60;

// ---- layout ------------------------------------------------------------------------------------------------------

const SECTION_W = { spikes: 5.7, blades: 6.9, jets: 5.3, pit: 5.4 };
export const SECTION_NAMES = { spikes: 'SPIKE FLOOR', blades: 'SWINGING AXES', jets: 'FIRE VENTS', pit: 'CRUMBLING BRIDGE' };
const TITLES = ['THE FIRST DESCENT', 'THE BURNING STAIR', 'THE HANGING MILE', 'THE LAST RUN'];

/**
 * Pure data for corridor `index` (0..3 in a run) of the run with `seed`. Difficulty rises with `index`:
 * shorter cycles, and from the second corridor on the crumbling bridge appears. Traps are laid in sections
 * separated by breathing space; timings are exact numbers, so the overlay and the bot can read them.
 */
export function generateCorridor(seed = 1, index = 0) {
  const rng = new Rng(`gauntlet/${seed}/${index}`);
  const kinds = ['spikes', 'blades', 'jets', 'pit'];
  const pool = index === 0 ? ['blades', 'jets'] : kinds.filter((k) => k !== 'spikes');
  // shuffle
  for (let i = pool.length - 1; i > 0; i--) { const j = rng.int(0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const order = index === 0 ? ['spikes', ...pool] : (index === 1 ? [...pool.slice(0, 1), 'spikes', ...pool.slice(1)] : ['spikes', ...pool]);
  if (index >= 2) { const j = rng.int(0, order.length - 1); [order[0], order[j]] = [order[j], order[0]]; }
  const sc = 1 - 0.06 * index;                       // cycle length scale
  const traps = [], sections = [];
  let pit = null;
  let x = 9.6;
  const gap = 3.4;
  for (const kind of order) {
    const x0 = x, w = SECTION_W[kind];
    if (kind === 'spikes') {
      const P = 2.4 * sc, off = rng.range(0, P);
      // the offsets step back a little more than the runner's crossing time, so the safe window travels with you
      for (let k = 0; k < 3; k++) traps.push({ kind: 'spikes', x: x0 + 0.6 + k * 1.95, w: 1.1, d: 3.9, period: P, warn: 0.6, live: 0.4, offset: off - k * 0.3 });
    } else if (kind === 'blades') {
      const P = 2.4 * sc, off = rng.range(0, 0.5);
      for (let k = 0; k < 2; k++) {
        const bx = x0 + 1.7 + k * 3.4;
        traps.push({ kind: 'blades', x: bx, z: -0.95, band: 1.7, period: P, phase: off + k * 0.12, beam: true });
        traps.push({ kind: 'blades', x: bx, z: 0.95, band: 1.7, period: P, phase: off + k * 0.12 + 0.25, beam: false });
      }
    } else if (kind === 'jets') {
      const P = 2.4 * sc, off = rng.range(0, P);
      for (let row = 0; row < 2; row++) {
        const jx = x0 + 1.4 + row * 2.4;
        traps.push({ kind: 'jet', x: jx, z: -1.2, period: P, warn: 0.65, live: 0.6, offset: off + row * P * 0.25 });
        traps.push({ kind: 'jet', x: jx, z: 1.2, period: P, warn: 0.65, live: 0.6, offset: off + row * P * 0.25 });
        traps.push({ kind: 'jet', x: jx, z: 0, period: P, warn: 0.65, live: 0.6, offset: off + row * P * 0.25 + P / 2 });
      }
    } else {
      // crumbling bridge: 4 columns x 3 rows of tiles over a pit. A sturdy path zig-zags through; the cracked
      // (fragile) tiles drop a third of a second after you touch them.
      const rows = [-1.3, 0, 1.3], cols = 4, tw = w / cols;
      let r = rng.int(0, 2);
      const tiles = [];
      const pathRows = [];
      for (let c = 0; c < cols; c++) { pathRows.push(r); r = clamp(r + rng.pick([-1, 0, 1]), 0, 2); }
      for (let c = 0; c < cols; c++) for (let rr = 0; rr < 3; rr++) {
        const onPath = pathRows[c] === rr;
        if (!onPath && rng.chance(0.22 + 0.06 * index)) continue;       // a hole in the bridge
        tiles.push({ x: x0 + tw * (c + 0.5), z: rows[rr], w: tw, d: 1.3, fragile: !onPath });
      }
      pit = { x0, x1: x0 + w, tiles, pathRows, tw };
    }
    sections.push({ kind, x0, x1: x0 + w });
    x += w + gap;
  }
  const triggerX = x + 0.4;
  const gateX = triggerX - 1.5;
  const exitX = triggerX + 4.2;
  const W = Math.round((exitX + 3.4) * 4) / 4;
  const sconces = [];
  for (let sx = 6; sx < W - 2; sx += 6.4) if (Math.abs(sx - 2.6) > 1.2 && Math.abs(sx - exitX) > 2) sconces.push(sx);
  return {
    seed, index, name: TITLES[index % TITLES.length], W, D, sections, traps, pit, order,
    triggerX, gateX, exitX, entryX: 2.6, startX: 3.6, sconces, floorSeed: `${seed}.${index}`, sc,
  };
}

// ---- sound (stand-ins, synthesised; the audio piece may replace them on the same events) -----------------------------------

export const gauntletSfx = { enabled: true };
let ctx = null, out = null, nbuf = null, rum = null;
let listener = { x: 0, z: 0 };
// Routed through the audio piece's shared mixer (one AudioContext, one compressor) instead of
// opening its own; see audio/mixer.js's header.
function ac() {
  if (!gauntletSfx.enabled) return null;
  const m = sfxContext();
  if (!m) { ctx = null; return null; }
  ctx = m.ctx; out = m.out;
  if (!nbuf) nbuf = makeNoiseBuffer(ctx, 11, 2);
  return ctx;
}
const vol = () => (settings.get('masterVolume') ?? 0.8) * (settings.get('sfxVolume') ?? 0.9);
const envl = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
function tone(c, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 0.25, attack = 0.004 } = {}) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  envl(g, t, attack, gain * vol(), dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + attack + 0.05);
}
let nOff = 0;
function noise(c, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.25, attack = 0.004 } = {}) {
  const s = c.createBufferSource(); s.buffer = nbuf;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain(); envl(g, t, attack, gain * vol(), dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, (nOff++ * 0.173) % 1.2, dur + attack + 0.05);
}
const SFX = {
  spikeWarn(c, t, v) { tone(c, t, 0.09, { type: 'square', f0: 900, f1: 700, gain: 0.05 * v }); tone(c, t + 0.1, 0.09, { type: 'square', f0: 900, f1: 700, gain: 0.05 * v }); },
  spike(c, t, v) { noise(c, t, 0.12, { type: 'highpass', f0: 3000, f1: 7000, gain: 0.22 * v }); tone(c, t, 0.1, { type: 'square', f0: 1800, f1: 500, gain: 0.08 * v }); tone(c, t, 0.14, { type: 'sine', f0: 140, f1: 70, gain: 0.2 * v }); },
  whoosh(c, t, v) { noise(c, t, 0.32, { f0: 260, f1: 1500, q: 1.2, gain: 0.24 * v, attack: 0.1 }); tone(c, t + 0.05, 0.3, { type: 'triangle', f0: 100, f1: 60, gain: 0.06 * v }); },
  jetWarn(c, t, v) { noise(c, t, 0.5, { type: 'highpass', f0: 1800, f1: 3400, gain: 0.07 * v, attack: 0.3 }); tone(c, t, 0.5, { type: 'sawtooth', f0: 90, f1: 130, gain: 0.04 * v, attack: 0.3 }); },
  jet(c, t, v) { noise(c, t, 0.55, { type: 'lowpass', f0: 2600, f1: 500, gain: 0.34 * v, attack: 0.02 }); tone(c, t, 0.4, { type: 'sawtooth', f0: 150, f1: 60, gain: 0.1 * v }); },
  tile(c, t, v) { noise(c, t, 0.1, { f0: 1500, f1: 500, q: 2, gain: 0.12 * v }); tone(c, t, 0.06, { type: 'square', f0: 300, f1: 200, gain: 0.05 * v }); },
  tileFall(c, t, v) { noise(c, t, 0.5, { type: 'lowpass', f0: 1200, f1: 150, gain: 0.3 * v }); tone(c, t, 0.4, { type: 'sine', f0: 110, f1: 40, gain: 0.25 * v }); },
  fall(c, t) { tone(c, t, 0.6, { type: 'sine', f0: 620, f1: 90, gain: 0.16 }); noise(c, t + 0.55, 0.2, { type: 'lowpass', f0: 700, f1: 100, gain: 0.3 }); },
  hit(c, t) { noise(c, t, 0.18, { f0: 2400, f1: 500, q: 1.5, gain: 0.3 }); tone(c, t, 0.2, { type: 'sine', f0: 120, f1: 50, gain: 0.35 }); },
  dodge(c, t) { tone(c, t, 0.16, { type: 'triangle', f0: 880, f1: 1760, gain: 0.09 }); tone(c, t + 0.06, 0.2, { type: 'sine', f0: 1320, f1: 2200, gain: 0.05 }); },
  go(c, t) { tone(c, t, 1.0, { type: 'sawtooth', f0: 82, f1: 70, gain: 0.2, attack: 0.05 }); tone(c, t, 1.0, { type: 'sawtooth', f0: 123, f1: 105, gain: 0.1, attack: 0.05 }); noise(c, t, 0.9, { type: 'lowpass', f0: 500, f1: 150, gain: 0.35, attack: 0.1 }); },
  gate(c, t) {
    tone(c, t, 0.6, { type: 'sine', f0: 90, f1: 26, gain: 0.85 });
    noise(c, t, 0.45, { type: 'lowpass', f0: 1500, f1: 110, gain: 0.6 });
    for (let i = 0; i < 5; i++) tone(c, t + 0.03 + i * 0.05, 0.16, { type: 'square', f0: 2000 - i * 210, f1: 900, gain: 0.07 });
  },
  crash(c, t) {
    noise(c, t, 1.2, { type: 'lowpass', f0: 2200, f1: 80, gain: 0.7, attack: 0.01 });
    tone(c, t, 0.9, { type: 'sine', f0: 70, f1: 24, gain: 0.7 });
    for (let i = 0; i < 9; i++) noise(c, t + 0.08 + i * 0.09, 0.14, { f0: 1400 - i * 100, f1: 300, q: 2, gain: 0.12 });
  },
  release(c, t) {
    const n = [392, 523, 659, 784, 1047];
    n.forEach((f, i) => { tone(c, t + i * 0.1, 1.1, { type: 'triangle', f0: f, f1: f * 1.003, gain: 0.14, attack: 0.01 }); tone(c, t + i * 0.1, 0.9, { type: 'sine', f0: f * 2, f1: f * 2, gain: 0.04 }); });
    noise(c, t, 0.8, { type: 'highpass', f0: 3000, f1: 9000, gain: 0.05, attack: 0.03 });
  },
  catchDeath(c, t) { noise(c, t, 1.0, { type: 'lowpass', f0: 1800, f1: 60, gain: 0.6, attack: 0.01 }); tone(c, t, 0.8, { type: 'sine', f0: 100, f1: 20, gain: 0.7 }); },
};
const near = (x, z) => clamp(1.1 - Math.hypot(x - listener.x, z - listener.z) / 12, 0, 1);
const play = (fn, x, z) => { const c = ac(); if (!c) return; const v = x === undefined ? 1 : near(x, z); if (v > 0.05) fn(c, c.currentTime + 0.001, v); };
events.on('gauntlet:trap', (e) => {
  if (e.kind === 'spikes') play(e.phase === 'warn' ? SFX.spikeWarn : e.phase === 'live' ? SFX.spike : () => {}, e.x, e.z);
  else if (e.kind === 'jet') play(e.phase === 'warn' ? SFX.jetWarn : e.phase === 'live' ? SFX.jet : () => {}, e.x, e.z);
  else if (e.kind === 'tile') play(e.phase === 'warn' ? SFX.tile : SFX.tileFall, e.x, e.z);
});
events.on('gauntlet:whoosh', (e) => play(SFX.whoosh, e.x, e.z));
events.on('gauntlet:trapHit', () => play(SFX.hit));
events.on('gauntlet:dodge', () => play(SFX.dodge));
events.on('gauntlet:fall', () => play(SFX.fall));
events.on('gauntlet:go', () => play(SFX.go));
events.on('gauntlet:slam', () => play(SFX.gate));
events.on('gauntlet:collapseSlam', () => play(SFX.crash));
events.on('gauntlet:release', () => play(SFX.release));
events.on('gauntlet:catch', () => play(SFX.catchDeath));

/** The rumble: a looping low noise bed plus a sub tone, driven by chase.level. Called every tick by the corridor. */
function rumble(level) {
  const c = ac();
  if (!c) return;
  if (!rum) {
    const s = c.createBufferSource(); s.buffer = nbuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.value = 0;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 43;
    const og = c.createGain(); og.gain.value = 0;
    const lfo = c.createOscillator(); lfo.frequency.value = 6.5; const lg = c.createGain(); lg.gain.value = 0.35;
    lfo.connect(lg).connect(g.gain);
    s.connect(f).connect(g).connect(out); o.connect(og).connect(out);
    s.start(); o.start(); lfo.start();
    rum = { g, og, f, o };
  }
  const v = vol();
  rum.g.gain.setTargetAtTime(level * 0.5 * v, c.currentTime, 0.12);
  rum.og.gain.setTargetAtTime(level * 0.12 * v, c.currentTime, 0.12);
  rum.f.frequency.setTargetAtTime(140 + level * 380, c.currentTime, 0.2);
  rum.o.frequency.setTargetAtTime(38 + level * 14, c.currentTime, 0.2);
}

// ---- the corridor ------------------------------------------------------------------------------------------------------------

let current = null;
export const currentCorridor = () => current;
let seq = 0;

export class Corridor {
  constructor(root, layout, opts = {}) {
    this.layout = layout; this.W = layout.W; this.D = layout.D;
    this.index = layout.index;
    this.seq = ++seq;
    this.group = new THREE.Group();
    this.group.name = `corridor.${layout.index}`;
    root.add(this.group);
    this.root = root;
    this.cw = new CollisionWorld();
    this.traps = []; this.tiles = []; this.sconces = []; this.modelNames = [];
    this.t = 0;                 // sim ticks since built
    this.state = 'ready';
    this.hero = null;
    this.overlay = !!opts.overlay;
    this.lightsOn = opts.lights !== false && look.lights;
    this.banner = { text: '', t: 999, color: 'ember' };
    this.gate = { meshes: [], y: 10, vy: 0, state: 'up', t: 0 };
    this.exitLight = null;
    this.escapeT = -1; this.releaseT = -1; this.time = 0; this.minGap = 99; this.hits = 0; this.dodges = 0;
    this.lastDodge = new Map();
    this._offs = [];
    this.build();
    current = this;
    this.collapse = new Collapse(root, { x: -2.2, D: this.D, lights: this.lightsOn });
    this.collapse.setRain(0);
    this.prevMood = look.lights ? look.lights.moodName : 'crypt';
    look.mood('collapse'); vfx.ambient.mood('collapse');
    world.room = { index: layout.index, kind: 'corridor', id: 'gauntlet', name: layout.name };
    this.syncRoom();
    events.emit('gauntlet:enter', { index: layout.index });
  }

  // ---- geometry helpers --------------------------------------------------------------------------------------------------
  get entryPoint() { return { x: this.layout.startX, z: 0.4 }; }
  get exitPoint() { return { x: this.layout.exitX, z: -this.D / 2 - 0.2 }; }
  get bounds() { return { minX: 0, maxX: this.W, minZ: -this.D / 2, maxZ: this.D / 2 }; }
  get name() { return this.layout.name; }
  get progress() { const h = this.hero; return h ? clamp((h.x - this.layout.startX) / (this.layout.triggerX - this.layout.startX), 0, 1) : 0; }
  /** Camera limits for CameraRig: the view keeps the corridor's ends off screen. */
  get cameraBounds() { return { minX: 5.5, maxX: this.W - 6.5, minZ: -0.9, maxZ: -0.3 }; }

  syncRoom() {
    if (world.room && world.room.id === 'gauntlet') Object.assign(world.room, { state: this.state, gap: +this.collapse?.gap?.toFixed(2), front: +this.collapse?.x?.toFixed(2), progress: +this.progress.toFixed(3) });
  }

  // ---- build -------------------------------------------------------------------------------------------------------------------
  build() {
    const L = this.layout, W = L.W;
    const key = `${L.floorSeed}.${this.seq}`;
    const name = (n) => { const full = `gauntlet.${n}.${key}`; this.modelNames.push(full); return full; };
    const cw = this.cw, g = this.group;
    const useLights = this.lightsOn;

    // floor: one slab, or two with the pit between them
    const segs = L.pit ? [[0, L.pit.x0], [L.pit.x1, W]] : [[0, W]];
    segs.forEach(([a, b], i) => {
      const sw = Math.round((b - a - 1) * 4) / 4, nm = name(`floor${i}`);
      const blood = [{ x: (i * 7 % 5 - 2) * 1.1, z: 1.4, r: 0.6 }];
      buildFloor(nm, sw, D, `${L.floorSeed}/${i}`, {
        pattern: i ? 'large' : 'flags', moss: 0.25, cracks: 26, pebbles: 34, blood,
        inlay: [{ type: 'line', x0: -sw / 2 + 0.8, z0: -1.9, x1: sw / 2 - 0.8, z1: -1.9, w: 1, color: 'slate' }, { type: 'line', x0: -sw / 2 + 0.8, z0: 2.05, x1: sw / 2 - 0.8, z1: 2.05, w: 1, color: 'slate' }],
      });
      const m = voxelMesh(nm);
      m.position.set((a + b) / 2, 0, 0);
      g.add(m);
    });
    // back wall with the two arches, side walls
    const wn = name('wall');
    const pil = [];
    for (let px = 4.6; px < W - 3; px += 6.4) pil.push(px + 3.2 - W / 2);
    buildBackWall(wn, W, [L.entryX - W / 2, L.exitX - W / 2], L.floorSeed, { style: 'brick', pilasters: pil.filter((p) => Math.abs(p + W / 2 - L.entryX) > 1.4 && Math.abs(p + W / 2 - L.exitX) > 1.4), moss: 0.25 });
    const wall = voxelMesh(wn);
    wall.position.set(W / 2, 0, -D / 2);
    g.add(wall);
    const sn = name('side');
    buildSideWall(sn, D, L.floorSeed, { moss: 0.3 });
    for (const s of [-1, 1]) {
      const m = voxelMesh(sn);
      m.position.set(s < 0 ? 0 : W, 0, -D / 2 + 4 / 8);
      if (s < 0) m.scale.x = -1;
      g.add(m);
    }

    // collision: the back wall (entry arch sealed, exit arch open), the ends, the front edge
    const zb = -D / 2, zbBack = zb - ALCOVE - 0.35;
    const eA = L.entryX, xA = L.exitX;
    cw.addBox(-1.5, zbBack, eA + HW + 0.02, zb, 'wall');
    cw.addBox(eA + HW + 0.02, zbBack, xA - HW - 0.02, zb, 'wall');
    cw.addBox(xA + HW + 0.02, zbBack, W + 1.5, zb, 'wall');
    cw.addBox(xA - HW, zbBack, xA + HW, zb - ALCOVE - 0.05, 'wall');
    cw.addBox(-1.5, zbBack, 0, D / 2 + 1, 'wall');
    cw.addBox(W, zbBack, W + 1.5, D / 2 + 1, 'wall');
    cw.addBox(-1.5, D / 2, W + 1.5, D / 2 + 1.5, 'edge');

    // the entry: a portcullis, down and rusted shut
    {
      const gt = voxelMesh('arena.gate');
      gt.position.set(eA, 0, zb - 0.5);
      g.add(gt);
      const rune = voxelMesh('arena.rune.ember');
      rune.position.set(eA, 6 / 8 + 3.2, zb - 0.31 + 0.02);
      rune.visible = false;
      g.add(rune);
    }
    // the exit arch's light: ember while the collapse runs, cyan after
    if (useLights) this.exitLight = look.torch(g, { x: xA, y: 1.3, z: zb + 0.8, color: 'ember', intensity: 0.7, radius: 4.4, haze: 0, flicker: 0.5 });

    // sconces: bracket, flame, light
    for (const sx of L.sconces) {
      const m = voxelMesh('arena.sconce');
      m.position.set(sx, 2.05, zb + 0.02);
      g.add(m);
      const f = voxelMesh('arena.flameS.0');
      f.position.set(sx, 2.05 + 0.66, zb + 0.24);
      g.add(f);
      look.noShadow(f);
      const light = useLights ? look.torch(m, { x: 0, y: 0.85, z: 0.45, intensity: 0.9, radius: 5.4, haze: 1 }) : null;
      this.sconces.push({ flame: f, light, phase: sx * 3.1 });
    }
    // warm washes low on the wall between the sconces, so the floor and bricks read all the way along
    if (useLights) for (let wx = 3.2; wx < W; wx += 6.4) look.torch(g, { x: wx, y: 1.5, z: zb + 1.3, intensity: 0.75, radius: 8, haze: 0, flicker: 0.5, color: 'flame' });

    // traps
    for (const s of L.traps) {
      let tr;
      if (s.kind === 'spikes') tr = new SpikeStrip(g, s);
      else if (s.kind === 'blades') tr = new Blades(g, { ...s, D });
      else tr = new FireJet(g, s);
      this.traps.push(tr);
    }
    // one support post per axe beam, at the front end
    this.posts = [];
    for (const tr of this.traps) if (tr.kind === 'blades' && tr.beamMesh) this.posts.push({ x: tr.x, mesh: beamPost(g, tr.x, D / 2 + 0.28, 3.9) });
    // the pit
    if (L.pit) {
      const p = L.pit;
      const px0 = p.x0, px1 = p.x1;
      // the void: a dark shaft with embers glowing far below
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(px1 - px0 + 0.02, 4, D + 0.6), new THREE.MeshBasicMaterial({ color: hex('night') }));
      shaft.position.set((px0 + px1) / 2, -2.7, 0.15);
      look.noOutline(shaft);
      g.add(shaft);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(px1 - px0, 0.05, D), new THREE.MeshBasicMaterial({ color: hex('blood') }));
      glow.position.set((px0 + px1) / 2, -4.6, 0.15);
      look.noOutline(glow);
      g.add(glow);
      this.pitGlow = glow;
      for (const t of p.tiles) this.tiles.push(new CrumbleTile(g, t));
      if (useLights) this.pitLight = look.torch(g, { x: (px0 + px1) / 2, y: -1.5, z: 0.2, color: 'ember', intensity: 0.55, radius: 6, haze: 0, flicker: 0.9 });
    }
    // the gate that will slam behind the hero (two portcullis halves turned across the corridor)
    {
      const m = voxelMesh(gateModel(Math.round((D + 0.6) * 8)));
      m.position.set(L.gateX, 10, 0.05);
      m.visible = false;
      g.add(m);
      this.gate.meshes.push(m);
    }
  }

  // ---- bind ----------------------------------------------------------------------------------------------------------------------
  bind({ hero }) {
    this.hero = hero;
    this.ctl = hero.ctl;
    listener = hero;
    this.state = 'ready'; this.t = 0;
    this.banner = { text: 'RUN!', t: 0, color: 'ember', big: true };
    this.syncRoom();
    return this;
  }

  /** Skip ahead: put the hero at x with the chase already running and the wall 7 units behind. */
  jump(x) {
    const h = this.hero;
    if (!h) return;
    this.t = Math.max(this.t, 60);
    h.ctl.teleport(x, 0.2, Math.PI / 2);
    if (this.state === 'ready') { this.state = 'chase'; this.collapse.start(); this.collapse.setRain(1); }
    this.collapse.x = x - 7; this.collapse.speed = 2.4;
    for (const tl of this.tiles) if (tl.x < this.collapse.x) tl.doom();
  }

  // ---- tick ------------------------------------------------------------------------------------------------------------------------
  tick() {
    const h = this.hero;
    if (!h) return;
    this.t++;
    const L = this.layout;
    listener = h;
    const st = this.state;
    if (st === 'ready') {
      this.collapse.setRain(clamp(this.t / 45, 0, 0.6));
      if (this.t === 1) { feedback.shake(3, 500); vfx.embers({ x: 0.5, y: 2, z: 0, n: 10 }); }
      if (this.t === 44) { this.collapse.start(); this.state = 'chase'; events.emit('gauntlet:go', { index: this.index }); feedback.shake(5, 500); this.collapse.setRain(1); }
      chase.level = clamp(this.t / 45, 0, 1) * 0.35; chase.active = true;
    }
    // traps run on the corridor clock the whole time (the timing overlay shows the same clock)
    for (const tr of this.traps) if (!tr.buried) tr.tick(this.t);
    for (const tl of this.tiles) tl.tick();
    if (this.state === 'chase' || this.state === 'escape') this.time += TICK;

    if (this.state === 'chase' || this.state === 'ready') this.heroChecks(h);

    // the collapse
    if (this.state !== 'ready') {
      this.collapse.tick(h.x, this.ctl.speed ?? 0, this.progress);
      this.minGap = Math.min(this.minGap, this.collapse.gap);
      if (this.state === 'chase') {
        // it swallows what it passes
        for (const tr of this.traps) if (!tr.buried && tr.x + 0.8 < this.collapse.x) tr.bury();
        for (const p of this.posts) if (p.mesh.visible && p.x + 0.8 < this.collapse.x) p.mesh.visible = false;
        for (const tl of this.tiles) if (tl.x < this.collapse.x + 0.3 && tl.state === 'solid') tl.doom();
        if (this.collapse.caught(h.x) && !h.dead) this.catchHero(h);
        // a red pulse at the screen edge when it is right behind you
        if (this.collapse.gap < 3.2 && this.t % 24 === 0) feedback.flash('ember', 160, 0.07 + 0.05 * clamp((3.2 - this.collapse.gap) / 3.2, 0, 1));
        // threshold: the hero is out
        if (h.x > L.triggerX && !h.dead) this.beginEscape();
      }
    } else this.collapse.tick(h.x, 0, 0);

    if (this.state === 'escape') this.escapeStep();
    if (this.state === 'escaped' || this.state === 'exited') this.releaseStep(h);

    if (h.dead && this.state !== 'failed' && this.state !== 'escaped' && this.state !== 'exited') {
      this.state = 'failed';
      this.banner = { text: 'BURIED', t: 0, color: 'red', big: true };
      events.emit('gauntlet:fail', { index: this.index });
    }
    if (this.banner) this.banner.t++;
    // sconce flame frames
    if (this.t % 4 === 0) for (const s of this.sconces) s.flame.geometry = getModel(`arena.flameS.${(Math.floor(this.t / 4) + Math.floor(Math.abs(s.phase) * 5)) % 4}`).geometry;
    if (this.pitLight) this.pitLight.intensity = 0.45 + 0.2 * Math.sin(this.t * 0.11);
    rumble(this.state === 'failed' ? chase.level * 0.5 : chase.level);
    if (this.t % 6 === 0) this.syncRoom();
  }

  heroChecks(h) {
    const c = this.ctl;
    if (h.dead) return;
    // traps
    for (const tr of this.traps) {
      if (tr.buried || Math.abs(tr.x - h.x) > 3) continue;
      if (tr.test(h.x, h.z)) {
        const r = h.hurt(1, { x: tr.kind === 'blades' ? tr.bladeX() : tr.x, z: tr.z });
        if (r.ok) { this.hits++; events.emit('gauntlet:trapHit', { kind: tr.kind, x: tr.x, z: tr.z }); vfx.hit({ x: h.x, y: 0.8, z: h.z, dx: 0, dz: 1, power: 1.2, style: 'hurt' }); }
        else if (r.reason === 'dodged') {
          const last = this.lastDodge.get(tr) ?? -99;
          if (this.t - last > 30) {
            this.lastDodge.set(tr, this.t); this.dodges++;
            events.emit('gauntlet:dodge', { kind: tr.kind, x: tr.x, z: tr.z });
            vfx.pickup({ x: h.x, y: 0.7, z: h.z, style: 'magic' });
            feedback.hitstop(45);
          }
        }
      }
    }
    // the bridge
    const p = this.layout.pit;
    if (p) {
      let supported = false;
      for (const tl of this.tiles) if (tl.solid && tl.covers(h.x, h.z, 0.12)) { supported = true; tl.touch(); }
      const over = h.x > p.x0 + 0.05 && h.x < p.x1 - 0.05;
      if (over && !supported && c.state !== 'dash') this.fall(h);
    }
  }

  fall(h) {
    const p = this.layout.pit;
    const safeX = p.x0 - 0.7;
    vfx.dust({ x: h.x, z: h.z, n: 8, size: 5, speed: 1.2 });
    const fx = h.x, fz = h.z;
    const r = h.hurt(1, null, { force: false });
    this.hits++;
    events.emit('gauntlet:fall', { x: fx, z: fz });
    if (!h.dead) { this.ctl.teleport(safeX, clamp(h.z, -1.5, 1.5)); }
    vfx.embers({ x: fx, y: -0.5, z: fz, n: 12 });
    void r;
  }

  catchHero(h) {
    events.emit('gauntlet:catch', { x: h.x, z: h.z });
    h.hurt(99, { x: this.collapse.x - 1, z: h.z }, { force: true });
    feedback.shake(9, 600); feedback.flash('ember', 260, 0.4);
    vfx.flash({ x: h.x, y: 1, z: h.z, color: 'ember', radius: 3.4, ms: 300 });
    vfx.shockwave({ x: h.x, z: h.z, radius: 3, style: 'ember' });
    vfx.embers({ x: h.x, y: 0.8, z: h.z, n: 30 });
    vfx.dust({ x: h.x, z: h.z, n: 10, size: 8, speed: 1.6, dx: 1, dz: 0 });
  }

  beginEscape() {
    this.state = 'escape'; this.escapeT = 0;
    const L = this.layout;
    for (const m of this.gate.meshes) { m.visible = true; m.position.y = 10; }
    this.gate.y = 10; this.gate.vy = 0; this.gate.state = 'fall';
    this.collapse.halt(L.gateX - 0.6);
    this.banner = null;
    events.emit('gauntlet:escape', { index: this.index });
  }

  escapeStep() {
    const L = this.layout, gate = this.gate;
    this.escapeT++;
    if (gate.state === 'fall') {
      gate.vy -= 0.06; gate.y += gate.vy;
      if (gate.y <= 0) {
        gate.y = 0; gate.state = 'down'; gate.t = 0;
        // the slam: shake, hitstop, dust, sparks, a shock ring, a light pop
        feedback.shake(6, 380); feedback.hitstop(70); feedback.flash('white', 90, 0.22);
        vfx.shockwave({ x: L.gateX, z: 0, radius: 3.4, style: 'dust' });
        for (const zc of [-1.6, 0, 1.6]) vfx.dust({ x: L.gateX, z: zc, n: 7, size: 6, speed: 1.4, dx: 1, dz: 0 });
        const pp = vfx.pool;
        if (pp) for (let i = 0; i < 22; i++) pp.add(L.gateX + (Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 4.6, 1 + Math.random() * 3, 1 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.5, 2, 1, vfxRamp('white,gold,ember'), 1, 0.93, 12);
        vfx.flash({ x: L.gateX, y: 1, z: 0, color: 'torch', radius: 3.2, ms: 180 });
        this.cw.addBox(L.gateX - 0.6, -D / 2 - 1, L.gateX + 0.6, D / 2 + 1, 'gate');
        events.emit('gauntlet:slam', { x: L.gateX });
      }
      for (const m of this.gate.meshes) m.position.y = Math.max(0, gate.y);
    } else if (gate.state === 'down') {
      gate.t++;
      const bounce = gate.t < 6 ? [0.09, 0.05, 0.03, 0.015, 0.005, 0][gate.t] : 0;
      for (const m of this.gate.meshes) m.position.y = bounce;
      // the wall keeps coming: the release once it hits the gate
      if (this.collapse.halted) { this.state = 'escaped'; this.releaseT = 0; this.onRelease(); }
    }
  }

  onRelease() {
    const L = this.layout;
    this.banner = { text: 'ESCAPED', t: 0, color: 'cyan', big: true, sub: `${this.time.toFixed(1)}S  CLOSEST ${Math.max(0, this.minGap - 0.5).toFixed(1)}` };
    events.emit('gauntlet:release', { time: this.time, minGap: this.minGap, index: this.index });
    if (this.exitLight) { this.exitLight.color.setHex(hex('cyan')); this.exitLight.intensity = 1.1; this.exitLight.radius = 5.6; }
  }

  releaseStep(h) {
    this.releaseT++;
    const L = this.layout;
    // after the crash the mood settles: the rumble fades with collapse.calm, then the light changes
    if (this.releaseT === 70) { look.mood('crypt'); vfx.ambient.mood('crypt'); }
    if (this.releaseT > 40 && this.releaseT % 14 === 0) vfx.pickup({ x: L.exitX + (Math.random() - 0.5) * 1.6, y: 0.4, z: -D / 2 + 0.6, style: 'magic' });
    if (this.state === 'escaped' && h.x > L.exitX - HW && h.x < L.exitX + HW && h.z < -D / 2 + 0.35) {
      this.state = 'exited';
      events.emit('gauntlet:exit', { index: this.index });
    }
  }

  // ---- render / ui -----------------------------------------------------------------------------------------------------------------
  render(alpha) {
    for (const tr of this.traps) if (!tr.buried) tr.render(alpha);
    for (const tl of this.tiles) tl.render();
    this.collapse.render(alpha);
    if (this.pitGlow) { this.pitGlow.material.color.setHex(hex(Math.floor(this.t / 8) % 3 === 0 ? 'red' : 'blood')); }
    if (this.exitLight && this.state !== 'escaped' && this.state !== 'exited') this.exitLight.intensity = 0.55 + 0.25 * Math.sin(this.t * 0.2) + (this.state === 'chase' ? 0.2 : 0);
  }

  ui(g) {
    const W = display.width, Hh = display.height;
    const b = this.banner;
    if (b && b.t < 130) {
      const k = b.t;
      const pop = k < 8 ? 1 + (8 - k) * 0.12 : 1;
      const scale = b.big ? 3 : 2;
      const fade = k > 100 ? (130 - k) / 30 : 1;
      if (fade > 0.05) {
        g.globalAlpha = fade;
        const y = 54 + (k < 8 ? (8 - k) * 3 : 0);
        drawText(g, b.text, W / 2, y, b.color, { align: 'center', scale: Math.round(scale * pop), outline: 'ink' });
        if (b.sub) drawText(g, b.sub, W / 2, y + 28, 'bone', { align: 'center', outline: 'ink' });
        g.globalAlpha = 1;
      }
    }
    if (this.overlay) this.drawOverlay(g);
    this.drawMeter(g, W);
  }

  /** A slim run meter at the top: the collapse (red) filling from the left, the hero pip, the trap sections. */
  drawMeter(g, W) {
    const L = this.layout, mw = Math.min(220, W - 120), x0 = Math.round((W - mw) / 2), y0 = 6;
    const X = (wx) => x0 + Math.round(clamp(wx / L.W, 0, 1) * mw);
    g.fillStyle = css('ink'); g.fillRect(x0 - 1, y0 - 1, mw + 2, 7);
    g.fillStyle = css('shadow'); g.fillRect(x0, y0, mw, 5);
    for (const s of L.sections) { g.fillStyle = css(s.kind === 'pit' ? 'slate' : s.kind === 'jets' ? 'blood' : s.kind === 'blades' ? 'mist' : 'stone'); g.fillRect(X(s.x0), y0 + 1, Math.max(1, X(s.x1) - X(s.x0)), 3); }
    g.fillStyle = css('gold'); g.fillRect(X(L.exitX) - 1, y0 - 1, 2, 7);
    const cx = X(this.collapse.x);
    g.fillStyle = css('red'); g.fillRect(x0, y0, Math.max(0, cx - x0), 5);
    g.fillStyle = css('ember'); g.fillRect(cx - 1, y0, 2, 5);
    if (this.hero) { const hx = X(this.hero.x); g.fillStyle = css('ink'); g.fillRect(hx - 2, y0 - 2, 5, 9); g.fillStyle = css('sky'); g.fillRect(hx - 1, y0 - 1, 3, 7); }
  }

  drawOverlay(g) {
    const sec = this.t / 60;
    const W = display.width, Hh = display.height;
    const bar = (tr, label) => {
      const p = display.worldToScreen(tr.label.x, tr.label.y, tr.label.z);
      if (p.x < -40 || p.x > W + 40) return;
      const n = 30, cell = 2, x = Math.round(p.x - n * cell / 2), y = p.y;
      g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, n * cell + 2, 8);
      for (let i = 0; i < n; i++) {
        const s = tr.stateAt((i / n) * tr.period - tr.offset);
        g.fillStyle = css(s === 'live' ? 'red' : s === 'warn' ? 'gold' : 'slate');
        g.fillRect(x + i * cell, y, cell, 6);
      }
      const cur = Math.floor(tr.cursor(sec) * n);
      g.fillStyle = css('ink'); g.fillRect(x + cur * cell - 1, y - 3, 4, 12);
      g.fillStyle = css('white'); g.fillRect(x + cur * cell, y - 2, 2, 10);
      if (label) drawText(g, label, p.x, y + 9, 'bone', { align: 'center', outline: 'ink' });
    };
    const shown = new Set();
    for (const tr of this.traps) {
      if (tr.buried) continue;
      const key = `${tr.kind}${Math.round(tr.x)}`;
      const lab = shown.has(key) ? null : (shown.add(key), tr.kind === 'spikes' ? 'SPIKES' : tr.kind === 'blades' ? 'AXES' : 'JETS');
      bar(tr, lab);
    }
    for (const tl of this.tiles) {
      if (tl.state === 'gone') continue;
      const p = display.worldToScreen(tl.x, 0.1, tl.z);
      drawText(g, tl.fragile ? (tl.state === 'solid' ? 'X' : '!') : 'O', p.x, p.y - 4, tl.fragile ? 'ember' : 'leaf', { align: 'center', outline: 'ink' });
    }
    // the collapse: its speed and why
    const cx = display.worldToScreen(this.collapse.x, 3.9, 0);
    const c = this.collapse;
    const txt = `${c.speed.toFixed(1)} U/S  X${c.mult.toFixed(2)}  GAP ${Math.max(0, c.gap).toFixed(1)}`;
    drawText(g, txt, clamp(cx.x + 6, 4, W - textWidth(txt) - 4), clamp(cx.y, 20, Hh - 20), 'ember', { outline: 'ink' });
    drawText(g, 'TIMING: RED = HURTS  GOLD = WARNING  T HIDES', W / 2, Hh - 24, 'gold', { align: 'center', outline: 'ink' });
  }

  info() {
    const c = this.collapse, h = this.hero;
    return {
      state: this.state, t: this.t, index: this.index, name: this.name, W: +this.W.toFixed(2), seed: this.layout.seed,
      front: +c.x.toFixed(2), gap: +c.gap.toFixed(2), speed: +c.speed.toFixed(2), mult: +c.mult.toFixed(2), calm: +c.calm.toFixed(2),
      progress: +this.progress.toFixed(3), time: +this.time.toFixed(2), minGap: +this.minGap.toFixed(2), hits: this.hits, dodges: this.dodges,
      sections: this.layout.order, traps: this.traps.length, tiles: this.tiles.map((t) => t.state[0]).join(''), hero: h ? { x: +h.x.toFixed(2), z: +h.z.toFixed(2), hp: h.hp } : null,
    };
  }

  dispose() {
    for (const f of this._offs) f();
    this._offs = [];
    for (const tr of this.traps) tr.dispose();
    for (const tl of this.tiles) tl.dispose();
    for (const s of this.sconces) s.light?.remove();
    this.exitLight?.remove(); this.pitLight?.remove();
    this.collapse.dispose();
    this.group.parent?.remove(this.group);
    for (const n of this.modelNames) disposeModel(n);
    rumble(0);
    look.mood(this.prevMood === 'collapse' ? 'crypt' : this.prevMood); vfx.ambient.mood('crypt');
    if (current === this) current = null;
    chase.level = 0; chase.active = false;
    if (world.room?.id === 'gauntlet') world.room = null;
  }
}

debug.add('gauntlet', (action = 'info', a, b) => {
  const c = current;
  if (!c) return { ok: false, error: 'no corridor in this scene' };
  const h = c.hero;
  switch (action) {
    case 'info': return c.info();
    case 'layout': return { ...c.layout };
    case 'teleport': if (h) { h.ctl.teleport(a, b ?? h.z); } return c.info();
    case 'front': c.collapse.x = a; return c.info();
    case 'overlay': c.overlay = a === undefined ? !c.overlay : !!a; return c.overlay;
    case 'tune': if (a) TUNING[a] = b; return { ...TUNING };
    case 'jump': c.jump(a); return c.info();
    case 'escape': if (c.state === 'chase') c.beginEscape(); return c.info();
    default: return { ok: false, error: `unknown action "${action}"; try info, layout, teleport x z, front x, overlay, escape, tune key value, jump x` };
  }
});
