// Arena tiles (piece `arenas`): the floor, walls, gate and exit of a room, built as a few big
// voxel models from a room layout (see arena.js for the layout and templates).
//
//   import { THEMES, buildRoomModels, buildDoorModels } from './tiles.js';
//   const names = buildRoomModels(layout);   // { floor, back, left, right, front }
//
// Coordinates: the room interior is W x D tiles of one world unit (8 voxels). The interior
// spans x in [-W/2, W/2] and z in [-D/2, D/2]; the back wall's face is at z = -D/2, the front
// parapet starts at z = +D/2. Tile (i, j) has its centre at (-W/2 + i + 0.5, -D/2 + j + 0.5).
//
// The floor model covers one tile beyond the side walls, the back wall's depth (where the exit
// stair goes down) and 3 tiles in front (the landing the hero walks in from).
//
// Everything is authored in palette names; `look` lights, outlines and quantises it.

import { defineModel, VoxelGrid } from '../render/voxel/index.js';
import { Rng } from '../core/rng.js';

// Per-room colour and dressing. slabs: weighted floor stone colours. style: floor pattern.
export const THEMES = {
  crypt: {
    label: 'CRYPT', style: 'flag', slabs: [['stone', 8], ['dusk', 3], ['stoneLight', 1]], grout: 'stoneDark',
    inlay: ['slate', 'stoneLight'], moss: 0.8, bone: 0, blood: 1,
    brick: ['stone', 'stone', 'dusk', 'stone', 'violet', 'stone', 'stoneDark'], banner: ['plum', 'blood', 'gold'],
  },
  ossuary: {
    label: 'OSSUARY', style: 'tile', slabs: [['stone', 5], ['stoneDark', 3], ['dusk', 3]], grout: 'stoneDark',
    inlay: ['bone', 'frost'], moss: 0.25, bone: 0.004, blood: 2,
    brick: ['stone', 'dusk', 'stoneDark', 'stone', 'dusk', 'violet', 'stone'], banner: ['blood', 'shadow', 'bone'],
  },
  sunken: {
    label: 'SUNKEN', style: 'flag', slabs: [['stone', 6], ['dusk', 4], ['stoneLight', 1]], grout: 'stoneDark',
    inlay: ['teal', 'slate'], moss: 2.2, bone: 0, blood: 0, puddles: 7,
    brick: ['stone', 'dusk', 'stone', 'moss', 'stone', 'dusk', 'stoneDark'], banner: ['teal', 'navy', 'frost'],
  },
  hall: {
    label: 'HALL', style: 'tile', slabs: [['stone', 6], ['stoneLight', 2], ['dusk', 3]], grout: 'stoneDark',
    inlay: ['gold', 'woodLight'], moss: 0.3, bone: 0, blood: 1, carpet: ['blood', 'woodLight', 'plum'],
    brick: ['stone', 'stone', 'dusk', 'stoneLight', 'stone', 'violet', 'stone'], banner: ['navy', 'blue', 'gold'],
  },
  deep: {
    label: 'DEEP', style: 'flag', slabs: [['dusk', 6], ['stoneDark', 4], ['violet', 2]], grout: 'night',
    inlay: ['ember', 'blood'], moss: 0.1, bone: 0.004, blood: 2, emberCracks: 10,
    brick: ['dusk', 'stoneDark', 'violet', 'dusk', 'stone', 'stoneDark', 'dusk'], banner: ['blood', 'ink', 'ember'],
  },
};

const VX = 8;           // voxels per tile
const TOP = 3;          // floor top layer (the floor's top face is at y = 0)
const BLOCK_H = 10;     // raised block height in voxels
export const WALL_H = 30;
export const SIDE_H = 22;
export const FRONT_H = 5;
export const POST_H = 15;

// ---------------------------------------------------------------------------------------
// floor
// ---------------------------------------------------------------------------------------

/**
 * Floor model for a room layout. layout: { key, W, D, tiles (D rows of W chars), theme,
 * gate: [i0, i1], exit: [i0, i1], focal: {kind, i, j, r} | null, seed }.
 */
