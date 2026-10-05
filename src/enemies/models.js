// Enemy voxel models (piece `enemies`): every archetype is a small rig of rigid parts, each
// authored in code here and meshed once. Front is +z. One voxel = 1/8 world unit.
//
//   Husk        ~13 voxels hunched. Bright leaf-green body, a bare white skull for a head with
//               two glowing gold eyes, tan rags, bone claws. Hinged jaw.
//   Ember Wisp  a white skull (sky eyes, an ink halo behind it) inside a red-tipped flame
//               (three frames). Floats. Fires white-hot orbs with a rose rim.
//   Brute       ~19 voxels, twice the hero's width. Plum hide with rose top faces, pale steel
//               plates, bone horns and bone fists, gold eyes, an ember maw that flares.
//   Mite        4 voxels tall. Cyan/teal carapace with glowing sky spots, white eyes, bone
//               mandibles, six legs in two scuttle frames.
//
// Wave 2: every archetype's top faces carry its lightest colour, and its material (see
// material.js) keeps it from sinking toward the floor's values away from torches.
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
// Wave 2 identity: a bright green corpse with a bare white skull for a head and two hot gold
// eyes. Green skin, pale bone, tan rags; the top faces (skull, shoulders) are the lightest.
// legs: pivot at the hip (top centre). Bare rotting feet, rag-wrapped thighs.
for (const side of ['L', 'R']) {
  part(`enemies.husk.leg${side}`, [2, 4, 3], [1, 4, 1], (g) => {
    g.box(0, 0, 0, 1, 0, 2, 'leaf');                    // foot, toes forward
    g.set(side === 'L' ? 0 : 1, 0, 2, 'bone');          // a bare toe bone
    g.box(0, 1, 0, 1, 2, 1, 'leaf');                    // shin
    g.set(side === 'L' ? 1 : 0, 1, 1, 'moss');
    g.box(0, 3, 0, 1, 3, 1, 'woodLight');               // rag wrap
    g.set(side === 'L' ? 1 : 0, 2, 1, 'woodLight');     // a trailing strip
  });
}
// torso: pivot at the bottom centre. Loincloth, a sunken chest with bone ribs, bony spine.
part('enemies.husk.torso', [6, 5, 4], [3, 0, 2], (g) => {
  g.box(0, 0, 0, 5, 1, 3, 'woodLight');                 // loincloth
  g.box(1, 0, 3, 2, 0, 3, 'wood'); g.set(4, 1, 3, 'wood'); g.set(0, 0, 0, 'wood');
  g.box(0, 2, 0, 5, 4, 3, 'leaf');                      // chest
  for (const x of [1, 2, 3, 4]) { g.set(x, 2, 3, x % 2 ? 'bone' : 'moss'); g.set(x, 3, 3, x % 2 ? 'moss' : 'bone'); }  // ribs
  g.set(2, 3, 3, 'red');                                // a wound
  g.box(0, 4, 0, 5, 4, 3, 'leaf');                      // shoulders (top faces: the lightest green)
  g.set(1, 4, 0, 'bone'); g.set(3, 4, 0, 'bone'); g.set(2, 4, 1, 'bone');   // spine knobs on the hunch
  g.set(2, 3, 0, 'bone');
  g.set(0, 4, 3, 'moss'); g.set(5, 4, 2, 'moss');       // rot patches
  g.box(0, 1, 0, 0, 1, 1, 'wood');                      // rag hanging off the hip
});
// head: pivot at the bottom back (the neck). A bare skull: bone dome, deep ink sockets with
// glowing gold eyes (2 voxels tall, the brightest thing on it), a ragged moss scalp.
part('enemies.husk.head', [5, 5, 5], [2.5, 0, 1.5], (g) => {
  g.box(0, 1, 0, 4, 4, 4, 'bone');
  g.box(0, 1, 0, 0, 3, 1, 'frost'); g.box(4, 1, 0, 4, 3, 1, 'frost');   // the skull's back, a step cooler
  g.box(1, 2, 4, 1, 3, 4, 'ink'); g.box(3, 2, 4, 3, 3, 4, 'ink');       // sockets
  g.set(1, 3, 4, 'gold', true); g.set(3, 3, 4, 'gold', true);           // eyes
  g.set(1, 2, 4, 'flame', true); g.set(3, 2, 4, 'flame', true);
  g.set(2, 2, 4, 'fog');                                // nose ridge
  g.box(1, 1, 4, 3, 1, 4, 'ink');                       // mouth (the jaw hangs below it)
  g.set(2, 1, 4, 'bone');                               // one tooth
  g.box(1, 0, 1, 3, 0, 2, 'leaf');                      // neck
  // a ragged moss scalp over the crown and down the back: green on white reads from above
  for (let x = 0; x < 5; x++) for (let z = 0; z < 4; z++) if (hash(x, z, 4) < 0.42) g.set(x, 4, z, 'leaf');
  g.set(0, 3, 0, 'leaf'); g.set(4, 2, 0, 'leaf'); g.set(2, 4, 0, 'moss');
});
// jaw: pivot at its back edge, so it drops open
part('enemies.husk.jaw', [3, 1, 3], [1.5, 1, 0], (g) => {
  g.box(0, 0, 0, 2, 0, 2, 'bone');
  g.set(1, 0, 2, 'frost');
  g.set(0, 0, 2, 'white'); g.set(2, 0, 2, 'white');
});
// arms: pivot at the shoulder (top centre). Long and thin, ending in three bone claws.
for (const side of ['L', 'R']) {
  part(`enemies.husk.arm${side}`, [2, 8, 3], [1, 8, 1], (g) => {
    g.box(0, 6, 0, 1, 7, 1, 'leaf');                    // shoulder
    g.set(side === 'L' ? 0 : 1, 7, 0, 'bone');          // a shoulder knob
    g.box(0, 3, 0, 1, 5, 1, 'leaf');                    // arm
    g.set(side === 'L' ? 0 : 1, 4, 1, 'moss');
    g.box(0, 5, 0, 1, 5, 1, 'woodLight');               // rag band
    g.box(0, 1, 0, 1, 2, 2, 'leaf');                    // hand, reaching forward
    g.set(0, 0, 2, 'white'); g.set(1, 0, 2, 'white'); g.set(side === 'L' ? 1 : 0, 0, 1, 'bone');   // claws
    g.set(0, 1, 2, 'bone'); g.set(1, 1, 2, 'bone');
  });
}

