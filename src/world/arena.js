// Arenas (piece `arenas`): hand-authored room templates, seeded variation, and the room at
// runtime: doors that seal with a slam and open with ceremony, torches that roar to life,
// waves (waves.js), props that react (props.js), and the room-clear moment.
//
//   import { Arena, arenaOrder, layoutFor, TEMPLATES } from '../world/arena.js';
//   const arena = new Arena(root, { index, seed, ox, oz, lit: true });   // build (static)
//   arena.play({ foes, hero: () => ctl });   // play mode: dim room, gate open, waits for the hero
//   // each sim tick (after foes.tick()):   arena.tick();
//   // each frame:                          arena.render(alpha); arena.ui(g)
//   arena.targets()        props the hero's swings can hit (pass to HeroCombat alongside enemies)
//   arena.cw               the room's CollisionWorld (call setCollision(arena.cw) in play)
//   arena.bounds           walkable interior {minX, maxX, minZ, maxZ} (world units)
//   arena.start            {x, z, yaw} outside the entry gate, facing in
//   arena.exitPoint        {x, z} a step inside the open exit (walk here to leave)
//   arena.mode             'static' | 'waiting' | 'sealing' | 'fighting' | 'clearing' | 'open' | 'exited'
//   arena.slam() / arena.clearRoom() / arena.openExit()   drive the ceremony directly (debug, run-flow)
//   arena.dispose()        stop ambient and listeners (scene exit also cleans up)
//
// Events (core/events.js):
//   arena:enter {index}        the hero crossed the threshold      arena:seal {index}   gate slammed
//   arena:wave {n, total, groups}   (from waves.js)                 arena:clear {index, x, z}
//   arena:open {index}         the exit is fully up                arena:exit {index}   the hero left
//   arena:propBreak {prop, kind, x, z}   (from props.js)
//
// Layout: 1 tile = 1 world unit. Templates are ASCII, row 0 against the back wall:
//   .  floor        #  masonry block    ~  pit           s  spawn point (floor)
//   P  pillar       p  broken pillar    B  brazier       A  altar (2 tiles, left tile marked)
//   T  statue       u  urns (break)     x  crates/barrels (break)   b  bones (break)
//   r  rubble       c  candles          ?  seeded pick among small props or nothing
// The exit is a 2-tile arch in the back wall; the gate a 2-tile gap in the front parapet.
// Variation per seed: which template fills each of the five slots, a mirror flip, every '?',
// cluster contents and jitter, urn and pillar variants, and the whole floor and wall surface
// (slab widths, shades, cracks, moss, blood, damage), all from rng forks of the run seed.

import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { loop } from '../core/loop.js';
import { feedback } from '../core/feedback.js';
import { display } from '../core/display.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { voxelMesh, VOXEL } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { CollisionWorld } from '../core/collision.js';
import { debug } from '../core/debug.js';
import { buildRoomModels, THEMES, PORTCULLIS, RUNES, BANNER, ARCH, GATE, T } from './tiles.js';
import { Prop, arenaSfx } from './props.js';
import { planArena, WaveDirector, describeWave } from './waves.js';

const V = VOXEL;

// =====================================================================================
// templates
// =====================================================================================
export const TEMPLATES = {
  gatehouse: {
    title: 'THE GATEHOUSE', theme: 'crypt', path: true, sconces: [3, 10], banners: [1, 12], shafts: [[7, 4]],
    rows: [
      'xu..c....c..ux',
      'x............?',
      '..B..s..s..B..',
      's............s',
      '..............',
      '..p........p..',
      '?............b',
      'b............r',
    ],
  },
  ossuary: {
    title: 'THE OSSUARY', theme: 'ossuary', path: false, ring: [8, 4.5, 3.1], sconces: [2, 5, 10, 13], banners: [], shafts: [[8, 4]],
    rows: [
      'bb.P..c..c..P.bb',
      'b..............b',
      '...s........s...',
      '.P............P.',
      '.......A........',
      '.P............P.',
      '...s........s...',
      'u..............x',
      'uu...?....?...xx',
    ],
  },
  hall: {
    title: 'THE BRAZIER HALL', theme: 'forge', path: true, sconces: [5, 10], banners: [2, 13], shafts: [],
    rows: [
      'xx.u.c....c.u.xx',
      'x..............x',
      '...B........B...',
      '.s............s.',
      '....p......p....',
      '.s............s.',
      '...B........B...',
      '?..............?',
      'xr............rx',
    ],
  },
  cistern: {
    title: 'THE SUNKEN CISTERN', theme: 'sunken', path: true, sconces: [2, 5, 10, 13], banners: [1, 14], shafts: [[4, 5], [11, 5]],
    rows: [
      'u.c..........c.x',
      '................',
      '..~~~......~~~..',
      '.s~~~..s.s.~~~s.',
      '..~~~......~~~..',
      '....P......P....',
      '..~~~......~~~..',
      '.s~~~......~~~s.',
      '..~~~......~~~..',
      'b?............?r',
    ],
  },
  gallery: {
    title: 'THE COLLAPSED GALLERY', theme: 'crypt', path: false, sconces: [2, 5, 10, 13], banners: [11], shafts: [[6, 4]],
    rows: [
      '##.r.c......u.x.',
      '#...............',
      '...p.....s...P..',
      '.s..............',
      '..r.........p...',
      '..............s.',
      '..P...s.........',
      '?.............##',
      'bb...r.......###',
    ],
  },
  chapel: {
    title: "THE WARDEN'S CHAPEL", theme: 'shrine', path: true, ring: [9, 5, 3], sconces: [1, 4, 13, 16], banners: [5, 12], shafts: [],
    rows: [
      'c.....T....T.....c',
      '..................',
      '.P..s........s..P.',
      '..................',
      '.P....B....B....P.',
      's................s',
      '.P..............P.',
      '...?..........?...',
      'xx..............uu',
      'xu.b..........b.ux',
    ],
  },
};

