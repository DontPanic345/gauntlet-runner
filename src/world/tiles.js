// Arena voxel tiles (piece `arenas`): the floor slab, the back wall with its two arches, the
// side walls, the two doors (portcullis gate and sealed stone slab), rune overlays, flame
// frames and the trail tiles that light up when a room is cleared.
//
// Everything is authored in code with the seeded Rng, so the same template and seed always
// build the same stones. Models are registered under `arena.*` names and meshed on first use.
//
// Units: 1 world unit = 8 voxels. Arena-local coordinates are in world units with the origin
// at the centre of the floor: the back wall's front face is at z = -D/2, the open front edge
// at z = +D/2 (the camera sits on that side and looks in).

import { defineModel, VoxelGrid } from '../render/voxel/index.js';
import { Rng } from '../core/rng.js';

export const MB = 12;        // voxels of floor behind the back wall's face (the door alcoves stand on it)
export const SW = 16;        // side wall thickness, voxels (2 units)
export const WALL_H = 28;    // back wall height, voxels
export const SIDE_H = 15;    // side wall height, voxels
export const ARCH = { hw: 10, h: 20, depth: 11 };   // half width, height, alcove depth (voxels)
export const FRONT_LIP = 8;  // floor voxels past the front edge (ragged, drops into the pit)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- floor ------------------------------------------------------------------------------------

/** Where an arena-local point lands in the floor grid. */
export function floorDims(W, D) {
  const FX = W * 8 + 8, FZ = MB + D * 8 + FRONT_LIP;
  return { FX, FZ, ox: FX / 2, oz: MB + D * 4 };
}

/**
 * Paint a floor. theme: { slabs: [[colour, weight]...], grout, pattern: 'flags'|'checker'|'large',
 * moss: 0..1, cracks: n, pebbles: n, blood: [{x, z, r}], inlay: [...], rug: {...}, pads: [[x, z]...],
 * mats: [{x, z}] (door thresholds), holes: [{x, z, rx, rz}], accent }
 */
