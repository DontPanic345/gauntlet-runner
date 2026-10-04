// The run record (piece `run-flow`): what happened in this run, and the light meta that
// survives between runs (localStorage). Everything here is bookkeeping; nothing draws.
//
//   import { run, startRun, endRun, meta, LORE, causeText, fmtTime } from './run/record.js';
//   startRun(seed)                 a fresh run (stats zeroed, run.active = true)
//   endRun('death' | 'victory')    freezes the stats, updates meta, returns run.result
//   run.ticks / kills / dmg / hurts / dodges / shards / boons / node / deepest / cause
//
// Stats are collected from the shared event bus, so no other piece has to report to us:
//   tick              run.ticks (only in run / gauntlet / boss, never while paused)
//   enemy:death       kills (by kind)
//   combat:damage     damage dealt (side !== 'hero'), hearts lost (side === 'hero')
//   combat:dodge      close calls (a dash through a hit)
//   combat:heroDeath  the cause of death (see below)
// Cause of death: the bus says who hurt the hero in the same tick, in this order of trust:
//   gauntlet:caught (collapse) > gauntlet:hurt {cause} (traps) > a fall that just ended (pit)
//   > enemy:attackHit {enemy} > nearest living enemy (projectiles) > the scene (boss: warden).

import { events } from '../core/events.js';
import { loop } from '../core/loop.js';
import { scenes } from '../core/scenes.js';
import { world } from '../core/world.js';
import { progress } from '../progression/boons.js';
import { nodeOf } from '../ui/widgets/track.js';

export const GAMEPLAY = new Set(['run', 'gauntlet', 'boss']);
export const NODE_COUNT = 10;   // 5 arenas, 4 corridors, the Warden (the HUD track's nodes)

const META_KEY = 'gr.meta.v1';

// ---- lore: one line unlocks per finished run, gated by how deep you got ---------------------
// need: the track node you must have reached (0..9), or 'win'.
export const LORE = [
  { need: 0, text: 'THE MOUNTAIN SWALLOWS RUNNERS. IT NEVER ASKS THE SAME ONE TWICE.' },
  { need: 0, text: 'EVERY RUNNER WEARS THE HOOD. NOBODY REMEMBERS WHOSE IT WAS.' },
  { need: 1, text: 'THE CRYPT FALLS IN BEHIND YOU. IT HAS BEEN FALLING FOR A THOUSAND YEARS.' },
  { need: 2, text: 'THE HUSKS WERE RUNNERS ONCE. THEY STILL KNOW THE WAY DOWN.' },
  { need: 3, text: 'SOME SAY THE COLLAPSE IS HUNGRY. OTHERS SAY IT IS ONLY LATE.' },
  { need: 4, text: 'SOUL SHARDS REMEMBER HOW TO BURN. THAT IS ALL THEY REMEMBER.' },
  { need: 5, text: 'A WISP IS WHAT IS LEFT WHEN A FIRE FORGETS ITS TORCH.' },
  { need: 6, text: 'THE BRUTES WERE BUILT TO HOLD THE DOORS. NOBODY TAUGHT THEM TO OPEN ONE.' },
  { need: 8, text: 'BELOW THE LAST HALL, A RING OF KEYS RATTLES IN THE DARK.' },
  { need: 9, text: 'THE WARDEN WAS THE FIRST RUNNER. HE STOPPED, AND THE MOUNTAIN KEPT HIM.' },
  { need: 'win', text: 'THE KEYS ARE WARM IN YOUR HAND. THE GATE BELOW HAS NO LOCK YOU KNOW.' },
  { need: 'win', text: 'YOU CLIMB OUT AT DAWN. THE MOUNTAIN IS ALREADY HUNGRY AGAIN.' },
];

