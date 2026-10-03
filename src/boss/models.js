// Boss voxel models (piece `boss`): The Warden's rig parts and the Warden's Pit.
// Authored in code, meshed once on first use. Front is +z, y up. One voxel = 1/8 unit.
//
// THE WARDEN (~38 voxels to the top of its cage-helm, 3.5x the hero):
//   a jailer-knight in pale blued iron (mist and fog plates over slate), a blood-red tabard and
//   cape with gold trim, a ring of brass keys at the belt, a chain wound across the chest, and
//   a great helm crowned with a little birdcage (a skull inside). Its right fist holds the chain
//   of a spiked iron ball. The eyes behind the visor change with the phase:
//     phase 1 sky (cold), phase 2 gold, phase 3 ember (and the armour cracks open, glowing).
//   Parts: legL/R, torso.p1/p2/p3, pauldronL/R, head.p1/p2/p3, armL/R, cape, keys, ball, link.
//
// THE PIT: a round stone drum hanging over darkness, the back wall of cells (eyes glint in
// them), a bridge in from the south with a gate of bars, iron cage-braziers round the rim, a
// rune ring that wakes up segment by segment, and the cage: eight arcs of bars that burst up
// out of the floor in phase 3.

import { defineModel, VoxelGrid } from '../render/voxel/index.js';

const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const TAU = Math.PI * 2;

function part(name, size, origin, build) {
  const g = new VoxelGrid(...size);
  build(g);
  defineModel(name, { grid: g, origin });
  return g;
}

// ---- dimensions shared with the rig (warden.js) ------------------------------------------
export const RIG = {
  hipY: 12,          // leg pivots (top of the thighs), voxels above the floor
  hipX: 3.6,         // leg pivot x
  beltY: 14,         // torso pivot (the belt), voxels above the floor
  shoulderX: 10.5,   // arm pivots, torso-local
  shoulderY: 9.5,
  neckY: 11.5,       // head pivot, torso-local
  handY: -15,        // the fist's grip, arm-local (the arm hangs 16 voxels)
};

// ---- WARDEN --------------------------------------------------------------------------------
for (const side of ['L', 'R']) {
  // thigh: pivot at the hip. Mail, with the knee cop at the bottom.
  part(`boss.thigh.${side}`, [7, 7, 9], [3.5, 7, 3.5], (g) => {
    for (let y = 1; y <= 6; y++) for (let z = 1; z <= 6; z++) for (let x = 1; x <= 5; x++) g.set(x, y, z, (x + y + z) % 2 ? 'stone' : 'dusk');   // mail
    g.box(1, 0, 2, 5, 1, 7, 'mist'); g.box(2, 0, 7, 4, 1, 7, 'fog'); g.set(3, 1, 8, 'frost');   // knee cop
    g.box(1, 6, 1, 5, 6, 6, 'slate');                         // the cuisse's top edge
  });
  // shin: pivot at the knee. Greave and sabaton, toe forward.
  part(`boss.shin.${side}`, [7, 6, 9], [3.5, 6, 3.5], (g) => {
    g.box(0, 0, 0, 6, 1, 8, 'slate');
    g.box(1, 1, 6, 5, 1, 8, 'mist');                          // toe cap catches light
    g.box(2, 0, 8, 4, 0, 8, 'fog');
    for (let y = 2; y <= 5; y++) {                            // greave
      g.box(1, y, 1, 5, y, 6, 'slate');
      g.box(2, y, 6, 4, y, 6, y === 5 ? 'fog' : 'mist');
    }
    g.set(side === 'L' ? 1 : 5, 3, 6, 'frost');               // rivet
  });
}

