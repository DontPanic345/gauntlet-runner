// Arena props (piece `arenas`): the voxel models, the live prop objects that react to hits,
// and the room's synthesised sounds (doors, torches, breakage, the clear sting).
//
//   import { createProp, PROP_KINDS, arenaSfx } from './props.js';
//   const p = createProp(root, 'urn', x, z, { rng, collision: cw, yaw });
//   p.tick(); p.render(alpha);           // arena.js does this for every prop
//   p.takeHit(hit) -> false               // the combat target contract (see below)
//   p.shatter(dx, dz, power)              // break it from outside (a brute's charge, a slam)
//
// Every prop is a combat target ({x, z, r, dead, takeHit}). takeHit always returns false so
// combat's own hit pipeline (damage numbers, kill events) never runs for furniture; the prop
// plays its own reaction instead:
//   breakable (urn, crate, barrel, bones)  flash, wobble, chips; at 0 hp it bursts into voxel
//                                          debris in its own colours and leaves shards behind
//   sturdy (brazier)                       rocks on its legs, spills embers, the fire gusts
//   stone (pillar, stump, statue, altar)   stone chips and a dull knock; it does not move
//
// Sounds follow enemies/sfx.js: WebAudio, created lazily after a user gesture, volume from
// settings. `audio` can take over with arenaSfx.enabled = false and the arena:* events.

import * as THREE from 'three';
import { defineModel, voxelMesh, VoxelGrid } from '../render/voxel/index.js';
import { settings } from '../core/settings.js';
import { feedback } from '../core/feedback.js';
import { events } from '../core/events.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { Rng } from '../core/rng.js';

// =====================================================================================
// models
// =====================================================================================
const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

// pillar: square shaft with chamfered corners, a stepped base and capital, fluting
function pillar(name, { h = 30, moss = 0, crack = 0 } = {}) {
  const S = 11, g = new VoxelGrid(S, h + 1, S);
  const r = new Rng(name);
  for (let y = 0; y <= h; y++) {
    const base = y < 3, cap = y > h - 4;
    const half = base ? (y < 2 ? 5 : 4) : cap ? (y > h - 2 ? 5 : 4) : 3;
    for (let z = 5 - half; z <= 5 + half; z++) for (let x = 5 - half; x <= 5 + half; x++) {
      const cx = Math.abs(x - 5), cz = Math.abs(z - 5);
      if (cx === half && cz === half && !base && !cap) continue;          // chamfer
      let c = base || cap ? (y === 0 || y === h - 3 ? 'stone' : 'fog') : 'stoneLight';
      if (!base && !cap && (cx === half || cz === half) && ((x + z) % 2 === 0)) c = 'stone';   // flutes
      if (!base && !cap && y % 7 === 6) c = 'dusk';                        // drum joints
      if (y === h) c = hash(x, z) < 0.8 ? 'stoneLight' : 'stone';
      g.set(x, y, z, c);
    }
  }
  for (let i = 0; i < moss * 30; i++) { const y = r.int(0, 8), x = r.int(2, 8), z = r.pick([2, 8]); if (g.get(x, y, z)) g.set(x, y, z, r.chance(0.3) ? 'leaf' : 'moss'); }
  for (let i = 0; i < crack; i++) { let y = r.int(8, h - 6), x = r.int(3, 7); for (let k = 0; k < 6; k++) { g.set(x, y, 8, null); y -= 1; x += r.pick([-1, 0, 1]); } }
  defineModel(name, { grid: g });
}
pillar('arena.pillar', {});
pillar('arena.pillar.mossy', { moss: 1, crack: 1 });

