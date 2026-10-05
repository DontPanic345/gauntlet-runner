// Arena tiles (piece `arenas`): the floor, walls, gate and exit of a room, built as a few big
// voxel models from a room layout (see arena.js for the layout and templates).
//
//   import { THEMES, buildRoomModels, buildDoorModels } from './tiles.js';
//   const names = buildRoomModels(layout);   // { floor, back, left, right, front, water: [3], glow: [n] }
//
// Coordinates: the room interior is W x D tiles of one world unit (8 voxels). The interior
// spans x in [-W/2, W/2] and z in [-D/2, D/2]; the back wall's face is at z = -D/2, the front
// parapet starts at z = +D/2. Tile (i, j) has its centre at (-W/2 + i + 0.5, -D/2 + j + 0.5).
//
// The floor model covers one tile beyond the side walls, the back wall's depth (where the exit
// stair goes down) and 3 tiles in front (the landing the hero walks in from). It is TOP voxels
// thick, so pits can go down into it. It also carries the room's shape: wall masses ('X'),
// raised ledges ('^'), pits ('_'), water ('~') and chest-high blocks ('#').
//
// Every theme is its own material: floor pattern, slab colours, wall masonry style, pit and
// water colours. Everything is authored in palette names; `look` lights, outlines and quantises it.

import { defineModel, VoxelGrid } from '../render/voxel/index.js';
import { Rng } from '../core/rng.js';

// Per-room material and dressing.
//   style       floor pattern: flag | cobble | tile | earth | basalt
//   slabs       weighted slab colours; pathSlabs: the worn path from gate to exit
//   grout       the joints;  edge: the dark contact strip at the wall foot
//   wall        masonry style: brick | block | skulls | rough | mossy;  brick: its colours, cap: capstone
//   inlay       [groove, lit lip] of the carved focal inlay
//   strata      pit wall colours by depth band;  pitFloor: [colour, emissive]
//   water       [edge, body, ripple, glint]
//   shaft       the colour of the light falling on the set-piece (default frost: cold vault light)
export const THEMES = {
  crypt: {
    label: 'CRYPT', style: 'flag',
    slabs: [['stone', 5], ['stoneLight', 3], ['slate', 1]], pathSlabs: [['stoneLight', 3], ['slate', 1]],
    grout: 'dusk', edge: 'shadow', speck: 0.004, flushGrout: true,
    wall: 'brick', brick: ['dusk', 'stone', 'stoneDark', 'dusk', 'violet', 'dusk'], cap: 'stoneLight',
    inlay: ['shadow', 'slate'], moss: 0.6, bone: 0, blood: 1, cracks: 0.7,
    strata: ['stoneLight', 'stone', 'dusk', 'night'], pitFloor: ['ink', false],
    water: ['teal', 'navy', 'blue', 'sky'], ledge: ['stoneLight', 'stone'], fore: ['dusk', 'shadow', 'stoneDark'],
    banner: ['plum', 'blood', 'gold'],
  },
  sunken: {
    label: 'SUNKEN', style: 'cobble', shaft: 'sky',
    slabs: [['slate', 6], ['mist', 2], ['stone', 2]], pathSlabs: [['mist', 3], ['slate', 2]], wetSlabs: [['teal', 4], ['moss', 2], ['slate', 2]],
    grout: 'dusk', edge: 'shadow', speck: 0,
    wall: 'mossy', brick: ['dusk', 'teal', 'shadow', 'slate', 'dusk', 'navy'], cap: 'mist',
    inlay: ['navy', 'cyan'], moss: 2.0, bone: 0, blood: 0, cracks: 0.4, puddles: 3,
    strata: ['slate', 'teal', 'navy', 'night'], pitFloor: ['ink', false],
    water: ['cyan', 'teal', 'navy', 'sky'], ledge: ['mist', 'slate'], fore: ['navy', 'dusk', 'shadow'],
    banner: ['teal', 'navy', 'frost'],
  },
  ossuary: {
    label: 'OSSUARY', style: 'earth', shaft: 'bone',
    slabs: [['dirt', 5], ['wood', 3], ['stoneDark', 2]], pathSlabs: [['bone', 3], ['frost', 1]],
    grout: 'stoneDark', edge: 'ink', speck: 0,
    wall: 'skulls', brick: ['bone', 'frost'], cap: 'woodLight',
    inlay: ['ink', 'bone'], moss: 0.15, bone: 0.006, blood: 2, cracks: 0.3,
    strata: ['dirt', 'stoneDark', 'shadow', 'ink'], pitFloor: ['ink', false],
    water: ['moss', 'shadow', 'dusk', 'leaf'], ledge: ['woodLight', 'dirt'], fore: ['dirt', 'stoneDark', 'shadow'],
    banner: ['blood', 'shadow', 'bone'],
  },
  hall: {
    label: 'HALL', style: 'tile',
    slabs: [['slate', 6], ['violet', 4], ['mist', 1]], pathSlabs: [['slate', 1]],
    grout: 'dusk', edge: 'shadow', speck: 0, flushGrout: true,
    wall: 'block', brick: ['mist', 'fog', 'slate', 'mist', 'fog'], brickHi: 'frost', cap: 'mist',
    inlay: ['navy', 'gold'], moss: 0.15, bone: 0, blood: 1, cracks: 0.35, carpet: ['navy', 'gold', 'blue'],
    strata: ['slate', 'violet', 'dusk', 'night'], pitFloor: ['ink', false],
    water: ['cyan', 'navy', 'blue', 'sky'], ledge: ['fog', 'mist'], fore: ['violet', 'dusk', 'shadow'],
    banner: ['navy', 'blue', 'gold'],
  },
  garden: {
    label: 'OVERGROWN', style: 'earth', shaft: 'torch',
    slabs: [['moss', 5], ['dirt', 3], ['leaf', 2]], pathSlabs: [['stoneLight', 3], ['stone', 2]],
    grout: 'stoneDark', edge: 'shadow', speck: 0, flags: true,
    wall: 'mossy', brick: ['stoneDark', 'dusk', 'moss', 'stone', 'dusk'], cap: 'leaf',
    inlay: ['shadow', 'stoneLight'], moss: 2.6, bone: 0, blood: 0, cracks: 0.2, grass: true,
    strata: ['wood', 'dirt', 'shadow', 'ink'], pitFloor: ['ink', false], pitStreak: 'woodLight',
    water: ['leaf', 'teal', 'moss', 'sky'], ledge: ['stoneLight', 'stone'], fore: ['moss', 'dirt', 'stoneDark'],
    banner: ['moss', 'leaf', 'gold'],
  },
  deep: {
    label: 'DEEP', style: 'basalt',
    slabs: [['dusk', 5], ['violet', 3], ['shadow', 2]], pathSlabs: [['violet', 3], ['slate', 1]],
    grout: 'night', edge: 'ink', speck: 0,
    wall: 'rough', brick: ['dusk', 'shadow', 'violet', 'shadow', 'stoneDark'], cap: 'violet',
    inlay: ['night', 'blood'], glowRing: true, moss: 0, bone: 0.004, blood: 2, cracks: 0.5, emberCracks: 10,
    strata: ['dusk', 'shadow', 'blood', 'ember'], pitFloor: ['ember', true], glowStrata: true,
    water: ['ember', 'blood', 'flame', 'gold'], ledge: ['violet', 'dusk'], fore: ['shadow', 'night', 'dusk'],
    banner: ['blood', 'ink', 'ember'],
  },
};

