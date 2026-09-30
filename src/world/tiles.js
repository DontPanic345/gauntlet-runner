// Arena floor and wall voxel builders (piece `arenas`).
//
// A room is laid out on a tile grid (1 tile = 1 world unit = 8 voxels; see arena.js for the
// templates). This module turns a parsed layout into voxel models, all registered with
// defineModel under a per-room prefix so every room is meshed once:
//
//   buildRoomModels(prefix, L, rng) -> { floor, back, sideL, sideR, front, frame, blocks, apron }
//     model names; place each at the room origin (0, 0, 0): they are authored in room space.
//   PORTCULLIS.exit / PORTCULLIS.gate   the two door grilles (shared by every room)
//   RUNES.off / red / gold             the exit arch's rune ring in its three moods
//
// Room space: interior x in [-W/2, W/2], z in [-D/2, D/2], floor top at y = 0. The back wall's
// brick face is at z = -D/2, the camera looks from +z. The exit is an arch in the back wall
// with a stair going down behind it; the entry gate is a gap in the low front parapet.
//
// Look rules: palette names only, hard voxel edges, no gradients. Detail comes from shade
// choice per slab/brick, grout the mesher's AO darkens, and a few sparse accents (moss, blood,
// wax, scorch) placed where a mason or a fight would have left them.

import { defineModel, VoxelGrid } from '../render/voxel/index.js';

export const T = 8;            // voxels per tile
export const PIT_DEPTH = 20;   // voxels the pit walls go down (fog swallows the rest)
export const WALL_H = 30;      // back wall height, voxels
export const SIDE_H = 20;      // side wall height
export const FRONT_H = 6;      // front parapet height
export const ARCH = { w: 16, h: 22 };   // exit opening, voxels
export const GATE = { w: 16, post: 6, h: 18, bars: 12 };   // posts are h tall; the bars rise bars high

// ---- themes: shade tables and accents ------------------------------------------------
export const THEMES = {
  crypt: {
    brick: ['stone', 'stoneLight', 'stone', 'slate', 'stone', 'violet', 'stoneLight'],
    slab: [['stone', 8], ['dusk', 3], ['stoneLight', 1]],
    cobble: ['stoneDark', 'dusk', 'stone', 'dusk'],
    banner: ['plum', 'blood', 'gold'], moss: 1, blood: 1, wax: 0.6, scorch: 0.3, bones: 0.4, niches: 0,
  },
  ossuary: {
    brick: ['stone', 'violet', 'stoneLight', 'slate', 'stone', 'violet', 'stone'],
    slab: [['dusk', 6], ['stone', 5], ['violet', 1]],
    cobble: ['stoneDark', 'violet', 'dusk', 'stoneDark'],
    banner: ['blood', 'plum', 'bone'], moss: 0.4, blood: 1.6, wax: 1, scorch: 0.1, bones: 1.6, niches: 1,
  },
  forge: {
    brick: ['stone', 'stoneLight', 'stone', 'dirt', 'stone', 'stoneLight', 'wood'],
    slab: [['stone', 7], ['stoneDark', 3], ['stoneLight', 1], ['dirt', 1]],
    cobble: ['stoneDark', 'dirt', 'stone', 'stoneDark'],
    banner: ['blood', 'red', 'gold'], moss: 0.2, blood: 0.6, wax: 0.2, scorch: 1.6, bones: 0.3, niches: 0,
  },
  sunken: {
    brick: ['stone', 'slate', 'violet', 'stoneLight', 'stone', 'moss', 'slate'],
    slab: [['dusk', 6], ['stone', 5], ['slate', 1]],
    cobble: ['stoneDark', 'moss', 'dusk', 'stoneDark'],
    banner: ['teal', 'navy', 'frost'], water: 1, moss: 2.6, blood: 0.3, wax: 0.3, scorch: 0, bones: 0.5, niches: 0,
  },
  shrine: {
    brick: ['stoneLight', 'violet', 'stone', 'slate', 'stoneLight', 'violet', 'fog'],
    slab: [['stone', 6], ['stoneLight', 3], ['dusk', 2]],
    cobble: ['stoneDark', 'violet', 'stone', 'dusk'],
    banner: ['navy', 'blue', 'gold'], moss: 0.5, blood: 0.8, wax: 1.4, scorch: 0.2, bones: 0.4, niches: 1,
  },
};

const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

