// Wave composition and the wave director (piece `arenas`).
//
// Composition is data plus a seeded draw, so it escalates across the five arenas and the same
// seed always gives the same waves:
//
//   import { planArena, planRun, WaveDirector, ESCALATION, COST } from './waves.js';
//   planArena(index, seed) -> { index, seed, waves: [{ budget, spent, groups: [{ kind, delay }] }] }
//   planRun(seed)          -> [plan x 5]
//   describeWave(w)        -> 'HUSK x2  MITES  WISP'
//
//   const dir = new WaveDirector({ plan, foes, spots, hero: () => ctl });
//   dir.start();  dir.tick();   // each sim tick, after foes.tick()
//   dir.done  dir.wave  dir.total  dir.state ('idle'|'announce'|'spawning'|'fighting'|'breather'|'done')
//
// Events: arena:wave {n, total, groups}   n counts from 1, fired as the wave's banner goes up
//         arena:waveClear {n, total, x, z}  the last enemy of a wave died at x, z
//         arena:wavesDone {x, z}           the final wave is dead (the room clear moment)
//
// Escalation rules (ESCALATION below): every arena has more waves or bigger budgets than the
// one before; new archetypes join at fixed arenas (wisps from arena 2, brutes from arena 3);
// some waves have a fixed headliner ("must") so the peak of each arena is authored, and the
// seed fills the rest of the budget from a weighted pool under per-arena caps.

import { Rng } from '../core/rng.js';
import { events } from '../core/events.js';

/** Threat cost of one spawn group. 'mites' is a swarm of five. */
export const COST = { husk: 2, mites: 3, wisp: 3, brute: 7 };

export const ESCALATION = [
  { waves: [4, 6], pool: { husk: 3, mites: 2 }, caps: { mites: 1 } },
  { waves: [6, 7], pool: { husk: 3, mites: 2, wisp: 2 }, caps: { wisp: 1, mites: 1 }, must: { 1: ['wisp'] } },
  { waves: [6, 8, 10], pool: { husk: 3, mites: 2, wisp: 2 }, caps: { wisp: 1, brute: 1 }, must: { 2: ['brute'] } },
  { waves: [8, 10, 12], pool: { husk: 3, mites: 2, wisp: 2, brute: 1 }, caps: { wisp: 2, brute: 1, mites: 2 }, must: { 1: ['wisp'] } },
  { waves: [9, 12, 16], pool: { husk: 3, mites: 2, wisp: 2, brute: 1 }, caps: { wisp: 2, brute: 2, mites: 2 }, must: { 2: ['brute', 'wisp'] } },
];

// spawn order inside a wave: fodder first, then ranged, heavy last (it gets the stage to itself)
const ORDER = { mites: 0, husk: 1, wisp: 2, brute: 3 };
const GAP = { mites: 18, husk: 16, wisp: 24, brute: 40 };

export function planArena(index, seed = 1) {
  const E = ESCALATION[Math.max(0, Math.min(ESCALATION.length - 1, index))];
  const rng = new Rng(`${seed}/arenas/${index}/waves`);
  const waves = E.waves.map((budget, wi) => {
    const groups = [];
    const count = {};
    let spent = 0;
    const add = (kind) => { groups.push({ kind }); count[kind] = (count[kind] || 0) + 1; spent += COST[kind]; };
    for (const k of E.must?.[wi] ?? []) add(k);
    for (let guard = 0; guard < 20; guard++) {
      const left = budget - spent;
      const opts = Object.entries(E.pool).filter(([k]) => COST[k] <= left && (count[k] || 0) < (E.caps?.[k] ?? 9));
      if (!opts.length) break;
      add(rng.weighted(opts));
    }
    groups.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || 0);
    let t = 0;
    for (const g of groups) { g.delay = t; t += GAP[g.kind] + rng.int(0, 8); }
    return { budget, spent, groups };
  });
  return { index, seed, waves };
}

export const planRun = (seed = 1) => ESCALATION.map((_, i) => planArena(i, seed));

