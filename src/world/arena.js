// Arenas (piece `arenas`): seeded rooms from hand-authored templates, and the room runtime:
// doors that seal and open with ceremony, lights that wake, props, waves, the clear moment.
//
//   import { generateArena, Arena, ARENA_COUNT, cameraBounds } from '../world/arena.js';
//   const layout = generateArena(index /* 0..4 */, seed);   // pure: same seed, same room
//   const arena = new Arena(root, layout, { hero: () => ctl });   // builds meshes, lights, colliders
//   setCollision(arena.collision);                            // the hero and enemies share it
//   combat targets: () => [...world.enemies, ...arena.targets()]
//   tick (after combat.tick()):  arena.tick()       render: arena.render(alpha)     ui: arena.ui(g)
//   exit: arena.dispose()
//
// Flow (arena.state):
//   'waiting'   the hero starts on the landing outside the front gate; the exit is sealed
//   'sealing'   the hero steps in: the gate's spikes accelerate up out of the floor slot and slam
//               (a voxel of overshoot, a bounce; shake, a downward kick, dust both ways, chunks),
//               the post lamps flare red then cool to ember, the torches wake one by one, and the
//               room's name comes up (it waits while a run card is on screen: opts.bannerHold)
//   'fight'     the waves (waves.js)
//   'clearing'  the killing blow on the last enemy: slow motion, a white flash and a gold ring,
//               every light flares, ARENA CLEARED, the seal shatters, the portcullis ratchets up
//   'open'      the way down is open; walking into the exit arch ends the room ('exited')
//
// Templates: rows of tiles, one character per world tile (legend at TEMPLATES). Each has its own
// size, outline (wall masses, pits, water, ledges), material theme (tiles.js THEMES) and one
// set-piece (props.js). Variation per seed: which template each arena slot uses, a layout
// variant where a template has several, a mirror, every '?' slot, the ledge dressing, prop
// variants and turns, the floor's stones, cracks, moss and stains, and the waves.
// Pathing: pits and masses make concave corners, so the room gives its enemy manager a nav hook
// (foes.nav -> waypoint()): a tile BFS waypoint whenever an enemy's straight line is blocked.
//
// Events: 'arena:enter' {arena}  'arena:seal'  'arena:wave' {n, total, units}  'arena:clear' {x, z}
//         'arena:open'  'arena:exit'   (plus 'prop:hit' / 'prop:break' from props.js)

import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { debug } from '../core/debug.js';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { voxelMesh, VOXEL } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { CollisionWorld } from '../core/collision.js';
import { createEnemies } from '../enemies/index.js';
import { THEMES, buildRoomModels, buildDoorModels, POST_H, GATE_H, LEDGE_Y, PILASTER, SOLID_TILES, LOW_TILES } from './tiles.js';
import { createProps, bannerModels, arenaSfx } from './props.js';
import { planWaves, WaveDirector, describeUnits } from './waves.js';

const V = VOXEL;
export const ARENA_COUNT = 5;

// ---------------------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------------------
// Tile legend (rows run back to front; the gate is always the middle 3 tiles of the front):
//   .  floor           #  chest-high masonry block      =  drain grate      s  spawn point
//   X  wall mass (the room's outline: bastions, cut corners, alcoves)
//   ^  raised ledge (dressed with candles, urns and bones)   Z  a ledge with a sarcophagus on it
//   _  pit (a drop into the dark, or the Maw's lava)    ~  water (in the deep: lava)
//   P  pillar          p  broken pillar stump           B  brazier (a light)
//   u  urns (break)    c  crate (2 hits)   l  barrel (2 hits)   b  bones (scatter)   k  candles
//   r  rubble (decor)  S  statue           K  skull pile        A- sarcophagus (two tiles)
//   set-pieces (one per room, centred on the tile, the tiles round them stay '.'):
//   C  the fallen colossus   T  the Warden's throne   Y  the root tree   F  the fountain   M  the bone mound
//   o  the focal inlay's centre (the focal can also sit under a prop: `focal.at`, or at `focal.c`)
//   ?  a seeded pick: urns, bones, rubble, a barrel, a crate or nothing
// Wall legend (one character per tile of the back wall):
//   t  sconce (a light)   n  banner   a  alcove (skull, candle)   h  chains   x  crumbled   r  roots
//   E  the exit arch (three tiles)
// rows: one layout, or a list of layouts the seed picks from.
export const TEMPLATES = {
  antechamber: {
    name: 'THE ANTECHAMBER', theme: 'crypt', focal: { kind: 'ring', r: 3.0, at: 'C' }, shafts: [[8, 6]],
    wall: '..t..n.EEE.n..t..',
    rows: [
      'XX^^^.......^^^XX',
      'X...............X',
      '..P..B.....B..P..',
      '.s.............s.',
      '.................',
      '.?s...........s?.',
      '........C........',
      '.................',
      '.s..r........r.s.',
      '..P...........P..',
      'X?.............?X',
      'XXu...s...s...lXX',
    ],
  },
  cistern: {
    name: 'THE CISTERN', theme: 'sunken', focal: { kind: 'ring', r: 2.6, at: 'F' }, shafts: [[8, 6]], bay: 3,
    wall: '..t..a.EEE.a..t..',
    rows: [
      '^^^...........^^^',
      '~~.P....s....P.~~',
      '~~~...........~~~',
      '~~.s.........s.~~',
      '~~.............~~',
      '~~..k.......k..~~',
      '~~......F......~~',
      '~~.............~~',
      '~~~.k.......k.~~~',
      '~~.s.........s.~~',
      '~~.P.........P.~~',
      '.?.............?.',
      'Xu.............lX',
    ],
  },
  shrine: {
    name: 'THE DROWNED SHRINE', theme: 'sunken', focal: { kind: 'rune', r: 4.4, at: 'S' }, shafts: [[9, 5]],
    wall: '..t..a..EEE..a..t..',
    rows: [
      '^^...............^^',
      '^..P....s.s....P..^',
      '...................',
      '........~~~........',
      '.s....k~~~~~k....s.',
      '......~~~S~~~......',
      '......~~~~~~~......',
      '.......k~~~k.......',
      '...................',
      '~~.s...........s.~~',
      '~~~p...........P~~~',
      '~~~?...........?~~~',
    ],
  },
  ossuary: {
    name: 'THE OSSUARY', theme: 'ossuary', focal: { kind: 'square', r: 3.5, at: 'M' }, bay: 3, shafts: [[8, 5]],
    wall: 'a.t.a..EEE..a.t.a',
    rows: [
      'XX.k.........k.XX',
      'X.....s...s.....X',
      '^^.............^^',
      '^Z.s.........s.Z^',
      '^^...=.....=...^^',
      '^^......M......^^',
      '^^...=.....=...^^',
      '^Z.s.........s.Z^',
      '^^.............^^',
      '..b...........b..',
      'X?.............?X',
      'XXu...........uXX',
    ],
  },
  hall: {
    name: 'THE HALL OF WARDENS', theme: 'hall', focal: null, bay: 3, shafts: [[7, 4], [7, 10]], carpetFrom: 2,
    wall: '.EEE.t.....t.n.',
    rows: [
      '.....^^T^^.....',
      '...............',
      '.B...........B.',
      '...P...s...P...',
      '.s...........s.',
      '...P.......P...',
      'l.............c',
      '...P...s...P...',
      '.s...........s.',
      '...P.......P...',
      'u.............?',
      '...P...s...P...',
      'X.............X',
      'XX?.........?XX',
      'XXX.s.....s.XXX',
    ],
  },
  crossing: {
    name: 'THE BROKEN CROSSING', theme: 'garden', focal: { kind: 'none', at: 'Y' }, sideBreak: true, shafts: [[9, 6]],
    wall: '..t...EEE..n...t...',
    rows: [
      '______.....s.______',
      '_____..........____',
      '___....p.......p.__',
      '_..s.............._',
      '...................',
      '.s.......b.......s.',
      '.........Y.........',
      '..k.............?..',
      '.s...............s.',
      '__.....p.....p...__',
      '___..........s..___',
      '_____.?.....?._____',
      '______c.....l______',
    ],
  },
  maw: {
    name: 'THE EMBER MAW', theme: 'deep', focal: { kind: 'rune', r: 3.6, c: [10, 6] }, sideBreak: true, shafts: [[10, 6]], lava: true,
    wall: '..t.x.n..EEE..n.x.t..',
    rows: [[
      'XXXX.............XXXX',
      'XX......s...s......XX',
      'X..p.............P..X',
      '.s.................s.',
      '........B...B........',
      '.........__..........',
      '.s.....______......s.',
      '..........____.......',
      '.....................',
      '.s.................s.',
      'X.A-..............p.X',
      'XX.P.....s...s....?XX',
      'XXXX?u.........l?XXXX',
    ], [
      'XXX......s...s....XXX',
      'XX.k...............XX',
      'X..P.....___.....P..X',
      '.s.......____......s.',
      '.....B....__....B....',
      '..........___........',
      '.s.........___.....s.',
      '...........__........',
      '....#...........#....',
      '.s..#.....s.....#..s.',
      'X..p.............P..X',
      'XX.A-............?.XX',
      'XXXX?u.........l?XXXX',
    ]],
  },
};
/** Which templates each arena slot may use (a run never repeats one while others remain). */
export const SLOTS = [
  ['antechamber', 'cistern'],
  ['ossuary', 'shrine', 'antechamber'],
  ['hall', 'crossing', 'cistern'],
  ['crossing', 'ossuary', 'hall', 'shrine'],
  ['maw'],
];
const OPTIONAL = [['u', 3], ['b', 2], ['r', 2], ['l', 1], ['c', 1], ['.', 2]];
const SETPIECES = { C: 'colossus', T: 'throne', Y: 'tree', F: 'fountain', M: 'mound' };
const variantsOf = (T) => (Array.isArray(T.rows[0]) ? T.rows : [T.rows]);