// torso: pivot at the belt (grid y = 5). Skirt of tassets below it, breastplate, gorget.
// p2: the right pauldron is gone (it flies off at the phase change) and the plate is dented.
// p3: the breastplate splits; ember light shows through the cracks.
const CRACKS = [[9, 12], [9, 11], [10, 10], [10, 9], [9, 8], [8, 7], [11, 8], [12, 7], [10, 13], [11, 13], [7, 10], [6, 10], [12, 11], [13, 11]];
for (const ph of [1, 2, 3]) {
  part(`boss.torso.p${ph}`, [21, 18, 13], [10.5, 5, 6.5], (g) => {
    const cx = 10, cz = 6;
    // skirt: tassets, widening downward, banded plates
    for (let y = 0; y <= 4; y++) {
      const rx = 7.8 - y * 0.25, rz = 5.2 - y * 0.15;
      for (let z = 0; z < 13; z++) for (let x = 0; x < 21; x++) {
        const dx = (x - cx) / rx, dz = (z - cz) / rz;
        if (dx * dx + dz * dz > 1) continue;
        g.set(x, y, z, y === 0 ? 'stoneDark' : y % 2 ? 'slate' : 'mist');
      }
    }
    // tabard: blood cloth down the front and back of the skirt, hanging past it
    for (let y = 0; y <= 6; y++) for (let x = 8; x <= 12; x++) {
      const c = (x === 8 || x === 12) ? 'plum' : 'blood';
      g.set(x, y, 11 + (y < 3 ? 1 : 0), c);
      g.set(x, y, 1, c);
    }
    g.box(8, 0, 12, 12, 0, 12, 'bone');                       // pale hem
    g.set(9, 0, 12, 'blood'); g.set(11, 0, 12, 'blood');      // ragged
    g.set(10, 3, 12, 'bone'); g.set(10, 2, 12, 'bone'); g.set(9, 3, 12, 'bone'); g.set(11, 3, 12, 'bone');   // a key sigil
    // belt
    for (let z = 0; z < 13; z++) for (let x = 0; x < 21; x++) {
      const dx = (x - cx) / 7.2, dz = (z - cz) / 5;
      if (dx * dx + dz * dz <= 1) g.set(x, 5, z, 'dirt');
    }
    g.box(9, 5, 11, 11, 5, 11, 'fog'); g.set(10, 5, 11, 'frost');
    // breastplate: a barrel that swells to the chest and narrows to the neck
    for (let y = 6; y <= 14; y++) {
      const rx = y <= 8 ? 6.6 + (y - 6) * 0.5 : y <= 12 ? 8.1 : 8.1 - (y - 12) * 1.0;
      const rz = y <= 8 ? 4.6 : y <= 12 ? 5.3 : 5.0 - (y - 12) * 0.5;
      for (let z = 0; z < 13; z++) for (let x = 0; x < 21; x++) {
        const dx = (x - cx) / rx, dz = (z - cz - (y >= 9 ? 0.4 : 0)) / rz;
        const d = dx * dx + dz * dz;
        if (d > 1) continue;
        let c = 'slate';
        const front = z - cz > rz * 0.45;
        if (front) c = 'mist';
        if (front && y >= 11) c = 'fog';                          // the chest catches the light
        if (front && (x === 10)) c = y >= 10 ? 'frost' : 'fog';   // centre ridge
        if (z - cz < -rz * 0.5) c = 'stoneDark';                   // back in shadow
        if (Math.abs(x - cx) > rx * 0.85) c = 'slate';
        g.set(x, y, z, c);
      }
    }
    // rivets down the plate's edges
    for (const [x, y] of [[5, 8], [15, 8], [5, 11], [15, 11], [7, 13], [13, 13]]) {
      for (let z = 12; z >= 0; z--) if (g.get(x, y, z)) { g.set(x, y, z, 'frost'); break; }
    }
    // a chain across the chest: right shoulder down to the left hip
    for (let k = 0; k < 10; k++) {
      const x = 15 - k, y = 13 - Math.round(k * 0.75);
      for (let z = 12; z >= 0; z--) if (g.get(x, y, z)) { g.set(x, y, z, k % 2 ? 'fog' : 'slate'); break; }
    }
    // gorget
    for (let y = 15; y <= 16; y++) for (let z = 0; z < 13; z++) for (let x = 0; x < 21; x++) {
      const dx = (x - cx) / 4.2, dz = (z - cz) / 3.4;
      if (dx * dx + dz * dz <= 1) g.set(x, y, z, y === 16 ? 'mist' : 'slate');
    }
    // a blood-red mantle draped over the shoulders and down the back, the top of it reads
    // from the high camera: steel and red, not a grey block
    for (let y = 12; y <= 15; y++) for (let z = 0; z < 13; z++) for (let x = 0; x < 21; x++) {
      const dx = (x - cx) / (y >= 14 ? 6.2 : 7.4), dz = (z - cz + 0.6) / (y >= 14 ? 4.6 : 5.4);
      const d = dx * dx + dz * dz;
      if (d > 1 || d < (y >= 14 ? 0.3 : 0.62)) continue;
      if (z - cz > 2.6 && Math.abs(x - cx) < 5 && y < 15) continue;     // open at the chest
      g.set(x, y, z, (x + Math.floor(z / 2)) % 4 === 0 ? 'plum' : 'blood');
    }
    for (let y = 6; y <= 13; y++) for (let x = 5; x <= 15; x++) { if (hash(x, y, 7) < (13 - y) * 0.05) continue; g.set(x, y, 0, (x % 3 === 0) ? 'plum' : 'blood'); }
    for (let x = 6; x <= 14; x++) g.set(x, 16, 3, 'bone');           // a pale fur collar at the back
    if (ph >= 2) {
      // a dent and scrapes where the pauldron tore away
      for (const [x, y] of [[14, 12], [15, 11], [13, 11], [16, 13]]) for (let z = 12; z >= 0; z--) if (g.get(x, y, z)) { g.set(x, y, z, 'slate'); break; }
      g.box(17, 12, 4, 18, 14, 8, 'stone');                    // bare mail at the shoulder
      g.set(17, 13, 6, 'dusk'); g.set(18, 12, 5, 'dusk');
    }
    if (ph === 3) {
      // the plate cracks open over a glowing core
      for (const [x, y] of CRACKS) for (let z = 12; z >= 0; z--) if (g.get(x, y, z)) { g.set(x, y, z, (x + y) % 3 ? 'ember' : 'flame', true); break; }
      g.set(10, 10, 12, 'gold', true); g.set(10, 11, 12, 'torch', true);
    }
  });
}

