// Gauntlet corridors (piece `gauntlet`): the short trap runs between arenas, chased by the
// collapse. A corridor runs left to right across the screen: the hero drops in at the left
// end, the ceiling behind gives way, and the collapse (collapse.js) chases them through
// beats of traps (traps.js) to a gate at the far end, which slams shut behind them.
//
//   import { generateCorridor, Corridor, createCorridorRun, CORRIDOR_COUNT } from '../world/corridor.js';
//   const L = generateCorridor(index /* 0..3 */, seed);          // pure: same seed, same corridor
//   const cor = new Corridor(root, L, { hero: () => ctl, health: () => world.hero });
//   setCollision(cor.collision);
//   tick (after combat.tick()):  cor.tickCamera(cam, ctl); cor.tick();
//   render: cor.render(alpha)      ui: cor.ui(g)      exit: cor.dispose()
//
//   createCorridorRun(root, { index, seed, source?, god? }) builds the whole playable bundle
//   (hero rig, controller, combat, health, camera, corridor) for scenes: see the 'gauntlet'
//   scene at the bottom, which the run placeholder uses between arenas.
//
// Flow (cor.state):
//   'intro'   the hero drops in beside the caved-in way they came; traps already cycle
//   'run'     the ceiling gives way behind them: the chase is on
//   'safe'    the hero is through the far gate: it slams down behind them, the collapse
//             smashes into it and stills, the rumble dies, the ember light fades
//   'exited'  the hero walked into the stair beyond (event 'gauntlet:exit')
//   'caught'  the collapse got them (event 'gauntlet:caught')
//
// Layout: beats (BEATS) are hand-authored trap rhythms, a few units long; a corridor is an
// intro, 3 to 5 beats with short rests between them, and the gate. Which beats, their order,
// small timing shifts and the dressing come from the seed; later corridors use harder beats,
// shorter periods and a faster collapse.
//
// Events: 'gauntlet:enter' {corridor}  'gauntlet:start'  'gauntlet:hurt' {cause, x, z}
//         'gauntlet:fall' {x, z}  'gauntlet:caught' {x, z}  'gauntlet:safe'  'gauntlet:exit'
//         'gauntlet:crumble' {x}

import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { debug } from '../core/debug.js';
import { scenes } from '../core/scenes.js';
import { input } from '../core/input.js';
import { display } from '../core/display.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { defineModel, voxelMesh, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { CollisionWorld, setCollision } from '../core/collision.js';
import { createFloorTiles } from '../enemies/telegraph.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import { createTrap, gauntletSfx, BLADE, pinAt } from './traps.js';
import { Collapse } from './collapse.js';
import { createProgression } from '../progression/index.js';   // boons piece
import { createHud } from '../ui/hud.js';   // hud piece: the in-run HUD in the 'gauntlet' scene

const V = VOXEL;
const VX = 8;
export const CORRIDOR_COUNT = 4;
export const CORRIDOR_D = 6;          // width of the corridor (z), in tiles
const START_X = 3;                    // where the hero drops in
const INTRO = 75;                     // ticks before the ceiling gives way
const LEFT = -0.6;                    // the caved-in dead end
const SAFE_LEN = 8;                   // the room beyond the gate

// ---------------------------------------------------------------------------------------
// beats: hand-authored trap rhythms. x is relative to the beat's start; z spans -2.5..2.5.
// period / offset in ticks. Every beat was checked by the demo pilot to have a way through
// (see showcase-gauntlet.js).
// ---------------------------------------------------------------------------------------
const H = CORRIDOR_D / 2;
export const BEATS = {
  // three full-width plates fire front to back in turn: walk in behind the wave
  spikeWave: { len: 9, tier: 0, name: 'SPIKE WAVE', traps: [
    { kind: 'spikes', x0: 1, x1: 3, z0: -H, z1: H, period: 104, offset: 0 },
    { kind: 'spikes', x0: 3.5, x1: 5.5, z0: -H, z1: H, period: 104, offset: -30 },
    { kind: 'spikes', x0: 6, x1: 8, z0: -H, z1: H, period: 104, offset: -60 },
  ] },
  // half-width plates, back and front out of step: weave between the lanes
  spikeWeave: { len: 8, tier: 1, name: 'SPIKE WEAVE', traps: [
    { kind: 'spikes', x0: 1, x1: 3.5, z0: -H, z1: 0, period: 110, offset: 0 },
    { kind: 'spikes', x0: 1, x1: 3.5, z0: 0, z1: H, period: 110, offset: 55 },
    { kind: 'spikes', x0: 4.5, x1: 7, z0: -H, z1: 0, period: 110, offset: 55 },
    { kind: 'spikes', x0: 4.5, x1: 7, z0: 0, z1: H, period: 110, offset: 0 },
  ] },
  // two blades out of phase: pass each while its head is at the far wall
  blades: { len: 8, tier: 0, name: 'BLADES', traps: [
    { kind: 'blade', x: 2.2, period: 104, offset: 0 },
    { kind: 'blade', x: 5.6, period: 104, offset: 40 },
  ] },
  // three jets fire in a ripple down the corridor: follow it through
  jetRipple: { len: 8, tier: 0, name: 'FIRE RIPPLE', traps: [
    { kind: 'jet', x: 1.6, period: 126, offset: 0 },
    { kind: 'jet', x: 3.9, period: 126, offset: -38 },
    { kind: 'jet', x: 6.2, period: 126, offset: -76 },
  ] },
  // short jets you can outflank along the front edge, and a long one you have to time
  jetFlank: { len: 8, tier: 1, name: 'FIRE FLANK', traps: [
    { kind: 'jet', x: 1.6, period: 110, offset: 0, reach: 2.8 },
    { kind: 'jet', x: 3.9, period: 110, offset: 55 },
    { kind: 'jet', x: 6.2, period: 110, offset: 20, reach: 2.8 },
  ] },
  // a bridge of cracked stone that falls away under you, with a gap you must dash
  crumble: { len: 8, tier: 0, name: 'CRUMBLING BRIDGE', traps: [
    { kind: 'crumble', x0: 1, x1: 7, broken: [3] },
  ] },
  // wide gap, then a plate straight after the landing
  gapSpikes: { len: 9, tier: 1, name: 'GAP AND SPIKES', traps: [
    { kind: 'crumble', x0: 1, x1: 5, broken: [1, 2] },
    { kind: 'spikes', x0: 6, x1: 7.5, z0: -H, z1: H, period: 96, offset: 0 },
  ] },
  // a blade guarding a jet
  bladeJet: { len: 8, tier: 1, name: 'BLADE AND FIRE', traps: [
    { kind: 'blade', x: 2.2, period: 120, offset: 0 },
    { kind: 'jet', x: 5.4, period: 120, offset: 30 },
  ] },
};
// which beats each corridor may draw, and how many
const TIERS = [
  { n: 3, pool: ['spikeWave', 'blades', 'jetRipple', 'crumble'], v0: 3.4, pace: 1 },
  { n: 4, pool: ['spikeWave', 'blades', 'jetRipple', 'crumble', 'spikeWeave', 'jetFlank'], v0: 3.6, pace: 1 },
  { n: 4, pool: ['spikeWeave', 'jetFlank', 'gapSpikes', 'bladeJet', 'blades', 'crumble'], v0: 3.75, pace: 0.94 },
  { n: 5, pool: ['spikeWeave', 'jetFlank', 'gapSpikes', 'bladeJet', 'jetRipple', 'spikeWave'], v0: 3.9, pace: 0.9 },
];
const REST = 3;

/**
 * The layout of corridor `index` (0-based, the corridor after arena index+1) for a seed.
 * Pure. opts.beats forces a beat list (ids).
 */