const VX = 8;           // voxels per tile
const TOP = 10;         // floor top layer (the floor's top face is at y = 0); pits go down to y = -TOP
const BLOCK_H = 10;     // raised block ('#') height in voxels
const LEDGE_H = 6;      // raised ledge ('^') height
const MASS_H = 20;      // wall mass ('X') height (low near the front, so it never hides the hero)
const MASS_LOW = 9;
export const WALL_H = 30;
export const SIDE_H = 22;
export const FRONT_H = 5;
export const POST_H = 15;
export const LEDGE_Y = LEDGE_H / VX;                 // world height of a ledge top (props stand on it)
export const PILASTER = 3 / VX;                     // how far a side-wall pilaster stands into the room

/** Which tile characters stop feet. 'low' ones (pit, water) let flying things over. */
export const SOLID_TILES = { '#': 'block', X: 'wall', '^': 'ledge', _: 'pit', '~': 'water' };
export const LOW_TILES = '_~';

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------
const hash2 = (x, z, s = 0) => { const n = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
function vnoise(s) {
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    return (hash2(xi, zi, s) * (1 - u) + hash2(xi + 1, zi, s) * u) * (1 - v) + (hash2(xi, zi + 1, s) * (1 - u) + hash2(xi + 1, zi + 1, s) * u) * v;
  };
}

/**
 * Irregular stones (a jittered-cell Voronoi): returns { id, edge, cz } for voxel (x, z) with
 * cells of about S voxels. edge: distance from the stone's border (0 = on the joint).
 */
function stones(S, seed) {
  return (x, z) => {
    const cx = Math.floor(x / S), cz = Math.floor(z / S);
    let d1 = 1e9, d2 = 1e9, id = 0, pz = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const gx = cx + a, gz = cz + b;
      const px = (gx + 0.15 + hash2(gx, gz, seed) * 0.7) * S, qz = (gz + 0.15 + hash2(gx, gz, seed + 1) * 0.7) * S;
      const d = Math.hypot(x + 0.5 - px, (z + 0.5 - qz) * 1.15);
      if (d < d1) { d2 = d1; d1 = d; id = gx * 7919 + gz * 104729; pz = qz; } else if (d < d2) d2 = d;
    }
    return { id, edge: (d2 - d1) / 2, cz: pz };
  };
}

/**
 * Masonry colour at face coordinates (u along the wall, v up it), for a theme's wall style.
 * Returns [colour, emissive]. seed varies brick picks between surfaces.
 */
function wallColor(T, u, v, seed = 0) {
  const B = T.brick;
  switch (T.wall) {
    case 'block': {
      // big ashlar blocks with a lit top bevel (the hall's pale marble)
      const course = Math.floor(v / 6), off = course % 2 ? 6 : 0;
      if (v % 6 === 5 || (u + off) % 12 === 11) return [T.grout, false];
      if (v % 6 === 4) return [T.brickHi ?? B[0], false];
      return [B[Math.floor(hash2(Math.floor((u + off) / 12), course, seed) * B.length)], false];
    }
    case 'skulls': {
      // the ossuary: rows of skulls set in packed earth
      const row = Math.floor(v / 5), off = row % 2 ? 3 : 0;
      const cu = (u + off) % 6, cv = v % 5;
      if (cu === 5 || cv === 4) return [(u * 3 + v) % 7 === 0 ? 'wood' : 'dirt', false];
      const pat = ['.b.b.', 'bbobb', 'bobob', 'fbbbf'][cv];
      const ch = pat[cu];
      return [ch === 'b' ? 'bone' : ch === 'f' ? 'frost' : ch === 'o' ? 'ink' : 'dirt', false];
    }
    case 'rough': {
      // basalt: irregular blocks, the odd ember vein
      const cell = Math.floor(v / 5), off = Math.floor(hash2(cell, 3, seed) * 9);
      const w = 6 + Math.floor(hash2(Math.floor((u + off) / 7), cell, seed) * 5);
      if (v % 5 === 4 || (u + off) % w === 0) return [T.grout, false];
      const c = B[Math.floor(hash2(Math.floor((u + off) / w), cell, seed + 1) * B.length)];
      if (hash2(u, v, seed + 9) < 0.012) return ['ember', true];
      return [c, false];
    }
    case 'mossy':
    case 'brick':
    default: {
      const course = Math.floor(v / 4), off = course % 2 ? 4 : 0;
      if (v % 4 === 3 || (u + off) % 8 === 7) return [T.grout, false];
      let c = B[Math.floor(hash2(Math.floor((u + off) / 8), course, seed) * B.length)];
      if (T.wall === 'mossy' && hash2(u, v, seed + 3) < Math.max(0, 0.5 - v * 0.035)) c = hash2(u, v, seed + 4) < 0.35 ? 'leaf' : 'moss';
      return [c, false];
    }
  }
}

// ---------------------------------------------------------------------------------------
// floor
// ---------------------------------------------------------------------------------------

/**
 * Floor model for a room layout. layout: { key, W, D, tiles (D rows of W chars), theme,
 * gate: [i0, i1], exit: [i0, i1], focal: {kind, i, j, r} | null, seed, pilasters }.
 */