// broken pillar: the lower drums, a jagged break, the fallen drum beside it
{
  const g = new VoxelGrid(16, 16, 12);
  const r = new Rng('arena.stump');
  for (let y = 0; y < 15; y++) for (let z = 1; z <= 9; z++) for (let x = 1; x <= 9; x++) {
    const half = y < 2 ? 4 : 3, cx = Math.abs(x - 5), cz = Math.abs(z - 5);
    if (cx > half || cz > half) continue;
    const top = 9 + Math.round(Math.sin(x * 1.1 + z * 0.6) * 2 + (x > 5 ? 3 : 0) - (z > 6 ? 1 : 0));
    if (y > top) continue;
    g.set(x, y, z, y === top ? 'stoneLight' : y < 2 ? 'stoneDark' : (cx === half || cz === half) && (x + z) % 2 ? 'dusk' : 'stone');
  }
  // fallen drum lying on its side
  for (let x = 9; x < 16; x++) for (let y = 0; y < 6; y++) for (let z = 5; z < 11; z++) {
    if (Math.hypot(y - 2.5, z - 7.5) > 3.1) continue;
    g.set(x, y, z, x === 15 || x === 9 ? 'stoneDark' : (y + z) % 3 ? 'stone' : 'dusk');
  }
  for (let i = 0; i < 10; i++) g.set(r.int(0, 15), 0, r.int(0, 11), r.pick(['stone', 'stoneLight', 'stoneDark']));
  defineModel('arena.stump', { grid: g, origin: [5.5, 0, 5.5] });
}

// brazier: an iron bowl on three legs, heaped with live coals (the flame is particles)
{
  const g = new VoxelGrid(11, 10, 11);
  const r = new Rng('arena.brazier');
  for (const [x, z] of [[5, 1], [1, 8], [9, 8]]) { g.box(x, 1, z, x, 5, z, 'shadow'); g.set(x, 0, z, 'slate'); }
  g.box(4, 3, 4, 6, 3, 6, 'shadow');                             // cross brace
  for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) {
    const d = Math.hypot(x - 5, z - 5);
    if (d <= 3.4) g.set(x, 5, z, 'shadow');
    if (d <= 4.5) g.set(x, 6, z, 'shadow');
    if (d <= 5.4 && d > 3.9) { g.set(x, 7, z, d > 4.8 ? 'slate' : 'shadow'); }
    if (d <= 3.9) g.set(x, 7, z, r.chance(0.35) ? 'ember' : 'blood', true);
    if (d <= 2.4 && r.chance(0.7)) g.set(x, 8, z, r.chance(0.45) ? 'gold' : 'ember', true);
    if (d <= 1.2) g.set(x, 9, z, 'torch', true);
  }
  for (const [x, z] of [[0, 5], [10, 5], [5, 0], [5, 10]]) g.set(x, 7, z, 'fog');   // rivets
  defineModel('arena.brazier', { grid: g });
}

// altar: a slab table with a cloth runner, candles, an offering skull (two tiles wide)
{
  const g = new VoxelGrid(18, 12, 9);
  g.box(1, 0, 1, 16, 1, 7, 'stoneDark');
  g.box(2, 2, 2, 15, 4, 6, 'stone');
  for (let x = 3; x < 15; x += 3) g.box(x, 2, 6, x, 4, 6, 'dusk');   // carved panel
  g.box(0, 5, 0, 17, 6, 8, 'stoneLight');
  g.box(0, 5, 0, 17, 5, 8, 'stone');
  // runner cloth hanging over the front
  g.box(6, 7, 0, 11, 7, 8, 'plum'); g.box(6, 3, 9 - 1, 11, 6, 8, 'plum');
  g.box(6, 3, 8, 11, 3, 8, 'gold'); g.box(8, 5, 8, 9, 5, 8, 'gold');
  // offering skull, bowl, candles
  g.box(8, 8, 3, 10, 10, 5, 'bone'); g.set(8, 9, 5, 'ink'); g.set(10, 9, 5, 'ink'); g.set(9, 8, 5, 'ink');
  g.box(3, 8, 3, 5, 8, 5, 'slate'); g.set(4, 9, 4, 'blood');
  const candle = (x, z, h) => { g.box(x, 8, z, x, 7 + h, z, 'bone'); g.set(x, 8 + h, z, 'torch', true); };
  candle(1, 1, 3); candle(2, 6, 2); candle(15, 2, 3); candle(16, 6, 1); candle(13, 5, 2); candle(4, 1, 1);
  // wax drips on the slab edge
  for (const [x, z] of [[1, 8], [2, 8], [16, 8], [15, 0]]) g.set(x, 4 + (x % 2), z, 'bone');
  defineModel('arena.altar', { grid: g });
}

