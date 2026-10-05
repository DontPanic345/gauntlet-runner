// The enemy manager (piece `enemies`): owns every live enemy in a scene, and the things they
// share: attack tokens, flanking slots, separation, the ember wisp's orbs, floor telegraphs
// and floor decals.
//
//   import { createEnemies } from '../enemies/index.js';
//   const foes = createEnemies(root, { collision: cw, bounds });   // hero defaults to world.hero
//   foes.spawn('husk', x, z);            // with its spawn-in; returns the enemy
//   foes.spawn('mites', x, z);           // a swarm of 5 from one portal; returns the array
//   foes.spawn('brute', x, z, { instant: true });   // no spawn-in
//   tick:   foes.tick();     (after the hero's combat.tick(), so hits land before enemies act)
//   render: foes.render(alpha);
//   exit:   foes.dispose();
//   foes.list  alive and dying enemies     foes.alive  count still fighting     foes.clear()
//
// Enemies are added to world.enemies (so HeroCombat can hit them and state() lists them) and
// removed from it when their death animation has finished.
//
// AI rules that live here, because they need to see everyone:
//   Attack tokens: a melee enemy needs tokens to start a windup (husk 1, mite 0.5, brute 2);
//     there are TOKENS.base + TOKENS.perAggression * (aggression - 1) of them. Enemies wait
//     their turn instead of all swinging at once, so a crowd reads as a sequence of tells.
//   Flanking slots: melee enemies near the hero get an angle round the hero, spread out by
//     relaxing their current angles apart, so a crowd surrounds the hero instead of queueing
//     behind one another.
//   Separation: a soft push between neighbours (steering) plus a hard overlap resolve, and
//     no enemy body ever overlaps the hero's.

import * as THREE from 'three';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { getCollision } from '../core/collision.js';
import { DT } from '../core/loop.js';
import { voxelMesh } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { createFloorTiles } from './telegraph.js';
import { TOKENS, DIFFICULTY, ENEMY_DATA, dmg } from './data.js';
import { enemySfx } from './sfx.js';
import { wrap } from './enemy.js';
import { Husk } from './husk.js';
import { Wisp } from './wisp.js';
import { Brute } from './brute.js';
import { Mite } from './mite.js';
import './models.js';

export const CLASSES = { husk: Husk, wisp: Wisp, brute: Brute, mite: Mite };
/** Spawnable names: the four archetypes, plus 'mites' (a group) and 'swarm' (alias). */
export const SPAWN_TYPES = ['husk', 'wisp', 'brute', 'mite', 'mites'];

let active = null;
let fxs = 12345;
/** Visual-only noise (never the game rng, so effects never change gameplay). */
const fxr = () => { fxs = (fxs * 16807) % 2147483647; return fxs / 2147483647; };
export const activeEnemies = () => active;

export class EnemyManager {
  constructor(root, { collision = getCollision(), bounds = null, hero = () => world.hero } = {}) {
    this.root = root;
    this.collision = collision;
    this.bounds = bounds;
    this.hero = hero;
    this.list = [];
    this.orbs = [];
    this.decals = [];
    this.tokensUsed = 0;
    this.tiles = createFloorTiles(root);
    this.t = 0;
    this.kills = 0;
    this.frozen = false;          // debug: AI paused
    active = this;
  }

  get tokenCap() { return TOKENS.base + TOKENS.perAggression * (DIFFICULTY.aggression - 1); }
  takeToken(e, cost) { if (this.tokensUsed + cost > this.tokenCap + 1e-6) return false; this.tokensUsed += cost; return true; }
  giveToken(e, cost) { this.tokensUsed = Math.max(0, this.tokensUsed - cost); }
  get alive() { return this.list.filter((e) => !e.dying && !e.dead).length; }

  /**
   * Spawn an enemy (or a swarm). opts: { instant, yaw, id, delay }.
   * Returns the enemy, or an array for 'mites'.
   */
  spawn(kind, x = 0, z = 0, opts = {}) {
    if (kind === 'mites' || kind === 'swarm') return this.spawnSwarm(x, z, opts);
    const C = CLASSES[kind];
    if (!C) throw new Error(`enemies: no archetype "${kind}"`);
    [x, z] = this.freeSpot(x, z, ENEMY_DATA[kind].radius);
    const e = new C(this, kind, { x, z, spawn: opts.instant ? 'instant' : 'default', ...opts });
    this.add(e);
    return e;
  }

