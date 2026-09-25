// Engine test models, used by the foundation showcase and the placeholder scenes.
// They double as worked examples of both authoring forms (text layers and VoxelGrid code).
// Real game art lives with the pieces that own it (hero, enemies, arenas, ...).

import { defineModel, VoxelGrid } from './model.js';
import { Rng } from '../../core/rng.js';

// ---- text form: a stand-in hooded runner, 11 voxels tall --------------------------------
// key: b boots, d legs, t tunic, g belt, y buckle, c cloak/hood, s scarf, k hood shadow, e eyes (glow)
defineModel('test.runner', {
  key: { b: 'dirt', d: 'dusk', t: 'violet', g: 'wood', y: 'gold', c: 'blue', s: 'red', k: 'ink', e: 'sky!', n: 'navy' },
  layers: [
    `.......
     .bb.bb.
     .bb.bb.
     .bb.bb.`,
    `.......
     .dd.dd.
     .dd.dd.`,
    `.nnnnn.
     .ntttn.
     .ntttn.
     ..ttt..`,
    `.ccccc.
     .ctttc.
     .ctttc.
     ..gyg..`,
    `.ccccc.
     cctttcc
     cctttcc
     c.ttt.c`,
    `.ccccc.
     cctttcc
     cctttcc
     c.ttt.c`,
    `.sssss.
     .sssss.
     .sssss.
     ..sss..`,
    `.ccccc.
     .ccccc.
     .ccccc.
     .cekec.`,
    `..ccc..
     .ccccc.
     .ccccc.
     .ckkkc.`,
    `.......
     ..ccc..
     .ccccc.
     .ccccc.`,
    `.......
     ..cc...
     ...c...`,
  ],
});

// ---- code form: a small ruined crypt shrine with a lit brazier -------------------------
{
  const g = new VoxelGrid(22, 17, 22);
  const r = new Rng('test.shrine');
  // stepped base
  g.box(0, 0, 0, 21, 0, 21, 'stoneDark');
  g.box(1, 1, 1, 20, 1, 20, 'stone');
  g.box(3, 2, 3, 18, 2, 18, 'stone');
  // worn step edges and cracks
  for (let i = 0; i < 70; i++) {
    const x = r.int(0, 21), z = r.int(0, 21);
    const y = g.get(x, 2, z) ? 2 : g.get(x, 1, z) ? 1 : 0;
    g.set(x, y, z, r.pick(['stoneLight', 'stoneDark', 'stoneLight']));
  }
  for (let i = 0; i < 26; i++) {
    const x = r.int(0, 21), z = r.int(0, 21);
    const y = g.get(x, 1, z) ? 1 : 0;
    if (x < 2 || z < 2 || x > 19 || z > 19 || y === 1) g.set(x, y, z, r.pick(['moss', 'leaf', 'moss']));
  }
  // four pillars; the front two are broken off
  const pillar = (x, z, top) => {
    g.box(x - 1, 3, z - 1, x + 2, 3, z + 2, 'stoneDark');
    g.box(x, 4, z, x + 1, top, z + 1, 'stoneLight');
    for (let y = 5; y <= top; y += 3) g.set(x + (y % 2), y, z + 1, 'stone');
  };
  pillar(4, 4, 13); pillar(16, 4, 13);
  pillar(4, 16, 7); pillar(16, 16, 5);
  g.set(5, 8, 17, 'stoneLight'); g.set(17, 6, 16, 'stoneLight');
  // lintel across the back pillars, with a hanging chain
  g.box(3, 14, 3, 18, 15, 6, 'stone');
  g.box(3, 16, 4, 18, 16, 5, 'stoneLight');
  for (let x = 3; x <= 18; x += 2) g.set(x, 14, 6, 'stoneDark');
  for (let y = 10; y <= 13; y++) g.set(10, y, 5, 'slate');
  // brazier: pedestal, bowl, embers and flame
  g.box(9, 3, 9, 12, 4, 12, 'stoneDark');
  g.box(10, 5, 10, 11, 5, 11, 'stone');
  g.box(8, 6, 8, 13, 6, 13, 'shadow');
  g.box(8, 7, 8, 13, 7, 13, 'shadow');
  g.box(9, 7, 9, 12, 7, 12, null);
  for (const [x, z] of [[8, 8], [13, 8], [8, 13], [13, 13]]) g.set(x, 8, z, 'gold');
  g.box(9, 7, 9, 12, 7, 12, 'ember', true);
  g.box(9, 8, 10, 12, 8, 11, 'flame', true);
  g.box(10, 8, 9, 11, 8, 12, 'flame', true);
  g.box(10, 9, 10, 11, 9, 11, 'gold', true);
  g.set(10, 10, 11, 'torch', true);
  g.set(11, 9, 12, 'flame', true);
  g.set(9, 8, 9, 'blood');
  // a skull on the front step, bones scattered
  g.box(6, 3, 18, 8, 4, 19, 'bone');
  g.set(6, 4, 19, 'ink'); g.set(8, 4, 19, 'ink');
  g.box(6, 3, 20, 8, 3, 20, 'frost');
  g.set(7, 3, 20, 'ink');
  g.box(13, 2, 20, 16, 2, 20, 'bone');
  g.set(12, 1, 21, 'bone');
  defineModel('test.shrine', { grid: g });
}