// ---- floor ------------------------------------------------------------------------------
// Three kinds of paving, like a real crypt floor that was laid, then worn, then fought on:
//   border   small cobbles in a band along every wall (and round masonry blocks)
//   path     big square slabs with a trim edge on the axis from the gate to the exit
//   field    staggered courses of flagstones of mixed width, the odd one sunk or lifted
// then an inlaid ring round the focal point, pit rims, and decor (cracks, moss, blood, wax,
// scorch) weighted toward where it would gather.
function buildFloor(name, L, rng) {
  const { W, D, theme: TH } = L;
  const X = W * T, Z = D * T, top = PIT_DEPTH + 3;
  const g = new VoxelGrid(X, PIT_DEPTH + 4, Z);
  const cell = (tx, tz) => (tx < 0 || tz < 0 || tx >= W || tz >= D ? '#' : L.cells[tz][tx]);
  const isPit = (tx, tz) => cell(tx, tz) === '~';
  const solid = (tx, tz) => cell(tx, tz) === '#';
  // which tiles are border (touch a wall or a block; pits get their own rim)
  const border = (tx, tz) => !isPit(tx, tz) && (tx === 0 || tz === 0 || tx === W - 1 || tz === D - 1 || solid(tx - 1, tz) || solid(tx + 1, tz) || solid(tx, tz - 1) || solid(tx, tz + 1));
  const onPath = (tx, tz) => L.path && L.path[tz]?.[tx];
  const pitRim = (tx, tz) => !isPit(tx, tz) && (isPit(tx - 1, tz) || isPit(tx + 1, tz) || isPit(tx, tz - 1) || isPit(tx, tz + 1));

  // base: a dark bed under every non-pit tile (it is the grout colour)
  for (let tz = 0; tz < D; tz++) for (let tx = 0; tx < W; tx++) {
    if (isPit(tx, tz)) continue;
    g.box(tx * T, PIT_DEPTH, tz * T, tx * T + T - 1, top - 1, tz * T + T - 1, 'stoneDark');
  }
  const put = (x, z, c, y = top) => { if (x >= 0 && z >= 0 && x < X && z < Z) g.set(x, y, z, c); };

  // field flagstones: courses 8 deep, widths 8..20, staggered, clipped to field tiles
  for (let z0 = 0, cd = 12; z0 < Z; z0 += cd, cd = rng.pick([10, 12, 12, 16])) {
    let x0 = -rng.int(0, 10);
    while (x0 < X) {
      const sw = rng.pick([8, 12, 12, 16, 10, 20]);
      const shade = rng.weighted(TH.slab);
      const lift = rng.chance(0.05) ? -1 : 0;                  // the odd sunk slab
      for (let z = z0 + 1; z < Math.min(Z, z0 + cd); z++) for (let x = Math.max(0, x0 + 1); x < Math.min(X, x0 + sw); x++) {
        const tx = x >> 3, tz = z >> 3;
        if (isPit(tx, tz) || border(tx, tz) || onPath(tx, tz)) continue;
        let c = shade;
        const f = rng.next();
        if (f < 0.02) c = 'stoneLight'; else if (f < 0.04) c = 'stoneDark';
        const ex = x === x0 + 1 || x === x0 + sw - 1, ez = z === z0 + 1 || z === z0 + cd - 1;
        if (ex && ez && rng.chance(0.55)) continue;             // chipped corner
        if ((ex || ez) && rng.chance(0.03)) continue;           // bitten edge
        if (z === z0 + cd - 1 && c === shade && rng.chance(0.3)) c = shade === 'dusk' ? 'stone' : shade === 'stone' ? 'stoneLight' : c; // worn front lip
        put(x, z, c, top + lift);
      }
      x0 += sw;
    }
  }
  // border cobbles: 4x4 setts, alternately offset, darker, with mud in the joints
  for (let tz = 0; tz < D; tz++) for (let tx = 0; tx < W; tx++) {
    if (!border(tx, tz) || onPath(tx, tz)) continue;
    for (let z = tz * T; z < tz * T + T; z++) for (let x = tx * T; x < tx * T + T; x++) {
      const row = z >> 2, off = row % 2 ? 2 : 0;
      const bx = (x + off) >> 2;
      if ((x + off) % 4 === 0 || z % 4 === 0) { if (rng.chance(0.12)) put(x, z, 'dirt', top - 1); continue; }
      const c = TH.cobble[Math.floor(hash(bx, row, 7) * TH.cobble.length)];
      put(x, z, c, hash(bx, row, 3) < 0.12 ? top - 1 : top);
    }
  }
  // path: 16x16 slabs (two tiles) with a slate trim, running gate -> exit
  if (L.path) {
    for (let tz = 0; tz < D; tz++) for (let tx = 0; tx < W; tx++) {
      if (!onPath(tx, tz)) continue;
      const sx = Math.floor(tx / 2) * 2, sz = Math.floor(tz / 2) * 2;
      const shade = hash(sx, sz, 11) < 0.25 ? 'stone' : 'stoneLight';
      for (let z = tz * T; z < tz * T + T; z++) for (let x = tx * T; x < tx * T + T; x++) {
        const lx = x - sx * T, lz = z - sz * T;
        if (lx === 0 || lz === 0) continue;                        // grout
        const trim = lx === 1 || lz === 1 || lx === 15 || lz === 15;
        let c = trim ? 'slate' : shade;
        if (!trim && hash(x, z, 5) < 0.05) c = shade === 'stone' ? 'dusk' : 'stone';
        // a carved chevron in every slab, pointing to the exit
        const cx = lx - 8, cz = lz - 6;
        if (!trim && cz >= 0 && cz < 4 && Math.abs(Math.abs(cx) + 0.5 - cz) < 1) c = shade === 'stone' ? 'dusk' : 'stone';
        put(x, z, c);
      }
      // outer kerb: a slate line along the path's sides, where it meets the field
      for (let z = tz * T; z < tz * T + T; z++) {
        if (!onPath(tx - 1, tz) && tx > 0) put(tx * T - 1, z, 'slate');
        if (!onPath(tx + 1, tz) && tx < W - 1) put(tx * T + T, z, 'slate');
      }
    }
  }
  // inlaid ring round the focal point, with rune notches, and a darker disc inside it
  if (L.ring) {
    const [rcx, rcz, R] = L.ring; const cx = rcx * T, cz = rcz * T, RV = R * T;
    for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (!g.get(x, top, z) && !(d > RV - 1.2 && d <= RV + 1.2)) continue;
      if (isPit(x >> 3, z >> 3)) continue;
      if (d > RV - 1.2 && d <= RV + 1.2) {
        const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
        const notch = Math.abs(((a / (Math.PI / 6)) % 1 + 1) % 1 - 0.5) > 0.44;
        put(x, z, notch ? 'stoneLight' : 'slate');
      } else if (d > RV - 3.2 && d <= RV - 1.2 && g.get(x, top, z)) put(x, z, 'dusk');
    }
  }
  // pits: the rim is a lighter lip, broken in places; the walls go down in dark courses
  for (let tz = 0; tz < D; tz++) for (let tx = 0; tx < W; tx++) {
    if (!pitRim(tx, tz)) continue;
    for (let z = tz * T; z < tz * T + T; z++) for (let x = tx * T; x < tx * T + T; x++) {
      const nearPit = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) => isPit((x + dx) >> 3, (z + dz) >> 3));
      if (!nearPit) continue;
      // lip
      if (rng.chance(0.08)) put(x, z, null); else put(x, z, rng.chance(0.2) ? 'stone' : 'stoneLight');
      // wall courses down
      for (let y = 0; y < top; y++) {
        const course = Math.floor((top - y) / 3);
        const joint = y % 3 === 0 || ((x + z + course * 2) % 7 === 0);
        g.set(x, y, z, joint ? 'shadow' : course < 2 ? 'stone' : course < 4 ? 'dusk' : 'stoneDark');
      }
      if (rng.chance(0.05)) for (let y = top - 1; y > top - 6; y--) g.set(x, y, z, 'moss');   // drip of moss
    }
  }
  // standing water in the pits (the cistern): dark, with a few pale glints and floating scum
  if (TH.water) {
    const wy = top - 5;
    for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
      if (!isPit(x >> 3, z >> 3)) continue;
      const f = hash(x, z, 21);
      g.set(x, wy, z, f < 0.03 ? 'cyan' : f < 0.12 ? 'teal' : (x + z * 3) % 11 === 0 ? 'teal' : 'navy');
      if (hash(x >> 1, z >> 1, 22) < 0.05) g.set(x, wy, z, 'moss');
    }
  }
  // ---- decor ----------------------------------------------------------------------------
  // cracks: short random walks that cut the top layer (not on the path's trims)
  const nCracks = Math.round((W * D) / 11);
  for (let i = 0; i < nCracks; i++) {
    let x = rng.int(2, X - 3), z = rng.int(2, Z - 3);
    const n = rng.int(3, 10);
    for (let k = 0; k < n; k++) {
      if (!isPit(x >> 3, z >> 3) && g.get(x, top, z)) put(x, z, null);
      if (rng.chance(0.5)) x += rng.pick([-1, 1]); else z += rng.pick([-1, 1]);
    }
  }
  // moss: patches that start at walls, blocks, pillars and pits and fill grout first
  const seeds = [];
  const nMoss = Math.round(TH.moss * (W + D) / 3);
  for (let i = 0; i < nMoss; i++) {
    const wall = rng.pick(['back', 'side', 'side', 'prop']);
    if (wall === 'back') seeds.push([rng.int(0, X - 1), rng.int(0, 10), rng.range(5, 11)]);
    else if (wall === 'side') seeds.push([rng.chance(0.5) ? rng.int(0, 8) : rng.int(X - 9, X - 1), rng.int(0, Z - 1), rng.range(5, 10)]);
    else if (L.anchors.length) { const a = rng.pick(L.anchors); seeds.push([a[0] * T + rng.int(-3, 3), a[1] * T + rng.int(-3, 3), rng.range(4, 8)]); }
  }
  for (const [px, pz, pr] of seeds) {
    for (let z = Math.max(0, Math.floor(pz - pr)); z < Math.min(Z, pz + pr); z++) for (let x = Math.max(0, Math.floor(px - pr)); x < Math.min(X, px + pr); x++) {
      const k = 1 - Math.hypot(x - px, (z - pz) * 1.3) / pr;
      if (k <= 0 || isPit(x >> 3, z >> 3)) continue;
      if (!g.get(x, top, z)) { if (rng.next() < k * 1.5) put(x, z, rng.chance(0.3) ? 'leaf' : 'moss'); }
      else if (rng.next() < k * k * 0.45) put(x, z, rng.chance(0.2) ? 'leaf' : 'moss');
    }
  }
  // old blood: a pool and a drag trail, in the open
  const nBlood = Math.round(TH.blood * 1.6 + rng.next());
  for (let i = 0; i < nBlood; i++) {
    let bx = rng.int(T * 2, X - T * 2), bz = rng.int(T * 2, Z - T * 2);
    const rad = rng.range(3, 6);
    for (let k = 0; k < 70; k++) {
      const a = rng.range(0, 6.28), d = Math.sqrt(rng.next()) * rad;
      const x = Math.round(bx + Math.cos(a) * d * 1.3), z = Math.round(bz + Math.sin(a) * d);
      if (g.get(x, top, z) && !isPit(x >> 3, z >> 3)) put(x, z, d < rad * 0.45 ? 'blood' : rng.chance(0.5) ? 'blood' : 'plum');
    }
    // the drag: spots along a wobbling line
    const ang = rng.range(0, 6.28); let dx = Math.cos(ang), dz = Math.sin(ang);
    for (let k = 0; k < 26; k++) {
      bx += dx * 1.2; bz += dz * 1.2; dx += rng.signed() * 0.2; dz += rng.signed() * 0.2;
      const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      if (rng.chance(0.55)) { const x = Math.round(bx + rng.signed()), z = Math.round(bz + rng.signed()); if (g.get(x, top, z)) put(x, z, rng.chance(0.3) ? 'plum' : 'blood'); }
    }
  }
  // scorch round the braziers; wax round the candles; bone dust round the bone piles
  for (const [kind, tx, tz] of L.decals) {
    const cx = (tx + 0.5) * T, cz = (tz + 0.5) * T;
    const n = kind === 'scorch' ? 110 * TH.scorch + 30 : kind === 'wax' ? 30 * TH.wax + 8 : 26;
    const rad = kind === 'scorch' ? 9 : kind === 'wax' ? 5 : 6;
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, 6.28), d = Math.sqrt(rng.next()) * rad;
      const x = Math.round(cx + Math.cos(a) * d), z = Math.round(cz + Math.sin(a) * d * 0.9);
      if (!g.get(x, top, z) || isPit(x >> 3, z >> 3)) continue;
      if (kind === 'scorch') put(x, z, d < rad * 0.5 ? (rng.chance(0.5) ? 'shadow' : 'night') : rng.chance(0.4) ? 'dirt' : 'stoneDark');
      else if (kind === 'wax') put(x, z, rng.chance(0.7) ? 'bone' : 'frost');
      else put(x, z, rng.chance(0.4) ? 'bone' : 'fog');
    }
  }
  // dust drifts in the corners
  for (const [cx, cz] of [[0, 0], [X - 1, 0], [0, Z - 1], [X - 1, Z - 1]]) {
    for (let k = 0; k < 40; k++) {
      const x = cx + Math.round(Math.sign(X / 2 - cx) * rng.next() ** 2 * 9), z = cz + Math.round(Math.sign(Z / 2 - cz) * rng.next() ** 2 * 9);
      if (g.get(x, top, z) && !isPit(x >> 3, z >> 3)) put(x, z, rng.chance(0.5) ? 'dirt' : 'stoneDark');
    }
  }
  defineModel(name, { grid: g, origin: [X / 2, top + 1, Z / 2] });   // top at y = 0, centred
}

