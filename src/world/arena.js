// Arenas (piece `arenas`): five hand-authored room templates, seeded variation, and the
// room itself: floor, walls, torches, props, the doors that seal and open, the wave director
// and the clear moment.
//
//   import { generateLayout, Arena, TEMPLATES } from '../world/arena.js';
//   const layout = generateLayout(seed, index);              // pure data, same seed -> same room
//   const arena = new Arena(root, layout, { origin: { x: 0, z: 0 } });
//   arena.bind({ hero, sys });                               // hero (x, z, dead) and the enemy system
//   // each sim tick: arena.tick();   each render: arena.render(alpha);   each ui: arena.ui(g);
//   // combat targets: () => [...world.enemies, ...arena.targets()]
//   // hero start: arena.entryPoint {x, z};  walk out of the door; the doors slam by themselves.
//
// State: ready -> (hero steps in) -> sealing -> fight -> clearing -> clear -> exited.
//
// Events (core/events.js):
//   arena:enter {index}   arena:seal {index}    the entry gate starts to fall
//   arena:slam {index, x, z}                    the gate hits the floor
//   arena:wave {index, n, total, count}         a wave spawns
//   arena:clear {index, x, z}                   the last enemy is down
//   arena:slabRise {index}                      the exit door starts to grind open
//   arena:exitOpen {index, x, z}                the exit is open; walk in to leave
//   arena:exit {index}                          the hero stepped into the exit
//   arena:propHit / arena:propBreak {kind, x, z}

import * as THREE from 'three';
import { voxelMesh, getModel, VOXEL } from '../render/voxel/index.js';
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
import { css } from '../render/palette.js';
import { vfx } from '../vfx/index.js';
import { buildFloor, buildBackWall, buildSideWall, doorRows, ARCH, MB, SW, WALL_H, SIDE_H } from './tiles.js';
import { Prop, flameGeo } from './props.js';
import { planWaves, describePlan, WaveDirector } from './waves.js';
import { sfxContext, makeNoiseBuffer } from '../audio/mixer.js';

const V = VOXEL;
const HW = ARCH.hw / 8;          // half width of a doorway, units
const ALCOVE = ARCH.depth / 8;   // depth of a doorway alcove, units
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- templates -----------------------------------------------------------------------------------
// Coordinates are units from the centre of the floor; z runs from -D/2 (the back wall) to +D/2 (the open front).
// `slots` are optional dressing: each has a chance to appear and picks one of its kinds.