/** Which templates may fill each of the five arena slots (small rooms first, the chapel last). */
export const SLOTS = [['gatehouse'], ['ossuary', 'gallery'], ['hall', 'gallery'], ['cistern', 'ossuary'], ['chapel']];

/** The template id for each of the five arenas of a run. No template repeats in a run. */
export function arenaOrder(seed = 1) {
  const rng = new Rng(`${seed}/arenas/order`);
  const used = new Set();
  return SLOTS.map((opts) => {
    const free = opts.filter((o) => !used.has(o));
    const pick = rng.pick(free.length ? free : opts);
    used.add(pick);
    return pick;
  });
}

/** Parse, mirror and resolve a template into a layout for arena `index` of run `seed`. */
export function layoutFor(index, seed = 1, templateId = null) {
  const id = templateId ?? arenaOrder(seed)[index];
  const tpl = TEMPLATES[id];
  const rng = new Rng(`${seed}/arenas/${index}/layout`);
  const mirror = rng.chance(0.5);
  let rows = tpl.rows.map((r) => (mirror ? [...r].reverse().join('') : r));
  const W = rows[0].length, D = rows.length;
  for (const r of rows) if (r.length !== W) throw new Error(`arenas: template ${id} has ragged rows`);
  const mx = (c) => (mirror ? W - 1 - c : c);
  // '?' slots
  const cells = rows.map((r) => [...r].map((ch) => (ch === '?' ? rng.weighted([['.', 3], ['b', 1], ['r', 1], ['u', 1], ['c', 1]]) : ch)));
  // the altar marks its left tile; mirrored it would mark the right one, so shift it back
  if (mirror) for (const row of cells) for (let x = W - 1; x > 0; x--) if (row[x] === 'A') { row[x] = '.'; row[x - 1] = 'A'; }
  const exitX = Math.floor(W / 2) - 1, gateX = exitX;
  let path = null;
  if (tpl.path) {
    path = cells.map(() => new Array(W).fill(false));
    for (let z = 0; z < D; z++) for (const x of [exitX, exitX + 1]) path[z][x] = true;
  }
  const anchors = [], decals = [];
  cells.forEach((row, z) => row.forEach((ch, x) => {
    if ('Pp~T'.includes(ch)) anchors.push([x + 0.5, z + 0.5]);
    if (ch === 'B') decals.push(['scorch', x, z]);
    if (ch === 'c' || ch === 'A') decals.push(['wax', x + (ch === 'A' ? 0.5 : 0), z]);
    if (ch === 'b') decals.push(['bonedust', x, z]);
  }));
  const ring = tpl.ring ? [mirror ? W - tpl.ring[0] : tpl.ring[0], tpl.ring[1], tpl.ring[2]] : null;
  return {
    id, index, seed, title: tpl.title, W, D, cells, mirror, exitX, gateX, path, ring, anchors, decals,
    theme: THEMES[tpl.theme], themeId: tpl.theme,
    sconces: tpl.sconces.map(mx).sort((a, b) => a - b), banners: tpl.banners.map(mx),
    shafts: tpl.shafts.map(([x, z]) => [mirror ? W - x : x, z]),
  };
}

/** The layout as ASCII rows (for debug and critics). */
export const layoutAscii = (L) => L.cells.map((r) => r.join(''));

// =====================================================================================
// the room
// =====================================================================================
const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - (1 - k) * (1 - k));
const GATE_OPEN_Y = -(GATE.bars + 4) * V;   // the bars wait below the threshold while the gate is open
const EXIT_OPEN_Y = (ARCH.h + 2) * V;

export class Arena {
  constructor(root, { index = 0, seed = 1, template = null, ox = 0, oz = 0, lit = true } = {}) {
    this.index = index; this.seed = seed;
    const L = this.L = layoutFor(index, seed, template);
    this.id = L.id; this.title = L.title; this.W = L.W; this.D = L.D;
    this.ox = ox; this.oz = oz;
    this.root = root;
    this.group = new THREE.Group();
    this.group.position.set(ox, 0, oz);
    root.add(this.group);
    this.rng = new Rng(`${seed}/arenas/${index}/props`);
    this.plan = planArena(index, seed);
    this.mode = 'static';
    this.t = 0; this.modeT = 0;
    this.offs = [];
    this.banners = [];        // UI banners: {kind, text, sub, t, dur}
    this.lights = [];         // {handle, base, cur, kind, x, y, z, lit, fire, igniteAt}
    this.props = [];
    this.cloths = [];
    this.cw = new CollisionWorld();
    this.hero = null; this.foes = null; this.director = null;
    this.clearAt = null;
    this._build(lit);
  }

  // local tile -> world
  tx(x) { return this.ox - this.W / 2 + x; }
  tz(z) { return this.oz - this.D / 2 + z; }

