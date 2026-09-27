// The Warden's round arena (piece `boss`): a flagstone disc with a blood sigil, cell-lined walls
// on the far half, six braziers that light up on cue, the cage that rises in phase 3, and two
// layers that draw the fight's danger on the floor: `Zone` (telegraph cells, same red/gold
// language as enemies) and `Rings` (the shockwaves, which are also the hitbox).

import * as THREE from 'three';
import { defineModel, voxelMesh, VoxelGrid, VOXEL as V } from '../render/voxel/index.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/index.js';
import { buildBossModels } from './models.js';

export const ARENA_R = 6.0;          // hero and boss stay inside this radius
const FLOOR_R = 11.4;
const TAU = Math.PI * 2;
const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- models ---------------------------------------------------------------------------------------
let modelsBuilt = false;
function buildArenaModels() {
  if (modelsBuilt) return;
  modelsBuilt = true;
  buildBossModels();
  // floor disc
  {
    const N = Math.ceil(FLOOR_R / V) * 2 + 2, c = N / 2;
    const g = new VoxelGrid(N, 5, N);
    const stones = ['stoneDark', 'stone', 'stoneDark', 'dusk', 'stone', 'violet', 'stoneDark'];
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - c, dz = z + 0.5 - c, r = Math.hypot(dx, dz);
      if (r > FLOOR_R / V) continue;
      const ring = Math.floor(r / 9), a = Math.atan2(dz, dx), segs = 6 + ring * 5;
      const seg = Math.floor(((a + Math.PI) / TAU) * segs);
      const segEdge = Math.abs((((a + Math.PI) / TAU) * segs) % 1) * (r * TAU / segs);
      const ringEdge = r - ring * 9;
      let col = stones[Math.floor(hash(ring, seg, 3) * stones.length)];
      if (hash(x, z, 9) < 0.09) col = col === 'stoneDark' ? 'stone' : 'stoneDark';
      if (ringEdge < 1 || segEdge < 1 || (ringEdge > 8.2)) col = 'night';
      // the sigil: a double ring, eight spokes, a hub
      const inRing = (r0, r1) => r >= r0 && r <= r1;
      if (inRing(15, 16.5) || inRing(41, 42.5)) col = 'blood';
      else if (inRing(17.5, 18.4) || inRing(39.4, 40.3)) col = 'plum';
      const sp = Math.abs(Math.sin(a * 4));
      if (r > 19 && r < 39 && sp < 0.06 && Math.floor(r / 3) % 2 === 0) col = 'plum';
      if (r < 6) col = r < 2.5 ? 'red' : (r < 4.5 ? 'blood' : 'plum');
      if (r > 43.5 && r < 47) col = hash(seg, ring) < 0.5 ? 'stoneDark' : 'stone';
      if (r > 47 && r < 48.5) col = 'ink';
      if (r > 53) {                                                  // the apron beyond the pit rim: broken, dark slabs
        const q = Math.floor(r / 7), sg = Math.floor(((a + Math.PI) / TAU) * (q * 4));
        col = ['stoneDark', 'stone', 'stoneDark', 'night', 'dusk'][Math.floor(hash(q, sg, 5) * 5)];
        if (Math.abs(r - q * 7) < 0.9 || (((a + Math.PI) / TAU) * (q * 4) % 1) * r * TAU / (q * 4) < 0.9) col = 'ink';
        if (hash(x, z, 4) < 0.05) col = 'stoneDark';
      }
      if (r > FLOOR_R / V - 3) col = 'night';
      g.set(x, 2, z, col); g.set(x, 1, z, 'stoneDark'); g.set(x, 0, z, 'night');
      // the pit rim: a low lip of pale stone all the way round the fighting floor
      if (r >= 48.6 && r <= 52.4) { const lip = r < 50.4 ? 'stoneLight' : 'stone'; g.set(x, 3, z, lip); if (r > 49.3 && r < 51.7) g.set(x, 4, z, hash(x, z, 8) < 0.5 ? 'fog' : 'stoneLight'); }
    }
    // cracks
    for (let k = 0; k < 14; k++) {
      let x = c + Math.cos(k * 2.4) * (20 + hash(k, 1) * 26), z = c + Math.sin(k * 2.4) * (20 + hash(k, 2) * 26), a = hash(k, 3) * TAU;
      for (let i = 0; i < 12; i++) { g.set(Math.round(x), 2, Math.round(z), 'ink'); a += (hash(k, i) - 0.5) * 1.1; x += Math.cos(a); z += Math.sin(a); }
    }
    defineModel('boss.floor', { grid: g, origin: [c, 3, c] });
  }
  // wall sections: 16 wide, plain buttress or barred cell
  for (const H of [30, 22, 14]) for (const cell of [false, true]) {
    const g = new VoxelGrid(18, H, 8);
    for (let y = 0; y < H; y++) for (let z = 0; z < 8; z++) for (let x = 0; x < 18; x++) {
      const brick = ((y + (x >> 2 & 1)) % 4 === 0 || (x + (y >> 2 & 1) * 2) % 5 === 0);
      let c = brick ? 'stoneDark' : (hash(x, y, 4) < 0.2 ? 'stone' : hash(x, y) < 0.5 ? 'stone' : 'stoneLight');
      if (y > H - 3) c = y === H - 1 ? 'stoneLight' : 'stone';
      if (z < 6 && y > 1 && x > 0 && x < 17) c = 'stoneDark';        // back of the wall: dark, the front face is what shows
      if (z >= 6) g.set(x, y, z, c); else if (z >= 3) g.set(x, y, z, 'stoneDark');
    }
    for (let x = 0; x < 18; x++) for (let z = 3; z < 8; z++) g.set(x, 0, z, 'stone');
    if (cell && H >= 22) {
      // a barred cell: dark hollow, iron bars, bones and two eyes in the dark
      const x0 = 4, x1 = 13, y0 = 5, y1 = H - 8;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        g.set(x, y, 6, 'ink'); g.set(x, y, 7, (x - x0) % 3 === 0 || y === y0 || y === y1 ? 'stoneDark' : null);
        if (y === y0 || y === y1) g.set(x, y, 7, 'ink');
      }
      for (const x of [x0, x1]) for (let y = y0; y <= y1; y++) g.set(x, y, 7, 'mist');
      for (let x = x0 + 1; x < x1; x += 3) for (let y = y0 + 1; y < y1; y++) g.set(x, y, 7, 'mist');
      for (const [x, y] of [[6, y0 + 1], [7, y0 + 1], [10, y0 + 1], [8, y0 + 2]]) g.set(x, y, 6, 'bone');
      if (H >= 30) { g.set(7, y1 - 3, 6, 'ember', true); g.set(10, y1 - 3, 6, 'ember', true); }
    } else if (!cell) {
      for (const x of [0, 17]) for (let y = 0; y < H; y++) for (let z = 5; z < 8; z++) g.set(x, y, z, y % 6 === 0 ? 'stoneLight' : 'stone');
    }
    defineModel(`boss.wall.${H}${cell ? 'c' : 'p'}`, { grid: g, origin: [9, 0, 4] });
  }
}