// pauldrons: layered domes with a spike, pivot at the shoulder joint
for (const side of ['L', 'R']) {
  part(`boss.pauldron.${side}`, [9, 7, 11], [4.5, 2, 5.5], (g) => {
    for (let y = 0; y <= 5; y++) {
      const r = [4.4, 4.4, 3.9, 3.9, 3.0, 2.0][y];
      for (let z = 0; z < 11; z++) for (let x = 0; x < 9; x++) {
        const dx = (x - 4) / r, dz = (z - 5) / (r * 1.15);
        if (dx * dx + dz * dz > 1) continue;
        g.set(x, y, z, y === 0 || y === 2 ? 'slate' : y >= 4 ? 'fog' : 'mist');
      }
    }
    g.set(4, 6, 5, 'frost'); g.set(4, 5, 5, 'fog');            // spike
    g.box(0, 0, 9, 8, 0, 9, 'frost');                         // a bright rim at the front
    g.set(side === 'L' ? 1 : 7, 1, 8, 'frost');
  });
}

// head: a great helm crowned with a birdcage. Visor slit with two eyes; a breath grille.
const EYES = { 0: 'night', 1: 'sky', 2: 'gold', 3: 'ember' };   // p0: the eyes unlit (dormant)
for (const ph of [0, 1, 2, 3]) {
  part(`boss.head.p${ph}`, [11, 14, 11], [5.5, 0, 5.5], (g) => {
    const c = 5;
    for (let y = 0; y <= 8; y++) {
      const r = y <= 6 ? 4.4 : y === 7 ? 3.8 : 2.8;
      for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) {
        const dx = x - c, dz = z - c;
        if (dx * dx + dz * dz > r * r) continue;
        let col = 'slate';
        if (dz > 2.2) col = 'mist';
        if (dz > 2.2 && y >= 6) col = 'fog';
        if (dz < -2) col = 'stoneDark';
        if (y >= 7) col = 'fog';
        if (y === 0) col = 'slate';
        g.set(x, y, z, col);
      }
    }
    // visor slit across the front, the eyes in it
    const eye = EYES[ph], lit = ph > 0;
    for (let x = 2; x <= 8; x++) for (let z = 7; z <= 10; z++) if (g.get(x, 4, z)) g.set(x, 4, z, 'ink');
    g.set(3, 4, 9, eye, lit); g.set(7, 4, 9, eye, lit);
    g.set(3, 4, 10, eye, lit); g.set(7, 4, 10, eye, lit);
    // a vertical nose bar and a grille of breath holes
    for (let y = 1; y <= 5; y++) g.set(5, y, 10, y === 4 ? 'fog' : 'frost');
    for (const [x, y] of [[3, 2], [7, 2], [4, 1], [6, 1], [3, 1], [7, 1]]) g.set(x, y, 9 + (Math.abs(x - 5) < 2 ? 1 : 0), 'ink');
    // the brass band round the brow
    for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) if (g.get(x, 6, z) && (x - c) ** 2 + (z - c) ** 2 > 3.5 * 3.5) g.set(x, 6, z, (x + z) % 4 ? 'bone' : 'frost');
    // birdcage crown: 8 bars and a ring, a skull inside
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * TAU, x = Math.round(c + Math.sin(a) * 2.6), z = Math.round(c + Math.cos(a) * 2.6);
      for (let y = 9; y <= 12; y++) g.set(x, y, z, k % 2 ? 'slate' : 'mist');
    }
    for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; g.set(Math.round(c + Math.sin(a) * 2.4), 12, Math.round(c + Math.cos(a) * 2.4), 'mist'); }
    g.set(c, 13, c, 'fog'); g.set(c, 12, c, 'slate');
    g.set(c, 11, c, 'slate'); g.set(c, 10, c, 'mist'); g.set(c, 9, c, 'frost');   // a ring hangs inside the cage
    if (ph >= 2) { g.set(8, 7, 7, 'slate'); g.set(7, 8, 7, 'slate'); g.set(8, 6, 8, 'stone'); }   // a dent
    if (ph === 3) {
      // the face plate cracks: ember light through it
      for (const [x, y] of [[6, 5], [6, 6], [7, 7], [4, 3], [4, 2], [6, 2]]) for (let z = 10; z >= 6; z--) if (g.get(x, y, z)) { g.set(x, y, z, y > 4 ? 'flame' : 'ember', true); break; }
      g.set(c, 9, c, 'ember', true);             // the cage's ring glows
    }
  });
}