function buildFloor(L) {
  const T = THEMES[L.theme];
  const r = new Rng(`${L.seed}/floor/${L.key}`);
  const W = L.W, D = L.D;
  const GX = (W + 2) * VX, GZ = (D + 4) * VX;   // x: one tile each side; z: one behind, three in front
  const GY = TOP + 1 + MASS_H + 3;
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
  const emissive = new Set();
  const noise = vnoise(L.index * 13 + L.W);

  // top colour and height per column, filled in passes
  const col = new Array(GX * GZ).fill(null);
  const hgt = new Int8Array(GX * GZ).fill(TOP);
  const at = (x, z) => x + GX * z;
  const set = (x, z, c, y = TOP) => { if (x >= 0 && z >= 0 && x < GX && z < GZ) { col[at(x, z)] = c; hgt[at(x, z)] = y; } };
  const get = (x, z) => (x >= 0 && z >= 0 && x < GX && z < GZ ? col[at(x, z)] : null);
  const H = (x, z) => (x >= 0 && z >= 0 && x < GX && z < GZ ? hgt[at(x, z)] : TOP);
  const special = (x, z) => { const t = tileAt(x, z); return t === '_' || t === '~' || t === 'X' || t === '^' || t === '#'; };

  // the worn path: gate to exit
  const path = (x, z) => {
    const midx = (gx0 + gx1) / 2 + ((ex0 + ex1) / 2 - (gx0 + gx1) / 2) * (1 - (z - oz) / (D * VX));
    return Math.abs(x - midx) < 7 + Math.sin(z * 0.4) * 1.5;
  };
  // distance (in voxels) to the room's walls, for moss and the contact strip
  const wallDist = (x, z) => Math.min(x - ox, ox + W * VX - 1 - x, z - oz);
  // near the focal: cracked, scattered
  const F = L.focal;
  const fcx = F ? ox + (F.i + 0.5) * VX : 0, fcz = F ? oz + (F.j + 0.5) * VX : 0;

  // 1. the base material, slab by slab
  const slabShade = (cx, cz) => r.weighted(path(cx, cz) && inRoom(cx, cz) ? T.pathSlabs : T.slabs);
  const flagRows = (rowD, widths, sunkP, bevel) => {
    for (let z0 = oz - rowD; z0 < front + 2; z0 += rowD) {
      let x0 = ox - r.int(0, widths[widths.length - 1]);
      while (x0 < GX) {
        const sw = r.pick(widths);
        const x1 = x0 + sw - 1, z1 = Math.min(front - 1, z0 + rowD - 1);
        const shade = slabShade(x0 + sw / 2, z0 + rowD / 2);
        const sunk = r.chance(sunkP);
        for (let z = Math.max(0, z0 + 1); z <= z1; z++) for (let x = Math.max(0, x0 + 1); x <= Math.min(GX - 1, x1); x++) {
          let c = shade;
          const cx = x === x0 + 1 || x === x1, cz = z === z0 + 1 || z === z1;
          if (cx && cz && r.chance(0.6)) continue;                       // rounded corners
          if ((cx || cz) && r.chance(0.03)) continue;                    // chipped edges
          if (bevel && z === z1 && r.chance(0.35)) c = bevel[shade] ?? c; // the lit near edge
          if (T.speck && r.chance(T.speck) && wallDist(x, z) < 16) c = T.grout;
          set(x, z, c, sunk ? TOP - 1 : TOP);
        }
        x0 += sw;
      }
    }
  };
  const BEVEL = { stone: 'stoneLight', dusk: 'stone', stoneLight: 'fog', slate: 'mist', teal: 'cyan', mist: 'fog', shadow: 'dusk', violet: 'slate', dirt: 'wood', moss: 'leaf' };
  if (T.style === 'flag') flagRows(12, [12, 14, 16, 18, 20, 22], 0.06, BEVEL);
  else if (T.style === 'cobble' || T.style === 'basalt') {
    // irregular stones: river cobbles in the sunken rooms, big split basalt slabs in the deep
    const big = T.style === 'basalt';
    const st = stones(big ? 10 : 7, L.index + 3);
    const wet = (x, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (tileAt(x + a * VX, z + b * VX) === '~') return true; return false; };
    const shades = new Map();
    for (let z = 0; z < front; z++) for (let x = 0; x < GX; x++) {
      const v = st(x, z);
      if (v.edge < (big ? 0.7 : 0.55)) continue;                       // the joint
      let sh = shades.get(v.id);
      if (!sh) { sh = { c: T.wetSlabs && wet(x, z) ? r.weighted(T.wetSlabs) : slabShade(x, z), sunk: hash2(v.id, 1, 3) < (big ? 0.16 : 0.1) }; shades.set(v.id, sh); }
      let c = sh.c;
      if (v.edge < (big ? 1.7 : 1.4) && z + 0.5 > v.cz) c = BEVEL[c] ?? c;   // the lit near rim of each stone
      set(x, z, c, sh.sunk ? TOP - 1 : TOP);
    }
  } else if (T.style === 'tile') {
    // square tiles, one per world tile, a quiet checker inside a border band
    for (let tj = -1; tj < D + 1; tj++) for (let ti = -1; ti < W + 1; ti++) {
      const border = ti <= 0 || ti >= W - 1 || tj <= 0;
      const shade = border ? T.slabs[1][0] : (ti + tj) % 2 === 0 ? T.slabs[0][0] : T.slabs[1][0];
      const sunk = r.chance(0.04);
      for (let dz = 1; dz < VX; dz++) for (let dx = 1; dx < VX; dx++) {
        const x = ox + ti * VX + dx, z = oz + tj * VX + dz;
        if (z >= front) continue;
        let c = shade;
        if ((dx === 1 || dx === VX - 1) && (dz === 1 || dz === VX - 1) && r.chance(0.5)) continue;
        if (dz === VX - 1 && r.chance(0.5)) c = BEVEL[shade] ?? shade;
        // a diamond inlay at the centre of every other light tile
        if (!border && (ti + tj) % 2 === 0 && (ti % 2 === 0) && Math.abs(dx - 4) + Math.abs(dz - 4) === 1) c = T.slabs[2][0];
        set(x, z, c, sunk ? TOP - 1 : TOP);
      }
    }
  } else {
    // earth: packed ground in soft blotches (never per-voxel speckle), broken flags on top
    for (let z = 0; z < front; z++) for (let x = 0; x < GX; x++) {
      const n = noise(x * 0.11, z * 0.11) * 0.7 + noise(x * 0.37 + 40, z * 0.37) * 0.3;
      const c = n < 0.38 ? T.slabs[1][0] : n > 0.66 ? T.slabs[2][0] : T.slabs[0][0];
      set(x, z, c, n > 0.72 ? TOP - 1 : TOP);
    }
    if (T.flags) {
      // islands of old paving surviving in the earth
      for (let k = 0; k < Math.round(W * D / 7); k++) {
        const cx = r.int(ox, ox + W * VX), cz = r.int(oz, front), rr = r.range(4, 9);
        for (let z = Math.floor(cz - rr); z <= cz + rr; z++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
          if (Math.hypot(x - cx, z - cz) + noise(x * 0.5, z * 0.5) * 4 > rr) continue;
          const sx = Math.floor((x - ox + 64) / 6), sz = Math.floor((z - oz + 64) / 6);
          if ((x - ox + 64) % 6 === 0 || (z - oz + 64) % 6 === 0) { set(x, z, T.grout, TOP - 1); continue; }
          set(x, z, hash2(sx, sz, 5) < 0.3 ? 'stoneLight' : 'stone', TOP);
        }
      }
    }
  }
  // grout everywhere a slab left a gap
  for (let z = 0; z < front; z++) for (let x = 0; x < GX; x++) if (!get(x, z)) set(x, z, T.grout, T.flushGrout ? TOP : TOP - 1);

  // 2. the earth floors' path: a line of laid stones (bone tiles in the ossuary)
  if (T.style === 'earth') {
    for (let z = oz; z < front; z++) for (let x = ox; x < ox + W * VX; x++) {
      if (!path(x, z)) continue;
      const midx = (gx0 + gx1) / 2 + ((ex0 + ex1) / 2 - (gx0 + gx1) / 2) * (1 - (z - oz) / (D * VX));
      if (Math.abs(x - midx) > 5) continue;
      const sx = Math.floor((x - midx + 64) / 4), sz = Math.floor(z / 4);
      if ((z % 4 === 0) || Math.floor(x - midx + 64) % 4 === 0) continue;
      if (hash2(sx, sz, 9) < 0.18) continue;                              // missing stones
      set(x, z, hash2(sx, sz, 2) < 0.3 ? T.pathSlabs[1][0] : T.pathSlabs[0][0], TOP);
    }
  }

  // 3. a carpet runner along the path (hall theme)
  if (T.carpet) {
    const [body, trim, mid] = T.carpet;
    const cx = (gx0 + gx1 + 1) / 2;
    const z0 = oz + (L.carpetFrom ?? 1) * VX + 2, z1 = front - 5;
    for (let z = z0; z <= z1; z++) for (let x = Math.round(cx - 8); x < Math.round(cx + 8); x++) {
      const e = Math.min(x - Math.round(cx - 8), Math.round(cx + 7) - x);
      if ((z === z0 || z === z1) && r.chance(0.5)) continue;       // frayed ends
      let c = e === 0 ? 'ink' : e === 1 ? trim : body;
      if (e >= 3 && Math.abs(x + 0.5 - cx) < 2 && Math.floor((z - z0) / 5) % 3 === 1) c = mid;   // a woven stripe
      if (e === 1 && z % 4 === 0) c = body;
      set(x, z, c, TOP);
    }
    // a torn hole
    for (let k = 0; k < 14; k++) { const x = Math.round(cx - 3 + r.range(-2, 2)), z = Math.round(oz + D * VX * 0.62 + r.range(-2, 2)); set(x, z, T.grout, TOP - 1); }
  }

  // 4. the focal inlay, carved: a dark groove one voxel deep with a lit lip on its far side
  if (F && F.kind !== 'none') {
    const R = F.r * VX;
    const [groove, lip] = T.inlay;
    const carve = new Set();
    for (let z = Math.floor(fcz - R - 3); z <= fcz + R + 3; z++) for (let x = Math.floor(fcx - R - 3); x <= fcx + R + 3; x++) {
      if (!inRoom(x, z) || special(x, z)) continue;
      const dx = x + 0.5 - fcx, dz = z + 0.5 - fcz, d = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      let on = false;
      if (F.kind === 'ring' || F.kind === 'rune') {
        if (d > R - 1 && d <= R + 0.6) on = Math.abs(((ang / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) < 0.46;   // broken at eight points
        if (F.kind === 'rune') {
          const k = Math.cos(4 * ang);
          const star = R * (0.52 + 0.3 * Math.abs(k) ** 3);
          if (Math.abs(d - star) < 0.6 && d < R - 2) on = true;
        } else if (d > R - 4.6 && d <= R - 3.6 && Math.floor((ang + Math.PI) / (Math.PI / 8)) % 2 === 0) on = true;
      } else if (F.kind === 'cross') {
        if ((Math.abs(dx) < 1 && Math.abs(dz) < R) || (Math.abs(dz) < 1 && Math.abs(dx) < R)) on = true;
        if (Math.abs(d - R * 0.45) < 0.6) on = true;
      } else if (F.kind === 'square') {
        const m = Math.max(Math.abs(dx), Math.abs(dz));
        if (m > R - 1 && m <= R) on = true;
      }
      if (on) carve.add(at(x, z));
    }
    for (const k of carve) {
      const x = k % GX, z = Math.floor(k / GX);
      // worn: a few voxels of the groove are filled with grit
      if (r.chance(0.06)) continue;
      set(x, z, groove, TOP - 1);
      if (!carve.has(at(x, z - 1)) && H(x, z - 1) >= TOP) set(x, z - 1, lip, TOP);   // the far lip catches light
    }
  }

  // 5. cracks: radiating from the focal (where the set-piece fell or the floor gave), then a few loose ones
  const crack = (x, z, n, dirx, dirz, glow) => {
    for (let k = 0; k < n; k++) {
      if (!inRoom(x, z) || special(x, z)) break;
      set(x, z, glow ? (k % 3 ? 'ember' : 'blood') : T.grout, TOP - 1);
      if (glow) emissive.add(at(x, z));
      if (r.chance(0.6)) { if (Math.abs(dirx) > Math.abs(dirz)) x += Math.sign(dirx); else z += Math.sign(dirz); }
      else if (r.chance(0.5)) x += r.pick([-1, 1]); else z += r.pick([-1, 1]);
    }
  };
  if (F) {
    const n = 7 + r.int(0, 3);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r.range(-0.3, 0.3), s = F.r * VX * r.range(0.9, 1.3);
      crack(Math.round(fcx + Math.cos(a) * s * 0.5), Math.round(fcz + Math.sin(a) * s * 0.5), r.int(8, 18), Math.cos(a), Math.sin(a), T.emberCracks && k % 2 === 0);
    }
  }
  const nCracks = Math.round(W * D / 9 * T.cracks);
  for (let i = 0; i < nCracks; i++) {
    crack(r.int(ox + 2, ox + W * VX - 3), r.int(oz + 2, front - 3), r.int(4, 12), r.signed(), r.signed(), T.emberCracks && i < T.emberCracks);
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
      if (special(x, z)) continue;
      let k = 0;
      for (const [px, pz, pr] of patches) k = Math.max(k, 1 - Math.hypot(x - px, (z - pz) * 1.3) / pr);
      k = Math.max(k, (2.5 - wallDist(x, z)) / 2.5 * 0.5 * T.moss);
      if (k <= 0 || (path(x, z) && k < 0.6)) continue;
      const low = H(x, z) < TOP;
      const n = noise(x * 0.3, z * 0.3);
      if (low && n < k * 1.4) set(x, z, n < k * 0.4 ? 'leaf' : 'moss', TOP - 1);
      else if (!low && n < k * k * 0.7) set(x, z, n < k * k * 0.2 ? 'leaf' : 'moss');
    }
    // grass tufts standing a voxel proud in the overgrown rooms
    if (T.grass) for (let i = 0; i < W * D * 1.2; i++) {
      const x = r.int(ox, ox + W * VX - 1), z = r.int(oz, front - 1);
      if (special(x, z) || path(x, z) || col[at(x, z)] === 'stone' || col[at(x, z)] === 'stoneLight') continue;
      set(x, z, r.chance(0.4) ? 'leaf' : 'moss', TOP + 1);
      if (r.chance(0.5)) set(x + 1, z, 'moss', TOP + 1);
    }
  }

  // 7. puddles: sunk still water with a pale glint
  for (let i = 0; i < (T.puddles || 0); i++) {
    const px = r.int(ox + 8, ox + W * VX - 8), pz = r.int(oz + 8, front - 8), pr = r.range(2.5, 5);
    for (let z = Math.floor(pz - pr); z <= pz + pr; z++) for (let x = Math.floor(px - pr * 1.5); x <= px + pr * 1.5; x++) {
      const d = Math.hypot((x - px) / 1.5, z - pz) + Math.sin(x * 0.9 + z) * 0.6;
      if (d < pr && !special(x, z)) set(x, z, d < pr - 1.2 ? (r.chance(0.04) ? 'sky' : 'navy') : 'teal', TOP - 1);
    }
  }

  // 8. old stains and bone chips
  for (let i = 0; i < (T.blood || 0); i++) {
    const sx = r.int(ox + 14, ox + W * VX - 14), sz = r.int(oz + 14, front - 12);
    if (special(sx, sz)) continue;
    const R = r.range(2.2, 3.4), a0 = r.range(0, 6.28);
    const lump = [r.range(0, 6.28), r.range(0, 6.28)];
    for (let z = Math.floor(sz - 7); z <= sz + 7; z++) for (let x = Math.floor(sx - 7); x <= sx + 7; x++) {
      if (!inRoom(x, z) || H(x, z) < TOP - 1 || special(x, z)) continue;
      const dx = x + 0.5 - sx, dz = z + 0.5 - sz, a = Math.atan2(dz, dx), d = Math.hypot(dx, dz);
      const edge = R * (1 + 0.25 * Math.sin(3 * a + lump[0]) + 0.15 * Math.sin(5 * a + lump[1]));
      const along = dx * Math.cos(a0) + dz * Math.sin(a0), across = -dx * Math.sin(a0) + dz * Math.cos(a0);
      const smear = along > 0 && along < R * 2.4 && Math.abs(across) < (1.3 - along / (R * 2.4)) * 1.6;
      if (d < edge - 0.9) set(x, z, 'blood', H(x, z));
      else if (d < edge || smear) set(x, z, 'plum', H(x, z));
    }
  }
  if (T.bone) for (let z = oz; z < front; z++) for (let x = ox; x < ox + W * VX; x++) if (!special(x, z) && r.chance(T.bone)) set(x, z, r.chance(0.5) ? 'bone' : 'frost', TOP);

  // 9. grates ('=' tiles): iron bars over a dark drain
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    if (L.tiles[j][i] !== '=') continue;
    for (let dz = 1; dz < VX - 1; dz++) for (let dx = 1; dx < VX - 1; dx++) {
      const x = ox + i * VX + dx, z = oz + j * VX + dz;
      const bar = dx % 2 === 1 || dz === 1 || dz === VX - 2;
      set(x, z, bar ? (dz === 1 ? 'mist' : 'slate') : 'ink', bar ? TOP : TOP - 3);
    }
  }

  // 10. pits and water. A pit drops to the bottom of the model; water sits two voxels down.
  //     Every floor voxel on the rim becomes a worn lip.
  const isT = (x, z, c) => tileAt(x, z) === c;
  // how far a voxel is inside its tile's run of pit (or water): the shore is ragged, never a ruler
  // line, and always inside the tiles (the collision box), so nothing seems to stand over the drop
  const inset = (x, z, c) => {
    let d = 9;
    for (let k = 0; k < 4 && d === 9; k++) if (!isT(x - k - 1, z, c) || !isT(x + k + 1, z, c) || !isT(x, z - k - 1, c) || !isT(x, z + k + 1, c)) d = k;
    return d;
  };
  const lowAt = new Uint8Array(GX * GZ);   // 1 pit, 2 water (after the ragged shore)
  for (let z = oz; z < front; z++) for (let x = ox; x < ox + W * VX; x++) {
    const t = tileAt(x, z);
    if (t !== '_' && t !== '~') continue;
    const d = inset(x, z, t);
    const keep = d < 2 && noise(x * 0.45 + 9, z * 0.45) * 2.4 > d + 0.5;
    if (!keep) lowAt[at(x, z)] = t === '_' ? 1 : 2;
  }
  const [wEdge, wBody, wRipple, wGlint] = T.water;
  const crust = stones(8, 77);
  for (let z = oz; z < front; z++) for (let x = ox; x < ox + W * VX; x++) {
    const t = lowAt[at(x, z)] === 1 ? '_' : lowAt[at(x, z)] === 2 ? '~' : null;
    if (t === '_') {
      const [pc, pe] = T.pitFloor;
      if (pe) {
        // lava: dark crust plates drifting on it, bright seams between, the odd hot boil
        const v = crust(x, z);
        let c, e = true;
        if (v.edge < 0.7) c = hash2(x, z, 31) < 0.15 ? 'gold' : 'flame';
        else if (v.edge < 1.5) c = 'ember';
        else if (v.edge < 2.1) c = 'blood';
        else { c = hash2(v.id, 2, 4) < 0.5 ? 'ink' : 'night'; e = false; }
        set(x, z, c, 0);
        if (e) emissive.add(at(x, z));
      } else {
        const n = noise(x * 0.4, z * 0.4);
        set(x, z, n > 0.8 ? 'night' : pc, 0);
      }
    } else if (t === '~') {
      // distance to the shore (in voxels, capped)
      let d = 9;
      const wat = (a, b) => lowAt[at(a, b)] === 2;
      for (let k = 1; k < 9 && d === 9; k++) if (!wat(x - k, z) || !wat(x + k, z) || !wat(x, z - k) || !wat(x, z + k)) d = k;
      const ripple = Math.sin((x * 0.35 + z * 0.9) + noise(x * 0.2, z * 0.2) * 5) > 0.86;
      const c = d <= 1 ? wEdge : d <= 2 && hash2(x, z, 7) < 0.5 ? wEdge : ripple ? wRipple : hash2(x, z, 8) < 0.012 ? wGlint : wBody;
      set(x, z, c, TOP - 2);
      if (L.theme === 'deep') emissive.add(at(x, z));
    }
  }
  // rims
  for (let z = oz; z < front; z++) for (let x = ox; x < ox + W * VX; x++) {
    const t = tileAt(x, z);
    if (lowAt[at(x, z)] || t === 'X' || t === '^' || t === '#') continue;
    let near = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = lowAt[at(x + dx, z + dz)]; if (n) near = n === 1 ? '_' : '~'; }
    if (!near) continue;
    if (near === '_') set(x, z, hash2(x, z, 4) < 0.2 ? T.ledge[1] : T.ledge[0], TOP);
    else set(x, z, hash2(x, z, 5) < 0.4 ? 'moss' : T.ledge[1], TOP);
  }

  // 11. the exit: a stair going down into the dark inside the arch
  for (let z = 0; z < oz; z++) for (let x = ex0; x <= ex1; x++) {
    const step = Math.floor((oz - 1 - z) / 2);
    set(x, z, ['stoneLight', 'stone', 'dusk', 'shadow', 'night', 'ink'][Math.min(5, step)], TOP - step);
  }
  for (let x = ex0; x <= ex1; x++) set(x, oz, x % 3 ? 'stoneLight' : 'stone', TOP);   // threshold

  // 12. the landing in front: steps rising to the gate from the corridor; void elsewhere (the
  //     front model's foreground rock covers it)
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
  for (let x = gx0; x <= gx1; x++) { set(x, front + 3, 'ink', TOP - 3); set(x, front + 2, 'mist', TOP); set(x, front + 4, 'slate', TOP); }

  // 13. the contact strip: the floor darkens along the foot of every wall (its shadow), with grit
  for (let z = oz; z < front; z++) for (let x = ox; x < ox + W * VX; x++) {
    if (special(x, z) || H(x, z) > TOP) continue;
    if ((x >= ex0 && x <= ex1 && z < oz + 2)) continue;
    let d = wallDist(x, z);
    for (const p of L.pilasters ?? []) if (z >= oz + p.j * VX - 1 && z < oz + p.j * VX + VX + 1) d = Math.min(d, p.side < 0 ? x - ox - 3 : ox + W * VX - 1 - x - 3);
    // next to wall masses too
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1]]) if (tileAt(x + dx * 2, z + dz * 2) === 'X') d = Math.min(d, 1);
    if (d <= 0) set(x, z, T.edge, H(x, z));
    else if (d === 1 && hash2(x, z, 6) < 0.6) set(x, z, T.edge, H(x, z));
    else if (d <= 2 && hash2(x, z, 6) < 0.25) set(x, z, r.pick(['stone', 'stoneLight', T.grout]), TOP + 1);
  }

  // write columns: only as deep as a neighbour can see
  for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
    const c = col[at(x, z)];
    if (!c) continue;
    const h = hgt[at(x, z)];
    let lo = h;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      const nh = nx >= 0 && nz >= 0 && nx < GX && nz < GZ && col[at(nx, nz)] ? hgt[at(nx, nz)] : (z >= front ? 0 : TOP);
      lo = Math.min(lo, nh);
    }
    for (let y = Math.max(0, lo); y < h; y++) {
      const depth = TOP - y;
      const band = depth <= 2 ? 0 : depth <= 5 ? 1 : depth <= 8 ? 2 : 3;
      let sc = T.strata[band];
      if (hash2(x + y * 3, z, 11) < 0.18) sc = T.strata[Math.min(3, band + 1)];
      if (T.pitStreak && hash2(x, z, 12) < 0.12 && depth > 1) sc = depth % 3 ? T.pitStreak : 'moss';
      const glow = T.glowStrata && band >= 2;
      g.set(x, y, z, sc, glow);
    }
    g.set(x, h, z, c, emissive.has(at(x, z)) && ['ember', 'blood', 'flame', 'gold'].includes(c));
  }

  // 14. raised blocks ('#'), ledges ('^') and wall masses ('X')
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    const t = L.tiles[j][i];
    if (t !== '#' && t !== '^' && t !== 'X') continue;
    const same = (dx, dz) => L.tiles[j + dz]?.[i + dx] === t;
    const hgtT = t === '#' ? BLOCK_H : t === '^' ? LEDGE_H : (j >= D - 3 ? MASS_LOW : MASS_H);
    for (let dz = 0; dz < VX; dz++) for (let dx = 0; dx < VX; dx++) {
      const x = ox + i * VX + dx, z = oz + j * VX + dz;
      const inset = t === '#' && ((!same(-1, 0) && dx === 0) || (!same(1, 0) && dx === VX - 1) || (!same(0, -1) && dz === 0) || (!same(0, 1) && dz === VX - 1));
      // a mass's silhouette is ragged where it meets the floor, so the room reads carved, not boxed
      let hTop = TOP + hgtT - (inset ? 1 : 0);
      if (t === 'X') {
        const openN = !same(0, 1) && L.tiles[j + 1]?.[i] !== undefined, openE = !same(1, 0) && i < W - 1, openW = !same(-1, 0) && i > 0;
        const edgeD = Math.min(openN ? VX - 1 - dz : 99, openE ? VX - 1 - dx : 99, openW ? dx : 99);
        if (edgeD === 0 && hash2(x, z, 13) < 0.35) hTop -= 1 + Math.floor(hash2(x, z, 14) * 3);
      }
      const faceU = x, faceV0 = TOP + 1;
      for (let y = TOP + 1; y <= hTop; y++) {
        const [c, em] = wallColor(T, faceU + z * (t === 'X' ? 0 : 1), y - faceV0, i * 7 + j);
        g.set(x, y, z, c, em);
      }
      // the top: capstones on masses and blocks, laid slabs on ledges
      const topC = t === '^' ? (((dx + 64) >> 2) + ((dz + 64) >> 2)) % 2 ? T.ledge[0] : T.ledge[1]
        : hash2(x, z, 15) < 0.75 ? T.cap : 'stone';
      g.set(x, hTop, z, topC);
      if (t === 'X' && hash2(x, z, 16) < 0.08) g.set(x, hTop + 1, z, hash2(x, z, 17) < 0.5 ? 'moss' : 'stone');
      if (t === 'X' && T.moss > 1 && hash2(x, z, 18) < 0.25) g.set(x, hTop, z, hash2(x, z, 19) < 0.4 ? 'leaf' : 'moss');
      if (t === '^' && !same(0, 1) && dz === VX - 1) { g.set(x, hTop, z, 'stoneLight'); g.set(x, TOP + 1, z, T.edge); }   // the lit lip, the dark foot
      if (!same(0, 1) && dz === VX - 1 && hash2(x, z, 20) < 0.25 && T.moss > 0) g.set(x, TOP + 1, z, hash2(x, z, 21) < 0.3 ? 'leaf' : 'moss');
    }
  }
  return { grid: g, origin: [ox + (W / 2) * VX, TOP + 1, oz + (D / 2) * VX] };
}