export function buildFloor(name, W, D, seed, theme = {}) {
  const { FX, FZ, ox, oz } = floorDims(W, D);
  const g = new VoxelGrid(FX, 6, FZ);
  const r = new Rng(`arena.floor/${seed}`);
  const phase = r.range(0, 6.28);
  const T = {
    slabs: [['stone', 5], ['stoneLight', 4], ['slate', 1.2], ['dusk', 1.4], ['stoneDark', 0.6]],
    grout: 'stoneDark', pattern: 'flags', moss: 0.5, cracks: 12, pebbles: 26, blood: [], inlay: [], rug: null, pads: [], mats: [], holes: [],
    ...theme,
  };
  const wx = (i) => (i + 0.5 - ox) / 8, wz = (k) => (k + 0.5 - oz) / 8;   // voxel -> arena units
  g.box(0, 0, 0, FX - 1, 2, FZ - 1, T.grout);

  // slabs on layer 3 (its top is the walking surface, y = 0)
  const shadeAt = new Map();
  const slabShade = (key) => {
    if (!shadeAt.has(key)) shadeAt.set(key, r.weighted(T.slabs));
    return shadeAt.get(key);
  };
  const paintSlab = (x0, z0, x1, z1, base) => {
    const sunk = r.chance(0.07);
    const y = sunk ? 2 : 3;
    for (let z = z0 + 1; z <= z1; z++) for (let x = Math.max(0, x0 + 1); x <= Math.min(FX - 1, x1); x++) {
      if (z < 0 || z >= FZ) continue;
      let c = base;
      const f = r.next();
      if (f < 0.03) c = 'stoneLight'; else if (f < 0.055) c = 'stoneDark';
      const cx = x === x0 + 1 || x === x1, cz = z === z0 + 1 || z === z1;
      if (cx && cz && r.chance(0.6)) continue;
      if ((cx || cz) && r.chance(0.03)) continue;
      if (z === z1 && c === base && base !== 'stoneLight' && r.chance(0.3)) c = base === 'dusk' ? 'stone' : 'stoneLight';
      g.set(x, y, z, c);
      if (sunk) g.set(x, 3, z, null);
    }
  };
  if (T.pattern === 'checker') {
    const s = 16;
    for (let z0 = -8, zi = 0; z0 < FZ; z0 += s, zi++) for (let x0 = -8, xi = 0; x0 < FX; x0 += s, xi++) {
      paintSlab(x0, z0, x0 + s - 1, z0 + s - 1, (xi + zi) % 2 ? (r.chance(0.15) ? 'dusk' : 'stoneLight') : (r.chance(0.15) ? 'stoneLight' : 'dusk'));
    }
  } else if (T.pattern === 'large') {
    for (let z0 = 0, zi = 0; z0 < FZ; z0 += 24, zi++) {
      let x0 = -(zi % 2) * 12;
      while (x0 < FX) { const sw = r.pick([24, 24, 20, 28]); paintSlab(x0, z0, x0 + sw - 1, z0 + 23, slabShade(`${zi}:${x0}`)); x0 += sw; }
    }
  } else {
    for (let z0 = 0; z0 < FZ; z0 += 16) {
      let x0 = -r.int(0, 12);
      while (x0 < FX) { const sw = r.pick([12, 16, 16, 20, 14]); paintSlab(x0, z0, x0 + sw - 1, z0 + 15, slabShade(`${z0}:${x0}`)); x0 += sw; }
    }
  }

  // every voxel by arena coordinates from here on
  const top = (x, z) => g.get(x, 3, z) || g.get(x, 2, z) === 0;
  const eachCell = (fn) => { for (let k = 0; k < FZ; k++) for (let i = 0; i < FX; i++) fn(i, k, wx(i), wz(k)); };

  // door thresholds: a worn, paler mat in front of each arch with a gold line
  for (const m of T.mats) {
    eachCell((i, k, x, z) => {
      if (Math.abs(x - m.x) < 1.55 && z > -D / 2 - 1.5 && z < -D / 2 + 1.0) {
        if (!g.get(i, 3, k)) return;
        const edge = z > -D / 2 + 0.85;
        g.set(i, 3, k, edge ? 'stoneLight' : (Math.floor((x - m.x) * 8) % 4 === 0 ? 'stone' : 'stoneLight'));
        if (Math.abs(x - m.x) > 1.45) g.set(i, 3, k, 'stoneDark');
      }
    });
  }

  // inlays: rings, lines, squares and the rug
  for (const s of T.inlay) {
    eachCell((i, k, x, z) => {
      if (!g.get(i, 3, k)) return;
      const d = Math.hypot(x - s.x, (z - s.z));
      if (s.type === 'ring') {
        const wd = (s.w ?? 1.5) / 8;
        if (Math.abs(d - s.r) < wd) {
          const a = Math.atan2(z - s.z, x - s.x), n = s.notches ?? 8;
          const notch = Math.abs(((a / (Math.PI * 2 / n)) % 1 + 1) % 1 - 0.5) > 0.44;
          g.set(i, 3, k, notch ? (s.notchColor ?? 'stoneLight') : (s.color ?? 'slate'));
        }
        if (s.dash && Math.abs(d - s.r * s.dash) < 0.6 / 8) {
          const a = Math.atan2(z - s.z, x - s.x);
          if (Math.floor(a / (Math.PI / 12)) % 2 === 0) g.set(i, 3, k, s.color2 ?? 'violet');
        }
      } else if (s.type === 'line') {
        const dx = s.x1 - s.x0, dz = s.z1 - s.z0, L2 = dx * dx + dz * dz;
        const t = clamp(((x - s.x0) * dx + (z - s.z0) * dz) / L2, 0, 1);
        const px = s.x0 + dx * t, pz = s.z0 + dz * t;
        if (Math.hypot(x - px, z - pz) < (s.w ?? 1) / 8) g.set(i, 3, k, s.color ?? 'slate');
      } else if (s.type === 'square') {
        const dx = Math.abs(x - s.x), dz = Math.abs(z - s.z), h = s.s / 2, w = (s.w ?? 1.5) / 8;
        if (Math.max(dx, dz) < h && Math.max(dx, dz) > h - w) g.set(i, 3, k, s.color ?? 'slate');
      } else if (s.type === 'disc') {
        if (d < s.r) g.set(i, 3, k, s.color ?? 'violet');
      } else if (s.type === 'star') {
        // 8-point star of thin rays
        const a = Math.atan2(z - s.z, x - s.x);
        const ray = Math.abs(Math.sin(a * 4));
        if (d < s.r && d > 0.15 && ray < 0.1 + 0.35 * (1 - d / s.r) * 0.3) g.set(i, 3, k, s.color ?? 'slate');
      }
    });
  }
  if (T.rug) {
    const R = T.rug;
    eachCell((i, k, x, z) => {
      const dx = Math.abs(x - R.x), dz = Math.abs(z - R.z);
      if (dx > R.w / 2 || dz > R.d / 2) return;
      if (!g.get(i, 3, k) && !g.get(i, 2, k)) return;
      const ex = R.w / 2 - dx, ez = R.d / 2 - dz, e = Math.min(ex, ez) * 8;
      let c = R.field ?? 'plum';
      if (e < 1) c = R.edge ?? 'blood';
      else if (e < 2) c = R.trim ?? 'gold';
      else if (e < 4) c = R.edge ?? 'blood';
      else {
        // lozenge field
        const u = Math.floor((x - R.x) * 8), v = Math.floor((z - R.z) * 8);
        const lx = ((u % 8) + 8) % 8, lz = ((v % 8) + 8) % 8;
        if (Math.abs(lx - 3.5) + Math.abs(lz - 3.5) < 2.2) c = R.motif ?? 'blood';
        if (Math.abs(lx - 3.5) + Math.abs(lz - 3.5) < 0.9) c = R.core ?? 'rose';
      }
      // threadbare: a few holes and dark stains
      if (r.chance(0.012)) c = R.field ?? 'plum';
      if (e > 4 && r.chance(0.02)) return;
      g.set(i, 4, k, c);
      // fringe at the short ends
      if (ez * 8 < 1 && r.chance(0.5)) g.set(i, 4, k, null);
    });
  }
  // spawn pads: a faint rune ring the portals will open on
  for (const [px, pz] of T.pads) {
    eachCell((i, k, x, z) => {
      const d = Math.hypot(x - px, z - pz) * 8;
      if (!g.get(i, 3, k) && !g.get(i, 4, k)) return;
      const y = g.get(i, 4, k) ? 4 : 3;
      if (d > 5.2 && d < 6.4) g.set(i, y, k, 'violet');
      const a = Math.atan2(z - pz, x - px);
      if (d > 4.2 && d <= 5.2 && Math.abs(Math.sin(a * 2)) > 0.985) g.set(i, y, k, 'slate');
      if (d < 1.2) g.set(i, y, k, 'slate');
    });
  }
  // blood
  for (const b of T.blood) {
    const n = Math.round(b.r * b.r * 30);
    for (let q = 0; q < n; q++) {
      const a = r.range(0, 6.283), d = Math.sqrt(r.next()) * b.r;
      const i = Math.round(ox + (b.x + Math.cos(a) * d * 1.3) * 8), k = Math.round(oz + (b.z + Math.sin(a) * d) * 8);
      const y = g.get(i, 4, k) ? 4 : 3;
      if (g.get(i, y, k)) g.set(i, y, k, d < b.r * 0.4 ? 'blood' : r.chance(0.5) ? 'blood' : 'plum');
    }
  }
  // cracks: short random walks cutting the top layer
  for (let q = 0; q < T.cracks; q++) {
    let x = r.int(6, FX - 7), z = r.int(MB + 2, FZ - FRONT_LIP - 3);
    const n = r.int(5, 13);
    for (let s = 0; s < n; s++) {
      if (!g.get(x, 4, z)) { g.set(x, 3, z, null); if (r.chance(0.3)) g.set(x, 2, z, 'ink'); }
      if (r.chance(0.5)) x += r.pick([-1, 1]); else z += r.pick([-1, 1]);
    }
  }
  // holes: a jagged chasm that shows the pit below
  for (const h of T.holes) {
    eachCell((i, k, x, z) => {
      const nx = (x - h.x) / h.rx, nz = (z - h.z) / h.rz;
      const jag = 1 + (Math.sin(i * 1.7 + k * 0.9) * 0.08 + Math.sin(i * 0.63 - k * 1.3) * 0.08);
      const d = Math.hypot(nx, nz) * jag;
      if (d < 1) { for (let y = 0; y < 6; y++) g.set(i, y, k, null); }
      else if (d < 1.12 && g.get(i, 3, k)) { g.set(i, 3, k, null); if (d < 1.06) g.set(i, 2, k, r.chance(0.5) ? 'stoneDark' : null); }
      else if (d < 1.22 && g.get(i, 3, k) && r.chance(0.5)) g.set(i, 3, k, r.chance(0.5) ? 'stoneLight' : 'stoneDark');
    });
  }
  // moss creeping out of the grout, denser near walls and the sides
  const patches = [];
  const np = Math.round(4 + T.moss * 10);
  for (let q = 0; q < np; q++) patches.push([r.pick([r.int(4, 30), r.int(FX - 30, FX - 4), r.int(10, FX - 10)]), r.int(MB, MB + 30), r.range(4, 10) * (0.6 + T.moss)]);
  for (let q = 0; q < Math.round(T.moss * 5); q++) patches.push([r.int(6, FX - 6), r.int(MB + 10, FZ - FRONT_LIP - 6), r.range(3, 6)]);
  for (let k = 0; k < FZ; k++) for (let i = 0; i < FX; i++) {
    let m = 0;
    for (const [px, pz, pr] of patches) m = Math.max(m, 1 - Math.hypot(i - px, (k - pz) * 1.4) / pr);
    if (m <= 0) continue;
    const y = g.get(i, 4, k) ? 4 : 3;
    if (y === 4) continue;   // never on the rug
    if (!g.get(i, 3, k) && g.get(i, 2, k) && r.next() < m * 1.6) g.set(i, 3, k, r.chance(0.3) ? 'leaf' : 'moss');
    else if (g.get(i, 3, k) && r.next() < m * m * 0.5 * (0.4 + T.moss)) g.set(i, 3, k, r.chance(0.2) ? 'leaf' : 'moss');
  }
  // pebbles and chips lying on the stones: a raised voxel here and there catches the light
  for (let q = 0; q < T.pebbles; q++) {
    const i = r.int(4, FX - 5), k = r.int(MB + 2, FZ - FRONT_LIP - 3);
    if (g.get(i, 3, k) && !g.get(i, 4, k)) {
      const c = r.pick(['stoneLight', 'stone', 'fog', 'stoneDark']);
      g.set(i, 4, k, c);
      if (r.chance(0.45)) g.set(i + r.pick([-1, 1]), 4, k, c);
    }
  }
  // the open front: the floor breaks off in a ragged line
  for (let i = 0; i < FX; i++) {
    const bite = Math.round(3 + Math.sin(i * 0.21 + phase) * 2 + Math.sin(i * 0.53 + 1) * 1.5 + r.next() * 2.4);
    for (let k = FZ - bite; k < FZ; k++) {
      for (let y = 4; y < 6; y++) g.set(i, y, k, null);
      g.set(i, 3, k, null);
      if (k > FZ - bite + 2) g.set(i, 2, k, null);
      if (k > FZ - bite + 3) { g.set(i, 1, k, null); g.set(i, 0, k, null); }
    }
    if (r.chance(0.3)) g.set(i, 2, FZ - bite, 'stoneLight');
  }
  defineModel(name, { grid: g, origin: [ox, 4, oz] });
  return { name, FX, FZ };
}