function buildFloor(L) {
  const T = THEMES[L.theme];
  const r = new Rng(`${L.seed}/floor/${L.key}`);
  const W = L.W, D = L.D;
  const GX = (W + 2) * VX, GZ = (D + 4) * VX;   // x: one tile each side; z: one behind, three in front
  const GY = TOP + 1 + BLOCK_H + 2;
  const g = new VoxelGrid(GX, GY, GZ);
  const ox = VX, oz = VX;                         // voxel of the interior's (-W/2, -D/2) corner
  const tileAt = (x, z) => {
    const i = Math.floor((x - ox) / VX), j = Math.floor((z - oz) / VX);
    return i >= 0 && j >= 0 && i < W && j < D ? L.tiles[j][i] : null;
  };
  const inRoom = (x, z) => x >= ox && x < ox + W * VX && z >= oz && z < oz + D * VX;
  const gx0 = ox + L.gate[0] * VX, gx1 = ox + (L.gate[1] + 1) * VX - 1;
  const ex0 = ox + L.exit[0] * VX, ex1 = ox + (L.exit[1] + 1) * VX - 1;
  const front = oz + D * VX;                      // first voxel row of the front parapet

  // top colour and height per column, filled in passes
  const col = new Array(GX * GZ).fill(null);
  const hgt = new Int8Array(GX * GZ).fill(TOP);
  const at = (x, z) => x + GX * z;
  const set = (x, z, c, y = TOP) => { if (x >= 0 && z >= 0 && x < GX && z < GZ) { col[at(x, z)] = c; hgt[at(x, z)] = y; } };
  const get = (x, z) => (x >= 0 && z >= 0 && x < GX && z < GZ ? col[at(x, z)] : null);

  // 1. slabs over the whole interior (and under the walls, where they are hidden anyway)
  const pickShade = () => r.weighted(T.slabs);
  if (T.style === 'flag') {
    const rowD = 12;
    for (let z0 = oz - 4; z0 < front + 2; z0 += rowD) {
      let x0 = ox - r.int(0, 14);
      while (x0 < GX) {
        const sw = r.pick([10, 12, 14, 16, 18, 20]);
        const shade = pickShade();
        const sunk = r.chance(0.07);
        const x1 = x0 + sw - 1, z1 = Math.min(front - 1, z0 + rowD - 1);
        for (let z = Math.max(0, z0 + 1); z <= z1; z++) for (let x = Math.max(0, x0 + 1); x <= Math.min(GX - 1, x1); x++) {
          let c = shade;
          const f = r.next();
          if (f < 0.012) c = 'stoneLight'; else if (f < 0.024) c = T.grout;
          const cx = x === x0 + 1 || x === x1, cz = z === z0 + 1 || z === z1;
          if (cx && cz && r.chance(0.6)) continue;
          if ((cx || cz) && r.chance(0.035)) continue;
          if (z === z1 && c === shade && shade !== 'stoneLight' && r.chance(0.3)) c = shade === 'dusk' ? 'stone' : 'stoneLight';
          set(x, z, c, sunk ? TOP - 1 : TOP);
        }
        x0 += sw;
      }
    }
  } else {
    // square tiles, one per world tile, in a quiet checker; every few a worn or carved one
    for (let tj = -1; tj < D + 1; tj++) for (let ti = -1; ti < W + 1; ti++) {
      const shadeA = T.slabs[0][0], shadeB = T.slabs[2][0];
      let shade = (ti + tj) % 2 === 0 ? shadeA : shadeB;
      if (r.chance(0.12)) shade = T.slabs[1][0];
      const carved = r.chance(0.06);
      const sunk = r.chance(0.05);
      for (let dz = 1; dz < VX; dz++) for (let dx = 1; dx < VX; dx++) {
        const x = ox + ti * VX + dx, z = oz + tj * VX + dz;
        if (z >= front) continue;
        let c = shade;
        const f = r.next();
        if (f < 0.015) c = 'stoneLight'; else if (f < 0.03) c = T.grout;
        if ((dx === 1 || dx === VX - 1) && (dz === 1 || dz === VX - 1) && r.chance(0.5)) continue;
        if (dz === VX - 1 && r.chance(0.3)) c = shade === 'stoneLight' ? 'stone' : 'stoneLight';
        if (carved && Math.abs(dx - 4) + Math.abs(dz - 4) === 2) c = T.grout;
        set(x, z, c, sunk ? TOP - 1 : TOP);
      }
    }
  }
  // grout everywhere a slab left a gap
  for (let z = 0; z < front; z++) for (let x = 0; x < GX; x++) if (!get(x, z)) set(x, z, T.grout, TOP - 1);

  // 2. the worn path: gate to exit, lighter stone and no moss
  const path = (x, z) => {
    const midx = (gx0 + gx1) / 2 + ((ex0 + ex1) / 2 - (gx0 + gx1) / 2) * (1 - (z - oz) / (D * VX));
    return Math.abs(x - midx) < 7 + Math.sin(z * 0.4) * 1.5;
  };
  for (let z = oz; z < front; z++) for (let x = ox; x < ox + W * VX; x++) {
    if (!path(x, z) || hgt[at(x, z)] < TOP) continue;
    if (r.chance(0.07)) set(x, z, 'stoneLight');
  }

  // 3. a carpet runner along the path (hall theme)
  if (T.carpet) {
    const [body, trim, dark] = T.carpet;
    const cx = (gx0 + gx1 + 1) / 2;
    const z0 = oz + 6, z1 = front - 5;
    for (let z = z0; z <= z1; z++) for (let x = Math.round(cx - 7); x < Math.round(cx + 7); x++) {
      const edge = x === Math.round(cx - 7) || x === Math.round(cx + 6);
      const trimRow = x === Math.round(cx - 6) || x === Math.round(cx + 5);
      if ((z === z0 || z === z1) && r.chance(0.5)) continue;       // frayed ends
      let c = edge ? dark : trimRow ? trim : ((Math.floor((z - z0) / 6) % 2) && Math.abs(x - cx) < 2) ? dark : body;
      if (r.chance(0.02)) c = dark;
      set(x, z, c, TOP);
    }
    // a torn hole, and a scorch where the carpet burnt
    for (let k = 0; k < 18; k++) { const x = Math.round(cx - 2 + r.range(-2, 2)), z = Math.round(oz + D * VX * 0.62 + r.range(-2, 2)); set(x, z, T.grout, TOP - 1); }
  }

  // 4. the focal inlay
  const F = L.focal;
  if (F) {
    const cx = ox + (F.i + 0.5) * VX, cz = oz + (F.j + 0.5) * VX, R = F.r * VX;
    const [a, b] = T.inlay;
    for (let z = Math.floor(cz - R - 3); z <= cz + R + 3; z++) for (let x = Math.floor(cx - R - 3); x <= cx + R + 3; x++) {
      if (!inRoom(x, z)) continue;
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      let c = null;
      if (F.kind === 'ring' || F.kind === 'rune') {
        if (d > R - 1 && d <= R + 1) {
          const notch = Math.abs(((ang / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.44;
          c = notch ? b : a;
        }
        if (F.kind === 'rune') {
          // an eight-point star inside the ring
          const k = Math.cos(4 * ang);
          const star = R * (0.52 + 0.3 * Math.abs(k) ** 3);
          if (Math.abs(d - star) < 0.7 && d < R - 2) c = a;
          if (d < 1.6) c = b;
        } else if (d > R - 5 && d <= R - 4 && Math.floor((ang + Math.PI) / (Math.PI / 8)) % 2 === 0) c = a;
      } else if (F.kind === 'cross') {
        const w = 2;
        if ((Math.abs(dx) < w && Math.abs(dz) < R) || (Math.abs(dz) < w && Math.abs(dx) < R)) c = Math.abs(dx) < 1 || Math.abs(dz) < 1 ? b : a;
        if (Math.abs(d - R * 0.45) < 0.8) c = a;
      } else if (F.kind === 'square') {
        const m = Math.max(Math.abs(dx), Math.abs(dz));
        if (m > R - 1 && m <= R) c = a;
        if (m > R - 3 && m <= R - 2 && (Math.floor(dx) + Math.floor(dz)) % 3 === 0) c = b;
      }
      if (c && hgt[at(x, z)] >= TOP - 1) set(x, z, c, TOP);
      else if (c) set(x, z, c, TOP - 1);
    }
  }

  // 5. cracks
  const nCracks = Math.round(W * D / 9);
  for (let i = 0; i < nCracks; i++) {
    let x = r.int(ox + 2, ox + W * VX - 3), z = r.int(oz + 2, front - 3);
    const n = r.int(4, 12);
    const glow = T.emberCracks && i < T.emberCracks;
    for (let k = 0; k < n; k++) {
      set(x, z, glow ? (k % 3 ? 'ember' : 'blood') : T.grout, glow ? TOP - 1 : TOP - 1);
      if (glow) emissive.add(at(x, z));
      if (r.chance(0.5)) x += r.pick([-1, 1]); else z += r.pick([-1, 1]);
    }
  }

  // 6. moss and grass creeping out from the walls, and in patches
  if (T.moss > 0) {
    const patches = [];
    const nP = Math.round(4 + T.moss * 5);
    for (let i = 0; i < nP; i++) {
      const side = r.int(0, 3);
      const px = side === 0 ? ox + r.int(0, 10) : side === 1 ? ox + W * VX - r.int(0, 10) : r.int(ox, ox + W * VX);
      const pz = side === 2 ? oz + r.int(0, 8) : side === 3 ? r.int(oz + D * VX * 0.3, front) : r.int(oz, front);
      patches.push([px, pz, r.range(4, 9) * (0.8 + T.moss * 0.2)]);
    }
    for (let z = oz; z < front; z++) for (let x = ox; x < ox + W * VX; x++) {
      let k = 0;
      for (const [px, pz, pr] of patches) k = Math.max(k, 1 - Math.hypot(x - px, (z - pz) * 1.3) / pr);
      const edge = Math.min(x - ox, ox + W * VX - 1 - x, z - oz);
      k = Math.max(k, (2.5 - edge) / 2.5 * 0.5 * T.moss);
      if (k <= 0 || path(x, z) && k < 0.6) continue;
      const low = hgt[at(x, z)] < TOP;
      if (low && r.next() < k * 1.6) set(x, z, r.chance(0.3) ? 'leaf' : 'moss', TOP - 1);
      else if (!low && r.next() < k * k * 0.45) set(x, z, r.chance(0.2) ? 'leaf' : 'moss');
    }
  }

  // 7. puddles (sunken theme): sunk still water with a pale glint
  for (let i = 0; i < (T.puddles || 0); i++) {
    const px = r.int(ox + 8, ox + W * VX - 8), pz = r.int(oz + 8, front - 8), pr = r.range(3, 7);
    for (let z = Math.floor(pz - pr); z <= pz + pr; z++) for (let x = Math.floor(px - pr * 1.5); x <= px + pr * 1.5; x++) {
      const d = Math.hypot((x - px) / 1.5, z - pz) + Math.sin(x * 0.9 + z) * 0.6;
      if (d < pr && tileAt(x, z) !== '#') set(x, z, d < pr - 1.2 ? (r.chance(0.04) ? 'sky' : 'navy') : 'teal', TOP - 1);
    }
  }

  // 8. old stains and bone chips
  for (let i = 0; i < (T.blood || 0); i++) {
    // a splat: a lumpy core, a darker rim, a drag smear, and a few droplets flung past it
    const sx = r.int(ox + 14, ox + W * VX - 14), sz = r.int(oz + 14, front - 12);
    const R = r.range(2.2, 3.4), a0 = r.range(0, 6.28);
    const lump = [r.range(0, 6.28), r.range(0, 6.28)];
    for (let z = Math.floor(sz - 7); z <= sz + 7; z++) for (let x = Math.floor(sx - 7); x <= sx + 7; x++) {
      if (!inRoom(x, z) || hgt[at(x, z)] < TOP - 1) continue;
      const dx = x + 0.5 - sx, dz = z + 0.5 - sz, a = Math.atan2(dz, dx), d = Math.hypot(dx, dz);
      const edge = R * (1 + 0.25 * Math.sin(3 * a + lump[0]) + 0.15 * Math.sin(5 * a + lump[1]));
      // the smear: a tapering streak one way
      const along = dx * Math.cos(a0) + dz * Math.sin(a0), across = -dx * Math.sin(a0) + dz * Math.cos(a0);
      const smear = along > 0 && along < R * 2.4 && Math.abs(across) < (1.3 - along / (R * 2.4)) * 1.6;
      if (d < edge - 0.9) set(x, z, 'blood', hgt[at(x, z)]);
      else if (d < edge || smear) set(x, z, 'plum', hgt[at(x, z)]);
    }
    for (let k = 0; k < 6; k++) {
      const a = r.range(0, 6.28), d = r.range(R + 1.5, R + 4.5);
      const x = Math.round(sx + Math.cos(a) * d), z = Math.round(sz + Math.sin(a) * d);
      if (inRoom(x, z)) set(x, z, r.chance(0.5) ? 'blood' : 'plum', hgt[at(x, z)]);
    }
  }
  if (T.bone) for (let z = oz; z < front; z++) for (let x = ox; x < ox + W * VX; x++) if (r.chance(T.bone)) set(x, z, r.chance(0.5) ? 'bone' : 'frost', TOP);

  // 9. grates ('=' tiles): iron bars over a dark drain
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    if (L.tiles[j][i] !== '=') continue;
    for (let dz = 1; dz < VX - 1; dz++) for (let dx = 1; dx < VX - 1; dx++) {
      const x = ox + i * VX + dx, z = oz + j * VX + dz;
      const bar = dx % 2 === 1 || dz === 1 || dz === VX - 2;
      set(x, z, bar ? (dz === 1 ? 'mist' : 'slate') : 'ink', bar ? TOP : TOP - 2);
    }
  }

  // 10. the exit: a stair going down into the dark inside the arch
  for (let z = 0; z < oz; z++) for (let x = ex0; x <= ex1; x++) {
    const step = Math.floor((oz - 1 - z) / 2);                  // 0 at the threshold, deeper further back
    set(x, z, ['stoneLight', 'stone', 'dusk', 'shadow'][Math.min(3, step)], TOP - step);
  }
  for (let x = ex0; x <= ex1; x++) set(x, oz, x % 3 ? 'stoneLight' : 'stone', TOP);   // threshold

  // 11. the landing in front: steps rising to the gate from the corridor; void elsewhere
  for (let z = front; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const inGate = x >= gx0 - 3 && x <= gx1 + 3;
    if (!inGate) { col[at(x, z)] = null; continue; }
    const k = z - front;
    const step = k < 10 ? 0 : k < 16 ? 1 : 2;
    const edge = x < gx0 || x > gx1;
    set(x, z, edge ? 'stoneDark' : (k % 6 === 5 ? T.grout : step === 0 ? 'stone' : step === 1 ? 'dusk' : 'shadow'), TOP);
    if (edge) set(x, z, 'stoneDark', TOP + 1);
  }
  // the gate's floor slot, where the spikes wait
  for (let x = gx0; x <= gx1; x++) { set(x, front + 3, 'ink', TOP - 2); set(x, front + 2, 'slate', TOP); set(x, front + 4, 'slate', TOP); }

  // grit and pebbles gathered along the foot of the walls
  for (let x = ox; x < ox + W * VX; x++) if (r.chance(0.3) && (x < ex0 - 2 || x > ex1 + 2)) set(x, oz + r.int(0, 1), r.pick(['stone', 'stoneLight', T.grout]), TOP + (r.chance(0.35) ? 1 : 0));
  for (let z = oz; z < front; z++) for (const x of [ox, ox + W * VX - 1]) if (r.chance(0.3)) set(x + (x === ox ? r.int(0, 1) : -r.int(0, 1)), z, r.pick(['stone', 'stoneLight', T.grout]), TOP + (r.chance(0.35) ? 1 : 0));
  // write columns
  for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const c = col[at(x, z)];
    if (!c) continue;
    const h = hgt[at(x, z)];
    for (let y = 0; y < h; y++) g.set(x, y, z, y === h - 1 && h < TOP ? 'stoneDark' : 'stoneDark');
    g.set(x, h, z, c, emissive.has(at(x, z)) && (c === 'ember' || c === 'blood'));
  }
  emissive.clear();

  // 12. raised blocks ('#'): chest-high masonry with capstones
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    if (L.tiles[j][i] !== '#') continue;
    const n = (dx, dz) => L.tiles[j + dz]?.[i + dx] === '#';
    for (let dz = 0; dz < VX; dz++) for (let dx = 0; dx < VX; dx++) {
      const x = ox + i * VX + dx, z = oz + j * VX + dz;
      const inset = (!n(-1, 0) && dx === 0) || (!n(1, 0) && dx === VX - 1) || (!n(0, -1) && dz === 0) || (!n(0, 1) && dz === VX - 1);
      const hTop = TOP + BLOCK_H - (inset ? 1 : 0);
      for (let y = TOP + 1; y <= hTop; y++) {
        const course = Math.floor((y - TOP - 1) / 3);
        const mortar = (y - TOP - 1) % 3 === 2 || (x + (course % 2) * 4) % 8 === 7;
        g.set(x, y, z, y === hTop ? (r.chance(0.8) ? 'stoneLight' : 'stone') : mortar ? T.grout : T.brick[(course + i * 3 + j) % T.brick.length]);
      }
      if (r.chance(0.04)) g.set(x, hTop + 1, z, 'stone');
      if (!n(0, 1) && dz === VX - 1 && r.chance(0.25)) g.set(x, TOP + 1, z, r.chance(0.3) ? 'leaf' : 'moss');
    }
  }
  return { grid: g, origin: [ox + (W / 2) * VX, TOP + 1, oz + (D / 2) * VX] };
}
const emissive = new Set();