// ---------------------------------------------------------------------------------------
// water shimmer: three sparse frames of glints and ripple lines over the water tiles, cycled
// by the arena so the surface is never still
// ---------------------------------------------------------------------------------------
function buildWaterFrames(L) {
  const T = THEMES[L.theme];
  const W = L.W, D = L.D;
  const cells = [];
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) if (L.tiles[j][i] === '~') cells.push([i, j]);
  if (!cells.length) return null;
  const isW = (i, j) => L.tiles[j]?.[i] === '~';
  return [0, 1, 2].map((k) => {
    const g = new VoxelGrid(W * VX, 1, D * VX);
    for (const [i, j] of cells) for (let dz = 0; dz < VX; dz++) for (let dx = 0; dx < VX; dx++) {
      const x = i * VX + dx, z = j * VX + dz;
      const edge = (!isW(i - 1, j) && dx < 2) || (!isW(i + 1, j) && dx > VX - 3) || (!isW(i, j - 1) && dz < 2) || (!isW(i, j + 1) && dz > VX - 3);
      if (edge) continue;
      // short horizontal ripple dashes that slide one step per frame, and twinkling glints
      const band = (z + Math.floor(x / 9) * 3) % 7;
      const slide = (x + k * 3 + band * 5) % 14;
      if (band === 0 && slide < 3) g.set(x, 0, z, slide === 1 ? T.water[3] : T.water[2], L.theme === 'deep');
      else if (hash2(x, z, 30 + k) < 0.006) g.set(x, 0, z, T.water[3], true);
    }
    return { grid: g, origin: [0, 0, 0] };
  });
}

