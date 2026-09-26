// Voxel models for the enemy roster (piece `enemies`). Authored in code, palette names only.
// Front is +z. Parts that animate (arms, legs, flame tail) are separate models with their
// origin at the pivot, so the AI can swing them without re-meshing.

import { defineModel, VoxelGrid, VOXEL } from '../render/voxel/index.js';

const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

/** Fill an ellipsoid; fn(x, y, z, d) returns a palette name (or null to skip), d = 0 centre .. 1 rim. */
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
/** The frontmost filled z at (x, y), or -1. */
const front = (g, x, y) => { for (let z = g.size[2] - 1; z >= 0; z--) if (g.get(x, y, z)) return z; return -1; };
const box = (g, x0, y0, z0, x1, y1, z1, fn) => {
  for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.set(x, y, z, typeof fn === 'string' ? fn : fn(x, y, z));
};

let built = false;
export function buildEnemyModels() {
  if (built) return;
  built = true;

  // ---- HUSK: a hunched, rag-wrapped corpse. Green skin, bone ribs, burning eyes. ---------------
  {
    const g = new VoxelGrid(9, 9, 8);
    blob(g, 4.5, 2.6, 3.4, 3.2, 3.0, 2.3, (x, y, z, d, dx, dy) => {
      if (y <= 1) return (x + z) % 2 ? 'woodLight' : 'wood';                       // ragged loincloth
      if (y >= 5) return hash(x, y, z + 5) < 0.4 ? 'woodLight' : 'leaf';           // shoulder wrap
      return dy < -0.3 || hash(x, y, z) < 0.15 ? 'moss' : 'leaf';
    });
    // ribs on the front and a spine knob at the back
    for (let y = 2; y <= 4; y += 2) for (let x = 2; x <= 6; x++) { const z = front(g, x, y); if (z >= 0 && x !== 4) g.set(x, y, z, 'bone'); }
    g.set(4, 4, 0, 'bone'); g.set(5, 3, 0, 'bone');
    // head: pushed forward and low, a slack jaw and two burning eyes
    blob(g, 4.5, 6.4, 4.7, 2.3, 2.0, 2.1, (x, y, z, d, dx, dy) => (dy < -0.4 ? 'moss' : 'leaf'));
    for (const ex of [3, 5]) { const z = front(g, ex, 7); if (z >= 0) g.set(ex, 7, z, 'flame', true); }
    { const z = front(g, 4, 5); if (z >= 0) { g.set(4, 5, z, 'ink'); g.set(3, 5, z, 'ink'); g.set(5, 5, z, 'ink'); } }
    box(g, 3, 8, 3, 5, 8, 4, (x, y, z) => (hash(x, z) < 0.5 ? 'dirt' : 'wood'));   // matted hair
    defineModel('enemy.husk.body', { grid: g, origin: [4.5, 0, 3.5] });

    const leg = new VoxelGrid(2, 4, 3);
    box(leg, 0, 2, 0, 1, 3, 1, 'wood');
    box(leg, 0, 1, 0, 1, 1, 1, 'moss');
    box(leg, 0, 0, 0, 1, 0, 2, 'bone');
    defineModel('enemy.husk.leg', { grid: leg, origin: [1, 4, 1] });

    const arm = new VoxelGrid(2, 2, 7);
    box(arm, 0, 0, 0, 1, 1, 2, 'woodLight');
    box(arm, 0, 0, 3, 1, 1, 4, 'leaf');
    box(arm, 0, 0, 5, 1, 1, 6, 'bone');
    arm.set(0, 0, 6, 'white'); arm.set(1, 1, 6, 'white');
    defineModel('enemy.husk.arm', { grid: arm, origin: [1, 1, 0.5] });
  }

  // ---- EMBER WISP: a floating flame with a bright core and two dark eyes. ---------------------
  {
    const g = new VoxelGrid(9, 12, 9);
    // a round head of fire; the streaming tail is its own model so it can lick and sway
    blob(g, 4.5, 4.4, 4.5, 4.1, 3.6, 4.1, (x, y, z, d) => (d < 0.5 ? 'gold' : d < 0.8 ? 'flame' : 'ember'), true);
    for (const ex of [3, 5]) { const z = front(g, ex, 4); if (z >= 0) { g.set(ex, 4, z, 'ink'); g.set(ex, 5, z, 'ink'); } }
    // two ember horns of flame licking up
    for (const [fx, fz, h] of [[4, 4, 4], [2, 4, 3], [6, 4, 3], [4, 2, 3], [4, 6, 3], [3, 3, 2], [5, 5, 2]]) {
      for (let k = 0; k < h; k++) g.set(fx, 7 + k, fz, k === h - 1 ? 'gold' : k === 0 ? 'flame' : 'flame', true);
    }
    defineModel('enemy.wisp.head', { grid: g, origin: [4.5, 0, 4.5] });

    const t = new VoxelGrid(7, 8, 7);
    blob(t, 3.5, 6.6, 3.5, 3.2, 1.9, 3.2, (x, y, z, d) => (d < 0.55 ? 'flame' : 'ember'), true);
    blob(t, 3.5, 3.6, 3.5, 2.0, 2.6, 2.0, (x, y, z, d) => (d < 0.5 ? 'flame' : hash(x, y, z) < 0.4 ? 'red' : 'ember'), true);
    blob(t, 3.5, 1.0, 3.5, 1.0, 1.2, 1.0, () => 'red', true);
    defineModel('enemy.wisp.tail', { grid: t, origin: [3.5, 8, 3.5] });

    const c = new VoxelGrid(3, 3, 3);
    box(c, 0, 0, 0, 2, 2, 2, (x, y, z) => ((x === 1 && y === 1 && z === 1) ? 'white' : 'torch'));
    for (const [x, y, z] of [[0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 0], [0, 0, 2], [2, 0, 2], [0, 2, 2], [2, 2, 2]]) c.clear(x, y, z);
    for (let z = 0; z < 3; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (c.get(x, y, z)) c.set(x, y, z, x === 1 && y === 1 && z === 1 ? 'white' : 'torch', true);
    defineModel('enemy.wisp.core', { grid: c, origin: [1.5, 1.5, 1.5] });

    // the slow orb: a hot ball, white heart
    const o = new VoxelGrid(5, 5, 5);
    blob(o, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, (x, y, z, d) => (d < 0.35 ? 'white' : d < 0.65 ? 'gold' : d < 0.85 ? 'flame' : 'ember'), true);
    for (const [x, y, z] of [[0, 0, 0], [4, 0, 0], [0, 4, 0], [4, 4, 0], [0, 0, 4], [4, 0, 4], [0, 4, 4], [4, 4, 4]]) o.clear(x, y, z);
    defineModel('enemy.orb', { grid: o, origin: [2.5, 2.5, 2.5] });
  }

  // ---- BRUTE: a slab of a thing. Pale stone hide, slate plates, bone horns, ember eyes. -------
  {
    const g = new VoxelGrid(16, 13, 10);
    blob(g, 8, 5.2, 5, 6.6, 5.4, 4.2, (x, y, z, d, dx, dy, dz) => {
      if (y <= 2) return dz > 0 ? 'red' : 'blood';                                   // loincloth
      if (dz > 0.35 && dy > -0.2 && hash(x >> 1, y >> 1, z) < 0.6) return 'slate';    // chest plate
      return dy < -0.4 || hash(x, y, z) < 0.15 ? 'fog' : 'frost';
    });
    for (let x = 2; x <= 13; x++) { const z = front(g, x, 3); if (z >= 0) g.set(x, 3, z, x % 3 === 0 ? 'bone' : 'stone'); }
    for (const sx of [2.2, 13.8]) {
      blob(g, sx, 9.4, 5, 2.6, 2.2, 2.8, (x, y, z, d, dx, dy) => (dy > 0.3 ? 'fog' : 'mist'));
      g.set(Math.floor(sx), 12, 5, 'bone'); g.set(Math.floor(sx), 11, 5, 'bone');
    }
    blob(g, 8, 9.4, 5.6, 2.7, 2.3, 2.5, (x, y, z, d, dx, dy) => (y >= 10 && d > 0.55 ? 'mist' : dy < -0.3 ? 'fog' : 'frost'));
    for (const ex of [6, 9]) { const z = front(g, ex, 9); if (z >= 0) g.set(ex, 9, z, 'ember', true); }
    for (const tx of [6, 9]) { const z = front(g, tx, 7); if (z >= 0) { g.set(tx, 7, z, 'bone'); g.set(tx, 8, z, 'bone'); } }
    for (const [hx, hy] of [[4, 11], [3, 12], [11, 11], [12, 12]]) g.set(hx, hy, 5, 'bone');
    defineModel('enemy.brute.body', { grid: g, origin: [8, 0, 5] });

    const leg = new VoxelGrid(4, 5, 4);
    box(leg, 0, 2, 0, 3, 4, 3, 'fog');
    box(leg, 0, 0, 0, 3, 1, 3, (x, y, z) => (y === 0 ? 'stone' : 'slate'));
    box(leg, 0, 0, 3, 3, 0, 3, 'stone');
    defineModel('enemy.brute.leg', { grid: leg, origin: [2, 5, 2] });

    const arm = new VoxelGrid(4, 9, 4);
    box(arm, 0, 4, 0, 3, 8, 3, (x, y, z) => (y > 6 ? 'frost' : 'fog'));
    box(arm, 0, 2, 0, 3, 3, 3, (x, y, z) => (y === 3 ? 'stone' : 'slate'));
    box(arm, 0, 0, 0, 3, 1, 3, (x, y, z) => ((x + z) % 2 === 0 ? 'frost' : 'fog'));
    defineModel('enemy.brute.arm', { grid: arm, origin: [2, 8.5, 2] });
  }

  // ---- MITE: a bug the size of a fist. Pink shell, plum stripe, white eyes, bone legs. ---------
  {
    const g = new VoxelGrid(6, 4, 7);
    blob(g, 3, 2.0, 3.6, 2.6, 1.9, 3.0, (x, y, z, d) => (x === 2 || x === 3 ? (y >= 2 ? 'red' : 'rose') : y >= 2 ? 'rose' : 'red'));
    for (const ex of [1, 4]) { const z = front(g, ex, 2); if (z >= 0) g.set(ex, 2, z, 'white', true); }
    for (const [x, z] of [[2, front(g, 2, 1)], [3, front(g, 3, 1)]]) if (z >= 0) g.set(x, 1, z, 'ink');   // mandibles
    defineModel('enemy.mite.body', { grid: g, origin: [3, 0, 3.5] });
    // two leg sets: shown alternately so the scurry reads at speed
    for (const [name, off] of [['a', 0], ['b', 1]]) {
      const l = new VoxelGrid(8, 2, 7);
      for (let i = 0; i < 3; i++) {
        const z = 1 + i * 2 + (i === 1 ? off : 1 - off) * (i === 1 ? 0 : 1);
        l.set(0, 0, z, 'bone'); l.set(1, 1, z, 'bone'); l.set(7, 0, z, 'bone'); l.set(6, 1, z, 'bone');
        l.set(0, 1, Math.min(6, z + off), 'ink'); l.set(7, 1, Math.min(6, z + off), 'ink');
      }
      defineModel(`enemy.mite.legs.${name}`, { grid: l, origin: [4, 0, 3.5] });
    }
  }

  // ---- shared bits -----------------------------------------------------------------------------
  {
    const s = new VoxelGrid(9, 1, 9);
    for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) { const d = Math.hypot(x - 4, z - 4); if (d < 4.4 && (d < 3 || (x + z) % 2 === 0)) s.set(x, 0, z, 'ink'); }
    defineModel('enemy.shadow', { grid: s, origin: [4.5, 0, 4.5] });
    const st = new VoxelGrid(3, 3, 1);
    st.set(1, 0, 0, 'gold', true); st.set(1, 2, 0, 'gold', true); st.set(0, 1, 0, 'torch', true); st.set(2, 1, 0, 'gold', true); st.set(1, 1, 0, 'white', true);
    defineModel('enemy.star', { grid: st, origin: [1.5, 1.5, 0.5] });
  }
}
export { VOXEL };
