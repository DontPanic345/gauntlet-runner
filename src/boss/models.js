// Voxel models for The Warden and his arena (piece `boss`). Authored in code, palette names only.
// Front is +z. The Warden is about 3x the hero: 9 voxel legs, a 13 voxel torso, a 12 voxel helm.
// Moving parts (legs, arms, head, keys, tabard) are separate models with their origin at the pivot.

import { defineModel, VoxelGrid, VOXEL } from '../render/voxel/index.js';

const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

function blob(g, cx, cy, cz, rx, ry, rz, fn, emissive = false) {
  const [sx, sy, sz] = g.size;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 1) continue;
    const c = fn(x, y, z, d, dx, dy, dz);
    if (c) g.set(x, y, z, c, emissive);
  }
}
const box = (g, x0, y0, z0, x1, y1, z1, fn, em = false) => {
  for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.set(x, y, z, fn === null ? null : typeof fn === 'string' ? fn : fn(x, y, z), em);
};

let built = false;
export function buildBossModels() {
  if (built) return;
  built = true;

  // ---- LEG: greave and boot, a knee plate, gold buckle. Pivot at the hip. ---------------------
  {
    const g = new VoxelGrid(6, 12, 7);
    box(g, 0, 3, 0, 5, 11, 5, (x, y, z) => (x === 0 ? 'mist' : x === 5 ? 'stone' : y > 8 ? 'slate' : (hash(x, y, z) < 0.2 ? 'mist' : 'slate')));
    box(g, 0, 6, 5, 5, 8, 6, (x, y) => (y === 8 ? 'fog' : 'mist'));             // knee plate, pushed forward
    g.set(2, 7, 6, 'frost'); g.set(3, 7, 6, 'frost');
    for (const x of [1, 4]) g.set(x, 7, 6, 'gold');
    box(g, 0, 0, 0, 5, 2, 6, (x, y, z) => (y === 0 ? 'ink' : z >= 5 ? 'stone' : x === 0 ? 'slate' : 'stone'));  // boot, toe forward
    box(g, 0, 3, 5, 5, 3, 6, 'stone'); g.set(2, 3, 6, 'gold'); g.set(3, 3, 6, 'gold');   // strap and buckle
    box(g, 1, 4, 1, 4, 4, 5, 'wood');
    for (let x = 0; x < 6; x++) g.set(x, 11, 0, 'stone');
    defineModel('boss.leg', { grid: g, origin: [3, 12, 3] });
  }

  // ---- TORSO: barrel chest of plate, belt of keys, and a prisoner's cage on his back. ----------
  {
    const g = new VoxelGrid(18, 14, 14);
    const cx = 8.5;
    for (let y = 0; y <= 12; y++) {
      const hw = y < 2 ? 5.4 : 5.4 + (y - 1) * 0.36;                 // waist to shoulders
      const hd = y < 2 ? 4.0 : 4.6;
      for (let z = 3; z <= 12; z++) for (let x = 0; x < 18; x++) {
        const dx = Math.abs(x + 0.5 - cx), dz = Math.abs(z + 0.5 - 7.5);
        if (dx > hw || dz > hd + 0.5) continue;
        if (dx > hw - 0.9 && dz > hd - 0.6) continue;                // chamfer the corners
        const front = z >= 11, side = dx > hw - 1.2;
        let c = 'slate';
        if (y <= 1) c = (x + z) % 2 ? 'stone' : 'slate';          // banded waist
        else if (y >= 10) c = side ? 'slate' : 'mist';                // gorget line
        else if (front) c = (y === 5 || y === 8) ? 'fog' : (dx < 1.6 ? 'mist' : (hash(x, y, z) < 0.18 ? 'mist' : 'slate'));
        else if (side) c = 'stone';
        else if (hash(x, y, z) < 0.22) c = 'stone';
        g.set(x, y, z, c);
      }
    }
    // belt and buckle
    box(g, 3, 2, 3, 14, 3, 12, (x, y, z) => ((x < 4 || x > 13 || z < 4) && y === 3 ? 'stone' : 'wood'));
    box(g, 7, 2, 12, 10, 3, 12, 'gold'); g.set(8, 2, 12, 'woodLight'); g.set(9, 3, 12, 'woodLight');
    // chest: the gaol key in gold, a ring bow and a toothed shaft
    for (const [x, y] of [[7, 10], [8, 10], [9, 10], [10, 10], [7, 9], [10, 9], [7, 8], [10, 8], [7, 7], [8, 7], [9, 7], [10, 7], [8, 6], [9, 6], [8, 5], [9, 5], [8, 4], [9, 4], [10, 5], [10, 4], [7, 6]]) g.set(x, y, 12, 'bone');
    g.set(8, 10, 12, 'white'); g.set(9, 10, 12, 'white');
    // shoulder yoke: a rim of pale iron on top
    for (let x = 1; x < 17; x++) for (let z = 4; z < 12; z++) {
      const dx = Math.abs(x + 0.5 - cx);
      if (dx > 7.6) continue;
      if (g.get(x, 12, z)) g.set(x, 12, z, dx > 5.5 ? 'fog' : 'frost');
    }
    // the cage on his back: iron bars, a bone-white prisoner inside
    box(g, 4, 1, 0, 13, 11, 2, null);
    for (let y = 1; y <= 11; y++) for (let x = 4; x <= 13; x++) {
      const edge = y === 1 || y === 11 || x === 4 || x === 13;
      const bar = (x - 4) % 3 === 0 || y === 6;
      if (edge) box(g, x, y, 0, x, y, 0, 'ink'), g.set(x, y, 2, 'stone');
      else if (bar) g.set(x, y, 0, 'stone');
    }
    for (const [x, y] of [[7, 8], [8, 8], [9, 8], [8, 7], [7, 4], [9, 4], [8, 5]]) g.set(x, y, 1, 'bone');   // a skull and bones
    g.set(7, 8, 1, 'bone'); g.set(9, 8, 1, 'bone'); g.set(8, 8, 1, 'ink');
    box(g, 4, 11, 0, 13, 11, 3, 'stone');
    box(g, 6, 12, 1, 11, 12, 2, 'ink'); g.set(8, 13, 1, 'stone'); g.set(9, 13, 1, 'stone');    // the hook it hangs from
    // rivets on the yoke, dents, a strap across the chest
    for (let i = 0; i < 9; i++) { const x = 4 + i, y = 11 - (i >> 1); if (g.get(x, y, 12)) g.set(x, y, 12, 'wood'); }
    defineModel('boss.torso', { grid: g, origin: [8.5, 0, 7.5] });

    // ember cracks laid over the front of the plate (phase 2) and the back
    const cr = new VoxelGrid(18, 14, 2);
    const path = [[8, 11], [8, 10], [7, 9], [7, 8], [6, 7], [6, 6], [5, 5], [5, 4], [6, 3], [6, 2], [11, 10], [11, 9], [12, 8], [12, 7], [13, 6], [12, 5], [11, 4], [10, 3], [4, 8], [3, 7], [13, 9]];
    for (const [x, y] of path) { cr.set(x, y, 0, hash(x, y) < 0.35 ? 'gold' : 'ember', true); }
    for (const [x, y] of [[8, 9], [6, 5], [12, 6]]) cr.set(x, y, 0, 'torch', true);
    defineModel('boss.cracks', { grid: cr, origin: [8.5, 0, -5.45] });
    const cb = new VoxelGrid(18, 14, 2);
    for (const [x, y] of [[9, 12], [9, 11], [10, 10], [10, 9], [9, 8], [8, 7], [8, 6], [7, 5], [6, 4], [12, 11], [13, 10], [13, 9], [4, 10], [5, 9]]) cb.set(x, y, 0, hash(x, y) < 0.4 ? 'gold' : 'ember', true);
    defineModel('boss.cracksBack', { grid: cb, origin: [8.5, 0, 8.55] });
  }

  // ---- HEAD: a barrel helm with a T slit, bone horns curving up. The eyes are their own model. --
  {
    const g = new VoxelGrid(16, 17, 10);
    const X0 = 4;                                                   // helm spans x 4..11
    box(g, X0 + 1, 0, 1, X0 + 6, 1, 8, (x, y, z) => ((x + z) % 2 ? 'stone' : 'slate'));      // gorget ring
    for (let y = 2; y <= 11; y++) for (let z = 0; z <= 9; z++) for (let x = X0; x <= X0 + 7; x++) {
      if ((x === X0 || x === X0 + 7) && (z === 0 || z === 9)) continue;
      if (y >= 10 && (x === X0 || x === X0 + 7 || z === 0 || z === 9)) continue;
      if (y === 11 && (x === X0 + 1 || x === X0 + 6)) continue;
      let c = 'slate';
      if (x <= X0 + 1) c = 'mist'; else if (x >= X0 + 6) c = 'stone';
      if (y >= 10) c = x < X0 + 4 ? 'fog' : 'mist';
      if (z === 9 && x >= X0 + 2 && x <= X0 + 5) c = y % 3 === 0 ? 'frost' : 'mist';
      if (hash(x, y, z) < 0.1) c = 'stone';
      g.set(x, y, z, c);
    }
    for (let y = 2; y <= 11; y++) g.set(X0 + 3, y, 9, 'ink');              // seam down the middle
    for (const y of [3, 9]) { g.set(X0 + 1, y, 9, 'gold'); g.set(X0 + 6, y, 9, 'gold'); }   // rivets
    // the T slit: a dark recess for the eyes to burn in
    box(g, X0 + 1, 6, 9, X0 + 6, 7, 9, 'ink');
    box(g, X0 + 2, 3, 9, X0 + 2, 5, 9, 'ink'); box(g, X0 + 5, 3, 9, X0 + 5, 5, 9, 'ink');   // breathing slits
    box(g, X0 + 1, 6, 8, X0 + 6, 7, 8, 'night');
    // crest: a ridge of iron running back
    box(g, X0 + 3, 12, 2, X0 + 4, 13, 8, (x, y, z) => (y === 13 ? 'stone' : 'slate'));
    box(g, X0 + 3, 14, 4, X0 + 4, 14, 8, 'stone');
    // horns: bone, swept out and up, tipped white
    for (const [side, xs] of [[-1, X0], [1, X0 + 7]]) {
      const pts = [[xs, 9], [xs + side, 10], [xs + side * 2, 10], [xs + side * 3, 11], [xs + side * 3, 12], [xs + side * 3, 13], [xs + side * 2, 14], [xs + side * 2, 15], [xs + side, 16]];
      pts.forEach(([x, y], i) => box(g, x, y, 4, x, y, 5, i >= 7 ? 'white' : (i < 3 ? 'bone' : 'bone')));
    }
    defineModel('boss.head', { grid: g, origin: [X0 + 3.5, 0, 4.5] });

    const e = new VoxelGrid(6, 2, 1);
    for (const x0 of [0, 4]) { box(e, x0, 0, 0, x0 + 1, 1, 0, 'flame', true); e.set(x0, 0, 0, 'white', true); e.set(x0 + 1, 1, 0, 'torch', true); }
    defineModel('boss.eyes', { grid: e, origin: [3, 0, 0] });
  }

  // ---- ARM: a spiked pauldron, a bracer, a gauntlet. Pivot at the shoulder. --------------------
  for (const [name, gold] of [['boss.armL', true], ['boss.armR', false]]) {
    const g = new VoxelGrid(10, 19, 8);
    blob(g, 5, 14.6, 4, 4.7, 3.2, 3.8, (x, y, z, d, dx, dy) => (Math.abs(dy - 0.05) < 0.12 ? 'stone' : dy > 0.5 ? 'fog' : dy > 0.05 ? 'mist' : dy < -0.5 ? 'stone' : 'slate'));
    for (const [x, y, z] of [[5, 18, 4], [2, 16, 4], [8, 16, 4]]) { g.set(x, y, z, 'bone'); if (y === 18) g.set(x, 17, z, 'bone'); }
    g.set(5, 18, 4, 'white');
    box(g, 3, 9, 2, 6, 12, 5, (x, y, z) => (x === 3 ? 'mist' : y === 12 ? 'stone' : 'slate'));            // upper arm
    box(g, 3, 7, 2, 6, 8, 5, (x, y, z) => ((x + z) % 2 ? 'stone' : 'mist'));                              // elbow
    box(g, 2, 3, 1, 7, 6, 6, (x, y, z) => (y === 4 ? 'fog' : (x <= 3 ? 'mist' : 'slate')));                  // bracer
    box(g, 2, 3, 6, 7, 3, 6, 'stone');
    for (const x of [3, 6]) g.set(x, 5, 6, 'gold');
    box(g, 2, 0, 1, 7, 2, 6, (x, y, z) => (y === 0 ? 'ink' : (z === 6 && y === 2 ? 'frost' : 'stone')));   // fist
    box(g, 3, 1, 6, 6, 1, 6, 'slate');
    if (gold) { box(g, 1, 4, 0, 8, 5, 7, (x, y, z) => ((x === 1 || x === 8 || z === 0 || z === 7) ? 'gold' : null)); }   // shackle
    else { box(g, 3, 0, 2, 6, 0, 5, 'ink'); g.set(4, 1, 7, 'gold'); g.set(5, 1, 7, 'gold'); }                  // the chain's grip ring
    defineModel(name, { grid: g, origin: [5, 15, 4] });
  }

  // ---- keys on his belt (swing), the red tabard (sways) ---------------------------------------
  {
    const k = new VoxelGrid(5, 8, 2);
    k.set(2, 7, 0, 'ink');
    for (const [x, y, h] of [[0, 5, 4], [2, 6, 6], [4, 5, 5]]) {
      for (let i = 0; i < h; i++) k.set(x, y - i, 0, 'gold');
      k.set(x, y - h, 0, 'gold'); k.set(x === 0 ? 1 : x - 1, y - h, 0, 'woodLight');
      k.set(x, y, 1, 'torch');
    }
    defineModel('boss.keys', { grid: k, origin: [2.5, 7, 0.5] });
    const t = new VoxelGrid(9, 10, 2);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const hw = 4.5 - (y < 3 ? (3 - y) * 0.3 : 0);
      if (Math.abs(x + 0.5 - 4.5) > hw) continue;
      if (y === 0 && x % 2) continue;                              // ragged hem
      t.set(x, y, 0, y >= 8 ? 'wood' : (x === 4 || (y === 0 || y === 1) ? 'blood' : (x % 3 === 0 ? 'blood' : 'red')));
    }
    for (const y of [3, 4]) for (const x of [3, 4, 5]) t.set(x, y, 1, 'gold');
    defineModel('boss.tabard', { grid: t, origin: [4.5, 10, 0] });
  }

  // ---- the chain: interlocked links, and the ball ----------------------------------------------
  {
    const a = new VoxelGrid(3, 2, 4);                                // link seen edge on
    box(a, 0, 0, 0, 2, 1, 3, (x, y, z) => ((x === 1 && z > 0 && z < 3) ? null : (y === 1 ? 'frost' : 'fog')));
    defineModel('boss.linkA', { grid: a });
    const b = new VoxelGrid(2, 3, 4);                                // the next link, turned 90 degrees
    box(b, 0, 0, 0, 1, 2, 3, (x, y, z) => ((y === 1 && z > 0 && z < 3) ? null : (x === 1 ? 'frost' : 'fog')));
    defineModel('boss.linkB', { grid: b });
    const ball = new VoxelGrid(11, 11, 11);
    blob(ball, 5.5, 5.5, 5.5, 4.6, 4.6, 4.6, (x, y, z, d, dx, dy, dz) => (dy + dx * 0.5 > 0.55 ? 'mist' : d > 0.8 ? 'slate' : (hash(x, y, z) < 0.2 ? 'slate' : 'stone')));
    // spikes on all six sides and the diagonals, with a bone tip
    const P = 5;
    for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      for (let i = 4; i <= 5; i++) ball.set(P + ax * i, P + ay * i, P + az * i, i === 5 ? 'bone' : 'fog');
    }
    for (const [ax, ay, az] of [[1, 1, 1], [-1, 1, 1], [1, 1, -1], [-1, 1, -1], [1, -1, 1], [-1, -1, 1], [1, -1, -1], [-1, -1, -1]]) ball.set(P + ax * 3, P + ay * 3, P + az * 3, 'bone');
    for (const [x, y, z] of [[5, 5, 9], [5, 8, 6], [9, 5, 5]]) ball.set(x, y, z, 'ember', true);
    defineModel('boss.ball', { grid: ball, origin: [5.5, 5.5, 5.5] });
  }

  // ---- the arena: a bar for the cage, a brazier, wall sections --------------------------------
  {
    const b = new VoxelGrid(3, 30, 3);
    box(b, 0, 0, 0, 2, 29, 2, (x, y, z) => (x === 0 ? 'stoneDark' : x === 2 ? 'ink' : (y % 9 < 1 ? 'mist' : 'stone')));
    box(b, 0, 0, 0, 2, 2, 2, 'stoneLight');
    box(b, 0, 26, 0, 2, 29, 2, (x, y) => (y === 29 ? 'bone' : 'stone'));
    b.set(1, 29, 1, 'white'); b.set(1, 28, 1, 'bone');
    for (let y = 3; y < 26; y += 8) for (let z = 0; z < 3; z++) g2(b, y, z);
    defineModel('boss.bar', { grid: b });
    const rail = new VoxelGrid(16, 3, 3);                            // cross-band between bars
    box(rail, 0, 0, 0, 15, 2, 2, (x, y) => (y === 2 ? 'mist' : 'stoneDark'));
    defineModel('boss.rail', { grid: rail });

    const br = new VoxelGrid(9, 11, 9);
    box(br, 3, 0, 3, 5, 6, 5, (x, y, z) => (y < 2 ? 'stoneLight' : 'stone'));
    box(br, 1, 6, 1, 7, 6, 7, 'stoneDark');
    for (const [x, z] of [[0, 4], [8, 4], [4, 0], [4, 8], [1, 1], [7, 7], [1, 7], [7, 1]]) br.set(x, 7, z, 'stoneDark');
    box(br, 1, 7, 1, 7, 7, 7, (x, y, z) => ((x === 1 || x === 7 || z === 1 || z === 7) ? 'stoneDark' : 'ember'));
    box(br, 2, 7, 2, 6, 7, 6, (x, y, z) => (hash(x, z) < 0.5 ? 'ember' : 'red'), true);
    for (const [x, z] of [[3, 3], [5, 5], [4, 4]]) br.set(x, 8, z, 'flame', true);
    defineModel('boss.brazier', { grid: br });
  }

  // the key he carries, dropped when he dies: a gaol key, gold
  {
    const k = new VoxelGrid(5, 12, 2);
    blob(k, 2.5, 9, 1, 2.5, 2.5, 1.2, (x, y, z, d) => (d > 0.5 ? 'gold' : null));
    box(k, 2, 0, 0, 2, 7, 1, 'gold');
    box(k, 3, 1, 0, 4, 1, 1, 'gold'); box(k, 3, 3, 0, 4, 3, 1, 'gold');
    k.set(2, 9, 0, 'torch', true); k.set(2, 9, 1, 'torch', true);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 5; x++) if (k.get(x, y, 0) && hash(x, y) < 0.3) k.set(x, y, 0, 'torch', true);
    defineModel('boss.key', { grid: k, origin: [2.5, 6, 1] });
  }
}
function g2(b, y, z) { b.set(0, y, z, 'mist'); b.set(1, y, z, 'mist'); b.set(2, y, z, 'mist'); }
export { VOXEL };