export const TEMPLATES = [
  {
    id: 'vestibule', name: 'THE VESTIBULE', W: 15, D: 9, doors: { entry: -4.7, exit: 4.7 }, sconces: [-6.95, 6.95],
    wall: { style: 'brick', pilasters: [], moss: 0.4 },
    floor: {
      pattern: 'flags', moss: 0.4, cracks: 12, pebbles: 30,
      rug: { x: 0, z: 0.9, w: 2.6, d: 6.2 },
      inlay: [{ type: 'ring', x: 0, z: 0.9, r: 3.7, dash: 0.62 }, { type: 'square', x: 0, z: 0.9, s: 6.2, w: 1, color: 'violet' }],
      blood: [{ x: -2.7, z: 1.9, r: 0.9 }],
    },
    props: [
      { kind: 'statue', x: 0, z: -3.75 },
      { kind: 'brazier', x: -1.9, z: -3.85 }, { kind: 'brazier', x: 1.9, z: -3.85 },
      { kind: 'banner', x: -2.6, wall: true, variant: 'blood' }, { kind: 'banner', x: 2.6, wall: true, variant: 'blood' },
      { kind: 'pillar', x: -6.5, z: -3.5 }, { kind: 'pillar', x: 6.5, z: -3.5 },
      { kind: 'pillarRuin', x: -5.7, z: 1.5 }, { kind: 'pillarRuin', x: 5.7, z: 1.5 },
      { kind: 'candles', x: 0, z: -2.65 },
      { kind: 'rubbleBig', x: 3.0, z: -3.0, yaw: 0.4 }, { kind: 'rubble', x: -3.3, z: 3.8, yaw: 1 },
      { kind: 'web', x: -7.42, wall: true, y: 3.6 },
    ],
    slots: [
      { x: 6.3, z: 3.4, kinds: [['barrel', 3], ['crate', 2]], p: 1 }, { x: 5.55, z: 3.75, kinds: [['barrel', 2], ['crate', 3]], p: 0.9 },
      { x: 6.4, z: 2.75, kinds: [['crate', 1]], p: 0.6 }, { x: -6.3, z: 3.6, kinds: [['bones', 1]], p: 1 },
      { x: -6.45, z: -1.7, kinds: [['urn', 1]], p: 0.9 }, { x: 6.45, z: -1.9, kinds: [['urn', 1], ['barrel', 1]], p: 0.9 },
      { x: 3.9, z: 3.9, kinds: [['bones', 1], ['rubble', 1]], p: 0.6 },
    ],
    pads: [[-4.4, 1.6], [4.4, 1.6], [-2.4, 3.1], [2.4, 3.1], [0, 3.5], [-3.2, -1.0], [3.2, -1.0]],
  },
  {
    id: 'ossuary', name: 'THE OSSUARY', W: 16, D: 9.5, doors: { entry: -5.4, exit: 5.4 }, sconces: [-7.5, 7.5],
    wall: { style: 'ossuary', pilasters: [], moss: 0.15, brick: ['stone', 'dusk', 'stoneDark', 'stone', 'slate', 'stone'] },
    floor: {
      pattern: 'large', moss: 0.2, cracks: 18, pebbles: 40, slabs: [['stone', 6], ['dusk', 4], ['stoneDark', 2], ['stoneLight', 1]],
      inlay: [{ type: 'disc', x: 0, z: -3.2, r: 2.0, color: 'violet' }, { type: 'ring', x: 0, z: -3.2, r: 2.5, w: 1, color: 'slate', notches: 12 },
        { type: 'ring', x: 0, z: 0.8, r: 3.4, w: 1, color: 'slate', dash: 0.7 }],
      blood: [{ x: 0, z: -2.3, r: 1.2 }, { x: 2.8, z: 1.2, r: 0.6 }],
    },
    props: [
      { kind: 'altar', x: 0, z: -3.85 },
      { kind: 'candles', x: -2.2, z: -3.9 }, { kind: 'candles', x: 2.25, z: -3.8 },
      { kind: 'banner', x: -2.3, wall: true, variant: 'plum' }, { kind: 'banner', x: 2.3, wall: true, variant: 'plum' },
      { kind: 'brazier', x: -3.55, z: -4.05 }, { kind: 'brazier', x: 3.55, z: -4.05 },
      { kind: 'sarcophagus', x: -6.75, z: 0.3, yaw: Math.PI / 2 }, { kind: 'sarcophagus', x: 6.75, z: -1.3, yaw: Math.PI / 2 },
      { kind: 'pillarRuin', x: -3.2, z: 0.9 }, { kind: 'pillarRuin', x: 3.2, z: 0.9 },
      { kind: 'pillar', x: -7.0, z: -3.9 }, { kind: 'pillar', x: 7.0, z: -3.9 },
      { kind: 'web', x: -7.9, wall: true, y: 3.6 }, { kind: 'web', x: 7.9, wall: true, y: 3.6, flip: true },
    ],
    slots: [
      { x: -2.6, z: 3.7, kinds: [['bones', 1]], p: 1 }, { x: 3.9, z: 3.0, kinds: [['bones', 1]], p: 0.9 }, { x: -0.5, z: -1.4, kinds: [['bones', 1]], p: 0.7 },
      { x: -6.9, z: 3.8, kinds: [['urn', 1]], p: 1 }, { x: 6.8, z: 3.7, kinds: [['urn', 2], ['crate', 1]], p: 1 }, { x: 6.1, z: 3.9, kinds: [['urn', 1]], p: 0.6 },
      { x: -6.4, z: 2.5, kinds: [['barrel', 1]], p: 0.5 },
    ],
    pads: [[-4.7, 2.5], [4.7, 2.3], [0, 3.0], [-1.9, 0.3], [1.9, 0.3], [-3.6, 3.7], [3.6, 3.7]],
  },
  {
    id: 'hall', name: 'THE PILLARED HALL', W: 17, D: 9, doors: { entry: -6.0, exit: 0 }, sconces: [-8.05, 8.05],
    wall: { style: 'brick', pilasters: [-3.05, 3.05], moss: 0.3 },
    floor: {
      pattern: 'checker', moss: 0.35, cracks: 10, pebbles: 30,
      inlay: [{ type: 'line', x0: 0, z0: -4.4, x1: 0, z1: 4.4, w: 1.6, color: 'slate' }, { type: 'ring', x: 0, z: 0.4, r: 2.9, w: 1.5, color: 'slate', notches: 4, dash: 0.6 },
        { type: 'square', x: 0, z: 0.4, s: 5.4, w: 1, color: 'violet' }],
      blood: [{ x: -3.9, z: 3.0, r: 0.8 }],
    },
    props: [
      { kind: 'brazier', x: -2.35, z: -4.15 }, { kind: 'brazier', x: 2.35, z: -4.15 },
      { kind: 'banner', x: 4.7, wall: true, variant: 'navy' }, { kind: 'banner', x: 6.5, wall: true, variant: 'navy' }, { kind: 'banner', x: -8.05, wall: true, variant: 'navy' },
      { kind: 'pillar', x: -3.7, z: -3.5 }, { kind: 'pillar', x: 3.7, z: -3.5 }, { kind: 'pillar', x: 7.3, z: -3.5 }, { kind: 'pillarRuin', x: -8.0, z: -3.5 },
      { kind: 'pillarRuin', x: -3.9, z: 0.6 }, { kind: 'pillarRuin', x: 3.9, z: 0.6 }, { kind: 'pillar', x: 7.6, z: 0.9 }, { kind: 'pillarRuin', x: -7.6, z: 0.9 },
      { kind: 'web', x: 8.4, wall: true, y: 3.6, flip: true },
    ],
    slots: [
      { x: 7.6, z: 4.0, kinds: [['crate', 2], ['barrel', 2]], p: 1 }, { x: 6.9, z: 4.3, kinds: [['barrel', 1]], p: 0.8 }, { x: -7.7, z: 4.1, kinds: [['barrel', 1], ['urn', 1]], p: 1 },
      { x: -5.6, z: -0.9, kinds: [['rubble', 1]], p: 0.9 }, { x: 5.4, z: -1.5, kinds: [['bones', 1], ['rubble', 1]], p: 0.9 }, { x: 0.2, z: 4.3, kinds: [['bones', 1]], p: 0.5 },
    ],
    pads: [[-2.0, 2.4], [2.0, 2.4], [-5.2, 2.7], [5.2, 2.7], [0, 3.9], [-4.8, -1.1], [4.8, -1.4]],
  },
  {
    id: 'gallery', name: 'THE COLLAPSED GALLERY', W: 16, D: 9, doors: { entry: 0, exit: 5.6 }, sconces: [-7.35, 2.75],
    wall: { style: 'ruin', breach: { x: -3.6, w: 3.4 }, pilasters: [], moss: 0.9 },
    floor: {
      pattern: 'flags', moss: 1.0, cracks: 30, pebbles: 70, slabs: [['stone', 5], ['stoneLight', 2.5], ['dusk', 2], ['dirt', 1.6], ['stoneDark', 0.8]],
      holes: [{ x: 5.0, z: 2.8, rx: 2.1, rz: 1.35 }],
      blood: [{ x: -1.9, z: 2.4, r: 0.7 }],
    },
    props: [
      { kind: 'rubbleBig', x: -3.6, z: -4.2 }, { kind: 'rubbleBig', x: -5.0, z: -3.8, yaw: 2.2 },
      { kind: 'fallen', x: -4.3, z: 1.5, yaw: 0.12 },
      { kind: 'pillarRuin', x: -6.8, z: -3.7 }, { kind: 'pillar', x: 3.1, z: -3.6 },
      { kind: 'brazier', x: -1.9, z: -4.1 },
      { kind: 'banner', x: -6.4, wall: true, variant: 'navy' },
      { kind: 'web', x: -7.9, wall: true, y: 3.6 }, { kind: 'web', x: 7.9, wall: true, y: 3.6, flip: true },
    ],
    slots: [
      { x: 1.6, z: 3.6, kinds: [['rubble', 1]], p: 1 }, { x: -6.2, z: 3.9, kinds: [['rubble', 1], ['bones', 1]], p: 1 }, { x: 0.8, z: -2.2, kinds: [['bones', 1]], p: 0.9 },
      { x: 6.9, z: -1.2, kinds: [['crate', 1], ['barrel', 1]], p: 1 }, { x: 7.0, z: -2.1, kinds: [['barrel', 1]], p: 0.7 }, { x: 2.4, z: 0.6, kinds: [['rubble', 1]], p: 0.9 },
    ],
    pads: [[-4.5, 3.2], [-1.6, 0.6], [1.7, 3.0], [-6.2, 0.3], [3.0, -0.8], [0, 4.0], [-3.0, -1.2]],
  },
  {
    id: 'antechamber', name: 'THE WARDEN\'S ANTECHAMBER', W: 17, D: 9.5, doors: { entry: -6.0, exit: 0 }, sconces: [-8.05, 8.05], mood: 'boss-ish',
    wall: { style: 'carved', pilasters: [], moss: 0.05, brick: ['stone', 'dusk', 'stoneDark', 'stone', 'slate', 'violet'] },
    floor: {
      pattern: 'large', moss: 0.08, cracks: 10, pebbles: 22, slabs: [['stoneDark', 4], ['stone', 4], ['dusk', 3], ['stoneLight', 0.7]],
      rug: { x: 0, z: 0.7, w: 2.6, d: 7.6, field: 'blood', edge: 'plum', trim: 'gold', motif: 'plum', core: 'gold' },
      inlay: [{ type: 'ring', x: 0, z: 0.7, r: 4.0, w: 1.5, color: 'blood', notchColor: 'red', notches: 8 }, { type: 'ring', x: 0, z: 0.7, r: 3.1, w: 1, color: 'plum', dash: 0.7, notches: 12 }],
      blood: [{ x: 0, z: 0.7, r: 1.0 }, { x: -3.4, z: 2.5, r: 0.7 }, { x: 3.7, z: -0.6, r: 0.6 }],
    },
    props: [
      { kind: 'statue', x: -3.0, z: -4.45 }, { kind: 'statue', x: 3.0, z: -4.45 },
      { kind: 'brazier', x: -1.55, z: -4.4 }, { kind: 'brazier', x: 1.55, z: -4.4 },
      { kind: 'brazier', x: -7.5, z: -1.6, light: false }, { kind: 'brazier', x: 7.5, z: -1.6, light: false }, { kind: 'brazier', x: 7.5, z: 2.9, light: false },
      { kind: 'banner', x: 4.9, wall: true, variant: 'blood' }, { kind: 'banner', x: 6.7, wall: true, variant: 'blood' }, { kind: 'banner', x: -8.0, wall: true, variant: 'blood' },
      { kind: 'pillar', x: -7.6, z: -4.1 }, { kind: 'pillar', x: 7.6, z: -4.1 },
      { kind: 'pillarRuin', x: -5.4, z: 1.4 }, { kind: 'pillarRuin', x: 5.4, z: 1.4 },
    ],
    slots: [
      { x: -7.6, z: 3.5, kinds: [['bones', 1]], p: 1 }, { x: 4.6, z: 4.1, kinds: [['bones', 1], ['rubble', 1]], p: 0.9 }, { x: -3.8, z: -1.6, kinds: [['candles', 1]], p: 0.9 },
      { x: 3.8, z: -1.4, kinds: [['candles', 1]], p: 0.9 }, { x: -6.5, z: 4.1, kinds: [['urn', 1]], p: 0.8 },
    ],
    pads: [[-4.6, 1.8], [4.6, 1.8], [-2.3, 3.7], [2.3, 3.7], [-6.4, -0.6], [6.4, -0.4], [0, -1.5]],
  },
];

