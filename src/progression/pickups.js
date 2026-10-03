// Pickups (piece `boons`): soul shards (the run's currency) and hearts.
//
// A pickup pops out of whatever dropped it in an arc, bounces twice with a tink and a puff,
// then rests bobbing and twinkling. Once it has settled, it vacuums toward the hero when the
// hero comes within the magnet radius (or the whole room is told to `vacuum()`, e.g. on a
// clear). It accelerates in on a curve, trailing sparks, and is collected with a flare at the
// hero's chest. Shards collected close together climb a pentatonic sound ladder.
// Hearts only fly to a hero who is missing health; at full health they sit and wait.
//
//   const pk = createPickups(root, { hero: () => world.hero, collision: () => getCollision() });
//   pk.drop('shard' | 'heart', x, z, n = 1, { y, speed })
//   pk.vacuum()            every settled pickup flies to the hero (room clear)
//   pk.tick(); pk.render(alpha); pk.ui(g); pk.dispose();
//   pk.list  pk.info()  pk.magnet (multiplier, boons set it)
//
// Events: 'pickup:shard' {x, z, total, step}, 'pickup:heart' {x, z, hp, healed}, 'pickup:drop' {kind, n}

import * as THREE from 'three';
import { DT, loop } from '../core/loop.js';
import { events } from '../core/events.js';
import { display } from '../core/display.js';
import { drawText } from '../core/pixelfont.js';
import { defineModel, voxelMesh, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { progress } from './boons.js';
import { boonSfx } from './sfx.js';

const { add, addShape, P, S, STAR, RING, DISC, SPRITE, STREAK, FACING, FLOOR, ramp } = vfx.core;

ramp('shardTrail', [['white', 0.15], ['sky', 0.5], ['cyan', 0.8], ['teal', 1]]);
ramp('heartTrail', [['white', 0.15], ['rose', 0.5], ['red', 1]]);

let built = false;
function buildModels() {
  if (built) return;
  built = true;
  // soul shard: a little octahedral crystal, 3 x 6 x 3 half-size voxels, glowing
  {
    const g = new VoxelGrid(3, 6, 3);
    g.set(1, 0, 1, 'teal', true);
    for (const [x, z] of [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]) g.set(x, 1, z, x === 0 ? 'cyan' : 'teal', true);
    for (let y = 2; y <= 3; y++) for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
      const edge = (x !== 1) + (z !== 1);
      if (edge === 2) continue;
      g.set(x, y, z, x === 0 ? 'sky' : z === 2 ? 'cyan' : 'teal', true);
    }
    for (const [x, z] of [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]) g.set(x, 4, z, x === 0 || z === 2 ? 'sky' : 'cyan', true);
    g.set(0, 3, 1, 'white', true);
    g.set(1, 5, 1, 'white', true);
    defineModel('boons.shard', { grid: g, scale: VOXEL / 2 });
  }
  // heart: 7 wide, 6 tall, 2 deep, standing up facing the camera
  {
    const rows = [
      '.##.##.',
      '#w#####',
      '#w#####',
      '.#####.',
      '..###..',
      '...#...',
    ];
    const g = new VoxelGrid(7, 6, 2);
    rows.forEach((row, i) => {
      const y = 5 - i;
      for (let x = 0; x < 7; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        for (let z = 0; z < 2; z++) {
          let c = ch === 'w' ? (z === 1 ? 'white' : 'rose') : 'red';
          if (ch === '#' && (x === 6 || y === 0 || (y === 1 && x >= 4))) c = 'blood';
          if (ch === '#' && z === 0) c = c === 'red' ? 'blood' : c;
          g.set(x, y, z, c, c !== 'blood');
        }
      }
    });
    g.set(2, 4, 1, 'rose', true);
    defineModel('boons.heart', { grid: g, scale: VOXEL / 2 });
  }
}

const KIND = {
  shard: { model: 'boons.shard', restY: 0.1, bob: 0.04, settle: 22, magnet: 2.1, trail: 'shardTrail', star: 'sky', value: 1 },
  heart: { model: 'boons.heart', restY: 0.1, bob: 0.05, settle: 30, magnet: 2.4, trail: 'heartTrail', star: 'rose', value: 1 },
};