  get bounds() { return { minX: this.ox - this.W / 2, maxX: this.ox + this.W / 2, minZ: this.oz - this.D / 2, maxZ: this.oz + this.D / 2 }; }
  get center() { return { x: this.ox, z: this.oz }; }
  get gateCenter() { return { x: this.tx(this.L.gateX + 1), z: this.tz(this.D) }; }
  get exitCenter() { return { x: this.tx(this.L.exitX + 1), z: this.tz(0) }; }
  get start() { const g = this.gateCenter; return { x: g.x, z: g.z + 1.55, yaw: Math.PI }; }
  get exitPoint() { const e = this.exitCenter; return { x: e.x, z: e.z - 0.9 }; }

  _place(model, x, z, { y = 0, yaw = 0, sx = 1 } = {}) {
    const m = voxelMesh(model);
    m.position.set(x - this.ox, y, z - this.oz);
    m.rotation.y = yaw;
    if (sx !== 1) m.scale.x = sx;
    this.group.add(m);
    return m;
  }

  _build(lit) {
    const { L, W, D } = this;
    const prefix = `arena.${this.seed}.${this.index}.${L.id}`;
    const M = this.models = buildRoomModels(prefix, L, new Rng(`${this.seed}/arenas/${this.index}/surface`));
    const cx = this.ox, cz = this.oz;
    this._place(M.floor, cx, cz);
    this._place(M.back, cx, cz - D / 2);
    this._place(M.sideL, cx - W / 2, cz - D / 2 - 1);
    this._place(M.sideR, cx + W / 2, cz - D / 2 - 1);
    this._place(M.front, cx, cz + D / 2);
    const g = this.gateCenter, e = this.exitCenter;
    this._place(M.frame, g.x, g.z + 3 * V);
    this._place(M.apron, g.x, g.z + 6 * V);
    if (M.blocks) this._place(M.blocks, cx, cz);
    // doors
    this.gate = { mesh: this._place(PORTCULLIS.gate, g.x, g.z + 3.5 * V, { y: GATE_OPEN_Y }), y: GATE_OPEN_Y, py: GATE_OPEN_Y, vy: 0, state: 'open', bounce: 0 };
    this.exit = { mesh: this._place(PORTCULLIS.exit, e.x, e.z - 2 * V), y: 0, py: 0, state: 'closed', step: 0, stepT: 0 };
    this.runes = {};
    this.runes.off = { visible: true };   // carved runes are left dark: only the lit states are drawn
    for (const k of ['red', 'gold']) { this.runes[k] = this._place(RUNES[k], e.x, e.z + 2 * V); this.runes[k].visible = false; }
    // banners (cloth), hung from the rods on the back wall
    const cloth = BANNER(L.theme.banner.join('-'));
    for (const b of L.banners) {
      const m = this._place(cloth, this.tx(b + 0.5), cz - D / 2 + 2 * V, { y: 24 * V });
      this.cloths.push({ mesh: m, a: 0, v: 0, pa: 0, phase: b * 1.7 });
    }
    // props live in world space (their effects and hit tests use world x/z)
    this.propRoot = new THREE.Group();
    this.root.add(this.propRoot);
    const fires = [];
    const R = this.rng;
    L.cells.forEach((row, z) => row.forEach((ch, x) => {
      const px = this.tx(x + 0.5), pz = this.tz(z + 0.5);
      const j = () => R.range(-0.12, 0.12);
      const add = (kind, ax, az, o = {}) => { const p = new Prop(this.propRoot, kind, ax, az, { rng: R, collision: null, ...o }); p.wx = ax; p.wz = az; this.props.push(p); return p; };
      switch (ch) {
        case 'P': add('pillar', px, pz, { model: R.chance(0.35 * L.theme.moss + 0.1) ? 'arena.pillar.mossy' : 'arena.pillar' }); break;
        case 'p': add('stump', px, pz, { yaw: R.int(0, 3) * Math.PI / 2 }); break;
        case 'T': add('statue', px, pz); break;
        case 'A': add('altar', px + 0.5, pz); break;
        case 'B': { const b = add('brazier', px, pz); b.isBrazier = true; fires.push(b); break; }
        case 'u': { const n = R.int(2, 3); const spots = [[-0.22, -0.18], [0.2, -0.2], [0, 0.22]]; R.shuffle(spots); for (let k = 0; k < n; k++) add('urn', px + spots[k][0] + j() * 0.5, pz + spots[k][1] + j() * 0.5); break; }
        case 'x': {
          const set = R.pick([['crate', 'barrel'], ['barrel', 'barrel'], ['crate'], ['crate', 'crate'], ['barrel']]);
          const spots = set.length === 1 ? [[0, 0]] : [[-0.24, -0.1], [0.24, 0.12]];
          set.forEach((k, i) => add(k, px + spots[i][0] + j() * 0.4, pz + spots[i][1] + j() * 0.4, { yaw: k === 'crate' ? R.range(-0.3, 0.3) : 0 }));
          break;
        }
        case 'b': add('bones', px + j(), pz + j(), { yaw: R.int(0, 3) * Math.PI / 2 }); break;
        case 'r': add('rubble', px + j(), pz + j(), { yaw: R.int(0, 3) * Math.PI / 2 }); break;
        case 'c': add('candles', px + j(), pz + j(), { yaw: R.int(0, 3) * Math.PI / 2 }); break;
        default: break;
      }
    }));
    // lights: sconces on the back wall, braziers, cold shafts through the vault, the way out
    for (const s of L.sconces) {
      const x = this.tx(s + 0.5), y = 17 * V + 0.3, z = cz - D / 2 + 0.34;
      this._light('sconce', x, y, z + 0.3, { color: 'flame', intensity: 1.4, radius: 8 }, [x, y - 0.08, z, 0.55]);
    }
    for (const b of fires) this._light('brazier', b.wx, 1.45, b.wz, { color: 'flame', intensity: 1.6, radius: 7.5 }, [b.wx, 1.02, b.wz, 1.35], b);
    for (const [sx, sz] of L.shafts) this._light('shaft', this.tx(sx), 2.9, this.tz(sz), { color: 'frost', intensity: 1.25, radius: 5.6, flicker: 0, haze: 0 });
    // a cold wash over the exit arch, so the way out is always the focal point of the room
    this._light('arch', e.x, 3.4, e.z + 1.6, { color: 'frost', intensity: 0.9, radius: 5, flicker: 0, haze: 0 });
    this._light('exit', e.x, 1.2, e.z - 1.3, { color: 'gold', intensity: 1.4, radius: 4.5, haze: 0.6 });
    const exitL = this.lights[this.lights.length - 1];
    exitL.base = 0; exitL.cur = 0; exitL.handle.intensity = 0;
    // ambient air, embers off the fires
    this.amb = vfx.ambient({ preset: 'crypt', box: [cx - W / 2, cx + W / 2, 0.2, 2.8, cz - D / 2, cz + D / 2], sources: [], fires: [] });
    this._collision();
    this.setLit(lit, true);
    // enemy crashes and slams knock props over
    this.offs.push(events.on('enemy:crash', (ev) => this._quake(ev.x, ev.z, 1.6, 1.6)));
    this.offs.push(events.on('enemy:slam', (ev) => this._quake(ev.x, ev.z, 2.0, 1.2)));
  }