// ---- layout ---------------------------------------------------------------------------------------

/**
 * Pure data for room `index` of the run with `seed`. The template is index % 5. Variation:
 * mirrored left/right, jittered props, chance-based dressing slots, banner colours.
 */
export function generateLayout(seed = 1, index = 0) {
  const T = TEMPLATES[index % TEMPLATES.length];
  const rng = new Rng(`arenas/${seed}/${index}`);
  const mirror = rng.chance(0.5);
  const mx = (x) => (mirror ? -x : x);
  const props = [];
  for (const p of T.props) {
    const q = { ...p };
    q.x = mx(p.x);
    if (mirror && q.yaw) q.yaw = -q.yaw;
    if (mirror && (p.kind === 'web')) q.flip = !p.flip;
    if (!p.wall) { q.x += rng.range(-0.08, 0.08); q.z = p.z + rng.range(-0.08, 0.08); }
    if (q.kind === 'banner' && rng.chance(0.25) && index % 2) q.variant = rng.pick(['blood', 'plum', 'navy']);
    props.push(q);
  }
  for (const s of T.slots) {
    if (!rng.chance(s.p)) continue;
    const kind = rng.weighted(s.kinds);
    props.push({ kind, x: mx(s.x) + rng.range(-0.12, 0.12), z: s.z + rng.range(-0.12, 0.12), yaw: rng.range(0, 6.283) });
  }
  const flipX = (o) => ({ ...o, x: mx(o.x), ...(o.x0 !== undefined ? { x0: mx(o.x0), x1: mx(o.x1) } : {}) });
  const doors = { entry: mx(T.doors.entry), exit: mx(T.doors.exit) };
  const floor = {
    ...T.floor,
    inlay: (T.floor.inlay ?? []).map(flipX),
    rug: T.floor.rug ? flipX(T.floor.rug) : null,
    blood: (T.floor.blood ?? []).map(flipX),
    holes: (T.floor.holes ?? []).map(flipX),
    pads: T.pads.map(([x, z]) => [mx(x), z]),
    mats: [{ x: doors.entry }, { x: doors.exit }],
  };
  const wall = { ...T.wall, pilasters: (T.wall.pilasters ?? []).map(mx), breach: T.wall.breach ? { ...T.wall.breach, x: mx(T.wall.breach.x) } : undefined };
  const pads = T.pads.map(([x, z]) => [mx(x), z]);
  const layout = {
    seed, index, template: T.id, name: T.name, W: T.W, D: T.D, mirror, doors,
    floor, wall, props, pads, sconces: T.sconces.map(mx),
    plan: planWaves(seed, index, pads),
    floorSeed: `${seed}/${index}`,
  };
  return layout;
}

// ---- sound (stand-ins, synthesised; the audio piece may replace them on the same events) ---------------

