// Enemy material (piece `enemies`): the shared voxel material, plus a per-enemy "self light"
// so a body never sinks into the floor's value range in a dark room.
//
// Readability first (GAME.md): the crypt is lit by a few warm pools, and away from them a
// lit voxel falls one or two palette steps darker, onto the floor's own colours. Each enemy's
// material therefore has a floor under its lighting: a voxel is never darker than
//   palette colour x AO x selfLit x face
// where `face` is a fixed toon ramp (top faces 1.0, faces turned to the camera and to the
// upper-left key a little less, the rest darker). Lit by a torch it still gets brighter; in
// the dark it stays on its own colours instead of the floor's. The ramp is flat per face and
// AO keeps its dithered bands, so nothing becomes a smooth gradient.
//
//   import { makeEnemyMaterial, enemyLook } from './material.js';
//   const m = makeEnemyMaterial();            // same flash API as makeVoxelMaterial()
//   enemyLook.selfLit.value = 0.85;           // live, every enemy (debug.enemies('lit', v))

// The shader patch itself moved to the shared voxel material (makeSelfLitMaterial) at wave 2
// integration, so the hero uses the same floor and never reads darker than the enemies.
import { makeSelfLitMaterial } from '../render/voxel/index.js';

export const enemyLook = {
  selfLit: { value: 0.9 },     // 0 = plain scene lighting
};

export function makeEnemyMaterial() {
  return makeSelfLitMaterial(enemyLook.selfLit);
}
