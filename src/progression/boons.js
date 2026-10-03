// Boons (piece `boons`): the data. Sixteen boons in four rarity tiers, their stacking rules,
// the synergies between pairs, and the run's progression state (boons held, soul shards).
//
//   import { BOONS, RARITY, SYNERGIES, progress, rollChoice, giveBoon } from './progression/boons.js';
//
// Every boon changes something you can SEE in combat. What each one does, and how, lives in
// effects.js (the runtime); this file only says what they are, so cards, the HUD, debug hooks
// and the effects all read one table.
//
// Card text markup: [word] is drawn in the boon's highlight colour.
//
// The run state (`progress`) is module-level, so it survives scene changes inside one run
// (arena -> corridor -> arena). It resets when the title, game over or victory scene is
// entered, or with resetProgress().

import { rng } from '../core/rng.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';

/** Rarity tiers: weight in a roll, card frame colours, label. */
export const RARITY = {
  common: { label: 'COMMON', weight: 60, frame: 'fog', edge: 'slate', glow: 'frost', text: 'frost', gem: 'fog', order: 0 },
  rare: { label: 'RARE', weight: 28, frame: 'cyan', edge: 'teal', glow: 'sky', text: 'sky', gem: 'cyan', order: 1 },
  epic: { label: 'EPIC', weight: 10, frame: 'rose', edge: 'plum', glow: 'rose', text: 'rose', gem: 'rose', order: 2 },
  legendary: { label: 'LEGENDARY', weight: 3, frame: 'gold', edge: 'flame', glow: 'torch', text: 'gold', gem: 'gold', order: 3 },
};

/**
 * The boons. max: how many times it stacks. lv(n) returns the numbers at stack n (1-based),
 * used both by the effects and by the card text, so a card never lies about a number.
 * text(n, s): the card description for stack n (s = lv(n)).
 */