export const arenaSfx = { enabled: true };
let ctx = null, out = null, nbuf = null;
// Routed through the audio piece's shared mixer (one AudioContext, one compressor) instead of
// opening its own; see audio/mixer.js's header.
function ac() {
  if (!arenaSfx.enabled) return null;
  const m = sfxContext();
  if (!m) { ctx = null; return null; }
  ctx = m.ctx; out = m.out;
  if (!nbuf) nbuf = makeNoiseBuffer(ctx, 7, 1);
  return ctx;
}
const vol = () => (settings.get('masterVolume') ?? 0.8) * (settings.get('sfxVolume') ?? 0.9);
const envl = (g, t, a, peak, d) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
};
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
  s.start(t, (nOff++ * 0.211) % 0.7, dur + attack + 0.05);
}
const SFX = {
  seal(c, t) { noise(c, t, 0.5, { type: 'lowpass', f0: 260, f1: 120, gain: 0.3, attack: 0.15 }); tone(c, t, 0.5, { type: 'sawtooth', f0: 52, f1: 44, gain: 0.1, attack: 0.2 }); },
  slam(c, t) {
    tone(c, t, 0.55, { type: 'sine', f0: 95, f1: 28, gain: 0.8 });
    noise(c, t, 0.4, { type: 'lowpass', f0: 1400, f1: 120, gain: 0.55 });
    for (let i = 0; i < 4; i++) tone(c, t + 0.03 + i * 0.045, 0.16, { type: 'square', f0: 1900 - i * 200, f1: 900, gain: 0.07 });
    tone(c, t + 0.09, 0.7, { type: 'triangle', f0: 180, f1: 120, gain: 0.12 });
  },
  wave(c, t) { tone(c, t, 0.7, { type: 'sawtooth', f0: 110, f1: 82, gain: 0.16, attack: 0.05 }); tone(c, t, 0.7, { type: 'sawtooth', f0: 165, f1: 124, gain: 0.08, attack: 0.05 }); },
  clear(c, t) {
    const n = [392, 494, 587, 784];
    n.forEach((f, i) => { tone(c, t + i * 0.09, 0.9, { type: 'triangle', f0: f, f1: f * 1.004, gain: 0.16, attack: 0.01 }); tone(c, t + i * 0.09, 0.7, { type: 'sine', f0: f * 2, f1: f * 2, gain: 0.05 }); });
    noise(c, t, 0.6, { type: 'highpass', f0: 3000, f1: 8000, gain: 0.06, attack: 0.02 });
  },
  rise(c, t) {
    noise(c, t, 1.5, { type: 'lowpass', f0: 380, f1: 200, gain: 0.32, attack: 0.1 });
    tone(c, t, 1.5, { type: 'sawtooth', f0: 46, f1: 60, gain: 0.14, attack: 0.1 });
    for (let i = 0; i < 6; i++) tone(c, t + 0.15 + i * 0.22, 0.1, { type: 'square', f0: 300 + (i % 2) * 60, f1: 180, gain: 0.05 });
  },
  open(c, t) { tone(c, t, 0.9, { type: 'sine', f0: 523, f1: 523, gain: 0.1 }); tone(c, t, 0.9, { type: 'sine', f0: 784, f1: 784, gain: 0.08 }); tone(c, t + 0.12, 0.9, { type: 'sine', f0: 1047, f1: 1047, gain: 0.06 }); },
  stone(c, t) { tone(c, t, 0.12, { type: 'square', f0: 700, f1: 320, gain: 0.07 }); noise(c, t, 0.14, { f0: 1600, f1: 600, gain: 0.14 }); tone(c, t, 0.14, { type: 'sine', f0: 130, f1: 70, gain: 0.2 }); },
  fire(c, t) { noise(c, t, 0.3, { type: 'highpass', f0: 1500, f1: 4000, gain: 0.14 }); tone(c, t, 0.25, { type: 'sawtooth', f0: 220, f1: 500, gain: 0.05 }); },
  wood(c, t) { tone(c, t, 0.08, { type: 'square', f0: 300, f1: 140, gain: 0.1 }); noise(c, t, 0.1, { f0: 900, f1: 300, q: 2, gain: 0.18 }); },
  break(c, t) { noise(c, t, 0.28, { f0: 1200, f1: 250, q: 1.5, gain: 0.3 }); tone(c, t, 0.2, { type: 'triangle', f0: 240, f1: 80, gain: 0.16 }); tone(c, t + 0.04, 0.1, { type: 'square', f0: 500, f1: 200, gain: 0.06 }); },
  pad(c, t) { tone(c, t, 0.3, { type: 'sine', f0: 200, f1: 420, gain: 0.05 }); },
};
const play = (fn) => { const c = ac(); if (c) fn(c, c.currentTime + 0.001); };
events.on('arena:seal', () => play(SFX.seal));
events.on('arena:slam', () => play(SFX.slam));
events.on('arena:wave', () => play(SFX.wave));
events.on('arena:clear', () => play(SFX.clear));
events.on('arena:slabRise', () => play(SFX.rise));
events.on('arena:exitOpen', () => play(SFX.open));
events.on('arena:propHit', (e) => play(e.kind === 'brazier' ? SFX.fire : e.kind === 'barrel' || e.kind === 'crate' ? SFX.wood : SFX.stone));
events.on('arena:propBreak', () => play(SFX.break));

// ---- the arena -----------------------------------------------------------------------------------------

let current = null;
const ease = (k) => k * k * (3 - 2 * k);
let modelSeq = 0;

export class Arena {
  /**
   * opts: { origin: {x, z}, cw (a CollisionWorld to add the room's solids to; one is made if omitted),
   * title: show the room's name card on entering, banners: draw wave and clear banners in ui(),
   * lights: register torch lights (default true) }
   */
  constructor(root, layout, opts = {}) {
    this.layout = layout; this.root = root;
    const { W, D } = layout;
    this.W = W; this.D = D; this.index = layout.index;
    this.ox = opts.origin?.x ?? 0; this.oz = opts.origin?.z ?? 0;
    this.cw = opts.cw ?? new CollisionWorld();
    this.showTitle = opts.title !== false; this.showBanners = opts.banners !== false;
    this.group = new THREE.Group(); this.group.name = `arena:${layout.template}`;
    root.add(this.group);
    this.state = 'ready'; this.t = 0; this.stateT = 0;
    this.props = []; this.sconces = []; this.doors = {}; this.trail = []; this.padFx = [];
    this.hero = null; this.sys = null; this.director = null;
    this.banner = null; this.titleT = -1; this.clearT = -1; this.slowUntil = 0;
    this.lastKill = null;
    this.seq = ++modelSeq;
    this._offs = [];
    this.build(opts);
    current = this;
    this._offs.push(events.on('enemy:die', (e) => { this.lastKill = { x: e.x, z: e.z }; }));
    events.emit('arena:built', { index: this.index, template: layout.template });
  }

  // ---- geometry helpers (arena-local units <-> world) -------------------------------------------------
  w(x, z) { return { x: this.ox + x, z: this.oz + z }; }
  local(x, z) { return { x: x - this.ox, z: z - this.oz }; }
  get center() { return { x: this.ox, z: this.oz }; }
  get bounds() { return { minX: this.ox - this.W / 2, maxX: this.ox + this.W / 2, minZ: this.oz - this.D / 2, maxZ: this.oz + this.D / 2 }; }
  get entryPoint() { const d = this.layout.doors.entry; return this.w(d, -this.D / 2 - 0.75); }
  get exitPoint() { const d = this.layout.doors.exit; return this.w(d, -this.D / 2 - 0.2); }
  get name() { return this.layout.name; }
  clampToFloor(x, z) {
    const b = this.bounds;
    return { x: clamp(x, b.minX + 0.6, b.maxX - 0.6), z: clamp(z, b.minZ + 0.9, b.maxZ - 0.7) };
  }
  padToWorld(p) { return this.w(p[0], p[1]); }
  heroPos() { return this.hero ? { x: this.hero.x, z: this.hero.z } : this.w(0, 0); }