  _light(kind, x, y, z, opts, fire = null, prop = null) {
    const a = new THREE.Object3D();
    a.position.set(x - this.ox, y, z - this.oz);
    this.group.add(a);
    const handle = look.torch(a, opts);
    this.lights.push({ kind, handle, base: opts.intensity, cur: opts.intensity, x, y, z, fire, prop, lit: true, flare: 0 });
  }

  _collision() {
    const { W, D, ox, oz, L } = this;
    const cw = this.cw;
    const x0 = ox - W / 2, x1 = ox + W / 2, z0 = oz - D / 2, z1 = oz + D / 2;
    const e = this.exitCenter, g = this.gateCenter;
    // back wall with the arch; the tunnel behind it
    cw.addBox(x0 - 2, z0 - 3, e.x - 1, z0, 'wall');
    cw.addBox(e.x + 1, z0 - 3, x1 + 2, z0, 'wall');
    cw.addBox(e.x - 1, z0 - 3, e.x + 1, z0 - 1.6, 'wall');
    this.exitBox = cw.addBox(e.x - 1, z0 - 0.35, e.x + 1, z0, 'door');
    // sides and their buttresses
    cw.addBox(x0 - 2, z0 - 3, x0, z1 + 3, 'wall');
    cw.addBox(x1, z0 - 3, x1 + 2, z1 + 3, 'wall');
    for (let tz = 1; tz < D; tz += 3) {
      const bz = z0 + tz - 0.25;
      cw.addBox(x0, bz, x0 + 3 * V, bz + 6 * V, 'wall');
      cw.addBox(x1 - 3 * V, bz, x1, bz + 6 * V, 'wall');
    }
    // front parapet with the gate gap, and the apron's walls
    cw.addBox(x0 - 2, z1, g.x - 1 - GATE.post * V, z1 + 3, 'wall');
    cw.addBox(g.x + 1 + GATE.post * V, z1, x1 + 2, z1 + 3, 'wall');
    cw.addBox(g.x - 1 - GATE.post * V, z1, g.x - 1, z1 + 3, 'wall');
    cw.addBox(g.x + 1, z1, g.x + 1 + GATE.post * V, z1 + 3, 'wall');
    cw.addBox(g.x - 1.5, z1 + 2.4, g.x + 1.5, z1 + 4, 'wall');
    this.gateBox = null;
    // blocks and pits
    L.cells.forEach((row, z) => row.forEach((ch, x) => {
      if (ch === '#') cw.addBox(this.tx(x), this.tz(z), this.tx(x + 1), this.tz(z + 1), 'wall');
      if (ch === '~') cw.addBox(this.tx(x) + 0.08, this.tz(z) + 0.08, this.tx(x + 1) - 0.08, this.tz(z + 1) - 0.08, 'pit');
    }));
    // props
    for (const p of this.props) {
      p.collision = cw;
      if (p.K.collide === 'circle') p.collider = cw.addCircle(p.wx, p.wz, p.K.r * 0.92, 'prop');
      if (p.K.collide === 'box') p.collider = cw.addRect(p.wx, p.wz, p.K.box[0] * 2, p.K.box[1] * 2, 'prop');
    }
  }