// ---------------------------------------------------------------------------------------
// back wall: masonry in the theme's style, the exit arch, sconces, alcoves, chains, crumbled patches
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
      let [c, em] = wallColor(T, x, y, 1);
      if (c === T.grout) continue;                     // recessed mortar
      if (y === 0) { c = T.edge; em = false; }
      g.set(x, y, front, c, em);
    }
    // capstones
    const y = top[x];
    g.box(x, y, 0, x, y, front, x % 8 === 7 ? T.grout : T.cap);
    g.set(x, y, 0, 'stone');
    if (r.chance(0.12)) g.set(x, y + 1, r.int(0, front), 'stone');
    // moss at the foot
    for (let yy = 0; yy < 5; yy++) if (r.chance((0.45 - yy * 0.09) * Math.min(1.5, 0.2 + T.moss * 0.5))) g.set(x, yy, front, r.chance(0.35) ? 'leaf' : 'moss');
  }
  // pilasters every few tiles break the long face into bays
  for (let i = 0; i <= W; i += L.bay || 4) {
    const x0 = ox + i * VX - 2;
    if (tcol(x0 + 2) === 'E' || tcol(x0 - 1) === 'E') continue;
    for (let y = 0; y < top[Math.max(0, x0)]; y++) for (let x = x0; x < x0 + 4; x++) {
      if (x < 0 || x >= GX) continue;
      const mortar = y % 6 === 5;
      g.set(x, y, front + 1, y < 2 ? T.cap : mortar ? T.grout : (x === x0 ? T.brick[1 % T.brick.length] : T.brick[0]));
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
      g.box(x - 3, 5, front - 1, x + 3, 5, front + 1, T.cap);   // sill
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
    } else if (f === 'r') {
      // roots breaking through the wall and hanging down it (the overgrown rooms)
      for (let k = 0; k < 3; k++) {
        let xx = x + r.int(-3, 3), y = top[x] - 1;
        const len = r.int(10, 22);
        for (let s = 0; s < len && y > 0; s++, y--) {
          g.set(xx, y, front + 1, s % 5 === 4 ? 'woodLight' : 'wood');
          if (r.chance(0.25)) xx += r.pick([-1, 1]);
          if (r.chance(0.15)) g.set(xx + r.pick([-1, 1]), y, front + 1, 'leaf');
        }
      }
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

// side walls, seen nearly from above: capstones in the theme's colours, the odd broken run, and
// pilasters standing into the room every few tiles, whose camera-facing ends show the masonry
function buildSide(L, sideSign) {
  const T = THEMES[L.theme];
  const r = new Rng(`${L.seed}/side${sideSign}/${L.key}`);
  const Dv = L.D * VX + 6;
  const P = 3;                                        // pilaster depth in voxels
  const OUT = 3 * VX;                                  // rough rock outside the wall, so no void shows beside a narrow room
  const GXs = OUT + VX + P;
  const g = new VoxelGrid(GXs, SIDE_H + 2, Dv);
  const wx0 = sideSign < 0 ? OUT : P;                  // the wall body's columns
  const inner = sideSign < 0 ? wx0 + VX - 1 : P;       // the wall's inner face column
  const brk = L.sideBreak ? r.int(Math.floor(Dv * 0.35), Math.floor(Dv * 0.6)) : -99;
  // the rock beyond: a little lower than the wall top, dark, rough, mossy in the green rooms
  const noise = vnoise(L.W * 5 + sideSign);
  const ox0 = sideSign < 0 ? 0 : P + VX;
  for (let z = 0; z < Dv; z++) for (let x = ox0; x < ox0 + OUT; x++) {
    const n = noise(x * 0.2, z * 0.2);
    const h = SIDE_H - 4 + Math.round(n * 4) - (z >= Dv - 6 ? Math.round((z - (Dv - 6)) * 2.3) : 0);
    for (let y = 0; y < h; y++) g.set(x, y, z, T.fore[2]);
    g.set(x, h, z, n > 0.6 ? T.fore[0] : n > 0.3 ? T.fore[1] : T.fore[2]);
    const mn = noise(x * 0.3 + 70, z * 0.3);
    if (T.moss > 0.5 && mn > 1 - 0.14 * T.moss) g.set(x, h, z, mn > 1 - 0.05 * T.moss ? 'leaf' : 'moss');
  }
  for (let z = 0; z < Dv; z++) {
    let h = SIDE_H - Math.round(r.next() * 1.4);
    if (Math.abs(z - brk) < 7) h = Math.max(6, h - Math.round((7 - Math.abs(z - brk)) * 1.6 + r.next() * 2));
    if (z >= Dv - 6) h = Math.max(FRONT_H + 2, Math.round(h - (z - (Dv - 6)) * 2.3));   // step down to the parapet
    for (let y = 0; y < h; y++) for (let x = wx0; x < wx0 + VX; x++) {
      const [c, em] = wallColor(T, z, y, 2 + sideSign);
      g.set(x, y, z, x === inner && y < 2 ? T.edge : c, em);
    }
    // capstones laid in a row: one joint every eight voxels, no speckle
    for (let x = wx0; x < wx0 + VX; x++) g.set(x, h, z, z % 8 === 7 ? T.grout : (x === wx0 || x === wx0 + VX - 1) ? 'stone' : T.cap);
    if (r.chance(0.08)) g.set(wx0 + r.int(0, VX - 1), h + 1, z, r.chance(0.5) ? 'moss' : 'stone');
    g.set(inner, h, z, 'stoneLight');                 // the inner lip catches light
    if (T.moss > 1 && r.chance(0.3)) g.set(inner, h, z, r.chance(0.4) ? 'leaf' : 'moss');
  }
  // pilasters: P voxels into the room, one tile long, a capital and a dark foot
  for (const p of L.pilasters ?? []) {
    if (p.side !== sideSign) continue;
    const z0 = p.j * VX + 2, z1 = z0 + VX - 5;
    const px0 = sideSign < 0 ? OUT + VX : 0, px1 = px0 + P - 1;
    const ph = SIDE_H - 4;
    for (let z = z0; z <= z1; z++) for (let x = px0; x <= px1; x++) for (let y = 0; y < ph; y++) {
      const front = z === z1;
      let c = y % 5 === 4 ? T.grout : front ? wallColor(T, x + 40, y, 7)[0] : T.brick[0];
      if (y < 2) c = T.cap;
      g.set(x, y, z, c);
    }
    for (let z = z0 - 1; z <= z1 + 1; z++) for (let x = px0 - (sideSign < 0 ? 0 : 0); x <= px1; x++) g.set(x, ph, z, T.cap);
    // an iron ring on the face, or a hanging chain
    const fx = sideSign < 0 ? px0 + 1 : px1 - 1;
    if (r.chance(0.5)) { g.set(fx, ph - 5, z1 + 0, 'slate'); g.set(fx, ph - 6, z1, 'mist'); }
  }
  return { grid: g, origin: [sideSign < 0 ? OUT + VX / 2 : P + VX / 2, 0, 0] };
}

// front parapet: a low wall with the gate gap between two posts, and in front of it the
// foreground: a band of broken rock that frames the bottom of the screen, so there is no void
function buildFront(L) {
  const T = THEMES[L.theme];
  const r = new Rng(`${L.seed}/front/${L.key}`);
  const M = 3 * VX;                                   // reaches past the side walls' outer rock
  const W = L.W, GX = (W + 2) * VX + 2 * M, Dz = 6, FZ = 3 * VX + 4;
  const g = new VoxelGrid(GX, POST_H + 3, Dz + FZ);
  const ox = VX + M;
  const gx0 = ox + L.gate[0] * VX, gx1 = ox + (L.gate[1] + 1) * VX - 1;
  for (let x = M; x < GX - M; x++) {
    if (x >= gx0 && x <= gx1) continue;
    const post = (x >= gx0 - VX && x < gx0) || (x > gx1 && x <= gx1 + VX);
    const h = post ? POST_H : FRONT_H + (r.chance(0.1) ? 1 : 0);
    for (let z = 0; z < Dz; z++) for (let y = 0; y < h; y++) {
      let c;
      if (y === h - 1) c = r.chance(0.2) ? 'stone' : T.cap;
      else if (post) c = (y % 3 === 2) ? T.grout : (x === gx0 - VX || x === gx1 + VX) ? 'dusk' : 'stone';
      else c = wallColor(T, x, y, 5)[0];
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
  // the foreground: rough rock a little lower than the parapet, either side of the landing stair
  const noise = vnoise(L.W * 3 + L.index);
  const [f0, f1, f2] = T.fore;
  for (let z = 0; z < Dz + FZ; z++) for (let x = 0; x < GX; x++) {
    if (x >= gx0 - 4 && x <= gx1 + 4) continue;
    if (z < Dz && x >= M && x < GX - M) continue;           // the parapet itself
    const n = noise(x * 0.18, z * 0.18);
    const h = FRONT_H - 1 + Math.round(n * 3 - (z - Dz) * 0.05);
    for (let y = 0; y < h; y++) g.set(x, y, z, y === h - 1 ? (n > 0.62 ? f0 : n > 0.35 ? f1 : f2) : f2);
    const mn = noise(x * 0.3 + 50, z * 0.3);
    if (T.moss > 0.5 && mn > 1 - 0.14 * T.moss) g.set(x, h - 1, z, mn > 1 - 0.05 * T.moss ? 'leaf' : 'moss');
  }
  // the stair's walls
  for (let z = Dz; z < Dz + FZ; z++) for (const x of [gx0 - 4, gx1 + 4]) for (let y = 0; y < FRONT_H + 1; y++) g.set(x, y, z, y === FRONT_H ? T.cap : 'stoneDark');
  return { grid: g, origin: [ox + (W / 2) * VX, 0, 0] };
}

// The pulsing segments of a glowing inlay (the Maw's rune ring): n arcs, each its own model,
// so the arena can light them in a chase. Only for themes with an emissive lip.
function buildGlowSegments(L) {
  const F = L.focal, T = THEMES[L.theme];
  if (!F || F.kind !== 'rune' || !T.glowRing) return null;
  const R = F.r * VX, n = 8;
  const size = Math.ceil(R * 2 + 4);
  const segs = [];
  for (let s = 0; s < n; s++) {
    const g = new VoxelGrid(size, 1, size);
    const c = size / 2;
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c, dz = z + 0.5 - c, d = Math.hypot(dx, dz);
      if (d <= R - 1 || d > R + 0.6) continue;
      let a = Math.atan2(dz, dx); if (a < 0) a += Math.PI * 2;
      if (Math.floor(a / (Math.PI * 2 / n)) !== s) continue;
      if (Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) >= 0.46) continue;
      g.set(x, 0, z, (x + z) % 3 ? 'ember' : 'flame', true);
    }
    segs.push({ grid: g, origin: [c, 1, c] });
  }
  return segs;
}

/** Define the room models for a layout. Cached by layout key. Returns their names. */
const builtRooms = new Map();
export function buildRoomModels(L) {
  if (builtRooms.has(L.key)) return builtRooms.get(L.key);
  const names = { floor: `arena.floor.${L.key}`, back: `arena.back.${L.key}`, left: `arena.left.${L.key}`, right: `arena.right.${L.key}`, front: `arena.front.${L.key}`, water: null, glow: null };
  defineModel(names.floor, buildFloor(L));
  defineModel(names.back, buildBack(L));
  defineModel(names.left, buildSide(L, -1));
  defineModel(names.right, buildSide(L, 1));
  defineModel(names.front, buildFront(L));
  const wf = buildWaterFrames(L);
  if (wf) names.water = wf.map((spec, k) => { const n = `arena.water.${L.key}.${k}`; defineModel(n, spec); return n; });
  const gs = buildGlowSegments(L);
  if (gs) names.glow = gs.map((spec, k) => { const n = `arena.glow.${L.key}.${k}`; defineModel(n, spec); return n; });
  builtRooms.set(L.key, names);
  return names;
}

// ---------------------------------------------------------------------------------------
// doors: the entry gate (spikes that slam up out of a floor slot), the exit portcullis and
// its seal, and the rune plates on the gate posts
// ---------------------------------------------------------------------------------------
export const GATE_H = 19;   // the spikes' height in voxels
let doorsBuilt = false;
export function buildDoorModels() {
  if (doorsBuilt) return;
  doorsBuilt = true;
  {
    const W = 3 * VX, H = GATE_H;
    const g = new VoxelGrid(W, H, 2);
    for (let x = 1; x < W; x += 3) {
      const tall = (x % 2 === 1) ? 0 : 2;                   // alternate spikes stand a little lower
      for (let y = 0; y < H - 2 - tall; y++) g.set(x, y, 1, y % 5 === 0 ? 'mist' : 'slate');
      g.set(x, H - 2 - tall, 1, 'fog'); g.set(x, H - 1 - tall, 1, 'frost');   // sharpened tips
      g.set(x, H - 2 - tall, 0, 'mist');
    }
    for (const y of [2, 8, 13]) g.box(0, y, 0, W - 1, y, 1, 'shadow');
    for (const y of [2, 8, 13]) for (let x = 1; x < W; x += 6) g.set(x, y, 1, 'fog');   // rivets
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
  defineModel('arena.rune.red', { grid: rune('red', true), origin: [2, 0, 0] });
  defineModel('arena.rune.gold', { grid: rune('gold', true), origin: [2, 0, 0] });
}