/** Check every template once (row lengths, gate clear, exit width). Throws on a bad one. */
function validate(id, T) {
  const W = T.wall.length;
  const e0 = T.wall.indexOf('E'), e1 = T.wall.lastIndexOf('E');
  if (e0 < 0 || e1 - e0 !== 2) throw new Error(`arena template ${id}: the exit must be three tiles`);
  const g0 = (W - 3) / 2;
  if (!Number.isInteger(g0)) throw new Error(`arena template ${id}: width must be odd`);
  variantsOf(T).forEach((rows, v) => {
    const D = rows.length;
    rows.forEach((row, j) => { if (row.length !== W) throw new Error(`arena template ${id}/${v}: row ${j} is ${row.length} wide, not ${W}`); });
    for (let i = g0; i < g0 + 3; i++) if (rows[D - 1][i] !== '.') throw new Error(`arena template ${id}/${v}: gate tile ${i} is blocked`);
    for (let i = e0; i <= e1; i++) if (SOLID_TILES[rows[0][i]]) throw new Error(`arena template ${id}/${v}: the exit tile ${i} is blocked`);
  });
}
for (const id in TEMPLATES) validate(id, TEMPLATES[id]);

/** The template ids for arenas 0..4 of a run with this seed. */
export function runTemplates(seed) {
  const r = new Rng(`${seed}/arena-templates`);
  const used = [];
  return SLOTS.map((pool) => {
    const fresh = pool.filter((p) => !used.includes(p));
    const pick = r.pick(fresh.length ? fresh : pool);
    used.push(pick);
    return pick;
  });
}

/**
 * The layout of arena `index` (0-based) for a seed: the resolved tiles, props, lights,
 * spawn points and waves. Pure. opts.template forces a template; opts.variant a layout.
 */
