// Pickups (piece `boons`): soul shards (currency) and hearts. They pop out of kills with a
// bounce, bob and glint while they wait, then vacuum toward the hero when he comes near,
// accelerating along a slight curve with a sparkle trail, and collect with a rising
// pentatonic ladder (each shard within half a second climbs one note).
//
//   import { createPickups } from './progression/pickups.js';
//   const pk = createPickups(root, { hero: () => world.hero, rng, bounds });
//   pk.drop({ x, z, shards: 3, hearts: 0 });   pk.dropForEnemy('husk', x, z);
//   pk.vacuumAll();                             // arena cleared: everything flies to the hero
//   pk.tick();  pk.render(alpha);  pk.ui(g);    pk.dispose();
//   pk.total (shards held)   pk.spend(n) -> bool   pk.add(n)   pk.magnetMul / pk.dropBonus
//   drawShardCounter(g, x, y, pk)               HUD helper: glyph + count that pops
//
// Events: 'pickup:drop' {kind,x,z}, 'pickup:shard' {n, total, ladder, x, z},
//         'pickup:heart' {x, z, hp}, 'pickup:spend' {n, total}.

import * as THREE from 'three';
import { defineModel, voxelMesh, VoxelGrid } from '../render/voxel/index.js';
import { events } from '../core/events.js';
import { DT } from '../core/loop.js';
import { display } from '../core/display.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { drawGlyph } from './icons.js';
import { vfx } from '../vfx/index.js';
import { ramp, F_TWINKLE } from '../vfx/particles.js';
import { look } from '../render/look.js';
import { boonSfx } from './sfx.js';

let built = false;
function buildModels() {
  if (built) return;
  built = true;
  // soul shard: an elongated diamond, facets lit differently, glowing
  const g = new VoxelGrid(5, 6, 5);
  const R = [0, 1, 2, 2, 1, 0];
  for (let y = 0; y < 6; y++) for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
    const dx = x - 2, dz = z - 2;
    if (Math.abs(dx) + Math.abs(dz) > R[y]) continue;
    if (y >= 4) g.set(x, y, z, dx + dz < 0 ? 'white' : 'sky', true);
    else if (y === 0) g.set(x, y, z, 'blue');
    else g.set(x, y, z, dx + dz < 0 ? 'sky' : dx + dz === 0 ? 'cyan' : 'teal', dx + dz <= 0);
  }
  defineModel('boon.shard', { grid: g, origin: 'bottom-center' });
  // heart: extruded 3 deep, glowing front face
  const H = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  const h = new VoxelGrid(7, 6, 3);
  H.forEach((row, j) => {
    const y = 5 - j;
    for (let x = 0; x < 7; x++) if (row[x] === '#') {
      const hi = j <= 1 && x <= 2, low = j >= 3;
      for (let z = 0; z < 3; z++) {
        const front = z === 2;
        h.set(x, y, z, hi && front ? 'rose' : low && !front ? 'blood' : front ? 'red' : 'blood', front);
      }
    }
  });
  defineModel('boon.heart', { grid: h, origin: 'bottom-center' });
}

const RAMP_SHARD = () => ramp('white,sky,cyan,blue');
const RAMP_HEART = () => ramp('white,rose,red,blood');