export function generateCorridor(index, seed, { beats = null } = {}) {
  index = Math.max(0, Math.min(CORRIDOR_COUNT - 1, index | 0));
  const r = new Rng(`${seed}/corridor/${index}`);
  const T = TIERS[index];
  let ids = beats ? beats.filter((b) => BEATS[b]) : r.shuffle([...T.pool]).slice(0, T.n);
  // never open on a gap: the first beat is one you can read while running in
  if (!beats && (ids[0] === 'gapSpikes' || ids[0] === 'crumble') && ids.length > 1) [ids[0], ids[1]] = [ids[1], ids[0]];
  const traps = [], beatList = [];
  let x = 7;
  for (const id of ids) {
    const B = BEATS[id];
    const shift = r.int(0, 3) * 8;
    beatList.push({ id, name: B.name, x0: x, x1: x + B.len });
    for (const t of B.traps) {
      const s = { ...t, beat: id };
      if ('x' in s) s.x += x;
      if ('x0' in s) { s.x0 += x; s.x1 += x; }
      if (s.period) { s.period = Math.round(s.period * T.pace); s.offset = Math.round((s.offset ?? 0) * T.pace) + shift; }
      traps.push(s);
    }
    x += B.len + REST;
  }
  const len = x + 1;                       // the gate
  // sconces along the back wall, clear of nozzles and blade beams
  const busy = traps.flatMap((t) => (t.kind === 'jet' || t.kind === 'blade' ? [t.x] : []));
  const sconces = [];
  for (let sx = 1.5; sx < len + SAFE_LEN - 1; sx += 6.5) {
    let s = sx;
    while (busy.some((b) => Math.abs(b - s) < 1.1)) s += 0.5;
    if (s < len - 0.8 || s > len + 1) sconces.push(s);
  }
  return {
    key: `${seed}.${index}.${ids.join('-')}`,
    index, seed, D: CORRIDOR_D, len, gateX: len, safeLen: SAFE_LEN,
    beats: beatList, traps, sconces,
    exitX: len + 5, entryX: START_X,
    v0: T.v0,
    name: `THE GAUNTLET`,
    sub: `CORRIDOR ${index + 1} OF ${CORRIDOR_COUNT}`,
  };
}

// ---------------------------------------------------------------------------------------
// models: the corridor is cut into chunks along x, each a floor slab (with the parapet and
// the cliff face) and a back wall
// ---------------------------------------------------------------------------------------
const CHUNK = 16;
const X0 = -8;             // the world x where the first chunk starts
const DEPTH = 20;          // floor thickness in voxels (the cliff face below the front edge)
const PAR = 4;             // parapet height, voxels
const WALL_V = 64;         // back wall height, voxels
const WALL_Z = 10;         // back wall thickness, voxels

function chunkRange(L) {
  const x1 = L.len + L.safeLen + 4;
  return Math.ceil((x1 - X0) / CHUNK);
}

function holeSet(L) {
  // every crumble column: the floor has a pit there (the tiles are their own meshes)
  const s = new Set();
  for (const t of L.traps) if (t.kind === 'crumble') for (let x = t.x0; x < t.x1; x++) s.add(x);
  return s;
}

function buildFloorChunk(L, k) {
  const r = new Rng(`${L.seed}/cfloor/${L.key}/${k}`);
  const D = L.D;
  const cx0 = X0 + k * CHUNK;
  const zA = -D / 2 - WALL_Z / 8;         // under the back wall
  const GX = CHUNK * VX, GZ = Math.round((D + 0.75) * VX + WALL_Z), GY = DEPTH + PAR + 2;
  const g = new VoxelGrid(GX, GY, GZ);
  const top = DEPTH - 1;
  const wx = (vx) => cx0 + (vx + 0.5) / VX;         // world x of a voxel column centre
  const wz = (vz) => zA + (vz + 0.5) / VX;
  const holes = holeSet(L);
  const inHole = (x, z) => z > -D / 2 && z < D / 2 && holes.has(Math.floor(x));
  const parZ = Math.round((D / 2 - zA) * VX);        // first parapet voxel row
  const gateVX = Math.round((L.gateX - cx0) * VX);
  const endX = L.len + L.safeLen;

  // per column: colour of the top voxel, and its height offset
  for (let vz = 0; vz < GZ; vz++) for (let vx = 0; vx < GX; vx++) {
    const x = wx(vx), z = wz(vz);
    if (x < LEFT - 6 || x > endX + 1.5) continue;
    if (inHole(x, z)) continue;
    // cliff: the floor's slab goes DEPTH deep; its bottom edge is ragged
    const rag = vz >= GZ - 3 ? Math.floor(Math.abs(Math.sin(x * 2.3) + Math.sin(x * 0.7 + 1)) * 4 + r.next() * 3) : 0;
    for (let y = rag; y < top; y++) {
      const strata = Math.floor((y + Math.sin(x * 0.6) * 1.5) / 3) % 4;
      g.set(vx, y, vz, ['stoneDark', 'dusk', 'stoneDark', 'shadow'][strata]);
    }
    g.set(vx, top, vz, 'stone');
  }

  // slabs: rows of flagstones running along the corridor
  const rowD = 10;
  for (let z0 = -3; z0 < parZ; z0 += rowD) {
    let x0 = -r.int(0, 14);
    while (x0 < GX) {
      const sw = r.pick([10, 12, 14, 16, 18, 22]);
      const shade = r.weighted([['stone', 9], ['dusk', 2], ['stoneLight', 2]]);
      const sunk = r.chance(0.08);
      for (let vz = Math.max(0, z0 + 1); vz < Math.min(parZ, z0 + rowD); vz++) for (let vx = Math.max(0, x0 + 1); vx < Math.min(GX, x0 + sw); vx++) {
        if (!g.get(vx, top, vz)) continue;
        let c = shade;
        const f = r.next();
        if (f < 0.006) c = 'stoneLight'; else if (f < 0.012) c = 'stoneDark';
        const ex = vx === x0 + 1 || vx === x0 + sw - 1, ez = vz === z0 + 1 || vz === z0 + rowD - 1;
        if (ex && ez && r.chance(0.6)) { g.set(vx, top, vz, null); continue; }
        if (vz === z0 + rowD - 1 && shade !== 'stoneLight' && r.chance(0.3)) c = shade === 'dusk' ? 'stone' : 'stoneLight';
        if (sunk) { g.set(vx, top, vz, null); g.set(vx, top - 1, vz, c); } else g.set(vx, top, vz, c);
      }
      x0 += sw;
    }
  }
  // grout: fill gaps a step down
  for (let vz = 0; vz < parZ; vz++) for (let vx = 0; vx < GX; vx++) {
    if (g.get(vx, top, vz) || !g.get(vx, top - 2, vz)) continue;
    if (!g.get(vx, top - 1, vz)) g.set(vx, top - 1, vz, 'stoneDark');
  }
  const paint = (vx, vz, c, y = top, em = false) => { if (vx >= 0 && vx < GX && vz >= 0 && vz < GZ && g.get(vx, y, vz)) g.set(vx, y, vz, c, em); };
  const toV = (x) => Math.floor((x - cx0) * VX), toVZ = (z) => Math.floor((z - zA) * VX);

  // cracks, a few glowing with the heat of the mountain
  const nC = 10;
  for (let i = 0; i < nC; i++) {
    let vx = r.int(0, GX - 1), vz = r.int(toVZ(-D / 2) + 2, parZ - 2);
    const glow = r.chance(0.3);
    for (let n = r.int(5, 14); n > 0; n--) {
      paint(vx, vz, glow ? (n % 3 ? 'ember' : 'blood') : 'stoneDark', top, glow);
      if (r.chance(0.5)) vx += r.pick([-1, 1]); else vz += r.pick([-1, 1]);
    }
  }
  // scattered grit, bone chips and old blood
  for (let i = 0; i < 14; i++) paint(r.int(0, GX - 1), r.int(toVZ(-D / 2), parZ - 1), r.pick(['stoneLight', 'bone', 'dusk']));
  for (let i = 0; i < 2; i++) {
    const sx = r.int(6, GX - 6), sz = r.int(toVZ(-D / 2) + 6, parZ - 6);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -4; dx <= 4; dx++) if (Math.hypot(dx * 0.8, dz) < 2.6 + r.next()) paint(sx + dx, sz + dz, r.chance(0.7) ? 'blood' : 'plum');
  }

  // traps leave their marks on the floor, so every one reads before it moves
  for (const t of L.traps) {
    if (t.kind === 'spikes') {
      const a = toV(t.x0), b = toV(t.x1) - 1, c0 = toVZ(t.z0), c1 = toVZ(t.z1) - 1;
      for (let vz = c0; vz <= c1; vz++) for (let vx = a; vx <= b; vx++) {
        if (vx < 0 || vx >= GX) continue;
        const edge = vx === a || vx === b || vz === c0 || vz === c1;
        const hole = pinAt(vx - a, vz - c0);
        g.set(vx, top, vz, edge ? ((vx + vz) % 3 ? 'slate' : 'mist') : hole ? 'ink' : ((vx + vz) % 4 === 0 ? 'violet' : 'dusk'));
        g.set(vx, top - 1, vz, 'shadow');
      }
    } else if (t.kind === 'jet') {
      // a scorch fan out from the nozzle, fading with distance
      const reach = t.reach ?? D;
      for (let vz = toVZ(-D / 2); vz < toVZ(-D / 2 + reach + 0.3); vz++) for (let vx = toV(t.x - 0.7); vx <= toV(t.x + 0.7); vx++) {
        const d = (wz(vz) + D / 2) / (reach + 0.3), w = Math.abs(wx(vx) - t.x);
        if (w > 0.35 + d * 0.3) continue;
        if (r.next() < 0.75 - d * 0.35) paint(vx, vz, r.chance(0.35) ? 'shadow' : r.chance(0.4) ? 'dirt' : 'stoneDark');
      }
    } else if (t.kind === 'blade') {
      // gouges across the floor where the edge has scraped a thousand times
      for (let q = -2; q <= 2; q++) {
        const vx = toV(t.x + q * 0.22);
        for (let vz = toVZ(-D / 2 + 0.3); vz < toVZ(D / 2 - 0.3); vz++) if (r.next() < 0.7) paint(vx, vz, q === 0 ? 'ink' : 'stoneDark');
      }
    } else if (t.kind === 'crumble') {
      // a rim of broken stone around the bridge
      for (const x of [t.x0, t.x1]) for (let vz = toVZ(-D / 2); vz < parZ; vz++) for (const dx of [-2, -1, 0, 1]) if (r.chance(0.4)) paint(toV(x) + dx, vz, r.pick(['stoneDark', 'shadow', 'dusk']));
    }
  }
  // the gate's floor slot
  if (gateVX >= -2 && gateVX < GX + 2) for (let vz = toVZ(-D / 2); vz < parZ; vz++) for (let dx = -6; dx <= 5; dx++) {
    const vx = gateVX + dx;
    if (vx < 0 || vx >= GX) continue;
    g.set(vx, top, vz, dx === -6 || dx === 5 ? 'slate' : 'ink');
  }

  // the parapet along the open front edge: a low broken wall
  for (let vx = 0; vx < GX; vx++) {
    const x = wx(vx);
    if (x < LEFT - 6 || x > endX + 1.5) continue;
    const broken = Math.sin(x * 0.9) + Math.sin(x * 0.23 + 2) > 1.4;
    const h = broken ? r.int(0, 2) : PAR - (r.chance(0.15) ? 1 : 0);
    for (let vz = parZ; vz < parZ + 5 && vz < GZ; vz++) for (let y = top + 1; y <= top + h; y++) {
      const course = Math.floor((y - top - 1) / 2);
      const joint = (vx + course * 3) % 6 === 5 || (y - top) % 2 === 0 && y !== top + h;
      g.set(vx, y, vz, y === top + h ? (r.chance(0.8) ? 'stoneLight' : 'stone') : joint ? 'stoneDark' : r.pick(['stone', 'dusk', 'stone']));
    }
    if (broken && r.chance(0.3)) g.set(vx, top + 1, parZ + r.int(0, 4), 'stone');
  }
  // stairs down beyond the exit arch (inside the wall's depth)
  const ex = L.exitX;
  for (let vz = 0; vz < toVZ(-D / 2); vz++) for (let vx = toV(ex - 1); vx < toV(ex + 1); vx++) {
    if (vx < 0 || vx >= GX) continue;
    const step = Math.floor((toVZ(-D / 2) - 1 - vz) / 2);
    for (let y = top - step; y <= top; y++) g.set(vx, y, vz, null);
    g.set(vx, top - step - 1 >= 0 ? top - step : 0, vz, ['stoneLight', 'stone', 'dusk', 'shadow', 'night'][Math.min(4, step)]);
  }
  return { grid: g, origin: [0, DEPTH, 0] };
}