  /**
   * The nearest point to (x, z) where a body of radius r fits (not inside a pillar, a brazier
   * or a wall), searched on rings out to 3 units. A spawn asked for inside a prop lands beside it.
   */
  freeSpot(x, z, r) {
    const cw = this.collision;
    if (!cw || !cw.blocked(x, z, r)) return [x, z];
    for (let d = 0.25; d <= 3; d += 0.25) for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      const B = this.bounds;
      if (B && (px < B.minX + r || px > B.maxX - r || pz < B.minZ + r || pz > B.maxZ - r)) continue;
      if (!cw.blocked(px, pz, r)) return [px, pz];
    }
    return [x, z];
  }

  /** Five mites from one portal, flung out to a ring round it. */
  spawnSwarm(x, z, { instant = false, n = ENEMY_DATA.mite.group, ...opts } = {}) {
    [x, z] = this.freeSpot(x, z, 0.7);
    let pop = 0;
    if (!instant) { pop = vfx.spawnPortal(x, z, { dur: 0.75, radius: 0.7, palette: 'cool' }).popTick; enemySfx.spawn('mite'); }
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.4;
      const tx = x + Math.sin(a) * 0.62, tz = z + Math.cos(a) * 0.62;
      const e = new Mite(this, 'mite', { ...opts, x: instant ? tx : x, z: instant ? tz : z, yaw: a, spawn: instant ? 'instant' : 'fling', delay: pop + k * 2, from: { x, z, tx, tz } });
      this.add(e);
      out.push(e);
    }
    return out;
  }

  add(e) {
    this.list.push(e);
    world.enemies.push(e);
    events.emit('enemy:spawn', { enemy: e, kind: e.kind, x: e.x, z: e.z });
  }

  /** The debug.spawn contract: returns a result for our types, or null for anything else. */
  spawnCommand(type, x = 0, z = 0) {
    if (!SPAWN_TYPES.includes(type) && type !== 'swarm') return null;
    const r = this.spawn(type, x, z);
    return Array.isArray(r) ? { ok: true, ids: r.map((e) => e.id) } : { ok: true, id: r.id };
  }

  // ---- the tick ------------------------------------------------------------------------
  tick() {
    this.t++;
    const hero = this.hero();
    this.assignSlots(hero);
    this.separation();
    for (const e of this.list) {
      if (this.frozen && !e.dying && e.state !== 'spawn') { e.snapPose(); continue; }
      e.tick();
    }
    this.resolveOverlaps(hero);
    this.tickOrbs(hero);
    // drop the finished
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.remove) continue;
      e.dispose();
      this.list.splice(i, 1);
      const w = world.enemies.indexOf(e);
      if (w >= 0) world.enemies.splice(w, 1);
      this.kills++;
    }
    // floor: telegraphs, orb markers, decals
    const T = this.tiles;
    T.begin();
    for (const d of this.decals) this.drawDecal(d);
    this.decals = this.decals.filter((d) => ++d.t < d.life);
    for (const e of this.list) e.telegraph?.(T);
    for (const o of this.orbs) this.drawOrbMarker(o);
    T.end();
  }

  assignSlots(hero) {
    if (!hero) return;
    const eng = [];
    for (const e of this.list) {
      if (e.dying || !e.ai || e.kind === 'wisp' || e.state === 'spawn') continue;
      if (Math.hypot(e.x - hero.x, e.z - hero.z) > 9) { e.slot = null; continue; }
      eng.push({ e, a: Math.atan2(e.x - hero.x, e.z - hero.z) });
    }
    const n = eng.length;
    if (!n) return;
    const minSep = Math.min(1.9, (Math.PI * 2) / n) * 0.92;
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = wrap(eng[i].a - eng[j].a);
        const ad = Math.abs(d);
        if (ad >= minSep) continue;
        const push = (minSep - ad) * 0.5 * (d >= 0 ? 1 : -1);
        eng[i].a = wrap(eng[i].a + push); eng[j].a = wrap(eng[j].a - push);
      }
    }
    for (const { e, a } of eng) e.slot = e.slot == null ? a : wrap(e.slot + wrap(a - e.slot) * 0.12);
  }

  separation() {
    const L = this.list;
    for (const e of L) { e.sepX = 0; e.sepZ = 0; }
    for (let i = 0; i < L.length; i++) {
      const a = L[i]; if (a.dying || !a.visible) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j]; if (b.dying || !b.visible) continue;
        const R = a.r + b.r + (a.kind === 'mite' && b.kind === 'mite' ? 0.18 : 0.4);
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d >= R) continue;
        const k = (1 - d / R) * 3.2;
        const nx = d > 1e-4 ? dx / d : Math.cos(i * 2.4), nz = d > 1e-4 ? dz / d : Math.sin(i * 2.4);
        const wa = b.weight / (a.weight + b.weight), wb = 1 - wa;
        a.sepX -= nx * k * wa * 2; a.sepZ -= nz * k * wa * 2;
        b.sepX += nx * k * wb * 2; b.sepZ += nz * k * wb * 2;
      }
    }
  }

  resolveOverlaps(hero) {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i]; if (a.dying || !a.visible || a.y > 0.3) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j]; if (b.dying || !b.visible || b.y > 0.3) continue;
        const R = a.r + b.r, dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d >= R || d < 1e-5) continue;
        const o = R - d, nx = dx / d, nz = dz / d;
        const wa = b.weight / (a.weight + b.weight);
        a.moveBy(-nx * o * wa, -nz * o * wa);
        b.moveBy(nx * o * (1 - wa), nz * o * (1 - wa));
      }
      // never inside the hero (a charging brute passes through its hit instead)
      if (hero && !hero.dead && a.state !== 'charge' && a.kind !== 'wisp') {
        const R = a.r + 0.3, dx = a.x - hero.x, dz = a.z - hero.z, d = Math.hypot(dx, dz);
        if (d < R && d > 1e-5) a.moveBy(dx / d * (R - d), dz / d * (R - d));
      }
    }
  }

  // ---- ember orbs ------------------------------------------------------------------------
  /** Fire a slow ember orb (the wisp's attack). */
  fireOrb(owner, x, y, z, dx, dz, { speed, life, radius, dmg: n = 1 }) {
    const mesh = voxelMesh('enemies.wisp.orb');
    look.noShadow(mesh);
    this.root.add(mesh);
    const o = { owner, x, y, z, px: x, py: y, pz: z, vx: dx * speed, vz: dz * speed, life, t: 0, r: radius, dmg: n, mesh, dead: false };
    this.orbs.push(o);
    return o;
  }

  tickOrbs(hero) {
    const cw = this.collision;
    for (const o of this.orbs) {
      o.px = o.x; o.py = o.y; o.pz = o.z;
      o.t++;
      o.x += o.vx * DT; o.z += o.vz * DT;
      o.y = 0.55 + Math.sin(o.t * 0.25) * 0.03;
      // trail: a hot core flicker and embers peeling off
      if (o.t % 2 === 0) {
        const i = vfx.core.add(o.x + (fxr() - 0.5) * 0.1, o.y + (fxr() - 0.5) * 0.1, o.z, -o.vx * 0.12, 0.6 + fxr(), -o.vz * 0.12, 0.35 + fxr() * 0.2, o.t % 6 ? 1 : 2, 'ember', vfx.core.SPRITE);
        if (i >= 0) { vfx.core.P.drag[i] = 0.93; vfx.core.P.wob[i] = 3; }
      }
      let pop = null;
      if (o.t >= o.life) pop = 'fizzle';
      else if (cw && cw.blocked(o.x, o.z, o.r * 0.7)) pop = 'wall';
      else if (hero && !hero.dead && Math.hypot(hero.x - o.x, hero.z - o.z) < o.r + 0.3) {
        const r = hero.hurt ? hero.hurt(dmg(o.dmg), { x: o.x - o.vx * 0.05, z: o.z - o.vz * 0.05 }) : { ok: false };
        if (r.ok || r.reason !== 'dodged') pop = 'hit';        // a dash passes through it
        if (r.ok && o.owner) o.owner.landed++;
        if (r.reason === 'dodged' && o.owner && !o.dodged) { o.dodged = true; o.owner.dodged++; }
      }
      if (pop) this.popOrb(o, pop);
    }
    this.orbs = this.orbs.filter((o) => !o.dead);
  }

  popOrb(o, why) {
    o.dead = true;
    o.mesh.removeFromParent();
    const big = why !== 'fizzle';
    vfx.hitSpark(o.x, o.y, o.z, { dx: -o.vx, dz: -o.vz, power: big ? 1 : 0.5, palette: 'ember', light: true });
    vfx.embers(o.x, o.y - 0.2, o.z, { n: big ? 12 : 6, spread: 0.2, up: 0.8 });
    if (why === 'wall') vfx.dust(o.x - o.vx * 0.04, o.z - o.vz * 0.04, { n: 4, size: 0.7, palette: 'dustDark' });
    this.decal(o.x, o.z, 'scorch');
    enemySfx.orbPop();
    events.emit('enemy:orbPop', { x: o.x, z: o.z, why });
  }

  drawOrbMarker(o) {
    // where the orb is over the floor: a small ring of red tiles, so its path reads in 2D
    const T = this.tiles;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + o.t * 0.05;
      T.dot(o.x + Math.sin(a) * 0.2, o.z + Math.cos(a) * 0.2, k % 2 ? 'red' : 'blood');
    }
    T.dot(o.x, o.z, 'blood');
  }

  // ---- floor decals: splats and scorches that dissolve tile by tile -------------------------
  decal(x, z, kind, { r = 0.35, life = 200 } = {}) {
    const cols = { goo: ['teal', 'navy', 'teal'], rot: ['moss', 'stoneDark', 'moss'], scorch: ['stoneDark', 'night', 'blood'], blood: ['blood', 'plum', 'stoneDark'], crack: ['night', 'stoneDark', 'night'] }[kind] || ['stoneDark'];
    const cells = [];
    const V = 1 / 8;
    let s = Math.floor(x * 97 + z * 31) >>> 0;
    const rnd = () => { s = (s * 16807 + 11) % 2147483647; return s / 2147483647; };
    for (let dz = -r; dz <= r; dz += V) for (let dx = -r; dx <= r; dx += V) {
      const d = Math.hypot(dx, dz) / r;
      if (d > 1 || rnd() < d * 0.75) continue;
      cells.push({ x: x + dx, z: z + dz, col: cols[Math.floor(rnd() * cols.length)], k: rnd() });
    }
    // a few flecks flung further out
    for (let k = 0; k < 5; k++) { const a = rnd() * 6.28, d = r * (1.1 + rnd() * 0.8); cells.push({ x: x + Math.sin(a) * d, z: z + Math.cos(a) * d, col: cols[0], k: rnd() * 0.5 }); }
    this.decals.push({ cells, t: 0, life });
    if (this.decals.length > 40) this.decals.shift();
  }
  drawDecal(d) {
    // dissolve: in the last half of its life, cells drop out in a fixed random order
    const f = d.t < d.life * 0.5 ? 1.1 : 1 - (d.t - d.life * 0.5) / (d.life * 0.5);
    for (const c of d.cells) if (c.k < f) this.tiles.dot(c.x, c.z, c.col, 0.008);
  }

  // ---- render and teardown ----------------------------------------------------------------
  render(alpha) {
    for (const e of this.list) e.render(alpha);
    const t = this.t + alpha;
    for (const o of this.orbs) {
      const m = o.mesh;
      m.position.set(o.px + (o.x - o.px) * alpha, o.py + (o.y - o.py) * alpha, o.pz + (o.z - o.pz) * alpha);
      look.snap(m.position);
      m.rotation.set(t * 0.3, t * 0.2, 0);
      const s = 1 + ((o.t >> 2) & 1) * 0.12;   // a stepped throb
      m.scale.setScalar(s);
    }
  }

  clear() {
    for (const e of this.list) { e.dispose(); const w = world.enemies.indexOf(e); if (w >= 0) world.enemies.splice(w, 1); }
    this.list.length = 0;
    for (const o of this.orbs) o.mesh.removeFromParent();
    this.orbs.length = 0;
    this.decals.length = 0;
    this.tokensUsed = 0;
  }

  dispose() {
    this.clear();
    this.tiles.dispose();
    if (active === this) active = null;
  }

  info() {
    return { enemies: this.list.map((e) => e.info()), orbs: this.orbs.length, tokens: +this.tokensUsed.toFixed(2), tokenCap: this.tokenCap, kills: this.kills, frozen: this.frozen };
  }
}

export function createEnemies(root, opts) { return new EnemyManager(root, opts); }