// statue: the hooded Warden on a plinth, sword point down, hands on the pommel
{
  const W = 13, g = new VoxelGrid(W, 38, 11);
  g.box(0, 0, 0, 12, 1, 10, 'stoneDark'); g.box(1, 2, 1, 11, 5, 9, 'stone'); g.box(0, 6, 0, 12, 6, 10, 'stoneLight');
  g.box(3, 3, 9, 9, 4, 9, 'dusk');                                    // inscription band
  for (let x = 4; x < 9; x += 2) g.set(x, 3, 10, 'slate');
  // robe: widening to the hem, with folds
  for (let y = 7; y < 27; y++) {
    const half = y < 12 ? 4 : y < 22 ? 3 : 3;
    for (let z = 5 - 3; z <= 5 + 3; z++) for (let x = 6 - half; x <= 6 + half; x++) {
      if (y >= 22 && Math.abs(z - 5) > 2) continue;
      const fold = (x + (y >> 2)) % 3 === 0 && z >= 7;
      g.set(x, y, z, fold ? 'dusk' : 'stone');
    }
  }
  // hood and shadowed face
  for (let y = 27; y < 34; y++) for (let z = 2; z <= 8; z++) for (let x = 3; x <= 9; x++) {
    const d = Math.hypot(x - 6, (y - 29) * 0.9, z - 5);
    if (d > 3.8 + (y < 29 ? 0.4 : 0)) continue;
    g.set(x, y, z, 'stone');
  }
  g.set(6, 34, 4, 'stone'); g.set(6, 35, 3, 'stone');
  g.box(5, 28, 8, 7, 30, 8, 'ink');
  g.set(5, 29, 8, 'sky', true); g.set(7, 29, 8, 'sky', true);         // the eyes still watch
  // arms, hands on the pommel, the sword down the front
  g.box(3, 18, 7, 9, 20, 8, 'stone'); g.box(5, 21, 8, 7, 22, 9, 'stoneLight');
  g.box(6, 23, 9, 6, 24, 9, 'slate'); g.box(4, 20, 9, 8, 20, 9, 'slate');
  g.box(6, 7, 9, 6, 19, 9, 'fog'); g.box(6, 7, 10, 6, 7, 10, 'fog');
  // moss and a crack
  for (const [x, y, z] of [[3, 7, 8], [4, 8, 8], [9, 7, 7], [2, 6, 9], [10, 6, 9], [8, 12, 8]]) g.set(x, y, z, 'moss');
  for (let y = 14; y < 20; y++) g.set(4 + (y % 2), y, 8, null);
  defineModel('arena.statue', { grid: g });
}

// urns: three shapes of fired clay; a pale lip and a dark mouth make them read as pots from above
function urn(name, profile, body, band, lip) {
  const S = 7, H = profile.length, g = new VoxelGrid(S, H + 1, S);
  for (let y = 0; y < H; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 3, z - 3);
    const R = profile[y];
    if (d > R) continue;
    if (y === H - 1 && d < R - 1.0) { g.set(x, y - 1, z, 'ink'); continue; }   // the open mouth
    let c = body;
    if (y === band) c = lip === 'bone' ? 'blood' : 'dirt';
    if (y === H - 1) c = lip;
    if (y === 0) c = 'stoneDark';
    // a lighter shoulder where the glaze catches the light
    if (y > band && y < H - 1 && x < 3 && z > 3 && d > R - 1) c = lip;
    g.set(x, y, z, c);
  }
  defineModel(name, { grid: g });
}
urn('arena.urn.a', [1.6, 2.6, 3.1, 3.2, 3.0, 2.2, 1.3, 2.0], 'wood', 3, 'woodLight');
urn('arena.urn.b', [1.4, 2.4, 2.9, 3.1, 3.1, 2.7, 1.9, 1.2, 1.2, 1.9], 'dirt', 4, 'bone');
urn('arena.urn.c', [2.2, 3.0, 3.1, 2.8, 2.0, 2.4], 'violet', 2, 'fog');

