// Shared, serialisable view of the game for window.__GR.state() and cross-piece queries.
// Pieces own their real objects; they keep these fields pointing at them:
//
//   world.hero    = heroObject            // must expose x, z, hp, maxHp (read live by state())
//   world.enemies = arrayOfLiveEnemies    // each exposes id?, type, x, z, hp
//   world.room    = { index, kind: 'arena'|'corridor'|'boss', ... } | null
//   world.boons   = ['ember-trail', ...]  // boon ids held
//
// Foundation resets it on every scene change into title/run/boss/showcase.

export const world = {
  hero: null,
  enemies: [],
  room: null,
  boons: [],
  god: false,
  reset() {
    this.hero = null;
    this.enemies = [];
    this.room = null;
    this.boons = [];
  },
};
