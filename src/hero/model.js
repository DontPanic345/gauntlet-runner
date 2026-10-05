// The hooded runner (piece `hero`): voxel parts and the rig that holds them.
//
//   import { createHeroRig } from './hero/model.js';
//   const rig = createHeroRig();       // THREE objects, not yet in any scene
//   root.add(rig.group);               // rig.group holds the body AND the world-space bits
//                                      // (scarf tail, afterimages), so add it to a root at world origin
//   // drive it with HeroAnim (anim.js). Do not pose the parts by hand unless you own the pose.
//
// The body is a small hierarchy of rigid voxel parts, each meshed once (render/voxel):
//
//   root (feet, world x/z, yaw)
//    └ body (squash and stretch, pivot at the feet)
//       └ pelvis (hip height: bob, lean, twist)
//          ├ legL, legR          pivot at the hip
//          └ torso               belt, tunic
//             ├ mantle           rose capelet over the shoulders, scarf wrap and clasp
//             ├ head             the big rose hood; face and eyes swap by expression (setFace)
//             │  └ hoodTip └ hoodTip2   the hood's long point, two lagging pieces (springs)
//             ├ armL             off hand
//             ├ armR └ sword     sword hand
//             ├ capeA └ capeB └ capeC   the cape: three hinged panels, lag (springs)
//             └ scarfAnchor      where the world-space scarf tail starts
//
// 12 voxels to the top of the hood (legs 3, torso 3, mantle 1, hood 5), the point trails
// behind. One voxel = 1/8 world unit. Front is +z at yaw 0, like every other model.
// The sword is in the +x hand.

import * as THREE from 'three';
import { defineModel, VoxelGrid, VOXEL, voxelMesh, makeVoxelMaterial } from '../render/voxel/index.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';

const V = VOXEL;

/** Register a part built in code. origin is the pivot, in voxel units inside the grid. */
function part(name, size, origin, build) {
  const g = new VoxelGrid(...size);
  build(g);
  defineModel(name, { grid: g, origin });
}

// ---- palette roles -----------------------------------------------------------------------
// The hero is the one thing on screen that must read at a glance. Its big masses are the
// warm, saturated rose hood and cape (nothing else in the crypt wears it); the second accent
// is the cyan scarf, which matches the eyes and the swing smear. Navy is kept for the tunic
// only, under the cape, so the body never melts into the blue-violet floor.
const HOOD = 'rose', HOOD_DK = 'plum', CAPE = 'red', CAPE_DK = 'blood', MANTLE = 'rose', TRIM = 'bone';
const SCARF = 'cyan', SCARF_DK = 'teal';

// ---- legs: boot, shin wraps, trouser. Pivot at the hip (top centre). -------------------
for (const side of ['L', 'R']) {
  part(`hero.leg${side}`, [2, 3, 3], [1, 3, 1], (g) => {
    g.box(0, 0, 0, 1, 0, 2, 'wood');               // boot, toe pokes forward
    g.set(side === 'L' ? 0 : 1, 0, 2, 'woodLight'); // scuffed toe cap on the outside
    g.box(0, 1, 0, 1, 1, 1, 'fog');                // pale shin wraps: the stride reads on a dark floor
    g.set(side === 'L' ? 1 : 0, 1, 1, 'mist');
    g.box(0, 2, 0, 1, 2, 1, 'slate');              // trouser
  });
}

// ---- torso: belt and tunic. Pivot at the bottom centre. ----------------------------------
part('hero.torso', [4, 3, 3], [2, 0, 1.5], (g) => {
  g.box(0, 0, 0, 3, 0, 2, 'wood');       // belt
  g.set(2, 0, 2, 'gold');                // buckle, a touch off centre
  g.set(0, 0, 1, 'dirt');                // pouch on the hip
  g.box(0, 1, 0, 3, 2, 2, 'navy');       // tunic
  g.box(1, 1, 2, 2, 2, 2, 'blue');       // tunic front panel
  g.set(2, 2, 2, TRIM);                  // collar lace
});