// ---- back wall ---------------------------------------------------------------------------------

/**
 * The back wall with its arches. doors: arena-local x of each archway. theme: { style:
 * 'brick'|'ossuary'|'ruin'|'carved', brick: [...colours], pilasters: [x...], breach: {x, w} }.
 */
export function buildBackWall(name, W, doors, seed, theme = {}) {
  const WW = W * 8 + 2 * SW;
  const front = 11, protr = 6;
  const H = WALL_H;
  const g = new VoxelGrid(WW, H + 8, front + 1 + protr);
  const r = new Rng(`arena.wall/${seed}`);
  const phase = r.range(0, 6.28);
  const T = { style: 'brick', brick: ['dusk', 'stone', 'dusk', 'violet', 'stone', 'stoneDark', 'dusk'], pilasters: [], moss: 0.5, ...theme };
  const cx = WW / 2;
  const doorX = doors.map((d) => Math.round(cx + d * 8));
  const top = [];
  for (let x = 0; x < WW; x++) top.push(H - 2 + Math.round(Math.sin(x * 0.09 + phase) * 1.5 + Math.sin(x * 0.31) * 1 + r.next() * 1.2));
  if (T.style === 'ruin' && T.breach) {
    const bx = Math.round(cx + T.breach.x * 8), bw = Math.round(T.breach.w * 8 / 2);
    for (let x = bx - bw - 6; x <= bx + bw + 6; x++) if (x >= 0 && x < WW) {
      const d = Math.abs(x - bx);
      top[x] = Math.min(top[x], Math.round(12 + Math.max(0, d - bw) * 2.2 + r.next() * 3));
    }
  }
  for (let x = 0; x < WW; x++) for (let y = 0; y < top[x]; y++) {
    g.box(x, y, 0, x, y, front - 1, 'stoneDark');
    const course = Math.floor(y / 4);
    const off = course % 2 ? 4 : 0;
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    if (mortar) continue;
    const bi = Math.floor((x + off) / 8) * 31 + course * 17;
    let c = T.brick[Math.abs(bi * 7919) % T.brick.length];
    if (r.chance(0.05)) c = 'stoneLight';
    if (y === 0) c = 'stoneDark';
    g.set(x, y, front, c);
  }
  // capstones
  for (let x = 0; x < WW; x++) {
    const y = top[x];
    g.box(x, y, 0, x, y, front, r.chance(0.8) ? 'stoneLight' : 'stone');
    if (r.chance(0.15)) g.set(x, y + 1, r.int(0, front), 'stone');
  }
  // cracks and knocked-out bricks
  for (let q = 0; q < 7; q++) {
    let x = r.int(4, WW - 5), y = r.int(6, H - 4);
    const n = r.int(6, 14);
    for (let s = 0; s < n; s++) { g.set(x, y, front, 'ink'); g.set(x, y, front - 1, 'ink'); if (r.chance(0.55)) y += r.pick([-1, -1, 1]); else x += r.pick([-1, 1]); }
  }
  for (let q = 0; q < 6; q++) {
    const x = r.int(4, WW - 12), y = r.int(3, H - 6) & ~3;
    g.box(x, y, 2, x + 6, y + 2, front, null);
    g.box(x, y, 0, x + 6, y + 2, 1, 'ink');
  }
  // pilasters: raised columns that break up the flat brick
  const pil = [...T.pilasters, ...(T.style === 'carved' ? [-W / 2 + 0.4, W / 2 - 0.4] : [])].map((p) => Math.round(cx + p * 8));
  for (const px of pil) {
    for (let y = 0; y < top[clamp(px, 0, WW - 1)]; y++) for (let x = px - 3; x <= px + 3; x++) {
      const col = Math.abs(x - px) === 3 || y % 4 === 3 ? 'stoneDark' : (Math.abs(x - px) < 2 ? 'stoneLight' : 'stone');
      g.set(x, y, front + 1, col);
      if (Math.abs(x - px) < 3) g.set(x, y, front + 2, y % 8 < 4 ? 'stone' : 'stoneLight');
    }
    for (let x = px - 4; x <= px + 4; x++) { g.set(x, 0, front + 2, 'stoneDark'); g.set(x, 1, front + 2, 'stone'); g.set(x, H - 6, front + 2, 'stoneLight'); g.set(x, H - 7, front + 2, 'stone'); }
  }
  // style dressing
  if (T.style === 'ossuary') {
    // rows of skull niches in the brick
    for (const ny of [9, 15, 21]) for (let nx = 8; nx < WW - 10; nx += 9) {
      if (doorX.some((d) => Math.abs(nx + 2 - d) < ARCH.hw + 6)) continue;
      if (pil.some((p) => Math.abs(nx + 2 - p) < 7)) continue;
      g.box(nx, ny, 3, nx + 4, ny + 3, front, null);
      g.box(nx, ny, 0, nx + 4, ny + 3, 2, 'ink');
      g.box(nx, ny - 1, front - 1, nx + 4, ny - 1, front, 'stoneDark');
      const skull = r.chance(0.8);
      if (skull) {
        g.box(nx + 1, ny, front - 3, nx + 3, ny + 2, front - 2, 'bone');
        g.set(nx + 1, ny + 1, front - 1, 'ink'); g.set(nx + 3, ny + 1, front - 1, 'ink');
        g.set(nx + 2, ny, front - 1, 'frost');
      } else for (let s = 0; s < 3; s++) g.set(nx + r.int(0, 4), ny, front - 2, 'bone');
    }
  } else if (T.style === 'carved') {
    // a frieze band: diamonds cut into the stone, a few glowing
    const fy = 22;
    for (let x = 4; x < WW - 4; x++) {
      g.set(x, fy - 2, front, 'stoneDark'); g.set(x, fy + 3, front, 'stoneDark');
      if (doorX.some((d) => Math.abs(x - d) < ARCH.hw + 5)) continue;
      const u = x % 10;
      if (Math.abs(u - 4.5) + 0 < 3) { const h = 2 - Math.floor(Math.abs(u - 4.5) * 0.6); g.box(x, fy + 1 - (h > 1 ? 1 : 0), front, x, fy + (h > 1 ? 2 : 1), front, 'slate'); }
      if (u === 4 && Math.floor(x / 10) % 3 === 1) g.set(x, fy + 1, front, 'ember', true);
    }
  } else if (T.style === 'ruin' && T.breach) {
    const bx = Math.round(cx + T.breach.x * 8);
    const bw = Math.round(T.breach.w * 8 / 2);
    for (let x = bx - bw; x <= bx + bw; x++) for (let y = 0; y < 14; y++) {
      const edge = Math.abs(x - bx) > bw - 3 + r.int(-1, 1) || y > 11 + r.int(-1, 1);
      if (edge) continue;
      g.box(x, y, 2, x, y, front, null);
      g.set(x, y, 1, 'ink');
    }
    // rubble spilled at the foot, on the wall's own base so the floor stays clear
    for (let q = 0; q < 60; q++) {
      const x = bx + r.int(-bw - 4, bw + 4), y = r.int(0, 3), z = front + r.int(0, 3);
      g.set(x, y, z, r.pick(['stone', 'stoneLight', 'stoneDark', 'dusk']));
    }
  }
  // moss and roots at the foot and hanging vines
  for (let x = 0; x < WW; x++) for (let y = 0; y < 5; y++) if (r.chance((0.5 - y * 0.1) * (0.4 + T.moss))) g.set(x, y, front + (g.get(x, y, front + 1) ? 1 : 0), r.chance(0.35) ? 'leaf' : 'moss');
  for (let q = 0; q < 5 + Math.round(T.moss * 6); q++) {
    const x = r.int(4, WW - 5), len = r.int(3, 9);
    for (let s = 0; s < len; s++) g.set(x + (s > 4 ? r.int(-1, 1) : 0), top[x] - 1 - s, front + 1, s < 2 ? 'moss' : r.chance(0.3) ? 'leaf' : 'moss');
  }
  // hanging chains (drawn on the wall face)
  for (let q = 0; q < 3; q++) {
    const x = r.int(10, WW - 10);
    if (doorX.some((d) => Math.abs(x - d) < ARCH.hw + 4)) continue;
    const len = r.int(6, 11);
    for (let y = top[x] - len; y < top[x]; y++) g.set(x, y, front + 1, y % 2 ? 'slate' : 'mist');
    g.box(x - 1, top[x] - len - 1, front + 1, x + 1, top[x] - len - 1, front + 1, 'slate');
  }
  // arches: stone ring, a dark alcove that reaches back to z = 0
  const ah = ARCH.h, aw = ARCH.hw;
  for (const dx of doorX) {
    for (let x = dx - aw - 4; x <= dx + aw + 3; x++) for (let y = 0; y <= ah + 5; y++) {
      const spring = ah - aw;
      const tx = (x + 0.5 - dx) / (aw + 3.5), ty = Math.max(0, y - spring) / (aw + 3.5);
      const ringOut = tx * tx + ty * ty <= 1;
      const ix = (x + 0.5 - dx) / aw, iy = Math.max(0, y - spring) / aw;
      const inside = ix * ix + iy * iy <= 1 && y < ah + 1;
      if (inside) {
        g.box(x, y, 1, x, y, front + protr, null);
        g.set(x, y, 0, 'ink');
      } else if (ringOut) {
        const stone = ((x + y) % 5 === 0) ? 'stone' : 'stoneLight';
        g.set(x, y, front + 1, stone); g.set(x, y, front, 'stoneLight');
        if (y < spring + 2) g.set(x, y, front + 2, (x + y) % 7 === 0 ? 'stone' : 'stoneLight');
      }
    }
    // keystone with a small skull; alcove floor lip
    const ky = ah + 4;
    g.box(dx - 2, ky, front + 1, dx + 1, ky + 3, front + 3, 'stoneLight');
    g.box(dx - 1, ky + 1, front + 3, dx, ky + 2, front + 3, 'bone');
    g.set(dx - 1, ky + 2, front + 3, 'ink'); g.set(dx, ky + 2, front + 3, 'ink');
    // side plinths at the arch feet
    for (const s of [-1, 1]) g.box(dx + s * (aw + 2) - (s < 0 ? 1 : 0), 0, front + 1, dx + s * (aw + 2) + (s > 0 ? 1 : 0), 2, front + 3, 'stoneDark');
  }
  defineModel(name, { grid: g, origin: [WW / 2, 0, front + 1] });   // brick face at z = 0
  return { name, WW };
}

