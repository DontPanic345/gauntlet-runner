// Enemy voxel models (piece `enemies`): every archetype is a small rig of rigid parts, each
// authored in code here and meshed once. Front is +z. One voxel = 1/8 world unit.
//
//   Husk        ~13 voxels hunched. Rotting green skin, brown rags, a bone face with gold
//               eyes and a hinged jaw. Long arms that end in bone claws.
//   Ember Wisp  a coal skull with torch-white eyes inside a flickering flame shell (three
//               flame frames). Floats. Fires ember orbs.
//   Brute       ~19 voxels, twice the hero's width. Plum hide, iron helm with bone horns,
//               iron gauntlets, red eyes, a nose ring.
//   Mite        4 voxels tall. Teal carapace with glowing sky spots, bone mandibles, six
//               legs in two scuttle frames.
//
// Parts are registered on import; build a rig with the functions in rigs.js.

import { defineModel, VoxelGrid } from '../render/voxel/index.js';

const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

function part(name, size, origin, build) {
  const g = new VoxelGrid(...size);
  build(g);
  defineModel(name, { grid: g, origin });
}

// ---- HUSK ----------------------------------------------------------------------------------
// legs: pivot at the hip (top centre). Bare rotting feet, rag-wrapped thighs.
for (const side of ['L', 'R']) {
  part(`enemies.husk.leg${side}`, [2, 4, 3], [1, 4, 1], (g) => {
    g.box(0, 0, 0, 1, 0, 2, 'leaf');                    // foot, toes forward
    g.set(side === 'L' ? 0 : 1, 0, 2, 'moss');          // a darker toe
    g.box(0, 1, 0, 1, 2, 1, 'moss');                    // shin
    g.box(0, 3, 0, 1, 3, 1, 'dirt');                    // rag wrap
    g.set(side === 'L' ? 1 : 0, 2, 1, 'dirt');          // a trailing strip
  });
}
// torso: pivot at the bottom centre. Loincloth, a sunken chest with bone ribs, bony spine.
part('enemies.husk.torso', [6, 5, 4], [3, 0, 2], (g) => {
  g.box(0, 0, 0, 5, 1, 3, 'dirt');                      // loincloth
  g.box(1, 0, 3, 2, 0, 3, 'wood'); g.set(4, 1, 3, 'wood'); g.set(0, 0, 0, 'wood');
  g.box(0, 2, 0, 5, 4, 3, 'leaf');                      // chest
  g.box(0, 2, 0, 0, 4, 3, 'moss'); g.box(5, 2, 0, 5, 4, 3, 'moss');   // flanks in shadow
  for (const x of [1, 2, 3, 4]) { g.set(x, 2, 3, x % 2 ? 'bone' : 'moss'); g.set(x, 3, 3, x % 2 ? 'moss' : 'bone'); }  // ribs
  g.set(2, 3, 3, 'blood');                              // a wound
  g.box(0, 4, 0, 5, 4, 3, 'moss');                      // shoulders
  g.set(1, 4, 0, 'bone'); g.set(3, 4, 0, 'bone');       // spine knobs on the hunch
  g.set(2, 3, 0, 'bone');
  g.box(0, 1, 0, 0, 1, 1, 'wood');                      // rag hanging off the hip
});
// head: pivot at the bottom back (the neck). A bone face, gold eyes in ink sockets, hair.
part('enemies.husk.head', [5, 5, 5], [2.5, 0, 1.5], (g) => {
  g.box(0, 1, 0, 4, 4, 4, 'leaf');
  g.box(0, 1, 0, 0, 4, 1, 'moss'); g.box(4, 1, 0, 4, 4, 1, 'moss');
  g.box(1, 1, 4, 3, 4, 4, 'bone');                      // face
  g.box(0, 2, 4, 0, 3, 4, 'fog');                       // cheekbones
  g.box(4, 2, 4, 4, 3, 4, 'fog');
  g.set(1, 3, 4, 'ink'); g.set(3, 3, 4, 'ink');         // sockets
  g.set(1, 2, 4, 'gold', true); g.set(3, 3, 4, 'gold', true);   // mismatched eyes: one sunk low
  g.set(2, 2, 4, 'ink');                                // nose hole
  g.box(1, 1, 4, 3, 1, 4, 'ink');                       // mouth (the jaw hangs below it)
  g.box(1, 0, 1, 3, 0, 2, 'moss');                      // neck
  // stringy hair over the crown and down the back
  for (let x = 0; x < 5; x++) for (let z = 0; z < 4; z++) if (hash(x, z, 4) < 0.55) g.set(x, 4, z, 'dirt');
  g.set(0, 3, 0, 'dirt'); g.set(4, 2, 0, 'dirt'); g.set(3, 3, 0, 'dirt');
});
// jaw: pivot at its back edge, so it drops open
part('enemies.husk.jaw', [3, 1, 3], [1.5, 1, 0], (g) => {
  g.box(0, 0, 0, 2, 0, 2, 'bone');
  g.set(1, 0, 2, 'fog');
  g.set(0, 0, 2, 'bone'); g.set(2, 0, 2, 'bone');
});
// arms: pivot at the shoulder (top centre). Long and thin, ending in three bone claws.
for (const side of ['L', 'R']) {
  part(`enemies.husk.arm${side}`, [2, 8, 3], [1, 8, 1], (g) => {
    g.box(0, 6, 0, 1, 7, 1, 'moss');                    // shoulder
    g.box(0, 3, 0, 1, 5, 1, 'leaf');                    // arm
    g.set(side === 'L' ? 0 : 1, 4, 1, 'moss');
    g.set(side === 'L' ? 1 : 0, 5, 0, 'dirt');          // rag strip
    g.box(0, 1, 0, 1, 2, 2, 'leaf');                    // hand, reaching forward
    g.set(0, 0, 2, 'bone'); g.set(1, 0, 2, 'bone'); g.set(side === 'L' ? 1 : 0, 0, 1, 'bone');   // claws
    g.set(0, 1, 2, 'fog');
  });
}