export function createPickups(root, { hero = () => null, rng, bounds = null } = {}) {
  buildModels();
  const group = new THREE.Group();
  group.name = 'pickups';
  root.add(group);
  const items = [];
  let tickN = 0, lastCollect = -999, ladder = 0, dropBusy = 0;
  const counter = { pop: 99, add: 0, addT: 99 };

  const pk = {
    items, total: 0, magnetMul: 1, dropBonus: 0, bounds, stats: { shards: 0, hearts: 0 },
    heroPos: null,

    /** Pop pickups out of (x, z). shards/hearts are counts; spread in radians ring. */
    drop({ x, z, shards = 0, hearts = 0, power = 1 }) {
      const n = shards + hearts;
      const a0 = rng.next() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const kind = i < hearts ? 'heart' : 'shard';
        const a = a0 + (i / Math.max(1, n)) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const sp = (kind === 'heart' ? 1.4 : 1.1 + rng.next() * 1.5) * (0.7 + 0.3 * power);
        make(kind, x, z, Math.sin(a) * sp, Math.cos(a) * sp, 4.2 + rng.next() * 2.4 + (kind === 'heart' ? 1 : 0), i * 2);
      }
      if (n) events.emit('pickup:drop', { kind: hearts ? 'heart' : 'shard', x, z, n });
    },
    /** What a dying enemy of this kind leaves. Hearts are more likely when the hero is hurt. */
    dropForEnemy(kind, x, z) {
      const base = { mite: rng.chance(0.5) ? 1 : 0, husk: 2, wisp: 2, brute: 5 }[kind] ?? 1;
      const shards = base + (base > 0 ? pk.dropBonus : 0);
      const h = hero();
      const miss = h ? 1 - h.hp / h.maxHp : 0;
      const heart = h && h.hp < h.maxHp && rng.chance(0.05 + 0.2 * miss) ? 1 : 0;
      pk.drop({ x, z, shards, hearts: heart, power: kind === 'brute' ? 1.4 : 1 });
    },
    add(n) { pk.total += n; counter.pop = 0; counter.add = n; counter.addT = 0; },
    spend(n) {
      if (pk.total < n) return false;
      pk.total -= n; counter.pop = 0; counter.add = -n; counter.addT = 0;
      events.emit('pickup:spend', { n, total: pk.total });
      return true;
    },
    /** Everything on the floor flies to the hero now (arena cleared). */
    vacuumAll() {
      let k = 0;
      for (const it of items) if (it.state !== 'fly' && !(it.kind === 'heart' && !needsHeart())) { it.state = 'fly'; it.t = 0; it.delay = k++ * 1.4; }
    },
    clear() { for (const it of items) group.remove(it.mesh); items.length = 0; },

    tick() {
      tickN++;
      const h = hero();
      pk.heroPos = h;
      counter.pop++; counter.addT++;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.px = it.x; it.py = it.y; it.pz = it.z;
        it.age++;
        if (it.state === 'pop') stepPop(it);
        else if (it.state === 'idle') stepIdle(it, h);
        else if (it.state === 'fly') { if (stepFly(it, h)) { collect(it, h); group.remove(it.mesh); items.splice(i, 1); } }
        // glint while waiting
        if (it.state !== 'pop' && ((it.age + it.seed) % 26 === 0)) glint(it);
      }
    },

    render(alpha) {
      for (const it of items) {
        const x = it.px + (it.x - it.px) * alpha, y = it.py + (it.y - it.py) * alpha, z = it.pz + (it.z - it.pz) * alpha;
        it.mesh.position.set(x, y, z);
        const s = it.spawnK < 1 ? popScale(it.age / 10) : 1;
        if (it.kind === 'shard') {
          it.mesh.rotation.y = it.spin + it.age * 0.07;
          const sc = 1.25 * s * (it.state === 'fly' ? 0.85 : 1);
          it.mesh.scale.set(sc, sc * (1 + Math.sin(it.age * 0.2) * 0.04), sc);
        } else {
          const beat = it.state === 'idle' ? 1 + Math.max(0, Math.sin((it.age + it.seed) * 0.16)) ** 6 * 0.14 : 1;
          it.mesh.rotation.y = Math.sin((it.age + it.seed) * 0.05) * 0.5;
          const sc = 1.15 * s * beat;
          it.mesh.scale.set(sc, sc, sc);
        }
      }
    },

    ui() {},
    dispose() { pk.clear(); root.remove(group); },
    info() { return { total: pk.total, items: items.map((i) => ({ kind: i.kind, state: i.state, x: +i.x.toFixed(2), z: +i.z.toFixed(2) })), ladder }; },
    counter,
  };

  const popScale = (u) => { u = Math.min(1, Math.max(0, u)); return u < 1 ? (u < 0.6 ? u / 0.6 * 1.3 : 1.3 - (u - 0.6) / 0.4 * 0.3) : 1; };
  const needsHeart = () => { const h = hero(); return !!h && h.hp < h.maxHp && !h.dead; };

  function make(kind, x, z, vx, vz, vy, delay = 0) {
    const mesh = voxelMesh(kind === 'heart' ? 'boon.heart' : 'boon.shard');
    mesh.visible = false;
    group.add(mesh);
    const it = { kind, mesh, x, y: 0.3, z, px: x, py: 0.3, pz: z, vx, vz, vy, state: 'pop', age: -delay, t: 0, delay: 0,
      spawnK: 0, bounces: 0, spin: rng.next() * 6.28, seed: (rng.next() * 40) | 0 };
    items.push(it);
    return it;
  }

  function clampB(it) {
    const b = pk.bounds; if (!b) return;
    it.x = Math.min(b.maxX, Math.max(b.minX, it.x)); it.z = Math.min(b.maxZ, Math.max(b.minZ, it.z));
  }

  function stepPop(it) {
    if (it.age < 0) { it.px = it.x; it.py = it.y; it.pz = it.z; return; }   // staggered start
    it.mesh.visible = true;
    it.vy -= 17 * DT;
    it.x += it.vx * DT; it.z += it.vz * DT; it.y += it.vy * DT;
    clampB(it);
    if (it.y <= 0.16 && it.vy < 0) {
      it.y = 0.16;
      if (it.bounces < 2 && -it.vy > 1.2) {
        it.vy = -it.vy * 0.46; it.vx *= 0.6; it.vz *= 0.6; it.bounces++;
        boonSfx.drop();
        if (vfx.attached) vfx.dust({ x: it.x, z: it.z, n: 2, size: 3, speed: 0.4 });
      } else { it.vy = 0; it.vx = it.vz = 0; it.state = 'idle'; it.spawnK = 1; it.age = 0; }
    }
    if (it.age === 1 && vfx.attached) glint(it, true);
  }

  function stepIdle(it, h) {
    it.y = 0.3 + Math.sin((it.age + it.seed) * 0.08) * 0.05 + (it.kind === 'heart' ? 0.12 : 0);
    if (!h || h.dead || it.age < 16) return;
    if (it.kind === 'heart' && !needsHeart()) return;
    const r = (it.kind === 'heart' ? 1.6 : 2.0) * pk.magnetMul;
    const d = Math.hypot(h.x - it.x, h.z - it.z);
    if (d < r) { it.state = 'fly'; it.t = 0; it.delay = rng.next() * 5; it.sx = it.x; it.sz = it.z; it.curve = rng.signed(); }
  }

  /** Returns true when it reaches the hero. */
  function stepFly(it, h) {
    if (!h) return false;
    if (it.delay > 0) { it.delay -= 1; it.y += 0.02; return false; }
    it.t++;
    const tx = h.x, tz = h.z, ty = 0.6;
    let dx = tx - it.x, dz = tz - it.z, dy = ty - it.y;
    const d = Math.hypot(dx, dy, dz) || 1e-3;
    const speed = Math.min(17, 3.2 + it.t * 0.55);
    const step = speed * DT;
    if (d <= step + 0.22 || it.t > 150) return true;
    // a curve that straightens as it closes in: swing sideways early
    const sw = (it.curve ?? 0) * Math.max(0, 1 - it.t / 22) * 0.6;
    const nx = dx / d, nz = dz / d;
    it.x += (nx - nz * sw) * step; it.z += (nz + nx * sw) * step; it.y += (dy / d) * step;
    if (vfx.pool) {
      const heart = it.kind === 'heart';
      vfx.pool.add(it.x, it.y + 0.05, it.z, 0, 0.2, 0, 0.2 + it.t * 0.002, heart ? 3 : 3, 1, heart ? RAMP_HEART() : RAMP_SHARD(), 0, 0.9, 0);
    }
    return false;
  }

  function glint(it, big = false) {
    if (!vfx.pool) return;
    const heart = it.kind === 'heart';
    const a = rng.next() * 6.28, r = 0.16;
    const s = vfx.pool.add(it.x + Math.sin(a) * r, it.y + 0.25 + rng.next() * 0.2, it.z + Math.cos(a) * r, 0, 0.5, 0, big ? 0.45 : 0.4, big ? 4 : 3, 0, heart ? RAMP_HEART() : RAMP_SHARD(), F_TWINKLE, 0.95, 0);
    void s;
  }

  function collect(it, h) {
    const heart = it.kind === 'heart';
    if (heart) {
      if (h.heal) h.heal(1); else h.hp = Math.min(h.maxHp, h.hp + 1);
      pk.stats.hearts++;
      boonSfx.heart();
      if (vfx.attached) {
        vfx.pickup({ x: h.x, y: 0.9, z: h.z, style: 'hurt' });
        vfx.flash({ x: h.x, y: 1.0, z: h.z, color: 'rose', radius: 1.8, ms: 200 });
        vfx.shockwave({ x: h.x, z: h.z, radius: 1.3, style: 'ring' });
      }
      look.flash(h.x, 1.0, h.z, { color: 'rose', ms: 240, intensity: 2.4, radius: 3.2 });
      events.emit('pickup:heart', { x: h.x, z: h.z, hp: h.hp });
      counter.heartT = 0;
    } else {
      ladder = tickN - lastCollect <= 30 ? ladder + 1 : 0;
      lastCollect = tickN;
      pk.add(1);
      pk.stats.shards++;
      boonSfx.shard(ladder);
      if (vfx.pool) {
        for (let i = 0; i < 4; i++) {
          const a = rng.next() * 6.28, sp = 1.2 + rng.next() * 1.2;
          vfx.pool.add(h.x, 0.75, h.z, Math.sin(a) * sp, 0.8 + rng.next(), Math.cos(a) * sp, 0.32, 3, 0, RAMP_SHARD(), 0, 0.9, 6);
        }
        if (ladder >= 4) vfx.pickup({ x: h.x, y: 0.9, z: h.z, style: 'magic' });
      }
      look.flash(h.x, 0.9, h.z, { color: 'sky', ms: 90, intensity: 0.9 + Math.min(1.4, ladder * 0.15), radius: 2 });
      events.emit('pickup:shard', { n: 1, total: pk.total, ladder, x: h.x, z: h.z });
    }
  }

  return pk;
}

/** HUD helper: shard glyph and count. The count pops when it changes; +N floats up. */
export function drawShardCounter(g, x, y, pk, { align = 'left' } = {}) {
  const c = pk.counter;
  const pop = c.pop < 6;
  const s = String(pk.total);
  const w = 9 + textWidth(s, pop ? 2 : 1);
  const x0 = align === 'right' ? x - w : x;
  drawGlyph(g, 'shard', x0, y + (pop ? -1 : 1));
  drawText(g, s, x0 + 9, y + (pop ? -3 : 0), pop ? 'white' : 'sky', { scale: pop ? 2 : 1, outline: 'ink' });
  if (c.addT < 40 && c.add) {
    const fy = y - 2 - Math.round(Math.min(1, c.addT / 30) * 10);
    drawText(g, (c.add > 0 ? '+' : '') + c.add, x0 + w + 4, fy, c.add > 0 ? 'cyan' : 'rose', { outline: 'ink' });
  }
}