function buildWallChunk(L, k) {
  const r = new Rng(`${L.seed}/cwall/${L.key}/${k}`);
  const cx0 = X0 + k * CHUNK;
  const GX = CHUNK * VX, GY = WALL_V + 2, GZ = WALL_Z + 2;
  const g = new VoxelGrid(GX, GY, GZ);
  const face = WALL_Z - 1;              // the masonry face layer
  const wx = (vx) => cx0 + (vx + 0.5) / VX;
  const toV = (x) => Math.floor((x - cx0) * VX);
  const endX = L.len + L.safeLen;
  const brick = ['stone', 'dusk', 'stone', 'violet', 'stoneDark', 'stone', 'dusk'];
  const topOf = [];
  for (let vx = 0; vx < GX; vx++) {
    const x = wx(vx);
    const t = WALL_V - 6 + Math.round(Math.sin(x * 0.7) * 2 + Math.sin(x * 2.9) * 1.2 + r.next() * 2);
    topOf.push(t);
    if (x < LEFT - 6 || x > endX + 1.5) continue;
    for (let y = 0; y < t; y++) {
      if (y < 30) {
        // masonry lining
        const course = Math.floor(y / 4), off = course % 2 ? 4 : 0;
        const mortar = y % 4 === 3 || (vx + off + k * 3) % 8 === 7;
        g.box(vx, y, 0, vx, y, face - 1, 'stoneDark');
        const bi = Math.floor((vx + off + k * CHUNK * VX) / 8) * 31 + course * 17;
        let c = mortar ? 'stoneDark' : brick[Math.abs(bi * 7919) % brick.length];
        if (!mortar && r.chance(0.04)) c = 'stoneLight';
        if (y < 2) c = y === 0 ? 'stoneDark' : 'stone';
        g.set(vx, y, face, c);
      } else {
        // raw rock above: bulges and strata
        const bulge = Math.max(0, Math.round(1.6 + Math.sin(x * 1.3 + y * 0.21) * 1.2 + Math.sin(y * 0.5 + x * 0.4) * 0.8));
        const zf = Math.max(0, face - 3 + Math.min(3, bulge));
        g.box(vx, y, 0, vx, y, zf, 'stoneDark');
        const strata = Math.floor((y + Math.sin(x * 0.8) * 2) / 3) % 5;
        g.set(vx, y, zf, ['stone', 'stoneLight', 'stone', 'dusk', 'stone'][strata]);
      }
    }
    // the ledge where masonry meets rock
    g.set(vx, 30, face + 1, r.chance(0.8) ? 'stoneLight' : 'stone');
    g.set(vx, 30, face, 'stoneLight');
    if (r.chance(0.3)) g.set(vx, 0, face + 1, r.pick(['stone', 'stoneLight', 'stoneDark']));
  }
  // cracks in the rock, a few of them glowing: the mountain is hot
  for (let i = 0; i < 7; i++) {
    let vx = r.int(2, GX - 3), y = r.int(34, WALL_V - 10);
    const hot = false;
    for (let n = r.int(6, 16); n > 0; n--) {
      for (let z = GZ - 1; z >= 0; z--) if (g.get(vx, y, z)) {
        g.set(vx, y, z, hot ? (n % 4 ? 'ember' : 'red') : 'shadow', hot);
        if (hot) for (const [dx, dy] of [[1, 0], [-1, 0]]) { const xx = vx + dx; if (xx >= 0 && xx < GX && g.get(xx, y + dy, z) && !g.colors[g.get(xx, y + dy, z)].emissive) g.set(xx, y + dy, z, 'shadow'); }
        break;
      }
      if (r.chance(0.6)) y += r.pick([-1, 1]); else vx = Math.max(0, Math.min(GX - 1, vx + r.pick([-1, 1])));
    }
  }
  // timber props holding the ceiling up (for now)
  const busy = [...L.sconces, ...L.traps.filter((t) => t.kind === 'jet' || t.kind === 'blade').map((t) => t.x), L.entryX, L.exitX, L.gateX];
  for (let px = X0 + 2; px < L.len + L.safeLen; px += 4.5) {
    if (busy.some((b) => Math.abs(b - px) < 1.4)) continue;
    const vx0 = toV(px);
    if (vx0 < 0 || vx0 + 3 >= GX) continue;
    for (let y = 0; y < 32; y++) for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 2; dz++) g.set(vx0 + dx, y, face + 1 + dz, (y + dx * 3) % 11 === 0 ? 'woodLight' : dx === 0 ? 'dirt' : 'wood');
    for (let dx = -3; dx < 6; dx++) { const x = vx0 + dx; if (x >= 0 && x < GX) { g.set(x, 31, face + 1, 'wood'); g.set(x, 32, face + 1, 'woodLight'); g.set(x, 31, face + 2, 'dirt'); } }
    g.set(vx0 + 1, 20, face + 3, 'slate'); g.set(vx0 + 1, 8, face + 3, 'slate');
  }
  // cracks and missing bricks in the masonry
  for (let i = 0; i < 5; i++) {
    const cx = r.int(4, GX - 5), cy = r.int(6, 24);
    for (let y = cy - 3; y <= cy + 3; y++) for (let vx = cx - 3; vx <= cx + 3; vx++) if (Math.hypot(vx - cx, (y - cy) * 1.2) < 3 - r.next() * 1.4) g.set(vx, y, face, r.chance(0.5) ? 'shadow' : null);
  }
  // sconces: an iron bracket with a cup of live coals (the flame is particles, the light a torch)
  for (const sx of L.sconces) {
    const vx = toV(sx);
    if (vx < 1 || vx >= GX - 1) continue;
    const sy = 17;
    g.box(vx, sy - 5, face + 1, vx, sy - 2, face + 1, 'slate');
    g.box(vx - 1, sy, face + 1, vx + 1, sy, face + 2, 'shadow');
    g.set(vx, sy, face + 1, 'ember', true);
    g.set(vx, sy + 1, face + 1, 'gold', true);
    for (let y = sy + 3; y < sy + 10; y++) if (r.chance(0.6 - (y - sy) * 0.05)) g.set(vx + r.int(-1, 1), y, face, 'stoneDark');
  }
  // soot above every jet's nozzle
  for (const t of L.traps) if (t.kind === 'jet') {
    const vx = toV(t.x);
    for (let y = 9; y < 26; y++) for (let dx = -3; dx <= 3; dx++) if (r.next() < 0.7 - Math.abs(dx) * 0.15 - (y - 9) * 0.03) { const x = vx + dx; if (x >= 0 && x < GX && g.get(x, y, face)) g.set(x, y, face, r.chance(0.5) ? 'shadow' : 'night'); }
  }
  // arches: the caved-in way in (left) and the stair down beyond the gate (right)
  const arch = (ax, blocked) => {
    const c = (ax - cx0) * VX, aw = 8, ah = 21;
    for (let vx = Math.floor(c - aw - 4); vx <= c + aw + 4; vx++) for (let y = 0; y <= ah + 4; y++) {
      if (vx < 0 || vx >= GX) continue;
      const dxi = (vx + 0.5 - c) / aw, dyi = Math.max(0, y - (ah - aw)) / aw;
      const dxo = (vx + 0.5 - c) / (aw + 3), dyo = Math.max(0, y - (ah - aw)) / (aw + 3);
      if (dxi * dxi + dyi * dyi <= 1) {
        g.box(vx, y, 0, vx, y, GZ - 1, null);
        if (blocked) {
          // rubble packed into the arch
          const hgt = ah - 3 - Math.abs(vx - c) * 0.6 + r.next() * 3;
          if (y < hgt) g.set(vx, y, face - 1 - (r.chance(0.3) ? 1 : 0), r.pick(['stone', 'stoneDark', 'dusk', 'stoneLight']));
          else g.set(vx, y, 0, 'ink');
        } else g.set(vx, y, 0, 'ink');
      } else if (dxo * dxo + dyo * dyo <= 1) {
        const vous = Math.floor(Math.atan2(y - (ah - aw), vx + 0.5 - c) / 0.3);
        g.set(vx, y, face + 1, (vous % 2 || y < 2) ? 'stoneLight' : 'stone');
        g.set(vx, y, face, 'stoneLight');
      }
    }
  };
  if (L.entryX >= cx0 - 3 && L.entryX < cx0 + CHUNK + 3) arch(L.entryX, true);
  if (L.exitX >= cx0 - 3 && L.exitX < cx0 + CHUNK + 3) arch(L.exitX, false);
  // the far end wall of the safe room, and the dead end at the start: rough rock faces
  return { grid: g, origin: [0, 0, GZ - 1] };
}