// ---- mantle: the capelet over the shoulders, with the scarf wrapped at the throat. -------
// Sits on top of the torso; the side drops cap the shoulders, so the back view has a
// shoulder line under the head. Pivot at the bottom centre of the shoulder caps.
part('hero.mantle', [6, 2, 4], [3, 0, 2], (g) => {
  for (const x of [0, 5]) g.box(x, 0, 0, x, 0, 3, HOOD_DK);  // shoulder caps
  g.box(0, 1, 0, 5, 1, 3, MANTLE);
  g.set(0, 1, 0, HOOD_DK); g.set(5, 1, 0, HOOD_DK);           // rounded back corners
  g.box(1, 1, 3, 4, 1, 3, SCARF);                             // scarf wrap at the throat
  g.set(1, 1, 3, SCARF_DK); g.set(4, 1, 2, SCARF);
  g.set(3, 1, 3, 'gold');                                     // the clasp
  g.set(0, 1, 2, SCARF); g.set(0, 1, 1, SCARF_DK);            // the knot at the side (the tail starts here)
});

// ---- hood: a big rounded cowl with a shadowed face. Pivot at the neck (bottom centre). ----
// Head-heavy on purpose (5 of 12 voxels): a chibi head reads as a character at 1x.
// Face variants swap the whole head geometry: open, blink, hurt, dead.
const FACES = {
  open: [[2, 1, 'sky'], [4, 1, 'sky']],
  blink: [[2, 1, 'slate'], [4, 1, 'slate']],
  hurt: [[1, 2, 'white'], [2, 1, 'white'], [4, 1, 'white'], [5, 2, 'white']],
  dead: [[2, 1, 'slate'], [4, 1, 'slate']],
};
for (const [face, eyes] of Object.entries(FACES)) {
  part(`hero.head.${face}`, [7, 5, 5], [3.5, 0, 2.5], (g) => {
    g.box(1, 0, 1, 5, 0, 3, HOOD_DK);                 // the neck: one voxel in on every side
    g.box(0, 1, 0, 6, 3, 4, HOOD);
    for (const [x, z] of [[0, 0], [6, 0], [0, 4], [6, 4]]) g.box(x, 1, z, x, 3, z, null);
    g.box(1, 4, 0, 5, 4, 3, HOOD);                    // crown, set back from the brim
    g.set(1, 4, 0, null); g.set(5, 4, 0, null);
    g.box(1, 1, 0, 5, 1, 0, HOOD_DK);                 // back hem, in shadow
    g.set(0, 1, 1, HOOD_DK); g.set(6, 1, 1, HOOD_DK);
    // face: the shadowed opening, flush (a recess hides the eyes at the camera's 50 deg pitch)
    g.box(1, 1, 4, 5, 2, 4, 'ink');
    g.set(1, 1, 4, HOOD_DK); g.set(5, 1, 4, HOOD_DK); // cheeks of the cowl close the bottom corners
    g.box(1, 3, 4, 5, 3, 4, HOOD);                    // brim over the face
    for (const [x, y, c] of eyes) g.set(x, y, 4, c, c !== 'slate');
  });
}

// ---- hood tail: a long point that flops back from the crown, in two lagging pieces. ------
// Pivots at the front of each piece; the piece extends back (-z), so rotation.x > 0 lifts it.
part('hero.hoodTip', [3, 2, 3], [1.5, 0, 3], (g) => {
  g.box(0, 0, 1, 2, 0, 2, HOOD);
  g.box(1, 0, 0, 1, 0, 2, HOOD);
  g.box(1, 1, 1, 1, 1, 2, HOOD);
});
part('hero.hoodTip2', [1, 1, 3], [0.5, 0, 3], (g) => {
  g.box(0, 0, 1, 0, 0, 2, HOOD);
  g.set(0, 0, 0, HOOD_DK);
});