// ---- back wall with the exit arch and its stairwell ----------------------------------------
function brickShade(TH, x, y, off) {
  const course = Math.floor(y / 4);
  const bi = Math.floor((x + off) / 8) * 31 + course * 17;
  return TH.brick[Math.abs(bi * 7919) % TH.brick.length];
}

function buildBackWall(name, L, rng) {
  const { W, theme: TH } = L;
  const X = (W + 2) * T, H = WALL_H, BZ = 16, DZ = 8, YB = 16;   // BZ: stairwell depth behind the face block
  const Zt = BZ + DZ + 3;
  const g = new VoxelGrid(X, YB + H + 6, Zt);
  const front = BZ + DZ - 1;              // z of the brick face
  const Y = (y) => y + YB;                // wall y (0 = floor) -> grid y
  const ex = (L.exitX + 1) * T + T;       // arch centre, grid x (exit tiles exitX..exitX+1, +1 for the side wall)
  const aw = ARCH.w / 2, ah = ARCH.h;
  const inArch = (x, y) => { const dx = (x + 0.5 - ex) / aw, dy = Math.max(0, y - (ah - aw)) / aw; return dx * dx + dy * dy <= 1; };
  const inRing = (x, y) => { const R = aw + 3, dx = (x + 0.5 - ex) / R, dy = Math.max(0, y - (ah - aw)) / R; return dx * dx + dy * dy <= 1; };
  // ragged top line
  const topY = [];
  for (let x = 0; x < X; x++) topY.push(H - 2 + Math.round(Math.sin(x * 0.09 + rng.next()) * 1.2 + Math.sin(x * 0.31) * 0.8 + rng.next()));
  for (let x = 0; x < X; x++) {
    for (let y = 0; y < topY[x]; y++) {
      g.box(x, Y(y), BZ, x, Y(y), front - 1, 'stoneDark');
      const course = Math.floor(y / 4), off = course % 2 ? 4 : 0;
      const mortar = y % 4 === 3 || (x + off) % 8 === 7;
      if (mortar) continue;
      let c = brickShade(TH, x, y, off);
      if (rng.chance(0.04)) c = 'stoneLight';
      if (y === 0) c = 'stoneDark';
      g.set(x, Y(y), front, c);
    }
    // capstones
    g.box(x, Y(topY[x]), BZ, x, Y(topY[x]), front, rng.chance(0.8) ? 'stoneLight' : 'stone');
    if (rng.chance(0.12)) g.set(x, Y(topY[x] + 1), rng.int(BZ, front), 'stone');
    // base course sticks out one voxel (a plinth line along the floor)
    g.set(x, Y(0), front + 1, 'stoneDark'); g.set(x, Y(1), front + 1, hash(x >> 3, 1) < 0.5 ? 'dusk' : 'stone');
  }
  // damage: a few bricks knocked out, some cracked through
  for (let i = 0; i < W * 0.4; i++) {
    const x = rng.int(4, X - 5), y = rng.int(5, H - 8);
    if (Math.abs(x - ex) < aw + 5) continue;
    const course = Math.floor(y / 4), off = course % 2 ? 4 : 0;
    const bx0 = Math.floor((x + off) / 8) * 8 - off, by0 = course * 4;
    if (rng.chance(0.3)) g.box(bx0, Y(by0), front, bx0 + 6, Y(by0 + 2), front, 'stoneDark');   // a brick knocked out
    else for (let k = 0; k < 6; k++) g.set(bx0 + k, Y(by0 + (k % 3)), front, null);          // crack
  }
  // moss at the foot and in a few mortar lines
  for (let x = 0; x < X; x++) for (let y = 0; y < 6; y++) if (rng.next() < (0.42 - y * 0.08) * TH.moss) g.set(x, Y(y), front + (y < 2 ? 1 : 0), rng.chance(0.35) ? 'leaf' : 'moss');
  // skull niches (ossuary / shrine): recesses packed with skulls
  if (TH.niches) {
    const n = Math.floor(W / 4);
    for (let i = 0; i < n; i++) {
      const nx = Math.round(((i + 0.5) / n) * X);
      if (Math.abs(nx - ex) < aw + 8 || nx < 10 || nx > X - 10) continue;
      g.box(nx - 4, Y(9), front - 2, nx + 3, Y(14), front, null);
      g.box(nx - 4, Y(9), front - 3, nx + 3, Y(14), front - 3, 'ink');
      g.box(nx - 5, Y(8), front, nx + 4, Y(8), front + 1, 'stoneLight');
      for (const sx of [nx - 3, nx + 1]) {
        g.box(sx, Y(9), front - 2, sx + 2, Y(11), front - 1, 'bone');
        g.set(sx, Y(10), front - 1, 'ink'); g.set(sx + 2, Y(10), front - 1, 'ink');
      }
      g.box(nx - 1, Y(12), front - 2, nx + 1, Y(13), front - 1, 'frost');
      g.set(nx - 1, Y(12), front - 1, 'ink'); g.set(nx + 1, Y(12), front - 1, 'ink');
    }
  }
  // stairwell block behind the arch: solid, then the tunnel and stairs carved out of it
  g.box(ex - aw - 4, Y(0), 0, ex + aw + 3, Y(H - 3), BZ - 1, 'stoneDark');
  for (let x = ex - aw - 4; x <= ex + aw + 3; x++) for (let z = 0; z < BZ; z++) g.set(x, Y(H - 3), z, hash(x, z, 9) < 0.7 ? 'stoneLight' : 'stone');
  for (let x = ex - aw; x < ex + aw; x++) {
    for (let y = 0; y < ah + 1; y++) if (inArch(x, y)) g.box(x, Y(y), 0, x, Y(y), front + 1, null);
    // stairs going down, darker as they go
    for (let z = 0; z <= front; z++) {
      const step = z >= BZ + 2 ? 0 : Math.floor((BZ + 2 - z) / 3) + 1;
      const ty = -step * 2;
      g.box(x, 0, z, x, Y(ty - 1), z, 'stoneDark');
      const edge = (BZ + 2 - z) % 3 === 0;
      const c = step === 0 ? (hash(x, z) < 0.3 ? 'stone' : 'stoneLight') : step < 2 ? (edge ? 'stoneLight' : 'stone') : step < 4 ? (edge ? 'stone' : 'dusk') : step < 6 ? (edge ? 'dusk' : 'shadow') : 'night';
      g.set(x, Y(ty - 1), z, c);
    }
  }
  g.box(ex - aw, 0, 0, ex + aw - 1, Y(ah), 0, 'ink');   // the dark at the bottom of the stair
  // arch ring: dressed stones proud of the wall, with a keystone
  for (let x = ex - aw - 4; x <= ex + aw + 3; x++) for (let y = 0; y <= ah + 4; y++) {
    if (inArch(x, y) || !inRing(x, y)) continue;
    const vous = Math.floor(Math.atan2(Math.max(0, y - (ah - aw)), x + 0.5 - ex) / 0.3);
    const alt = (vous + (y < ah - aw ? Math.floor(y / 4) : 0)) % 2;
    const outer = !inRing(x - 1, y) || !inRing(x + 1, y) || !inRing(x, y + 1);
    g.set(x, Y(y), front + 1, outer ? 'stone' : alt ? 'stoneLight' : 'fog');
    g.set(x, Y(y), front + 2, outer ? null : alt ? 'stoneLight' : 'stone');
    g.set(x, Y(y), front, 'stone');
  }
  const ky = ah + 3;
  g.box(ex - 2, Y(ky), front + 1, ex + 1, Y(ky + 4), front + 2, 'stoneLight');
  g.box(ex - 1, Y(ky + 1), front + 3, ex, Y(ky + 3), front + 3, 'bone');   // small skull boss
  g.set(ex - 1, Y(ky + 2), front + 3, 'ink'); g.set(ex, Y(ky + 2), front + 3, 'ink');
  // banners hanging from rods (the cloth is a separate swaying model; here: rod and hooks)
  for (const b of L.banners) {
    const bx = (b + 1) * T + 4;
    g.box(bx - 4, Y(24), front + 1, bx + 3, Y(24), front + 1, 'wood');
    g.set(bx - 4, Y(25), front + 1, 'slate'); g.set(bx + 3, Y(25), front + 1, 'slate');
  }
  // sconces: an iron bracket and a cup of live coals (the flame is particles)
  for (const s of L.sconces) {
    const x = (s + 1) * T + 4, sy = 17;
    g.box(x, Y(sy - 5), front + 1, x, Y(sy - 2), front + 1, 'slate');
    g.set(x, Y(sy - 1), front + 2, 'slate');
    g.box(x - 1, Y(sy), front + 1, x + 1, Y(sy), front + 3, 'shadow');
    g.set(x, Y(sy), front + 2, 'ember', true);
    for (const [dx, dz] of [[-1, 1], [1, 1], [-1, 3], [1, 3]]) g.set(x + dx, Y(sy + 1), front + dz, 'shadow');
    g.set(x, Y(sy + 1), front + 2, 'gold', true);
    // soot above
    for (let y = sy + 3; y < sy + 9; y++) if (hash(x, y) < 0.6 - (y - sy) * 0.06) g.set(x + (y % 2 ? 0 : (hash(y, x) < 0.5 ? -1 : 1)), Y(y), front, 'stoneDark');
  }
  // hanging chains
  for (let i = 0; i < 3; i++) {
    const hx = rng.int(6, X - 7);
    if (Math.abs(hx - ex) < aw + 5 || L.sconces.some((s) => Math.abs((s + 1) * T + 4 - hx) < 4)) continue;
    const len = rng.int(5, 11);
    for (let y = topY[hx] - len; y < topY[hx]; y++) g.set(hx, Y(y), front + 1, y % 2 ? 'slate' : 'mist');
    g.set(hx, Y(topY[hx] - len - 1), front + 1, 'slate');
  }
  defineModel(name, { grid: g, origin: [X / 2, YB, front + 1] });   // brick face at local z = 0
}