// crate: plank faces with dark frame edges and a diagonal brace
{
  const g = new VoxelGrid(8, 8, 8);
  g.box(0, 0, 0, 7, 7, 7, 'wood');
  for (let y = 0; y < 8; y++) for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
    const ex = x === 0 || x === 7, ey = y === 0 || y === 7, ez = z === 0 || z === 7;
    if ((ex && ey) || (ex && ez) || (ey && ez)) g.set(x, y, z, 'dirt');
    else if ((ex || ez) && y % 3 === 1) g.set(x, y, z, 'woodLight');
    else if (ey && (x + z) % 3 === 0) g.set(x, y, z, 'woodLight');
  }
  for (let i = 1; i < 7; i++) g.set(i, i, 7, 'dirt');
  defineModel('arena.crate', { grid: g });
}
// barrel: staves, iron bands, a lid
{
  const g = new VoxelGrid(8, 10, 8);
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
    const d = Math.hypot(x - 3.5, z - 3.5);
    for (let y = 0; y < 10; y++) {
      const bulge = y > 2 && y < 7 ? 4.0 : 3.5;
      if (d > bulge) continue;
      const band = y === 1 || y === 8;
      const stave = Math.round(Math.atan2(z - 3.5, x - 3.5) / (Math.PI / 5)) % 2 === 0;
      g.set(x, y, z, band && d > bulge - 1.2 ? 'slate' : y === 9 ? (d < 2.6 ? 'wood' : 'woodLight') : stave ? 'wood' : 'woodLight');
    }
  }
  defineModel('arena.barrel', { grid: g });
}
// bone pile with a skull on top; and the scattered remains once kicked apart
function bones(name, n, skull, seed) {
  const g = new VoxelGrid(12, 6, 10);
  const r = new Rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r.int(1, 9), z = r.int(1, 8), len = r.int(3, 5), y = skull ? r.int(0, 2) : 0;
    const along = r.chance(0.5);
    for (let k = 0; k < len; k++) g.set(along ? Math.min(11, x + k) : x, y, along ? z : Math.min(9, z + k), 'bone');
    g.set(x, y + (skull ? 1 : 0), z, 'frost');
  }
  if (skull) {
    g.box(4, 2, 4, 7, 4, 7, 'bone');
    g.set(4, 3, 7, 'ink'); g.set(6, 3, 7, 'ink'); g.set(5, 2, 7, 'ink');
    g.box(4, 4, 4, 7, 4, 5, 'frost');
  }
  defineModel(name, { grid: g });
}
bones('arena.bones', 16, true, 'arena.bones');
bones('arena.bones.b', 12, true, 'arena.bones.b');
bones('arena.bones.flat', 7, false, 'arena.bones.flat');
// rubble heaps
function rubble(name, n, seed) {
  const g = new VoxelGrid(12, 5, 10);
  const r = new Rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r.int(0, 9), z = r.int(0, 7), s = r.int(1, 3);
    g.box(x, 0, z, x + s - 1, r.int(0, s), z + s - 1, r.pick(['stone', 'stoneLight', 'stoneDark', 'dusk']));
  }
  defineModel(name, { grid: g });
}
rubble('arena.rubble.a', 9, 'arena.rubble.a');
rubble('arena.rubble.b', 14, 'arena.rubble.b');
// shards left behind by a broken urn / crate
function shards(name, cols, seed) {
  const g = new VoxelGrid(10, 2, 10);
  const r = new Rng(seed);
  for (let i = 0; i < 14; i++) {
    const x = r.int(0, 8), z = r.int(0, 8);
    g.set(x, 0, z, r.pick(cols));
    if (r.chance(0.4)) g.set(x + 1, 0, z, r.pick(cols));
    if (r.chance(0.2)) g.set(x, 1, z, r.pick(cols));
  }
  defineModel(name, { grid: g });
}
shards('arena.shards.clay', ['wood', 'woodLight', 'dirt'], 'sh.clay');
shards('arena.shards.dark', ['violet', 'dusk', 'slate'], 'sh.dark');
shards('arena.shards.red', ['dirt', 'blood', 'wood'], 'sh.red');
shards('arena.shards.wood', ['wood', 'woodLight', 'dirt', 'slate'], 'sh.wood');
// floor candles: a cluster of stubs with wax pooled round them
{
  const g = new VoxelGrid(8, 5, 8);
  const c = (x, z, h) => { g.box(x, 0, z, x, h - 1, z, 'bone'); g.set(x, h, z, 'torch', true); g.set(x + 1, 0, z, 'frost'); };
  c(1, 2, 3); c(4, 1, 4); c(3, 5, 2); c(6, 4, 1); c(5, 6, 2);
  defineModel('arena.candles', { grid: g });
}