// ---- arms: sleeve and glove. Pivot at the shoulder (top centre). -------------------------
for (const side of ['L', 'R']) {
  part(`hero.arm${side}`, [1, 3, 1], [0.5, 3, 0.5], (g) => {
    g.set(0, 0, 0, 'woodLight');
    g.box(0, 1, 0, 0, 2, 0, 'blue');
  });
}

// ---- sword: pommel, grip, guard, blade, bright tip. Pivot in the fist. -------------------
// Blade along +y. The anim points it where it needs to go.
part('hero.sword', [3, 8, 1], [1.5, 1.5, 0.5], (g) => {
  g.set(1, 0, 0, 'gold');
  g.box(1, 1, 0, 1, 2, 0, 'wood');
  g.box(0, 3, 0, 2, 3, 0, 'gold');
  g.box(1, 4, 0, 1, 6, 0, 'frost');
  g.set(1, 7, 0, 'white');
});

// ---- cape: three hinged panels hanging from the back of the mantle. ----------------------
// 6 voxels long, flaring from 6 to 7 wide, so it breaks the body's rectangle from every
// facing. Each panel's pivot is its top edge; rotation.x > 0 lifts it out behind.
part('hero.capeA', [6, 2, 1], [3, 2, 0.5], (g) => {
  g.box(0, 0, 0, 5, 1, 0, CAPE);
  g.box(1, 1, 0, 4, 1, 0, MANTLE);        // the collar seam, where the cape hangs from the mantle
});
part('hero.capeB', [6, 2, 1], [3, 2, 0.5], (g) => {
  g.box(0, 0, 0, 5, 1, 0, CAPE);
  g.set(1, 1, 0, CAPE_DK);                // a fold
});
part('hero.capeC', [7, 2, 1], [3.5, 2, 0.5], (g) => {
  g.box(0, 1, 0, 6, 1, 0, CAPE);
  g.box(0, 0, 0, 6, 0, 0, CAPE_DK);       // the hem, darker
  g.set(1, 0, 0, null); g.set(4, 0, 0, null); // tattered
  g.set(5, 1, 0, CAPE_DK);
});

// ---- scarf tail: segments laid along +z from their pivot, oriented by the anim -----------
part('hero.scarf', [1, 1, 2], [0.5, 0.5, 0], (g) => { g.box(0, 0, 0, 0, 0, 1, SCARF); });
part('hero.scarfEnd', [2, 1, 2], [1, 0.5, 0], (g) => {
  g.set(0, 0, 0, SCARF); g.set(1, 0, 0, SCARF_DK);
  g.set(0, 0, 1, SCARF_DK); // frayed end: one strand longer than the other
});

// ---- smears: pixel-art swing arcs, one model per frame -----------------------------------
// A flat crescent in the XZ plane around the pivot, 4 frames. Angles measured from +z
// (forward) toward +x. The swing runs from +x to -x; mirror (scale.x = -1) for the backhand
// and rotate onto the YZ plane for the overhead. The leading edge is thick and bright, the
// tail thins out toward the rim.
export const SMEAR_FRAMES = 4;
const SMEAR_R = 11;
const SMEAR_SPEC = [
  // lead, tail (degrees)
  [55, 125],
  [-25, 115],
  [-95, 50],
  [-120, -45],
];
for (const [kind, thick] of [['h', 1], ['v', 2]]) {
  SMEAR_SPEC.forEach(([lead, tail], f) => {
    const S = SMEAR_R * 2 + 1;
    part(`hero.smear.${kind}${f}`, [S, thick, S], [SMEAR_R + 0.5, thick / 2, SMEAR_R + 0.5], (g) => {
      const last = f === SMEAR_FRAMES - 1;
      for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
        const dx = x - SMEAR_R, dz = z - SMEAR_R;
        const r = Math.hypot(dx, dz);
        const a = (Math.atan2(dx, dz) * 180) / Math.PI;
        if (a < lead || a > tail) continue;
        const k = (a - lead) / (tail - lead);           // 0 at the leading edge, 1 at the tail
        const inner = 4.2 + k * k * 5.2 + (last ? 3 : 0); // the band thins toward the tail
        const outer = 10.6 - (last ? 0.8 : 0);
        if (r < inner || r > outer) continue;
        let c = 'frost';
        if (r > outer - 1.1) c = 'white';
        else if (k > 0.62 || last) c = 'sky';
        else if (r < inner + 1.2) c = 'fog';
        if (k < 0.08 && !last) c = 'white';
        for (let y = 0; y < thick; y++) g.set(x, y, z, c, true);
      }
    });
  });
}