  // ---- build --------------------------------------------------------------------------------------------
  build(opts) {
    const L = this.layout, { W, D } = L, cw = this.cw;
    const key = `${L.seed}.${L.index}.${this.seq}`;
    const useLights = opts.lights !== false && look.lights;
    this.useLights = useLights;
    this.modelNames = [];
    const name = (n) => { const full = `arena.${n}.${key}`; this.modelNames.push(full); return full; };

    // floor
    const fname = name('floor');
    buildFloor(fname, W, D, L.floorSeed, L.floor);
    const floor = voxelMesh(fname);
    floor.position.set(this.ox, 0, this.oz);
    this.group.add(floor);
    // back wall
    const wname = name('wall');
    buildBackWall(wname, W, [L.doors.entry, L.doors.exit], L.floorSeed, L.wall);
    const wall = voxelMesh(wname);
    wall.position.set(this.ox, 0, this.oz - D / 2);
    this.group.add(wall);
    // side walls
    const sname = name('side');
    buildSideWall(sname, D, L.floorSeed, L.wall);
    for (const s of [-1, 1]) {
      const m = voxelMesh(sname);
      m.position.set(this.ox + s * W / 2, 0, this.oz - D / 2 - 4 / 8 + 0);
      // origin z = MB+4: the model's z=0 face sits at (MB+4)/8 behind; align with the wall face
      m.position.z = this.oz - D / 2 + 4 / 8 - 0;
      if (s < 0) m.scale.x = -1;
      this.group.add(m);
    }

    // collision: back wall in segments between the doorways, the side walls, the front edge
    const x0 = this.ox - W / 2 - SW / 8, x1 = this.ox + W / 2 + SW / 8;
    const zb = this.oz - D / 2, zbBack = zb - ALCOVE - 0.35;
    const gaps = [L.doors.entry, L.doors.exit].map((d) => [this.ox + d - HW - 0.02, this.ox + d + HW + 0.02]).sort((a, b) => a[0] - b[0]);
    let cx = x0;
    for (const [a, b] of gaps) { if (a > cx) cw.addBox(cx, zbBack, a, zb, 'wall'); cx = b; }
    if (cx < x1) cw.addBox(cx, zbBack, x1, zb, 'wall');
    for (const d of [L.doors.entry, L.doors.exit]) cw.addBox(this.ox + d - HW, zbBack, this.ox + d + HW, zb - ALCOVE - 0.05, 'wall');   // alcove backs
    cw.addBox(this.ox - W / 2 - 1.5, zbBack, this.ox - W / 2, this.oz + D / 2 + 1, 'wall');
    cw.addBox(this.ox + W / 2, zbBack, this.ox + W / 2 + 1.5, this.oz + D / 2 + 1, 'wall');
    cw.addBox(x0, this.oz + D / 2, x1, this.oz + D / 2 + 1.5, 'edge');
    // chasms: circles along the hole
    for (const h of L.floor.holes ?? []) {
      const n = Math.max(1, Math.round(h.rx / h.rz * 1.2));
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        cw.addCircle(this.ox + h.x + t * (h.rx - h.rz * 0.85), this.oz + h.z, h.rz * 0.95, 'pit');
      }
    }

    // props
    for (const p of L.props) {
      const z = p.wall ? -D / 2 + (p.kind === 'web' ? 0.02 : 0.1) : p.z;
      const pr = new Prop(p.kind, this.ox + p.x, this.oz + z, { root: this.group, cw, yaw: p.yaw ?? 0, variant: p.variant ?? null, y: p.kind === 'banner' ? 3.0 : p.y ?? 0, light: p.light !== false && useLights });
      if (p.flip) { pr.flip = true; }
      this.props.push(pr);
    }
    // wall sconces: bracket, animated flame, a real light
    for (const x of L.sconces) {
      const m = voxelMesh('arena.sconce');
      const pos = new THREE.Vector3(this.ox + x, 2.05, this.oz - D / 2 + 0.02);
      m.position.copy(pos);
      this.group.add(m);
      const f = voxelMesh('arena.flameS.0');
      f.position.set(pos.x, pos.y + 0.66, pos.z + 0.24);
      f.scale.setScalar(1);
      this.group.add(f);
      look.noShadow(f);
      const light = useLights ? look.torch(m, { x: 0, y: 0.85, z: 0.45, intensity: 0.95, radius: 5.6, haze: 1 }) : null;
      this.sconces.push({ mesh: m, flame: f, light, x: pos.x, phase: x * 3.1 });
    }

    // two invisible wash lights: torchlight spilling along the wall, so the bricks are readable between the fires
    if (useLights) for (const s of [-1, 1]) look.torch(this.group, { x: this.ox + s * W * 0.27, y: 1.7, z: this.oz - D / 2 + 1.1, intensity: 0.62, radius: 7.5, haze: 0, flicker: 0.5, color: 'flame' });

    if (useLights) look.torch(this.group, { x: this.ox, y: 2.6, z: this.oz + 0.8, intensity: 1.1, radius: 13, haze: 0, flicker: 0.25, color: 'torch' });

    // doors
    const mk = (x, kind) => {
      const g = new THREE.Group();
      g.position.set(this.ox + x, 0, this.oz - D / 2);
      this.group.add(g);
      return g;
    };
    // the entry gate: raised out of sight at first
    {
      const g = mk(L.doors.entry);
      const gate = voxelMesh('arena.gate');
      gate.position.set(0, 0, -0.5);
      g.add(gate);
      g.position.y = (ARCH.h + 2) / 8;
      this.doors.entry = { group: g, mesh: gate, base: 'arena.gate', x: L.doors.entry, y: g.position.y, vy: 0, top: (ARCH.h + 2) / 8, shape: null, state: 'up' };
    }
    // the exit slab and its rune
    {
      const g = mk(L.doors.exit);
      const slab = voxelMesh('arena.slab');
      slab.position.set(0, 0, -0.31);
      g.add(slab);
      const rune = voxelMesh('arena.rune.ember');
      rune.position.set(0, 6 / 8, -0.31 + 2.5 * V + 0.02);
      look.noShadow(rune);
      g.add(rune);
      const lightRed = useLights ? look.torch(g, { x: 0, y: 1.3, z: 0.8, color: 'ember', intensity: 0.55, radius: 3.4, haze: 0 }) : null;
      const lightCyan = null;
      const shape = cw.addBox(this.ox + L.doors.exit - HW, zb - 0.45, this.ox + L.doors.exit + HW, zb, 'door');
      this.doors.exit = { group: g, mesh: slab, base: 'arena.slab', x: L.doors.exit, slab, rune, runeCol: 'ember', y: 0, top: (ARCH.h + 2) / 8, shape, state: 'down', lightRed, lightCyan, rise: 0 };
    }
    this.doors.entry.shapeBlock = null;

