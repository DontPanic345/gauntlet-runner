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
//          └ torso               belt, tunic, scarf wrap
//             ├ head             the hood; face and eyes swap by expression (setFace)
//             │  └ hoodTip       droops back, lags (spring)
//             ├ armL             off hand
//             ├ armR └ sword     sword hand
//             ├ cloakU └ cloakL  two hinged panels, lag (springs)
//             └ scarfAnchor      where the world-space scarf tail starts
//
// About 11 voxels to the top of the hood, 13 to the tip. One voxel = 1/8 world unit.
// Front is +z at yaw 0, like every other model. The sword is in the +x hand.

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

// ---- legs: boot with a toe, a short trouser leg. Pivot at the hip (top centre). ---------
for (const side of ['L', 'R']) {
  part(`hero.leg${side}`, [2, 3, 3], [1, 3, 1], (g) => {
    g.box(0, 0, 0, 1, 0, 2, 'dirt');          // boot, toe pokes forward
    g.set(side === 'L' ? 0 : 1, 0, 2, 'wood'); // scuffed toe cap on the outside
    g.box(0, 1, 0, 1, 1, 1, 'wood');          // boot cuff
    g.box(0, 2, 0, 1, 2, 1, 'dusk');          // trouser
  });
}

// ---- torso: belt, tunic, scarf wrap on top. Pivot at the bottom centre. ------------------
part('hero.torso', [4, 4, 4], [2, 0, 1.5], (g) => {
  g.box(0, 0, 0, 3, 0, 2, 'wood');       // belt
  g.set(2, 0, 2, 'gold');                // buckle, a touch off centre
  g.set(0, 0, 1, 'dirt');                // pouch on the hip
  g.box(0, 1, 0, 3, 2, 2, 'mist');       // tunic
  g.box(1, 1, 2, 2, 2, 2, 'fog');        // tunic front panel
  g.set(1, 1, 2, 'frost');               // a lit crease
  g.box(0, 3, 0, 3, 3, 3, 'red');        // scarf wrap, folds over the chest
  g.set(0, 3, 3, 'blood'); g.set(3, 3, 3, 'blood');
  g.box(1, 3, 0, 2, 3, 0, 'blood');      // knot at the back (the tail starts here)
});

// ---- hood: a rounded cowl with a recessed face. Pivot at the neck (bottom centre). -------
// Face variants swap the whole head geometry: open, blink, hurt, dead.
const FACES = {
  open: [[2, 1, 'sky'], [4, 1, 'sky']],
  blink: [[2, 0, 'slate'], [4, 0, 'slate']],
  hurt: [[1, 1, 'white'], [2, 1, 'white'], [4, 1, 'white'], [5, 1, 'white']],
  dead: [[2, 0, 'slate'], [4, 0, 'slate']],
};
for (const [face, eyes] of Object.entries(FACES)) {
  part(`hero.head.${face}`, [7, 4, 5], [3.5, 0, 2.5], (g) => {
    g.box(0, 0, 0, 6, 2, 4, 'blue');
    g.box(1, 3, 0, 5, 3, 3, 'blue');
    // round the vertical corners
    for (const [x, z] of [[0, 0], [6, 0], [0, 4], [6, 4]]) g.box(x, 1, z, x, 2, z, null);
    g.set(0, 0, 0, null); g.set(6, 0, 0, null);
    g.set(1, 3, 0, null); g.set(5, 3, 0, null);
    g.set(3, 3, 1, 'fog');               // crown catches the light
    // hem: darker bottom edge where the hood drapes onto the scarf
    g.box(1, 0, 0, 5, 0, 0, 'navy');
    // face: the shadowed face, flush (a recess hides the eyes at the camera's 50 deg pitch)
    g.box(1, 0, 4, 5, 1, 4, 'ink');
    g.box(1, 2, 4, 5, 2, 4, 'navy');     // brim over the face
    g.set(0, 0, 4, 'navy'); g.set(6, 0, 4, 'navy');
    for (const [x, y, c] of eyes) g.set(x, y, 4, c, c !== 'slate');
  });
}

// ---- hood tip: droops back from the crown. Pivot at its base. ----------------------------
part('hero.hoodTip', [3, 2, 3], [1.5, 0, 2.5], (g) => {
  g.box(0, 0, 1, 2, 0, 2, 'blue');
  g.box(1, 0, 0, 1, 1, 1, 'blue');
  g.set(1, 1, 0, 'navy');
});

// ---- arms: sleeve and glove. Pivot at the shoulder (top centre). -------------------------
for (const side of ['L', 'R']) {
  part(`hero.arm${side}`, [1, 3, 1], [0.5, 3, 0.5], (g) => {
    g.set(0, 0, 0, 'dirt');
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

// ---- cloak: upper and lower panel, hinged at the top edge of each. -----------------------
part('hero.cloakU', [5, 3, 1], [2.5, 3, 1], (g) => {
  g.box(0, 0, 0, 4, 2, 0, 'navy');
  g.box(1, 2, 0, 3, 2, 0, 'blue');      // collar, where it meets the hood
});
part('hero.cloakL', [5, 2, 1], [2.5, 2, 1], (g) => {
  g.box(0, 1, 0, 4, 1, 0, 'navy');
  g.box(0, 0, 0, 4, 0, 0, 'violet');
  g.set(1, 0, 0, null); g.set(4, 0, 0, null); // tattered hem
});

// ---- scarf tail: segments laid along +z from their pivot, oriented by the anim -----------
part('hero.scarf', [1, 1, 2], [0.5, 0.5, 0], (g) => { g.box(0, 0, 0, 0, 0, 1, 'red'); });
part('hero.scarfEnd', [2, 1, 2], [1, 0.5, 0], (g) => {
  g.set(0, 0, 0, 'red'); g.set(1, 0, 0, 'red');
  g.set(0, 0, 1, 'blood'); // frayed end: one strand longer than the other
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
  const head = mesh('hero.head.open', torso, 0, 4 * V, 0);
  const hoodTip = mesh('hero.hoodTip', head, 0, 4 * V, -1 * V);
  const armL = mesh('hero.armL', torso, -2.5 * V, 3.4 * V, 0);
  const armR = mesh('hero.armR', torso, 2.5 * V, 3.4 * V, 0);
  const sword = mesh('hero.sword', armR, 0, -2.5 * V, 0);
  const cloakU = mesh('hero.cloakU', torso, 0, 3.6 * V, -1.5 * V);
  const cloakL = mesh('hero.cloakL', cloakU, 0, -3 * V, 0);
  const scarfAnchor = new THREE.Object3D();
  scarfAnchor.position.set(0, 3.5 * V, -2.7 * V);
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
  const parts = [legL, legR, torso, head, hoodTip, armL, armR, sword, cloakU, cloakL];
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
    group, root, body, pelvis, torso, head, hoodTip, armL, armR, sword, cloakU, cloakL, legL, legR,
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
    /** Show smear frame f (0..SMEAR_FRAMES-1) of kind 'h' or 'v', or hide it (f < 0). */
    setSmear(kind, f) {
      if (f < 0 || f >= SMEAR_FRAMES) { smear.visible = false; return; }
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

export const HERO_HEIGHT = 11 * V; // top of the hood, world units (for health bars, labels)