// ---- side walls: seen nearly from above, so tops and buttress fronts carry them ------------
function buildSideWall(name, L, rng, side) {
  const { D, theme: TH } = L;
  const Z = (D + 1) * T + 6, X = 8 + 3, H = SIDE_H;
  const g = new VoxelGrid(X, H + 6, Z);
  const inner = side < 0 ? X - 1 : 0;            // x of the inner face
  const dirIn = side < 0 ? 1 : -1;
  const x0 = side < 0 ? 0 : 3, x1 = side < 0 ? 7 : 10;   // wall body
  for (let z = 0; z < Z; z++) {
    const h = H - (hash(z >> 2, 3) < 0.25 ? 1 : 0);
    for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) {
      const course = Math.floor(y / 4), mortar = y % 4 === 3 || ((z + (course % 2) * 4) % 8 === 7);
      g.set(x, y, z, mortar ? 'stoneDark' : brickShade(TH, z, y, 0));
    }
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1;
      g.set(x, h, z, edge ? 'stone' : hash(x, z, 4) < 0.8 ? 'stoneLight' : 'stone');
    }
    if (hash(z, 5) < 0.06) g.set(x0 + 2 + Math.floor(hash(z, 6) * 4), h + 1, z, 'stone');   // loose stone on top
    if (hash(z, 7) < 0.12 * TH.moss) g.set(x0 + Math.floor(hash(z, 8) * 8), h, z, 'moss');
  }
  // buttress piers every 3 tiles: step inward, taller, with a lit cap (their front faces show)
  for (let tz = 1; tz < D; tz += 3) {
    const z0 = (tz + 1) * T - 2;
    for (let z = z0; z < z0 + 6; z++) for (let y = 0; y < H + 3; y++) for (let k = 0; k < 11; k++) {
      const x = side < 0 ? k : X - 1 - k;
      const reach = y < H ? 11 : 9;
      if (k >= reach) continue;
      const course = Math.floor(y / 4);
      g.set(x, y, z, y === H + 2 ? 'stoneLight' : y % 4 === 3 ? 'stoneDark' : (course + (z >> 2)) % 3 ? 'stone' : 'dusk');
    }
  }
  void inner; void dirIn; void rng;
  // origin: the body's inner face at local x = 0 (buttresses stand 3 voxels proud of it),
  // back end at local z = 0
  defineModel(name, { grid: g, origin: [side < 0 ? 8 : 3, 0, 0] });
}