    // trail tiles from the middle of the room to the exit door
    {
      const ex = L.doors.exit, x0_ = clamp(ex * 0.25, -1.5, 1.5), z0_ = D * 0.18;
      const x1_ = ex, z1_ = -D / 2 + 1.05;
      const len = Math.hypot(x1_ - x0_, z1_ - z0_), n = Math.max(4, Math.round(len / 1.0));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        const m = voxelMesh('arena.trail.on');
        m.position.set(this.ox + x0_ + (x1_ - x0_) * k, 0.012, this.oz + z0_ + (z1_ - z0_) * k);
        m.rotation.y = Math.atan2(x1_ - x0_, z1_ - z0_);
        m.visible = false;
        look.noOutline(m); look.noShadow(m);
        this.group.add(m);
        this.trail.push({ mesh: m, on: -1, x: m.position.x, z: m.position.z });
      }
    }
    if (world.room !== undefined) this.syncRoom();
  }

  syncRoom() {
    world.room = { index: this.index, kind: 'arena', name: this.name, template: this.layout.template, state: this.state, wave: this.director ? Math.min(this.director.wave + 1, this.director.waves) : 0, waves: this.layout.plan.waves.length, cleared: this.state === 'clear' || this.state === 'exited', plan: describePlan(this.layout.plan) };
  }

  /** Hand the room its hero and enemy system. The wave director is made here. */
  bind({ hero, sys }) {
    current = this;
    this.hero = hero; this.sys = sys;
    if (sys) { sys.bounds = this.bounds; sys.collision = this.cw; sys.hero = hero; }
    this.director?.dispose();
    this.director = sys ? new WaveDirector({ sys, plan: this.layout.plan, host: this, rng: new Rng(`arenas/${this.layout.seed}/${this.index}/dir`) }) : null;
    return this;
  }

  /** Combat targets: the props that can be hit. `() => [...world.enemies, ...arena.targets()]`. */
  targets() { return this.props.filter((p) => p.hittable && !p.dead); }
  get plan() { return this.layout.plan; }

  // ---- state machine -------------------------------------------------------------------------------------
  setState(s) { this.state = s; this.stateT = 0; this.syncRoom(); }

  /** Let the room start reacting to the hero: it seals when they step in. */
  enter() {
    if (this.state !== 'ready') return;
    events.emit('arena:enter', { index: this.index });
    if (this.showTitle) this.titleT = 0;
  }

  /** Close the gate now (debug, or scripted entries). */
  seal() {
    if (this.state !== 'ready') return false;
    this.setState('sealing');
    events.emit('arena:seal', { index: this.index });
    return true;
  }

  /** End the fight now: kills everything and runs the clear moment (debug). */
  forceClear() {
    if (this.sys) this.sys.kill('all');
    if (this.state === 'ready') this.seal();
    this.director?.skipTo(this.director.waves - 1);
    if (this.director) this.director.state = 'done';
    this.beginClear();
  }

  beginClear() {
    if (this.state === 'clearing' || this.state === 'clear' || this.state === 'exited') return;
    this.setState('clearing');
    const at = this.lastKill ?? this.heroPos();
    const hp = this.heroPos();
    events.emit('arena:clear', { index: this.index, x: at.x, z: at.z });
    feedback.hitstop(150);
    feedback.flash('white', 160, 0.28);
    feedback.shake(2.5, 260);
    vfx.shockwave({ x: at.x, z: at.z, radius: 3.6, style: 'gold' });
    vfx.pickup({ x: hp.x, y: 0.9, z: hp.z, style: 'gold' });
    vfx.flash({ x: at.x, y: 0.6, z: at.z, color: 'gold', radius: 3, ms: 240, intensity: 2.6 });
    loop.setTimeScale(0.3);
    this.slowUntil = loop.realTime + 0.75;
    this.clearT = 0;
    this.banner = { kind: 'clear', t: 0 };
    for (const p of this.props) p.nudge?.(1.2);
  }

  tick() {
    this.t++; this.stateT++;
    if (this.slowUntil && loop.realTime > this.slowUntil) { this.slowUntil = 0; loop.setTimeScale(1); }
    if (this.titleT >= 0) this.titleT++;
    for (const p of this.props) p.tick();
    for (const s of this.sconces) { if ((this.t + Math.floor(Math.abs(s.phase) * 5)) % 37 === 0) vfx.embers({ x: s.x, y: 2.85, z: this.oz - this.D / 2 + 0.3, n: 1 }); }
    const hero = this.hero;
    const L = this.layout, D = this.D;

    switch (this.state) {
      case 'ready':
        // the hero steps out of the doorway and into the room: the gate falls behind them
        if (hero && !hero.dead && hero.z > this.oz - D / 2 + 1.3 && Math.abs(hero.x - (this.ox + L.doors.entry)) < 4) { this.enter(); this.seal(); }
        break;
      case 'sealing': this.tickSeal(); break;
      case 'fight':
        this.director?.tick();
        if (this.director?.finished && (!this.sys || this.sys.alive().length === 0) && this.stateT > 30) this.beginClear();
        if (hero?.dead) { /* the scene decides what death means */ }
        break;
      case 'clearing': this.tickClear(); break;
      case 'clear':
        if (hero && !hero.dead && hero.z < this.oz - D / 2 - 0.3 && Math.abs(hero.x - (this.ox + L.doors.exit)) < HW) {
          this.setState('exited');
          events.emit('arena:exit', { index: this.index });
        }
        break;
      default: break;
    }
    this.tickDoors();
    if (this.banner) { this.banner.t++; if (this.banner.t > (this.banner.kind === 'clear' ? 190 : 100)) this.banner = null; }
  }

  tickSeal() {
    const g = this.doors.entry, t = this.stateT;
    const gx = this.ox + g.x, gz = this.oz - this.D / 2;
    if (t < 18) {
      // anticipation: the gate shudders and grit falls from the lintel
      g.shake = t < 17 ? 1 : 0;
      if (t % 3 === 0) vfx.dust({ x: gx + (Math.random() - 0.5) * 2, y: 2.7, z: gz + 0.1, n: 2, size: 3, speed: 0.4 });
      if (t === 2) feedback.shake(1.2, 300);
      if (t === 2) for (const p of this.props) p.nudge?.(0.5);
    } else if (g.state !== 'down') {
      g.shake = 0;
      if (g.state === 'up') { g.state = 'falling'; g.vy = 0; }
      if (g.state === 'falling') {
        g.vy -= 0.075;
        g.y += g.vy * 1.0;
        g.group.position.y = g.y;
        if (g.y <= 0) { g.y = 0; g.group.position.y = 0; this.slam(g); g.vy = 0.045; g.state = 'bounce'; }
      } else if (g.state === 'bounce') {
        g.vy -= 0.01;
        g.y = Math.max(0, g.y + g.vy);
        g.group.position.y = g.y;
        if (g.y <= 0 && g.vy < 0) { g.y = 0; g.group.position.y = 0; g.state = 'down'; vfx.dust({ x: gx + g.x * 0, y: 0.05, z: gz + 0.3, n: 4, size: 3, speed: 0.6 }); }
      }
    }
    if (t > 62) {
      this.setState('fight');
      this.director?.start(28);
    }
  }

  slam(g) {
    const gx = this.ox + g.x, gz = this.oz - this.D / 2;
    g.shape = this.cw.addBox(gx - HW, gz - 0.5, gx + HW, gz - 0.25, 'gate');
    events.emit('arena:slam', { index: this.index, x: gx, z: gz });
    feedback.hitstop(70);
    feedback.shake(6.5, 320);
    feedback.kick(0, 1, 3.5);
    feedback.flash('white', 90, 0.16);
    for (let i = -2; i <= 2; i++) vfx.dust({ x: gx + i * 0.5, y: 0.06, z: gz + 0.55, n: 5, size: 6, dz: -1, speed: 1.2 });
    vfx.dust({ x: gx, y: 0.1, z: gz + 0.7, n: 8, size: 7, speed: 1.6 });
    vfx.shockwave({ x: gx, z: gz + 0.7, radius: 2.4, style: 'ring' });
    vfx.hit({ x: gx - 0.9, y: 0.12, z: gz + 0.15, dx: -1, dz: 0.4, power: 1.1 });
    vfx.hit({ x: gx + 0.9, y: 0.12, z: gz + 0.15, dx: 1, dz: 0.4, power: 1.1 });
    look.flash(gx, 0.5, gz + 0.8, { color: 'torch', ms: 160, intensity: 2.0, radius: 3.6 });
    // grit rains from the wall above
    for (let i = 0; i < 6; i++) vfx.dust({ x: this.ox + (Math.random() - 0.5) * (this.W - 2), y: 2.9, z: gz + 0.3, n: 3, size: 3, speed: 0.3 });
    for (const p of this.props) p.nudge?.(1.6);
    // the exit door's rune wakes: red, angry
    this.doors.exit.runeCol = 'ember';
  }

  tickClear() {
    const t = this.stateT, ex = this.doors.exit;
    const exx = this.ox + ex.x, exz = this.oz - this.D / 2;
    // runes flip through gold to cyan, then the slab rises
    if (t === 34) { this.setRune('gold'); look.flash(exx, 1.0, exz + 0.5, { color: 'gold', ms: 180, intensity: 2.2, radius: 3.4 }); }
    if (t === 48) { this.setRune('cyan'); look.flash(exx, 1.0, exz + 0.5, { color: 'cyan', ms: 220, intensity: 2.2, radius: 3.8 }); }
    // trail tiles light up one after another toward the door
    const n = this.trail.length;
    for (let i = 0; i < n; i++) {
      const tr = this.trail[i];
      if (tr.on < 0 && t >= 30 + i * 4) {
        tr.on = 0; tr.mesh.visible = true;
        vfx.embers({ x: tr.x, y: 0.05, z: tr.z, n: 2 });
        if (i === n - 1) vfx.flash({ x: tr.x, y: 0.2, z: tr.z, color: 'gold', radius: 1.6, ms: 160, intensity: 1.6 });
      }
    }
    if (t === 62) { ex.state = 'rising'; ex.rune.visible = false; look.flash(exx, 1.0, exz + 0.5, { color: 'white', ms: 140, intensity: 2.4, radius: 3.2 }); events.emit('arena:slabRise', { index: this.index }); }
    if (ex.state === 'rising') {
      ex.rise++;
      const k = clamp(ex.rise / 92, 0, 1);
      ex.y = ease(k) * ex.top;
      if (ex.rise % 5 === 0) feedback.shake(1.1, 110);
      if (ex.rise % 4 === 0) vfx.dust({ x: exx + (Math.random() - 0.5) * 2.0, y: ex.y + 0.1, z: exz + 0.3, n: 2, size: 3, speed: 0.4 });
      if (ex.rise % 9 === 0) vfx.dust({ x: exx + (Math.random() - 0.5) * 2.2, y: 2.8, z: exz + 0.3, n: 2, size: 3, speed: 0.3 });
      if (!ex.lightCyan && useLightsFor(this)) ex.lightCyan = look.torch(ex.group, { x: 0, y: 1.3, z: 0.9, color: 'cyan', intensity: 0, radius: 4.6, haze: 0.3, flicker: 0.3 });
      if (ex.lightCyan) ex.lightCyan.intensity = 1.25 * k;
      if (ex.lightRed) ex.lightRed.intensity = 0.55 * (1 - k);
      if (k > 0.35 && ex.shape) { this.cw.remove(ex.shape); ex.shape = null; }
      if (k >= 1) {
        ex.state = 'up';
        feedback.shake(2.2, 160);
        vfx.dust({ x: exx, y: 2.75, z: exz + 0.3, n: 10, size: 5, speed: 0.9 });
        vfx.pickup({ x: exx, y: 0.9, z: exz + 0.9, style: 'magic' });
        this.setState('clear');
        events.emit('arena:exitOpen', { index: this.index, x: exx, z: exz });
      }
    }
  }

  setRune(col) {
    const ex = this.doors.exit;
    ex.runeCol = col;
    ex.rune.geometry = voxelMesh(`arena.rune.${col}`).geometry;
  }

  cutDoor(d) {
    // rows of the door still below the wall top (27 voxels): the rest slid into the wall
    const rows = Math.round((WALL_H - 4) - d.y * 8);
    if (d.rows === rows) return;
    d.rows = rows;
    const n = doorRows(d.base, rows);
    d.mesh.visible = !!n;
    if (n) d.mesh.geometry = getModel(n).geometry;
  }

  tickDoors() {
    const ent = this.doors.entry, ex = this.doors.exit;
    this.cutDoor(ent); this.cutDoor(ex);
    // shudder: whole-voxel jitter so it stays on the pixel grid
    ent.group.position.x = this.ox + ent.x + (ent.shake ? (this.t % 2 ? 1 : -1) * V * 0.5 : 0);
    ex.group.position.y = ex.y;
    ex.group.position.x = this.ox + ex.x + (ex.state === 'rising' ? (this.t % 2 ? 1 : -1) * V * 0.5 : 0);
    // the sealed rune breathes: ember, then blood, so the threat never sits still
    if (ex.state === 'down' && ex.runeCol === 'ember') {
      const dim = Math.floor(this.t / 22) % 2 === 1;
      ex.rune.geometry = voxelMesh(`arena.rune.${dim ? 'blood' : 'ember'}`).geometry;
      if (ex.lightRed) ex.lightRed.intensity = dim ? 0.3 : 0.6;
    }
    // trail tiles pop and settle
    for (const tr of this.trail) if (tr.on >= 0) { tr.on++; const k = Math.min(1, tr.on / 8); tr.mesh.scale.setScalar(k < 1 ? 0.6 + 0.6 * Math.sin(k * Math.PI * 0.5) : 1); if (tr.on === 10) tr.mesh.geometry = voxelMesh(`arena.trail.${Math.floor(this.t / 18) % 2 ? 'on' : 'hot'}`).geometry; if (tr.on > 10) { const hot = ((Math.floor(this.t / 9) + Math.round(tr.x * 3)) % 3) === 0; tr.mesh.geometry = voxelMesh(`arena.trail.${hot ? 'hot' : 'on'}`).geometry; } }
  }

  render(alpha) {
    for (const p of this.props) p.render(alpha);
    const f = Math.floor(loop.tick / 4);
    for (const s of this.sconces) {
      s.flame.geometry = flameSmall((f + Math.floor(Math.abs(s.phase) * 5)) % 4);
      const v = new THREE.Vector3(s.flame.position.x, s.flame.position.y, s.flame.position.z);
      look.snap(v);
    }
  }

  // ---- ui -----------------------------------------------------------------------------------------------
  ui(g) {
    if (!this.showBanners) return;
    const W = display.width;
    // the room's name card: slides in, holds, fades
    if (this.titleT >= 0 && this.titleT < 170) {
      const t = this.titleT, k = t < 14 ? ease(t / 14) : t > 140 ? 1 - (t - 140) / 30 : 1;
      const n = `${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][this.index % 10] ?? this.index + 1}`;
      const label = this.name;
      const y = 38, sc = 2;
      const w = textWidth(label) * sc;
      const oy = Math.round((1 - k) * -10);
      if (k > 0.05) {
        g.globalAlpha = clamp(k * 1.4, 0, 1);
        drawText(g, `ROOM ${n}`, W / 2, y + oy - 11, 'fog', { align: 'center', shadow: 'ink' });
        drawText(g, label, W / 2, y + oy, 'bone', { align: 'center', scale: sc, outline: 'ink' });
        const lw = Math.round(w * k);
        g.fillStyle = css('ember'); g.fillRect(Math.round(W / 2 - lw / 2), y + oy + 17, lw, 1);
        g.globalAlpha = 1;
      }
    }
    if (this.banner) {
      const b = this.banner, t = b.t;
      if (b.kind === 'wave') {
        const k = t < 10 ? ease(t / 10) : t > 70 ? 1 - (t - 70) / 30 : 1;
        if (k > 0.02) {
          g.globalAlpha = clamp(k * 1.5, 0, 1);
          const y = 60 + Math.round((1 - k) * -8);
          drawText(g, `WAVE ${b.n} / ${b.total}`, W / 2, y, b.n === b.total ? 'ember' : 'bone', { align: 'center', scale: 2, outline: 'ink' });
          for (let i = 0; i < b.total; i++) {
            const x = Math.round(W / 2 - (b.total * 8) / 2 + i * 8 + 1);
            g.fillStyle = css('ink'); g.fillRect(x - 1, y + 17, 7, 5);
            g.fillStyle = css(i < b.n ? (b.n === b.total ? 'ember' : 'gold') : 'slate'); g.fillRect(x, y + 18, 5, 3);
          }
          g.globalAlpha = 1;
        }
      } else if (b.kind === 'clear') {
        const k = t < 8 ? ease(t / 8) : t > 160 ? 1 - (t - 160) / 30 : 1;
        if (k > 0.02) {
          const pop = t < 10 ? 1 + (10 - t) * 0.06 : 1;
          const y = 52 + Math.round((1 - k) * -14);
          g.globalAlpha = clamp(k * 1.6, 0, 1);
          const sc = t < 6 ? 4 : 3;
          drawText(g, 'ROOM CLEARED', W / 2, y, 'gold', { align: 'center', scale: sc, outline: 'ink' });
          if (t > 40) drawText(g, this.state === 'clear' ? 'THE WAY IS OPEN' : 'THE SEAL BREAKS...', W / 2, y + sc * 8 + 4, 'sky', { align: 'center', shadow: 'ink' });
          // a twinkle running along the underline
          const uw = Math.round(textWidth('ROOM CLEARED') * sc * Math.min(1, t / 26));
          g.fillStyle = css('gold'); g.fillRect(Math.round(W / 2 - uw / 2), y + sc * 8 + 1, uw, 1);
          const tw = Math.round((t * 6) % Math.max(1, uw));
          g.fillStyle = css('white'); g.fillRect(Math.round(W / 2 - uw / 2) + tw, y + sc * 8 + 1, 3, 1);
          g.globalAlpha = 1;
          void pop;
        }
      }
    }
  }

  // ---- info / dispose ------------------------------------------------------------------------------------
  info() {
    const d = this.director;
    return {
      index: this.index, template: this.layout.template, name: this.name, seed: this.layout.seed, mirror: this.layout.mirror, state: this.state,
      wave: d ? d.wave + 1 : 0, waves: this.layout.plan.waves.length, directorState: d?.state ?? null, alive: this.sys ? this.sys.alive().length : 0, kills: d?.kills ?? 0, total: d?.total ?? 0,
      doors: { entry: { state: this.doors.entry.state, y: +this.doors.entry.y.toFixed(2) }, exit: { state: this.doors.exit.state, y: +this.doors.exit.y.toFixed(2), rune: this.doors.exit.runeCol } },
      plan: describePlan(this.layout.plan), props: this.props.filter((p) => p.hittable).map((p) => p.info()),
      entry: this.entryPoint, exit: this.exitPoint, origin: { x: this.ox, z: this.oz },
    };
  }

  dispose() {
    this._offs.forEach((f) => f()); this._offs = [];
    this.director?.dispose();
    for (const p of this.props) p.dispose();
    for (const s of this.sconces) s.light?.remove();
    for (const k of ['entry', 'exit']) { this.doors[k].lightRed?.remove?.(); this.doors[k].lightCyan?.remove?.(); }
    this.root.remove(this.group);
    this.group.traverse((o) => { if (o.material && o.material.userData?.flash && o.material.dispose) o.material.dispose(); });
    if (this.slowUntil) loop.setTimeScale(1);
    if (current === this) current = null;
  }
}

