// Arena props (piece `arenas`): the voxel models for pillars, statues, sarcophagi, braziers,
// barrels, crates, urns, bones, rubble, candles, banners and webs, and the `Prop` object that
// gives them behaviour. Solid props feed the room's collision; hittable ones are combat
// targets (`{x, z, r, dead, takeHit(hit)}`) and each reacts in its own way:
//
//   pillar, statue, sarcophagus, altar   stone: a clang, chips, dust shaken from the top, a wobble
//   brazier                              the fire flares, a spray of embers, the light kicks
//   barrel                               first hit cracks it (hoop pops, splinters), the second breaks it
//   crate, urn, candles, bones           one hit breaks or scatters them into chunks that bounce
//   banner                               sways all the time, and swings when a fight passes near
//
// Broken props leave a decal behind (splinters, shards, scattered bones) that pops in.

import * as THREE from 'three';
import { defineModel, voxelMesh, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { Rng } from '../core/rng.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/index.js';
import { ramp, F_BOUNCE } from '../vfx/particles.js';
import { hex } from '../render/palette.js';
import { feedback } from '../core/feedback.js';
import { events } from '../core/events.js';
import { loop, DT } from '../core/loop.js';

const V = VOXEL;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- models -----------------------------------------------------------------------------------

// Round shapes stair-step into a mess of outlines at this resolution, so columns and casks are
// square or octagonal with big flat faces: the light and the outline pass both read them cleanly.
const oct = (x, z, cx, cz, r) => { const dx = Math.abs(x - cx), dz = Math.abs(z - cz); return dx <= r && dz <= r && dx + dz <= r * 1.5; };

function pillar(name, h, ruined) {
  const g = new VoxelGrid(10, h + 3, 10);
  const r = new Rng(`arena.${name}`);
  const c = 4.5;
  const shaftTop = ruined ? h - 3 : h - 5;
  for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) {
    const corner = (x === 0 || x === 9) && (z === 0 || z === 9);
    if (!corner) { g.set(x, 0, z, 'stone'); g.set(x, 1, z, 'stoneLight'); }
    if (x > 0 && x < 9 && z > 0 && z < 9) g.set(x, 2, z, 'mist');
  }
  for (let y = 3; y <= shaftTop; y++) {
    const jag = ruined && y > shaftTop - 4 ? Math.round(r.range(0, 2.4) * ((y - (shaftTop - 4)) / 4)) : 0;
    for (let z = 1; z < 9; z++) for (let x = 1; x < 9; x++) {
      if ((x === 1 || x === 8) && (z === 1 || z === 8)) continue;            // chamfered corners
      if (jag && (x + z * 3 + y) % 5 < jag) continue;
      const flute = (x + z) % 2 === 0 || z === 8;
      let col = flute ? 'mist' : 'slate';
      if (x <= 2) col = 'fog';                                               // lit from the left
      if (x >= 7) col = 'stoneLight';
      if (z === 8 && x > 2 && x < 7 && y % 6 === 0) col = 'slate';           // faint drum joints
      g.set(x, y, z, col);
    }
  }
  if (!ruined) {
    for (const by of [6, shaftTop - 3]) for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) {
      const edge = x === 0 || x === 9 || z === 0 || z === 9;
      if (edge && !((x === 0 || x === 9) && (z === 0 || z === 9)) && by === shaftTop - 3) g.set(x, by, z, 'fog');
      if (by === 6 && (x === 0 || x === 9 || z === 0 || z === 9) === false && false) g.set(x, by, z, 'fog');
    }
    for (let y = shaftTop + 1; y < h; y++) for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) {
      const corner = (x === 0 || x === 9) && (z === 0 || z === 9);
      if (corner && y === shaftTop + 1) continue;
      g.set(x, y, z, y === h - 1 ? 'fog' : y === shaftTop + 1 ? 'slate' : (z === 9 ? 'mist' : 'stoneLight'));
    }
    for (let x = 1; x < 9; x++) g.set(x, shaftTop + 2, 9, 'slate');
  } else {
    for (let q = 0; q < 12; q++) g.set(r.int(0, 9), r.int(0, 1), r.int(0, 9), 'fog');
  }
  for (let q = 0; q < 6; q++) g.set(r.int(2, 7), r.int(4, shaftTop), 8, 'stoneLight');
  for (let q = 0; q < 12; q++) { const y = r.int(3, 8), x = r.int(1, 8); if (g.get(x, y, 8)) g.set(x, y, 8, r.chance(0.3) ? 'leaf' : 'moss'); }
  defineModel(name, { grid: g });
}
pillar('arena.pillar', 24, false);
pillar('arena.pillarRuin', 12, true);