// ---- front parapet with the entry gap, and the apron of steps outside it -------------------
function buildFront(name, L, rng) {
  const { W, theme: TH } = L;
  const X = (W + 2) * T, Z = 6, H = FRONT_H;
  const g = new VoxelGrid(X, H + 2, Z);
  const gx0 = (L.gateX + 1) * T - GATE.post, gx1 = (L.gateX + 3) * T + GATE.post - 1;   // gap plus posts
  for (let x = 0; x < X; x++) {
    if (x >= gx0 && x <= gx1) continue;
    const h = H - (hash(x >> 2, 9) < 0.2 ? 1 : 0);
    for (let y = 0; y < h; y++) for (let z = 0; z < Z; z++) {
      const course = Math.floor(y / 3), off = course % 2 ? 3 : 0;
      const mortar = y % 3 === 2 || (x + off) % 6 === 5;
      g.set(x, y, z, z === Z - 1 && mortar ? 'stoneDark' : brickShade(TH, x, y, off));
    }
    for (let z = 0; z < Z; z++) g.set(x, h, z, hash(x, z, 2) < 0.2 ? 'stone' : 'stoneLight');
    if (rng.chance(0.08 * TH.moss)) g.set(x, h, rng.int(0, Z - 1), 'moss');
  }
  defineModel(name, { grid: g, origin: [X / 2, 0, 0] });   // inner face at z = 0
}