// ---- code form: AO test block (notches, overhangs, inner corners) ---------------------
{
  const g = new VoxelGrid(12, 12, 12);
  g.box(0, 0, 0, 11, 11, 11, 'stoneLight');
  g.box(3, 3, 0, 8, 8, 11, null);      // tunnel front to back
  g.box(0, 3, 3, 11, 8, 8, null);      // tunnel left to right
  g.box(0, 9, 0, 5, 11, 5, null);      // corner notch top-left-back
  g.box(6, 9, 6, 11, 11, 11, null);    // corner notch top-right-front
  g.box(8, 9, 0, 9, 11, 11, 'slate');  // ridge
  g.set(2, 12 - 1, 8, 'gold');
  for (let i = 0; i < 12; i += 2) g.set(i, 0, 11, 'stone');
  defineModel('test.ao', { grid: g });
}

// ---- turntable plinth (static) and plate (rotates) -------------------------------------
{
  const R = 15;
  const g = new VoxelGrid(R * 2 + 1, 3, R * 2 + 1);
  for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
    const d = Math.hypot(x, z);
    if (d > R + 0.3) continue;
    g.set(x + R, 0, z + R, 'shadow');
    if (d <= R - 1.2) g.set(x + R, 1, z + R, 'dusk');
    if (d > R - 2.2 && d <= R - 1.2) {
      const stud = Math.abs(((Math.atan2(z, x) / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.44;
      g.set(x + R, 2, z + R, stud ? 'gold' : 'slate');
    }
  }
  defineModel('test.plinth', { grid: g });
  const P = R - 3;
  const p = new VoxelGrid(P * 2 + 1, 1, P * 2 + 1);
  for (let z = -P; z <= P; z++) for (let x = -P; x <= P; x++) {
    const d = Math.hypot(x, z);
    if (d > P + 0.3) continue;
    const ring = d > P - 1.5;
    const tick = ring && (Math.round(Math.atan2(z, x) / (Math.PI / 8)) % 2 === 0);
    p.set(x + P, 0, z + P, ring ? (tick ? 'slate' : 'violet') : 'violet');
  }
  p.set(P, 0, 0, 'gold'); // front marker so rotation reads
  defineModel('test.plate', { grid: p });
}

// ---- floor patch: flagstones with grout, 11 x 11 units ---------------------------------
{
  const N = 88, T = 8;
  const g = new VoxelGrid(N, 3, N);
  const r = new Rng('test.floor');
  g.box(0, 0, 0, N - 1, 1, N - 1, 'stoneDark');
  for (let tz = 0; tz < N / T; tz++) for (let tx = 0; tx < N / T; tx++) {
    const shade = r.weighted([['stone', 6], ['stoneDark', 1], ['dusk', 2]]);
    const sunk = r.chance(0.15);
    for (let z = 1; z < T; z++) for (let x = 1; x < T; x++) {
      const X = tx * T + x, Z = tz * T + z;
      g.set(X, sunk ? 1 : 2, Z, shade);
      if (sunk) g.set(X, 2, Z, null);
    }
    // a few chips and light flecks per stone
    for (let i = 0; i < 3; i++) {
      const X = tx * T + r.int(1, T - 1), Z = tz * T + r.int(1, T - 1);
      if (!sunk) g.set(X, 2, Z, r.pick(['stoneLight', 'stoneDark', null]));
    }
  }
  // round the patch off so it reads as a lit island in the dark
  const c = N / 2;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x + 0.5 - c, z + 0.5 - c);
    if (d > c - 1) for (let y = 0; y < 3; y++) g.clear(x, y, z);
    else if (d > c - 6 - r.next() * 5) g.clear(x, 2, z);
  }
  defineModel('test.floor', { grid: g });
}

// ---- standing torch --------------------------------------------------------------------
defineModel('test.torch', {
  key: { s: 'stoneDark', w: 'wood', i: 'shadow', g: 'gold' },
  layers: [
    `sss
     sss
     sss`,
    `.s.
     sws
     .s.`,
    `...
     .w.`,
    `...
     .w.`,
    `...
     .w.`,
    `...
     .w.`,
    `...
     .w.`,
    `iii
     igi
     iii`,
    `i.i
     ...
     i.i`,
  ],
});