  /** Spawn points in world units: [x, z, bonus]. 's' tiles, plus open floor if there are few. */
  get spots() {
    if (this._spots) return this._spots;
    const out = [];
    this.L.cells.forEach((row, z) => row.forEach((ch, x) => { if (ch === 's') out.push([this.tx(x + 0.5), this.tz(z + 0.5), 1]); }));
    if (out.length < 4) this.L.cells.forEach((row, z) => row.forEach((ch, x) => { if (ch === '.' && z > 0 && z < this.D - 2 && (x + z) % 3 === 0) out.push([this.tx(x + 0.5), this.tz(z + 0.5), 0]); }));
    return (this._spots = out);
  }

  /** Props the hero can hit (for HeroCombat's targets). Broken ones drop out. */
  targets() {
    if (!this._targets) this._targets = this.props.filter((p) => p.hittable);
    return this._targets;
  }

  // ---- lighting --------------------------------------------------------------------------
  /** Lit: every fire burning. Unlit: coals only (the room before the hero wakes it). */
  setLit(on, instant = false) {
    for (const l of this.lights) {
      if (l.kind === 'exit' || l.kind === 'shaft' || l.kind === 'arch') continue;
      l.lit = on;
      if (instant) { l.cur = on ? l.base : l.base * 0.16; l.handle.intensity = l.cur; }
    }
    this._syncFires();
  }
  _syncFires() {
    const fires = this.lights.filter((l) => l.fire && l.lit).map((l) => l.fire);
    const sources = fires.map((f) => [f[0], f[1] + 0.25, f[2]]);
    this.amb.set({ fires, sources, embers: 3 + fires.length });
  }
  _ignite(l, k) {
    if (l.lit) return;
    l.lit = true; l.flare = 1;
    this._syncFires();
    const [x, y, z] = l.fire ?? [l.x, l.y, l.z];
    vfx.flash(x, y + 0.15, z, { color: 'flame', size: l.kind === 'brazier' ? 1.1 : 0.7, light: false });
    vfx.embers(x, y + 0.1, z, { n: l.kind === 'brazier' ? 22 : 10, spread: 0.3, up: 1.6 });
    arenaSfx.ignite(k);
  }

  // ---- play ---------------------------------------------------------------------------
  /** Enter play mode: the room is dark, the gate is up, and it waits for the hero. */
  play({ foes, hero, lit = false, auto = true } = {}) {
    this.foes = foes; this.hero = hero;
    this.director = new WaveDirector({ plan: this.plan, foes, spots: this.spots, hero });
    this.offs.push(() => this.director.dispose());
    this.offs.push(events.on('arena:wave', (ev) => { if (this.mode === 'fighting') this._banner('wave', `WAVE ${ev.n} / ${ev.total}`, describeWave(this.plan.waves[ev.n - 1]), 110); arenaSfx.wave(ev.n); }));
    this.offs.push(events.on('arena:wavesDone', (ev) => { if (this.mode === 'fighting') this.clearRoom(ev.x, ev.z); }));
    this.setLit(lit, true);
    this.autoSeal = auto;
    this._setMode('waiting');
  }

  _setMode(m) { this.mode = m; this.modeT = 0; }

  /** The hero is in: slam the gate, seal the exit, wake the torches, then the waves. */
  slam() {
    if (this.mode !== 'waiting' && this.mode !== 'static') return;
    events.emit('arena:enter', { index: this.index });
    this._setMode('sealing');
    const G = this.gate;
    G.state = 'falling'; G.vy = 0;
    this._banner('title', this.title, `ARENA ${this.index + 1} OF 5`, 150, 14);
  }

  _gateLanded() {
    const g = this.gateCenter;
    const G = this.gate;
    G.state = 'closed'; G.y = 0;
    if (!this.gateBox) this.gateBox = this.cw.addBox(g.x - 1, g.z, g.x + 1, g.z + 0.75, 'door');
    feedback.hitstop(70);
    feedback.shake(5, 260);
    feedback.kick(0, 1, 3);
    for (let k = -2; k <= 2; k++) vfx.dust(g.x + k * 0.42, g.z + 0.3, { dx: k * 0.3, dz: -0.6, n: 5, size: 1.3, palette: 'dust', spread: 1.3 });
    vfx.dust(g.x, g.z - 0.2, { dz: -1, n: 10, size: 1.5, palette: 'dustDark', spread: 2 });
    vfx.shockwave(g.x, g.z + 0.1, { radius: 1.8, color: 'fog', hot: 'white', dust: false });
    // grit shaken off the lintel
    for (let k = 0; k < 8; k++) {
      const i = vfx.core.add(g.x + (k / 7 - 0.5) * 2, 2.8, g.z + 0.3, (k % 3 - 1) * 0.3, -0.5, 0.1, 0.9, 1 + (k % 2), 'dust', vfx.core.CUBE);
      if (i >= 0) { vfx.core.P.grav[i] = 14; vfx.core.P.bounce[i] = 0.3; }
    }
    look.flash(g.x, 0.6, g.z - 0.3, { color: 'torch', ms: 90, intensity: 1.4, radius: 3 });
    for (const k of [-0.75, -0.25, 0.25, 0.75]) vfx.hitSpark(g.x + k, GATE.bars * V + 0.2, g.z + 0.4, { dx: k, dz: -0.3, power: 0.45, palette: 'cool', light: false });
    vfx.flash(g.x, 0.9, g.z + 0.4, { color: 'white', size: 1.2, light: false });
    arenaSfx.slam();
    for (const c of this.cloths) c.v += 0.09 + (c.phase % 1) * 0.04;
    events.emit('arena:seal', { index: this.index });
  }