export function generateArena(index, seed, { template = null, variant = null } = {}) {
  const id = template && TEMPLATES[template] ? template : runTemplates(seed)[Math.max(0, Math.min(ARENA_COUNT - 1, index))];
  const T = TEMPLATES[id];
  const r = new Rng(`${seed}/arena/${index}/${id}`);
  const vars = variantsOf(T);
  const vi = variant !== null && vars[variant] ? variant : r.int(0, vars.length - 1);
  const W = T.wall.length, D = vars[vi].length;
  const mirror = r.chance(0.5);
  let rows = vars[vi].map((s) => s.split(''));
  let wall = T.wall.split('');
  if (mirror) {
    rows = rows.map((row) => row.reverse().join('').replace(/-A/g, 'A-').split(''));
    wall = wall.reverse();
  }
  // resolve the '?' slots
  for (const row of rows) for (let i = 0; i < W; i++) if (row[i] === '?') row[i] = r.weighted(OPTIONAL);
  const tiles = rows.map((row) => row.join(''));
  const e0 = wall.indexOf('E');
  const g0 = (W - 3) / 2;
  const tx = (i) => -W / 2 + i + 0.5, tz = (j) => -D / 2 + j + 0.5;
  const mi = (i) => (mirror ? W - 1 - i : i);

  // the focal centre: an explicit tile, an 'o' tile, or the tile of the named prop
  let focal = null;
  if (T.focal) {
    if (T.focal.c) focal = { ...T.focal, i: mi(T.focal.c[0]), j: T.focal.c[1] };
    const want = T.focal.at ?? 'o';
    for (let j = 0; j < D && !focal; j++) { const i = tiles[j].indexOf(want); if (i >= 0) focal = { ...T.focal, i, j }; }
  }

  const props = [], spawns = [];
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    const ch = tiles[j][i];
    const x = tx(i), z = tz(j);
    const jit = () => Math.round(r.range(-1.5, 1.5)) * V;
    const turn = r.int(0, 3);
    if (SETPIECES[ch]) {
      props.push({ kind: SETPIECES[ch], x, z, turn: 0, setPiece: true });
      continue;
    }
    switch (ch) {
      case 's': spawns.push([x, z]); break;
      case 'P': props.push({ kind: 'pillar', x, z, variant: r.chance(0.3) ? 1 : 0, turn }); break;
      case 'p': props.push({ kind: 'pillar', x, z, variant: 2, turn }); props.push({ kind: 'rubble', x: x + r.pick([-0.6, 0.6]), z: z + 0.3, turn }); break;
      case 'B': props.push({ kind: 'brazier', x, z, turn: 0 }); break;
      case 'S': props.push({ kind: 'statue', x, z, turn: 0 }); break;
      case 'K': props.push({ kind: 'skullpile', x, z, turn: 0 }); break;
      case 'A': props.push({ kind: 'sarcophagus', x: x + 0.5, z, turn: 0 }); break;
      case 'Z': props.push({ kind: 'sarcophagus', x: x + (i < W / 2 ? -0.08 : 0.08), z: z + 0.5, turn: 1, y: LEDGE_Y }); break;
      case 'k': props.push({ kind: 'candles', x: x + jit(), z: z + jit(), turn }); break;
      case 'c': props.push({ kind: 'crate', x: x + jit(), z: z + jit(), turn }); break;
      case 'l': props.push({ kind: 'barrel', x: x + jit(), z: z + jit(), turn }); break;
      case 'b': props.push({ kind: 'bones', x: x + jit(), z: z + jit(), turn }); break;
      case 'r': props.push({ kind: 'rubble', x: x + jit(), z: z + jit(), turn }); break;
      case 'u': {
        // a cluster of two or three, never overlapping
        const n = r.int(2, 3);
        const spots = r.shuffle([[-0.22, -0.2], [0.22, -0.16], [0, 0.22], [-0.25, 0.2], [0.26, 0.24]]).slice(0, n);
        for (const [dx, dz] of spots) props.push({ kind: 'urn', x: x + dx, z: z + dz, variant: r.int(0, 2), turn });
        break;
      }
      case '^': {
        // ledge dressing: candles, a pot or two, bones; sometimes bare stone
        const k = r.weighted([['candles', 4], ['urn', 2], ['bones', 2], ['none', 3]]);
        if (k === 'urn') for (const [dx, dz] of r.shuffle([[-0.2, -0.1], [0.2, 0.05], [0, 0.2]]).slice(0, r.int(1, 2))) props.push({ kind: 'urn', x: x + dx, z: z + dz, variant: r.int(0, 2), turn, y: LEDGE_Y });
        else if (k !== 'none') props.push({ kind: k, x: x + jit(), z: z + jit(), turn, y: LEDGE_Y });
        break;
      }
      default: break;
    }
  }
  // loose rubble and bone chips along the walls, where nothing else stands
  for (let k = 0; k < 6; k++) {
    const side = r.int(0, 2);
    const i = side === 0 ? 0 : side === 1 ? W - 1 : r.int(1, W - 2), j = side === 2 ? 0 : r.int(1, D - 2);
    if (tiles[j][i] === '.') props.push({ kind: 'rubble', x: tx(i) + r.range(-0.2, 0.2), z: tz(j) + r.range(-0.2, 0.2), turn: r.int(0, 3) });
  }
  // rubble heaped at the foot of the wall masses: the room's edge looks broken, not drawn
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    if (tiles[j][i] !== '.' || !r.chance(0.22)) continue;
    const nb = [[i - 1, j], [i + 1, j], [i, j - 1]].find(([a, b]) => tiles[b]?.[a] === 'X');
    if (!nb) continue;
    props.push({ kind: 'rubble', x: tx(i) + (nb[0] - i) * 0.25, z: tz(j) + (nb[1] - j) * 0.25, turn: r.int(0, 3) });
  }

  // pilasters along the side walls every few tiles, where the edge tile is open floor
  const pilasters = [];
  for (const side of [-1, 1]) {
    const ei = side < 0 ? 0 : W - 1;
    for (let j = 1; j < D - 1; j += 3) if (tiles[j][ei] === '.' && tiles[j - 1][ei] !== 'X' && tiles[j + 1][ei] !== 'X') pilasters.push({ side, j });
  }

  // cold light through cracks in the vault: over the set-piece (or the template's own), plus
  // one over each half of the room so no corner is left pitch dark
  const own = T.shafts ? T.shafts.map(([i, j]) => [mi(i), j]) : (focal ? [[focal.i, focal.j]] : [[(W - 1) / 2, Math.floor(D / 2)]]);
  const shafts = [...own.map(([i, j]) => [tx(i), tz(j)]), [-W / 4 - 0.5, D / 2 - 3], [W / 4 + 0.5, D / 2 - 3]].slice(0, 3);
  // the lava's light: at the middle of the pit tiles
  let lava = null;
  if (T.lava) {
    let sx = 0, sz = 0, n = 0;
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) if (tiles[j][i] === '_') { sx += tx(i); sz += tz(j); n++; }
    if (n) lava = [sx / n, sz / n];
  }
  const wallStr = wall.join('');
  return {
    key: `${seed}.${index}.${id}.${vi}`,
    index, seed, id, variant: vi, name: T.name, theme: T.theme, themeLabel: THEMES[T.theme].label,
    W, D, mirror, tiles, wall: wallStr, gate: [g0, g0 + 2], exit: [e0, e0 + 2],
    focal, bay: T.bay ?? 4, sideBreak: !!T.sideBreak, style: T.style, carpetFrom: T.carpetFrom,
    props, spawns, shafts, pilasters, lava,
    sconces: [...wallStr].map((c, i) => (c === 't' ? tx(i) : null)).filter((x) => x !== null),
    banners: [...wallStr].map((c, i) => (c === 'n' ? tx(i) : null)).filter((x) => x !== null),
    plan: planWaves(index, seed),
  };
}

/** Camera target bounds for a room at a zoom, for CameraRig({ bounds }). */
export function cameraBounds(L, zoom = display.zoom) {
  const hw = display.width / (2 * PPU * zoom), hd = display.height / (2 * PPU * zoom * Math.sin(CAMERA_PITCH));
  const bx = Math.max(0, (L.W + 2) / 2 - hw + 0.6);
  // from the back wall's top (it stands up into the view) to the landing
  const zMin = -L.D / 2 - 1.2, zMax = L.D / 2 + 3.2;
  const cz = (zMin + zMax) / 2, bz = Math.max(0, (zMax - zMin) / 2 - hd + 0.4);
  return { minX: -bx, maxX: bx, minZ: cz - bz - 0.6, maxZ: cz + bz + 0.2 };
}