let fixturesBuilt = false;
function buildFixtures(D) {
  if (fixturesBuilt) return;
  fixturesBuilt = true;
  // the iron arm a blade hangs from: out of the back wall to over the corridor's middle,
  // with a brace down to the wall
  {
    const py = Math.round(BLADE.pivotY * VX);
    const Z = Math.round((D / 2) * VX) + 3;       // from inside the wall to just past the pivot
    const g = new VoxelGrid(4, py + 4, Z);
    for (let z = 0; z < Z; z++) for (let x = 1; x < 3; x++) {
      g.set(x, py + 1, z, z % 6 === 0 ? 'mist' : 'slate'); g.set(x, py + 2, z, 'violet');
    }
    for (let k = 0; k < 14; k++) { const z = k, y = py - 14 + k; if (y >= 0) { g.set(1, y, z, 'slate'); g.set(2, y, z, 'violet'); } }
    g.box(0, py - 1, Z - 5, 3, py, Z - 2, 'slate');
    g.box(0, py + 3, Z - 5, 3, py + 3, Z - 2, 'mist');
    defineModel('gauntlet.beam', { grid: g, origin: [2, 0, Z - 3.5] });
  }
  // the end gate: a slab of iron-bound stone that drops across the corridor. The camera sees
  // its top and its front end, so the top carries the detail: bands, rivets, a rune that lights.
  {
    const Z = D * VX, H = 26, T = 10;
    const g = new VoxelGrid(T, H, Z);
    for (let z = 0; z < Z; z++) for (let y = 0; y < H; y++) for (let x = 0; x < T; x++) {
      const band = z % 12 < 2 || y % 9 === 0;
      let c = band ? (x === 0 || x === T - 1 ? 'mist' : 'slate') : (x + y + z) % 7 === 0 ? 'dusk' : 'stone';
      if (y === H - 1 && !band) c = (x + z) % 5 === 0 ? 'stone' : 'stoneLight';
      if (y === 0) c = 'stoneDark';
      g.set(x, y, z, c);
    }
    // rivets on the bands, and the teeth along the bottom edge
    for (let z = 0; z < Z; z += 12) for (const x of [1, T - 2]) g.set(x, H - 1, z, 'fog');
    // a rune across the top, dark until the slab lands
    for (let z = 6; z < Z - 6; z++) { const w = Math.round(1.5 + Math.sin(z * 0.8) * 1.2); for (let x = 5 - w; x <= 4 + w; x++) if ((z + x) % 3 !== 0) g.set(x, H - 1, z, 'violet'); }
    defineModel('gauntlet.gate', { grid: g, origin: [T / 2, 0, 0] });
    const g2 = new VoxelGrid(T, H, Z);
    for (let z = 0; z < Z; z++) for (let y = 0; y < H; y++) for (let x = 0; x < T; x++) if (g.get(x, y, z)) {
      const ci = g.colors[g.get(x, y, z)];
      g2.set(x, y, z, ci.name === 'violet' ? 'gold' : ci.name, ci.name === 'violet');
    }
    defineModel('gauntlet.gate.lit', { grid: g2, origin: [T / 2, 0, 0] });
  }
  // the gate's posts
  {
    const g = new VoxelGrid(6, 40, 6);
    for (let y = 0; y < 38; y++) for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) g.set(x, y, z, y % 8 === 7 ? 'stoneDark' : (x === 0 || z === 5) ? 'stone' : 'dusk');
    g.box(0, 38, 0, 5, 38, 5, 'stoneLight'); g.box(1, 39, 1, 4, 39, 4, 'stone');
    g.box(2, 12, 5, 3, 16, 5, 'ember', true);   // a rune that lights when the gate falls
    defineModel('gauntlet.post', { grid: g, origin: [3, 0, 3] });
    const g2 = new VoxelGrid(6, 40, 6);
    for (let y = 0; y < 38; y++) for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) g2.set(x, y, z, y % 8 === 7 ? 'stoneDark' : (x === 0 || z === 5) ? 'stone' : 'dusk');
    g2.box(0, 38, 0, 5, 38, 5, 'stoneLight'); g2.box(1, 39, 1, 4, 39, 4, 'stone');
    g2.box(2, 12, 5, 3, 16, 5, 'violet');
    defineModel('gauntlet.post.dark', { grid: g2, origin: [3, 0, 3] });
  }
  // the rough rock that closes each end
  {
    const g = new VoxelGrid(10, WALL_V, (D + 2) * VX);
    let s = 5;
    const rr = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let z = 0; z < (D + 2) * VX; z++) for (let y = 0; y < WALL_V - 8 + Math.round(rr() * 4); y++) {
      const d = Math.round(2 + Math.sin(y * 0.4 + z * 0.3) * 2 + rr());
      for (let x = 0; x < 10 - d; x++) g.set(x, y, z, x === 10 - d - 1 ? ['dusk', 'stone', 'stoneDark', 'violet'][Math.floor((y + z * 0.3) / 3) % 4] : 'stoneDark');
    }
    defineModel('gauntlet.endrock', { grid: g, origin: [10, 0, WALL_Z] });
  }
}

