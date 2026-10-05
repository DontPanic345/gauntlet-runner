// Voxel models for ?showcase=look: a small crypt arena vignette. These are the look piece's
// stand-ins so the frame can be judged; the real hero, enemies and environment belong to the
// `hero`, `enemies` and `arenas` pieces, which may borrow or replace any of this.
// All names are prefixed `look.`.

import { defineModel, VoxelGrid } from './voxel/index.js';
import { Rng } from '../core/rng.js';

// ---------------------------------------------------------------------------------------
// floor: staggered flagstones, worn edges, cracks, moss in the grout, a ledge at the front
export const FLOOR = { w: 192, d: 96 }; // voxels: 24 x 12 world units
{
  const { w: W, d: D } = FLOOR;
  const g = new VoxelGrid(W, 4, D);
  const r = new Rng('look.floor');
  // the grout bed is one step below the slabs (not ink): with AO in the joint it reads as
  // `stoneDark`, so actor outlines stay the darkest line on the floor
  g.box(0, 0, 0, W - 1, 1, D - 1, 'stoneDark');
  g.box(0, 2, 0, W - 1, 2, D - 1, 'stone');
  const rowD = 16;
  for (let z0 = 0; z0 < D; z0 += rowD) {
    let x0 = -r.int(0, 12);
    while (x0 < W) {
      const sw = r.pick([12, 16, 16, 20, 14]);
      const shade = r.weighted([['stone', 8], ['dusk', 3], ['stoneLight', 1]]);
      const sunk = r.chance(0.06);
      const y = sunk ? 2 : 3;
      const x1 = x0 + sw - 1, z1 = z0 + rowD - 1;
      for (let z = z0 + 1; z <= z1; z++) for (let x = Math.max(0, x0 + 1); x <= Math.min(W - 1, x1); x++) {
        let c = shade;
        const f = r.next();
        // sparse speckle, within a step of the slab
        if (f < 0.008) c = shade === 'dusk' ? 'stone' : 'stoneLight';
        else if (f < 0.016) c = shade === 'stoneLight' ? 'stone' : 'dusk';
        // chipped corners, the odd bitten edge
        const cx = x === x0 + 1 || x === x1, cz = z === z0 + 1 || z === z1;
        if (cx && cz && r.chance(0.6)) continue;
        if ((cx || cz) && r.chance(0.035)) continue;
        // a worn, slightly lighter lip along the front edge of each slab
        if (z === z1 && c === shade && shade !== 'stoneLight' && r.chance(0.25)) c = shade === 'dusk' ? 'stone' : 'stoneLight';
        g.set(x, y, z, c);
      }
      x0 += sw;
    }
  }
  // the arena ring: an inlaid band with eight rune notches
  {
    const cx = W / 2, cz = 50, R = 34;
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - cx, (z + 0.5 - cz) * 1.0);
      if (d > R - 1 && d <= R + 1 && g.get(x, 3, z)) {
        const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
        // worn: a dull inlay a step off the floor, broken into partial arcs
        const notch = Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.46;
        const worn = Math.sin(a * 3 + 1.1) + Math.sin(a * 7.3) * 0.5 < -0.35;
        if (worn) continue;
        g.set(x, 3, z, notch ? 'stone' : 'dusk');
      }
    }
  }
  // cracks: short random walks that cut the top layer
  for (let i = 0; i < 14; i++) {
    let x = r.int(4, W - 5), z = r.int(4, D - 5);
    const n = r.int(4, 11);
    for (let k = 0; k < n; k++) {
      g.set(x, 3, z, null);
      if (r.chance(0.5)) x += r.pick([-1, 1]); else z += r.pick([-1, 1]);
    }
  }
  // moss creeping out of the grout near the back wall and the sides
  const patches = [];
  for (let i = 0; i < 9; i++) patches.push([r.pick([r.int(4, 30), r.int(W - 30, W - 4), r.int(10, W - 10)]), r.int(2, 26), r.range(5, 11)]);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    let k = 0;
    for (const [px, pz, pr] of patches) k = Math.max(k, 1 - Math.hypot(x - px, (z - pz) * 1.4) / pr);
    if (k <= 0) continue;
    if (!g.get(x, 3, z) && r.next() < k * 1.6) g.set(x, 3, z, r.chance(0.3) ? 'leaf' : 'moss');       // grout and cracks fill first
    else if (g.get(x, 3, z) && r.next() < k * k * 0.5) g.set(x, 3, z, r.chance(0.2) ? 'leaf' : 'moss');
  }
  // an old stain where something died
  for (let i = 0; i < 90; i++) {
    const a = r.range(0, 6.28), d = Math.sqrt(r.next()) * 7;
    const x = Math.round(124 + Math.cos(a) * d * 1.3), z = Math.round(40 + Math.sin(a) * d);
    if (g.get(x, 3, z)) g.set(x, 3, z, d < 3 ? 'blood' : r.chance(0.5) ? 'blood' : 'plum');
  }
  // front ledge: the floor breaks off into the dark in a ragged line, with a step below
  for (let x = 0; x < W; x++) {
    const bite = Math.round(3 + Math.sin(x * 0.21) * 2 + Math.sin(x * 0.53 + 1) * 1.5 + r.next() * 2);
    for (let z = D - bite; z < D; z++) {
      g.set(x, 3, z, null);
      if (z > D - bite + 2) g.set(x, 2, z, null);
      if (z > D - bite + 3) { g.set(x, 1, z, null); g.set(x, 0, z, null); }
    }
    if (r.chance(0.3)) g.set(x, 2, D - bite, 'stoneLight');
  }
  defineModel('look.floor', { grid: g, origin: [W / 2, 3 + 1, 0] }); // top surface at y = 0, back edge at z = 0
}