// =====================================================================================
// sounds
// =====================================================================================
let ctx = null, out = null, noiseBuf = null, n = 0;
function ac() {
  if (!arenaSfx.enabled) return null;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    ctx = new AudioContext();
    out = ctx.createGain(); out.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
    out.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 11;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  } catch { ctx = null; return null; }
  return ctx;
}
const vol = () => (settings.get('masterVolume') ?? 0.8) * (settings.get('sfxVolume') ?? 0.9);
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function noise(c, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.3, attack = 0.004 } = {}) {
  const src = c.createBufferSource(); src.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  const g = c.createGain(); env(g, t, attack, gain * vol(), dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, (n++ * 0.173) % 0.8, dur + attack + 0.05);
}
function tone(c, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 0.3, attack = 0.003 } = {}) {
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  const g = c.createGain(); env(g, t, attack, gain * vol(), dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + attack + dur + 0.05);
}
const play = (fn) => { const c = ac(); if (!c) return; try { fn(c, c.currentTime + 0.005); } catch { /* audio is best-effort */ } };

export const arenaSfx = {
  enabled: true,
  /** The gate slams: iron clang with ring, a stone boom under it, rattle after. */
  slam: () => play((c, t) => {
    tone(c, t, 0.5, { type: 'triangle', f0: 180, f1: 120, gain: 0.28 });
    tone(c, t, 0.9, { type: 'square', f0: 523, f1: 510, gain: 0.05 });
    tone(c, t, 0.7, { type: 'square', f0: 787, f1: 770, gain: 0.035 });
    noise(c, t, 0.35, { type: 'lowpass', f0: 900, f1: 120, gain: 0.55 });
    tone(c, t, 0.6, { type: 'sine', f0: 70, f1: 38, gain: 0.5 });
    for (let k = 1; k < 5; k++) noise(c, t + 0.1 + k * 0.06, 0.04, { f0: 2400 - k * 200, q: 6, gain: 0.12 / k });
  }),
  /** The exit seals: a low rune hum and a bolt thrown. */
  seal: () => play((c, t) => {
    noise(c, t, 0.08, { f0: 1800, q: 4, gain: 0.2 });
    tone(c, t + 0.05, 0.8, { type: 'sawtooth', f0: 55, f1: 52, gain: 0.08 });
    tone(c, t + 0.05, 0.8, { type: 'sine', f0: 110, f1: 104, gain: 0.12 });
  }),
  /** A torch catches: a breathy whoosh with a crackle. */
  ignite: (k = 0) => play((c, t) => {
    noise(c, t, 0.35, { f0: 300 + k * 60, f1: 1400 + k * 80, q: 0.8, gain: 0.22, attack: 0.05 });
    for (let i = 0; i < 3; i++) noise(c, t + 0.08 + i * 0.05, 0.02, { type: 'highpass', f0: 3000, gain: 0.08 });
  }),
  /** Wave horn: a short low call. */
  wave: (i = 0) => play((c, t) => {
    tone(c, t, 0.55, { type: 'sawtooth', f0: 98 + i * 12, f1: 92 + i * 12, gain: 0.08, attack: 0.06 });
    tone(c, t, 0.55, { type: 'square', f0: 147 + i * 18, f1: 140 + i * 18, gain: 0.04, attack: 0.08 });
    noise(c, t, 0.5, { type: 'lowpass', f0: 400, f1: 200, gain: 0.08, attack: 0.08 });
  }),
  /** Room clear: a bright rising arpeggio over a bell. */
  clear: () => play((c, t) => {
    [392, 523, 659, 784, 1046].forEach((f, i) => tone(c, t + i * 0.07, 0.45, { type: 'square', f0: f, gain: 0.06 }));
    tone(c, t, 1.4, { type: 'sine', f0: 1568, f1: 1560, gain: 0.08 });
    tone(c, t, 1.2, { type: 'triangle', f0: 196, f1: 196, gain: 0.12 });
  }),
  /** One ratchet click of the exit portcullis winding up. */
  ratchet: (k = 0) => play((c, t) => {
    noise(c, t, 0.03, { type: 'highpass', f0: 2600, gain: 0.16 });
    tone(c, t, 0.12, { type: 'square', f0: 330 + k * 20, f1: 300, gain: 0.03 });
    noise(c, t + 0.03, 0.12, { type: 'lowpass', f0: 500, gain: 0.1 });
  }),
  /** The grille locks open. */
  thunk: () => play((c, t) => { tone(c, t, 0.3, { type: 'sine', f0: 90, f1: 50, gain: 0.35 }); noise(c, t, 0.12, { type: 'lowpass', f0: 800, gain: 0.25 }); }),
  smashClay: () => play((c, t) => { noise(c, t, 0.18, { type: 'highpass', f0: 1800, f1: 900, gain: 0.3 }); for (let i = 0; i < 4; i++) noise(c, t + 0.04 + i * 0.03, 0.03, { f0: 3000 + i * 300, q: 5, gain: 0.1 }); }),
  smashWood: () => play((c, t) => { noise(c, t, 0.14, { f0: 600, f1: 300, q: 1.5, gain: 0.4 }); tone(c, t, 0.12, { type: 'triangle', f0: 140, f1: 80, gain: 0.2 }); }),
  knockWood: () => play((c, t) => { tone(c, t, 0.08, { type: 'triangle', f0: 220, f1: 160, gain: 0.2 }); noise(c, t, 0.05, { f0: 900, gain: 0.15 }); }),
  bones: () => play((c, t) => { for (let i = 0; i < 5; i++) tone(c, t + i * 0.035, 0.04, { type: 'square', f0: 900 + ((i * 373) % 500), gain: 0.04 }); }),
  stone: () => play((c, t) => { noise(c, t, 0.06, { f0: 1400, q: 2, gain: 0.25 }); tone(c, t, 0.08, { type: 'sine', f0: 160, f1: 110, gain: 0.2 }); }),
  iron: () => play((c, t) => { tone(c, t, 0.35, { type: 'square', f0: 620, f1: 600, gain: 0.04 }); noise(c, t, 0.05, { f0: 2500, q: 3, gain: 0.15 }); }),
};