// ---------------------------------------------------------------------------------------
// the room runtime
// ---------------------------------------------------------------------------------------
const GATE_DOWN = -(GATE_H / 8) - 0.1;   // the spikes wait fully under the floor
const GATE_OVER = 0.13;                    // the slam overshoots a voxel, then settles
const GATE_RISE = 5;                       // ticks from the slot to the stop, accelerating
const GATE_SETTLE = [0.07, -0.05, 0.03, -0.01, 0];
const PORT_UP = 2.95;
const RUNES = ['dark', 'ember', 'red', 'gold'];
const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export class Arena {
  /**
   * root: the scene root. L: generateArena(). opts:
   *   hero: () => {x, z, vx, vz, speed} (a HeroController), for the seal trigger, exit and bones
   *   foes: an EnemyManager to use (default: the arena makes one)
   *   waves: false to never start waves (tour stills)
   *   awake: true to start with every light lit and the gate open (tour stills)
   *   banners: false to leave the title / wave / clear banners to the hud
   *   autoSeal: false to seal only when seal() is called (deterministic captures)
   *   bannerHold: () => bool; while true the room's title card waits (a run card is up)
   */
  constructor(root, L, { hero = () => null, foes = null, waves = true, awake = false, banners = true, autoSeal = true, bannerHold = null } = {}) {
    this.autoSeal = autoSeal;
    this.bannerHold = bannerHold;   // () => true while another card owns the screen: the room's title waits
    this.root = root;
    this.L = L;
    this.hero = hero;
    this.useWaves = waves;
    this.showBanners = banners;
    this.state = 'waiting';
    this.st = 0;              // ticks in state
    this.t = 0;
    this.group = new THREE.Group();
    this.group.name = `arena:${L.id}`;
    root.add(this.group);
    const W = L.W, D = L.D;
    this.bounds = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
    this.start = { x: 0, z: D / 2 + 2.3, yaw: Math.PI };
    this.lastKill = { x: 0, z: 0 };
    this.offs = [];

    buildDoorModels();
    const names = buildRoomModels(L);
    const place = (name, x, y, z) => { const m = voxelMesh(name); m.position.set(x, y, z); this.group.add(m); return m; };
    place(names.floor, 0, 0, 0);
    place(names.back, 0, 0, -D / 2);
    place(names.left, -W / 2 - 0.5, 0, -D / 2);
    place(names.right, W / 2 + 0.5, 0, -D / 2);
    place(names.front, 0, 0, D / 2);
    // the water's moving glints (three frames, cycled) and the glowing inlay's segments
    this.water = names.water ? names.water.map((n, k) => { const m = place(n, -W / 2, -2.4 * V, -D / 2); m.visible = k === 0; return m; }) : null;
    this.waterFrame = 0;
    this.glowSegs = names.glow && L.focal ? names.glow.map((n) => place(n, -W / 2 + L.focal.i + 0.5, 0.004, -D / 2 + L.focal.j + 0.5)) : null;
    this.fx = new Rng(`${L.seed}/arena-fx/${L.index}`);   // ambient effects only, never the game rng
    this.pits = []; this.pools = [];
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      if (L.tiles[j][i] === '_') this.pits.push([-W / 2 + i + 0.5, -D / 2 + j + 0.5]);
      if (L.tiles[j][i] === '~') this.pools.push([-W / 2 + i + 0.5, -D / 2 + j + 0.5]);
    }

    // ---- collision
    const cw = this.collision = new CollisionWorld();
    const ex0 = -W / 2 + L.exit[0], ex1 = ex0 + 3, gx0 = -W / 2 + L.gate[0], gx1 = gx0 + 3;
    this.exitX = (ex0 + ex1) / 2;
    cw.addBox(-W / 2 - 3, -D / 2 - 4, ex0, -D / 2, 'wall');
    cw.addBox(ex1, -D / 2 - 4, W / 2 + 3, -D / 2, 'wall');
    cw.addBox(ex0 - 1, -D / 2 - 4, ex1 + 1, -D / 2 - 1.1, 'wall');                 // the far end of the arch
    this.exitPlug = cw.addBox(ex0, -D / 2 - 1.2, ex1, -D / 2 - 0.12, 'door');
    cw.addBox(-W / 2 - 3, -D / 2 - 3, -W / 2, D / 2 + 5, 'wall');
    cw.addBox(W / 2, -D / 2 - 3, W / 2 + 3, D / 2 + 5, 'wall');
    cw.addBox(-W / 2 - 3, D / 2, gx0, D / 2 + 5, 'wall');
    cw.addBox(gx1, D / 2, W / 2 + 3, D / 2 + 5, 'wall');
    cw.addBox(gx0 - 1, D / 2 + 3.1, gx1 + 1, D / 2 + 5, 'wall');
    this.gatePlug = null;
    this.gateBox = [gx0, D / 2 + 0.15, gx1, D / 2 + 0.7];
    // the room's shape: blocks, wall masses and ledges stop everything; pits and water stop
    // feet but not orbs ('low'). One box per run of equal tiles along a row.
    for (let j = 0; j < D; j++) {
      const row = L.tiles[j];
      for (let i = 0; i < W;) {
        const c = row[i] === 'Z' ? '^' : row[i];
        let k = i + 1;
        while (k < W && (row[k] === 'Z' ? '^' : row[k]) === c) k++;
        if (SOLID_TILES[c]) {
          const b = cw.addBox(-W / 2 + i, -D / 2 + j, -W / 2 + k, -D / 2 + j + 1, SOLID_TILES[c]);
          if (LOW_TILES.includes(c)) b.low = true;
        }
        i = k;
      }
    }
    for (const p of L.pilasters) {
      const x0 = p.side < 0 ? -W / 2 : W / 2 - PILASTER;
      cw.addBox(x0, -D / 2 + p.j + 0.2, x0 + PILASTER, -D / 2 + p.j + 0.8, 'wall');
    }

    // ---- props
    this.props = createProps(this.group, cw);
    for (const p of L.props) this.props.add(p.kind, p.x, p.z, { variant: p.variant ?? 0, turn: p.turn ?? 0, y: p.y ?? 0 });

    // ---- doors
    this.gate = place('arena.gate', (gx0 + gx1) / 2, GATE_DOWN, D / 2 + 0.44);
    this.gateY = GATE_DOWN; this.gateT = -1; this.pgateY = GATE_DOWN;
    this.port = place('arena.portcullis', this.exitX, 0, -D / 2 - 0.3);
    this.portY = 0; this.pportY = 0;
    this.seals = ['dark', 'ember', 'gold'].map((s) => { const m = place(`arena.seal.${s}`, this.exitX, 1.35, -D / 2 - 0.12); m.visible = s === 'dark'; return m; });
    this.chains = [-0.32, 0.32].map((dx) => place('arena.chain', this.exitX + dx, 1.85, -D / 2 - 0.16));
    this.sealState = 'dark';
    this.sealGone = false;
    this.runes = [];
    for (const px of [gx0 - 0.5, gx1 + 0.5]) {
      const set = RUNES.map((s) => { const m = place(`arena.rune.${s}`, px, 7 * V, D / 2 + 0.76); m.visible = s === 'dark'; return m; });
      this.runes.push(set);
    }
    this.runeState = 'dark';

    // ---- banners (three cloth frames each, swapped to sway)
    const T = THEMES[L.theme];
    const bn = bannerModels(T.banner);
    this.banners = L.banners.map((x, k) => {
      const frames = bn.map((n) => { const m = place(n, x, 26 * V, -D / 2 + 1.5 * V); m.visible = false; return m; });
      frames[0].visible = true;
      return { frames, phase: k * 1.7 + L.W, gust: 0, cur: 0 };
    });

    // ---- lights: sconces, brazier (in props), cold shafts, the exit's glow
    this.sconces = L.sconces.map((x) => {
      const a = new THREE.Object3D(); a.position.set(x, 18 * V, -D / 2 + 2.5 * V); this.group.add(a);
      const h = look.torch(a, { y: 0.3, z: 0.35, color: 'flame', intensity: 1.4, radius: 8.5 });
      return { x, anchor: a, light: h, base: 1.4, lit: awake ? 1 : 0.35, pop: 0 };
    });
    // the first shaft is the focal's spotlight: brighter and tighter
    this.shafts = L.shafts.map(([x, z], k) => {
      const a = new THREE.Object3D(); a.position.set(x, 0, z); this.group.add(a);
      const h = look.torch(a, { y: 3.0, color: k === 0 ? (T.shaft ?? 'frost') : 'frost', intensity: k === 0 ? 3.0 : 1.4, radius: k === 0 ? 6.2 : 6.5, flicker: 0, haze: 0 });
      h.base = k === 0 ? 3.0 : 1.4;
      return h;
    });
    // the Maw's lava: a low ember light that breathes
    this.lavaLight = null;
    if (L.lava) {
      const a = new THREE.Object3D(); a.position.set(L.lava[0], -0.4, L.lava[1]); this.group.add(a);
      this.lavaLight = look.torch(a, { y: 0.9, color: 'ember', intensity: 1.7, radius: 7.5, flicker: 0.8 });
    }
    this.exitAnchor = new THREE.Object3D(); this.exitAnchor.position.set(this.exitX, 0, -D / 2 - 0.9); this.group.add(this.exitAnchor);
    this.exitLight = null;   // lit when the portcullis starts to rise (the light pool is small)
    this.glow = 0;   // extra light on everything (the clear flare)

    // ---- ambient: dust motes, the sconce and brazier flames
    const fires = [
      ...L.sconces.map((x) => [x, 19 * V, -D / 2 + 2.5 * V, 1]),
      ...L.props.filter((p) => p.kind === 'brazier').map((p) => [p.x, 10 * V, p.z, 1.6]),
    ];
    this.amb = vfx.ambient({ preset: 'crypt', box: [-W / 2, W / 2, 0.2, 2.8, -D / 2, D / 2], sources: fires.map((f) => [f[0], f[1] + 0.15, f[2]]), fires, embers: L.theme === 'deep' ? 12 : 4 });

    // ---- enemies and waves
    this.ownFoes = !foes;
    this.foes = foes ?? createEnemies(this.group, { collision: cw, bounds: this.bounds });
    this.buildNav();
    this.foes.nav = (e, x, z) => this.waypoint(e, x, z);
    this.waves = new WaveDirector({ plan: L.plan, foes: this.foes, spawns: L.spawns, hero: () => this.hero(), rng: new Rng(`${L.seed}/spawns/${L.index}`) });

    // ---- reactions to the enemies: brutes crash into and slam props, orbs pop pots
    const on = (n, f) => this.offs.push(events.on(n, f));
    on('enemy:crash', (e) => this.props.breakNear(e.x, e.z, 1.7, { power: 2, cause: 'crash' }));
    on('enemy:slam', (e) => this.props.breakNear(e.x, e.z, 2.2, { power: 1.6, cause: 'slam' }));
    on('enemy:orbPop', (e) => { if (e.why === 'wall') this.props.breakNear(e.x, e.z, 0.45, { power: 1, cause: 'orb', only: (p) => p.breakable }); });
    on('enemy:death', (e) => { this.lastKill = { x: e.x, z: e.z }; });
    on('combat:kill', (e) => { this.lastKill = { x: e.x, z: e.z }; });
    on('arena:wave', (e) => this.say('wave', e));

    this.banner = null;       // { kind, text, sub, t, dur }
    if (awake) this.wake(true);
    this.updateRoom();
    events.emit('arena:enter', { arena: this });
  }

  get collisionWorld() { return this.collision; }

  // ---- pathing ------------------------------------------------------------------------------
  // The room's shape has pits, water and wall masses, so a chaser that runs straight at the hero
  // can wedge itself in a corner. The enemy manager asks waypoint() before every seek: when the
  // straight line is clear it returns null (the enemy's own steering wins), otherwise the next
  // tile centre on a shortest tile path (8-way, no corner cutting), as far along as is visible.
  buildNav() {
    const L = this.L, W = L.W, D = L.D;
    const ok = L.tiles.map((row) => [...row].map((c) => !SOLID_TILES[c === 'Z' ? '^' : c]));
    for (const p of this.props.list) {
      if (!p.def.solid || p.y || p.breakable) continue;
      const hx = (p.def.boxW ?? p.def.box ?? p.r) + 0.05, hz = (p.def.boxD ?? p.def.box ?? p.r) + 0.05;
      for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
        const cx = -W / 2 + i + 0.5, cz = -D / 2 + j + 0.5;
        if (Math.abs(cx - p.x) < hx && Math.abs(cz - p.z) < hz) ok[j][i] = false;
      }
    }
    this.nav = { ok, key: -1, dist: new Int16Array(W * D) };
  }
  navField(ti, tj) {
    const N = this.nav, W = this.L.W, D = this.L.D;
    const key = tj * W + ti;
    if (N.key === key) return N.dist;
    N.key = key;
    const dist = N.dist.fill(-1);
    const q = [key]; dist[key] = 0;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % W, j = (k - i) / W;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni >= W || nj >= D || !N.ok[nj][ni] || dist[nj * W + ni] >= 0) continue;
        if (a && b && (!N.ok[j][ni] || !N.ok[nj][i])) continue;
        dist[nj * W + ni] = dist[k] + 1;
        q.push(nj * W + ni);
      }
    }
    return dist;
  }
  waypoint(e, x, z) {
    if (!this.nav) return null;
    const cw = this.collision, L = this.L, W = L.W, D = L.D;
    const dx = x - e.x, dz = z - e.z, d = Math.hypot(dx, dz);
    if (d < 0.05 || cw.raycast(e.x, e.z, dx / d, dz / d, d, (e.r ?? 0.3) * 0.9) >= d - 0.05) return null;
    const tile = (v, n) => Math.max(0, Math.min(n - 1, Math.floor(v + n / 2)));
    let ti = tile(x, W), tj = tile(z, D);
    if (!this.nav.ok[tj][ti]) {
      // the target stands on something solid: aim for the nearest open tile instead
      let best = null, bd = 1e9;
      for (let j = Math.max(0, tj - 2); j <= Math.min(D - 1, tj + 2); j++) for (let i = Math.max(0, ti - 2); i <= Math.min(W - 1, ti + 2); i++) {
        if (!this.nav.ok[j][i]) continue;
        const dd = (i - ti) ** 2 + (j - tj) ** 2;
        if (dd < bd) { bd = dd; best = [i, j]; }
      }
      if (!best) return null;
      [ti, tj] = best;
    }
    const dist = this.navField(ti, tj);
    let i = tile(e.x, W), j = tile(e.z, D);
    if (dist[j * W + i] < 0) return null;
    // walk down the field a few steps; keep the farthest step the body can see
    let way = null;
    for (let s = 0; s < 4; s++) {
      let bi = -1, bj = -1, bv = dist[j * W + i];
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni >= W || nj >= D) continue;
        const v = dist[nj * W + ni];
        if (v >= 0 && v < bv && (!(a && b) || (this.nav.ok[j][ni] && this.nav.ok[nj][i]))) { bv = v; bi = ni; bj = nj; }
      }
      if (bi < 0) break;
      i = bi; j = bj;
      const wx = -W / 2 + i + 0.5, wz = -D / 2 + j + 0.5;
      const ex = wx - e.x, ez = wz - e.z, ed = Math.hypot(ex, ez);
      if (!way || cw.raycast(e.x, e.z, ex / ed, ez / ed, ed, (e.r ?? 0.3) * 0.9) >= ed - 0.05) way = [wx, wz];
      else break;
      if (bv === 0) break;
    }
    return way;
  }
  /** Hittable props, for combat's target list. */
  targets() { return this.props.targets(); }

  setState(s) { this.state = s; this.st = 0; }

  // ---- the seal ----------------------------------------------------------------------
  seal() {
    if (this.state !== 'waiting') return;
    this.setState('sealing');
    const L = this.L;
    this.gateT = -1;
    this.gatePlug = this.collision.addBox(...this.gateBox, 'door');
    // anyone standing in the gateway is pushed inside
    const h = this.hero();
    if (h && h.z > L.D / 2 - 0.4 && h.teleport) h.teleport(h.x, L.D / 2 - 0.45);
    events.emit('arena:seal', { arena: this });
  }

  /** The gate hits its stop: the slam itself. */
  slam() {
    const L = this.L;
    const gx = (-L.W / 2 + L.gate[0]) + 1.5, gz = L.D / 2 + 0.44;
    feedback.shake(6, 300);
    feedback.kick(0, 1, 3);                 // the screen drops with the weight of it
    feedback.hitstop(70);
    // a wall of dust thrown both ways along the gate line, stone chips out of the slot
    for (let k = -2; k <= 2; k++) vfx.dust(gx + k * 0.6, gz - 0.6, { dz: -1, n: 6, size: 1.6, palette: k % 2 ? 'dustWarm' : 'dust', spread: 0.8 });
    for (let k = -2; k <= 2; k += 2) vfx.dust(gx + k * 0.7, gz + 0.5, { dz: 1, n: 4, size: 1.2, palette: 'dust', spread: 0.7 });
    vfx.land(gx, gz - 0.7, { size: 1.5 });
    for (const k of [-0.9, 0.7]) vfx.hitSpark(gx + k, 0.5, gz - 0.1, { dx: k * 0.3, dz: -1, power: 0.45, palette: 'hit', light: false });
    for (let k = 0; k < 14; k++) {
      const i = vfx.core.add(gx - 1.4 + k * 0.2, 0.1, gz - 0.35, ((k * 7) % 5 - 2) * 0.5, 3 + (k % 4) * 0.9, -0.8 - (k % 3) * 0.7, 0.9, 2 + (k % 3 === 0 ? 1 : 0), k % 3 ? 'stone' : 'stoneLight', vfx.core.CUBE);
      if (i < 0) break;
      const P = vfx.core.P;
      P.grav[i] = 22; P.bounce[i] = 0.35; P.floorY[i] = 0.04; P.pop[i] = 1; P.shrinkAt[i] = 0.8; P.fadeAt[i] = 0.85;
    }
    look.flash(gx, 1, gz - 0.5, { color: 'torch', ms: 160, intensity: 2.5, radius: 5 });
    // grit shaken off the posts and the walls
    for (const px of [gx - 2, gx + 2]) this.gritFall(px, POST_H * V, gz, 10);
    for (let k = 0; k < 6; k++) this.gritFall(-L.W / 2 + 1 + k * (L.W - 2) / 5, 3.4, -L.D / 2 + 0.3, 5);
    for (const b of this.banners) b.gust = 1;
    this.setRunes('red');                    // the post lamps flare red as it lands, then cool to ember
    this.runeCool = 26;
    this.setSeal('ember');
    arenaSfx.slam();
  }

  gritFall(x, y, z, n) {
    for (let k = 0; k < n; k++) {
      const i = vfx.core.add(x + (k % 5 - 2) * 0.12, y, z + ((k * 7) % 5 - 2) * 0.05, ((k * 13) % 7 - 3) * 0.1, -0.6 - (k % 4) * 0.5, 0.2,
        1 + (k % 3) * 0.2, k % 3 === 0 ? 2 : 1, k % 2 ? 'grit' : 'dust', k % 3 === 0 ? vfx.core.CUBE : vfx.core.SPRITE);
      if (i < 0) break;
      const P = vfx.core.P;
      P.grav[i] = 12; P.delay[i] = (k % 6) * 0.04; P.bounce[i] = 0.2; P.floorY[i] = 0.03; P.fadeAt[i] = 0.8;
    }
  }

  setRunes(s) {
    this.runeState = s;
    for (const set of this.runes) set.forEach((m, k) => { m.visible = RUNES[k] === s; });
    if (s !== 'dark') for (const set of this.runes) { const p = set[0].position; vfx.flash(p.x, p.y + 0.3, p.z + 0.1, { color: s === 'gold' ? 'gold' : s === 'red' ? 'red' : 'flame', size: s === 'red' ? 0.8 : 0.5, light: false }); }
  }
  setSeal(s) {
    this.sealState = s;
    this.seals.forEach((m, k) => { m.visible = !this.sealGone && ['dark', 'ember', 'gold'][k] === s; });
  }

  /** Light the room: every sconce roars up in turn (instant: all at once, no ceremony). */
  wake(instant = false) {
    this.sconces.forEach((s, k) => {
      if (instant) { s.lit = 1; return; }
      const order = Math.abs(s.x - this.exitX);
      s.wakeAt = this.t + 8 + Math.round(order * 3.2) + k;
    });
  }

  // ---- clearing -------------------------------------------------------------------------
  clear() {
    if (this.state === 'clearing' || this.state === 'open' || this.state === 'exited') return;
    this.setState('clearing');
    const { x, z } = this.lastKill;
    this.prevScale = loop.timeScale;
    loop.setTimeScale(Math.min(this.prevScale, 0.3));
    feedback.flash('white', 140, 0.32);
    vfx.shockwave(x, z, { radius: 3.4, color: 'gold', hot: 'white' });
    look.flash(x, 1.2, z, { color: 'gold', ms: 420, intensity: 4, radius: 9 });
    this.gold = { x, z };
    arenaSfx.clear();
    events.emit('arena:clear', { arena: this, x, z });
  }

  // ---- per tick ----------------------------------------------------------------------------
  tick() {
    this.t++; this.st++;
    const L = this.L;
    const h = this.hero();
    // the seal trigger: a full step inside the gate
    if (this.state === 'waiting' && this.autoSeal && h && h.z < L.D / 2 - 1.0) this.seal();

    // the gate: the spikes accelerate up out of the slot, overshoot by a voxel on the slam,
    // and settle with a small bounce (it is down again only after the room is left)
    this.pgateY = this.gateY;
    if (this.state === 'sealing' && this.st === 3) this.gateT = 0;
    if (this.gateT >= 0) {
      const k = ++this.gateT;
      if (k <= GATE_RISE) {
        const f = k / GATE_RISE;
        this.gateY = GATE_DOWN + (GATE_OVER - GATE_DOWN) * f * f;
        if (k === GATE_RISE) this.slam();
      } else {
        this.gateY = GATE_SETTLE[k - GATE_RISE - 1] ?? 0;
        if (k - GATE_RISE >= GATE_SETTLE.length) this.gateT = -1;
      }
    }
    if (this.runeCool > 0 && --this.runeCool === 0 && this.runeState === 'red') this.setRunes('ember');

    if (this.state === 'sealing') {
      if (this.st === 10) { this.wake(); arenaSfx.rumble(0.7); }
      // the room's name: it waits while another card (the run card) owns the screen, and the
      // first wave waits for it
      if (this.st === 24) this.titlePending = true;
      if (this.titlePending && !(this.bannerHold?.())) { this.titlePending = false; this.titleAt = this.st; this.say('title'); }
      if (!this.titlePending && this.st >= (this.titleAt ?? 24) + 60) { this.setState('fight'); if (this.useWaves) this.waves.start(); }
    }
    if (this.state === 'fight') {
      this.waves.tick();
      if (this.useWaves && this.waves.done) this.clear();
    }
    if (this.state === 'clearing') this.tickClearing();
    if (this.state === 'open' && h && h.z < -L.D / 2 - 0.35 && Math.abs(h.x - this.exitX) < 1.6) {
      this.setState('exited');
      events.emit('arena:exit', { arena: this });
    }

    // sconces waking
    for (const s of this.sconces) {
      if (s.wakeAt !== undefined && this.t === s.wakeAt) {
        s.lit = 1; s.pop = 1;
        vfx.embers(s.x, 19 * V + 0.2, -L.D / 2 + 0.35, { n: 10, spread: 0.2, up: 1.2 });
        vfx.flash(s.x, 19 * V + 0.1, -L.D / 2 + 0.35, { color: 'flame', size: 0.6, light: false });
        arenaSfx.ignite();
      }
      s.pop = Math.max(0, s.pop - 0.04);
    }
    this.glow = Math.max(0, this.glow - 0.012);
    this.props.glow = this.glow;
    for (const b of this.banners) b.gust = Math.max(0, b.gust - 0.012);

    // the portcullis
    this.pportY = this.portY;

    // the room is never still: water glints slide, lava spits, the rune ring's glow runs round
    if (this.water && this.t % 14 === 0) {
      this.water[this.waterFrame].visible = false;
      this.waterFrame = (this.waterFrame + 1) % this.water.length;
      this.water[this.waterFrame].visible = true;
    }
    if (this.pools.length && this.t % 9 === 0) {
      const [x, z] = this.fx.pick(this.pools);
      vfx.twinkle(x + this.fx.range(-0.4, 0.4), -0.15, z + this.fx.range(-0.4, 0.4), { color: L.theme === 'deep' ? 'gold' : 'sky', size: 0.8 });
    }
    if (this.pits.length && L.lava) {
      if (this.t % 5 === 0) { const [x, z] = this.fx.pick(this.pits); vfx.embers(x + this.fx.range(-0.4, 0.4), -0.6, z + this.fx.range(-0.4, 0.4), { n: 2, spread: 0.2, up: 0.9 }); }
      if (this.t % 47 === 0) { const [x, z] = this.fx.pick(this.pits); vfx.flash(x, -0.5, z, { color: 'flame', size: 0.6, light: false }); }
    }
    if (this.glowSegs) {
      const n = this.glowSegs.length, head = (this.t / 5) % n;
      this.glowSegs.forEach((m, k) => { const d = (head - k + n) % n; m.visible = d < 3.2 || this.glow > 0.2 || this.state === 'clearing'; });
    }

    this.props.tick(h);
    if (this.ownFoes) this.foes.tick();
    if (this.banner) { this.banner.t++; if (this.banner.t > this.banner.dur) this.banner = null; }
    this.updateRoom();
  }

  tickClearing() {
    const s = this.st, L = this.L;
    if (s === 12) loop.setTimeScale(this.prevScale ?? 1);
    if (s === 16) {
      this.glow = 1.2;
      this.say('clear');
      this.setRunes('gold');
      this.setSeal('gold');
      for (const b of this.banners) b.gust = 1;
      // gold motes lift off the floor across the room
      for (let k = 0; k < 16; k++) {
        const x = -L.W / 2 + 1 + ((k * 7) % 16) / 16 * (L.W - 2), z = -L.D / 2 + 1 + ((k * 5) % 11) / 11 * (L.D - 2);
        vfx.later(k * 2, (a) => vfx.twinkle(a.x, 0.4, a.z, { color: 'gold', size: 1.2 }), { x, z });
      }
    }
    if (s === 58) {
      // the seal shatters
      this.sealGone = true;
      this.setSeal('gold');
      for (const c of this.chains) c.visible = false;
      vfx.death(this.exitX, 1.35, -L.D / 2 + 0.1, { colors: ['gold', 'slate', 'shadow', 'ember'], power: 1.1, soul: false, ring: 'gold' });
      feedback.shake(3, 180);
      arenaSfx.seal();
    }
    // the portcullis ratchets up in five jerks, grit falling from the arch each time
    if (s >= 76 && s < 76 + 5 * 16) {
      const k = Math.floor((s - 76) / 16), f = (s - 76) % 16;
      if (f === 0) {
        if (!this.exitLight) this.exitLight = look.torch(this.exitAnchor, { y: 1.3, color: 'gold', intensity: 0, radius: 5.5, flicker: 0.5 });
        arenaSfx.clank(k);
        feedback.shake(1.6, 90);
        this.gritFall(this.exitX, 2.7, -L.D / 2 + 0.2, 7);
        if (k === 0) arenaSfx.rumble(1.3);
      }
      const target = PORT_UP * (k + Math.min(1, f / 5)) / 5;
      this.portY += (target - this.portY) * 0.6;
    }
    if (s === 76 + 5 * 16) {
      this.portY = PORT_UP;
      this.collision.remove(this.exitPlug);
      vfx.dust(this.exitX, -L.D / 2 + 0.2, { dz: 1, n: 10, size: 1.3 });
      this.say('open');
      this.setState('open');
      events.emit('arena:open', { arena: this });
    }
  }

  /** Show a banner: 'title' | 'wave' | 'clear' | 'open'. */
  say(kind, extra = {}) {
    const L = this.L;
    const B = {
      title: { text: L.name, sub: `ARENA ${L.index + 1} OF ${ARENA_COUNT}`, dur: 150 },
      wave: { text: `WAVE ${extra.n}/${extra.total}`, sub: describeUnits(extra.units ?? []), dur: 110 },
      clear: { text: 'ARENA CLEARED', sub: '', dur: 190 },
      open: { text: '', sub: 'THE WAY DOWN IS OPEN', dur: 150 },
    }[kind];
    this.banner = { kind, ...B, t: 0 };
  }

  updateRoom() {
    world.room = { index: this.L.index, kind: 'arena', id: this.L.id, name: this.L.name, seed: this.L.seed, state: this.state,
      wave: this.waves.n, waves: this.waves.total, cleared: this.state === 'open' || this.state === 'exited' };
  }

  // ---- render ---------------------------------------------------------------------------
  render(alpha) {
    const L = this.L;
    const gy = this.pgateY + (this.gateY - this.pgateY) * alpha;
    this.gate.position.y = gy;
    this.gate.visible = gy > GATE_DOWN + 0.05;
    const py = this.pportY + (this.portY - this.pportY) * alpha;
    this.port.position.y = py;
    for (const m of this.seals) m.position.y = 1.35 + py;
    for (const c of this.chains) c.position.y = 1.85 + py;
    // seal pulse while the fight is on (an ember throb), flicker to gold when cleared
    const now = loop.tick;
    for (const s of this.sconces) {
      const flicker = s.lit >= 1 ? 1 : 0.35;
      s.light.intensity = s.base * flicker * (1 + s.pop * 1.3 + this.glow * 0.8);
    }
    for (const sh of this.shafts) sh.intensity = sh.base + this.glow * 0.6;
    if (this.exitLight) this.exitLight.intensity = this.state === 'open' || this.state === 'exited' ? 1.6 : this.state === 'clearing' && this.st > 76 ? 1.6 * (this.st - 76) / 80 : 0;
    // banners: frame swaps, a slow idle sway and a flurry after a gust
    for (const b of this.banners) {
      const s = Math.sin(now * (0.035 + b.gust * 0.25) + b.phase) * (0.35 + b.gust * 0.9);
      const f = s > 0.42 ? 1 : s < -0.42 ? 2 : 0;
      if (f !== b.cur) { b.frames[b.cur].visible = false; b.frames[f].visible = true; b.cur = f; }
    }
    this.props.render(alpha);
    if (this.ownFoes) this.foes.render(alpha);
    void L;
  }

  // ---- the banners (UI) ---------------------------------------------------------------------
  ui(g) {
    if (!this.showBanners || !this.banner) return;
    const B = this.banner, W = display.width, H = display.height;
    const t = B.t, out = B.dur - t;
    if (B.kind === 'title') {
      const k = Math.min(1, t / 10), o = Math.min(1, out / 12);
      const y = Math.round(H * 0.2);
      const barW = Math.round((textWidth(B.text) * 2 + 40) * Math.min(k, o));
      g.fillStyle = css('ink');
      g.fillRect(Math.round(W / 2 - barW / 2), y - 6, barW, 34);
      g.fillStyle = css('ember');
      g.fillRect(Math.round(W / 2 - barW / 2), y - 6, barW, 1);
      g.fillRect(Math.round(W / 2 - barW / 2), y + 27, barW, 1);
      if (k >= 0.8 && o > 0.5) {
        drawText(g, B.sub, W / 2, y - 2, 'mist', { align: 'center' });
        drawText(g, B.text, W / 2, y + 9, 'bone', { align: 'center', scale: 2, shadow: 'dusk' });
      }
    } else if (B.kind === 'wave') {
      const pop = t < 8 ? easeOutBack(t / 8) : 1;
      const y = Math.round(H * 0.16);
      if (out < 10 && out % 4 < 2) return;
      const s = t < 3 ? 3 : 2;
      drawText(g, B.text, W / 2, y - Math.round((1 - pop) * 8), 'gold', { align: 'center', scale: s, outline: 'ink' });
      if (t > 8) {
        // the sub-line sits on a dark plate, so a bright brazier or lava behind it never eats it
        const sw = textWidth(B.sub) + 12;
        g.fillStyle = css('ink');
        g.fillRect(Math.round(W / 2 - sw / 2), y + 15, sw, 13);
        g.fillStyle = css('dusk');
        g.fillRect(Math.round(W / 2 - sw / 2), y + 27, sw, 1);
        drawText(g, B.sub, W / 2, y + 18, 'fog', { align: 'center' });
      }
    } else if (B.kind === 'clear') {
      const y = Math.round(H * 0.64);
      const k = Math.min(1, t / 7);
      const s = t < 3 ? 4 : 3;
      if (out < 12 && out % 4 < 2) return;
      // a gold bar sweeps out, the words stamp down on it
      const barW = Math.round(W * 0.8 * k);
      g.fillStyle = css('ink');
      g.fillRect(Math.round(W / 2 - barW / 2), y - 8, barW, 38);
      g.fillStyle = css('gold');
      g.fillRect(Math.round(W / 2 - barW / 2), y - 8, barW, 2);
      g.fillRect(Math.round(W / 2 - barW / 2), y + 28, barW, 2);
      if (t >= 3) drawText(g, B.text, W / 2, y + (s === 4 ? -3 : 0), t < 6 ? 'white' : 'gold', { align: 'center', scale: s, shadow: 'blood' });
    } else if (B.kind === 'open') {
      const y = Math.round(H * 0.64) + 12;
      if (out < 12 && out % 4 < 2) return;
      drawText(g, B.sub, W / 2, y, t % 40 < 30 ? 'gold' : 'flame', { align: 'center', outline: 'ink' });
    }
  }

  // ---- camera ---------------------------------------------------------------------------
  /** Where the room wants the camera to look while a moment plays: {x, z, k} or null. */
  cameraFocus() {
    const L = this.L;
    if (this.state === 'sealing' && this.st < 50) return { x: (-L.W / 2 + L.gate[0]) + 1.5, z: L.D / 2 + 0.6, k: 0.8, rate: 0.14 };
    if (this.state === 'clearing' && this.st >= 40) return { x: this.exitX, z: -L.D / 2 - 0.4, k: 0.7 };
    return null;
  }
  /**
   * Call instead of cam.tick(ctl) each tick (CameraRig from render/camera.js). It follows the
   * hero as usual, but while the gate slams or the portcullis rises it leans toward them,
   * never letting the hero leave the screen.
   */
  tickCamera(cam, ctl) {
    // once the room is sealed, ease the bottom of the view up to the parapet and its rock lip,
    // so the screen is all room and no void under it
    if (cam.bounds && this.state !== 'waiting' && this.state !== 'sealing') {
      const hd = display.height / (2 * PPU * display.zoom * Math.sin(CAMERA_PITCH));
      const want = Math.max(cam.bounds.minZ, this.L.D / 2 + 1.3 - hd - (cam.o?.padZ ?? 0));
      if (cam.bounds.maxZ > want + 0.01) cam.bounds = { ...cam.bounds, maxZ: cam.bounds.maxZ + (want - cam.bounds.maxZ) * 0.06 };
    }
    const f = this.cameraFocus();
    if (!f) { cam.tick(ctl); return; }
    cam.pos.snap();
    const c = cam.pos.cur, o = cam.o;
    const tx = ctl.x + (f.x - ctl.x) * f.k, tz = ctl.z + (f.z - ctl.z) * f.k;
    const rate = f.rate ?? 0.06;
    c.x += (tx - c.x) * rate; c.z += (tz - c.z) * rate;
    const mx = o.maxOffX - 0.8, mz = o.maxOffZ - 0.9;
    c.x = Math.max(ctl.x - mx, Math.min(ctl.x + mx, c.x));
    c.z = Math.max(ctl.z - mz, Math.min(ctl.z + mz, c.z));
    cam._clamp(c);
    cam.goal.x = c.x; cam.goal.z = c.z; cam.vel.x = 0; cam.vel.z = 0;
  }

  // ---- control and teardown -------------------------------------------------------------
  /** Debug: end the fight now (every enemy dies, no more waves). */
  forceClear() {
    if (this.state === 'waiting') this.seal();
    this.waves.done = true;
    this.waves.started = true;
    this.waves.queue.length = 0;
    for (const e of this.foes.list) if (!e.dying && !e.dead) { e.hp = 0; e.dead = true; e.die?.({ dx: 0, dz: 1 }); this.lastKill = { x: e.x, z: e.z }; }
    if (this.state !== 'fight') this.setState('fight');
    this.clear();
  }

  info() {
    return {
      id: this.L.id, name: this.L.name, index: this.L.index, seed: this.L.seed, variant: this.L.variant, mirror: this.L.mirror, theme: this.L.theme,
      size: [this.L.W, this.L.D], state: this.state, st: this.st, waves: this.waves.info(),
      alive: this.foes.alive, gate: +this.gateY.toFixed(2), portcullis: +this.portY.toFixed(2),
      props: this.props.info(),
    };
  }

  dispose() {
    this.offs.forEach((f) => f()); this.offs = [];
    if (this.state === 'clearing' && this.st < 12) loop.setTimeScale(this.prevScale ?? 1);
    this.amb?.stop();
    for (const s of this.sconces) s.light.remove();
    for (const s of this.shafts) s.remove();
    this.exitLight?.remove();
    this.lavaLight?.remove();
    this.props.dispose();
    if (this.ownFoes) this.foes.dispose();
    this.root.remove(this.group);
    if (activeArena === this) activeArena = null;
  }
}

