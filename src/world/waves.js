// Waves (piece `arenas`): what each arena throws at the hero, and the director that throws it.
//
//   import { planWaves, WaveDirector, ESCALATION, COST } from './waves.js';
//   const plan = planWaves(index, seed);     // pure and seed-reproducible: same seed, same waves
//   const dir = new WaveDirector({ plan, foes, spawns, hero: () => ({x, z}), rng });
//   dir.start(); each tick: dir.tick();  dir.done -> every wave spawned and dead
//
// Escalation (ESCALATION below), across the five arenas of zone 1:
//   arena 1  3 small waves, husks and a mite swarm. Wave 1 is always two husks: learn the tell.
//   arena 2  2 waves. The ember wisp arrives (always in wave 1, so it is met in a small fight).
//   arena 3  3 waves. The brute arrives, alone with fodder, in the last wave.
//   arena 4  3 waves, bigger budgets, a brute may lead wave 2 or 3.
//   arena 5  3 waves, the biggest; the last wave holds two brutes.
// A wave's threat budget is spent on units by cost (COST); each arena caps what may appear.
// Composition is drawn from rng.fork-style streams keyed by seed and arena index, so the same
// seed gives the same waves in every run and on every machine, whatever the hero does.
//
// Pacing: the next wave comes when the room is empty (after a short breather), or when only
// one enemy is left and the wave has run for a while, so a straggler never stalls the room.
//
// Events: 'arena:wave' { n, total, units: ['husk', ...] }   'arena:wavesDone' {}

import { Rng } from '../core/rng.js';
import { events } from '../core/events.js';

/** Threat cost per spawn unit ('mites' is a swarm of five). */
export const COST = { husk: 2, mites: 3, wisp: 3, brute: 6 };

/**
 * Per arena: wave budgets, which units may appear, caps, and a unit forced into a wave
 * (to introduce it). first: a fixed opening wave.
 */
export const ESCALATION = [
  { budgets: [4, 5, 6], allow: ['husk', 'mites'], caps: { mites: 1 }, first: ['husk', 'husk'] },
  { budgets: [6, 8], allow: ['husk', 'mites', 'wisp'], caps: { wisp: 1, mites: 1 }, force: { 0: 'wisp' } },
  { budgets: [6, 8, 12], allow: ['husk', 'mites', 'wisp'], caps: { wisp: 1, mites: 2 }, force: { 2: 'brute' }, bruteCap: 1 },
  { budgets: [8, 11, 13], allow: ['husk', 'mites', 'wisp', 'brute'], caps: { wisp: 2, mites: 2, brute: 1 }, noBrute: [0], force: { 1: 'brute' } },
  { budgets: [10, 13, 19], allow: ['husk', 'mites', 'wisp', 'brute'], caps: { wisp: 2, mites: 2, brute: 1 }, noBrute: [0], force: { 2: ['brute', 'brute'] }, lastCaps: { brute: 2 } },
];
const WEIGHT = { husk: 5, mites: 3, wisp: 2.5, brute: 1.2 };

/** The waves of arena `index` (0-based) for a seed. Pure. */
export function planWaves(index, seed) {
  const E = ESCALATION[Math.max(0, Math.min(ESCALATION.length - 1, index))];
  const r = new Rng(`${seed}/waves/${index}`);
  const waves = E.budgets.map((budget, w) => {
    const last = w === E.budgets.length - 1;
    if (w === 0 && E.first) return { units: [...E.first], budget, cost: E.first.reduce((s, u) => s + COST[u], 0) };
    const caps = { ...E.caps, ...(last ? E.lastCaps : null) };
    const units = [];
    let left = budget;
    const count = (u) => units.filter((x) => x === u).length;
    const forced = E.force?.[w];
    for (const u of [].concat(forced ?? [])) { units.push(u); left -= COST[u]; }
    let guard = 0;
    while (left >= 2 && guard++ < 40) {
      const pool = E.allow.filter((u) => COST[u] <= left && count(u) < (caps[u] ?? 99) && !(u === 'brute' && E.noBrute?.includes(w)));
      if (!pool.length) break;
      const u = r.weighted(pool.map((p) => [p, WEIGHT[p]]));
      units.push(u);
      left -= COST[u];
    }
    // big units first so they arrive first; the rest in a seeded order
    const heavy = units.filter((u) => u === 'brute');
    const rest = r.shuffle(units.filter((u) => u !== 'brute'));
    const ordered = [...heavy, ...rest];
    return { units: ordered, budget, cost: ordered.reduce((s, u) => s + COST[u], 0) };
  });
  return { index, seed, waves, total: waves.reduce((s, w) => s + w.cost, 0) };
}