// =====================================================================================
// live props
// =====================================================================================
export const PROP_KINDS = {
  //         model(s)                          r     h     hp  kind       debris colours                       shards
  pillar: { models: ['arena.pillar', 'arena.pillar.mossy'], r: 0.44, h: 3.7, hp: 0, type: 'stone', collide: 'circle' },
  stump: { models: ['arena.stump'], r: 0.44, h: 1.4, hp: 0, type: 'stone', collide: 'circle' },
  statue: { models: ['arena.statue'], r: 0.66, h: 4.6, hp: 0, type: 'stone', collide: 'box', box: [0.8, 0.68] },
  altar: { models: ['arena.altar'], r: 1.0, h: 1.2, hp: 0, type: 'stone', collide: 'box', box: [1.1, 0.55] },
  brazier: { models: ['arena.brazier'], r: 0.46, h: 1.2, hp: 0, type: 'sturdy', collide: 'circle' },
  urn: { models: ['arena.urn.a', 'arena.urn.b', 'arena.urn.c'], r: 0.3, h: 0.9, hp: 1, type: 'break', collide: 'circle',
    debris: { 'arena.urn.a': ['wood', 'woodLight', 'dirt'], 'arena.urn.b': ['dirt', 'blood', 'wood'], 'arena.urn.c': ['violet', 'dusk', 'slate'] },
    shards: { 'arena.urn.a': 'arena.shards.clay', 'arena.urn.b': 'arena.shards.red', 'arena.urn.c': 'arena.shards.dark' }, sound: 'smashClay' },
  crate: { models: ['arena.crate'], r: 0.44, h: 1.0, hp: 2, type: 'break', collide: 'circle', debris: ['wood', 'woodLight', 'dirt'], shards: 'arena.shards.wood', sound: 'smashWood' },
  barrel: { models: ['arena.barrel'], r: 0.42, h: 1.25, hp: 2, type: 'break', collide: 'circle', debris: ['wood', 'woodLight', 'slate'], shards: 'arena.shards.wood', sound: 'smashWood' },
  bones: { models: ['arena.bones', 'arena.bones.b'], r: 0.5, h: 0.6, hp: 1, type: 'break', collide: null, debris: ['bone', 'frost', 'bone'], shards: 'arena.bones.flat', sound: 'bones' },
  rubble: { models: ['arena.rubble.a', 'arena.rubble.b'], r: 0, h: 0.3, hp: 0, type: 'decor', collide: null },
  candles: { models: ['arena.candles'], r: 0, h: 0.5, hp: 0, type: 'decor', collide: null },
};

