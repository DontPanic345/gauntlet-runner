// Boon data (piece `boons`): the 16 boons, rarity tiers, stacking rules, synergies, and the
// offer roll for the pick-1-of-3 shrine. Pure data and small functions, no scene state.
//
//   import { BOONS, RARITY, boonInfo, rollOffers, synergiesFor } from './progression/boons.js';
//
// A boon has up to `max` stacks. Card text comes from desc(level); numbers live in `val`
// so the runtime (effects.js) and the card read the same table.

export const RARITY = {
  common: { name: 'COMMON', weight: 60, edge: 'fog', edgeDark: 'slate', hi: 'frost', panel: 'dusk', glow: 'frost' },
  rare: { name: 'RARE', weight: 30, edge: 'cyan', edgeDark: 'blue', hi: 'sky', panel: 'navy', glow: 'sky' },
  epic: { name: 'EPIC', weight: 10, edge: 'gold', edgeDark: 'plum', hi: 'torch', panel: 'plum', glow: 'gold' },
};

const lv = (arr) => (n) => arr[Math.min(arr.length, Math.max(1, n)) - 1];

export const BOONS = {
  'chain-spark': {
    name: 'CHAIN SPARK', rarity: 'common', max: 3,
    val: { targets: lv([1, 2, 3]), dmg: lv([5, 7, 9]), range: 2.9 },
    desc: (n) => `HITS ARC LIGHTNING TO ${[1, 2, 3][n - 1]} NEARBY FO${n === 1 ? 'E' : 'ES'}, ${[5, 7, 9][n - 1]} DAMAGE EACH.`,
  },
  'gale-boots': {
    name: 'GALE BOOTS', rarity: 'common', max: 3,
    val: { speed: lv([0.12, 0.24, 0.36]) },
    desc: (n) => `+${12 * n}% MOVE SPEED. WIND STREAKS TRAIL YOUR STRIDE.`,
  },
  'searing-brand': {
    name: 'SEARING BRAND', rarity: 'common', max: 3,
    val: { dmg: lv([2, 3, 4]), ticks: lv([160, 200, 240]) },
    desc: (n) => `HITS SET FOES ALIGHT: ${[2, 3, 4][n - 1]} DAMAGE EVERY 1/3 S FOR ${[2.7, 3.3, 4][n - 1]} S.`,
  },
  lodestone: {
    name: 'SOUL LODESTONE', rarity: 'common', max: 3,
    val: { radius: lv([3.4, 4.6, 6]), bonus: lv([1, 1, 2]) },
    desc: (n) => `SHARDS AND HEARTS FLY TO YOU FROM ${['FAR', 'FARTHER', 'ACROSS THE ROOM'][n - 1]}. KILLS DROP +${[1, 1, 2][n - 1]} SHARD.`,
  },
  bloodrush: {
    name: 'BLOODRUSH', rarity: 'common', max: 3,
    val: { speed: lv([0.25, 0.3, 0.35]), ticks: lv([120, 160, 200]) },
    desc: (n) => `EACH KILL GRANTS +${[25, 30, 35][n - 1]}% SPEED FOR ${[2, 2.7, 3.3][n - 1]} S, IN A RED STREAK.`,
  },
  'ember-trail': {
    name: 'EMBER TRAIL', rarity: 'rare', max: 3,
    val: { dmg: lv([3, 4, 6]), life: lv([150, 210, 270]), r: lv([0.5, 0.6, 0.75]) },
    desc: (n) => `DASH LEAVES FLAMES FOR ${[2.5, 3.5, 4.5][n - 1]} S THAT SCORCH FOES FOR ${[3, 4, 6][n - 1]} A PULSE.`,
  },
  'third-wave': {
    name: 'THIRD WAVE', rarity: 'rare', max: 3,
    val: { dmg: lv([9, 13, 18]), reach: lv([4.5, 5.5, 6.5]) },
    desc: (n) => `THE 3RD HIT LAUNCHES A SHOCKWAVE ${[4.5, 5.5, 6.5][n - 1]} UNITS LONG FOR ${[9, 13, 18][n - 1]} DAMAGE.`,
  },
  'ghost-dash': {
    name: 'GHOST DASH', rarity: 'rare', max: 3,
    val: { dmg: lv([7, 11, 15]), cd: lv([0.75, 0.6, 0.5]), iframes: lv([2, 4, 6]) },
    desc: (n) => `DASH SLICES THROUGH FOES FOR ${[7, 11, 15][n - 1]} DAMAGE, LEAVING AFTERIMAGES. COOLDOWN -${[25, 40, 50][n - 1]}%.`,
  },
  'life-motes': {
    name: 'LIFE MOTES', rarity: 'rare', max: 3,
    val: { need: lv([6, 5, 4]) },
    desc: (n) => `KILLS AND FINISHERS SHED RED MOTES. ${[6, 5, 4][n - 1]} MOTES MEND A HEART.`,
  },
  retribution: {
    name: 'RETRIBUTION', rarity: 'rare', max: 3,
    val: { dmg: lv([12, 18, 26]), r: lv([2.5, 2.9, 3.3]) },
    desc: (n) => `WHEN HURT, A NOVA BLASTS NEARBY FOES AWAY FOR ${[12, 18, 26][n - 1]} DAMAGE.`,
  },
  aegis: {
    name: 'AEGIS', rarity: 'rare', max: 3,
    val: { recharge: lv([840, 660, 480]) },
    desc: (n) => `A RING OF SHARDS BLOCKS ONE HIT, THEN RECHARGES IN ${[14, 11, 8][n - 1]} S.`,
  },
  headsman: {
    name: 'HEADSMAN', rarity: 'rare', max: 3,
    val: { mul: lv([1.5, 2, 2.5]) },
    desc: (n) => `THE OVERHEAD FINISHER DEALS ${[150, 200, 250][n - 1]}% DAMAGE AND LANDS WITH A GOLDEN CRIT.`,
  },
  'storm-call': {
    name: 'STORM CALL', rarity: 'epic', max: 3,
    val: { every: lv([5, 4, 3]), dmg: lv([16, 22, 30]) },
    desc: (n) => `EVERY ${[5, 4, 3][n - 1]}TH HIT CALLS DOWN LIGHTNING ON A FOE FOR ${[16, 22, 30][n - 1]} DAMAGE.`,
  },
  'volatile-soul': {
    name: 'VOLATILE SOUL', rarity: 'epic', max: 3,
    val: { dmg: lv([12, 18, 26]), r: lv([1.6, 1.9, 2.2]) },
    desc: (n) => `FOES EXPLODE WHEN THEY DIE: ${[12, 18, 26][n - 1]} DAMAGE IN A BLAST THAT CAN CHAIN.`,
  },
  'orbit-blades': {
    name: 'ORBIT BLADES', rarity: 'epic', max: 2,
    val: { count: lv([2, 4]), dmg: lv([6, 8]) },
    desc: (n) => `${[2, 4][n - 1]} SPECTRAL BLADES CIRCLE YOU, CUTTING FOES FOR ${[6, 8][n - 1]} DAMAGE.`,
  },
  'phoenix-spark': {
    name: 'PHOENIX SPARK', rarity: 'epic', max: 2,
    val: { charges: lv([1, 2]), dmg: lv([24, 34]) },
    desc: (n) => `A KILLING BLOW IS SURVIVED AT 1 HEART IN A BURST OF FLAME. ${n} CHARGE${n > 1 ? 'S' : ''}, REFILLED EACH ARENA.`,
  },
};

