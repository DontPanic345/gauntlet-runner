// Boss: The Warden (piece `boss`). See hurdles/waves/w1/build/boss.md.
//   import { createBossScene, BossFight, Warden, TUNE } from './boss/index.js';
//   scenes.define('boss', createBossScene({ intro: true }));
export { createBossScene } from './scene.js';
export { BossFight, INTRO_TICKS } from './fight.js';
export { Warden, TUNE } from './warden.js';
export { BossArena, ARENA_R } from './arena.js';
export { bossSfx } from './sfx.js';