let pid = 0;

/**
 * A prop in the room. Stone and decor never move; sturdy props rock; breakables burst.
 * opts: { rng, collision, yaw, model, hittable }
 */
export class Prop {
  constructor(root, kind, x, z, { rng = null, collision = null, yaw = 0, model = null } = {}) {
    const K = PROP_KINDS[kind];
    if (!K) throw new Error(`arenas: no prop kind "${kind}"`);
    this.id = `prop${++pid}`;
    this.kind = kind; this.K = K;
    this.type = 'prop';
    this.ownDeath = true;                 // vfx's generic kill burst must skip us
    this.x = x; this.z = z; this.r = K.r; this.h = K.h; this.hitY = K.h * 0.5;
    this.hp = K.hp; this.dead = false;
    this.model = model ?? (rng ? rng.pick(K.models) : K.models[0]);
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.mesh = voxelMesh(this.model, { ownMaterial: K.type === 'break' || K.type === 'sturdy' });
    this.mesh.rotation.y = yaw;
    this.group.add(this.mesh);
    root.add(this.group);
    this.root = root;
    this.collision = collision;
    this.collider = null;
    if (collision && K.collide === 'circle') this.collider = collision.addCircle(x, z, K.r * 0.92, 'prop');
    if (collision && K.collide === 'box') this.collider = collision.addRect(x, z, K.box[0] * 2, K.box[1] * 2, 'prop');
    // wobble: a damped spring on two tilt axes, a squash, and a flash
    this.tx = 0; this.tz = 0; this.vx = 0; this.vz = 0; this.ptx = 0; this.ptz = 0;
    this.sq = 0; this.psq = 0; this.flash = 0;
    this.hits = 0;
    this.hittable = K.type !== 'decor';
    this.onBreak = null;
  }

  /** Combat target contract. Always false: props play their own reaction (see header). */
  takeHit(hit) {
    if (this.dead || !this.hittable) return false;
    this.react(hit.dx ?? 0, hit.dz ?? 1, hit.power ?? 1, hit.finisher);
    return false;
  }