{
  // hooded statue on a plinth, sword planted in front, ember eyes
  const g = new VoxelGrid(13, 26, 13);
  const c = 6;
  for (let z = 0; z < 13; z++) for (let x = 0; x < 13; x++) {
    const corner = Math.abs(x - c) === 6 && Math.abs(z - c) === 6;
    if (!corner) { g.set(x, 0, z, 'stoneDark'); g.set(x, 1, z, 'stone'); }
    if (Math.abs(x - c) < 6 && Math.abs(z - c) < 6) { g.set(x, 2, z, 'stoneLight'); g.set(x, 3, z, x + z % 2 ? 'stone' : 'dusk'); }
  }
  for (let y = 4; y <= 17; y++) {
    const rad = 4.4 - (y - 4) * 0.13 + (y < 7 ? 0.5 : 0);
    for (let z = 0; z < 13; z++) for (let x = 0; x < 13; x++) {
      if (!oct(x, z, c, c, Math.round(rad))) continue;
      const folds = (x + (y >> 1)) % 3 === 0;
      let col = folds ? 'slate' : 'mist';
      if (x < c - 1 && z > c - 2) col = 'fog';
      if (Math.hypot(x - c, z - c) > rad - 0.9 && x > c + 1) col = 'slate';
      g.set(x, y, z, col);
    }
  }
  // shoulders and hood
  g.box(c - 4, 15, c - 2, c + 4, 17, c + 2, 'mist');
  for (let y = 18; y <= 23; y++) for (let z = 0; z < 13; z++) for (let x = 0; x < 13; x++) {
    const rad = y < 21 ? 3 : 3 - (y - 20) * 0.9;
    if (oct(x, z, c, c, Math.round(rad))) g.set(x, y, z, y > 21 ? 'fog' : 'mist');
  }
  g.box(c - 2, 18, c + 2, c + 2, 21, c + 3, 'ink');          // the hood's dark opening
  g.set(c - 1, 20, c + 3, 'ember', true); g.set(c + 1, 20, c + 3, 'ember', true);
  // hands and the planted sword
  g.box(c - 1, 11, c + 3, c + 1, 12, c + 4, 'fog');
  g.box(c, 4, c + 5, c, 13, c + 5, 'frost'); g.box(c - 2, 13, c + 5, c + 2, 13, c + 5, 'mist'); g.set(c, 14, c + 5, 'gold');
  g.set(c, 3, c + 5, 'frost');
  const r = new Rng('arena.statue');
  for (let q = 0; q < 16; q++) g.set(r.int(1, 11), r.int(2, 4), r.int(1, 11), 'moss');
  defineModel('arena.statue', { grid: g });
}

{
  // sarcophagus: a heavy lid pushed a little off, a dark gap, a skeleton relief
  const g = new VoxelGrid(24, 11, 11);
  const r = new Rng('arena.sarc');
  g.box(1, 0, 1, 22, 5, 9, 'stoneDark');
  for (let x = 1; x < 23; x++) for (let z = 1; z < 10; z++) { if ((x + z) % 7 === 0) g.set(x, 5, z, 'dusk'); }
  g.box(1, 0, 9, 22, 5, 9, 'stone');                        // front face
  for (let x = 1; x < 23; x += 4) g.box(x, 1, 9, x + 1, 3, 9, 'stoneDark');
  g.box(0, 6, 1, 20, 8, 9, 'stone');                        // the lid, shifted 2 voxels
  g.box(0, 9, 2, 20, 9, 8, 'stoneLight');
  g.box(1, 9, 1, 19, 9, 1, 'stoneLight');
  g.box(21, 6, 3, 23, 6, 8, 'ink');                          // the gap it left
  // relief on top: skull and crossed arms
  g.box(3, 10, 4, 5, 10, 6, 'bone'); g.set(4, 10, 4, 'ink'); g.set(4, 10, 6, 'ink');
  g.box(7, 10, 5, 12, 10, 5, 'frost'); g.box(9, 10, 3, 10, 10, 7, 'frost');
  g.box(14, 10, 4, 17, 10, 6, 'dusk');
  for (let q = 0; q < 10; q++) g.set(r.int(0, 20), r.int(6, 9), r.int(1, 9), 'stoneDark');
  for (let q = 0; q < 8; q++) g.set(r.int(0, 22), r.int(0, 2), 9, 'moss');
  defineModel('arena.sarcophagus', { grid: g });
}

{
  // altar: stepped base, a slab, a skull between candles, blood in the channel
  const g = new VoxelGrid(22, 12, 12);
  g.box(0, 0, 0, 21, 1, 11, 'stoneDark'); g.box(1, 2, 1, 20, 2, 10, 'stone');
  g.box(3, 3, 2, 18, 6, 9, 'stone'); g.box(2, 7, 1, 19, 7, 10, 'stoneLight');
  g.box(3, 8, 2, 18, 8, 9, 'stone');
  for (let x = 3; x < 19; x += 3) g.box(x, 3, 9, x, 6, 9, 'stoneDark');
  g.box(9, 9, 4, 12, 10, 7, 'bone'); g.set(9, 10, 7, 'ink'); g.set(12, 10, 7, 'ink'); g.set(10, 9, 7, 'ink');
  g.box(4, 9, 5, 4, 10, 5, 'bone'); g.set(4, 11, 5, 'gold', true);
  g.box(17, 9, 5, 17, 11, 5, 'bone'); g.set(17, 12 - 1, 5, 'gold', true);
  g.box(6, 9, 3, 7, 9, 8, 'blood'); g.box(14, 9, 3, 15, 9, 8, 'blood'); g.box(7, 8, 9, 7, 8, 10, 'blood');
  defineModel('arena.altar', { grid: g });
}