// arms: pivot at the shoulder. Mail, couter, vambrace, a huge gauntlet.
for (const side of ['L', 'R']) {
  part(`boss.arm.${side}`, [8, 17, 9], [4, 16, 4], (g) => {
    for (let y = 12; y <= 16; y++) for (let z = 2; z <= 6; z++) for (let x = 2; x <= 6; x++) g.set(x, y, z, (x + y + z) % 2 ? 'stone' : 'dusk');   // mail
    g.box(1, 9, 1, 7, 11, 7, 'slate');                                                      // couter
    g.box(2, 10, 7, 6, 11, 7, 'mist'); g.set(4, 10, 8, 'frost'); g.set(4, 11, 8, 'fog');
    for (let y = 5; y <= 8; y++) { g.box(2, y, 2, 6, y, 6, 'slate'); g.box(3, y, 6, 5, y, 6, 'mist'); }   // vambrace
    g.box(2, 8, 2, 6, 8, 6, 'blood');                                                        // a red cloth cuff
    g.box(0, 0, 0, 7, 4, 8, 'slate');                                                        // gauntlet
    g.box(0, 4, 0, 7, 4, 8, 'mist');
    g.box(1, 4, 7, 6, 4, 8, 'fog');
    for (const x of [1, 3, 4, 6]) { g.set(x, 2, 8, 'fog'); g.set(x, 3, 8, 'mist'); }          // knuckles
    g.box(0, 0, 0, 7, 0, 8, 'stoneDark');
    if (side === 'R') { g.box(3, 0, 3, 4, 1, 5, 'ink'); g.set(3, 0, 4, 'fog'); g.set(4, 0, 4, 'mist'); }   // the chain's grip
  });
}

// cape: hangs from the back of the shoulders, ragged hem, gold trim
part('boss.cape', [17, 21, 2], [8.5, 20, 1], (g) => {
  for (let y = 0; y <= 20; y++) {
    const w = 6 + Math.round((20 - y) * 0.12);
    for (let x = 8 - w; x <= 8 + w; x++) {
      if (y < 4 && hash(x, 7) < (4 - y) * 0.28) continue;    // ragged hem
      g.set(x, y, 0, x === 8 - w || x === 8 + w ? 'plum' : (x + Math.floor(y / 3)) % 5 === 0 ? 'plum' : 'blood');
      if (y > 16) g.set(x, y, 1, 'blood');
    }
  }
  for (let x = 2; x <= 14; x++) g.set(x, 20, 1, 'bone');
  g.set(8, 12, 0, 'bone'); g.set(7, 11, 0, 'bone'); g.set(9, 11, 0, 'bone'); g.set(8, 10, 0, 'bone');   // a key sigil
});

// keys: a brass ring of keys at the belt
part('boss.keys', [6, 8, 2], [3, 8, 1], (g) => {
  for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; g.set(Math.round(2.5 + Math.sin(a) * 2), Math.round(5.5 + Math.cos(a) * 2), 0, 'gold', true); }
  for (const [x, len, c] of [[1, 4, 'gold'], [3, 5, 'flame'], [4, 3, 'gold']]) {
    for (let y = 4 - len; y <= 3; y++) g.set(x, Math.max(0, y), 1, c, true);
    g.set(x + (x === 4 ? -1 : 1), Math.max(0, 4 - len), 1, c, true);
  }
});

// the flail: a spiked iron ball with a shackle on top
part('boss.ball', [13, 13, 13], [6.5, 6.5, 6.5], (g) => {
  const c = 6;
  for (let z = 0; z < 13; z++) for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
    const d = Math.hypot(x - c, y - c, z - c);
    if (d > 3.9) continue;
    g.set(x, y, z, y >= c + 2 ? 'slate' : y <= c - 2 ? 'stoneDark' : (x + z) % 3 ? 'stoneDark' : 'stone');
  }
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [1, 1, 1], [-1, 1, 1], [1, 1, -1], [-1, 1, -1], [1, -1, 1], [-1, -1, 1], [1, -1, -1], [-1, -1, -1]];
  for (const [dx, dy, dz] of dirs) {
    const l = Math.hypot(dx, dy, dz);
    for (let s = 4; s <= 6; s++) g.set(Math.round(c + dx / l * s), Math.round(c + dy / l * s), Math.round(c + dz / l * s), s === 6 ? 'frost' : 'mist');
  }
  g.box(5, 10, 6, 7, 10, 6, 'slate'); g.set(5, 11, 6, 'mist'); g.set(7, 11, 6, 'mist'); g.set(6, 12, 6, 'fog');   // shackle
});