export function createPickups(root, { hero = () => null, collision = () => null } = {}) {
  buildModels();
  const group = new THREE.Group();
  group.name = 'pickups';
  root.add(group);
  const list = [];
  const pool = { shard: [], heart: [] };
  const floaters = [];          // "+1" texts, 2D
  let ladder = 0, lastShardTick = -999;
  let seed = 0x51ed;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const v3 = new THREE.Vector3();
  let vacuumAll = false;
  let bank = { shown: progress.shards, pop: 0 };

  function meshFor(kind) {
    const m = pool[kind].pop() ?? voxelMesh(KIND[kind].model, { ownMaterial: true });
    m.visible = true;
    m.scale.setScalar(1);
    group.add(m);
    return m;
  }

  function drop(kind, x, z, n = 1, { y = 0.6, speed = 1 } = {}) {
    if (!KIND[kind]) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = (1.2 + rnd() * 2.2) * speed * (n > 1 ? 1 : 0.6);
      const p = {
        kind, x, y, z, px: x, py: y, pz: z,
        vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, vy: 4 + rnd() * 3.2,
        t: 0, state: 'pop', bounces: 0, spin: rnd() * 6, spinV: 0.25 + rnd() * 0.2,
        ph: rnd() * 100, pull: 0, swirl: (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 2), mesh: meshFor(kind),
        delay: Math.floor(i * 1.5),
      };
      list.push(p);
      out.push(p);
    }
    events.emit('pickup:drop', { kind, n, x, z });
    return out;
  }

  function collect(p) {
    const h = hero();
    const K = KIND[p.kind];
    p.state = 'got';
    const hx = h?.x ?? p.x, hz = h?.z ?? p.z;
    addShape(STAR, FACING, hx, 0.75, hz, 0.12, K.star, 'white', 0.26, 0.3);
    if (p.kind === 'shard') {
      ladder = loop.tick - lastShardTick <= 24 ? Math.min(14, ladder + 1) : 0;
      lastShardTick = loop.tick;
      progress.shards += K.value; progress.shardsTotal += K.value;
      bank.pop = 6;
      boonSfx.shard(ladder);
      for (let k = 0; k < 4; k++) {
        const a = rnd() * Math.PI * 2;
        const i = add(hx, 0.75, hz, Math.sin(a) * 2.2, 1 + rnd() * 2, Math.cos(a) * 2.2, 0.25, 1, 'shardTrail', SPRITE);
        if (i >= 0) { P.drag[i] = 0.85; P.pop[i] = 1; }
      }
      events.emit('pickup:shard', { x: hx, z: hz, total: progress.shards, step: ladder });
    } else {
      const healed = h && h.hp < h.maxHp && !h.dead;
      if (healed) h.heal?.(1);
      progress.hearts++;
      boonSfx.heart();
      vfx.heal(hx, 0.5, hz, { n: 14 });
      addShape(RING, FLOOR, hx, 0.03, hz, 0.3, 'rose', 'white', 0.2, 0.9, 0.4, 1);
      floaters.push({ x: hx, y: 1.6, z: hz, t: 0, text: healed ? '+1' : 'FULL', color: 'rose' });
      events.emit('pickup:heart', { x: hx, z: hz, hp: h?.hp, healed });
    }
    p.mesh.visible = false;
    group.remove(p.mesh);
    pool[p.kind].push(p.mesh);
  }

  return {
    list, magnet: 1,
    drop,
    vacuum() { vacuumAll = true; },
    stopVacuum() { vacuumAll = false; },
    tick() {
      const h = hero();
      const cw = collision();
      const heroOk = h && !h.dead;
      for (const p of list) {
        p.px = p.x; p.py = p.y; p.pz = p.z;
        if (p.delay > 0) { p.delay--; continue; }
        p.t++;
        const K = KIND[p.kind];
        if (p.state === 'pop') {
          p.vy -= 22 * DT;
          const body = { x: p.x, z: p.z, r: 0.12 };
          if (cw) { const res = cw.move(body, p.vx * DT, p.vz * DT); if (res.hit) { p.vx *= -0.4; p.vz *= -0.4; } p.x = body.x; p.z = body.z; }
          else { p.x += p.vx * DT; p.z += p.vz * DT; }
          p.y += p.vy * DT;
          if (p.y <= K.restY && p.vy < 0) {
            p.y = K.restY;
            p.bounces++;
            vfx.dust(p.x, p.z, { n: 2, size: 0.45 });
            if (p.bounces < 3 && -p.vy > 1.6) { p.vy = -p.vy * 0.42; p.vx *= 0.55; p.vz *= 0.55; p.squash = 4; }
            else { p.state = 'rest'; p.vx = p.vz = p.vy = 0; p.squash = 4; }
          }
        } else if (p.state === 'rest') {
          p.y = K.restY + K.bob + Math.sin((p.t + p.ph) * 0.09) * K.bob;
          if ((p.t + Math.floor(p.ph)) % 97 === 0) vfx.twinkle(p.x + 0.05, p.y + 0.3, p.z, { color: p.kind === 'heart' ? 'rose' : 'sky', size: 0.7 });
        }
        if (p.squash > 0) p.squash--;
        p.spin += p.spinV * (p.state === 'pull' ? 3 : 1) * 0.25;
        // magnet
        if (heroOk && p.state !== 'got' && p.t >= K.settle) {
          const dx = h.x - p.x, dz = h.z - p.z;
          const d = Math.hypot(dx, dz);
          const wantHeal = p.kind !== 'heart' || h.hp < h.maxHp;
          const R = K.magnet * this.magnet;
          if (p.state !== 'pull' && wantHeal && (d < R || (vacuumAll && p.state === 'rest'))) {
            p.state = 'pull'; p.pull = vacuumAll && d >= R ? 3 : 1.5;
            // a little hop as it is grabbed
            p.vy = 2.6;
          }
          if (p.state === 'pull') {
            p.pull = Math.min(18, p.pull + 0.75);
            const ux = dx / (d || 1), uz = dz / (d || 1);
            // swirl: a sideways component that dies away as it closes in
            const sw = p.swirl * Math.min(1, d / 2) * 0.6;
            p.vx = ux * p.pull - uz * sw; p.vz = uz * p.pull + ux * sw;
            p.x += p.vx * DT; p.z += p.vz * DT;
            p.vy -= 10 * DT;
            p.y = Math.max(0.15, Math.min(1.1, p.y + p.vy * DT + (0.6 - p.y) * 0.08));
            if (p.t % 2 === 0) {
              const i = add(p.px, p.py + 0.15, p.pz, 0, 0, 0, 0.18, p.kind === 'heart' ? 2 : 1, K.trail, SPRITE);
              if (i >= 0) { P.pop[i] = 1; P.fadeAt[i] = 0.3; }
            }
            if (d < 0.32 + p.pull * DT) collect(p);
          }
        }
      }
      for (let i = list.length - 1; i >= 0; i--) if (list[i].state === 'got') list.splice(i, 1);
      if (vacuumAll && !list.length) vacuumAll = false;
      for (const f of floaters) f.t++;
      for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].t > 50) floaters.splice(i, 1);
      if (bank.pop > 0) bank.pop--;
    },
    render(alpha) {
      for (const p of list) {
        const m = p.mesh;
        if (p.delay > 0) { m.visible = false; continue; }
        m.visible = true;
        v3.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
        look.snap(v3);
        m.position.copy(v3);
        // pop in from small, squash on landings, a heartbeat on hearts
        const grow = Math.min(1, 0.35 + p.t * 0.16);
        let sx = grow, sy = grow;
        if (p.squash > 0) { sx *= 1.25; sy *= 0.7; }
        if (p.kind === 'heart' && p.state === 'rest') { const b = (p.t + Math.floor(p.ph)) % 50; if (b < 4 || (b >= 8 && b < 11)) { sx *= 1.18; sy *= 1.18; } }
        m.scale.set(sx, sy, sx);
        m.rotation.y = p.kind === 'shard' ? Math.round(p.spin * 4) / 4 : Math.sin(p.spin) * 0.35;
        const fl = m.material.userData.flash;
        fl.value = p.t < 3 ? 0.9 : p.state === 'pull' && p.t % 6 < 2 ? 0.45 : 0;
      }
    },
    /** Floating "+1" texts from hearts. The shard counter itself is drawn by the progression HUD. */
    ui(g) {
      for (const f of floaters) {
        const s = display.worldToScreen(f.x, f.y, f.z);
        const rise = f.t < 6 ? f.t * 2.5 : 15 + (f.t - 6) * 0.3;
        if (f.t > 38 && f.t % 4 < 2) continue;
        drawText(g, f.text, s.x, Math.round(s.y - rise), f.t < 2 ? 'white' : f.color, { align: 'center', scale: display.zoom >= 2 ? 2 : 1, outline: 'ink' });
      }
    },
    get bankPop() { return bank.pop; },
    info() {
      const c = { shard: 0, heart: 0 };
      for (const p of list) c[p.kind]++;
      return { onFloor: c, pulling: list.filter((p) => p.state === 'pull').length, ladder, magnet: this.magnet, vacuum: vacuumAll, shards: progress.shards };
    },
    clear() { for (const p of list) { p.mesh.visible = false; group.remove(p.mesh); pool[p.kind].push(p.mesh); } list.length = 0; },
    dispose() { root.remove(group); list.length = 0; },
  };
}