export const BOONS = {
  // ---- common ----------------------------------------------------------------------------
  'keen-edge': {
    name: 'KEEN EDGE', rarity: 'common', max: 3, color: 'gold',
    lv: (n) => ({ chance: [0, 0.2, 0.3, 0.4][n] }),
    text: (n, s) => `Hits have a [${Math.round(s.chance * 100)}%] chance to [CRIT] for double damage in a burst of gold.`,
  },
  'fleet-foot': {
    name: 'FLEET FOOT', rarity: 'common', max: 2, color: 'sky',
    lv: (n) => ({ speed: [0, 0.12, 0.22][n], cool: [0, 0.3, 0.5][n] }),
    text: (n, s) => `Run [${Math.round(s.speed * 100)}%] faster, dash again [${Math.round(s.cool * 100)}%] sooner. Wind peels off you.`,
  },
  'soul-hunger': {
    name: 'SOUL HUNGER', rarity: 'common', max: 2, color: 'sky',
    lv: (n) => ({ extra: [0, 2, 4][n], magnet: [1, 1.7, 2.3][n] }),
    text: (n, s) => `Foes spill [+${s.extra}] soul shards. Shards fly to you from [${s.magnet.toFixed(1)}x] as far.`,
  },
  'bulwark': {
    name: 'BULWARK', rarity: 'common', max: 2, color: 'frost',
    lv: (n) => ({ regrow: [0, 600, 360][n] }),
    text: (n, s) => `A ward of runes circles you and [blocks one hit], then shatters. It regrows in [${s.regrow / 60}s].`,
  },
  'kindling': {
    name: 'KINDLING', rarity: 'common', max: 3, color: 'flame',
    lv: (n) => ({ dmg: [0, 2, 3, 4][n], dur: 180 }),
    text: (n, s) => `Hits [ignite] foes. They burn for [${s.dmg}] every half second for 3s.`,
  },
  'heavy-hand': {
    name: 'HEAVY HAND', rarity: 'common', max: 2, color: 'bone',
    lv: (n) => ({ knock: [1, 1.5, 1.9][n], quake: [0, 8, 13][n], r: [0, 1.7, 2.1][n] }),
    text: (n, s) => `Hits knock foes [${s.knock}x] as far. The finisher's slam sends a [quake] for [${s.quake}].`,
  },
  // ---- rare ------------------------------------------------------------------------------
  'chain-spark': {
    name: 'CHAIN SPARK', rarity: 'rare', max: 3, color: 'sky',
    lv: (n) => ({ jumps: n, dmg: 5, range: 3.4 }),
    text: (n, s) => `Every hit arcs [lightning] to [${s.jumps}] more ${s.jumps > 1 ? 'foes' : 'foe'} nearby for [${s.dmg}].`,
  },
  'ember-trail': {
    name: 'EMBER TRAIL', rarity: 'rare', max: 2, color: 'flame',
    lv: (n) => ({ life: [0, 150, 240][n], dmg: 3 }),
    text: (n, s) => `Your dash leaves a line of [burning embers] for [${(s.life / 60).toFixed(1)}s]. Foes in it take [${s.dmg}].`,
  },
  'leech': {
    name: 'LEECH', rarity: 'rare', max: 2, color: 'red',
    lv: (n) => ({ motes: 3, per: [0, 6, 4][n] }),
    text: (n, s) => `Kills bleed [blood motes] that fly to you. Every [${s.per}] motes heal [1 heart].`,
  },
  'storm-dash': {
    name: 'STORM DASH', rarity: 'rare', max: 2, color: 'sky',
    lv: (n) => ({ dmg: [0, 8, 12][n], r: [0, 2.6, 3.1][n], n: 3 }),
    text: (n, s) => `Where your dash ends, [thunder] breaks: bolts strike up to [3] foes for [${s.dmg}].`,
  },
  'echo-blade': {
    name: 'ECHO BLADE', rarity: 'rare', max: 2, color: 'cyan',
    lv: (n) => ({ pct: [0, 0.5, 0.8][n], delay: 9 }),
    text: (n, s) => `A [ghost of you] repeats every swing a beat later for [${Math.round(s.pct * 100)}%] damage.`,
  },
  // ---- epic ------------------------------------------------------------------------------
  'moon-wave': {
    name: 'MOON WAVE', rarity: 'epic', max: 2, color: 'sky',
    lv: (n) => ({ dmg: [0, 14, 22][n], range: [0, 6, 8][n] }),
    text: (n, s) => `Your [third hit] hurls a crescent of light that pierces everything for [${s.dmg}].`,
  },
  'ember-orbit': {
    name: 'EMBER ORBIT', rarity: 'epic', max: 3, color: 'flame',
    lv: (n) => ({ orbs: n + 1, dmg: 4 }),
    text: (n, s) => `[${s.orbs}] embers circle you, scorching foes they touch for [${s.dmg}].`,
  },
  'reaper': {
    name: 'REAPER', rarity: 'epic', max: 1, color: 'rose',
    lv: () => ({ under: 0.35 }),
    text: () => `Foes under [35%] health are [marked]. Your next hit on a marked foe [reaps] it.`,
  },
  // ---- legendary -------------------------------------------------------------------------
  'starfall': {
    name: 'STARFALL', rarity: 'legendary', max: 1, color: 'gold',
    lv: () => ({ every: 6, dmg: 22, r: 1.7 }),
    text: () => `Every [6th hit] calls a [falling star] down on the nearest foe. It bursts for [22].`,
  },
  'phoenix': {
    name: 'PHOENIX', rarity: 'legendary', max: 1, color: 'flame',
    lv: () => ({ hp: 3 }),
    text: () => `Once per run, a killing blow [rekindles] you at [3 hearts] in a nova of fire.`,
  },
};

export const BOON_IDS = Object.keys(BOONS);

/**
 * Synergies: a pair of boons that, held together, does something new you can see. The card
 * of either boon names the pair, and the HUD links them.
 */
