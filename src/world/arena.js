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
//   'sealing'   the hero steps in: the gate's spikes slam up out of the floor (shake, dust,
//               boom), the post runes and the exit seal ignite, the torches wake one by one,
//               and the room's name comes up
//   'fight'     the waves (waves.js)
//   'clearing'  the killing blow on the last enemy: slow motion, a white flash and a gold ring,
//               every light flares, ARENA CLEARED, the seal shatters, the portcullis ratchets up
//   'open'      the way down is open; walking into the exit arch ends the room ('exited')
//
// Templates: rows of tiles, one character per world tile (legend at TEMPLATES). Variation per
// seed: which template each arena slot uses, a mirror, every '?' slot, prop variants and
// turns, the floor's slabs, cracks, moss and stains, and the waves.
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
import { THEMES, buildRoomModels, buildDoorModels, POST_H } from './tiles.js';
import { createProps, bannerModels, arenaSfx } from './props.js';
import { planWaves, WaveDirector, describeUnits } from './waves.js';

const V = VOXEL;
export const ARENA_COUNT = 5;

// ---------------------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------------------
// Tile legend (rows run back to front; the gate is always the middle 3 tiles of the front):
//   .  floor           #  chest-high masonry block      =  drain grate      s  spawn point
//   P  pillar          p  broken pillar stump           B  brazier (a light)
//   u  urns (break)    c  crate (2 hits)   l  barrel (2 hits)   b  bones (scatter)   k  candles
//   r  rubble (decor)  S  statue           K  skull pile        A- sarcophagus (two tiles)
//   o  the focal inlay's centre (the focal can also sit under a prop: `focal.at`)
//   ?  a seeded pick: urns, bones, rubble, a barrel, a crate or nothing
// Wall legend (one character per tile of the back wall):
//   t  sconce (a light)   n  banner   a  alcove (skull, candle)   h  chains   x  crumbled
//   E  the exit arch (three tiles)
export const TEMPLATES = {
  antechamber: {
    name: 'THE ANTECHAMBER', theme: 'crypt', focal: { kind: 'ring', r: 2.6 },
    wall: '..t.n..EEE..n.t..',
    rows: [
      'uk.............ku',
      'u..P....s....P..u',
      '.................',
      '.s.B.........B.s.',
      '........o........',
      'b..............?.',
      '.s.?.........?.s.',
      '.................',
      'r..P....s....P..b',
      '?c.............l?',
    ],
  },
  shrine: {
    name: 'THE DROWNED SHRINE', theme: 'sunken', focal: { kind: 'rune', r: 2.4, at: 'S' }, shafts: [[8, 4]],
    wall: '..t..a.EEE.a..t..',
    rows: [
      '..u...........r..',
      '.P.....s.s.....P.',
      '.................',
      '..s...k...k...s..',
      '........S........',
      '......k...k......',
      '.................',
      '.s.............s.',
      '.p.............P.',
      '..?..=.....=..?..',
      '?u.............lu',
    ],
  },
  ossuary: {
    name: 'THE OSSUARY', theme: 'ossuary', focal: { kind: 'square', r: 3.5, at: 'K' }, bay: 3,
    wall: 'a.t.a..EEE..a.t.a',
    rows: [
      'b.k...........k.b',
      '..#.....s.....#..',
      '.s#...........#s.',
      '..#...b...b...#..',
      '......=...=......',
      '.s......K......s.',
      '......=...=......',
      '..#...b...b...#..',
      '.s#...........#s.',
      '..#...........#..',
      'u?.............?u',
    ],
  },
  hall: {
    name: 'THE HALL OF WARDENS', theme: 'hall', focal: null, bay: 3, shafts: [[8, 3], [8, 7]],
    wall: '..t.n.hEEEh.n.t..',
    rows: [
      '.....S.....S.....',
      'l..............cc',
      '....P.......P....',
      '.s.............s.',
      '....P...s...P....',
      '.B.............B.',
      '....P.......P....',
      '.s......s......s.',
      '....P.......P....',
      'u...............?',
      '?u.............uu',
    ],
  },
  crossing: {
    name: 'THE CROSSING', theme: 'crypt', style: 'tile', focal: { kind: 'cross', r: 2.2 }, sideBreak: true,
    wall: '.hEEE.t..n..t..x.',
    rows: [
      '.....s....###.u.u',
      '###.......###....',
      '###..B.........s.',
      '......p....b.....',
      '.s.....=.=.....s.',
      '........o........',
      '.s.....=.=.......',
      '....r.....p......',
      '.?.........B..###',
      'c.....s.......###',
      'lc..............?',
    ],
  },
  maw: {
    name: 'THE EMBER MAW', theme: 'deep', focal: { kind: 'rune', r: 3 }, sideBreak: true, shafts: [[9, 5]],
    wall: '..t.x.n.EEE.n.x.t..',
    rows: [
      'k.................k',
      '..p....s...s....P..',
      '...................',
      '.s..#.........#..s.',
      '....#...B.B...#....',
      '.........o.........',
      '...................',
      '.s..#.........#..s.',
      '....#.........#....',
      '.A-.....s...s....?.',
      '..P.............p..',
      '?u...............l?',
    ],
  },
};
/** Which templates each arena slot may use (a run never repeats one while others remain). */
export const SLOTS = [
  ['antechamber', 'shrine'],
  ['ossuary', 'shrine', 'antechamber'],
  ['hall', 'crossing'],
  ['crossing', 'ossuary', 'hall'],
  ['maw'],
];
const OPTIONAL = [['u', 3], ['b', 2], ['r', 2], ['l', 1], ['c', 1], ['.', 2]];

