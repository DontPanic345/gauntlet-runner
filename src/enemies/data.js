// Enemy tuning as data (piece `enemies`). Difficulty is changed here, or live through
// `knobs`, and never in the AI code. Times are in sim ticks (60 per second), speeds in
// world units per second, distances in world units (8 voxels = 1 unit).
//
//   hp, speed          base health and walking speed
//   r, h, weight       body radius, height, knockback resistance (Hurtable)
//   dmg                hearts taken from the hero on a hit
//   windup, strike, recover, cooldown   the attack phases, in ticks
//   cat                which attack token pool it draws from (see ATTACK_SLOTS)
//
// `knobs` scales everything at once: hp, speed, aggression (shorter cooldowns, faster
// orbs). Telegraph lengths are NOT scaled by aggression: a hit must stay readable.

export const ENEMIES = {
  husk: {
    name: 'HUSK', role: 'SHAMBLING CHASER', tell: 'ARMS RAISE, RED ARC FILLS',
    scale: 0.92, hp: 30, speed: 1.55, turn: 0.075, r: 0.3, h: 1.4, weight: 1, dmg: 1, cat: 'melee',
    reach: 1.12, arc: 68, windup: 30, strike: 8, recover: 36, cooldown: 55, stagger: 16, flank: 0.95,
    palette: ['moss', 'leaf', 'bone', 'dirt'],
  },
  wisp: {
    name: 'EMBER WISP', role: 'KITES, FIRES SLOW ORBS', tell: 'GLOW SWELLS, AIM DOTS LOCK',
    scale: 0.74, hp: 18, speed: 1.7, turn: 0.12, r: 0.26, h: 1.3, weight: 0.8, dmg: 1, cat: 'ranged',
    keepMin: 2.7, keepMax: 4.4, orbSpeed: 3.3, orbLife: 300, windup: 40, strike: 4, recover: 30, cooldown: 100, stagger: 14,
    palette: ['ember', 'flame', 'gold', 'red'],
  },
  brute: {
    name: 'BRUTE', role: 'CHARGES, STUNS ITSELF ON WALLS', tell: 'ROARS, PAWS, LANE FILLS RED',
    scale: 0.72, hp: 96, speed: 1.05, turn: 0.05, r: 0.5, h: 2.0, weight: 3.2, dmg: 2, cat: 'melee',
    chargeMin: 2.0, chargeMax: 7.5, lane: 7.5, laneW: 0.55, chargeSpeed: 9.2, windup: 58, recover: 55, cooldown: 90, stun: 120, stunBonus: 1.6,
    palette: ['fog', 'mist', 'bone', 'slate'],
  },
  mite: {
    name: 'MITE', role: 'SWARMS IN FIVES', tell: 'SQUATS, RED SPOT MARKS THE LEAP',
    scale: 0.8, hp: 8, speed: 3.3, turn: 0.2, r: 0.17, h: 0.5, weight: 0.6, dmg: 1, cat: 'swarm',
    leap: 1.05, windup: 17, strike: 10, recover: 42, cooldown: 60, stagger: 10,
    palette: ['rose', 'red', 'bone', 'white'],
  },
};

/** How many of each kind of attack may be winding up or striking at once. This is what
 * makes a crowd take turns instead of piling on: the rest circle and wait. */
export const ATTACK_SLOTS = { melee: 2, ranged: 1, swarm: 2 };

/** Global difficulty knobs. hp and speed multiply the table; aggression shortens cooldowns
 * (and speeds up orbs) and adds attack slots at 1.5 and above. */
export const knobs = { hp: 1, speed: 1, aggression: 1 };

export function setKnobs(o = {}) {
  for (const k of Object.keys(knobs)) if (Number.isFinite(+o[k]) && +o[k] > 0) knobs[k] = +o[k];
  return { ...knobs };
}