// one chain link: an oval ring lying in x/z, long along z
part('boss.link', [3, 1, 5], [1.5, 0.5, 2.5], (g) => {
  g.box(0, 0, 0, 2, 0, 4, 'mist');
  g.box(1, 0, 1, 1, 0, 3, null);
  g.set(0, 0, 2, 'fog'); g.set(2, 0, 0, 'slate'); g.set(0, 0, 4, 'slate');
});

// ---- THE PIT --------------------------------------------------------------------------------
export const PIT = {
  RF: 6.4,        // floor drum radius (units)
  RP: 5.65,       // playable radius (the collision ring)
  RUNE: 3.15,     // rune ring radius
  CAGE: 4.3,      // the cage's bars (phase 3)
  braziers: 6,    // on the rim
  wallZ: -7.4,    // the back wall's front face
  bridgeW: 2.0,   // the bridge in from the south
};

// floor: a drum of concentric flagstone rings, top at y = 0, sides dropping into the dark
function buildFloor() {
  const R = PIT.RF * 8, N = Math.ceil(R) * 2 + 4, c = N / 2, H = 14;
  const g = new VoxelGrid(N, H, N);
  const top = H - 1;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const dx = x + 0.5 - c, dz = z + 0.5 - c, r = Math.hypot(dx, dz);
    // ragged rim: a few chips bitten out of the edge
    const a = Math.atan2(dx, dz);
    const bite = hash(Math.floor((a + Math.PI) * 9), 3) < 0.18 ? 1.5 : 0;
    if (r > R - bite) continue;
    const ru = r / 8;                                    // radius in units
    // concentric courses, staggered stones
    const ring = Math.floor(ru / 0.92);
    const per = Math.max(6, Math.round(ring * 6.2));
    const aa = (a + Math.PI) / TAU * per + (ring % 2) * 0.5;
    const stone = Math.floor(aa);
    const fr = aa - stone, rr = ru / 0.92 - ring;
    const groutR = rr < 0.11, groutA = fr * (r * TAU / 8 / per) * 8 < 0.75;   // ~1 voxel grout lines
    const h = hash(stone, ring, 11);
    let col = h < 0.33 ? 'stone' : h < 0.66 ? 'stoneDark' : h < 0.86 ? 'dusk' : 'violet';
    if (ring === 0) col = 'stoneDark';
    if (groutR || groutA) col = 'shadow';
    // the rune track: a band of dark iron
    if (Math.abs(ru - PIT.RUNE) < 0.36) col = Math.abs(ru - PIT.RUNE) > 0.26 ? 'stoneLight' : 'night';
    // the rim course: lighter worn stones with a dark lip
    if (ru > PIT.RF - 0.55) col = ru > PIT.RF - 0.18 ? 'stone' : (groutA ? 'stoneDark' : 'stoneLight');
    // the drain at the centre: an iron grate
    if (ru < 0.75) col = ((x + z) % 2 === 0 && ru < 0.62) ? 'ink' : 'slate';
    // wear: moss in the cracks near the rim, stains, cracks
    const n = hash(x, z, 5);
    if (col === 'shadow' && ru > 4.6 && n < 0.3) col = 'moss';
    if (!groutR && !groutA && n < 0.012 && ru > 1) col = 'bone';
    g.set(x, top, z, col);
    g.set(x, top - 1, z, 'stoneDark');
    // the drum's side wall: brick courses dropping into the dark
    if (r > R - 2.2 - bite) for (let y = 0; y < top - 1; y++) {
      const course = Math.floor((top - y) / 3), joint = (Math.floor((a + Math.PI) * 24) + course) % 4 === 0 || (top - y) % 3 === 0;
      g.set(x, y, z, joint ? 'shadow' : hash(Math.floor((a + Math.PI) * 24), course, 2) < 0.5 ? 'stone' : 'dusk');
    }
  }
  // cracks radiating from the centre (old impacts)
  for (const [a0, len] of [[0.7, 26], [2.4, 20], [3.9, 30], [5.3, 18]]) {
    let x = c + Math.sin(a0) * 9, z = c + Math.cos(a0) * 9, a = a0;
    for (let k = 0; k < len; k++) {
      a += (hash(k, a0 * 100) - 0.5) * 0.7;
      x += Math.sin(a); z += Math.cos(a);
      if (Math.hypot(x - c, z - c) / 8 > PIT.RUNE - 0.4 && Math.hypot(x - c, z - c) / 8 < PIT.RUNE + 0.4) continue;
      g.set(Math.floor(x), top, Math.floor(z), 'night');
    }
  }
  // old blood under where the Warden kneels, and a few splats
  for (const [bx, bz, br] of [[0, -3.1, 0.9], [2.6, 1.8, 0.45], [-3.4, 2.2, 0.35]]) {
    for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) {
      const d = Math.hypot(x, z) / (br * 8);
      if (d > 1 || hash(x, z, 9) < d * 0.8) continue;
      g.set(Math.floor(c + bx * 8 + x), top, Math.floor(c + bz * 8 + z), d < 0.4 ? 'blood' : hash(x, z, 4) < 0.5 ? 'blood' : 'plum');
    }
  }
  defineModel('boss.floor', { grid: g, origin: [c, H, c] });
}