/** Define the corridor's chunk models (cached by layout key). Returns their names. */
const builtKeys = new Set();
export function buildCorridorModels(L) {
  buildFixtures(L.D);
  const n = chunkRange(L);
  const names = [];
  for (let k = 0; k < n; k++) names.push({ floor: `gauntlet.floor.${L.key}.${k}`, wall: `gauntlet.wall.${L.key}.${k}`, x: X0 + k * CHUNK });
  if (!builtKeys.has(L.key)) {
    builtKeys.add(L.key);
    for (let k = 0; k < n; k++) { defineModel(names[k].floor, buildFloorChunk(L, k)); defineModel(names[k].wall, buildWallChunk(L, k)); }
  }
  return names;
}

// ---------------------------------------------------------------------------------------
// the corridor runtime
// ---------------------------------------------------------------------------------------
export class Corridor {
  /**
   * root: the scene root. L: generateCorridor(). opts:
   *   hero: () => HeroController     health: () => HeroHealth (the thing traps hurt)
   *   anim: () => HeroAnim (for falls)   banners: false leaves the banners to the hud
   *   autoStart: false holds the collapse until start() is called (deterministic captures)
   */
  constructor(root, L, { hero = () => null, health = () => world.hero, anim = () => null, banners = true, autoStart = true } = {}) {
    this.root = root; this.L = L;
    this.hero = hero; this.health = health; this.animOf = anim;
    this.showBanners = banners;
    this.autoStart = autoStart;
    this.state = 'intro'; this.st = 0; this.t = 0;
    this.group = new THREE.Group(); this.group.name = `corridor:${L.key}`;
    root.add(this.group);
    const D = L.D;
    this.D = D;
    this.start = { x: START_X, z: -0.6, yaw: Math.PI / 2 };
    this.offs = [];
    this.fall = null;           // { t, x, z }
    this.lastSafe = { x: START_X, z: 0 };
    this.stats = { hurts: 0, falls: 0, caught: 0, dodges: 0, time: 0 };
    this.overTicks = 0;
    this.minGap = Infinity;   // the closest the collapse got

    // ---- geometry
    const names = buildCorridorModels(L);
    const zA = -D / 2 - WALL_Z / 8;
    for (const n of names) {
      const f = voxelMesh(n.floor); f.position.set(n.x, 0, zA); this.group.add(f);
      const w = voxelMesh(n.wall); w.position.set(n.x, 0, -D / 2); this.group.add(w);
    }
    const endL = voxelMesh('gauntlet.endrock'); endL.position.set(LEFT - 3, 0, -D / 2); this.group.add(endL);
    const endR = voxelMesh('gauntlet.endrock'); endR.position.set(L.len + L.safeLen, 0, D / 2 - 0.5); endR.rotation.y = Math.PI; this.group.add(endR);
    for (const t of L.traps) if (t.kind === 'blade') { const b = voxelMesh('gauntlet.beam'); b.position.set(t.x, 0, 0); this.group.add(b); }
    this.gate = voxelMesh('gauntlet.gate'); this.gate.position.set(L.gateX, 14, -D / 2); this.group.add(this.gate);
    this.gateLit = voxelMesh('gauntlet.gate.lit'); this.gateLit.visible = false; this.group.add(this.gateLit);
    this.gateY = 14; this.pgateY = 14; this.gateV = 0; this.gateDown = false;
    this.posts = [];
    for (const z of [-D / 2 - 0.3, D / 2 + 0.4]) {
      const lit = voxelMesh('gauntlet.post'); lit.position.set(L.gateX, 0, z); lit.visible = false; this.group.add(lit);
      const dk = voxelMesh('gauntlet.post.dark'); dk.position.set(L.gateX, 0, z); this.group.add(dk);
      this.posts.push({ lit, dk });
    }

    // ---- collision: the back wall, the parapet, both ends; the gate is added when it falls
    const cw = this.collision = new CollisionWorld();
    const endX = L.len + L.safeLen;
    cw.addBox(LEFT - 20, -D / 2 - 4, L.exitX - 1, -D / 2, 'wall');
    cw.addBox(L.exitX + 1, -D / 2 - 4, endX + 20, -D / 2, 'wall');
    cw.addBox(L.exitX - 2, -D / 2 - 6, L.exitX + 2, -D / 2 - 1.3, 'wall');
    cw.addBox(LEFT - 20, D / 2, endX + 20, D / 2 + 4, 'wall');
    cw.addBox(LEFT - 20, -D / 2 - 4, LEFT, D / 2 + 4, 'wall');
    cw.addBox(endX, -D / 2 - 4, endX + 20, D / 2 + 4, 'wall');
    this.gateBox = null;

    // ---- traps
    this.tele = createFloorTiles(this.group);
    const ctx = { group: this.group, D };
    this.traps = L.traps.map((s) => createTrap(s, ctx));
    this.crumbles = this.traps.filter((t) => t.kind === 'crumble');

    // ---- the collapse
    this.collapse = new Collapse(this.group, { x: LEFT, D, v0: L.v0, stopX: L.gateX - 0.85, rng: mulberry(L.seed * 31 + L.index * 7 + 3) });
    this.collapse.prefill(LEFT - 6, LEFT + 0.2, 150);

    // ---- lights and air
    this.sconces = L.sconces.map((x) => {
      const a = new THREE.Object3D(); a.position.set(x, 17 * V, -D / 2 + 2.5 * V); this.group.add(a);
      return { x, light: look.torch(a, { y: 0.3, z: 0.3, color: 'flame', intensity: 1.3, radius: 7 }), anchor: a };
    });
    this.safeAnchor = new THREE.Object3D(); this.safeAnchor.position.set(L.exitX, 0, -D / 2 - 0.6); this.group.add(this.safeAnchor);
    this.safeLight = null;
    this.amb = vfx.ambient({ preset: 'crypt', box: [0, 20, 0.2, 3, -D / 2, D / 2], sources: [], fires: L.sconces.map((x) => [x, 18 * V, -D / 2 + 2.5 * V, 0.9]), dust: 36 });
    look.mood('crypt');   // cool shadow; the collapse brings its own ember light

    const on = (n, f) => this.offs.push(events.on(n, f));
    on('combat:dodge', () => { if (this.state === 'run') this.stats.dodges++; });

    this.banner = null;
    this.say('title');
    this.updateRoom();
    events.emit('gauntlet:enter', { corridor: this });
  }