{
  // iron brazier bowl on legs, heaped with coals, a skull ornament on the rim
  const g = new VoxelGrid(11, 9, 11);
  const r = new Rng('arena.brazier');
  for (const [x, z] of [[2, 2], [8, 2], [2, 8], [8, 8]]) { g.box(x, 0, z, x, 4, z, 'shadow'); g.set(x, 0, z, 'slate'); }
  for (const [x, z] of [[3, 3], [7, 3], [3, 7], [7, 7]]) g.set(x, 2, z, 'slate');
  for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) {
    const d = Math.hypot(x - 5, z - 5);
    if (oct(x, z, 5, 5, 3)) g.set(x, 4, z, 'shadow');
    if (oct(x, z, 5, 5, 4)) g.set(x, 5, z, x > 5 ? 'shadow' : 'stoneDark');
    if (oct(x, z, 5, 5, 5) && !oct(x, z, 5, 5, 3)) g.set(x, 6, z, !oct(x, z, 5, 5, 4) ? 'slate' : 'stoneDark');
    if (oct(x, z, 5, 5, 3)) g.set(x, 6, z, r.chance(0.35) ? 'ember' : 'blood', true);
    if (d <= 2.2 && r.chance(0.6)) g.set(x, 7, z, r.chance(0.4) ? 'gold' : 'ember', true);
  }
  for (const [x, z] of [[0, 5], [10, 5], [5, 0]]) g.set(x, 6, z, 'fog');
  g.box(4, 5, 10, 6, 6, 10, 'bone'); g.set(4, 6, 10, 'ink'); g.set(6, 6, 10, 'ink');
  defineModel('arena.brazier', { grid: g });
}

{
  const g = new VoxelGrid(10, 11, 10);
  for (let y = 0; y < 11; y++) for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) {
    const belly = y > 2 && y < 8;
    if (!oct(x, z, 4.5, 4.5, belly ? 4.5 : 3.5)) continue;
    const band = y === 1 || y === 9 || (y === 5 && belly);
    const stave = x % 2 === 0;
    let col = band ? 'slate' : y === 10 ? ((x + z) % 3 ? 'wood' : 'woodLight') : stave ? 'wood' : 'woodLight';
    if (band && (x + z) % 4 === 0) col = 'mist';
    if (!band && y < 10 && x === 7 && y > 3 && y < 7) col = 'dirt';
    g.set(x, y, z, col);
  }
  g.set(4, 10, 4, 'dirt'); g.set(5, 10, 5, 'dirt');
  defineModel('arena.barrel', { grid: g });
}

{
  const g = new VoxelGrid(10, 9, 10);
  g.box(0, 0, 0, 9, 8, 9, 'wood');
  for (let y = 0; y < 9; y++) for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) {
    const ex = x === 0 || x === 9, ey = y === 0 || y === 8, ez = z === 0 || z === 9;
    if ((ex && ey) || (ex && ez) || (ey && ez)) g.set(x, y, z, 'dirt');
    else if ((ex || ez) && y % 3 === 1) g.set(x, y, z, 'woodLight');
    else if (ey && (x + z) % 4 === 0) g.set(x, y, z, 'woodLight');
  }
  for (let i = 1; i < 9; i++) g.set(i, i, 9, 'dirt');
  g.set(2, 8, 2, 'moss'); g.set(3, 8, 2, 'leaf');
  defineModel('arena.crate', { grid: g });
}

{
  // clay urn: round belly, narrow neck, a painted band
  const g = new VoxelGrid(9, 11, 9);
  const prof = [2.4, 3.1, 3.6, 3.9, 3.9, 3.6, 3.0, 2.2, 2.3, 3.0, 3.0];
  for (let y = 0; y < 11; y++) for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) {
    const d = Math.hypot(x - 4, z - 4);
    if (!oct(x, z, 4, 4, Math.round(prof[y] + 0.4))) continue;
    if (y === 10 && d < 2) continue;                    // the mouth
    const a = Math.atan2(z - 4, x - 4);
    let col = a > -2.3 && a < -0.6 ? 'woodLight' : a > 0.7 && a < 2.4 ? 'dirt' : 'wood';
    if (y === 4 || y === 3 && d > 3.2) col = 'blood';
    if (y === 10) col = 'woodLight';
    g.set(x, y, z, col);
  }
  g.box(3, 10, 3, 5, 10, 5, null); g.set(4, 9, 4, 'ink');
  defineModel('arena.urn', { grid: g });
}