// ---------------------------------------------------------------------------------------
// back wall: brick courses with recessed mortar, a barred archway, banners, two sconces
export const WALL = { w: 192, h: 30, d: 12 };
export const SCONCES = [[-76, 17], [76, 17], [-30, 17], [30, 17]]; // voxel x from centre, voxel y of the cup
{
  const { w: W, h: H, d: D } = WALL;
  const g = new VoxelGrid(W, H + 6, D);
  const r = new Rng('look.wall');
  const front = 7; // z of the brick face (body z 0..7)
  const cx = W / 2;
  // ragged top line
  const top = [];
  for (let x = 0; x < W; x++) top.push(H - 2 + Math.round(Math.sin(x * 0.09) * 1.5 + Math.sin(x * 0.31) * 1 + r.next() * 1.2));
  for (let x = 0; x < W; x++) for (let y = 0; y < top[x]; y++) {
    g.box(x, y, 0, x, y, front - 1, 'stoneDark');
    const course = Math.floor(y / 4);
    const off = course % 2 ? 4 : 0;
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    if (mortar) continue;
    const bi = Math.floor((x + off) / 8) * 31 + course * 17;
    const shade = ['stone', 'stone', 'dusk', 'stone', 'violet', 'stone', 'stoneDark'][Math.abs(bi * 7919) % 7];
    let c = shade;
    if (r.chance(0.05)) c = 'stoneLight';
    if (y === 0) c = 'stoneDark';
    g.set(x, y, front, c);
  }
  // capstones on top
  for (let x = 0; x < W; x++) {
    const y = top[x];
    g.box(x, y, 0, x, y, front, r.chance(0.8) ? 'stoneLight' : 'stone');
    if (r.chance(0.15)) g.set(x, y + 1, r.int(0, front), 'stone');
  }
  // moss at the foot of the wall and in a few mortar lines
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < 5; y++) if (r.chance(0.5 - y * 0.1)) g.set(x, y, front + (g.get(x, y, front) ? 0 : 0), r.chance(0.35) ? 'leaf' : 'moss');
  }
  // archway: stone ring, dark void behind, portcullis bars
  const aw = 12, ah = 20;
  for (let x = cx - aw - 3; x <= cx + aw + 2; x++) for (let y = 0; y <= ah + 3; y++) {
    const dx = (x + 0.5 - cx) / (aw + 3), dy = Math.max(0, y - (ah - aw)) / (aw + 3);
    const ringOut = dx * dx + dy * dy <= 1;
    const dxi = (x + 0.5 - cx) / aw, dyi = Math.max(0, y - (ah - aw)) / aw;
    const inside = dxi * dxi + dyi * dyi <= 1;
    if (inside) {
      g.box(x, y, 1, x, y, front, null);
      g.set(x, y, 0, 'ink');
      if ((x - cx + 64) % 3 === 0) g.box(x, y, 3, x, y, 3, 'slate');
      if (y % 6 === 2) g.set(x, y, 3, 'slate');
    } else if (ringOut) {
      g.set(x, y, front + 1, ((x + y) % 5 === 0) ? 'stone' : 'stoneLight');
      g.set(x, y, front, 'stoneLight');
    }
  }
  // keystone skull above the arch
  const ky = ah + 4;
  g.box(cx - 2, ky, front + 1, cx + 1, ky + 3, front + 2, 'bone');
  g.set(cx - 2, ky + 2, front + 2, 'ink'); g.set(cx + 1, ky + 2, front + 2, 'ink');
  g.set(cx - 1, ky, front + 2, 'ink'); g.set(cx, ky, front + 2, 'frost');
  // banners, hanging from rods
  for (const bx of [cx - 48, cx + 44]) {
    g.box(bx - 1, 25, front + 1, bx + 5, 25, front + 1, 'wood');
    for (let y = 9; y <= 24; y++) for (let x = bx; x <= bx + 4; x++) {
      if (y < 12 && (y - 9) < Math.abs(x - bx - 2)) continue; // swallowtail cut
      const trim = x === bx || x === bx + 4;
      g.set(x, y, front + 1, trim ? 'gold' : y === 17 || y === 18 ? 'blood' : 'plum');
    }
    g.box(bx + 1, 19, front + 2, bx + 3, 21, front + 2, 'blood'); // sigil
    g.set(bx + 2, 20, front + 2, 'gold');
  }
  // sconces: an iron bracket and a cup of live coals (the flame itself is particles)
  for (const [sx, sy] of SCONCES) {
    const x = cx + sx;
    g.box(x, sy - 5, front + 1, x, sy - 2, front + 1, 'slate');
    g.set(x, sy - 1, front + 2, 'slate');
    g.box(x - 1, sy, front + 1, x + 1, sy, front + 3, 'shadow');
    g.set(x, sy, front + 2, 'ember', true);
    g.set(x - 1, sy + 1, front + 1, 'shadow'); g.set(x + 1, sy + 1, front + 1, 'shadow');
    g.set(x - 1, sy + 1, front + 3, 'shadow'); g.set(x + 1, sy + 1, front + 3, 'shadow');
    g.set(x, sy + 1, front + 2, 'gold', true);
  }
  // hanging chains
  for (const hx of [cx - 20, cx + 21, cx - 84]) {
    const len = 6 + ((hx * 13) % 5);
    for (let y = top[hx] - len; y < top[hx]; y++) g.set(hx, y, front + 1, y % 2 ? 'slate' : 'mist');
  }
  defineModel('look.wall', { grid: g, origin: [W / 2, 0, front + 1] }); // brick face at z = 0
}