export const SYNERGIES = [
  { id: 'thunderhead', name: 'THUNDERHEAD', a: 'chain-spark', b: 'storm-dash', text: 'Dash thunder chains onward and strikes wider.' },
  { id: 'wildfire', name: 'WILDFIRE', a: 'kindling', b: 'ember-trail', text: 'Burning foes explode in fire when they die.' },
  { id: 'twin-moons', name: 'TWIN MOONS', a: 'moon-wave', b: 'echo-blade', text: 'Your ghost hurls a second moon wave.' },
  { id: 'harvest', name: 'HARVEST', a: 'leech', b: 'reaper', text: 'Every reap heals a heart outright.' },
  { id: 'lightning-rod', name: 'LIGHTNING ROD', a: 'keen-edge', b: 'chain-spark', text: 'Arcs can crit, and a crit forks gold lightning to every foe in reach.' },
  { id: 'solar-flare', name: 'SOLAR FLARE', a: 'ember-orbit', b: 'kindling', text: 'Orbiting embers ignite what they touch.' },
];

// ---- the run's state -------------------------------------------------------------------------

export const progress = {
  held: new Map(),      // id -> stacks
  order: [],            // ids in the order they were taken (HUD order)
  shards: 0,
  shardsTotal: 0,
  hearts: 0,            // hearts collected this run
  picks: 0,             // choices made (feeds the roll seed)
  spent: new Set(),     // one-shot boons that have fired (phoenix)
  seen: new Set(),      // synergy ids already announced
};

export function resetProgress() {
  progress.held.clear();
  progress.order.length = 0;
  progress.shards = 0; progress.shardsTotal = 0; progress.hearts = 0; progress.picks = 0;
  progress.spent.clear(); progress.seen.clear();
  syncWorld();
}

export const stacks = (id) => progress.held.get(id) ?? 0;
export const has = (id) => stacks(id) > 0;
export const level = (id) => BOONS[id].lv(Math.max(1, stacks(id)));

export function syncWorld() {
  world.boons = progress.order.flatMap((id) => Array(progress.held.get(id)).fill(id));
}

/** Add one stack of a boon. Returns { ok, id, stacks } or { ok: false, error }. */
export function giveBoon(id, { quiet = false } = {}) {
  const b = BOONS[id];
  if (!b) return { ok: false, error: `no boon "${id}"`, boons: BOON_IDS };
  const n = stacks(id);
  if (n >= b.max) return { ok: false, error: `${id} is already at its max (${b.max})`, stacks: n };
  progress.held.set(id, n + 1);
  if (!n) progress.order.push(id);
  syncWorld();
  const syn = activeSynergies().filter((s) => (s.a === id || s.b === id) && !progress.seen.has(s.id));
  for (const s of syn) progress.seen.add(s.id);
  events.emit('boon:gain', { id, stacks: n + 1, quiet, synergies: syn });
  return { ok: true, id, stacks: n + 1, synergies: syn.map((s) => s.id) };
}

export function takeBoon(id) {
  if (!has(id)) return false;
  progress.held.delete(id);
  progress.order.splice(progress.order.indexOf(id), 1);
  syncWorld();
  return true;
}

export function activeSynergies() { return SYNERGIES.filter((s) => has(s.a) && has(s.b)); }
export const synergyActive = (sid) => { const s = SYNERGIES.find((q) => q.id === sid); return !!s && has(s.a) && has(s.b); };
/** Synergies a boon belongs to, each with its partner id. */
export function synergiesOf(id) {
  return SYNERGIES.filter((s) => s.a === id || s.b === id).map((s) => ({ ...s, partner: s.a === id ? s.b : s.a }));
}

/**
 * Roll a choice of `n` distinct boons that can still stack. Weighted by rarity; boons that
 * would complete a synergy with something held get a nudge, so pairs actually show up.
 * Deterministic for (run seed, picks so far, salt).
 */
export function rollChoice(n = 3, { salt = 0, exclude = [] } = {}) {
  const r = rng.fork(`boons/${progress.picks}/${salt}`);
  const pool = BOON_IDS.filter((id) => stacks(id) < BOONS[id].max && !exclude.includes(id));
  const out = [];
  while (out.length < n && pool.length) {
    const items = pool.map((id) => {
      let w = RARITY[BOONS[id].rarity].weight;
      if (synergiesOf(id).some((s) => has(s.partner))) w *= 2.2;
      if (has(id)) w *= 0.8;            // upgrades show up, but new things a bit more
      return [id, w];
    });
    const id = r.weighted(items);
    out.push(id);
    pool.splice(pool.indexOf(id), 1);
  }
  return out;
}