// ---------------------------------------------------------------------------------------
// the active arena, for debug hooks
// ---------------------------------------------------------------------------------------
let activeArena = null;
/** Mark an arena as the one debug.arena() acts on (a scene calls this after creating it). */
export function setActiveArena(a) { activeArena = a; return a; }
export const getActiveArena = () => activeArena;

// __GR.debug.arena(action?, ...):
//   ()                      the active arena's info: template, state, waves, props
//   ('plan', seed?)         the five layouts' templates and wave plans for a seed (no scene change)
//   ('layout')              the active room's resolved tile rows (after mirror and '?' picks)
//   ('seal')                seal the room now (as if the hero stepped in)
//   ('clear')               end the fight now: every enemy dies, the clear moment plays
//   ('wave')                start the next wave now
//   ('break', kind?)        break every breakable prop (or every one of a kind)
debug.add('arena', (action, a) => {
  if (action === 'plan') {
    const seed = a ?? window.__GR?.seed ?? 1;
    return { seed, arenas: [0, 1, 2, 3, 4].map((i) => { const L = generateArena(i, seed); return { index: i, id: L.id, name: L.name, mirror: L.mirror, waves: L.plan.waves.map((w) => w.units) }; }) };
  }
  const A = activeArena;
  if (!A) return { ok: false, error: 'no arena in this scene' };
  if (action === 'layout') return { ok: true, id: A.L.id, variant: A.L.variant, mirror: A.L.mirror, size: [A.L.W, A.L.D], tiles: A.L.tiles, wall: A.L.wall };
  if (action === 'seal') { A.seal(); return { ok: true, state: A.state }; }
  if (action === 'clear') { A.forceClear(); return { ok: true, state: A.state }; }
  if (action === 'wave') {
    const W = A.waves;
    if (!W.started) return { ok: false, error: 'waves have not started (seal first)' };
    if (W.n >= W.total) return { ok: false, error: 'no waves left' };
    W.wait = 1;
    return { ok: true, wave: W.n + 1 };
  }
  if (action === 'break') {
    let n = 0;
    for (const p of A.props.list) if (p.breakable && !p.dead && (!a || p.kind === a)) { p.react(0, 1, 1.5, 'debug'); n++; }
    return { ok: true, broken: n };
  }
  return { ok: true, ...A.info() };
});