// ---- causes of death ------------------------------------------------------------------------------
export const CAUSES = {
  husk: { text: 'CUT DOWN BY A HUSK', short: 'A HUSK', color: 'leaf' },
  wisp: { text: 'BURNED BY A WISP', short: 'A WISP', color: 'cyan' },
  brute: { text: 'CRUSHED BY A BRUTE', short: 'A BRUTE', color: 'red' },
  mite: { text: 'SWARMED BY MITES', short: 'MITES', color: 'rose' },
  warden: { text: 'BROKEN BY THE WARDEN', short: 'THE WARDEN', color: 'red' },
  collapse: { text: 'BURIED BY THE COLLAPSE', short: 'THE COLLAPSE', color: 'ember' },
  spikes: { text: 'IMPALED ON THE SPIKES', short: 'SPIKES', color: 'frost' },
  blade: { text: 'CLEAVED BY A SWINGING BLADE', short: 'A BLADE', color: 'frost' },
  fire: { text: 'BURNED BY THE FIRE JETS', short: 'FIRE', color: 'flame' },
  pit: { text: 'LOST TO THE DARK BELOW', short: 'THE DARK', color: 'violet' },
  unknown: { text: 'STRUCK DOWN', short: 'UNKNOWN', color: 'fog' },
};
export const causeText = (id) => (CAUSES[id] ?? CAUSES.unknown).text;

// ---- the run ---------------------------------------------------------------------------------------
export const run = {
  active: false,      // a run is under way (or just ended and not yet summarised)
  ended: false,       // death or victory happened; stats are frozen
  number: 0,          // this run's number (meta.runs at start + 1)
  seed: 1,
  ticks: 0,
  kills: 0,
  killsBy: {},
  dmg: 0,
  hurts: 0,
  dodges: 0,
  shards: 0,
  hearts: 0,
  boons: [],          // [{ id, stacks }] in the order taken
  node: 0,            // current track node (0..9)
  deepest: 0,
  roomName: '',
  roomKind: 'arena',
  hp: 5, maxHp: 5,    // carried between scenes
  cause: null,        // cause id
  deathAt: null,      // { x, z, tick }
  outcome: null,      // 'death' | 'victory' | 'abandon'
  result: null,       // endRun()'s summary
  staged: false,      // the showcase staged this run's history (labelled on screen)
};

const ZERO = () => ({ ticks: 0, kills: 0, killsBy: {}, dmg: 0, hurts: 0, dodges: 0, shards: 0, hearts: 0, boons: [],
  node: 0, deepest: 0, roomName: '', roomKind: 'arena', hp: 5, maxHp: 5, cause: null, deathAt: null, outcome: null, result: null, staged: false });

export function startRun(seed) {
  Object.assign(run, ZERO());
  run.active = true;
  run.ended = false;
  run.seed = seed;
  run.number = meta.runs + 1;
  hint = null;
  return run;
}

/** Copy what the boons piece holds (it resets on gameover/victory, so we keep our own copy). */
export function snapshotBoons() {
  run.boons = progress.order.map((id) => ({ id, stacks: progress.held.get(id) ?? 1 }));
  run.shards = Math.max(run.shards, progress.shardsTotal ?? 0);
  run.hearts = progress.hearts ?? 0;
}

function trackRoom() {
  const r = world.room;
  if (!r || r.showcase) return;
  const n = nodeOf(r);
  if (n < 0) return;
  run.node = n;
  run.deepest = Math.max(run.deepest, n);
  run.roomKind = r.kind;
  run.roomName = r.kind === 'corridor' ? `CORRIDOR ${(r.index | 0) + 1}` : r.kind === 'boss' ? "THE WARDEN'S PIT" : (r.name ?? `ARENA ${(r.index | 0) + 1}`);
}

/** Where the run is, as words: "ARENA 3 • THE OSSUARY". */
export function placeText(node = run.node, name = run.roomName) {
  if (node === 9) return "THE WARDEN'S PIT";
  if (node % 2 === 1) return `CORRIDOR ${(node + 1) / 2}`;
  return `ARENA ${node / 2 + 1}${name && !/^ARENA/.test(name) ? ' • ' + name.replace(/^THE /, '') : ''}`;
}