{
  // a skull on its side, a crossed pair of long bones, a few ribs: low, so it reads as bones and not a creature
  const g = new VoxelGrid(15, 5, 10);
  const r = new Rng('arena.bones');
  g.box(2, 0, 3, 6, 2, 7, 'bone'); g.box(3, 3, 4, 5, 3, 6, 'bone'); g.box(3, 4, 4, 4, 4, 5, 'frost');
  g.set(2, 2, 3, null); g.set(6, 2, 3, null);
  g.set(3, 2, 7, 'ink'); g.set(5, 2, 7, 'ink'); g.set(4, 1, 7, 'ink'); g.box(3, 0, 7, 5, 0, 7, 'frost'); g.set(4, 0, 7, 'ink');
  g.set(2, 1, 5, 'frost'); g.set(6, 1, 5, 'frost');
  for (let k = 0; k < 8; k++) { g.set(7 + k, 0, 1 + Math.floor(k * 0.4), 'bone'); g.set(7 + k, 0, 8 - Math.floor(k * 0.6), 'bone'); }
  g.set(7, 1, 1, 'frost'); g.set(14, 1, 4, 'frost'); g.set(7, 1, 8, 'frost'); g.set(13, 1, 4, 'frost');
  for (let i = 0; i < 3; i++) { const x = 8 + i * 2; g.set(x, 0, 5, 'bone'); g.set(x, 1, 6, 'bone'); g.set(x, 1, 7, 'bone'); g.set(x, 0, 8, 'bone'); }
  for (let i = 0; i < 5; i++) g.set(r.int(0, 14), 0, r.int(0, 9), 'bone');
  defineModel('arena.bones', { grid: g });
  // scattered afterwards
  const s = new VoxelGrid(16, 2, 12);
  const q = new Rng('arena.bonesScatter');
  for (let i = 0; i < 12; i++) {
    const x = q.int(1, 13), z = q.int(1, 10), len = q.int(2, 4);
    const along = q.chance(0.5);
    for (let k = 0; k < len; k++) s.set(along ? Math.min(15, x + k) : x, 0, along ? z : Math.min(11, z + k), q.chance(0.8) ? 'bone' : 'frost');
  }
  s.box(6, 0, 5, 8, 1, 6, 'bone'); s.set(6, 1, 6, 'ink'); s.set(8, 1, 6, 'ink');
  defineModel('arena.bonesScatter', { grid: s });
}

{
  // rubble: loose chunks; the large one is a broken slab with a chipped corner
  for (const [name, w, h, d, n, seed] of [['arena.rubble', 12, 4, 10, 9, 'a'], ['arena.rubbleBig', 18, 8, 12, 16, 'b']]) {
    const g = new VoxelGrid(w, h, d);
    const r = new Rng(`arena.${name}/${seed}`);
    for (let i = 0; i < n; i++) {
      const x = r.int(0, w - 3), z = r.int(0, d - 3), s = r.int(1, name.endsWith('Big') ? 4 : 3);
      const top = r.int(0, s - 1) + (name.endsWith('Big') ? Math.max(0, 3 - Math.abs(x - w / 2) * 0.4) | 0 : 0);
      g.box(x, 0, z, x + s - 1, top, z + s - 1, r.pick(['stone', 'stoneLight', 'stoneDark', 'dusk']));
      g.set(x, top, z, 'stoneLight');
    }
    defineModel(name, { grid: g });
  }
  const s = new VoxelGrid(12, 1, 10);
  const r = new Rng('arena.splinters');
  for (let i = 0; i < 16; i++) s.set(r.int(0, 11), 0, r.int(0, 9), r.pick(['wood', 'woodLight', 'dirt']));
  for (let i = 0; i < 4; i++) { const x = r.int(0, 8), z = r.int(0, 9); for (let k = 0; k < 4; k++) s.set(x + k, 0, z, 'wood'); }
  defineModel('arena.splinters', { grid: s });
  const u = new VoxelGrid(10, 1, 10);
  const q = new Rng('arena.shards');
  for (let i = 0; i < 14; i++) u.set(q.int(0, 9), 0, q.int(0, 9), q.pick(['wood', 'dirt', 'blood', 'woodLight']));
  defineModel('arena.shards', { grid: u });
  const w = new VoxelGrid(10, 1, 10);
  for (let i = 0; i < 10; i++) w.set(q.int(0, 9), 0, q.int(0, 9), q.pick(['bone', 'frost', 'stoneLight']));
  defineModel('arena.wax', { grid: w });
}

{
  // candles: wax stubs and a puddle; the flames are lit voxels
  const g = new VoxelGrid(11, 8, 9);
  const r = new Rng('arena.candles');
  for (let z = 0; z < 9; z++) for (let x = 0; x < 11; x++) if (Math.hypot((x - 5) / 5, (z - 4) / 4) < 1 && r.chance(0.8)) g.set(x, 0, z, 'bone');
  for (const [x, z, h] of [[3, 3, 3], [5, 5, 6], [7, 3, 2], [4, 6, 2], [8, 6, 4], [6, 2, 3]]) {
    for (let y = 0; y <= h; y++) g.set(x, 1 + y, z, y % 3 === 2 ? 'frost' : 'bone');
    g.set(x, 2 + h, z, 'torch', true);
    g.set(x, 3 + h, z, 'gold', true);
  }
  defineModel('arena.candles', { grid: g });
}