// Two fade frames after the swing: the last arc thins to its rim, then thins to a shorter
// hairline, so the smear lingers for a few ticks (readable at 10 fps) without a smooth fade.
export const SMEAR_FADE = 2;
for (const [kind, thick] of [['h', 1], ['v', 2]]) {
  const [lead, tail] = [-128, -30];
  for (let f = 0; f < SMEAR_FADE; f++) {
    const S = SMEAR_R * 2 + 1;
    part(`hero.smear.${kind}${SMEAR_FRAMES + f}`, [S, thick, S], [SMEAR_R + 0.5, thick / 2, SMEAR_R + 0.5], (g) => {
      for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
        const dx = x - SMEAR_R, dz = z - SMEAR_R;
        const r = Math.hypot(dx, dz);
        const a = (Math.atan2(dx, dz) * 180) / Math.PI;
        if (a < lead || a > tail) continue;
        const k = (a - lead) / (tail - lead);
        const outer = 10.2 - f * 0.4, inner = outer - (f ? 1.0 : 2.2) + k * 0.8;
        if (r < inner || r > outer) continue;
        if (f === 1 && k > 0.75) continue;            // the tail end goes first
        const c = f ? 'teal' : r > outer - 1 ? 'sky' : 'cyan';
        for (let y = 0; y < thick; y++) g.set(x, y, z, c, true);
      }
    });
  }
}

// ---- rig ---------------------------------------------------------------------------------

const GHOSTS = 4;
const GHOST_COLORS = ['cyan', 'teal', 'navy'].map((n) => new THREE.MeshBasicMaterial({
  // pushed about half a world unit back in depth, so the live body always draws over its own trail
  color: hex(n), polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: 40000,
}));

/**
 * Build one hero. Returns the rig: THREE objects plus a few helpers. Every part shares one
 * private material, so rig.flash() lights the whole body at once.
 */