// ---- BRUTE ---------------------------------------------------------------------------------
// Wave 2 identity: a purple bull-ogre. Plum hide with rose on every top face, pale steel
// (fog/frost) plates instead of dark iron, bone horns and bone-plated fists, gold eyes, a gold
// nose ring, and a maw that glows ember (and flares during its charge windup).
for (const side of ['L', 'R']) {
  part(`enemies.brute.leg${side}`, [3, 5, 4], [1.5, 5, 1.5], (g) => {
    g.box(0, 0, 0, 2, 0, 3, 'slate');                   // hoof-boot, toe forward
    g.box(0, 0, 3, 2, 0, 3, 'fog');
    g.box(0, 1, 0, 2, 1, 2, 'fog');                     // greave
    g.set(side === 'L' ? 0 : 2, 1, 2, 'frost');         // rivet
    g.box(0, 2, 0, 2, 4, 2, 'plum');                    // thigh
    g.box(0, 4, 0, 2, 4, 2, 'rose');                    // the top of the thigh catches the light
  });
}
part('enemies.brute.torso', [10, 8, 7], [5, 0, 3.5], (g) => {
  // belly and chest: a barrel of plum hide
  for (let y = 0; y < 8; y++) for (let z = 0; z < 7; z++) for (let x = 0; x < 10; x++) {
    const rx = y < 2 ? 3.9 : y < 6 ? 5.0 : 4.6, rz = y < 2 ? 2.9 : y < 6 ? 3.5 : 3.1;
    const dx = (x - 4.5) / rx, dz = (z - 3 + (y > 4 ? 0.4 : 0)) / rz;
    if (dx * dx + dz * dz > 1.02) continue;
    let c = 'plum';
    if (z >= 5 && y >= 3 && y <= 5 && Math.abs(x - 4.5) < 2.6) c = 'rose';   // pecs
    if (y >= 6) c = 'rose';                                                   // shoulders and back: top faces
    g.set(x, y, z, c);
  }
  // a leather belt with a gold buckle
  for (let z = 0; z < 7; z++) for (let x = 0; x < 10; x++) if (g.get(x, 1, z)) g.set(x, 1, z, 'wood');
  for (let x = 3; x <= 6; x++) for (let z = 5; z < 7; z++) if (g.get(x, 1, z)) g.set(x, 1, z, x === 4 || x === 5 ? 'gold' : 'woodLight');
  // a chain across the chest, shoulder to hip
  for (let k = 0; k < 6; k++) {
    const x = 2 + k, y = 6 - k;
    for (let z = 6; z >= 0; z--) if (g.get(x, y, z)) { g.set(x, y, z, k % 2 ? 'frost' : 'fog'); break; }
  }
  // pale steel pauldrons
  for (const [x0, x1] of [[0, 1], [8, 9]]) {
    g.box(x0, 5, 1, x1, 6, 5, 'fog');
    g.box(x0, 6, 1, x1, 6, 5, 'frost');
    g.set(x0 === 0 ? 0 : 9, 6, 3, 'white');
  }
  // the hump: a row of bone spikes down the spine
  for (const z of [0, 2]) { g.set(4, 7, z, 'bone'); g.set(5, 7, z, 'white'); }
  g.set(4, 6, 0, 'bone');
});
// head: low and forward between the shoulders. A plum face with a rose skull, a heavy brow,
// gold eyes, an ember maw under a jutting snout with a gold ring, tusks, and wide bone horns
// that read from above.
part('enemies.brute.head', [14, 6, 7], [7, 0, 2], (g) => {
  g.box(4, 0, 0, 9, 3, 5, 'plum');                      // jowls and the back of the head
  g.box(5, 0, 5, 8, 3, 5, 'rose');                      // the face: light, so it never reads as a hole
  g.box(4, 3, 0, 9, 3, 5, 'rose');                      // the top of the skull
  g.box(5, 1, 6, 8, 1, 6, 'rose');                      // snout juts out
  g.set(6, 1, 6, 'ink'); g.set(7, 1, 6, 'ink');         // nostrils
  g.set(6, 0, 6, 'gold'); g.set(7, 0, 6, 'gold');       // nose ring
  g.box(5, 0, 5, 8, 0, 5, 'ink');                       // the maw
  g.set(6, 0, 5, 'ember', true); g.set(7, 0, 5, 'ember', true);
  g.set(4, 0, 5, 'white'); g.set(9, 0, 5, 'white');     // tusks
  g.set(4, 1, 5, 'bone'); g.set(9, 1, 5, 'bone');
  g.set(5, 2, 5, 'gold', true); g.set(8, 2, 5, 'gold', true);   // eyes under the brow
  g.set(6, 2, 5, 'ink'); g.set(7, 2, 5, 'ink');
  g.box(4, 3, 5, 9, 3, 5, 'plum');                      // brow
  g.box(5, 4, 1, 8, 4, 3, 'fog');                       // a steel cap
  g.box(6, 4, 1, 7, 4, 2, 'frost');
  // horns: out sideways, then sweeping up and forward
  for (const s of [-1, 1]) {
    const x = (k) => (s < 0 ? 3 - k : 10 + k);
    g.set(x(0), 2, 2, 'bone'); g.set(x(0), 2, 3, 'bone');
    g.set(x(1), 2, 2, 'bone'); g.set(x(1), 3, 3, 'bone');
    g.set(x(2), 3, 3, 'white'); g.set(x(2), 4, 4, 'white');
    g.set(x(3), 4, 4, 'white'); g.set(x(3), 5, 5, 'white');
  }
});
// the maw's flare: a glowing plate just inside the mouth, shown (and blinked) during the
// charge windup, so the face itself announces the charge
part('enemies.brute.maw', [6, 2, 1], [3, 0, 0], (g) => {
  g.box(1, 0, 0, 4, 0, 0, 'ember', true);
  g.box(2, 0, 0, 3, 0, 0, 'gold', true);
  g.set(0, 0, 0, 'ember', true); g.set(5, 0, 0, 'ember', true);
  g.box(1, 1, 0, 4, 1, 0, 'flame', true);
});
for (const side of ['L', 'R']) {
  part(`enemies.brute.arm${side}`, [4, 9, 4], [2, 9, 1.5], (g) => {
    g.box(0, 3, 0, 3, 5, 2, 'plum');                    // upper arm, fat
    g.box(0, 5, 0, 3, 5, 2, 'rose');
    g.box(1, 6, 0, 2, 8, 2, 'rose');                    // shoulder under the pauldron
    g.box(0, 3, 0, 3, 3, 2, 'woodLight');               // a leather bracer
    g.box(0, 0, 0, 3, 2, 3, 'bone');                    // bone-plated fist
    g.box(0, 2, 0, 3, 2, 3, 'white');
    for (const x of [0, 2, 3]) g.set(x, 1, 3, 'frost');  // knuckles
    g.set(1, 0, 3, 'fog');
  });
}