// side wall: seen almost from above, so the capstones and rubble carry it
{
  const g = new VoxelGrid(10, 22, 80);
  const r = new Rng('look.sidewall');
  for (let z = 0; z < 80; z++) {
    const h = z < 50 ? 20 - Math.round(r.next() * 1.5) : Math.max(0, Math.round(20 - (z - 50) * 0.7 - r.next() * 3));
    for (let y = 0; y < h; y++) for (let x = 0; x < 10; x++) {
      const course = Math.floor(y / 4);
      const mortar = y % 4 === 3 || ((z + (course % 2) * 4) % 8 === 7);
      g.set(x, y, z, mortar && (x === 0 || x === 9) ? 'stoneDark' : ['stone', 'dusk', 'stone', 'violet'][(course + Math.floor(z / 8)) % 4]);
    }
    if (h > 0) for (let x = 0; x < 10; x++) g.set(x, h, z, r.chance(0.8) ? 'stoneLight' : 'stone');
  }
  // rubble spilling off the broken end
  for (let i = 0; i < 60; i++) {
    const z = r.int(50, 79), x = r.int(-2, 11), y = r.int(0, 2);
    g.set(Math.max(0, Math.min(9, x)), y, z, r.pick(['stone', 'stoneLight', 'stoneDark']));
  }
  defineModel('look.sidewall', { grid: g, origin: [5, 0, 0] });
}