export function createHeroRig() {
  const material = makeVoxelMaterial();
  const group = new THREE.Group();
  group.name = 'hero';
  const root = new THREE.Group();
  root.name = 'hero.root';
  const body = new THREE.Group();
  const pelvis = new THREE.Group();
  pelvis.position.y = 3 * V;
  const mesh = (name, parent, x = 0, y = 0, z = 0) => {
    const m = voxelMesh(name);
    m.material = material;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  group.add(root);
  root.add(body);
  body.add(pelvis);

  const legL = mesh('hero.legL', pelvis, -1 * V, 0, 0);
  const legR = mesh('hero.legR', pelvis, 1 * V, 0, 0);
  const torso = mesh('hero.torso', pelvis);
  const mantle = mesh('hero.mantle', torso, 0, 2 * V, 0);
  const head = mesh('hero.head.open', torso, 0, 4 * V, 0);
  const hoodTip = mesh('hero.hoodTip', head, 0, 4 * V, -2.5 * V);
  const hoodTip2 = mesh('hero.hoodTip2', hoodTip, 0, 0, -3 * V);
  const armL = mesh('hero.armL', torso, -2.5 * V, 2 * V, 0);
  const armR = mesh('hero.armR', torso, 2.5 * V, 2 * V, 0);
  const sword = mesh('hero.sword', armR, 0, -2.5 * V, 0);
  const capeA = mesh('hero.capeA', torso, 0, 4 * V, -2.5 * V);
  const capeB = mesh('hero.capeB', capeA, 0, -2 * V, 0);
  const capeC = mesh('hero.capeC', capeB, 0, -2 * V, 0);
  const scarfAnchor = new THREE.Object3D();
  scarfAnchor.position.set(-3.2 * V, 3.4 * V, -0.4 * V);
  torso.add(scarfAnchor);

  // the scarf tail lives in world space (group), so it trails behind the body
  const scarf = [];
  for (let i = 0; i < 4; i++) {
    const s = voxelMesh(i === 3 ? 'hero.scarfEnd' : 'hero.scarf');
    s.material = material;
    group.add(s);
    scarf.push(s);
  }

  // smear: a child of root at chest height, so it turns with the facing
  const smearPivot = new THREE.Group();
  smearPivot.position.set(0, 5.5 * V, 0);
  root.add(smearPivot);
  const smear = new THREE.Mesh(voxelMesh('hero.smear.h0').geometry, material);
  smear.visible = false;
  smearPivot.add(smear);
  look.noOutline(smearPivot);

  // dash afterimages: flat-coloured copies of the body parts, in world space
  const parts = [legL, legR, torso, mantle, head, hoodTip, hoodTip2, armL, armR, sword, capeA, capeB, capeC];
  const ghosts = [];
  for (let i = 0; i < GHOSTS; i++) {
    const g = new THREE.Group();
    g.visible = false;
    g.matrixAutoUpdate = false;
    for (const p of parts) {
      const gm = new THREE.Mesh(p.geometry, GHOST_COLORS[0]);
      gm.matrixAutoUpdate = false;
      g.add(gm);
    }
    look.noOutline(g);
    group.add(g);
    ghosts.push({ group: g, age: 99 });
  }

  let face = 'open';
  const rig = {
    group, root, body, pelvis, torso, mantle, head, hoodTip, hoodTip2, armL, armR, sword, capeA, capeB, capeC, legL, legR,
    cloakU: capeA, cloakL: capeC, // wave 1 names, kept for anyone holding them
    scarf, scarfAnchor, smear, smearPivot, parts, ghosts, material,
    get face() { return face; },
    /** 'open' | 'blink' | 'hurt' | 'dead' */
    setFace(f) {
      if (f === face || !FACES[f]) return;
      face = f;
      head.geometry = voxelMesh(`hero.head.${f}`).geometry;
    },
    /** Whole-body flash in a palette colour. amount 0..1. */
    flash(colorName, amount) {
      material.userData.flash.value = amount;
      if (amount > 0) material.userData.flashColor.value.setHex(hex(colorName));
    },
    /** Show smear frame f (0..SMEAR_FRAMES-1, then SMEAR_FADE fade frames) of kind 'h' or 'v', or hide it (f < 0). */
    setSmear(kind, f) {
      if (f < 0 || f >= SMEAR_FRAMES + SMEAR_FADE) { smear.visible = false; return; }
      smear.visible = true;
      smear.geometry = voxelMesh(`hero.smear.${kind}${f}`).geometry;
    },
    /** Copy the current body pose into afterimage slot i (call after updateMatrixWorld). */
    stampGhost(i) {
      const gh = ghosts[i % GHOSTS];
      gh.age = 0;
      gh.group.visible = true;
      gh.group.matrix.copy(group.matrixWorld).invert(); // parts' world matrices, whatever group sits under
      gh.group.children.forEach((gm, k) => { gm.matrix.copy(parts[k].matrixWorld); gm.material = GHOST_COLORS[0]; });
      gh.group.updateMatrixWorld(true);
    },
    /** Age afterimages by one tick: they step down a colour ramp and vanish. */
    ageGhosts() {
      for (const gh of ghosts) {
        if (!gh.group.visible) continue;
        gh.age++;
        const step = Math.floor(gh.age / 4);
        if (step >= GHOST_COLORS.length) { gh.group.visible = false; continue; }
        for (const gm of gh.group.children) gm.material = GHOST_COLORS[step];
      }
    },
    dispose() { material.dispose(); group.removeFromParent(); },
  };
  return rig;
}

export const HERO_HEIGHT = 12 * V; // top of the hood, world units (for health bars, labels)