// the rune ring: 12 segments, each with a dark and a lit model (emissive), swapped to wake up
function buildRunes() {
  const glyphs = [
    ['#.#', '.#.', '#.#'], ['###', '#..', '###'], ['.#.', '###', '.#.'], ['#..', '###', '..#'],
    ['##.', '.#.', '.##'], ['#.#', '###', '#.#'],
  ];
  for (let k = 0; k < 12; k++) {
    const a = (k + 0.5) / 12 * TAU;
    for (const mode of ['dark', 'lit', 'hot']) {
      const lit = mode !== 'dark', hot = mode === 'hot';
      const g = new VoxelGrid(24, 1, 24);
      const c = 12;
      // the arc band of this segment
      for (let z = 0; z < 24; z++) for (let x = 0; x < 24; x++) {
        // segment-local: world offset of this cell from the segment's centre point
        const wx = (x - c + 0.5) / 8 + Math.sin(a) * PIT.RUNE, wz = (z - c + 0.5) / 8 + Math.cos(a) * PIT.RUNE;
        const r = Math.hypot(wx, wz), aa = Math.atan2(wx, wz);
        let da = aa - a; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        if (Math.abs(da) > TAU / 24 - 0.012) continue;
        const dr = r - PIT.RUNE;
        if (Math.abs(dr) < 0.06) g.set(x, 0, z, hot ? 'blood' : lit ? 'teal' : 'slate', lit);         // the inlaid line
      }
      // a glyph at the segment's middle
      const G = glyphs[k % glyphs.length];
      for (let gz = 0; gz < 3; gz++) for (let gx = 0; gx < 3; gx++) if (G[gz][gx] === '#') {
        g.set(c - 1 + (gx - 1), 0, c - 1 + (gz - 1), hot ? ((gx + gz) % 2 ? 'flame' : 'red') : lit ? ((gx + gz) % 2 ? 'cyan' : 'sky') : 'stoneLight', lit);
      }
      defineModel(`boss.rune.${k}.${mode}`, { grid: g, origin: [c, 0, c] });
    }
  }
}