  /** The last enemy is down: slow-mo, flash, the banner, torches flare, then the exit rises. */
  clearRoom(x = this.ox, z = this.oz) {
    if (this.mode === 'clearing' || this.mode === 'open' || this.mode === 'exited') return;
    this._setMode('clearing');
    this.clearAt = { x, z };
    this.prevScale = loop.timeScale;
    feedback.hitstop(130);
    feedback.flash('gold', 180, 0.3);
    feedback.shake(3, 200);
    loop.setTimeScale(this.prevScale * 0.3);
    vfx.shockwave(x, z, { radius: 3.4, color: 'gold', hot: 'torch' });
    vfx.sparkle(x, 0.8, z, { palette: 'gold', color: 'gold' });
    look.flash(x, 1, z, { color: 'gold', ms: 400, intensity: 3, radius: 7 });
    arenaSfx.clear();
    this._banner('clear', 'ARENA CLEARED', this.index >= 4 ? 'THE WARDEN AWAITS BELOW' : 'THE WAY DOWN OPENS', 200);
    events.emit('arena:clear', { index: this.index, x, z });
  }

  /** Raise the exit (ratcheting, with dust), light the way. */
  openExit() {
    if (this.exit.state !== 'closed') return;
    this.exit.state = 'rising'; this.exit.step = 0; this.exit.stepT = 0;
    this.runes.red.visible = false; this.runes.off.visible = false; this.runes.gold.visible = true;
    const e = this.exitCenter;
    vfx.flash(e.x, 2.2, e.z + 0.2, { color: 'gold', size: 1.3, light: false });
    if (this.mode !== 'clearing') this._setMode('clearing');
  }

  // ---- tick ----------------------------------------------------------------------------
  tick() {
    this.t++; this.modeT++;
    for (const p of this.props) p.tick();
    this._tickLights();
    this._tickCloth();
    this._tickDoors();
    const h = this.hero?.();
    switch (this.mode) {
      case 'waiting':
        if (this.autoSeal && h && h.z < this.gateCenter.z - 1.5) this.slam();
        break;
      case 'sealing': {
        const t = this.modeT;
        if (t === 20) {
          this.runes.off.visible = false; this.runes.red.visible = true;
          const e = this.exitCenter;
          vfx.flash(e.x, 2.3, e.z + 0.2, { color: 'red', size: 1.2, light: false });
          look.flash(e.x, 2, e.z + 0.4, { color: 'red', ms: 220, intensity: 2, radius: 4 });
          arenaSfx.seal();
        }
        // torches catch one after another, from the gate to the back wall
        if (t === 30) {
          const g = this.gateCenter;
          this._igniteQueue = this.lights.filter((l) => l.fire && !l.lit).sort((a, b) => Math.hypot(b.x - g.x, b.z - g.z) - Math.hypot(a.x - g.x, a.z - g.z)).reverse();
        }
        if (t >= 30 && this._igniteQueue?.length && (t - 30) % 9 === 0) this._ignite(this._igniteQueue.shift(), (t - 30) / 9);
        if (t >= 30 && !this._igniteQueue?.length && t > 70) { this._setMode('fighting'); this.director?.start(); }
        break;
      }
      case 'fighting':
        this.director?.tick();
        break;
      case 'clearing': {
        const t = this.modeT;
        // ease the slow-mo back out
        if (this.prevScale != null) {
          const k = Math.min(1, t / 36);
          loop.setTimeScale(this.prevScale * (0.3 + 0.7 * k * k));
          if (k >= 1) this.prevScale = null;
        }
        if (t === 12) for (const l of this.lights) if (l.lit && l.fire) { l.flare = 1; vfx.embers(l.fire[0], l.fire[1] + 0.1, l.fire[2], { n: 12, spread: 0.25, up: 1.8, palette: 'ember' }); }
        if (t === 30) this.openExit();
        // a trail of gold motes from where it ended to the way out
        if (t >= 34 && t < 94 && t % 4 === 0 && this.clearAt) {
          const k = (t - 34) / 60, e = this.exitPoint;
          const x = this.clearAt.x + (e.x - this.clearAt.x) * k, z = this.clearAt.z + (e.z + 1.2 - this.clearAt.z) * k;
          vfx.twinkle(x, 0.15, z, { color: 'gold', size: 1 });
        }
        if (this.exit.state === 'open') this._setMode('open');
        break;
      }
      case 'open': {
        if (this.modeT % 14 === 0) { const e = this.exitCenter; vfx.twinkle(e.x + ((this.modeT / 14) % 3 - 1) * 0.5, 0.3 + (this.modeT % 28) / 40, e.z - 0.3, { color: 'gold', size: 1 }); }
        if (h && h.z < this.exitCenter.z - 0.55) { this._setMode('exited'); events.emit('arena:exit', { index: this.index }); }
        break;
      }
      default: break;
    }
    // banners age
    for (const b of this.banners) b.t++;
    this.banners = this.banners.filter((b) => b.t < b.dur);
  }