// ---- side walls --------------------------------------------------------------------------------

/** One side wall, seen mostly from above: capstones, cracks and rubble carry it. Built for x > 0; mirror with scale.x = -1. */
export function buildSideWall(name, D, seed, theme = {}) {
  const L = D * 8 + MB + 6;
  const g = new VoxelGrid(SW, SIDE_H + 6, L);
  const r = new Rng(`arena.side/${seed}`);
  const brick = theme.brick ?? ['stone', 'dusk', 'stone', 'violet'];
  const hs = Array.from({ length: Math.ceil(L / 14) + 2 }, () => r.int(0, 1));
  for (let z = 0; z < L; z++) {
    const broken = z > L - 30 ? (z - (L - 30)) * 0.55 : 0;
    const h = clamp(Math.round(SIDE_H - hs[Math.floor(z / 14)] - broken), 0, 99);
    for (let y = 0; y < h; y++) for (let x = 0; x < SW; x++) {
      const course = Math.floor(y / 4);
      const mortar = y % 4 === 3 || ((z + (course % 2) * 4) % 8 === 7);
      g.set(x, y, z, mortar && (x === 0 || x === SW - 1) ? 'stoneDark' : brick[(course + Math.floor(z / 8)) % brick.length]);
    }
    if (h > 0) {
      // the top: two columns of capstone slabs, staggered joints, a raised lip on the room side
      for (let x = 0; x < SW; x++) {
        const col = x < 8 ? 0 : 1, zz = z + (col ? 7 : 0);
        const slab = Math.floor(zz / 14), joint = zz % 14 === 13 || x === 7 || x === 8;
        const tone = ['stone', 'stoneLight', 'stone', 'slate'][(slab * 3 + col * 2 + Math.floor(slab / 4)) % 4];
        g.set(x, h, z, joint ? 'stoneDark' : tone);
        if (x < 2 && !joint) g.set(x, h + 1, z, 'stoneLight');            // the lip along the room side
      }
      if (r.chance(0.05)) g.set(r.int(2, SW - 3), h + 1, z, 'stone');
      if (r.chance(0.07 * (theme.moss ?? 0.5))) g.set(r.int(0, SW - 1), h, z, r.chance(0.3) ? 'leaf' : 'moss');
    }
  }
  for (let q = 0; q < 8; q++) {
    let z = r.int(6, L - 10), x = r.int(1, SW - 2);
    const h = SIDE_H - 1;
    for (let s = 0; s < r.int(4, 8); s++) { g.set(x, h, z, 'ink'); if (r.chance(0.5)) x += r.pick([-1, 1]); else z += 1; }
  }
  // rubble spilling off the broken front end, inward onto the floor edge
  for (let q = 0; q < 60; q++) {
    const z = r.int(L - 30, L - 1), x = r.int(-2, SW - 1), y = r.int(0, 2);
    g.set(clamp(x, 0, SW - 1), y, z, r.pick(['stone', 'stoneLight', 'stoneDark']));
  }
  defineModel(name, { grid: g, origin: [0, 0, MB + 4] });   // inner face at x = 0, the back wall's face at z = -4
  return { name, L };
}