// the back wall: cells with bars (eyes glint in two of them), chains, banners, the Warden's niche
function buildWall() {
  const W = 184, H = 54, D = 8, base = 22;   // base: voxels below the floor line (into the pit)
  const g = new VoxelGrid(W, H, D);
  const cx = W / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    const course = Math.floor(y / 3), off = (course % 2) * 4;
    const joint = y % 3 === 2 || (x + off) % 8 === 7;
    let c = joint ? 'shadow' : hash(Math.floor((x + off) / 8), course, 1) < 0.45 ? 'stone' : hash(Math.floor((x + off) / 8), course, 2) < 0.6 ? 'dusk' : 'stoneDark';
    if (y < base) c = joint ? 'night' : 'shadow';                 // below the floor line: into the dark
    if (z < D - 1 && y >= base) c = 'stoneDark';
    g.set(x, y, z, c);
  }
  const front = D - 1;
  // cells: arched openings with bars, darkness behind
  const cells = [-66, -40, 40, 66];
  cells.forEach((ox, i) => {
    const x0 = cx + ox - 8, x1 = cx + ox + 8, y0 = base, y1 = base + 22;
    for (let y = y0; y <= y1 + 4; y++) for (let x = x0; x <= x1; x++) {
      const arch = y > y1 ? Math.hypot((x - (x0 + x1) / 2) / 8.5, (y - y1) / 4.5) < 1 : true;
      if (!arch) continue;
      for (let z = 2; z <= front; z++) g.set(x, y, z, z === 2 ? 'ink' : null);
      g.set(x, y, 1, 'ink');
    }
    for (let x = x0; x <= x1; x += 3) for (let y = y0; y <= y1 + 3; y++) {
      const inArch = y > y1 ? Math.hypot((x - (x0 + x1) / 2) / 8.5, (y - y1) / 4.5) < 1 : true;
      if (inArch) g.set(x, y, front - 1, y % 7 === 0 ? 'mist' : 'slate');
    }
    for (let x = x0; x <= x1; x++) { g.set(x, y0 + 12, front - 1, 'slate'); g.set(x, y0 + 1, front - 1, 'slate'); }
    // the stone arch frame
    for (let y = y0; y <= y1 + 6; y++) for (let x = x0 - 2; x <= x1 + 2; x++) {
      const inner = y > y1 ? Math.hypot((x - (x0 + x1) / 2) / 8.5, (y - y1) / 4.5) < 1 : x >= x0 && x <= x1;
      const outer = y > y1 ? Math.hypot((x - (x0 + x1) / 2) / 10.5, (y - y1) / 6.5) < 1 : x >= x0 - 2 && x <= x1 + 2;
      if (outer && !inner) g.set(x, y, front, (x + y) % 5 === 0 ? 'stone' : 'stoneLight');
    }
    // prisoners: eyes in the dark of two cells
    if (i === 0 || i === 3) { g.set(cx + ox - 3 + i, y0 + 9, 3, 'gold', true); g.set(cx + ox - 1 + i, y0 + 9, 3, 'gold', true); }
    if (i === 1) { g.set(cx + ox + 2, y0 + 5, 3, 'bone'); g.set(cx + ox + 3, y0 + 4, 3, 'bone'); g.set(cx + ox + 1, y0 + 2, 3, 'bone'); }   // bones
  });
  // the Warden's niche: a tall arch, deeper, with a throne-like dais and two iron rings
  {
    const x0 = cx - 18, x1 = cx + 18, y0 = base, y1 = base + 26;
    for (let y = y0; y <= y1 + 8; y++) for (let x = x0; x <= x1; x++) {
      const inside = y > y1 ? Math.hypot((x - cx) / 18.5, (y - y1) / 8.5) < 1 : true;
      if (!inside) continue;
      for (let z = 3; z <= front; z++) g.set(x, y, z, null);
      g.set(x, y, 2, (Math.floor(y / 3) + Math.floor((x + (Math.floor(y / 3) % 2) * 4) / 8)) % 3 ? 'stoneDark' : 'shadow');
    }
    for (let y = y0; y <= y1 + 11; y++) for (let x = x0 - 3; x <= x1 + 3; x++) {
      const inner = y > y1 ? Math.hypot((x - cx) / 18.5, (y - y1) / 8.5) < 1 : x >= x0 && x <= x1;
      const outer = y > y1 ? Math.hypot((x - cx) / 21.5, (y - y1) / 11.5) < 1 : x >= x0 - 3 && x <= x1 + 3;
      if (outer && !inner) g.set(x, y, front, (x + y) % 6 === 0 ? 'stone' : 'stoneLight');
    }
    // keystone: a carved key
    g.box(cx - 2, y1 + 9, front, cx + 2, y1 + 12, front, 'fog');
    g.set(cx, y1 + 11, front, 'gold'); g.set(cx, y1 + 10, front, 'gold'); g.set(cx - 1, y1 + 10, front, 'gold');
    // rings the chains hang from
    for (const s of [-1, 1]) {
      const rx = cx + s * 12, ry = y0 + 15;
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; g.set(Math.round(rx + Math.sin(a) * 1.6), Math.round(ry + Math.cos(a) * 1.6), 3, 'mist'); }
    }
    // a banner each side of the niche
    for (const s of [-1, 1]) {
      const bx = cx + s * 28;
      for (let y = base + 10; y <= base + 30; y++) for (let x = bx - 4; x <= bx + 4; x++) {
        if (y < base + 13 && hash(x, y) < (base + 13 - y) * 0.3) continue;
        g.set(x, y, front + 0, Math.abs(x - bx) === 4 ? 'plum' : 'blood');
      }
      for (let x = bx - 5; x <= bx + 5; x++) g.set(x, base + 31, front, 'woodLight');
      g.box(bx - 1, base + 22, front, bx + 1, base + 24, front, 'gold'); g.box(bx, base + 16, front, bx, base + 22, front, 'gold'); g.set(bx + 1, base + 17, front, 'gold'); g.set(bx + 1, base + 19, front, 'gold');
    }
  }
  // crumbled top edge
  for (let x = 0; x < W; x++) { const k = Math.floor(hash(Math.floor(x / 5), 9) * 4); for (let y = H - k; y < H; y++) for (let z = 0; z < D; z++) g.set(x, y, z, null); }
  defineModel('boss.wall', { grid: g, origin: [cx, base, D] });
}