export const fmtTime = (ticks) => {
  const cs = Math.floor((ticks / 60) * 100);
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};

/**
 * Freeze the run and fold it into meta. Returns the result the summary draws:
 * { outcome, ticks, kills, dmg, hurts, dodges, shards, boons, node, deepest, cause, seed, number,
 *   best: { time, depth, kills }, newBest: { time, depth, kills }, lore: { index, text, fresh, count, total } }
 */
export function endRun(outcome, { cause = null } = {}) {
  if (run.ended && run.result) return run.result;
  // no run under way (debug.scene('gameover') from the title): an empty record that never touches meta
  if (!run.active) { startRun(run.seed || 1); run.staged = true; }
  snapshotBoons();
  trackRoom();
  run.ended = true;
  run.outcome = outcome;
  if (outcome === 'victory') { run.node = 9; run.deepest = 9; run.cause = null; }
  else run.cause = run.cause ?? cause ?? 'unknown';

  const prev = { time: meta.bestTime, depth: meta.bestDepth, kills: meta.bestKills };
  const newBest = { time: false, depth: false, kills: false };
  if (!run.staged) {
    meta.runs = Math.max(meta.runs, run.number);
    if (outcome === 'victory') {
      meta.wins++;
      if (!meta.bestTime || run.ticks < meta.bestTime) { newBest.time = meta.bestTime > 0 || meta.wins === 1; meta.bestTime = run.ticks; }
    } else meta.deaths++;
    if (run.deepest > meta.bestDepth) { newBest.depth = meta.runs > 1; meta.bestDepth = run.deepest; }
    if (run.kills > meta.bestKills) { newBest.kills = meta.runs > 1; meta.bestKills = run.kills; }
    if (run.cause) meta.causes[run.cause] = (meta.causes[run.cause] ?? 0) + 1;
  }
  const lore = unlockLore(outcome === 'victory' ? 'win' : run.deepest);
  if (!run.staged) saveMeta();
  run.result = {
    outcome, ticks: run.ticks, kills: run.kills, killsBy: { ...run.killsBy }, dmg: Math.round(run.dmg), hurts: run.hurts, dodges: run.dodges,
    shards: run.shards, hearts: run.hearts, boons: run.boons.slice(), node: run.node, deepest: run.deepest, place: placeText(),
    cause: run.cause, seed: run.seed, number: run.number, staged: run.staged,
    best: { time: meta.bestTime, depth: meta.bestDepth, kills: meta.bestKills, prevTime: prev.time, prevDepth: prev.depth },
    newBest, lore, wins: meta.wins, runs: meta.runs,
  };
  return run.result;
}

/** Abandon (quit to title): no meta change beyond the run count. */
export function abandonRun() {
  if (!run.active || run.ended) { run.active = false; return; }
  run.active = false; run.outcome = 'abandon';
  if (!run.staged) { meta.runs = Math.max(meta.runs, run.number); saveMeta(); }
}

// ---- meta ---------------------------------------------------------------------------------------------
export const meta = { runs: 0, deaths: 0, wins: 0, bestTime: 0, bestDepth: 0, bestKills: 0, lore: [], causes: {} };
try {
  const s = JSON.parse(localStorage.getItem(META_KEY) || 'null');
  if (s && typeof s === 'object') for (const k in meta) if (typeof s[k] === typeof meta[k]) meta[k] = s[k];
  if (!Array.isArray(meta.lore)) meta.lore = [];
} catch { /* storage blocked: a fresh meta */ }
export function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* ignore */ } }
export function resetMeta() {
  Object.assign(meta, { runs: 0, deaths: 0, wins: 0, bestTime: 0, bestDepth: 0, bestKills: 0, lore: [], causes: {} });
  saveMeta();
}