for (const [key, cloth, trim, sigil] of [['blood', 'blood', 'gold', 'gold'], ['plum', 'plum', 'gold', 'rose'], ['navy', 'navy', 'frost', 'cyan']]) {
  // a hanging banner: rod, swallowtail hem, a sigil. Origin at the top so it swings from the rod.
  const g = new VoxelGrid(13, 26, 3);
  g.box(0, 25, 1, 12, 25, 1, 'wood'); g.set(0, 25, 1, 'gold'); g.set(12, 25, 1, 'gold');
  g.box(0, 24, 1, 0, 24, 1, 'slate'); g.box(12, 24, 1, 12, 24, 1, 'slate');
  for (let y = 4; y <= 24; y++) for (let x = 2; x <= 10; x++) {
    if (y < 9 && (y - 4) < Math.abs(x - 6) * 1.1) continue;    // swallowtail cut
    const edge = x === 2 || x === 10;
    const fold = (x - 2) % 3 === 0 && y > 8;
    g.set(x, y, 1, edge ? trim : y === 11 ? trim : y === 10 ? cloth : fold ? cloth : cloth);
    if (!edge && fold && y > 8) g.set(x, y, 1, key === 'navy' ? 'shadow' : 'shadow');
    if (!edge && !fold && y > 8 && (x + y) % 5 === 0) g.set(x, y, 1, key === 'navy' ? 'blue' : cloth);
    if (edge) g.set(x, y, 1, trim);
  }
  // sigil: a diamond with a dot
  for (let y = 12; y <= 21; y++) for (let x = 3; x <= 9; x++) {
    const d = Math.abs(x - 6) + Math.abs(y - 16.5);
    if (d < 4.6 && d > 3.1) g.set(x, y, 2, sigil);
    if (d < 1.2) g.set(x, y, 2, sigil);
  }
  defineModel(`arena.banner.${key}`, { grid: g, origin: [6.5, 25, 1] });
}

{
  // a cobweb for a corner, pinned to a wall face
  const g = new VoxelGrid(12, 12, 1);
  for (let k = 0; k < 12; k++) {
    g.set(k, 11, 0, 'fog'); g.set(0, 11 - k, 0, 'fog');
    g.set(k, 11 - k, 0, 'fog');
    if (k < 8) g.set(k, 11 - Math.floor(k * 0.45), 0, 'frost');
    if (k < 8) g.set(Math.floor(k * 0.45), 11 - k, 0, 'frost');
  }
  for (const rr of [4, 7, 10]) for (let a = 0; a <= rr; a++) { const x = Math.round(Math.cos(a / rr * 1.5708) * rr), y = 11 - Math.round(Math.sin(a / rr * 1.5708) * rr); if ((a + rr) % 3) g.set(x, y, 0, 'mist'); }
  defineModel('arena.web', { grid: g });
}

{
  // a fallen column, lying along x, with a broken end
  const g = new VoxelGrid(28, 9, 9);
  const r = new Rng('arena.fallen');
  const cy = 4, cz = 4;
  for (let x = 0; x < 28; x++) for (let y = 0; y < 9; y++) for (let z = 0; z < 9; z++) {
    const d = Math.hypot(y - cy, z - cz);
    const end = x > 22 ? (x - 22) * 0.35 * (0.6 + 0.8 * ((Math.sin(y * 2.1 + z) + 1) / 2)) : 0;
    if (d > 3.9 - end) continue;
    const a = Math.atan2(y - cy, z - cz);
    let col = Math.round(a / (Math.PI / 4)) % 2 === 0 ? 'stone' : 'dusk';
    if (a < -0.8 && a > -2.4) col = 'stoneLight';
    if (x % 9 === 4 && d > 2.9) col = 'stoneLight';
    if (x < 3 && d < 3.0 && d > 1) col = 'stoneDark';
    g.set(x, y, z, col);
  }
  for (let q = 0; q < 10; q++) g.set(r.int(0, 27), 0, r.int(1, 7), 'moss');
  defineModel('arena.fallen', { grid: g });
}

{
  // wall sconce: an iron bracket and a cup of coals; the flame is a swapped model above it
  const g = new VoxelGrid(5, 8, 5);
  g.box(2, 0, 0, 2, 4, 0, 'slate');
  g.box(2, 3, 1, 2, 3, 2, 'slate');
  g.box(1, 4, 1, 3, 4, 3, 'shadow'); g.box(1, 5, 1, 3, 5, 1, 'shadow'); g.box(1, 5, 3, 3, 5, 3, 'shadow'); g.set(1, 5, 2, 'shadow'); g.set(3, 5, 2, 'shadow');
  g.set(2, 4, 2, 'ember', true); g.set(2, 5, 2, 'ember', true);
  defineModel('arena.sconce', { grid: g, origin: [2.5, 0, 0] });
}

// ---- prop kinds --------------------------------------------------------------------------------

/**
 * kind table. r: collision/hit radius; box: [w, d] for a rectangular solid; solid: blocks bodies;
 * hp: Infinity for props that only react. debris: chunk colours (also read by combat's fx).
 */