// ---- the arena ---------------------------------------------------------------------------------------
export class BossArena {
  constructor(root, { lit = true } = {}) {
    buildArenaModels();
    this.root = root;
    this.g = new THREE.Group(); root.add(this.g);
    this.floor = voxelMesh('boss.floor'); this.g.add(this.floor);
    this.t = 0;
    // walls: sections round an ellipse (wide, so the sides of the screen are filled), far and side arcs only
    this.walls = [];
    const NW = 34, RX = 10.3, RZ = 7.5;
    for (let i = 0; i < NW; i++) {
      const a = (i + 0.5) / NW * TAU;
      const x = Math.cos(a) * RX, z = Math.sin(a) * RZ;
      if (z > 3.6) continue;
      const H = z < -3.4 ? 30 : z < 0 ? 22 : 14;
      const cell = (i % 2 === 0) && H >= 22;
      const m = voxelMesh(`boss.wall.${H}${cell ? 'c' : 'p'}`);
      m.position.set(x, 0, z);
      m.rotation.y = Math.atan2(-x / (RX * RX), -z / (RZ * RZ));
      this.g.add(m); this.walls.push(m);
    }
    // braziers: the arena lights up on cue. Each carries a real point light.
    this.braziers = [];
    const angles = [200, 240, 280, 320, 160, 20];
    angles.forEach((deg, i) => {
      const a = deg * Math.PI / 180, r = 5.55;
      const m = voxelMesh('boss.brazier');
      m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.g.add(m);
      const anchor = new THREE.Object3D(); anchor.position.copy(m.position); this.g.add(anchor);
      const light = look.lights ? look.torch(anchor, { y: 1.35, intensity: lit ? 1.15 : 0, radius: 7, color: 'flame', haze: 1 }) : null;
      // flame: a stack of cubes that flicker
      const flame = new THREE.InstancedMesh(new THREE.BoxGeometry(V, V, V), new THREE.MeshBasicMaterial({ color: 0xffffff }), 9);
      look.noOutline(flame); flame.frustumCulled = false;
      flame.position.set(m.position.x, 8 * V, m.position.z);
      this.g.add(flame);
      this.braziers.push({ m, anchor, light, flame, x: m.position.x, z: m.position.z, lit: lit ? 1 : 0, target: lit ? 1 : 0, delay: 0, i, pop: 0 });
    });
    // cage bars (built on demand)
    this.cage = null; this.cageK = 0; this.cageTarget = 0;
    // overhead dark: a ring of dim sconces would be nice, the look pool has 8 lights and braziers use 6
    this.shake = 0;
    this.golden = 0;                                       // 0..1: braziers turn from ember to gold (victory)
  }