// the gate: two squat posts with skull caps and an iron-shod threshold with the slot the
// bars shoot up out of. No lintel: nothing tall stands between the camera and the room.
function buildGateFrame(name, L) {
  const P = GATE.post, X = GATE.w + P * 2, H = GATE.h, Z = 8, YB = 4;
  const g = new VoxelGrid(X, YB + H + 4, Z);
  const Y = (y) => y + YB;
  for (const px of [0, X - P]) {
    for (let y = 0; y < H; y++) for (let x = px; x < px + P; x++) for (let z = 0; z < Z; z++) {
      const edge = x === px || x === px + P - 1 || z === 0 || z === Z - 1;
      const band = y % 6 === 5;
      g.set(x, Y(y), z, band ? 'stoneDark' : edge ? (Math.floor(y / 6) % 2 ? 'stone' : 'stoneLight') : 'stone');
    }
    g.box(px, Y(0), 0, px + P - 1, Y(1), Z - 1, 'stoneDark');
    g.box(px, Y(H), 0, px + P - 1, Y(H), Z - 1, 'fog');                 // cap
    // a small skull on each cap, facing the room
    const sx = px + 1;
    g.box(sx, Y(H + 1), 2, sx + 3, Y(H + 3), 5, 'bone');
    g.set(sx, Y(H + 2), 2, 'ink'); g.set(sx + 3, Y(H + 2), 2, 'ink'); g.set(sx + 1, Y(H + 1), 2, 'ink'); g.set(sx + 2, Y(H + 1), 2, 'ink');
    g.box(sx, Y(H + 1), 5, sx + 3, Y(H + 3), 5, 'bone');
    g.set(sx, Y(H + 2), 5, 'ink'); g.set(sx + 3, Y(H + 2), 5, 'ink');
    // iron straps
    for (const y of [4, 10]) g.box(px, Y(y), Z - 1, px + P - 1, Y(y), Z - 1, 'slate');
  }
  // threshold: stone with an iron-lined slot down the middle
  for (let x = P; x < X - P; x++) for (let z = 0; z < Z; z++) {
    g.box(x, 0, z, x, Y(-2), z, 'stoneDark');
    const slot = z === 3 || z === 4;
    g.set(x, Y(-1), z, slot ? 'ink' : z === 2 || z === 5 ? 'slate' : (x + z) % 5 === 0 ? 'stone' : 'stoneLight');
  }
  void L;
  defineModel(name, { grid: g, origin: [X / 2, YB, Z / 2] });
}