// ---- doors ---------------------------------------------------------------------------------------

const baseGrids = {}, cutDone = new Set();

const GATE_H = ARCH.h + 1;
{
  // the portcullis: bars, rails, rusted rivets and spikes on the foot
  const w = ARCH.hw * 2, h = GATE_H;
  const g = new VoxelGrid(w, h, 3);
  const r = new Rng('arena.gate');
  for (let x = 1; x < w - 1; x += 3) {
    g.box(x, 2, 1, x, h - 1, 1, x % 2 ? 'mist' : 'fog');
    g.box(x, 2, 0, x, h - 1, 0, 'slate');
    g.set(x, 0, 1, 'frost'); g.set(x, 1, 1, 'mist');       // spike
    if (r.chance(0.5)) g.set(x, r.int(4, h - 3), 2, 'dirt');
  }
  for (const y of [4, 11, 17, h - 2]) {
    g.box(0, y, 2, w - 1, y + 1, 2, 'slate');
    for (let x = 2; x < w; x += 6) g.set(x, y + 1, 2, 'mist');
  }
  g.box(0, 2, 2, 0, h - 1, 2, 'slate'); g.box(w - 1, 2, 2, w - 1, h - 1, 2, 'slate');
  defineModel('arena.gate', { grid: g });
  baseGrids['arena.gate'] = g;
}