  ignite(delayTicks = 0, gap = 8) {
    this.braziers.forEach((b, k) => { b.target = 1; b.delay = delayTicks + k * gap; });
  }
  douse() { for (const b of this.braziers) { b.target = 0; b.delay = 0; } }

  raiseCage() {
    if (this.cage) return;
    const bars = new THREE.Group(); this.g.add(bars);
    const n = 30;
    this.cage = { g: bars, bars: [], n };
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.05;
      const m = voxelMesh('boss.bar');
      const x = Math.cos(a) * (ARENA_R + 0.15), z = Math.sin(a) * (ARENA_R + 0.15);
      m.position.set(x, -3.8, z);
      // bars nearer the camera stand shorter so the view stays open
      const h = z > 3.5 ? 0.34 : z > 1 ? 0.6 : z > -1 ? 0.85 : 1;
      m.scale.y = h;
      bars.add(m);
      this.cage.bars.push({ m, a, x, z, h, d: (i % 6) * 3 + hash(i, 4) * 10 });
    }
    this.cageK = 0; this.cageTarget = 1; this.cageT = 0;
  }
  dropCage() { this.cageTarget = 0; this.cageT = 0; }

  tick() {
    this.t++;
    // braziers
    for (const b of this.braziers) {
      if (b.delay > 0) { b.delay--; if (b.delay === 0 && b.target > b.lit) this.flare(b); continue; }
      b.lit += (b.target - b.lit) * 0.06;
      if (b.pop > 0) b.pop--;
      if (b.light) b.light.intensity = (this.golden > 0 ? 1.5 : 1.15) * b.lit + b.pop * 0.05;
    }
    // cage
    if (this.cage) {
      this.cageT++;
      const up = this.cageTarget > 0;
      let done = true;
      for (const b of this.cage.bars) {
        const k = clamp((this.cageT - b.d) / 26, 0, 1);
        const e = up ? 1 - Math.pow(1 - k, 3) : 1 - k;
        const y = -3.8 * b.h + 3.8 * b.h * e + (up && k > 0.9 && k < 1 ? 0 : 0);
        if (k < 1) done = false;
        if (up && k > 0 && k < 1 && this.cageT % 3 === 0 && hash(b.a * 100, this.cageT) < 0.5) vfx.dust({ x: b.x, z: b.z, n: 2, size: 4, speed: 0.6 });
        if (up && b.landed !== true && k >= 1) { b.landed = true; vfx.dust({ x: b.x, z: b.z, n: 5, size: 5, speed: 0.9 }); vfx.hit({ x: b.x, y: 0.15, z: b.z, dx: 0, dz: 0, power: 0.45, style: 'gold' }); }
        b.m.position.y = -3.8 * b.h * (1 - e);
        b.m.visible = !(!up && k >= 1);
      }
      this.cageK = up ? 1 : 0;
      if (!up && done) { this.cage.g.parent?.remove(this.cage.g); this.cage = null; }
    }
  }
  flare(b) {
    b.pop = 30;
    vfx.embers({ x: b.x, y: 1.1, z: b.z, n: 16 });
    vfx.flash({ x: b.x, y: 1.3, z: b.z, color: 'flame', radius: 2.4, ms: 260 });
    vfx.hit({ x: b.x, y: 1.15, z: b.z, dx: 0, dz: 0, power: 0.7, style: 'ember' });
  }

  render(alpha) {
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const t = this.t;
    for (const b of this.braziers) {
      const k = b.lit;
      b.flame.visible = k > 0.05;
      if (!b.flame.visible) continue;
      // nine flickering cubes: base ember, body flame, tips gold
      const gold = this.golden;
      for (let i = 0; i < 9; i++) {
        const layer = i < 4 ? 0 : i < 7 ? 1 : 2;
        const ph = Math.floor(t / 5) + i * 7 + b.i * 13;
        const jx = ((hash(ph, i) - 0.5) * (layer + 1)) * V * 0.9, jz = ((hash(ph, i + 9) - 0.5) * (layer + 1)) * V * 0.9;
        const h = (layer * 2 + (i < 4 ? 0 : 1) + hash(ph, 5) * layer) * V * 0.9 * k;
        m4.makeScale(k, k, k); m4.setPosition(jx, h, jz);
        b.flame.setMatrixAt(i, m4);
        const c = layer === 0 ? (gold ? 'gold' : 'ember') : layer === 1 ? (gold ? 'torch' : 'flame') : (gold ? 'white' : 'gold');
        b.flame.setColorAt(i, col.setHex(hex(c)));
      }
      b.flame.instanceMatrix.needsUpdate = true; if (b.flame.instanceColor) b.flame.instanceColor.needsUpdate = true;
    }
  }
  dispose() {
    for (const b of this.braziers) b.light?.remove();
    this.root.remove(this.g);
  }
}