// ---- BRUTE ---------------------------------------------------------------------------------
for (const side of ['L', 'R']) {
  part(`enemies.brute.leg${side}`, [3, 5, 4], [1.5, 5, 1.5], (g) => {
    g.box(0, 0, 0, 2, 0, 3, 'stoneDark');               // iron boot, toe forward
    g.box(0, 0, 3, 2, 0, 3, 'slate');
    g.box(0, 1, 0, 2, 1, 2, 'slate');                   // greave
    g.set(side === 'L' ? 0 : 2, 1, 2, 'mist');          // rivet
    g.box(0, 2, 0, 2, 4, 2, 'plum');                    // thigh
    g.box(0, 2, 0, 2, 2, 2, 'blood');                   // shade under the knee
    g.box(side === 'L' ? 0 : 2, 3, 0, side === 'L' ? 0 : 2, 4, 2, 'blood');
  });
}
part('enemies.brute.torso', [10, 8, 7], [5, 0, 3.5], (g) => {
  // belly and chest: a barrel of plum hide
  for (let y = 0; y < 8; y++) for (let z = 0; z < 7; z++) for (let x = 0; x < 10; x++) {
    const rx = y < 2 ? 3.9 : y < 6 ? 5.0 : 4.6, rz = y < 2 ? 2.9 : y < 6 ? 3.5 : 3.1;
    const dx = (x - 4.5) / rx, dz = (z - 3 + (y > 4 ? 0.4 : 0)) / rz;
    if (dx * dx + dz * dz > 1.02) continue;
    let c = 'plum';
    if (Math.abs(x - 4.5) > 3.6) c = 'blood';
    if (z >= 5 && y >= 3 && y <= 4 && Math.abs(x - 4.5) < 2.6) c = 'rose';   // pecs catch the light
    g.set(x, y, z, c);
  }
  // iron belt with a buckle
  for (let z = 0; z < 7; z++) for (let x = 0; x < 10; x++) if (g.get(x, 1, z)) g.set(x, 1, z, 'slate');
  for (let x = 3; x <= 6; x++) for (let z = 5; z < 7; z++) if (g.get(x, 1, z)) g.set(x, 1, z, x === 4 || x === 5 ? 'stoneLight' : 'slate');
  // chain across the chest, shoulder to hip
  for (let k = 0; k < 6; k++) {
    const x = 2 + k, y = 6 - k;
    for (let z = 6; z >= 0; z--) if (g.get(x, y, z)) { g.set(x, y, z, k % 2 ? 'fog' : 'mist'); break; }
  }
  // pauldrons (iron shoulder plates) and a spiked hump
  for (const [x0, x1] of [[0, 1], [8, 9]]) {
    g.box(x0, 5, 1, x1, 6, 5, 'slate');
    g.box(x0, 6, 1, x1, 6, 5, 'stoneLight');
    g.set(x0 === 0 ? 0 : 9, 6, 3, 'mist');
  }
  // the hump: bare hide with a row of bone spikes down the spine
  g.box(3, 7, 0, 6, 7, 3, 'rose');
  for (const z of [0, 2]) { g.set(4, 7, z, 'bone'); g.set(5, 7, z, 'bone'); }
  g.set(4, 6, 0, 'bone');
});
// head: low and forward between the shoulders. A plum face with a heavy brow, red eyes, tusks
// and a nose ring, a small iron cap, and wide bone horns that read from above.
part('enemies.brute.head', [14, 6, 7], [7, 0, 2], (g) => {
  g.box(4, 0, 0, 9, 3, 5, 'plum');                      // face and jowls
  g.box(4, 0, 0, 4, 2, 4, 'blood'); g.box(9, 0, 0, 9, 2, 4, 'blood');
  g.box(4, 3, 1, 9, 3, 5, 'rose');                      // the top of the skull catches the light
  g.box(5, 0, 6, 8, 1, 6, 'rose');                      // snout juts out
  g.set(6, 1, 6, 'ink'); g.set(7, 1, 6, 'ink');         // nostrils
  g.set(6, 0, 6, 'frost'); g.set(7, 0, 6, 'fog');       // nose ring
  g.set(4, 0, 5, 'bone'); g.set(9, 0, 5, 'bone');       // tusks
  g.set(4, 1, 5, 'white'); g.set(9, 1, 5, 'white');
  g.box(5, 2, 5, 8, 2, 5, 'ink');
  g.set(5, 2, 5, 'red', true); g.set(8, 2, 5, 'red', true);   // eyes under the brow
  g.box(4, 3, 5, 9, 3, 5, 'blood');                     // brow
  g.box(4, 3, 0, 9, 4, 1, 'slate');                     // iron cap at the back
  g.box(6, 4, 0, 7, 4, 2, 'stoneLight');                // its crest
  // horns: out sideways, then sweeping up and forward
  for (const s of [-1, 1]) {
    const x = (k) => (s < 0 ? 3 - k : 10 + k);
    g.set(x(0), 2, 2, 'bone'); g.set(x(0), 2, 3, 'bone');
    g.set(x(1), 2, 2, 'bone'); g.set(x(1), 3, 3, 'bone');
    g.set(x(2), 3, 3, 'frost'); g.set(x(2), 4, 4, 'frost');
    g.set(x(3), 4, 4, 'white'); g.set(x(3), 5, 5, 'white');
  }
});
for (const side of ['L', 'R']) {
  part(`enemies.brute.arm${side}`, [4, 9, 4], [2, 9, 1.5], (g) => {
    g.box(0, 3, 0, 3, 5, 2, 'plum');                    // upper arm, fat
    g.box(side === 'L' ? 0 : 3, 3, 0, side === 'L' ? 0 : 3, 5, 2, 'blood');
    g.box(1, 6, 0, 2, 8, 2, 'plum');                    // shoulder under the pauldron
    g.box(0, 3, 0, 3, 3, 2, 'slate');                   // bracer
    g.box(0, 0, 0, 3, 2, 3, 'slate');                   // iron gauntlet
    g.box(0, 2, 0, 3, 2, 3, 'stoneLight');
    for (const x of [0, 2, 3]) g.set(x, 1, 3, 'mist');  // knuckles
    g.set(1, 0, 3, 'stoneDark');
  });
}