// ---------------------------------------------------------------------------------------
// back wall: brick courses, the exit arch, sconces, alcoves, chains, crumbled patches
// ---------------------------------------------------------------------------------------
function buildBack(L) {
  const T = THEMES[L.theme];
  const r = new Rng(`${L.seed}/back/${L.key}`);
  const W = L.W;
  const GX = (W + 2) * VX, H = WALL_H, front = 11, GZ = front + 4;
  const g = new VoxelGrid(GX, H + 4, GZ);
  const ox = VX;
  const tcol = (x) => { const i = Math.floor((x - ox) / VX); return i >= 0 && i < W ? L.wall[i] : '.'; };
  const top = [];
  for (let x = 0; x < GX; x++) top.push(H - 3 + Math.round(Math.sin(x * 0.09 + L.W) * 1.4 + Math.sin(x * 0.31) * 0.9 + r.next() * 1.1));
  for (let x = 0; x < GX; x++) {
    for (let y = 0; y < top[x]; y++) {
      g.box(x, y, 0, x, y, front - 1, T.grout);
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
    const y = top[x];
    g.box(x, y, 0, x, y, front, r.chance(0.8) ? 'stoneLight' : 'stone');
    if (r.chance(0.12)) g.set(x, y + 1, r.int(0, front), 'stone');
    // moss at the foot
    for (let yy = 0; yy < 5; yy++) if (r.chance((0.45 - yy * 0.09) * Math.min(1.5, 0.4 + T.moss * 0.5))) g.set(x, yy, front, r.chance(0.35) ? 'leaf' : 'moss');
  }
  // pilasters every few tiles break the long face into bays
  for (let i = 0; i <= W; i += L.bay || 4) {
    const x0 = ox + i * VX - 2;
    if (tcol(x0 + 2) === 'E' || tcol(x0 - 1) === 'E') continue;
    for (let y = 0; y < top[Math.max(0, x0)] ; y++) for (let x = x0; x < x0 + 4; x++) {
      if (x < 0 || x >= GX) continue;
      const mortar = y % 6 === 5;
      g.set(x, y, front + 1, y < 2 ? 'stoneLight' : mortar ? 'stoneDark' : (x === x0 ? 'dusk' : 'stone'));
    }
  }
  // per-tile features
  const cx = (i) => ox + i * VX + 4;
  for (let i = 0; i < W; i++) {
    const f = L.wall[i];
    const x = cx(i);
    if (f === 't') {
      // sconce: iron bracket and a cup of live coals (the flame itself is particles)
      const sy = 17;
      g.box(x, sy - 5, front + 1, x, sy - 2, front + 1, 'slate');
      g.set(x, sy - 1, front + 2, 'slate');
      g.box(x - 1, sy, front + 1, x + 1, sy, front + 3, 'shadow');
      g.set(x, sy, front + 2, 'ember', true);
      g.set(x - 1, sy + 1, front + 1, 'shadow'); g.set(x + 1, sy + 1, front + 1, 'shadow');
      g.set(x - 1, sy + 1, front + 3, 'shadow'); g.set(x + 1, sy + 1, front + 3, 'shadow');
      g.set(x, sy + 1, front + 2, 'gold', true);
      // soot above
      for (let y = sy + 3; y < sy + 9; y++) if (r.chance(0.6 - (y - sy) * 0.06)) g.set(x + r.int(-1, 1), y, front, 'stoneDark');
    } else if (f === 'n') {
      g.box(x - 5, 26, front + 1, x + 4, 26, front + 1, 'wood');   // the banner rod (cloth is its own mesh)
      g.set(x - 5, 27, front + 1, 'slate'); g.set(x + 4, 27, front + 1, 'slate');
    } else if (f === 'a') {
      // alcove: a recessed niche with a skull and a candle stub
      for (let y = 6; y <= 15; y++) for (let xx = x - 3; xx <= x + 3; xx++) {
        const arch = y > 12 && Math.abs(xx - x) > 15 - y;
        if (arch) continue;
        g.set(xx, y, front, null); g.set(xx, y, front - 1, null);
        g.set(xx, y, front - 2, 'ink');
      }
      g.box(x - 3, 5, front - 1, x + 3, 5, front + 1, 'stoneLight');   // sill
      g.box(x - 2, 6, front - 1, x, 8, front, 'bone');
      g.set(x - 2, 7, front, 'ink'); g.set(x, 7, front, 'ink'); g.set(x - 1, 6, front, 'ink');
      g.box(x + 2, 6, front, x + 2, 7, front, 'bone'); g.set(x + 2, 8, front, 'torch', true);
    } else if (f === 'h') {
      const len = 7 + r.int(0, 5);
      for (let y = top[x] - len; y < top[x]; y++) g.set(x, y, front + 1, y % 2 ? 'slate' : 'mist');
      g.box(x - 1, top[x] - len - 1, front + 1, x + 1, top[x] - len - 1, front + 1, 'slate');
    } else if (f === 'x') {
      // crumbled patch: bricks missing, rubble at the foot
      for (let y = 3; y < 16; y++) for (let xx = x - 4; xx <= x + 4; xx++) if (Math.hypot(xx - x, (y - 9) * 0.8) < 5 - r.next() * 1.5) { g.set(xx, y, front, null); if (r.chance(0.5)) g.set(xx, y, front - 1, 'stoneDark'); }
      for (let k = 0; k < 12; k++) g.set(x + r.int(-5, 5), 0, front + 1 + r.int(0, 2), r.pick(['stone', 'stoneLight', 'dusk']));
    }
  }
  // cobwebs strung across the back corners
  for (const [cx0, dir] of [[ox, 1], [ox + W * VX - 1, -1]]) {
    const n = 9 + r.int(0, 3);
    for (let k = 0; k < n; k++) for (let m = 0; m <= k; m += 1) {
      const x = cx0 + dir * m, y = top[Math.max(0, Math.min(GX - 1, x))] - 1 - (k - m);
      const strand = m === 0 || m === k || (k - m) === Math.floor(k / 2) || k % 4 === 0;
      if (strand && r.chance(0.8)) g.set(x, y, front + 1, (k + m) % 3 ? 'fog' : 'mist');
    }
  }
  // the exit arch
  const ex0 = ox + L.exit[0] * VX, ex1 = ox + (L.exit[1] + 1) * VX - 1;
  const ecx = (ex0 + ex1 + 1) / 2, aw = (ex1 - ex0 + 1) / 2, ah = 21;
  for (let x = ex0 - 4; x <= ex1 + 4; x++) for (let y = 0; y <= ah + 4; y++) {
    const dx = (x + 0.5 - ecx) / (aw + 3), dy = Math.max(0, y - (ah - aw)) / (aw + 3);
    const dxi = (x + 0.5 - ecx) / aw, dyi = Math.max(0, y - (ah - aw)) / aw;
    if (dxi * dxi + dyi * dyi <= 1) {
      g.box(x, y, 0, x, y, front + 3, null);
      g.set(x, y, 0, 'ink');
    } else if (dx * dx + dy * dy <= 1) {
      const vous = Math.floor(Math.atan2(y - (ah - aw), x + 0.5 - ecx) / 0.3);
      g.set(x, y, front + 1, (vous % 2 || y < 2) ? 'stoneLight' : 'stone');
      g.set(x, y, front, 'stoneLight');
      if (y < ah - aw && Math.abs(x + 0.5 - ecx) > aw + 2) g.set(x, y, front + 2, y % 4 === 0 ? 'stone' : 'stoneLight');   // jambs
    }
  }
  // keystone skull
  const ky = ah + 3;
  g.box(Math.round(ecx) - 2, ky, front + 1, Math.round(ecx) + 1, ky + 3, front + 2, 'bone');
  g.set(Math.round(ecx) - 2, ky + 2, front + 2, 'ink'); g.set(Math.round(ecx) + 1, ky + 2, front + 2, 'ink');
  g.set(Math.round(ecx) - 1, ky, front + 2, 'ink'); g.set(Math.round(ecx), ky, front + 2, 'frost');
  return { grid: g, origin: [ox + (W / 2) * VX, 0, front + 1] };
}

// side walls, seen nearly from above: capstones, rubble, the odd broken run
function buildSide(L, sideSign) {
  const T = THEMES[L.theme];
  const r = new Rng(`${L.seed}/side${sideSign}/${L.key}`);
  const Dv = L.D * VX + 6;
  const g = new VoxelGrid(VX, SIDE_H + 2, Dv);
  const brk = L.sideBreak ? r.int(Math.floor(Dv * 0.35), Math.floor(Dv * 0.6)) : -99;
  for (let z = 0; z < Dv; z++) {
    let h = SIDE_H - Math.round(r.next() * 1.4);
    if (Math.abs(z - brk) < 7) h = Math.max(6, h - Math.round((7 - Math.abs(z - brk)) * 1.6 + r.next() * 2));
    if (z >= Dv - 6) h = Math.max(FRONT_H + 2, Math.round(h - (z - (Dv - 6)) * 2.3));   // step down to the parapet
    for (let y = 0; y < h; y++) for (let x = 0; x < VX; x++) {
      const course = Math.floor(y / 4);
      const mortar = y % 4 === 3 || ((z + (course % 2) * 4) % 8 === 7);
      g.set(x, y, z, mortar && (x === 0 || x === VX - 1) ? T.grout : T.brick[(course + Math.floor(z / 8)) % T.brick.length]);
    }
    for (let x = 0; x < VX; x++) g.set(x, h, z, r.chance(0.8) ? 'stoneLight' : 'stone');
    if (r.chance(0.08)) g.set(r.int(0, VX - 1), h + 1, z, r.chance(0.5) ? 'moss' : 'stone');
    // the inner edge's capstones catch light: a lighter lip
    g.set(sideSign < 0 ? VX - 1 : 0, h, z, 'stoneLight');
  }
  return { grid: g, origin: [VX / 2, 0, 0] };
}

// front parapet: a low wall with the gate gap between two posts
function buildFront(L) {
  const T = THEMES[L.theme];
  const r = new Rng(`${L.seed}/front/${L.key}`);
  const W = L.W, GX = (W + 2) * VX, Dz = 6;
  const g = new VoxelGrid(GX, POST_H + 3, Dz);
  const ox = VX;
  const gx0 = ox + L.gate[0] * VX, gx1 = ox + (L.gate[1] + 1) * VX - 1;
  for (let x = 0; x < GX; x++) {
    if (x >= gx0 && x <= gx1) continue;
    const post = (x >= gx0 - VX && x < gx0) || (x > gx1 && x <= gx1 + VX);
    const h = post ? POST_H : FRONT_H + (r.chance(0.1) ? 1 : 0);
    for (let z = 0; z < Dz; z++) for (let y = 0; y < h; y++) {
      const course = Math.floor(y / 3);
      const joint = (x + (course % 2) * 3) % 6 === 5 || y % 3 === 2;
      let c = y === h - 1 ? (r.chance(0.2) ? 'stone' : 'stoneLight') : joint ? T.grout : (post ? 'stone' : T.brick[Math.floor(x / 6) % T.brick.length]);
      if (post && (x === gx0 - VX || x === gx1 + VX) && y < h - 1) c = 'dusk';
      g.set(x, y, z, c);
    }
  }
  // post caps: a pyramid of stone with an iron spike
  for (const px of [gx0 - VX, gx1 + 1]) {
    g.box(px - 1, POST_H, 0, px + VX, POST_H, Dz - 1, 'stoneLight');
    g.box(px + 1, POST_H + 1, 1, px + VX - 2, POST_H + 1, Dz - 2, 'stone');
    g.set(px + 3, POST_H + 2, 2, 'slate'); g.set(px + 4, POST_H + 2, 3, 'slate');
    // the rune socket on the post's face (the rune itself is its own mesh, it lights up)
    g.box(px + 2, 7, Dz - 1, px + 5, 11, Dz - 1, 'shadow');
  }
  return { grid: g, origin: [ox + (W / 2) * VX, 0, 0] };
}

/** Define the five room models for a layout. Cached by layout key. Returns their names. */
const builtRooms = new Set();
export function buildRoomModels(L) {
  const names = { floor: `arena.floor.${L.key}`, back: `arena.back.${L.key}`, left: `arena.left.${L.key}`, right: `arena.right.${L.key}`, front: `arena.front.${L.key}` };
  if (builtRooms.has(L.key)) return names;
  builtRooms.add(L.key);
  defineModel(names.floor, buildFloor(L));
  defineModel(names.back, buildBack(L));
  defineModel(names.left, buildSide(L, -1));
  defineModel(names.right, buildSide(L, 1));
  defineModel(names.front, buildFront(L));
  return names;
}

// ---------------------------------------------------------------------------------------
// doors: the entry gate (spikes that slam up out of a floor slot), the exit portcullis and
// its seal, and the rune plates on the gate posts
// ---------------------------------------------------------------------------------------
let doorsBuilt = false;
export function buildDoorModels() {
  if (doorsBuilt) return;
  doorsBuilt = true;
  {
    const W = 3 * VX, H = 13;
    const g = new VoxelGrid(W, H, 2);
    for (let x = 1; x < W; x += 3) {
      for (let y = 0; y < H - 2; y++) g.set(x, y, 1, y % 5 === 0 ? 'mist' : 'slate');
      g.set(x, H - 2, 1, 'fog'); g.set(x, H - 1, 1, 'frost');   // sharpened tips
      g.set(x, H - 2, 0, 'mist');
    }
    for (const y of [2, 7]) g.box(0, y, 0, W - 1, y, 1, 'shadow');
    for (const y of [2, 7]) for (let x = 1; x < W; x += 6) g.set(x, y, 1, 'fog');   // rivets
    defineModel('arena.gate', { grid: g, origin: [W / 2, 0, 1] });
  }
  {
    const W = 3 * VX - 2, H = 26;
    const g = new VoxelGrid(W, H, 2);
    for (let x = 1; x < W; x += 3) {
      for (let y = 2; y < H; y++) g.set(x, y, 1, 'slate');
      g.set(x, 1, 1, 'mist'); g.set(x, 0, 1, 'fog');           // teeth
    }
    for (let y = 5; y < H; y += 5) g.box(0, y, 0, W - 1, y, 1, 'shadow');
    for (let y = 5; y < H; y += 5) for (let x = 1; x < W; x += 3) g.set(x, y, 1, 'mist');
    defineModel('arena.portcullis', { grid: g, origin: [W / 2, 0, 1] });
  }
  // the exit seal: an iron disc with a rune, hung on chains over the bars
  const seal = (state) => {
    const S = 9;
    const g = new VoxelGrid(S, S, 2);
    const c = 4;
    const lit = state !== 'dark';
    const rune = state === 'gold' ? 'gold' : state === 'ember' ? 'ember' : 'blood';
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > 4.4) continue;
      g.set(x, y, 0, 'shadow');
      let col = d > 3.5 ? 'slate' : 'shadow';
      let em = false;
      if (d > 2.2 && d <= 3.2) { col = rune; em = lit; }
      if ((x === c && Math.abs(y - c) <= 2) || (y === c && Math.abs(x - c) <= 2)) { col = rune; em = lit; }
      if (d > 3.5 && (x + y) % 4 === 0) col = 'mist';
      g.set(x, y, 1, col, em);
    }
    return g;
  };
  defineModel('arena.seal.dark', { grid: seal('dark'), origin: [4.5, 4.5, 1] });
  defineModel('arena.seal.ember', { grid: seal('ember'), origin: [4.5, 4.5, 1] });
  defineModel('arena.seal.gold', { grid: seal('gold'), origin: [4.5, 4.5, 1] });
  // chains from the seal up to the arch
  {
    const g = new VoxelGrid(1, 12, 1);
    for (let y = 0; y < 12; y++) g.set(0, y, 0, y % 2 ? 'slate' : 'mist');
    defineModel('arena.chain', { grid: g, origin: [0.5, 0, 0.5] });
  }
  // gate-post runes
  const rune = (c, em) => {
    const g = new VoxelGrid(4, 5, 1);
    const pat = ['.##.', '#..#', '.##.', '..#.', '.#..'];
    pat.forEach((row, k) => { for (let x = 0; x < 4; x++) if (row[x] === '#') g.set(x, 4 - k, 0, c, em); });
    return g;
  };
  defineModel('arena.rune.dark', { grid: rune('violet', false), origin: [2, 0, 0] });
  defineModel('arena.rune.ember', { grid: rune('ember', true), origin: [2, 0, 0] });
  defineModel('arena.rune.gold', { grid: rune('gold', true), origin: [2, 0, 0] });
}