{
  // the stone slab that seals the exit: a heavy door with a carved socket for the rune
  const w = ARCH.hw * 2, h = ARCH.h + 1;
  const g = new VoxelGrid(w, h, 5);
  const r = new Rng('arena.slab');
  g.box(0, 0, 0, w - 1, h - 1, 3, 'stoneDark');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = x < 2 || x > w - 3 || y < 2;
    const c = edge ? (r.chance(0.2) ? 'stoneLight' : 'stone') : (((x >> 2) + (y >> 2)) % 3 === 0 ? 'dusk' : 'stone');
    g.set(x, y, 4, (y % 5 === 4 && !edge) ? 'stoneDark' : c);
  }
  // iron straps
  for (const y of [4, h - 5]) { g.box(0, y, 4, w - 1, y + 1, 4, 'slate'); for (let x = 2; x < w; x += 5) g.set(x, y, 4, 'mist'); }
  // the socket: a dark disc that the rune overlay sits in
  const cx = (w - 1) / 2, cy = 12;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < 6.6) g.set(x, y, 4, d < 5.4 ? 'ink' : 'slate');
  }
  // chips and cracks
  for (let q = 0; q < 14; q++) g.set(r.int(2, w - 3), r.int(2, h - 2), 4, 'stoneDark');
  defineModel('arena.slab', { grid: g });
  baseGrids['arena.slab'] = g;
}