function unlockLore(depth) {
  const ok = (L) => (L.need === 'win' ? depth === 'win' : (depth === 'win' ? true : depth >= L.need));
  let index = LORE.findIndex((L, i) => ok(L) && !meta.lore.includes(i));
  let fresh = index >= 0;
  if (fresh) { if (!run.staged) meta.lore.push(index); }
  else {
    // nothing new at this depth: recall one already known (the deepest one you have)
    const known = meta.lore.filter((i) => ok(LORE[i]));
    index = known.length ? known[(run.number * 7) % known.length] : 0;
  }
  const count = run.staged && fresh ? meta.lore.length + 1 : meta.lore.length;
  return { index, text: LORE[index].text, fresh, count, total: LORE.length };
}

// ---- the bus ---------------------------------------------------------------------------------------------
let hint = null;        // { id, tick }  the strongest cause seen this tick
let fallEnd = -1;       // tick a pit fall lands (its hurt is a forced 1)
const trust = { collapse: 5, spikes: 4, blade: 4, fire: 4, pit: 3, enemy: 2, near: 1 };
function offer(id, kind) {
  if (!run.active || run.ended && run.cause) return;
  const t = loop.tick;
  if (hint && hint.tick === t && trust[hint.kind] >= trust[kind]) return;
  hint = { id, kind, tick: t };
  if (run.deathAt && run.deathAt.tick === t) run.cause = id;
}
const live = () => run.active && !run.ended && GAMEPLAY.has(scenes.base);

events.on('tick', () => {
  if (!run.active || run.ended || scenes.paused) return;
  if (!GAMEPLAY.has(scenes.current)) return;
  run.ticks++;
  trackRoom();
  if (world.hero) { run.hp = world.hero.hp; run.maxHp = world.hero.maxHp; }
  if (run.ticks % 30 === 0) snapshotBoons();
});
events.on('enemy:death', (e) => {
  if (!live()) return;
  run.kills++;
  const k = e.kind ?? 'foe';
  run.killsBy[k] = (run.killsBy[k] ?? 0) + 1;
});
events.on('combat:damage', (e) => {
  if (!live()) return;
  if (e.side === 'hero') run.hurts += e.amount ?? 1;
  else run.dmg += e.amount ?? 0;
});
events.on('combat:dodge', () => { if (live()) run.dodges++; });
events.on('gauntlet:caught', () => offer('collapse', 'collapse'));
events.on('gauntlet:hurt', (e) => offer(e.cause ?? 'spikes', e.cause ?? 'spikes'));
events.on('gauntlet:fall', () => { fallEnd = loop.tick + 30; });
events.on('enemy:attackHit', (e) => { if (e.ok) offer(e.enemy?.kind ?? 'unknown', 'enemy'); });
events.on('combat:heroDeath', (e) => {
  if (!live()) return;
  const t = loop.tick;
  run.deathAt = { x: e.x, z: e.z, tick: t };
  snapshotBoons();
  if (hint && hint.tick === t) { run.cause = hint.id; return; }
  if (Math.abs(t - fallEnd) <= 1) { run.cause = 'pit'; return; }
  // no word from the bus yet (a projectile, a slam): the nearest foe is the best guess;
  // enemy:attackHit / gauntlet:hurt fire right after this and overrule it
  let best = null, bd = 1e9;
  for (const en of world.enemies || []) {
    if (en.dead || !(en.hp > 0) || !en.kind) continue;
    const d = Math.hypot(en.x - e.x, en.z - e.z);
    if (d < bd) { bd = d; best = en; }
  }
  const wisp = (world.enemies || []).find((en) => en.kind === 'wisp' && !en.dead);
  run.cause = best && bd < 2 ? best.kind : wisp ? 'wisp' : best ? best.kind : scenes.base === 'boss' ? 'warden' : scenes.base === 'gauntlet' ? 'collapse' : 'unknown';
  hint = { id: run.cause, kind: 'near', tick: t };
});