// the bridge in from the south, and its gate of bars
function buildBridge() {
  const W = 18, L = 30, H = 14;
  const g = new VoxelGrid(W, H, L);
  for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
    const edge = x <= 1 || x >= W - 2;
    const slab = (Math.floor(z / 4) + (x > W / 2 ? 1 : 0)) % 2;
    g.set(x, H - 1, z, edge ? 'stoneLight' : z % 4 === 0 ? 'shadow' : slab ? 'stone' : 'stoneDark');
    if (edge && z % 6 < 2) g.set(x, H, z, 'stoneLight');
    if (x === 2 || x === W - 3 || z % 8 === 0) for (let y = H - 9; y < H - 1; y++) g.set(x, y, z, 'dusk');
  }
  // posts at the mouth
  for (const x of [0, W - 3]) g.box(x, 0, 0, x + 2, H + 6, 2, 'stoneLight');
  defineModel('boss.bridge', { grid: g, origin: [W / 2, H, 0] });

  const gate = new VoxelGrid(16, 18, 2);
  for (let x = 0; x < 16; x += 3) for (let y = 0; y < 17; y++) gate.set(x, y, 0, y > 14 ? 'fog' : 'slate');
  for (let x = 0; x < 16; x++) { gate.set(x, 6, 1, 'mist'); gate.set(x, 12, 1, 'mist'); }
  for (let x = 0; x < 16; x += 3) gate.set(x, 17, 0, 'frost');
  defineModel('boss.gate', { grid: gate, origin: [8, 0, 1] });
}

// iron cage-braziers on posts: unlit (cold coals) and lit (emissive coals)
function buildBrazier() {
  for (const lit of [false, true]) {
    const g = new VoxelGrid(9, 19, 9);
    g.box(2, 0, 2, 6, 0, 6, 'slate'); g.box(3, 1, 3, 5, 1, 5, 'stoneDark');
    g.box(4, 2, 4, 4, 11, 4, 'slate'); g.set(4, 6, 4, 'mist'); g.set(4, 11, 4, 'mist');
    // a solid iron bowl with a pale rim, four little claws holding it
    for (let y = 12; y <= 15; y++) for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) {
      const d = Math.hypot(x - 4, z - 4), r = 1.6 + (y - 12) * 0.85;
      if (d > r + 0.45) continue;
      if (y < 15 && d < r - 0.7) continue;
      g.set(x, y, z, y === 15 ? 'mist' : (z > 4 ? 'slate' : 'stoneDark'));
    }
    for (const [x, z] of [[0, 4], [8, 4], [4, 0], [4, 8]]) g.set(x, 16, z, 'fog');
    // the coals heaped in the bowl
    for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) {
      const d = Math.hypot(x - 4, z - 4);
      if (d < 3.3) g.set(x, 15, z, lit ? (d > 2.4 ? 'ember' : 'flame') : (hash(x, z) < 0.5 ? 'stoneDark' : 'dirt'), lit);
      if (d < 2.1) g.set(x, 16, z, lit ? (d > 1.2 ? 'flame' : 'gold') : 'stoneDark', lit);
      if (d < 0.9 && lit) g.set(x, 17, z, 'torch', true);
    }
    defineModel(`boss.brazier.${lit ? 'lit' : 'dark'}`, { grid: g, origin: [4.5, 0, 4.5] });
  }
}

// the cage: eight arcs of bars on the ring r = CAGE, each its own model so they burst up in turn
function buildCage() {
  const R = PIT.CAGE * 8, n = 8, H = 24;
  for (let k = 0; k < n; k++) {
    const a0 = k / n * TAU, a1 = (k + 1) / n * TAU, am = (a0 + a1) / 2;
    const ox = Math.sin(am) * R, oz = Math.cos(am) * R;
    const S = 32, c = S / 2;
    const g = new VoxelGrid(S, H, S);
    const bars = 6;
    for (let b = 0; b < bars; b++) {
      const a = a0 + (b + 0.5) / bars * (a1 - a0);
      const x = Math.round(Math.sin(a) * R - ox + c), z = Math.round(Math.cos(a) * R - oz + c);
      for (let y = 0; y < H - 2; y++) g.set(x, y, z, y > H - 6 ? 'mist' : 'slate');
      g.set(x, H - 2, z, 'fog'); g.set(x, H - 1, z, 'frost');            // spear tip
    }
    // two crossbands along the arc
    for (let s = 0; s <= 40; s++) {
      const a = a0 + s / 40 * (a1 - a0);
      const x = Math.round(Math.sin(a) * R - ox + c), z = Math.round(Math.cos(a) * R - oz + c);
      g.set(x, 5, z, 'mist'); g.set(x, 14, z, 'slate');
    }
    defineModel(`boss.cage.${k}`, { grid: g, origin: [c, 0, c] });
  }
}

// rubble chunks on the rim, and a broken chain stub for the wall anchors
function buildBits() {
  const r = new VoxelGrid(7, 3, 6);
  for (let z = 0; z < 6; z++) for (let x = 0; x < 7; x++) {
    const h = Math.floor(hash(x, z, 3) * 3) + (Math.hypot(x - 3, z - 2.5) < 2 ? 1 : 0) - (Math.hypot(x - 3, z - 2.5) > 3 ? 2 : 0);
    for (let y = 0; y < h; y++) r.set(x, y, z, y === h - 1 ? 'stoneLight' : 'stone');
  }
  defineModel('boss.rubble', { grid: r });
}

buildFloor();
buildRunes();
buildWall();
buildBridge();
buildBrazier();
buildCage();
buildBits();