  // ---- queries (the demo pilot and the overlay use these) ------------------------------------
  /** A trap that would hurt a body of radius r at (x, z) at corridor tick t, or null. */
  hazard(x, z, r, t) {
    for (const tr of this.traps) {
      if (tr.kind === 'crumble' || x + r < tr.x0 - 0.8 || x - r > tr.x1 + 0.8) continue;
      const h = tr.hits(x, z, r, t);
      if (h) return { trap: tr, ...h };
    }
    return null;
  }
  /** Is there a hole under (x, z) at tick t? */
  pitAt(x, z, t) { for (const c of this.crumbles) if (c.pitAt(x, z, t)) return true; return false; }
  /** Floor that will not hold you for long (never wait on it). */
  crumbly(x) { for (const c of this.crumbles) if (c.crumbly(x)) return true; return false; }
  trapsIn(x0, x1) { return this.traps.filter((t) => t.x1 > x0 && t.x0 < x1); }

  setState(s) { this.state = s; this.st = 0; }

  /** The ceiling gives way: the chase begins. */
  begin() {
    if (this.state !== 'intro') return;
    this.setState('run');
    this.collapse.start();
    // rock bursts out of the caved-in arch
    vfx.death(this.L.entryX, 1.2, -this.D / 2 + 0.3, { colors: ['stone', 'dusk', 'stoneLight', 'ember'], power: 1.4, soul: false, ring: 'ember' });
    this.say('run');
    events.emit('gauntlet:start', { corridor: this });
  }

  // ---- per tick ------------------------------------------------------------------------------
  tick() {
    this.t++; this.st++;
    const t = this.t, L = this.L;
    const c = this.hero(), hp = this.health();
    if (this.state === 'intro' && this.autoStart && this.st >= INTRO) this.begin();
    if (this.state === 'run') this.stats.time++;

    // hero status for the traps
    const dashing = !!c && c.state === 'dash';
    const heroInfo = c && !this.fall ? { x: c.x, z: c.z, dashing } : null;
    const front = this.collapse.active ? this.collapse.front : -Infinity;
    for (const tr of this.traps) {
      if (tr.kind === 'crumble') tr.tick(t, this.state === 'safe' ? null : heroInfo, front);
      else if (tr.x1 > front - 1) tr.tick(t);
    }

    // hurts: traps (the health rules handle i-frames and the dash dodge)
    if (c && hp && !hp.dead && !this.fall && (this.state === 'run' || this.state === 'intro')) {
      const h = this.hazard(c.x, c.z, 0.3, t);
      if (h) {
        const res = hp.hurt(1, h.source);
        if (res.ok) {
          this.stats.hurts++;
          events.emit('gauntlet:hurt', { cause: h.cause, x: c.x, z: c.z });
          if (h.cause === 'fire') vfx.embers(c.x, 0.8, c.z, { n: 10, spread: 0.3, up: 1.5 });
        }
      }
      // pits: fall unless dashing over them (a two-tick grace, so a toe over the edge is fine)
      if (!dashing && this.pitAt(c.x, c.z, t)) { this.overTicks++; if (this.overTicks >= 3) this.startFall(c); }
      else this.overTicks = 0;
      if (!dashing && !this.crumbly(c.x) && !this.pitAt(c.x, c.z, t) && !this.hazard(c.x, c.z, 0.35, t)) this.lastSafe = { x: c.x, z: c.z };
    }
    if (this.fall) this.tickFall();

    // the collapse
    const res = this.collapse.tick(c && !this.fall ? { x: c.x, z: c.z, dead: hp?.dead } : (c ? { x: this.fall ? this.fall.x : c.x, z: c.z, dead: true } : null));
    if (res === 'caught' && this.state === 'run') this.caught(c, hp);
    if (this.state === 'run' && this.collapse.active) this.minGap = Math.min(this.minGap, this.collapse.gap);

    // through the gate: it slams behind the hero
    if (this.state === 'run' && c && c.x > L.gateX + 1.1 && !this.fall) this.slamGate();
    if (this.state === 'safe') this.tickSafe(c);
    // the gate falling
    this.pgateY = this.gateY;
    if (this.gateDown && this.gateY > 0) {
      this.gateV += 0.07;
      this.gateY = Math.max(0, this.gateY - this.gateV);
      if (this.gateY === 0) this.gateLanded();
    }

    // the telegraph floor
    this.tele.begin();
    for (const tr of this.traps) if (tr.x1 > front - 1) tr.tele(this.tele, t);
    if (this.collapse.active && !this.collapse.stopped) this.frontLine(t);
    this.tele.end();

    // ambient follows the view
    const cx = display.cameraTarget?.x ?? 0;
    this.amb.set({ box: [cx - 11, cx + 11, 0.2, 3, -this.D / 2, this.D / 2] });
    if (this.banner) { this.banner.t++; if (this.banner.t > this.banner.dur) this.banner = null; }
    this.updateRoom();
  }

  /** The floor cracking open just ahead of the rock: the killing edge, in the telegraph's red. */
  frontLine(t) {
    const f = this.collapse.front, D = this.D;
    for (let z = -D / 2 + V / 2; z < D / 2; z += V) {
      const iz = Math.round(z / V);
      const j = ((iz * 7919) % 5 + 5) % 5;
      const reach = f + 0.15 + ((iz * 13 + Math.floor(t / 6)) % 3) * V + j * V * 0.5;
      this.tele.dot(reach, z, j < 2 ? 'red' : 'blood');
      if (j === 0) this.tele.dot(reach + V, z, 'blood');
    }
  }

  startFall(c) {
    this.fall = { t: 0, x: c.x, z: c.z };
    this.stats.falls++;
    c.stun(60);
    c.vx = 0; c.vz = 0;
    this.animOf()?.hurt(null);
    gauntletSfx.fall();
    vfx.dust(c.x, c.z, { n: 6, size: 1, palette: 'dust', spread: 1 });
    events.emit('gauntlet:fall', { x: c.x, z: c.z });
  }
  tickFall() {
    const f = this.fall, c = this.hero(), a = this.animOf(), hp = this.health();
    f.t++;
    if (c) c.teleport(f.x, f.z);
    if (a) a.floorY = -0.5 * 26 * (f.t / 60) ** 2;
    if (f.t === 30) {
      // back up on the last solid ground, a step ahead of the collapse if it has got that far
      const bad = (x, z) => this.crumbly(x) || this.pitAt(x, z, this.t) || this.hazard(x, z, 0.4, this.t);
      const minX = this.collapse.active ? this.collapse.front + 1.4 : -99;
      let x = Math.max(this.lastSafe.x, minX), z = this.lastSafe.z;
      // step back off any crumbling run (never land on a tile that is about to go), else forward past it
      let back = x;
      while (back > minX && this.crumbly(back)) back -= 0.25;
      if (back > minX && !bad(back, z)) x = back;
      for (let k = 0; k < 60 && bad(x, z); k++) x += 0.5;
      if (a) a.floorY = 0;
      // the fall costs a heart (the hurt rules play the flash and the i-frames)
      if (hp && !hp.dead) hp.hurt(1, { x, z }, { force: true });
      c?.teleport(x, z, Math.PI / 2);
      if (c) { c.stunT = 0; c.vx = 0; c.vz = 0; }
      if (hp && !hp.dead) a?.spawn();
      this.fall = null;
    }
  }

  caught(c, hp) {
    this.stats.caught++;
    this.collapse.caught++;
    events.emit('gauntlet:caught', { x: c.x, z: c.z });
    feedback.shake(8, 400);
    feedback.flash('ember', 160, 0.3);
    vfx.death(c.x, 0.6, c.z, { colors: ['stone', 'dusk', 'ember', 'stoneDark'], power: 1.2, soul: false, ring: 'ember' });
    if (world.god) {
      // the showcase demo cannot die: thrown clear, the run goes on (counted in stats.caught)
      hp?.hurt(1, { x: c.x - 1, z: c.z }, { force: true });
      let x = this.collapse.front + 2.5;
      for (let k = 0; k < 30 && (this.pitAt(x, c.z, this.t) || this.hazard(x, c.z, 0.4, this.t)); k++) x += 0.5;
      c.teleport(x, c.z);
      return;
    }
    hp?.hurt(hp.hp, { x: c.x - 1, z: c.z }, { force: true });
    this.setState('caught');
  }