// ---- EMBER WISP ----------------------------------------------------------------------------
part('enemies.wisp.core', [4, 4, 4], [2, 2, 2], (g) => {
  g.box(0, 0, 0, 3, 3, 3, 'stoneDark');
  g.box(0, 3, 0, 3, 3, 3, 'stone');
  g.set(0, 3, 0, 'stoneDark'); g.set(3, 3, 3, 'stoneLight');
  g.set(1, 2, 3, 'torch', true); g.set(2, 2, 3, 'torch', true);   // eyes
  g.set(1, 0, 3, 'ember', true); g.set(2, 0, 3, 'flame', true);   // a glowing crack of a mouth
  g.set(3, 1, 2, 'ember', true);                                  // cracks round the side
  g.set(0, 2, 1, 'ember', true);
});
// three flame frames: a teardrop shell of emissive fire round the core, open at the front
// where the skull's face looks out. Hotter colours inside, ember at the tips.
for (let f = 0; f < 3; f++) {
  const S = 9, H = 13, c = 4;
  part(`enemies.wisp.flame${f}`, [S, H, S], [4.5, 3.5, 4.5], (g) => {
    const R = [2.6, 3.4, 3.8, 3.9, 3.7, 3.3, 2.8, 2.3, 1.8, 1.3, 0.9, 0.6, 0.35];
    for (let y = 0; y < H; y++) {
      const sway = Math.sin(y * 0.55 + f * 2.1) * (y / H) * 1.4;   // tongues lean differently per frame
      const r = R[y] * (1 + 0.12 * Math.sin(f * 2.4 + y * 1.3));
      for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
        const dx = x - c - sway * (f === 1 ? -1 : 1), dz = z - c + (y > 5 ? (y - 5) * 0.25 : 0);   // the tip trails backward
        const d = Math.hypot(dx, dz);
        const jag = hash(x, y, z * 7 + f * 31) * 0.9;
        if (d > r + 0.3 - jag * 0.6) continue;
        // hollow at the front around the skull's face
        if (y >= 1 && y <= 5 && dz > 0.6 && Math.abs(dx) < 2.2) continue;
        if (y >= 2 && y <= 5 && d < 1.9) continue;   // the core sits here
        const k = d / Math.max(0.5, r) + y / H * 0.55 + jag * 0.15;
        const col = k > 1.05 ? 'ember' : k > 0.8 ? 'flame' : k > 0.55 ? 'gold' : 'torch';
        g.set(x, y, z, col, true);
      }
    }
    // a few stray licks of flame above the tip
    const lx = c + (f === 0 ? 1 : f === 1 ? -1 : 0);
    g.set(lx, H - 1, c + 1, 'ember', true);
    if (f === 2) g.set(c + 2, H - 3, c + 2, 'flame', true);
  });
}
part('enemies.wisp.orb', [5, 5, 5], [2.5, 2.5, 2.5], (g) => {
  for (let y = 0; y < 5; y++) for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
    const d = Math.hypot(x - 2, y - 2, z - 2);
    if (d > 2.45) continue;
    g.set(x, y, z, d < 1.1 ? 'torch' : d < 1.8 ? 'gold' : (x + y + z) % 3 ? 'flame' : 'ember', true);
  }
});