  _tickLights() {
    for (const l of this.lights) {
      let want = l.kind === 'exit' ? (this.exit.state === 'closed' ? 0 : Math.min(1, this.exit.y / EXIT_OPEN_Y) * l.base + (this.exit.state === 'open' ? 0 : 0)) : l.lit ? l.base : l.base * 0.16;
      if (l.kind === 'exit') l.base = 1.4;
      if (l.flare > 0) { want *= 1 + l.flare * 0.8; l.flare = Math.max(0, l.flare - 0.025); }
      if (l.prop?.gust) want *= 1 + l.prop.gust * 0.6;
      l.cur += (want - l.cur) * (l.cur < want ? 0.35 : 0.12);
      l.handle.intensity = l.cur;
    }
  }

  _tickCloth() {
    for (const c of this.cloths) {
      c.pa = c.a;
      // a slow idle stir, stepped at 6 Hz so it reads as pixel animation, plus a spring for knocks
      const idle = Math.round(Math.sin((this.t / 60) * 1.3 + c.phase) * 2) * 0.012;
      c.v += (idle - c.a) * 0.08; c.v *= 0.9; c.a += c.v;
    }
  }

  _tickDoors() {
    const G = this.gate;
    G.py = G.y;
    if (G.state === 'falling') {
      // the bars shoot up out of the slot (the name is kept for debug scripts: it is the slam)
      G.vy = Math.min(0.5, G.vy + 0.16); G.y += G.vy;
      if (G.y >= 0) { G.y = 0; this._gateLanded(); G.state = 'hop'; G.vy = 0.07; }
    } else if (G.state === 'hop') {
      // overshoot two voxels, then drop home with a clank
      G.y += G.vy; G.vy -= 0.03;
      if (G.y <= 0 && G.vy < 0) { G.y = 0; G.state = 'closed'; arenaSfx.iron(); }
    } else if (G.state === 'rising') {
      G.y = Math.max(GATE_OPEN_Y, G.y - 0.06);
      if (G.y <= GATE_OPEN_Y) G.state = 'open';
    }
    const X = this.exit;
    X.py = X.y;
    if (X.state === 'rising') {
      // wound up in seven ratchet steps: a jerk up, a click, a pause
      X.stepT++;
      const STEPS = 7, per = 11;
      const target = ((X.step + 1) / STEPS) * EXIT_OPEN_Y;
      if (X.stepT <= 4) X.y += (target - X.y) * 0.55;
      if (X.stepT === 4) {
        X.y = target;
        arenaSfx.ratchet(X.step);
        feedback.shake(1.2, 70);
        const e = this.exitCenter;
        vfx.dust(e.x + (X.step % 2 ? 0.6 : -0.6), e.z + 0.25, { n: 3, size: 0.8, y: 2.6, palette: 'dustDark' });
      }
      if (X.stepT >= per) {
        X.step++; X.stepT = 0;
        if (X.step >= STEPS) {
          X.state = 'open'; X.y = EXIT_OPEN_Y;
          if (this.exitBox) { this.cw.remove(this.exitBox); this.exitBox = null; }
          arenaSfx.thunk();
          feedback.shake(2.5, 140);
          const e = this.exitCenter;
          vfx.dust(e.x, e.z + 0.3, { dz: 1, n: 10, size: 1.2, spread: 1.6 });
          events.emit('arena:open', { index: this.index });
        }
      }
    }
  }

  /** Enemy crash / slam: knock over breakables nearby, rock braziers, shake the banners. */
  _quake(x, z, radius, power) {
    for (const p of this.props) {
      const d = Math.hypot(p.wx - x, p.wz - z);
      if (d > radius || p.dead) continue;
      const dx = (p.wx - x) / (d || 1), dz = (p.wz - z) / (d || 1);
      if (p.K.type === 'break') p.shatter(dx, dz, power);
      else if (p.K.type === 'sturdy') p.react(dx, dz, power);
    }
    for (const c of this.cloths) c.v += 0.05;
  }

  // ---- render --------------------------------------------------------------------------
  render(alpha) {
    for (const p of this.props) p.render(alpha);
    const G = this.gate, X = this.exit;
    G.mesh.position.y = Math.round((G.py + (G.y - G.py) * alpha) / V * 2) / 2 * V;   // half-voxel steps
    X.mesh.position.y = Math.round((X.py + (X.y - X.py) * alpha) / V) * V;
    for (const c of this.cloths) c.mesh.rotation.x = c.pa + (c.a - c.pa) * alpha;
  }

  _banner(kind, text, sub, dur, delay = 0) {
    this.banners = this.banners.filter((b) => b.kind !== kind && !(kind === 'clear' && b.kind === 'wave'));
    this.banners.push({ kind, text, sub, t: -delay, dur });
  }