// ---------------------------------------------------------------------------------------
// hero stand-in: hooded runner with a short sword, 12 voxels to the hood tip
{
  const g = new VoxelGrid(12, 14, 7);
  // boots, legs
  g.box(3, 0, 2, 4, 0, 5, 'dirt'); g.box(6, 0, 2, 7, 0, 5, 'dirt');
  g.box(3, 1, 3, 4, 2, 4, 'dusk'); g.box(6, 1, 3, 7, 2, 4, 'dusk');
  // tunic, belt
  g.box(3, 3, 2, 7, 6, 5, 'mist');
  g.box(3, 3, 2, 7, 3, 5, 'wood'); g.set(5, 3, 5, 'gold');
  g.box(4, 4, 5, 6, 5, 5, 'fog'); // tunic front panel
  // cloak: back and sides, darker hem
  g.box(2, 2, 1, 8, 7, 1, 'blue'); g.box(2, 2, 1, 8, 2, 1, 'navy');
  g.box(2, 3, 2, 2, 7, 4, 'blue'); g.box(8, 3, 2, 8, 7, 4, 'blue');
  g.set(2, 3, 4, 'navy'); g.set(8, 3, 4, 'navy');
  g.box(3, 1, 0, 7, 3, 0, 'blue'); g.box(4, 0, 0, 6, 0, 0, 'navy'); // trailing cloak
  // scarf with a tail blowing back
  g.box(2, 7, 1, 8, 7, 5, 'red');
  g.set(6, 7, 0, 'red'); g.set(7, 6, 0, 'red'); g.set(8, 6, 0, 'blood'); g.set(8, 5, 0, 'blood');
  // hood and face
  g.box(3, 8, 1, 7, 10, 5, 'blue');
  g.box(4, 8, 5, 6, 9, 5, 'ink');
  g.set(4, 9, 5, 'sky', true); g.set(6, 9, 5, 'sky', true);
  g.box(3, 10, 5, 7, 10, 5, 'navy'); // hood brim
  g.box(4, 11, 1, 6, 11, 4, 'blue');
  g.box(4, 12, 1, 5, 12, 2, 'blue'); g.set(4, 13, 1, 'navy');
  // arms: left hand at the side, right hand forward on the sword
  g.set(1, 4, 3, 'dirt'); g.box(1, 5, 3, 1, 6, 3, 'blue');
  g.box(9, 5, 3, 9, 6, 3, 'blue'); g.set(9, 4, 4, 'dirt');
  // sword: grip, gold guard, blade up and a bright tip
  g.set(10, 4, 4, 'wood'); g.box(10, 5, 3, 10, 5, 5, 'gold');
  g.box(10, 6, 4, 10, 11, 4, 'frost'); g.set(10, 12, 4, 'white'); g.set(10, 3, 4, 'gold');
  defineModel('look.hero', { grid: g });
}

// skeleton: sword and battered shield, ember eyes
{
  const g = new VoxelGrid(14, 16, 8);
  g.box(4, 0, 3, 5, 0, 6, 'bone'); g.box(8, 0, 3, 9, 0, 6, 'bone');
  g.box(4, 1, 4, 4, 3, 4, 'bone'); g.box(9, 1, 4, 9, 3, 4, 'bone');
  g.set(4, 2, 5, 'frost'); g.set(9, 2, 5, 'frost'); // kneecaps
  g.box(5, 4, 4, 5, 5, 4, 'bone'); g.box(8, 4, 4, 8, 5, 4, 'bone');
  g.box(4, 6, 3, 9, 6, 5, 'bone');
  g.box(6, 7, 3, 7, 7, 3, 'frost');
  // ribcage with dark gaps
  g.box(4, 8, 2, 9, 11, 5, 'bone');
  g.box(5, 8, 3, 8, 11, 4, null);
  for (const y of [9, 11]) { g.box(5, y, 5, 8, y, 5, 'ink'); g.box(4, y, 3, 4, y, 4, 'ink'); g.box(9, y, 3, 9, y, 4, 'ink'); }
  g.box(6, 8, 2, 7, 11, 2, 'frost'); // spine
  g.box(3, 12, 3, 10, 12, 4, 'bone'); // shoulders
  // skull
  g.box(4, 13, 2, 9, 15, 6, 'bone');
  g.box(5, 12, 4, 8, 12, 6, 'frost'); // jaw
  g.set(5, 12, 6, 'ink'); g.set(7, 12, 6, 'ink');
  g.set(5, 14, 6, 'ember', true); g.set(8, 14, 6, 'ember', true);
  g.set(6, 14, 6, 'ink'); g.set(7, 14, 6, 'ink');
  g.set(6, 13, 6, 'ink');
  g.box(4, 15, 2, 9, 15, 3, 'frost'); // crown
  // right arm reaching forward, sword angled down
  g.box(11, 9, 4, 11, 11, 4, 'bone'); g.set(11, 8, 5, 'bone');
  g.set(11, 8, 6, 'wood'); g.box(11, 9, 6, 11, 9, 6, 'slate'); g.box(11, 7, 6, 11, 7, 6, 'slate');
  g.box(12, 2, 6, 12, 7, 6, 'fog'); g.set(12, 4, 6, 'dirt'); g.set(12, 2, 6, 'mist'); g.set(12, 6, 6, 'dirt');
  // left arm and shield
  g.box(2, 9, 4, 2, 11, 4, 'bone');
  g.box(0, 6, 5, 3, 11, 6, 'wood');
  g.box(0, 6, 6, 3, 6, 6, 'slate'); g.box(0, 11, 6, 3, 11, 6, 'slate');
  g.box(0, 6, 6, 0, 11, 6, 'slate'); g.box(3, 6, 6, 3, 11, 6, 'slate');
  g.box(1, 8, 7, 2, 9, 7, 'fog'); g.set(3, 10, 6, null); g.set(2, 11, 6, null); // boss, a bite out of the rim
  defineModel('look.skeleton', { grid: g });
}