/**
 * A door model with only its lowest `rows` voxel rows: a gate or slab that slides up into the wall is
 * swapped for shorter copies as it goes, so the part that would stand above the wall top never draws.
 * Returns a model name (registered on first use).
 */
export function doorRows(base, rows) {
  rows = Math.max(0, Math.min(GATE_H, Math.round(rows)));
  const name = `${base}.${rows}`;
  if (rows > 0 && !cutDone.has(name)) {
    const src = baseGrids[base], [sx, , sz] = src.size;
    const g = new VoxelGrid(sx, rows, sz);
    for (let z = 0; z < sz; z++) for (let y = 0; y < rows; y++) for (let x = 0; x < sx; x++) {
      const c = src.get(x, y, z);
      if (c) { const e = src.colors[c]; g.set(x, y, z, e.name, e.emissive); }
    }
    defineModel(name, { grid: g });
    cutDone.add(name);
  }
  return rows > 0 ? name : null;
}

/** Rune overlays for the slab: a thin emissive ring, a diamond, notches and a gem. One model per colour. */
for (const col of ['ember', 'blood', 'cyan', 'gold', 'white']) {
  const g = new VoxelGrid(13, 13, 1);
  const c = 6;
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy), m = Math.abs(dx) + Math.abs(dy);
    if (d > 5.0 && d < 6.1) g.set(x, y, 0, col, true);                       // outer ring
    if (m > 3.2 && m < 4.3 && d < 4.4) g.set(x, y, 0, col, true);           // diamond
    if (Math.abs(dx) < 1.1 && Math.abs(dy) < 1.1) g.set(x, y, 0, col, true); // gem
  }
  for (const [x, y] of [[6, 1], [6, 11], [1, 6], [11, 6]]) g.set(x, y, 0, null);   // the ring is broken at the four points
  for (const [x, y] of [[6, 3], [6, 9], [3, 6], [9, 6]]) g.set(x, y, 0, col, true);
  defineModel(`arena.rune.${col}`, { grid: g });
}

