// Wave plans and the director (piece `arenas`).
//
// A plan is pure data derived from (seed, arena index), so it reproduces exactly: same seed,
// same waves, same enemy types and pads. Escalation across the five arenas of a zone:
//
//   arena 1  husks only, two waves            "learn to hit and dash"
//   arena 2  + mite swarms                    "learn to keep moving"
//   arena 3  + ember wisps, three waves       "learn to mind the far ones"
//   arena 4  + a brute in the last wave       "learn to read a charge"
//   arena 5  four waves, two brutes, wisps    "everything, one after the other"
//
// The director spawns each wave through the enemies API when the last one is cleared (or is
// down to a straggler for long enough), pauses between waves, and reports when the room is done.

import { Rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';

export const COST = { husk: 2, mite: 3, wisp: 3, brute: 5 };
export const TIERS = [
  { waves: [4, 6], types: ['husk'], feature: null },
  { waves: [5, 8], types: ['husk', 'mite'], feature: 'mite' },
  { waves: [6, 8, 10], types: ['husk', 'mite', 'wisp'], feature: 'wisp' },
  { waves: [8, 10, 12], types: ['husk', 'mite', 'wisp', 'brute'], feature: 'brute' },
  { waves: [8, 10, 12, 15], types: ['husk', 'mite', 'wisp', 'brute'], feature: 'brute', finale: true },
];
const WEIGHT = { husk: 5, mite: 3, wisp: 2.2, brute: 1.4 };
const SHORT = { husk: 'H', mite: 'M', wisp: 'W', brute: 'B' };

/**
 * The plan for one arena: { index, waves: [{ n, budget, groups: [{ type, count, pad: [x, z] }] }] }.
 * `pads` are arena-local spawn points (unit coordinates); the caller offsets them to the world.
 */
export function planWaves(seed, index, pads) {
  const tier = TIERS[Math.min(TIERS.length - 1, index)];
  // arenas past the fifth keep the last tier and add budget
  const extra = Math.max(0, index - (TIERS.length - 1)) * 2;
  const rng = new Rng(`arenas/${seed}/${index}/waves`);
  const waves = tier.waves.map((budget0, w) => {
    let budget = budget0 + extra;
    const groups = [];
    const last = w === tier.waves.length - 1;
    const push = (type) => { groups.push({ type, count: type === 'mite' ? 5 : 1 }); budget -= COST[type]; };
    // the feature enemy shows up in the last wave (mites and wisps also in the middle one)
    if (tier.feature && (last || (w === tier.waves.length - 2 && tier.feature !== 'brute'))) push(tier.feature);
    if (tier.finale && last) push('brute');
    let guard = 0;
    while (budget >= 2 && guard++ < 30) {
      const opts = tier.types.filter((t) => COST[t] <= budget && !(t === 'brute' && (!last || groups.filter((g) => g.type === 'brute').length >= (tier.finale ? 2 : 1))));
      if (!opts.length) break;
      push(rng.weighted(opts.map((t) => [t, WEIGHT[t]])));
    }
    // order: melee first (they arrive first), then the far ones
    const order = { husk: 0, mite: 1, brute: 2, wisp: 3 };
    groups.sort((a, b) => order[a.type] - order[b.type]);
    // pads: spread around, wisps and brutes on the far pads, no pad twice while there are pads left
    const free = rng.shuffle(pads.slice());
    const used = [];
    for (const g of groups) {
      if (!free.length) free.push(...rng.shuffle(pads.slice()));
      g.pad = free.shift();
      used.push(g.pad);
    }
    return { n: w + 1, budget: budget0 + extra, groups };
  });
  return { index, seed, tier: Math.min(TIERS.length - 1, index), waves };
}

/** "H H | H H M" style summary of a plan, for the HUD and the debug hook. */
export function describePlan(plan) {
  return plan.waves.map((w) => w.groups.map((g) => (g.type === 'mite' ? 'M5' : SHORT[g.type])).join(' ')).join(' | ');
}

export function planCounts(plan) {
  const c = { husk: 0, mite: 0, wisp: 0, brute: 0 };
  for (const w of plan.waves) for (const g of w.groups) c[g.type] += g.count;
  return c;
}

/**
 * Runs a plan against an enemy system. States: idle, gap (counting down to a wave), fighting, done.
 * host: { padToWorld([x, z]) -> {x, z}, heroPos() -> {x, z} } (the arena provides both).
 */
export class WaveDirector {
  constructor({ sys, plan, host, rng = new Rng('waves') }) {
    this.sys = sys; this.plan = plan; this.host = host; this.rng = rng;
    this.state = 'idle'; this.wave = 0; this.gap = 0; this.age = 0; this.spawned = 0; this.kills = 0; this.total = 0;
    for (const w of plan.waves) for (const g of w.groups) this.total += g.count;
    this.enemies = [];
    this.lastDeath = null;
    this._off = events.on('enemy:die', (e) => { this.kills++; this.lastDeath = { x: e.x, z: e.z }; });
  }

  /** Begin: the first wave comes after `delay` ticks. */
  start(delay = 55) { this.state = 'gap'; this.gap = delay; this.wave = 0; }

  get waves() { return this.plan.waves.length; }
  get alive() { return this.sys.alive().length; }
  get finished() { return this.state === 'done'; }

  spawnWave(w) {
    const wave = this.plan.waves[w];
    const hero = this.host.heroPos();
    let delay = 0;
    this.enemies = [];
    for (const g of wave.groups) {
      const p = this.host.padToWorld(g.pad);
      // if a pad is right on top of the hero, slide it out along the line away from them
      let { x, z } = p;
      const dx = x - hero.x, dz = z - hero.z, d = Math.hypot(dx, dz);
      if (d < 2.2) { const k = (2.2 - d) / (d || 1); x += dx * k; z += dz * k; ({ x, z } = this.host.clampToFloor(x, z)); }
      if (g.type === 'mite') {
        for (let i = 0; i < g.count; i++) {
          const a = (i / g.count) * Math.PI * 2 + 0.6, rr = i === 0 ? 0.15 : 0.55;
          const e = this.sys.spawn('mite', x + Math.sin(a) * rr, z + Math.cos(a) * rr, { delay: delay + i * 3 });
          if (e) this.enemies.push(e);
        }
      } else {
        const e = this.sys.spawn(g.type, x, z, { delay });
        if (e) this.enemies.push(e);
      }
      this.spawned += g.count;
      delay += 14;
      this.host.onSpawn?.(g, x, z);
    }
    this.state = 'fighting'; this.age = 0;
    events.emit('arena:wave', { index: this.plan.index, n: wave.n, total: this.waves, count: this.enemies.length, plan: describePlan({ waves: [wave] }) });
  }

  tick() {
    if (this.state === 'idle' || this.state === 'done') return;
    if (this.state === 'gap') {
      if (--this.gap <= 0) this.spawnWave(this.wave);
      return;
    }
    this.age++;
    const alive = this.alive, last = this.wave >= this.waves - 1;
    const done = alive === 0 && this.age > 20;
    const straggler = !last && alive <= 1 && this.age > 60 * 9;
    if (done || straggler) {
      if (last) { this.state = 'done'; events.emit('arena:wavesDone', { index: this.plan.index, kills: this.kills }); return; }
      this.wave++;
      this.state = 'gap';
      this.gap = straggler ? 22 : 50;
    }
  }

  skipTo(w) { this.wave = Math.max(0, Math.min(this.waves - 1, w)); this.state = 'gap'; this.gap = 1; }
  dispose() { this._off?.(); }
}

debug.add('plan', (seed = 1, index = 0) => {
  const pads = [[-3, 2], [3, 2], [-1, 3], [1, 3], [0, 1]];
  const plan = planWaves(seed, index, pads);
  return { ok: true, seed, index, summary: describePlan(plan), counts: planCounts(plan), plan };
});