// ---- EMBER WISP ----------------------------------------------------------------------------
// Wave 2 identity: a white skull in a red-hot flame. The skull (bone/white, ink sockets, sky
// eyes) is cool and pale so it never melts into torch light, and the flame runs red at the
// tips into ember and flame, not the torches' flame-gold-torch. Its orbs are white-hot with a
// rose rim, so a shot is never mistaken for a stray ember.
part('enemies.wisp.core', [4, 4, 4], [2, 2, 2], (g) => {
  g.box(0, 0, 0, 3, 3, 3, 'bone', true);
  g.box(0, 3, 0, 3, 3, 3, 'white', true);
  g.box(0, 0, 0, 3, 0, 3, 'frost', true);
  g.set(1, 2, 3, 'ink'); g.set(2, 2, 3, 'ink');          // sockets
  g.set(1, 1, 3, 'sky', true); g.set(2, 1, 3, 'sky', true);   // eyes
  g.set(0, 2, 3, 'ink'); g.set(3, 2, 3, 'ink');
  g.box(1, 0, 3, 2, 0, 3, 'ink');                        // the mouth
  g.set(0, 3, 0, 'frost', true); g.set(3, 1, 2, 'frost', true);
});
// an ink ring behind the skull, so the white head separates from the fire round it
part('enemies.wisp.ring', [6, 6, 1], [3, 3, 0.5], (g) => {
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    const d = Math.hypot(x - 2.5, y - 2.5);
    if (d <= 3.0) g.set(x, y, 0, 'ink');
  }
});
// three flame frames: a teardrop shell of emissive fire round the core, open at the front
// where the skull's face looks out. Hotter colours inside, red at the tips.
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
        const k = d / Math.max(0.5, r) + y / H * 0.6 + jag * 0.15;
        const col = k > 1.0 ? 'red' : k > 0.78 ? 'ember' : k > 0.55 ? 'flame' : 'torch';
        g.set(x, y, z, col, true);
      }
    }
    // a few stray licks of flame above the tip
    const lx = c + (f === 0 ? 1 : f === 1 ? -1 : 0);
    g.set(lx, H - 1, c + 1, 'red', true);
    if (f === 2) g.set(c + 2, H - 3, c + 2, 'red', true);
  });
}
part('enemies.wisp.orb', [5, 5, 5], [2.5, 2.5, 2.5], (g) => {
  // white-hot ball with a rose rim round its waist and a few plum flecks: never ember-coloured
  for (let y = 0; y < 5; y++) for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
    const d = Math.hypot(x - 2, y - 2, z - 2);
    if (d > 2.45) continue;
    const rim = d > 1.7 && Math.abs(y - 2) < 1;
    g.set(x, y, z, rim ? ((x + z) % 3 ? 'rose' : 'plum') : 'white', true);
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
  g.set(2, 2, 6, 'white', true); g.set(3, 2, 6, 'white', true);   // eyes
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