/** Short text for a unit list, e.g. "BRUTE, 2 HUSK, MITES". */
export function describeUnits(units) {
  const n = {};
  for (const u of units) n[u] = (n[u] || 0) + 1;
  return ['brute', 'wisp', 'husk', 'mites'].filter((u) => n[u]).map((u) => `${n[u] > 1 ? n[u] + ' ' : ''}${u === 'mites' ? 'MITE SWARM' : u.toUpperCase()}${n[u] > 1 && u !== 'mites' ? 'S' : ''}`).join(', ');
}

export const PACE = {
  breather: 45,        // ticks between a cleared wave and the next wave's first spawn
  stragglerAfter: 540, // with one enemy left this long into a wave, the next one comes anyway
  stagger: 11,         // ticks between spawns within a wave
  minDist: 3.6,        // spawn points closer than this to the hero are skipped
};

export class WaveDirector {
  /**
   * plan: from planWaves. foes: the EnemyManager. spawns: [[x, z], ...] spawn points.
   * hero(): {x, z}. rng: an Rng for spawn placement.
   */
  constructor({ plan, foes, spawns, hero, rng }) {
    this.plan = plan;
    this.foes = foes;
    this.spawns = spawns;
    this.hero = hero;
    this.rng = rng;
    this.n = 0;              // waves started
    this.t = 0;              // ticks into the current wave
    this.wait = -1;          // countdown to the next wave (-1: not waiting)
    this.queue = [];         // [{kind, x, z, at}] spawns still to happen this wave
    this.started = false;
    this.done = false;
    this.spawned = 0;
  }
  get total() { return this.plan.waves.length; }
  get current() { return this.plan.waves[this.n - 1] ?? null; }

  start() { this.started = true; this.wait = 1; }

  /** Pick spawn points far from the hero, spread apart. */
  placeWave(units) {
    const h = this.hero() ?? { x: 0, z: 0 };
    let pts = this.spawns.map(([x, z]) => ({ x, z, d: Math.hypot(x - h.x, z - h.z) }));
    const far = pts.filter((p) => p.d >= PACE.minDist);
    if (far.length >= 2) pts = far;
    this.rng.shuffle(pts);
    const used = [];
    return units.map((kind) => {
      // brutes want room to land: the point farthest from the others already used
      let best = null, bs = -Infinity;
      for (const p of pts) {
        const crowd = used.reduce((m, u) => Math.min(m, Math.hypot(u.x - p.x, u.z - p.z)), 9);
        const score = crowd * 1.2 + p.d * (kind === 'brute' ? 0.2 : 0.35) + this.rng.next() * 0.8;
        if (score > bs) { bs = score; best = p; }
      }
      used.push(best);
      return { kind, x: best.x + this.rng.range(-0.25, 0.25), z: best.z + this.rng.range(-0.25, 0.25) };
    });
  }

  beginWave() {
    const W = this.plan.waves[this.n];
    this.n++;
    this.t = 0;
    const placed = this.placeWave(W.units);
    this.queue = placed.map((p, k) => ({ ...p, at: k * PACE.stagger }));
    events.emit('arena:wave', { n: this.n, total: this.total, units: [...W.units] });
  }

  tick() {
    if (!this.started || this.done) return;
    if (this.wait > 0 && --this.wait === 0) { this.wait = -1; this.beginWave(); }
    if (this.wait < 0 && this.n > 0) this.t++;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (this.t < q.at) continue;
      this.foes.spawn(q.kind, q.x, q.z);
      this.spawned++;
      this.queue.splice(i, 1);
    }
    if (this.wait > 0 || this.queue.length) return;
    const alive = this.foes.alive;
    const more = this.n < this.total;
    if (more && (alive === 0 || (alive <= 1 && this.t > PACE.stragglerAfter))) this.wait = alive === 0 ? PACE.breather : 1;
    if (!more && alive === 0) { this.done = true; events.emit('arena:wavesDone', {}); }
  }

  info() {
    return { wave: this.n, total: this.total, t: this.t, waiting: this.wait, queued: this.queue.length, done: this.done, spawned: this.spawned,
      plan: this.plan.waves.map((w) => w.units.join('+')) };
  }
}
