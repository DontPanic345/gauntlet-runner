// Enemy tuning (piece `enemies`). Every difficulty knob is data here, not code: the AI in
// the archetype files reads these rows every tick, so editing a value live (debug.enemies
// ('tune', ...)) or from a later piece (arenas scaling waves, boons, run-flow difficulty)
// changes behaviour at once.
//
//   import { ENEMY_DATA, DIFFICULTY, stat } from './enemies/data.js';
//   DIFFICULTY.hp = 1.3;            // every enemy spawned from now on has 30% more hp
//   DIFFICULTY.aggression = 1.5;    // shorter cooldowns, more enemies attack at once
//   ENEMY_DATA.husk.speed = 1.6;    // one archetype
//
// Units: world units (1 = 8 voxels, the hero is ~1.4 tall), seconds-free: times are sim
// ticks at 60 Hz. Damage to the hero is in hero hp points (the hero has 5).
//
// Global knobs (DIFFICULTY), multiplied into every archetype:
//   hp          enemy hit points
//   speed       movement speed (walk, kite, charge, hop)
//   aggression  divides attack cooldowns; raises how many melee enemies may attack at once
//               (attack tokens); a little less hesitation before committing. Never shortens
//               a telegraph: windups are readability, not difficulty.
//   damage      multiplies hero damage (rounded, at least 1)

export const DIFFICULTY = { hp: 1, speed: 1, aggression: 1, damage: 1 };

/** Melee attack tokens available at aggression 1 (see Manager). Mites cost 0.5, the brute 2. */
export const TOKENS = { base: 3, perAggression: 1 };

export const ENEMY_DATA = {
  husk: {
    name: 'HUSK', blurb: 'SHAMBLING CHASER', color: 'leaf',
    hp: 30, speed: 1.3, accel: 0.12, radius: 0.34, height: 1.5, weight: 1, aggression: 1,
    standoff: 1.05,          // where it stops to swing, from the hero's centre
    attack: { range: 1.45, reach: 1.35, arc: 58, windup: 30, active: 5, recover: 40, cooldown: [45, 95], lunge: 3.2, dmg: 1 },
    hurt: 14,                // hit-stun ticks (interrupts a windup)
    poise: 0,                // damage it can take in 1 s before a hit staggers it (0: every hit does)
    token: 1,
    debris: ['leaf', 'moss', 'bone', 'dirt'],
  },
  wisp: {
    name: 'EMBER WISP', blurb: 'RANGED, KITES', color: 'flame',
    hp: 22, speed: 2.1, accel: 0.08, radius: 0.3, height: 1.35, weight: 0.7, aggression: 1,
    keep: [3.4, 5.4],        // it tries to stay between these distances from the hero
    float: 0.55,             // hover height of the core
    attack: { range: 7.5, windup: 42, recover: 26, cooldown: [80, 140], dmg: 1,
      orbs: 1, spread: 0.32, orbSpeed: 3.1, orbLife: 190, orbRadius: 0.2 },
    hurt: 12, poise: 0, token: 0,
    debris: ['stoneDark', 'ember', 'flame', 'stone'],
  },
  brute: {
    name: 'BRUTE', blurb: 'CHARGES, STUNS ITSELF ON WALLS', color: 'plum',
    hp: 160, speed: 1.0, accel: 0.06, radius: 0.58, height: 1.95, weight: 3.2, aggression: 1,
    standoff: 1.5,
    charge: { min: 2.6, max: 8, windup: 50, speed: 10.5, width: 1.3, stun: 110, skid: 16, recover: 44, cooldown: [60, 110], dmg: 2, knock: 11 },
    slam: { range: 1.9, radius: 1.25, ahead: 0.95, windup: 34, active: 4, recover: 46, cooldown: [40, 80], dmg: 1 },
    hurt: 18, poise: 50, token: 2,
    debris: ['plum', 'slate', 'rose', 'bone'],
  },
  mite: {
    name: 'MITE', blurb: 'TINY, FAST, FIVE AT ONCE', color: 'cyan',
    hp: 8, speed: 3.4, accel: 0.25, radius: 0.26, height: 0.45, weight: 0.35, aggression: 1,
    group: 5,                // how many a 'mites' spawn makes
    standoff: 1.85,          // they circle the hero at this distance, just outside sword reach
    orbit: 0.014,            // how far ahead round the ring each mite aims (x25 rad): the ring's turn speed
    attack: { range: 2.0, hop: 1.75, radius: 0.34, windup: 16, active: 11, recover: 40, cooldown: [40, 110], dmg: 1 },
    hurt: 8, poise: 0, token: 0.5,
    debris: ['teal', 'cyan', 'navy'],
  },
};

export const TYPES = Object.keys(ENEMY_DATA);

/** Effective value: an archetype stat with the global knobs applied. */
export function stat(type, key) {
  const d = ENEMY_DATA[type];
  const v = d[key];
  if (key === 'hp') return Math.max(1, Math.round(v * DIFFICULTY.hp));
  if (key === 'speed') return v * DIFFICULTY.speed;
  return v;
}

/** Aggression of one archetype after the global knob. */
export const aggro = (type) => (ENEMY_DATA[type].aggression ?? 1) * DIFFICULTY.aggression;

/** A cooldown drawn from [min, max] ticks, shortened by aggression. r in 0..1. */
export function cooldown(type, range, r) {
  return Math.round((range[0] + (range[1] - range[0]) * r) / Math.max(0.2, aggro(type)));
}

/** Hero damage after the global knob. */
export const dmg = (n) => Math.max(1, Math.round(n * DIFFICULTY.damage));