  slamGate() {
    this.setState('safe');
    this.gateDown = true; this.gateV = 0.1;
    this.collapse.stop();
    events.emit('gauntlet:safe', { corridor: this });
  }
  gateLanded() {
    const L = this.L, D = this.D;
    this.gateBox = this.collision.addBox(L.gateX - 0.65, -D / 2, L.gateX + 0.65, D / 2, 'door');
    this.gate.visible = false; this.gateLit.visible = true;
    // anyone standing in the gateway is pushed through
    const c = this.hero();
    if (c && Math.abs(c.x - L.gateX) < 1) c.teleport(L.gateX + 1, c.z);
    feedback.shake(6, 320);
    feedback.kick(0, -1, 3);
    feedback.hitstop(80);
    gauntletSfx.slam();
    for (let k = 0; k < 6; k++) vfx.dust(L.gateX + 0.1, -D / 2 + 0.4 + k * (D - 0.8) / 5, { dx: 1, n: 4, size: 1.4, palette: k % 2 ? 'dustWarm' : 'dust', spread: 0.7 });
    for (let k = 0; k < 5; k++) vfx.hitSpark(L.gateX, 0.2, -D / 2 + 0.5 + k, { dx: 1, dz: 0, power: 0.4, palette: 'hit', light: false });
    look.flash(L.gateX, 1, 0, { color: 'torch', ms: 180, intensity: 2.4, radius: 5 });
    for (const p of this.posts) { p.lit.visible = true; p.dk.visible = false; }
    this.say('safe');
  }
  tickSafe(c) {
    const L = this.L, s = this.st;
    // the release: the collapse slams into the gate, dust blows through the bars, then quiet
    if (s === 90) {
      if (!this.safeLight && look.lights) this.safeLight = look.torch(this.safeAnchor, { y: 1.2, color: 'gold', intensity: 1.5, radius: 5.5, flicker: 0.4 });
      gauntletSfx.release();
      this.say('breathe');
      for (let k = 0; k < 10; k++) vfx.later(k * 3, (a) => vfx.twinkle(a.x, 0.3 + (a.k % 3) * 0.3, a.z, { color: 'gold', size: 1 }), { x: L.gateX + 1 + (k * 0.7) % 5, z: -2 + (k * 1.3) % 4, k });
    }
    if (this.safeLight) this.safeLight.intensity = Math.min(1.6, (s - 90) / 60 * 1.6);
    if (c && this.state === 'safe' && c.z < -this.D / 2 - 0.3 && Math.abs(c.x - L.exitX) < 1.2) {
      this.setState('exited');
      events.emit('gauntlet:exit', { corridor: this });
    }
  }

  // ---- banners -------------------------------------------------------------------------------
  say(kind) {
    const L = this.L;
    const B = {
      title: { text: L.name, sub: L.sub, dur: 70 },
      run: { text: 'RUN!', sub: 'THE CEILING IS COMING DOWN', dur: 80 },
      safe: { text: 'SAFE', sub: '', dur: 110 },
      breathe: { text: '', sub: 'THE GAUNTLET HOLDS. THE STAIR GOES DOWN.', dur: 200 },
    }[kind];
    this.banner = { kind, ...B, t: 0 };
  }

  updateRoom() {
    world.room = { index: this.L.index, kind: 'corridor', id: this.L.key, name: this.L.name, seed: this.L.seed, state: this.state,
      beats: this.L.beats.map((b) => b.id), collapse: this.collapse.info(), cleared: this.state === 'safe' || this.state === 'exited' };
  }

  // ---- camera --------------------------------------------------------------------------------
  /**
   * Call instead of cam.tick(ctl) each tick. The view runs ahead of the hero so the next
   * traps are on screen, but keeps the collapse's edge in frame whenever it is close; at the
   * end it settles on the gate, so the shut bars, the stilled rock and the hero share the shot.
   */
  tickCamera(cam, ctl) {
    cam.pos.snap();
    const c = cam.pos.cur, L = this.L;
    const halfW = display.width / (2 * 32 * display.zoom);
    let gx = ctl.x + halfW * 0.22;
    const col = this.collapse;
    if (col.active && !col.stopped) gx = Math.max(gx, col.front + halfW * 0.62);
    gx = Math.min(gx, ctl.x + halfW - 1.6);            // the hero never leaves the screen
    if (this.state === 'safe' || this.state === 'exited') gx = L.gateX + 1.4;
    gx = Math.max(LEFT - 2 + halfW, Math.min(L.len + L.safeLen + 1.5 - halfW, gx));
    const gz = CAM_Z;
    const k = this.state === 'safe' ? 0.05 : 0.12;
    c.x += (gx - c.x) * k;
    c.z += (gz - c.z) * 0.2;
    cam.goal.x = c.x; cam.goal.z = c.z; cam.vel.x = 0; cam.vel.z = 0;
  }

  // ---- render --------------------------------------------------------------------------------
  render(alpha) {
    for (const tr of this.traps) tr.render(alpha, this.t);
    this.collapse.render(alpha);
    this.gate.position.y = this.pgateY + (this.gateY - this.pgateY) * alpha;
    this.gateLit.position.copy(this.gate.position);
  }

  ui(g) {
    const W = display.width, H = display.height;
    // the collapse off the left edge of the view: an ember glow creeping in from the edge
    const col = this.collapse;
    if (col.active && !col.stopped) {
      const halfW = W / (2 * 32 * display.zoom);
      const left = (display.cameraTarget?.x ?? 0) - halfW;
      const off = left - col.front;
      if (off > -0.5 && off < 14) {
        const k = 1 - Math.max(0, off) / 14;
        const bands = Math.round(2 + k * 6);
        for (let b = 0; b < bands; b++) {
          g.fillStyle = css(b < bands / 3 ? 'ember' : b < (2 * bands) / 3 ? 'red' : 'blood');
          for (let y = (b + this.t) % 2; y < H; y += 2 + (b >> 1)) g.fillRect(b, y, 1, 1);
        }
        if (off > 1 && this.t % 30 < 22) drawText(g, `< ${Math.round(off + halfW)}`, 10 + bands, Math.round(H * 0.52), 'ember', { outline: 'ink' });
      }
    }
    if (!this.showBanners || !this.banner) return;
    const B = this.banner, t = B.t, out = B.dur - t;
    if (B.kind === 'title') {
      const k = Math.min(1, t / 8), o = Math.min(1, out / 10);
      const y = Math.round(H * 0.2);
      const bw = Math.round((textWidth(B.text) * 2 + 40) * Math.min(k, o));
      g.fillStyle = css('ink'); g.fillRect(Math.round(W / 2 - bw / 2), y - 6, bw, 34);
      g.fillStyle = css('ember'); g.fillRect(Math.round(W / 2 - bw / 2), y - 6, bw, 1); g.fillRect(Math.round(W / 2 - bw / 2), y + 27, bw, 1);
      if (k >= 0.8 && o > 0.5) {
        drawText(g, B.sub, W / 2, y - 2, 'mist', { align: 'center' });
        drawText(g, B.text, W / 2, y + 9, 'bone', { align: 'center', scale: 2, shadow: 'dusk' });
      }
    } else if (B.kind === 'run') {
      if (out < 12 && out % 4 < 2) return;
      const y = Math.round(H * 0.18);
      const s = t < 3 ? 5 : t < 6 ? 4 : 3;
      const jx = t < 20 ? ((t * 7) % 3) - 1 : 0;
      drawText(g, B.text, W / 2 + jx, y - (s - 3) * 3, t < 4 ? 'white' : 'ember', { align: 'center', scale: s, outline: 'ink' });
      if (t > 6) drawText(g, B.sub, W / 2, y + 24, 'flame', { align: 'center', shadow: 'ink' });
    } else if (B.kind === 'safe') {
      if (out < 12 && out % 4 < 2) return;
      const y = Math.round(H * 0.2);
      const k = Math.min(1, t / 7);
      const bw = Math.round(W * 0.5 * k);
      g.fillStyle = css('ink'); g.fillRect(Math.round(W / 2 - bw / 2), y - 8, bw, 36);
      g.fillStyle = css('gold'); g.fillRect(Math.round(W / 2 - bw / 2), y - 8, bw, 2); g.fillRect(Math.round(W / 2 - bw / 2), y + 26, bw, 2);
      if (t >= 3) drawText(g, B.text, W / 2, y + (t < 5 ? -2 : 0), t < 6 ? 'white' : 'gold', { align: 'center', scale: 3, shadow: 'blood' });
    } else if (B.kind === 'breathe') {
      if (out < 12 && out % 4 < 2) return;
      drawText(g, B.sub, W / 2, Math.round(H * 0.2) + 36, t % 50 < 40 ? 'gold' : 'flame', { align: 'center', outline: 'ink' });
    }
  }