// apron: the steps up from the corridor below, outside the gate
function buildApron(name, L, rng) {
  const X = 2 * T + 4, Z = 3 * T;
  const g = new VoxelGrid(X, 26, Z);
  const top = 25;
  for (let z = 0; z < Z; z++) {
    const step = Math.floor(z / 5);
    const ty = top - step * 3;
    for (let x = 0; x < X; x++) {
      const wall = x < 2 || x >= X - 2;
      const yTop = wall ? top + 0 : ty;
      g.box(x, Math.max(0, yTop - 8), z, x, yTop - 1, z, 'stoneDark');
      const edge = z % 5 === 0;
      const c = wall ? 'stone' : step === 0 ? 'stoneLight' : edge ? (step < 2 ? 'stoneLight' : step < 3 ? 'stone' : 'dusk') : step < 2 ? 'stone' : step < 3 ? 'dusk' : 'shadow';
      g.set(x, yTop, z, rng.chance(0.03) ? 'moss' : c);
    }
  }
  defineModel(name, { grid: g, origin: [X / 2, top + 1, 0] });
}

// masonry blocks inside the room ('#' tiles): wall-height, brick faces, capstone tops
function buildBlocks(name, L) {
  const { W, D, theme: TH } = L;
  const X = W * T, Z = D * T, H = SIDE_H;
  let any = false;
  const g = new VoxelGrid(X, H + 2, Z);
  for (let tz = 0; tz < D; tz++) for (let tx = 0; tx < W; tx++) {
    if (L.cells[tz][tx] !== '#') continue;
    any = true;
    for (let z = tz * T; z < tz * T + T; z++) for (let x = tx * T; x < tx * T + T; x++) {
      const h = H - (hash(x >> 2, z >> 2, 1) < 0.2 ? 1 : 0);
      for (let y = 0; y < h; y++) {
        const course = Math.floor(y / 4), off = course % 2 ? 4 : 0;
        const mortar = y % 4 === 3 || (x + off) % 8 === 7;
        g.set(x, y, z, mortar ? 'stoneDark' : brickShade(TH, x + z, y, off));
      }
      g.set(x, h, z, hash(x, z, 6) < 0.8 ? 'stoneLight' : 'stone');
      if (hash(x, z, 8) < 0.04) g.set(x, h + 1, z, 'stone');
    }
  }
  if (!any) return null;
  defineModel(name, { grid: g, origin: [X / 2, 0, Z / 2] });
  return name;
}