// ---- Zone: the telegraph painter ------------------------------------------------------------------------
// Flat voxel cells on the world voxel grid, rebuilt each tick from a list of shapes. The colours are
// the enemies' danger language: plum/blood checker fill, red edge and front, gold for the last frames
// (and stays gold while striking), white edge when it fires.
export class Zone {
  constructor(root, cap = 5200) {
    this.cap = cap;
    const geo = new THREE.BoxGeometry(V, 0.012, V);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), cap);
    this.mesh.frustumCulled = false; this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    look.noOutline(this.mesh);
    root.add(this.mesh); this.root = root;
    this.n = 0;
    this.shapes = [];
    this.m = new THREE.Matrix4();
    this.C = {}; for (const k of ['red', 'blood', 'plum', 'gold', 'white', 'ember', 'flame', 'torch']) this.C[k] = new THREE.Color(hex(k));
  }
  /** Queue a shape for this tick. fn(dx, dz, ...) is evaluated per cell in paint(). */
  add(shape) { this.shapes.push(shape); }
  clear() { this.shapes.length = 0; this.n = 0; this.mesh.count = 0; }

  /**
   * Shapes: { kind:'disc', x, z, R, p, firing, st }           fills outward as p goes 0..1
   *         { kind:'ring', x, z, r0, r1, p, firing, st, mark: angle|null, markW }   annulus; mark = the ball's angle
   *         { kind:'lane', x, z, dx, dz, len, w, p, firing, st, clip }               fills along its length
   *         { kind:'dots', x, z, R }                          a faint disc, the summon rune
   */
  paint() {
    const arr = this.mesh.instanceMatrix.array, carr = this.mesh.instanceColor.array;
    let n = 0;
    const put = (wx, wz, c, y = 0.014) => {
      if (n >= this.cap) return;
      const i = n * 16;
      arr[i] = 1; arr[i + 1] = 0; arr[i + 2] = 0; arr[i + 3] = 0; arr[i + 4] = 0; arr[i + 5] = 1; arr[i + 6] = 0; arr[i + 7] = 0;
      arr[i + 8] = 0; arr[i + 9] = 0; arr[i + 10] = 1; arr[i + 11] = 0; arr[i + 12] = wx; arr[i + 13] = y; arr[i + 14] = wz; arr[i + 15] = 1;
      carr[n * 3] = c.r; carr[n * 3 + 1] = c.g; carr[n * 3 + 2] = c.b;
      n++;
    };
    const C = this.C;
    for (const s of this.shapes) {
      const late = s.p > 0.78 && !s.firing;
      const blink = (s.st >> 1) & 1;
      const base = (ix, iz) => ((ix + iz) & 1 ? C.blood : C.plum);
      const edgeCol = s.firing ? C.white : late && blink ? C.gold : C.red;
      const fillCol = (ix, iz) => (s.firing ? C.gold : base(ix, iz));
      const R = s.kind === 'disc' ? s.R : s.kind === 'ring' ? s.r1 : s.kind === 'dots' ? s.R : Math.max(s.len, s.w);
      const cx = s.x, cz = s.z;
      const x0 = Math.floor((cx - R - V) / V), x1 = Math.ceil((cx + R + V) / V), z0 = Math.floor((cz - R - V) / V), z1 = Math.ceil((cz + R + V) / V);
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const wx = ix * V, wz = iz * V, dx = wx - cx, dz = wz - cz;
        if (s.kind === 'disc') {
          const d = Math.hypot(dx, dz);
          if (d > s.R) continue;
          const edge = d > s.R - V * 1.3;
          if (edge) put(wx, wz, edgeCol);
          else if (s.firing || d <= s.R * s.p) put(wx, wz, Math.abs(d - s.R * s.p) < V * 1.2 && !s.firing ? C.red : fillCol(ix, iz));
        } else if (s.kind === 'ring') {
          const d = Math.hypot(dx, dz);
          if (d > s.r1 || d < s.r0) continue;
          if (s.clipR && d > s.clipR) continue;
          const edge = d > s.r1 - V * 1.3 || d < s.r0 + V * 1.3;
          const a = Math.atan2(dx, dz);
          if (s.mark != null) {
            let da = a - s.mark; da = Math.atan2(Math.sin(da), Math.cos(da));
            if (Math.abs(da) < (s.markW ?? 0.16) * Math.min(1, 2.4 / d + 0.4)) { put(wx, wz, s.firing ? C.white : C.gold, 0.02); continue; }
          }
          if (edge) put(wx, wz, edgeCol);
          else if (s.firing) put(wx, wz, (ix + iz) & 1 ? C.blood : C.plum);
          else if (s.p * 1.2 * (s.r1 - s.r0) + s.r0 > d) put(wx, wz, fillCol(ix, iz));
        } else if (s.kind === 'lane') {
          const along = dx * s.dx + dz * s.dz, side = dx * s.dz - dz * s.dx;
          if (along < 0.2 || along > s.len || Math.abs(side) > s.w / 2) continue;
          if (s.clip != null && along > s.clip) continue;
          const edge = Math.abs(side) > s.w / 2 - V * 1.1 || along > Math.min(s.len, s.clip ?? 1e9) - V * 1.3;
          if (edge) put(wx, wz, edgeCol);
          else if (s.firing || along <= s.len * s.p) put(wx, wz, Math.abs(along - s.len * s.p) < V * 1.2 && !s.firing ? C.red : fillCol(ix, iz));
        } else if (s.kind === 'dots') {
          const d = Math.hypot(dx, dz);
          if (d > s.R || ((ix + iz * 3) % 4 !== 0 && d < s.R - V * 1.2)) continue;
          put(wx, wz, d > s.R - V * 1.3 ? C.red : C.plum);
        }
      }
    }
    this.n = n; this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = n > 0;
    this.shapes.length = 0;
  }
  dispose() { this.root.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// ---- Rings: the shockwaves. Bright low walls of light that race across the floor. ---------------------------
export class Rings {
  constructor(root, cap = 2600) {
    this.cap = cap; this.rings = [];
    const geo = new THREE.BoxGeometry(V, V, V);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), cap);
    this.mesh.frustumCulled = false; this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    look.noOutline(this.mesh);
    root.add(this.mesh); this.root = root;
    this.m = new THREE.Matrix4(); this.c = new THREE.Color();
    this.col = {}; for (const k of ['white', 'torch', 'gold', 'flame', 'ember', 'red', 'cyan', 'sky']) this.col[k] = new THREE.Color(hex(k));
    this.t = 0;
  }
  /** A ring from (x, z): r0 -> ARENA_R at speed u/s. Hits are resolved by the caller via band(). */
  spawn({ x, z, r0 = 0.5, speed = 3.6, w = 0.3, h = 3, dmg = 1, style = 'ember', max = ARENA_R + 1.2, onHit = null, tag = '' }) {
    const ring = { x, z, r: r0, speed, w, h, dmg, style, max, onHit, hit: false, t: 0, tag, prev: r0 };
    this.rings.push(ring);
    return ring;
  }
  tick(hero) {
    this.t++;
    for (const r of this.rings) {
      r.t++; r.prev = r.r;
      r.r += r.speed / 60;
      // decelerate a touch, like a wave losing weight
      if (r.r > r.max * 0.8) r.speed *= 0.985;
      if (hero && !r.hit && !hero.dead && r.onHit) {
        const d = Math.hypot(hero.x - r.x, hero.z - r.z);
        const lo = Math.min(r.prev, r.r) - r.w - 0.3, hi = Math.max(r.prev, r.r) + r.w * 0.4 + 0.3;
        if (d >= lo && d <= hi) { const res = r.onHit(r, d); if (res && (res.ok || res.reason === 'iframes')) r.hit = true; }
      }
    }
    this.rings = this.rings.filter((r) => r.r < r.max);
  }
  clear() { this.rings.length = 0; }
  get active() { return this.rings.length; }
  render(alpha) {
    const arr = this.mesh.instanceMatrix.array, carr = this.mesh.instanceColor.array;
    let n = 0;
    for (const r of this.rings) {
      const rad = r.r + r.speed / 60 * alpha;
      const cells = Math.max(8, Math.floor(rad * TAU / (V * 1.3)));
      const life = 1 - clamp((rad - 0.5) / (r.max - 0.5), 0, 1);
      for (let i = 0; i < cells; i++) {
        const a = (i / cells) * TAU;
        const wx = r.x + Math.sin(a) * rad, wz = r.z + Math.cos(a) * rad;
        if (Math.hypot(wx, wz) > ARENA_R + 0.9) continue;
        // three cubes deep: white crest, gold body, ember tail; height jitters along the wave
        const jit = hash(i, Math.floor(this.t / 3), 2);
        for (let k = 0; k < 3; k++) {
          if (n >= this.cap) break;
          const back = k * V * 1.05;
          const rr = rad - back;
          const hh = (r.h * (k === 0 ? 1 : k === 1 ? 0.75 : 0.45)) * (0.6 + 0.6 * jit) * (0.5 + 0.5 * life);
          const s = 1;
          const i16 = n * 16;
          arr[i16] = s; arr[i16 + 1] = 0; arr[i16 + 2] = 0; arr[i16 + 3] = 0; arr[i16 + 4] = 0; arr[i16 + 5] = hh; arr[i16 + 6] = 0; arr[i16 + 7] = 0;
          arr[i16 + 8] = 0; arr[i16 + 9] = 0; arr[i16 + 10] = s; arr[i16 + 11] = 0;
          arr[i16 + 12] = r.x + Math.sin(a) * rr; arr[i16 + 13] = V * 0.5 * hh; arr[i16 + 14] = r.z + Math.cos(a) * rr; arr[i16 + 15] = 1;
          const pal = r.style === 'cyan' ? ['white', 'sky', 'cyan'] : r.style === 'gold' ? ['white', 'torch', 'gold'] : ['white', 'gold', 'ember'];
          const c = this.col[pal[k]];
          carr[n * 3] = c.r; carr[n * 3 + 1] = c.g; carr[n * 3 + 2] = c.b;
          n++;
        }
      }
    }
    this.mesh.count = n; this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  dispose() { this.root.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