  info() {
    return {
      key: this.L.key, index: this.L.index, seed: this.L.seed, state: this.state, st: this.st, t: this.t, len: this.L.len,
      beats: this.L.beats.map((b) => `${b.id}@${b.x0}`), collapse: this.collapse.info(), stats: { ...this.stats }, minGap: +this.minGap.toFixed(2),
      traps: this.traps.map((tr) => ({ kind: tr.kind, x: +(((tr.x0 + tr.x1) / 2).toFixed(1)), phase: tr.phase(this.t) })),
    };
  }

  dispose() {
    this.offs.forEach((f) => f()); this.offs = [];
    for (const tr of this.traps) tr.dispose();
    this.collapse.dispose();
    this.tele.dispose();
    this.amb.stop();
    for (const s of this.sconces) s.light.remove();
    this.safeLight?.remove();
    look.mood('crypt');
    this.root.remove(this.group);
    if (active === this) active = null;
  }
}
const CAM_Z = -0.6;

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------------------
// a playable bundle: hero + corridor, for scenes (the 'gauntlet' scene, the showcase)
// ---------------------------------------------------------------------------------------
/**
 * Build a hero and a corridor in `root`. Returns { cor, ctl, anim, rig, health, combat, cam, cfx,
 * tick(), render(alpha), ui(g), dispose() }. source: an input source for the controller
 * (default: the player's input). god: the hero cannot die.
 */
export function createCorridorRun(root, { index = 0, seed = 1, layout = null, source = input, hp = 5, autoStart = true, banners = true } = {}) {
  const L = layout ?? generateCorridor(index, seed);
  const B = {};
  const cor = setActiveCorridor(new Corridor(root, L, { hero: () => B.ctl, health: () => B.health, anim: () => B.anim, autoStart, banners }));
  setCollision(cor.collision);
  const s = cor.start;
  B.rig = createHeroRig();
  root.add(B.rig.group);
  B.anim = new HeroAnim(B.rig, { x: s.x, z: s.z, yaw: s.yaw });
  B.anim.spawn();
  B.ctl = new HeroController({ x: s.x, z: s.z, yaw: s.yaw, anim: B.anim, collision: cor.collision, source });
  B.health = new HeroHealth({ ctl: B.ctl, anim: B.anim, rig: B.rig, hp });
  B.combat = new HeroCombat({ ctl: B.ctl, anim: B.anim, health: B.health, targets: () => world.enemies });
  B.cam = new CameraRig({});
  B.cam.reset(s.x + 3, CAM_Z);
  B.cfx = createCombatFx(root, { numbers: false });
  B.cor = cor;
  world.hero = B.health;
  const unbind = vfx.bind(['move', 'kill']);
  return Object.assign(B, {
    tick() {
      B.combat.tick();
      cor.tickCamera(B.cam, B.ctl);
      cor.tick();
      B.cfx.tick();
    },
    render(alpha) {
      B.anim.render(alpha);
      B.health.render();
      const off = B.cam.render(alpha, B.ctl.at(alpha));
      B.rig.group.position.set(off.x, off.y, off.z);
      cor.render(alpha);
      B.cfx.render(alpha);
    },
    ui(g) { B.cfx.ui(g); cor.ui(g); },
    dispose() {
      unbind?.();
      B.cfx.dispose();
      root.remove(B.rig.group);
      cor.dispose();
      setCollision(null);
    },
  });
}

// ---------------------------------------------------------------------------------------
// the 'gauntlet' scene: a corridor in normal play. data: { index, room (the next arena), seed }
// Walking down the stair goes to scenes 'run' { room }; dying goes to 'gameover'.
// ---------------------------------------------------------------------------------------
scenes.define('gauntlet', (() => {
  let run = null, deadT = -1, next = 1, offs = [], prog = null, hud = null;
  return {
    pausable: true,
    enter(data, root) {
      world.reset();
      display.setZoom(1);
      const index = Math.max(0, Math.min(CORRIDOR_COUNT - 1, data?.index ?? 0));
      next = data?.room ?? index + 1;
      run = createCorridorRun(root, { index, seed: data?.seed ?? window.__GR?.seed ?? 1 });
      deadT = -1;
      // boons piece: held boons work in corridors too (no drops here)
      prog = createProgression(root, { ctl: run.ctl, anim: run.anim, rig: run.rig, health: run.health, combat: run.combat, drops: false, hud: false });
      hud = createHud({ health: run.health, runtime: prog.runtime });   // hud piece
      offs.push(events.on('gauntlet:exit', () => scenes.go('run', { room: next })));
      debug.handle('goto', (i) => { scenes.go('run', { room: i | 0 }); return { ok: true, room: i | 0 }; });
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      prog?.dispose(); prog = null;
      hud?.dispose(); hud = null;
      run?.dispose(); run = null;
      debug.handle('goto', () => ({ ok: false, error: 'no rooms in this scene' }));
    },
    tick() {
      run.tick();
      prog.tick();
      if (run.health.dead && deadT < 0) deadT = 0;
      if (deadT >= 0 && ++deadT > 90) scenes.go('gameover', { cause: 'collapse' });
    },
    render(alpha) { run.render(alpha); prog.render(alpha); },
    frame() { prog?.frame(); },
    ui(g) {
      run.ui(g);
      hud.ui(g);
      prog.ui(g);
    },
    state() { return { corridor: run?.cor.info() ?? null }; },
  };
})());

// ---------------------------------------------------------------------------------------
// the active corridor, for debug hooks
// ---------------------------------------------------------------------------------------
let active = null;
export function setActiveCorridor(c) { active = c; return c; }
export const getActiveCorridor = () => active;

// __GR.debug.corridor(action?, ...):
//   ()                        the active corridor's info: beats, collapse, traps, stats
//   ('plan', seed?)           the four corridors' beats for a seed (no scene change)
//   ('go', index, room?)      play corridor `index` in the 'gauntlet' scene (normal play)
//   ('start')                 start the collapse now
//   ('safe')                  slam the gate as if the hero got through (teleports the hero)
//   ('collapse', {v0, vMin, ...})  tune the collapse live (see COLLAPSE in collapse.js)
debug.add('corridor', (action, a, b) => {
  if (action === 'plan') {
    const seed = a ?? window.__GR?.seed ?? 1;
    return { seed, corridors: [0, 1, 2, 3].map((i) => { const L = generateCorridor(i, seed); return { index: i, len: L.len, beats: L.beats.map((x) => x.id), v0: L.v0 }; }) };
  }
  if (action === 'go') { scenes.go('gauntlet', { index: a | 0, room: b ?? (a | 0) + 1 }); return { ok: true }; }
  const C = active;
  if (!C) return { ok: false, error: 'no corridor in this scene' };
  if (action === 'start') { C.begin(); return { ok: true, state: C.state }; }
  if (action === 'safe') { const c = C.hero(); c?.teleport(C.L.gateX + 1, 0); if (C.state === 'intro') C.begin(); C.slamGate(); return { ok: true, state: C.state }; }
  if (action === 'collapse') { if (a && typeof a === 'object') for (const k in a) if (k === 'v0') C.collapse.v0 = +a[k]; return { ok: true, ...C.collapse.info() }; }
  return { ok: true, ...C.info() };
});