const useLightsFor = (a) => a.useLights;
const smallGeos = [];
function flameSmall(i) {
  if (!smallGeos[i]) smallGeos[i] = voxelMesh(`arena.flameS.${i}`).geometry;
  return smallGeos[i];
}

// ---- debug ----------------------------------------------------------------------------------------------
// __GR.debug.arena()                         info on the current room
// __GR.debug.arena('layout', seed, index)    the layout data for any room (props, doors, plan)
// __GR.debug.arena('seal' | 'clear' | 'wave', n | 'targets')
debug.add('arena', (action, a, b) => {
  if (action === 'layout') {
    const l = generateLayout(a ?? 1, b ?? 0);
    return { ok: true, name: l.name, template: l.template, mirror: l.mirror, doors: l.doors, plan: describePlan(l.plan), props: l.props.map((p) => `${p.kind}@${p.x.toFixed(1)},${(p.z ?? 0).toFixed(1)}`) };
  }
  const ar = current;
  if (!ar) return { ok: false, error: 'no arena in this scene' };
  switch (action) {
    case undefined: case 'info': return { ok: true, ...ar.info() };
    case 'seal': return { ok: ar.seal() };
    case 'clear': ar.forceClear(); return { ok: true };
    case 'wave': ar.director?.skipTo((a ?? 1) - 1); return { ok: true, wave: ar.director?.wave };
    case 'targets': return { ok: true, targets: ar.targets().map((p) => p.info()) };
    default: return { ok: false, error: `unknown action "${action}"` };
  }
});

export const currentArena = () => current;
export { flameGeo, WALL_H, SIDE_H, MB };