export const KINDS = {
  pillar: { model: 'arena.pillar', r: 0.44, solid: true, hit: 'stone', h: 3.0, debris: ['stone', 'stoneLight', 'dusk'], hitY: 1.0 },
  pillarRuin: { model: 'arena.pillarRuin', r: 0.44, solid: true, hit: 'stone', h: 1.6, debris: ['stone', 'stoneLight', 'dusk'], hitY: 0.7 },
  statue: { model: 'arena.statue', r: 0.5, solid: true, hit: 'stone', h: 3.2, debris: ['mist', 'fog', 'slate'], hitY: 1.1 },
  sarcophagus: { model: 'arena.sarcophagus', box: [2.8, 1.3], solid: true, hit: 'stone', h: 1.4, debris: ['stone', 'stoneLight', 'stoneDark'], hitY: 0.6 },
  altar: { model: 'arena.altar', box: [2.6, 1.4], solid: true, hit: 'stone', h: 1.5, debris: ['stone', 'stoneLight', 'bone'], hitY: 0.6, candles: [[-0.9, 1.4], [0.9, 1.4]] },
  fallen: { model: 'arena.fallen', box: [3.4, 1.0], solid: true, hit: 'stone', h: 1.1, debris: ['stone', 'stoneLight', 'dusk'], hitY: 0.5 },
  brazier: { model: 'arena.brazier', r: 0.4, solid: true, hit: 'fire', h: 1.1, debris: ['flame', 'ember', 'slate'], hitY: 0.6, flame: { y: 0.93, s: 1 }, light: { color: 'flame', y: 1.5, intensity: 1.15, radius: 6.2, haze: 1 } },
  barrel: { model: 'arena.barrel', r: 0.36, solid: true, hit: 'wood', hp: 18, h: 1.3, debris: ['wood', 'woodLight', 'slate'], decal: 'arena.splinters', hitY: 0.6 },
  crate: { model: 'arena.crate', r: 0.4, solid: true, hit: 'wood', hp: 8, h: 1.1, debris: ['wood', 'woodLight', 'dirt'], decal: 'arena.splinters', hitY: 0.5 },
  urn: { model: 'arena.urn', r: 0.3, solid: true, hit: 'clay', hp: 8, h: 1.3, debris: ['wood', 'woodLight', 'blood', 'dirt'], decal: 'arena.shards', hitY: 0.6 },
  bones: { model: 'arena.bones', r: 0.5, hit: 'bones', hp: 1, h: 0.6, debris: ['bone', 'frost', 'bone'], decal: 'arena.bonesScatter', hitY: 0.3 },
  candles: { model: 'arena.candles', r: 0.5, hit: 'wax', hp: 1, h: 0.9, debris: ['bone', 'frost', 'gold'], decal: 'arena.wax', hitY: 0.4 },
  rubble: { model: 'arena.rubble', h: 0.4 },
  rubbleBig: { model: 'arena.rubbleBig', h: 0.9 },
  banner: { model: 'arena.banner.blood', h: 3.2 },
  web: { model: 'arena.web', h: 1.5 },
};

// ---- the prop object -----------------------------------------------------------------------------

const colorRamp = (c) => ramp([c]);
let seedN = 0;

/**
 * One placed prop. Position is in world units. opts: { yaw, variant, flip }. Give it a parent
 * group (`root`) and a collision world (`cw`), then call tick() and render(alpha) every frame.
 */
export class Prop {
  constructor(kind, x, z, { root, cw = null, yaw = 0, variant = null, id = null, scale = 1, y = 0, light: wantLight = true } = {}) {
    const K = KINDS[kind];
    if (!K) throw new Error(`props: unknown kind "${kind}"`);
    this.kind = kind; this.K = K; this.id = id ?? `${kind}${seedN++}`;
    this.x = x; this.z = z; this.y = y; this.yaw = yaw; this.scale = scale; this.flip = false;
    this.r = K.r ?? (K.box ? Math.hypot(K.box[0], K.box[1]) / 2.2 : 0.3);
    this.h = K.h ?? 1; this.hitY = K.hitY ?? this.h * 0.5;
    this.hp = K.hp ?? Infinity; this.maxHp = this.hp;
    this.dead = false; this.hits = 0; this.type = kind;
    this.debris = K.debris; this.noAssist = true; this.prop = true;
    this.hittable = !!K.hit;
    this.root = root; this.cw = cw;
    this.model = variant ? `${K.model.replace(/\.[a-z]+$/, '')}.${variant}` : K.model;
    this.mesh = voxelMesh(this.model, { ownMaterial: this.hittable });
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = yaw;
    if (scale !== 1) this.mesh.scale.setScalar(scale);
    root.add(this.mesh);
    this.mat = this.hittable ? this.mesh.material : null;
    // solids
    this.shape = null;
    if (K.solid && cw) {
      if (K.box) {
        const [w, d] = Math.abs(Math.sin(yaw)) > 0.7 ? [K.box[1], K.box[0]] : K.box;
        this.shape = cw.addRect(x, z, w, d, kind);
      } else this.shape = cw.addCircle(x, z, this.r * 0.85, kind);
    }
    // animation state
    this.flash = 0; this.flashLen = 1; this.sq = 0; this.tx = 0; this.tz = 0; this.tvx = 0; this.tvz = 0;
    this.shakeT = 0; this.swing = 0; this.swingV = 0; this.pop = 0; this.spawnT = 0;
    this.flare = 0; this.t = Math.floor(Math.random() * 100); this.phase = Math.abs((x * 12.9898 + z * 78.233) % 6.28);
    this.crackStage = 0;
    this.decals = [];
    this.light = null; this.flameMesh = null; this.candleFlames = [];
    if (K.light && wantLight && look.lights) this.light = look.torch(this.mesh, { x: 0, y: K.light.y, z: 0, color: K.light.color, intensity: K.light.intensity, radius: K.light.radius, haze: K.light.haze ?? 1 });
    if (K.flame) { this.flameMesh = voxelMesh('arena.flame.0'); this.flameMesh.scale.setScalar(K.flame.s); root.add(this.flameMesh); look.noShadow(this.flameMesh); }
    if (kind === 'candles') {
      this.candleFlames = [];
    }
    if (kind === 'altar') {
      for (const [dx, dz] of K.candles ?? []) { /* the altar's own candles are lit voxels on the model */ void dx; void dz; }
    }
  }