/** Build every static model of one room. Returns model names (see header). */
export function buildRoomModels(prefix, L, rng) {
  const n = (k) => `${prefix}.${k}`;
  buildFloor(n('floor'), L, rng.fork('floor'));
  buildBackWall(n('back'), L, rng.fork('back'));
  buildSideWall(n('sideL'), L, rng.fork('sideL'), -1);
  buildSideWall(n('sideR'), L, rng.fork('sideR'), 1);
  buildFront(n('front'), L, rng.fork('front'));
  buildGateFrame(n('frame'), L);
  buildApron(n('apron'), L, rng.fork('apron'));
  const blocks = buildBlocks(n('blocks'), L);
  return { floor: n('floor'), back: n('back'), sideL: n('sideL'), sideR: n('sideR'), front: n('front'), frame: n('frame'), apron: n('apron'), blocks };
}

// ---- shared door models ------------------------------------------------------------------
export const PORTCULLIS = { exit: 'arena.portcullis.exit', gate: 'arena.portcullis.gate' };
export const RUNES = { off: 'arena.runes.off', red: 'arena.runes.red', gold: 'arena.runes.gold' };
export const BANNER = (col) => `arena.banner.${col}`;

function grille(name, w, h) {
  // heavy iron: 2-voxel bars with 2-voxel gaps, a cross rail every 8, spiked feet
  const g = new VoxelGrid(w, h + 3, 3);
  const bar = (x) => x % 4 === 1 || x % 4 === 2;
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    const rail = y % 8 === 5;
    if (bar(x)) g.set(x, y + 3, 1, x % 4 === 1 ? 'mist' : 'slate');
    if (rail) { g.set(x, y + 3, 1, 'slate'); g.set(x, y + 3, 2, bar(x) ? 'fog' : 'slate'); }
  }
  for (let x = 1; x < w; x += 4) { g.box(x, 1, 1, x + 1, 2, 1, 'fog'); g.set(x, 0, 1, 'frost'); }
  defineModel(name, { grid: g, origin: [w / 2, 0, 1.5] });
}
grille(PORTCULLIS.exit, ARCH.w, ARCH.h + 1);

// the gate's teeth: bars with spear tips on top, rising out of the threshold slot
{
  const w = GATE.w, h = GATE.bars;
  const g = new VoxelGrid(w, h + 3, 2);
  const bar = (x) => x % 4 === 1 || x % 4 === 2;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (bar(x)) g.set(x, y, 0, x % 4 === 1 ? 'mist' : 'slate');
      if (y === 6 || y === 1) { g.set(x, y, 0, 'slate'); g.set(x, y, 1, bar(x) ? 'fog' : 'slate'); }
    }
    if (x % 4 === 1) { g.box(x, h, 0, x + 1, h, 0, 'fog'); g.set(x, h + 1, 0, 'frost'); g.set(x + 1, h + 1, 0, 'frost'); g.set(x, h + 2, 0, 'white'); }
  }
  defineModel(PORTCULLIS.gate, { grid: g, origin: [w / 2, 0, 1] });
}

// the rune ring that sits on the exit arch: dark carved runes, or lit red (sealed) / gold (open)
function runes(name, col) {
  const aw = ARCH.w / 2 + 1.5, ah = ARCH.h;
  const W = ARCH.w + 8, H = ah + 6;
  const g = new VoxelGrid(W, H, 1);
  const cx = W / 2;
  // seven runes spaced round the ring, each a 2x3 glyph picked from a small alphabet
  const GLYPHS = [[[1, 0], [0, 1], [1, 2]], [[0, 0], [1, 1], [0, 2]], [[0, 0], [1, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1], [0, 2]]];
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (i / 6);
    const rx = Math.round(cx - Math.cos(a) * aw - 1), ry = Math.round((ah - ARCH.w / 2) + Math.sin(a) * aw) - 1;
    for (const [gx, gy] of GLYPHS[i % GLYPHS.length]) g.set(rx + gx, ry + gy, 0, col, col !== 'shadow');
  }
  // two rune columns down the jambs
  for (const sx of [cx - aw - 1, cx + aw]) for (let y = 3; y < ah - ARCH.w / 2; y += 4) { g.set(Math.round(sx), y, 0, col, col !== 'shadow'); g.set(Math.round(sx), y + 1, 0, col, col !== 'shadow'); }
  defineModel(name, { grid: g, origin: [W / 2, 0, 0] });
}
runes(RUNES.off, 'shadow');
runes(RUNES.red, 'red');
runes(RUNES.gold, 'gold');

// banner cloth, hung from its top edge (origin at the top so it can sway)
for (const set of Object.values(THEMES)) {
  const [main, band, trim] = set.banner;
  const name = BANNER(set.banner.join('-'));
  const w = 6, h = 16;
  const g = new VoxelGrid(w, h, 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (y < 3 && y < Math.abs(x - 2.5) - 0.5) continue;       // swallowtail
    const edge = x === 0 || x === w - 1;
    g.set(x, y, 0, edge ? trim : y === 8 || y === 9 ? band : main);
  }
  // sigil: a stylised hooded eye
  g.box(2, 10, 0, 3, 12, 0, band); g.set(2, 11, 0, trim); g.set(3, 11, 0, trim);
  defineModel(name, { grid: g, origin: [w / 2, h, 0] });
}