export const IDS = Object.keys(BOONS);
for (const id of IDS) BOONS[id].id = id;

/** Pairs that do something extra when both are held. `name` shows on the card and the strip. */
export const SYNERGIES = [
  { a: 'chain-spark', b: 'searing-brand', name: 'WILDFIRE', text: 'ARCS IGNITE EVERY FOE THEY TOUCH.' },
  { a: 'ember-trail', b: 'ghost-dash', name: 'FIRE WRAITH', text: 'DASH CUTS IGNITE, AFTERIMAGES BURN.' },
  { a: 'volatile-soul', b: 'searing-brand', name: 'PYRE', text: 'BURNING FOES DIE IN BIGGER BLASTS.' },
  { a: 'third-wave', b: 'storm-call', name: 'THUNDER WAVE', text: 'THE WAVE CALLS A BOLT ON EACH FOE.' },
  { a: 'life-motes', b: 'orbit-blades', name: 'BLOODBLADES', text: 'BLADE HITS SHED LIFE MOTES.' },
  { a: 'aegis', b: 'retribution', name: 'SHATTER', text: 'A BROKEN SHIELD DETONATES A NOVA.' },
  { a: 'gale-boots', b: 'bloodrush', name: 'STORMRUNNER', text: 'BLOODRUSH HASTE IS DOUBLED.' },
];

export const boonInfo = (id) => BOONS[id] ?? null;

/** Synergies a boon takes part in. `held` is a Map or Set-like of ids (has(id)) or an array. */
export function synergiesFor(id, held) {
  const has = (k) => (Array.isArray(held) ? held.includes(k) : held?.has?.(k));
  const out = [];
  for (const s of SYNERGIES) {
    if (s.a !== id && s.b !== id) continue;
    const other = s.a === id ? s.b : s.a;
    out.push({ ...s, other, active: !!has(other) });
  }
  return out;
}

/** Synergies currently active for a held set. */
export function activeSynergies(held) {
  const has = (k) => (Array.isArray(held) ? held.includes(k) : held?.has?.(k));
  return SYNERGIES.filter((s) => has(s.a) && has(s.b));
}

/**
 * Roll `n` distinct offers for the shrine. Rules:
 *  - a boon at max stacks is never offered;
 *  - weights are the rarity weights; a boon that completes a synergy with something held
 *    weighs 2.2x, an upgrade of a held boon 0.8x (so a fresh pick is a bit more likely);
 *  - at least one offer is never a duplicate of a held boon when a fresh one exists;
 *  - `luck` (0..1) shifts weight from common toward rare and epic.
 * Returns [{ id, level }] where level is the level the boon will have after the pick.
 */
export function rollOffers(rng, held = new Map(), n = 3, { luck = 0, exclude = [] } = {}) {
  const stacks = (id) => (held instanceof Map ? held.get(id) ?? 0 : held.includes?.(id) ? 1 : 0);
  const heldIds = held instanceof Map ? [...held.keys()] : [...held];
  const pool = IDS.filter((id) => stacks(id) < BOONS[id].max && !exclude.includes(id));
  const w = (id) => {
    const b = BOONS[id];
    let x = RARITY[b.rarity].weight * (b.rarity === 'common' ? 1 - luck * 0.5 : 1 + luck * 1.5);
    if (synergiesFor(id, heldIds).some((s) => s.active)) x *= 2.2;
    if (stacks(id) > 0) x *= 0.8;
    return x;
  };
  const out = [];
  const avail = pool.slice();
  while (out.length < n && avail.length) {
    const pick = rng.weighted(avail.map((id) => [id, w(id)]));
    avail.splice(avail.indexOf(pick), 1);
    out.push({ id: pick, level: stacks(pick) + 1 });
  }
  if (out.length === n && out.every((o) => o.level > 1)) {
    const fresh = avail.filter((id) => stacks(id) === 0);
    if (fresh.length) out[n - 1] = { id: rng.pick(fresh), level: 1 };
  }
  return out;
}