  /** Combat contract: apply a hit. Return false to ignore it. */
  takeHit(hit) {
    if (this.dead || !this.hittable) return false;
    this.hits++;
    this.hp -= hit.dmg;
    const k = { stone: 0.5, fire: 0.6, wood: 1, clay: 1, bones: 1, wax: 1 }[this.K.hit] ?? 1;
    const d = { x: hit.dx, z: hit.dz };
    this.flash = hit.flashTicks; this.flashLen = hit.flashTicks;
    this.sq = Math.min(1, 0.4 + 0.2 * hit.power);
    const wob = this.K.hit === 'stone' ? 0.12 : 0.5;
    this.tvz += -d.x * wob * k * 0.5; this.tvx += d.z * wob * k * 0.5;
    this.shakeT = this.K.hit === 'stone' ? 9 : 5;
    hit.knock = 0; hit.lift = 0;
    const px = this.x - d.x * this.r * 0.6, pz = this.z - d.z * this.r * 0.6;
    switch (this.K.hit) {
      case 'stone': {
        hit.stopMs = 24;
        // a clang, dust shaken loose from the top, chips that skitter
        vfx.dust({ x: this.x, y: Math.min(this.h, 2.4) - 0.1, z: this.z, n: 5, size: 3, speed: 0.5 });
        vfx.dust({ x: px, y: this.hitY, z: pz, n: 3, size: 3, speed: 0.6 });
        chunks(px, this.hitY, pz, d, this.K.debris, 3 + this.hits % 2, 0.7);
        if (this.hits % 3 === 0) vfx.dust({ x: this.x, y: 0.05, z: this.z, n: 6, size: 4, speed: 0.8 });
        events.emit('arena:propHit', { prop: this, kind: this.kind, x: this.x, z: this.z });
        break;
      }
      case 'fire': {
        hit.stopMs = 30;
        this.flare = 1;
        vfx.embers({ x: this.x, y: this.K.flame.y + 0.15, z: this.z, n: 18 });
        vfx.flash({ x: this.x, y: 1.0, z: this.z, color: 'flame', radius: 1.7, ms: 170, intensity: 2.2 });
        events.emit('arena:propHit', { prop: this, kind: this.kind, x: this.x, z: this.z });
        break;
      }
      case 'wood': case 'clay': case 'bones': case 'wax': {
        if (this.hp <= 0) return this.breakOpen(hit, d), true;
        // damaged but standing: a hoop pops, splinters fly
        hit.stopMs = 35;
        this.crackStage = 1;
        chunks(px, this.hitY, pz, d, this.K.debris, 4, 0.8);
        vfx.dust({ x: px, y: this.hitY - 0.2, z: pz, n: 3, size: 3, speed: 0.6 });
        events.emit('arena:propHit', { prop: this, kind: this.kind, x: this.x, z: this.z });
        break;
      }
      default: break;
    }
    return true;
  }

  breakOpen(hit, d) {
    this.dead = true;
    hit.stopMs = 45;
    const K = this.K, y = this.hitY;
    const big = this.kind === 'barrel' ? 1.15 : 1;
    chunks(this.x, y, this.z, d, K.debris, Math.round(14 * big), 1.1);
    vfx.dust({ x: this.x, y: 0.08, z: this.z, n: 9, size: 5, speed: 0.9 });
    if (K.hit === 'bones') vfx.dust({ x: this.x, y: 0.2, z: this.z, n: 6, size: 4, style: 'ice', speed: 0.7 });
    if (K.hit === 'wax') { look.flash(this.x, 0.7, this.z, { color: 'flame', ms: 90, intensity: 1.2, radius: 2.2 }); vfx.embers({ x: this.x, y: 0.6, z: this.z, n: 5 }); }
    feedback.shake(1.4, 90);
    events.emit('arena:propBreak', { prop: this, kind: this.kind, x: this.x, z: this.z, hit: K.hit });
    events.emit('combat:kill', { target: this, x: this.x, z: this.z });
    if (this.shape && this.cw) { this.cw.remove(this.shape); this.shape = null; }
    if (this.light) { this.light.remove(); this.light = null; }
    // the decal it leaves behind pops in
    if (K.decal) {
      const m = voxelMesh(K.decal);
      m.position.set(this.x, 0.008, this.z);
      m.rotation.y = this.yaw + Math.PI * 0.5 * Math.floor(Math.random() * 4);
      m.scale.setScalar(0.01);
      this.root.add(m);
      look.noShadow(m);
      this.decals.push({ mesh: m, t: 0 });
    }
    this.mesh.visible = false;
    if (this.flameMesh) this.flameMesh.visible = false;
  }

  /** Something big happened close by (a slam, a wave spawning): banners swing, dust falls. */
  nudge(strength = 1) { this.swingV += strength * 0.03; }