// crypt ooze: a plum blob with a skull half-swallowed and ember eyes
{
  const S = 16, H = 10;
  const g = new VoxelGrid(S, H, S);
  const r = new Rng('look.ooze');
  const c = (S - 1) / 2;
  for (let z = 0; z < S; z++) for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) {
    const dx = (x - c) / 7.4, dy = y / 9.2, dz = (z - c) / 7.0;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > 1) continue;
    let col = 'plum';
    if (d > 0.72 && y > 4) col = r.chance(0.5) ? 'rose' : 'plum';
    if (y === 0) col = 'blood';
    g.set(x, y, z, col);
  }
  // highlight glints on the crown
  for (const [x, y, z] of [[6, 9, 6], [7, 9, 7], [5, 8, 4], [10, 8, 5]]) if (g.get(x, y, z)) g.set(x, y, z, 'bone');
  // eyes and mouth on the front face
  g.box(5, 5, 14, 6, 6, 14, 'ink'); g.box(9, 5, 14, 10, 6, 14, 'ink');
  g.set(5, 6, 15, 'ember', true); g.set(10, 6, 15, 'ember', true);
  g.box(6, 2, 15, 9, 3, 15, 'ink'); g.set(7, 2, 15, 'bone'); g.set(9, 3, 15, 'bone');
  // a swallowed skull breaking the surface, and a rib
  g.box(11, 5, 2, 13, 7, 4, 'bone'); g.set(12, 6, 4, 'ink'); g.set(13, 6, 4, 'ink');
  g.box(2, 8, 8, 5, 8, 8, 'bone'); g.set(1, 7, 8, 'bone');
  defineModel('look.ooze', { grid: g });
}

// ---------------------------------------------------------------------------------------
// props
{
  // brazier: a round iron bowl on four legs, heaped with coals (the flame is particles)
  const g = new VoxelGrid(11, 9, 11);
  const r = new Rng('look.brazier');
  for (const [x, z] of [[2, 2], [8, 2], [2, 8], [8, 8]]) { g.box(x, 0, z, x, 4, z, 'shadow'); g.set(x, 0, z, 'slate'); }
  for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) {
    const d = Math.hypot(x - 5, z - 5);
    if (d <= 3.6) g.set(x, 4, z, 'shadow');
    if (d <= 4.6) g.set(x, 5, z, 'shadow');
    if (d <= 5.4 && d > 3.9) g.set(x, 6, z, d > 4.8 ? 'slate' : 'shadow');
    if (d <= 3.9) g.set(x, 6, z, r.chance(0.35) ? 'ember' : 'blood', true);
    if (d <= 2.2 && r.chance(0.6)) g.set(x, 7, z, r.chance(0.4) ? 'gold' : 'ember', true);
  }
  for (const [x, z] of [[0, 5], [10, 5], [5, 0], [5, 10]]) g.set(x, 6, z, 'fog'); // rivets
  defineModel('look.brazier', { grid: g });
}
function r2(x, z) { return (x * 7 + z * 3) % 2 === 0; }