/** Flame frames for braziers, sconces and candles: swapped every few ticks, so fire never holds a pose. */
for (let f = 0; f < 4; f++) {
  const r = new Rng(`arena.flame/${f}`);
  const g = new VoxelGrid(7, 10, 7);
  const rows = [[1, 3, 'ember'], [1, 2, 'flame'], [2, 2, 'flame'], [3, 2, 'gold'], [4, 1, 'torch'], [5, 1, 'gold'], [6, 1, 'flame'], [8 - f % 2, 0, 'ember']];
  // a base of coals, a body and a licking tip that leans a different way each frame
  for (let y = 0; y < 4; y++) {
    const rad = y < 1 ? 2 : y < 3 ? 1.6 : 1;
    for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) {
      if (Math.hypot(x - 3, z - 3) <= rad + (r.next() * 0.5 - 0.1)) g.set(x, y, z, y < 1 ? 'ember' : y < 2 ? 'flame' : y < 3 ? 'gold' : 'torch', true);
    }
  }
  const lean = [[0, 0], [1, 0], [-1, 0], [0, 1]][f];
  g.set(3 + lean[0], 4, 3 + lean[1], 'flame', true);
  g.set(3 + lean[0], 5, 3 + lean[1], 'ember', true);
  if (f % 2 === 0) g.set(3 + lean[0] * 2, 6, 3 + lean[1] * 2, 'ember', true);
  else g.set(3 - lean[0], 5, 3 - lean[1], 'ember', true);
  void rows;
  defineModel(`arena.flame.${f}`, { grid: g, origin: [3.5, 0, 3.5] });
  // small: sconce and candle flame
  const s = new VoxelGrid(3, 5, 3);
  s.set(1, 0, 1, 'ember', true); s.set(1, 1, 1, 'gold', true); s.set(1, 2, 1, 'flame', true);
  if (f % 2) s.set(1, 3, 1, 'ember', true); else { s.set(1, 3, 1, 'flame', true); s.set(1, 4, 1, 'ember', true); }
  if (f > 1) s.set(f === 2 ? 0 : 2, 1, 1, 'ember', true);
  defineModel(`arena.flameS.${f}`, { grid: s, origin: [1.5, 0, 1.5] });
}

/** A floor rune that lights up on the way to the exit when the room is cleared: a small diamond of light. */
for (const [key, a, b] of [['off', 'slate', 'violet'], ['on', 'gold', 'flame'], ['hot', 'white', 'gold']]) {
  const g = new VoxelGrid(7, 1, 7);
  const em = key !== 'off';
  for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) {
    const m = Math.abs(x - 3) + Math.abs(z - 3);
    if (m === 3) g.set(x, 0, z, b, em);
    else if (m === 2 && (x === 3 || z === 3)) g.set(x, 0, z, a, em);
    else if (m <= 1) g.set(x, 0, z, key === 'off' ? b : 'white', em);
  }
  defineModel(`arena.trail.${key}`, { grid: g });
}