  /** UI: the room's title card, wave calls, and the clear banner. */
  ui(g) {
    const W = display.width, H = display.height;
    for (const b of this.banners) {
      const t = b.t, out = b.dur - t;
      if (t < 0) continue;
      if (b.kind === 'title') {
        // bottom-left plate: a gold rule grows, the name slides up
        const k = ease(t / 14), ko = Math.min(1, out / 16);
        const y = Math.round(H - 58 + (1 - k) * 10 + (1 - ko) * 10);
        const w = Math.round((textWidth(b.text) * 2 + 18) * Math.min(k, ko));
        if (w <= 2) continue;
        g.fillStyle = css('ink'); g.fillRect(8, y - 4, w, 34);
        g.fillStyle = css('gold'); g.fillRect(8, y - 4, Math.max(2, Math.round(w * ease(t / 24))), 2);
        if (k > 0.6 && ko > 0.5) {
          drawText(g, b.sub, 16, y + 1, 'fog', {});
          drawText(g, b.text, 16, y + 11, 'bone', { scale: 2 });
        }
      } else if (b.kind === 'wave') {
        const k = ease(t / 10), ko = Math.min(1, out / 12);
        const y = Math.round(34 - (1 - k) * 14);
        if (ko <= 0.2) continue;
        const tw = textWidth(b.text) * 2;
        g.fillStyle = css('ink'); g.fillRect(Math.round(W / 2 - tw / 2 - 10), y - 5, tw + 20, 34);
        g.fillStyle = css('red'); g.fillRect(Math.round(W / 2 - tw / 2 - 10), y + 27, Math.round((tw + 20) * (1 - t / b.dur)), 2);
        drawText(g, b.text, W / 2, y, t < 4 ? 'white' : 'bone', { align: 'center', scale: 2 });
        drawText(g, b.sub, W / 2, y + 17, 'rose', { align: 'center' });
      } else if (b.kind === 'clear') {
        // slams in big, overshoots, settles; a shine sweeps across; fades out stepped
        const k = t / 10;
        const scale = t < 5 ? 5 : t < 8 ? 4 : 3;
        const fade = out < 24 ? out % 4 < 2 && out < 12 ? 0 : 1 : 1;
        if (!fade) continue;
        const y = Math.round(H * 0.3);
        const tw = textWidth(b.text) * scale;
        const bandH = 26 + scale * 7;
        const bw = Math.round(Math.min(1, k * 1.4) * (W + 4));
        g.fillStyle = css('ink'); g.fillRect(Math.round(W / 2 - bw / 2), y - bandH / 2 - 2, bw, bandH + 14);
        g.fillStyle = css('gold'); g.fillRect(Math.round(W / 2 - bw / 2), y - bandH / 2 - 2, bw, 2); g.fillRect(Math.round(W / 2 - bw / 2), y + bandH / 2 + 10, bw, 2);
        drawText(g, b.text, W / 2, Math.round(y - scale * 3.5), t < 3 ? 'white' : 'gold', { align: 'center', scale, outline: 'ink' });
        // the shine: a 3-px white bar crossing the letters once
        const sx = Math.round(W / 2 - tw / 2 + ((t - 10) / 22) * (tw + 20));
        if (t > 10 && t < 34) { g.fillStyle = css('torch'); g.fillRect(sx, Math.round(y - scale * 3.5), 3, scale * 7); }
        if (t > 14) drawText(g, b.sub, W / 2, Math.round(y + scale * 3.5 + 4), 'bone', { align: 'center' });
      }
    }
  }

  info() {
    return {
      index: this.index, id: this.id, title: this.title, mode: this.mode, W: this.W, D: this.D, mirror: this.L.mirror,
      gate: this.gate.state, exit: this.exit.state, lit: this.lights.filter((l) => l.lit && l.fire).length,
      lights: this.lights.length, props: this.props.length, broken: this.props.filter((p) => p.dead).length,
      director: this.director?.info() ?? null,
      waves: this.plan.waves.map((w) => describeWave(w)),
      layout: layoutAscii(this.L),
    };
  }

  dispose() {
    this.offs.forEach((f) => f()); this.offs = [];
    this.amb?.stop();
    for (const l of this.lights) l.handle.remove();
    if (this.prevScale != null) { loop.setTimeScale(this.prevScale); this.prevScale = null; }
  }
}

// =====================================================================================
// debug: __GR.debug.arena(action?, ...)
//   ()                 the active arena's info (mode, doors, lights, props, waves, layout)
//   'slam' | 'clear' | 'open'   drive the ceremony now
//   'plan', seed?      every arena of a run: template, size, waves (seed-reproducible)
//   'layout', i, seed? the ASCII layout of arena i after mirroring and '?' picks
//   'lit', on          light or darken the room
//   'break'            smash every breakable prop (a quick check of the break effects)
// =====================================================================================
let active = null;
/** The arena the current scene is playing in (for debug and other pieces). */
export const activeArena = () => active;
export function setActiveArena(a) { active = a; }

debug.add('arena', (action, ...a) => {
  if (action === 'plan') {
    const seed = a[0] ?? active?.seed ?? 1;
    const order = arenaOrder(seed);
    return order.map((id, i) => ({ index: i, id, title: TEMPLATES[id].title, waves: planArena(i, seed).waves.map(describeWave) }));
  }
  if (action === 'layout') { const L = layoutFor(a[0] ?? 0, a[1] ?? active?.seed ?? 1); return { id: L.id, mirror: L.mirror, rows: layoutAscii(L) }; }
  if (!active) return { ok: false, error: 'no arena is being played in this scene' };
  if (!action) return active.info();
  if (action === 'slam') { if (active.mode === 'static') active.mode = 'waiting'; active.slam(); return active.info(); }
  if (action === 'clear') { active.clearRoom(); return active.info(); }
  if (action === 'open') { active.openExit(); return active.info(); }
  if (action === 'lit') { active.setLit(a[0] !== false); return active.info(); }
  if (action === 'break') { for (const p of active.props) p.shatter(0, 1, 1); return active.info(); }
  return { ok: false, error: `unknown arena action "${action}"` };
});