const NAMES = { husk: 'HUSK', mites: 'MITES', wisp: 'WISP', brute: 'BRUTE' };
export function describeWave(w) {
  const c = {};
  for (const g of w.groups) c[g.kind] = (c[g.kind] || 0) + 1;
  return Object.entries(c).sort((a, b) => ORDER[a[0]] - ORDER[b[0]]).map(([k, n]) => (n > 1 ? `${NAMES[k]} x${n}` : NAMES[k])).join('  ');
}
/** Total threat of an arena (for the escalation readout). */
export const arenaThreat = (plan) => plan.waves.reduce((s, w) => s + w.spent, 0);

export class WaveDirector {
  /**
   * plan: from planArena. foes: the enemy manager. spots: [[x, z], ...] spawn points.
   * hero: () => {x, z}. opts.announce: ticks the banner shows before a wave spawns.
   */
  constructor({ plan, foes, spots, hero, announce = 50, breather = 70 }) {
    this.plan = plan; this.foes = foes; this.spots = spots; this.hero = hero;
    this.announceT = announce; this.breatherT = breather;
    this.state = 'idle'; this.t = 0; this.wave = 0; this.queue = []; this.lastDeath = null;
    this.spawned = [];
    this.off = events.on('enemy:death', (e) => { if (this.foes.list.includes(e.enemy)) this.lastDeath = { x: e.x, z: e.z }; });
  }
  get total() { return this.plan.waves.length; }
  get done() { return this.state === 'done'; }
  dispose() { this.off?.(); }

  start() { if (this.state === 'idle') this._announce(0); }

  _announce(i) {
    this.wave = i + 1; this.state = 'announce'; this.t = 0;
    const W = this.plan.waves[i];
    this.queue = W.groups.map((g) => ({ ...g }));
    this.used = new Map();
    events.emit('arena:wave', { n: this.wave, total: this.total, groups: W.groups.map((g) => g.kind) });
  }

  // spots far from the hero first; spread groups over different spots
  _spot(kind) {
    const h = this.hero?.() ?? { x: 0, z: 0 };
    const minD = kind === 'brute' ? 3.2 : 3.6;
    let best = null, bs = -Infinity;
    for (const s of this.spots) {
      const d = Math.hypot(s[0] - h.x, s[1] - h.z);
      const used = this.used.get(s) || 0;
      const score = (d >= minD ? 10 : 0) + Math.min(d, 7) - used * 4 + (s[2] ?? 0);
      if (score > bs) { bs = score; best = s; }
    }
    this.used.set(best, (this.used.get(best) || 0) + 1);
    return best;
  }

  tick() {
    this.t++;
    if (this.state === 'announce' && this.t >= this.announceT) { this.state = 'spawning'; this.t = 0; }
    if (this.state === 'spawning') {
      while (this.queue.length && this.queue[0].delay <= this.t) {
        const g = this.queue.shift();
        const [x, z] = this._spot(g.kind);
        const r = this.foes.spawn(g.kind, x, z);
        this.spawned.push(...(Array.isArray(r) ? r : [r]));
      }
      if (!this.queue.length) { this.state = 'fighting'; this.t = 0; }
    }
    if (this.state === 'fighting') {
      const alive = this.foes.alive;
      // reinforce early if the wave has dragged on down to one straggler
      const last = this.wave >= this.total;
      if (alive === 0 || (!last && alive <= 1 && this.t > 900)) {
        const at = this.lastDeath ?? this.hero?.() ?? { x: 0, z: 0 };
        events.emit('arena:waveClear', { n: this.wave, total: this.total, x: at.x, z: at.z });
        if (last) { this.state = 'done'; events.emit('arena:wavesDone', { x: at.x, z: at.z }); }
        else { this.state = 'breather'; this.t = 0; }
      }
    }
    if (this.state === 'breather' && this.t >= (this.foes.alive ? 1 : this.breatherT)) this._announce(this.wave);
  }

  info() {
    return { state: this.state, wave: this.wave, total: this.total, queued: this.queue.length, alive: this.foes.alive,
      plan: this.plan.waves.map((w) => ({ budget: w.budget, spent: w.spent, groups: w.groups.map((g) => g.kind) })) };
  }
}