{
  // barrel: staves, iron bands, lid
  const g = new VoxelGrid(10, 11, 10);
  for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) {
    const d = Math.hypot(x - 4.5, z - 4.5);
    for (let y = 0; y < 11; y++) {
      const bulge = y > 2 && y < 8 ? 5.0 : 4.4;
      if (d > bulge) continue;
      const band = y === 1 || y === 9;
      const stave = Math.round(Math.atan2(z - 4.5, x - 4.5) / (Math.PI / 6)) % 2 === 0;
      g.set(x, y, z, band && d > bulge - 1.2 ? 'slate' : y === 10 ? (d < 3.4 ? 'wood' : 'woodLight') : stave ? 'wood' : 'woodLight');
    }
  }
  g.set(4, 10, 4, 'dirt'); g.set(5, 10, 5, 'dirt');
  defineModel('look.barrel', { grid: g });
}

{
  // crate: plank faces with dark frame edges
  const g = new VoxelGrid(10, 9, 10);
  g.box(0, 0, 0, 9, 8, 9, 'wood');
  for (let y = 0; y < 9; y++) for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) {
    const ex = x === 0 || x === 9, ey = y === 0 || y === 8, ez = z === 0 || z === 9;
    if ((ex && ey) || (ex && ez) || (ey && ez)) g.set(x, y, z, 'dirt');
    else if ((ex || ez) && y % 3 === 1) g.set(x, y, z, 'woodLight');
    else if (ey && (x + z) % 4 === 0) g.set(x, y, z, 'woodLight');
  }
  for (let i = 1; i < 9; i++) g.set(i, i, 9, 'dirt'); // diagonal brace on the front
  defineModel('look.crate', { grid: g });
}

{
  // broken pillar stump with melted candles (the flames are emissive voxels)
  const g = new VoxelGrid(12, 16, 12);
  for (let z = 0; z < 12; z++) for (let x = 0; x < 12; x++) {
    const d = Math.hypot(x - 5.5, z - 5.5);
    if (d > 5.6) continue;
    const top = 9 + Math.round(Math.sin(x * 1.3 + z * 0.7) * 1.5 + (x > 6 ? 2 : 0));
    for (let y = 0; y <= top; y++) g.set(x, y, z, y === 0 ? 'stoneDark' : y === top ? 'stoneLight' : (Math.round(Math.atan2(z - 5.5, x - 5.5) * 2) % 2 ? 'stone' : 'dusk'));
  }
  const candle = (x, z, h) => {
    let y = 1; while (g.get(x, y, z)) y++;
    for (let k = 0; k < h; k++) g.set(x, y + k, z, 'bone');
    g.set(x, y + h, z, 'torch', true);
    g.set(x + 1, y, z, 'bone');
  };
  candle(3, 4, 2); candle(5, 7, 3); candle(8, 5, 1); candle(4, 8, 1); candle(7, 8, 2);
  defineModel('look.candles', { grid: g });
}

{
  // bone pile with a skull on top
  const g = new VoxelGrid(12, 6, 10);
  const r = new Rng('look.bones');
  for (let i = 0; i < 16; i++) {
    const x = r.int(1, 9), z = r.int(1, 8), len = r.int(3, 5), y = r.int(0, 2);
    const along = r.chance(0.5);
    for (let k = 0; k < len; k++) g.set(along ? Math.min(11, x + k) : x, y, along ? z : Math.min(9, z + k), 'bone');
    g.set(x, y + 1, z, 'frost');
  }
  g.box(4, 2, 4, 7, 4, 7, 'bone');
  g.set(4, 3, 7, 'ink'); g.set(6, 3, 7, 'ink'); g.set(5, 2, 7, 'ink');
  g.box(4, 4, 4, 7, 4, 5, 'frost');
  defineModel('look.bones', { grid: g });
}

{
  // loose rubble chunks
  const g = new VoxelGrid(12, 4, 10);
  const r = new Rng('look.rubble');
  for (let i = 0; i < 8; i++) {
    const x = r.int(0, 9), z = r.int(0, 7), s = r.int(1, 3);
    g.box(x, 0, z, x + s - 1, r.int(0, s - 1), z + s - 1, r.pick(['stone', 'stoneLight', 'stoneDark', 'dusk']));
  }
  defineModel('look.rubble', { grid: g });
}