// ---- MITE ----------------------------------------------------------------------------------
// Seen from above (the camera is high), a tick is a round shell with arched legs round it and
// two glowing eyes at the front. The shell is the brightest thing on it.
const miteShell = (g, flipped) => {
  for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) {
    const dx = (x - 2.5) / 3, dz = (z - 2.5) / 3;
    const d = dx * dx + dz * dz;
    if (d > 1.02) continue;
    if (flipped) { g.set(x, 0, z, d > 0.55 ? 'teal' : 'cyan'); if (d < 0.55) g.set(x, 1, z, 'navy'); continue; }
    g.set(x, 0, z, 'navy');
    g.set(x, 1, z, d > 0.6 ? 'teal' : 'cyan');
    if (d < 0.5) g.set(x, 2, z, d < 0.12 ? 'sky' : 'cyan', d < 0.12);
  }
};
part('enemies.mite.body', [6, 3, 7], [3, 0, 3], (g) => {
  miteShell(g, false);
  g.set(1, 2, 2, 'sky', true); g.set(4, 2, 2, 'sky', true); g.set(2, 1, 0, 'sky', true); g.set(3, 1, 0, 'sky', true);   // glowing spots
  g.box(2, 0, 6, 3, 1, 6, 'navy');                      // head
  g.set(2, 2, 6, 'sky', true); g.set(3, 2, 6, 'sky', true);   // eyes
  g.set(1, 0, 6, 'bone'); g.set(4, 0, 6, 'bone');       // mandibles
});
for (const f of [0, 1]) {
  // arched legs: hip at the shell, knee up high, foot out on the floor. An alternating tripod
  // gait lifts every other foot.
  part(`enemies.mite.legs${f}`, [10, 3, 8], [5, 0, 3], (g) => {
    const legs = [[0, 1, -1], [1, 3, 0], [2, 4, 1]];    // [index, z at the hip, lean of the foot]
    for (const [i, z, lean] of legs) {
      for (const s of [-1, 1]) {
        const up = (i + f + (s > 0 ? 1 : 0)) % 2 === 1;
        const hip = s < 0 ? 2 : 7, knee = s < 0 ? 1 : 8, foot = s < 0 ? 0 : 9;
        g.set(hip, 1, z, 'navy');
        g.set(knee, 2, z + lean, 'teal');
        g.set(foot, up ? 1 : 0, z + lean * 2 + (up ? 1 : 0), 'navy');
      }
    }
  });
}
part('enemies.mite.dead', [6, 3, 7], [3, 0, 3], (g) => {  // flipped: belly up, legs in the air
  miteShell(g, true);
  for (const z of [1, 3, 4]) { g.set(1, 2, z, 'teal'); g.set(4, 2, z + 1, 'teal'); }
  g.set(2, 1, 6, 'sky'); g.set(3, 1, 6, 'sky');
});

// ---- shared ----------------------------------------------------------------------------------
// a soft round shadow for things that float
part('enemies.shadow', [7, 1, 7], [3.5, 1, 3.5], (g) => {
  for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) if (Math.hypot(x - 3, z - 3) < 3.2) g.set(x, 0, z, 'night');
});
// stun stars that circle a dazed head
part('enemies.star', [3, 3, 1], [1.5, 1.5, 0.5], (g) => {
  g.set(1, 0, 0, 'gold', true); g.set(0, 1, 0, 'gold', true); g.set(1, 1, 0, 'torch', true); g.set(2, 1, 0, 'gold', true); g.set(1, 2, 0, 'gold', true);
});