  tick() {
    this.t++;
    this.spawnT++;
    if (this.flash > 0) this.flash--;
    if (this.shakeT > 0) this.shakeT--;
    this.sq *= 0.72;
    if (this.sq < 0.01) this.sq = 0;
    this.ptx = this.tx; this.ptz = this.tz;
    const K = 0.16, Dm = 0.8;
    this.tvx = (this.tvx - this.tx * K) * Dm; this.tvz = (this.tvz - this.tz * K) * Dm;
    this.tx = clamp(this.tx + this.tvx, -0.5, 0.5); this.tz = clamp(this.tz + this.tvz, -0.5, 0.5);
    if (this.kind === 'banner') {
      this.swingV += (-this.swing * 0.02) - this.swingV * 0.02;
      this.swingV += Math.sin(this.t * 0.03 + this.phase) * 0.0006;
      this.swing += this.swingV;
    }
    if (this.flare > 0) this.flare = Math.max(0, this.flare - 0.04);
    if (this.light) {
      const base = this.K.light.intensity;
      this.light.intensity = base * (1 + this.flare * 1.4);
    }
    // fire props: the odd ember drifts up, on a fixed rhythm so rooms look alive
    if (this.K.flame && !this.dead && (this.t + Math.floor(this.phase * 3)) % 21 === 0) vfx.embers({ x: this.x + (Math.random() - 0.5) * 0.2, y: this.K.flame.y + 0.25, z: this.z + (Math.random() - 0.5) * 0.2, n: 1 });
    for (const d of this.decals) if (d.t < 8) d.t++;
  }

  render(alpha) {
    const m = this.mesh;
    if (this.flameMesh) {
      const f = (Math.floor(loop.tick / 4) + Math.floor(Math.abs(this.phase) * 3)) % 4;
      this.flameMesh.geometry = flameGeo(f);
      const s = this.K.flame.s * (1 + this.flare * 0.7) * (0.95 + 0.1 * Math.sin(loop.tick * 0.6 + this.phase));
      this.flameMesh.scale.set(s, s * (1 + this.flare * 0.4), s);
      const v = new THREE.Vector3(this.x, this.K.flame.y, this.z);
      look.snap(v);
      this.flameMesh.position.copy(v);
    }
    for (const d of this.decals) { const k = Math.min(1, d.t / 6); d.mesh.scale.setScalar(k < 1 ? 0.3 + 0.9 * k * (2 - k) * 0.85 : 1); }
    if (this.dead) return;
    const tx = this.ptx !== undefined ? this.ptx + (this.tx - this.ptx) * alpha : this.tx;
    const tz = this.ptz !== undefined ? this.ptz + (this.tz - this.ptz) * alpha : this.tz;
    const sq = this.sq;
    let jx = 0, jz = 0;
    if (this.shakeT > 0) { jx = (this.shakeT % 2 ? 1 : -1) * V * 0.5 * (this.shakeT / 9); jz = 0; }
    const v = new THREE.Vector3(this.x + jx, this.y, this.z + jz);
    look.snap(v);
    m.position.copy(v);
    const s = this.scale, sx = this.flip ? -1 : 1;
    if (this.kind === 'banner') { m.rotation.z = this.swing; m.rotation.x = this.swing * 0.35; } else m.rotation.set(tx, this.yaw, tz, 'YXZ');
    if (this.kind !== 'banner') m.scale.set(sx * s * (1 + sq * 0.07), s * (1 - sq * 0.09), s * (1 + sq * 0.07));
    if (this.mat) {
      const f = this.flash <= 0 ? 0 : this.flash > this.flashLen / 2 ? 1 : 0.5;
      this.mat.userData.flash.value = f;
    }
    // a barrel or crate that has taken a hit shows it: a small permanent lean
    if (this.crackStage && this.kind !== 'banner') m.rotation.z += 0.06;
  }

  dispose() {
    this.root.remove(this.mesh);
    if (this.flameMesh) this.root.remove(this.flameMesh);
    for (const d of this.decals) this.root.remove(d.mesh);
    if (this.shape && this.cw) this.cw.remove(this.shape);
    if (this.light) this.light.remove();
    if (this.mat) this.mat.dispose?.();
  }

  info() { return { id: this.id, kind: this.kind, x: +this.x.toFixed(2), z: +this.z.toFixed(2), hp: this.hp === Infinity ? null : this.hp, dead: this.dead, hits: this.hits }; }
}

const flameGeos = [];
function flameGeo(i) {
  if (!flameGeos[i]) flameGeos[i] = voxelMesh(`arena.flame.${i}`).geometry;
  return flameGeos[i];
}
export { flameGeo };

/** Bouncing chunks in a prop's own colours. Pooled through the shared vfx particles. */
export function chunks(x, y, z, dir, colors, n, power = 1) {
  const pp = vfx.pool;
  if (!pp) return;
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(dir.x, dir.z) + (Math.random() - 0.5) * 2.4;
    const sp = (1.6 + Math.random() * 3) * (0.7 + power * 0.35);
    const big = i % 4 === 0;
    pp.add(x + (Math.random() - 0.5) * 0.15, y + (Math.random() - 0.4) * 0.25, z + (Math.random() - 0.5) * 0.15,
      Math.sin(a) * sp, 2 + Math.random() * 4.5, Math.cos(a) * sp,
      0.7 + Math.random() * 0.7, big ? 5 : 3, big ? 3 : 2, colorRamp(colors[i % colors.length]), F_BOUNCE, 0.97, 24);
  }
}

/** Every prop model name, for the debug overlay. */
export const PROP_MODELS = Object.values(KINDS).map((k) => k.model);
export { hex, DT };