  react(dx, dz, power = 1, heavy = false) {
    const K = this.K;
    const y = this.hitY, cx = this.x - dx * this.r * 0.7, cz = this.z - dz * this.r * 0.7;
    this.hits++;
    if (K.type === 'stone') {
      vfx.hitSpark(cx, Math.min(1.2, y), cz, { dx: -dx, dz: -dz, power: 0.55, palette: 'cool', light: false });
      vfx.dust(cx, cz, { n: 3, size: 0.8, palette: 'dustDark' });
      arenaSfx.stone();
      feedback.hitstop(35);
      return;
    }
    // everything else wobbles
    const k = (0.18 + 0.08 * power) * (K.type === 'sturdy' ? 0.7 : 1);
    this.vz += -dx * k * 6; this.vx += dz * k * 6;
    this.sq = Math.min(1, 0.45 + 0.2 * power);
    this.flash = 3;
    if (K.type === 'sturdy') {
      vfx.embers(this.x, 1.05, this.z, { n: 18 + Math.round(power * 8), spread: 0.4, up: 1.4 });
      vfx.hitSpark(cx, 0.9, cz, { dx: -dx, dz: -dz, power: 0.6, palette: 'ember', light: false });
      look.flash(this.x, 1.3, this.z, { color: 'flame', ms: 160, intensity: 2.2, radius: 5 });
      arenaSfx.iron();
      feedback.hitstop(45);
      this.gust = 1;
      return;
    }
    this.hp -= heavy ? 2 : 1;
    if (this.hp > 0) {
      vfx.hitSpark(cx, y, cz, { dx: -dx, dz: -dz, power: 0.5, light: false });
      vfx.dust(this.x, this.z, { n: 3, size: 0.7, palette: 'dustWarm' });
      arenaSfx.knockWood();
      feedback.hitstop(40);
      return;
    }
    this.shatter(dx, dz, power);
    feedback.hitstop(50);
  }

  /** Break it: debris in its own colours, a dust puff, shards left on the floor. */
  shatter(dx = 0, dz = 1, power = 1) {
    if (this.dead || this.K.type !== 'break') return;
    const K = this.K;
    this.dead = true;
    const colors = Array.isArray(K.debris) ? K.debris : K.debris[this.model];
    vfx.death(this.x + dx * 0.1, this.hitY, this.z + dz * 0.1, { colors, power: 0.55 + 0.15 * power, soul: false, ring: 'fog' });
    vfx.dust(this.x, this.z, { dx, dz, n: 7, size: 1, palette: this.kind === 'bones' ? 'dust' : 'dustWarm' });
    arenaSfx[K.sound]?.();
    feedback.shake(1.5, 90);
    if (this.collider) { this.collision?.remove(this.collider); this.collider = null; }
    const sh = typeof K.shards === 'string' ? K.shards : K.shards[this.model];
    // swap the body for its remains, knocked a little along the blow
    this.group.remove(this.mesh);
    this.mesh = voxelMesh(sh);
    this.mesh.rotation.y = Math.atan2(dx, dz);
    this.mesh.position.set(dx * 0.12, 0, dz * 0.12);
    this.group.add(this.mesh);
    this.tx = this.tz = this.vx = this.vz = this.sq = 0;
    this.flash = 0;
    events.emit('arena:propBreak', { prop: this, kind: this.kind, x: this.x, z: this.z });
    this.onBreak?.(this);
  }

  tick() {
    this.ptx = this.tx; this.ptz = this.tz; this.psq = this.sq;
    if (this.flash > 0) this.flash--;
    // spring back to upright
    const kS = 0.28, damp = 0.78;
    this.vx = (this.vx - this.tx * kS) * damp; this.vz = (this.vz - this.tz * kS) * damp;
    this.tx += this.vx * 0.2; this.tz += this.vz * 0.2;
    this.sq *= 0.8;
    if (Math.abs(this.tx) + Math.abs(this.tz) + Math.abs(this.vx) + Math.abs(this.vz) < 1e-3) { this.tx = this.tz = this.vx = this.vz = 0; }
    if (this.gust) this.gust = Math.max(0, this.gust - 0.03);
  }

  render(alpha) {
    const tx = this.ptx + (this.tx - this.ptx) * alpha, tz = this.ptz + (this.tz - this.ptz) * alpha;
    const sq = this.psq + (this.sq - this.psq) * alpha;
    this.group.rotation.set(tx, 0, tz);
    // squash and stretch in whole-ish steps (a voxel of give), volume kept
    const s = Math.round(sq * 3) / 3 * 0.12;
    this.group.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
    const f = this.mesh.material.userData?.flash;
    if (f) f.value = this.flash > 1 ? 1 : this.flash > 0 ? 0.5 : 0;
  }

  info() { return { id: this.id, kind: this.kind, x: +this.x.toFixed(2), z: +this.z.toFixed(2), dead: this.dead, hits: this.hits, hp: this.hp }; }
}

export function createProp(root, kind, x, z, opts) { return new Prop(root, kind, x, z, opts); }