/** Check every template once (row lengths, gate clear, exit width). Throws on a bad one. */
function validate(id, T) {
  const W = T.wall.length, D = T.rows.length;
  T.rows.forEach((row, j) => { if (row.length !== W) throw new Error(`arena template ${id}: row ${j} is ${row.length} wide, not ${W}`); });
  const e0 = T.wall.indexOf('E'), e1 = T.wall.lastIndexOf('E');
  if (e0 < 0 || e1 - e0 !== 2) throw new Error(`arena template ${id}: the exit must be three tiles`);
  const g0 = (W - 3) / 2;
  if (!Number.isInteger(g0)) throw new Error(`arena template ${id}: width must be odd`);
  for (let i = g0; i < g0 + 3; i++) if (T.rows[D - 1][i] !== '.') throw new Error(`arena template ${id}: gate tile ${i} is blocked`);
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
 * spawn points and waves. Pure. opts.template forces a template.
 */
export function generateArena(index, seed, { template = null } = {}) {
  const id = template && TEMPLATES[template] ? template : runTemplates(seed)[Math.max(0, Math.min(ARENA_COUNT - 1, index))];
  const T = TEMPLATES[id];
  const r = new Rng(`${seed}/arena/${index}/${id}`);
  const W = T.wall.length, D = T.rows.length;
  const mirror = r.chance(0.5);
  let rows = T.rows.map((s) => s.split(''));
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

  // the focal centre: an 'o' tile, or the tile of the named prop
  let focal = null;
  if (T.focal) {
    const want = T.focal.at ?? 'o';
    for (let j = 0; j < D && !focal; j++) { const i = tiles[j].indexOf(want); if (i >= 0) focal = { ...T.focal, i, j }; }
  }

  const props = [], spawns = [];
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    const ch = tiles[j][i];
    const x = tx(i), z = tz(j);
    const jit = () => Math.round(r.range(-1.5, 1.5)) * V;
    const turn = r.int(0, 3);
    switch (ch) {
      case 's': spawns.push([x, z]); break;
      case 'P': props.push({ kind: 'pillar', x, z, variant: r.chance(0.3) ? 1 : 0, turn }); break;
      case 'p': props.push({ kind: 'pillar', x, z, variant: 2, turn }); props.push({ kind: 'rubble', x: x + r.pick([-0.6, 0.6]), z: z + 0.3, turn }); break;
      case 'B': props.push({ kind: 'brazier', x, z, turn: 0 }); break;
      case 'S': props.push({ kind: 'statue', x, z, turn: 0 }); break;
      case 'K': props.push({ kind: 'skullpile', x, z, turn: 0 }); break;
      case 'A': props.push({ kind: 'sarcophagus', x: x + 0.5, z, turn: 0 }); break;
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
      default: break;
    }
  }
  // loose rubble and bone chips along the walls, where nothing else stands
  for (let k = 0; k < 5; k++) {
    const side = r.int(0, 2);
    const i = side === 0 ? 0 : side === 1 ? W - 1 : r.int(1, W - 2), j = side === 2 ? 0 : r.int(1, D - 2);
    if (tiles[j][i] === '.') props.push({ kind: 'rubble', x: tx(i) + r.range(-0.2, 0.2), z: tz(j) + r.range(-0.2, 0.2), turn: r.int(0, 3) });
  }

  // cold light through cracks in the vault: over the focal (or the template's own), plus one
  // over each half of the room so no corner is left pitch dark
  const own = T.shafts ?? (focal ? [[focal.i, focal.j]] : [[(W - 1) / 2, Math.floor(D / 2)]]);
  const shafts = [...own.map(([i, j]) => [tx(mirror && T.shafts ? W - 1 - i : i), tz(j)]),
    [-W / 4 - 0.5, D / 2 - 3], [W / 4 + 0.5, D / 2 - 3]].slice(0, 3);
  const wallStr = wall.join('');
  return {
    key: `${seed}.${index}.${id}`,
    index, seed, id, name: T.name, theme: T.theme, themeLabel: THEMES[T.theme].label,
    W, D, mirror, tiles, wall: wallStr, gate: [g0, g0 + 2], exit: [e0, e0 + 2],
    focal, bay: T.bay ?? 4, sideBreak: !!T.sideBreak, style: T.style,
    props, spawns, shafts,
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
const GATE_DOWN = -1.75;
const PORT_UP = 2.95;
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
   */
  constructor(root, L, { hero = () => null, foes = null, waves = true, awake = false, banners = true, autoSeal = true } = {}) {
    this.autoSeal = autoSeal;
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
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) if (L.tiles[j][i] === '#') cw.addBox(-W / 2 + i, -D / 2 + j, -W / 2 + i + 1, -D / 2 + j + 1, 'block');

    // ---- props
    this.props = createProps(this.group, cw);
    for (const p of L.props) this.props.add(p.kind, p.x, p.z, { variant: p.variant ?? 0, turn: p.turn ?? 0 });

    // ---- doors
    this.gate = place('arena.gate', (gx0 + gx1) / 2, GATE_DOWN, D / 2 + 0.44);
    this.gateY = GATE_DOWN; this.gateV = 0; this.pgateY = GATE_DOWN;
    this.port = place('arena.portcullis', this.exitX, 0, -D / 2 - 0.3);
    this.portY = 0; this.pportY = 0;
    this.seals = ['dark', 'ember', 'gold'].map((s) => { const m = place(`arena.seal.${s}`, this.exitX, 1.35, -D / 2 - 0.12); m.visible = s === 'dark'; return m; });
    this.chains = [-0.32, 0.32].map((dx) => place('arena.chain', this.exitX + dx, 1.85, -D / 2 - 0.16));
    this.sealState = 'dark';
    this.sealGone = false;
    this.runes = [];
    for (const px of [gx0 - 0.5, gx1 + 0.5]) {
      const set = ['dark', 'ember', 'gold'].map((s) => { const m = place(`arena.rune.${s}`, px, 7 * V, D / 2 + 0.76); m.visible = s === 'dark'; return m; });
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
      const h = look.torch(a, { y: 3.0, color: 'frost', intensity: k === 0 ? 2.1 : 1.25, radius: k === 0 ? 5.2 : 6.5, flicker: 0, haze: 0 });
      h.base = k === 0 ? 2.1 : 1.25;
      return h;
    });
    this.exitAnchor = new THREE.Object3D(); this.exitAnchor.position.set(this.exitX, 0, -D / 2 - 0.9); this.group.add(this.exitAnchor);
    this.exitLight = null;   // lit when the portcullis starts to rise (the light pool is small)
    this.glow = 0;   // extra light on everything (the clear flare)

    // ---- ambient: dust motes, the sconce and brazier flames
    const fires = [
      ...L.sconces.map((x) => [x, 19 * V, -D / 2 + 2.5 * V, 1]),
      ...L.props.filter((p) => p.kind === 'brazier').map((p) => [p.x, 10 * V, p.z, 1.6]),
    ];
    this.amb = vfx.ambient({ preset: 'crypt', box: [-W / 2, W / 2, 0.2, 2.8, -D / 2, D / 2], sources: fires.map((f) => [f[0], f[1] + 0.15, f[2]]), fires, embers: L.theme === 'deep' ? 8 : 4 });

    // ---- enemies and waves
    this.ownFoes = !foes;
    this.foes = foes ?? createEnemies(this.group, { collision: cw, bounds: this.bounds });
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
  /** Hittable props, for combat's target list. */
  targets() { return this.props.targets(); }

  setState(s) { this.state = s; this.st = 0; }

  // ---- the seal ----------------------------------------------------------------------
  seal() {
    if (this.state !== 'waiting') return;
    this.setState('sealing');
    const L = this.L;
    this.gateV = 0;
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
    feedback.kick(0, -1, 3);
    feedback.hitstop(70);
    // a wall of dust thrown into the room along the gate line, stone chips out of the slot
    for (let k = -2; k <= 2; k++) vfx.dust(gx + k * 0.6, gz - 0.6, { dz: -1, n: 6, size: 1.6, palette: k % 2 ? 'dustWarm' : 'dust', spread: 0.8 });
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
    this.setRunes('ember');
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
    for (const set of this.runes) set.forEach((m, k) => { m.visible = ['dark', 'ember', 'gold'][k] === s; });
    if (s !== 'dark') for (const set of this.runes) { const p = set[0].position; vfx.flash(p.x, p.y + 0.3, p.z + 0.1, { color: s === 'gold' ? 'gold' : 'flame', size: 0.5, light: false }); }
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

    // the gate: spikes shoot up, overshoot, settle (it is down again only after the room is left)
    this.pgateY = this.gateY;
    if (this.state === 'sealing' && this.st === 3) this.gateV = 0.9;
    if (this.gateV > 0 || (this.gateY > GATE_DOWN && this.gateY !== 0)) {
      if (this.gateV > 0) {
        this.gateY += this.gateV;
        if (this.gateY >= 0.12) { this.gateY = 0.12; this.gateV = -0.02; this.slam(); }
      } else {
        this.gateY = Math.max(0, this.gateY - 0.03);
      }
    }

    if (this.state === 'sealing') {
      if (this.st === 10) { this.wake(); arenaSfx.rumble(0.7); }
      if (this.st === 24) this.say('title');
      if (this.st === 84) { this.setState('fight'); if (this.useWaves) this.waves.start(); }
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
      if (t > 8) drawText(g, B.sub, W / 2, y + 18, 'fog', { align: 'center', shadow: 'ink' });
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
    if (this.state === 'sealing' && this.st < 50) return { x: (-L.W / 2 + L.gate[0]) + 1.5, z: L.D / 2 + 0.2, k: 0.45 };
    if (this.state === 'clearing' && this.st >= 40) return { x: this.exitX, z: -L.D / 2 - 0.4, k: 0.7 };
    return null;
  }
  /**
   * Call instead of cam.tick(ctl) each tick (CameraRig from render/camera.js). It follows the
   * hero as usual, but while the gate slams or the portcullis rises it leans toward them,
   * never letting the hero leave the screen.
   */
  tickCamera(cam, ctl) {
    const f = this.cameraFocus();
    if (!f) { cam.tick(ctl); return; }
    cam.pos.snap();
    const c = cam.pos.cur, o = cam.o;
    const tx = ctl.x + (f.x - ctl.x) * f.k, tz = ctl.z + (f.z - ctl.z) * f.k;
    c.x += (tx - c.x) * 0.06; c.z += (tz - c.z) * 0.06;
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
      id: this.L.id, name: this.L.name, index: this.L.index, seed: this.L.seed, mirror: this.L.mirror, theme: this.L.theme,
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
