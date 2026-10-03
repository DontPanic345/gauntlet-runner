// The audio director (piece `audio`): listens to the game and decides what plays.
//
// - Takes over the other pieces' stand-in voices: their contexts were already moved onto the
//   shared mixer (see engine.js legacyBus); here the most frequent ones are replaced by the bank
//   (swings, hits by weight, slam, hurt, dodge, enemy spawn/death barks, shards, hearts, the
//   clear sting) and the telegraph tells are wrapped so they duck the music.
// - Adds what nobody had: footsteps per surface, dash, dash-ready, bonk, land, hero death,
//   kill confirm, enemy hurt barks, ambience, and the collapse's debris patter.
// - Drives the music from scenes and state: title theme; arena layers by combat intensity;
//   the corridor chase layer and an alarm that rises as the collapse closes in; the Warden's
//   theme by phase; a lowpass on the music at low health, in pause and on death.

import { events } from '../core/events.js';
import { world } from '../core/world.js';
import { scenes } from '../core/scenes.js';
import { audio, withBoost } from './engine.js';
import { sfx, panFor } from './bank.js';
import { music } from './music.js';
import { ambience } from './ambience.js';
import { combatSfx } from '../combat/sfx.js';
import { enemySfx } from '../enemies/sfx.js';
import { boonSfx } from '../progression/sfx.js';
import { bossSfx } from '../boss/sfx.js';
import { arenaSfx } from '../world/props.js';
import { gauntletSfx } from '../world/traps.js';
import { getActiveArena } from '../world/arena.js';

// ---- adopting the stand-in voices ----------------------------------------------------------------
const noop = () => {};
// replaced by the bank (played from the events below, which carry positions for panning)
combatSfx.swing = noop;
combatSfx.hit = noop;
combatSfx.slam = noop;
combatSfx.hurt = noop;
combatSfx.dodge = noop;
enemySfx.spawn = noop;
enemySfx.death = noop;
boonSfx.shard = (step) => sfx.shard(step);
boonSfx.heart = () => sfx.play('heart');
arenaSfx.clear = () => sfx.play('clearSting');

// Levels: the stand-ins were balanced inside their own contexts (each with a compressor). On the
// shared bus they were measured one by one (see the audio build notes) and trimmed here, per
// sound, in dB. Telegraph tells get the most: they must cut through full arena music, and the
// music also ducks under them, so a tell is never masked.
const dB = (d) => Math.pow(10, d / 20);
function trim(obj, name, db, duck = null) {
  const orig = obj[name];
  if (typeof orig !== 'function') return;
  obj[name] = function trimmed(...a) {
    if (duck) { try { duck(...a); } catch (err) { console.error(err); } }
    const d = typeof db === 'function' ? db(...a) : db;
    return withBoost(dB(d), () => orig.apply(this, a));
  };
}
const tellDuck = (db, hold) => (len) => audio.duck(db, typeof len === 'number' ? Math.min(1.5, len) : hold, 0.45, 0.03);
const WINDUP_DB = { husk: 20, wisp: 22, charge: 17, slam: 19, mite: 16 };

// enemies (piece `enemies`)
trim(enemySfx, 'windup', (kind) => WINDUP_DB[kind] ?? 12, (kind, len = 0.5) => audio.duck(6, Math.min(0.8, len), 0.4, 0.03));
trim(enemySfx, 'charge', 4, tellDuck(4, 0.5));
for (const [n, d] of [['swipe', 12], ['orbPop', 10], ['paw', 12], ['dizzy', 10], ['hop', 16], ['crumble', 10], ['fire', 6], ['bite', 4]]) trim(enemySfx, n, d);
// the Warden (piece `boss`): tells first
for (const [n, d, duckDb, hold] of [['whirl', 19, 6, 0.9], ['drawback', 20, 6, 0.6], ['creak', 18, 6, 0.5], ['inhale', 17, 6, 0.6], ['keys', 20, 6, 0.5], ['bell', 3, 6, 1.2], ['roar', 3, 7, 1.3], ['rumble', 0, 3, 1.2]]) trim(bossSfx, n, d, tellDuck(duckDb, hold));
for (const [n, d] of [['ignite', 6], ['rune', 8], ['hit', 6], ['sweep', 10], ['leap', 8], ['wave', 8], ['yank', 6], ['clatter', 6], ['eyes', 4], ['rise', 4], ['lash', 2]]) trim(bossSfx, n, d);
// boons (piece `boons`)
for (const [n, d] of [['hover', 8], ['fly', 12], ['zap', 8], ['burn', 10], ['echo', 10], ['mote', 8], ['cardFlip', 6], ['wardGrow', 8], ['crit', 6], ['wave', 4], ['starFall', 4]]) trim(boonSfx, n, d);
// arenas and corridors (pieces `arenas`, `gauntlet`)
for (const [n, d] of [['clank', 10], ['ignite', 12], ['bones', 12], ['clink', 6], ['pot', 4]]) trim(arenaSfx, n, d);
trim(arenaSfx, 'slam', 0, tellDuck(6, 0.5));
trim(gauntletSfx, 'rattle', 28, (v) => { if (v > 0.3) audio.duck(5, 0.35, 0.3, 0.02); });
trim(gauntletSfx, 'hiss', 14, (v) => { if (v > 0.3) audio.duck(5, 0.5, 0.3, 0.03); });
trim(gauntletSfx, 'whoosh', 14);
trim(gauntletSfx, 'crack', 6);
trim(gauntletSfx, 'fall', 6);
trim(gauntletSfx, 'slam', 0, tellDuck(6, 0.5));
trim(gauntletSfx, 'quake', -2, () => { audio.duck(6, 0.9, 1.0, 0.02); sfx.play('quakeHit'); });
// the training dummy (piece `combat`)
trim(combatSfx, 'creak', 16, tellDuck(5, 0.5));
trim(combatSfx, 'whack', 12);

// ---- event sounds -----------------------------------------------------------------------------------
const hx = () => world.hero?.x;

events.on('hero:swing', (e) => sfx.play(e.step === 2 ? 'swing.3' : e.step === 1 ? 'swing.2' : 'swing.1', { x: e.x }));
events.on('combat:hit', (e) => {
  sfx.hit(e.power ?? 1, !!e.finisher, { x: e.x });
  activity += 0.04 + 0.03 * (e.power ?? 1);
});
events.on('hero:slam', (e) => sfx.play('slam', { x: e.x }));
events.on('combat:heroHurt', (e) => { sfx.play('hurt', { x: e.x }); activity += 0.12; });
events.on('combat:dodge', (e) => sfx.play('dodge', { x: e.x }));
events.on('combat:kill', (e) => { if (e.target?.kind !== 'warden' && !e.proc) sfx.play('kill', { x: e.x, gain: 0.8 }); });
events.on('combat:heroDeath', (e) => heroDied(e));
events.on('hero:dash', (e) => sfx.play('dash', { x: e.x }));
events.on('move:dashReady', () => sfx.play('dashReady', { gain: 0.6 }));
events.on('move:bonk', () => sfx.play('bonk', { x: hx() }));
events.on('hero:land', (e) => sfx.play('land', { x: e.x }));
events.on('hero:step', (e) => sfx.step(surfaceAt(e.x, e.z), e.foot, { x: e.x, gain: 0.85 }));

const BARKS = new Set(['husk', 'wisp', 'brute', 'mite']);
events.on('enemy:spawn', (e) => { if (BARKS.has(e.kind)) sfx.play(`${e.kind}.spawn`, { x: e.x }); });
events.on('enemy:death', (e) => { if (BARKS.has(e.kind)) sfx.play(`${e.kind}.death`, { x: e.x }); });
events.on('enemy:hurt', (e) => {
  const k = e.enemy?.kind;
  if (BARKS.has(k) && e.hp > 0 && Math.random() < 0.75) sfx.play(`${k}.hurt`, { x: e.x, delay: 0.03, gain: 0.8 });
});

// ---- footstep surfaces --------------------------------------------------------------------------------
const THEME_SURFACE = { crypt: 'stone', sunken: 'wet', ossuary: 'bone', hall: 'tile', deep: 'grit' };
function surfaceAt(x = 0, z = 0) {
  const kind = world.room?.kind;
  if (kind === 'corridor') return 'grit';
  if (kind === 'boss') return 'stone';
  if (kind !== 'arena') return 'stone';
  const A = getActiveArena();
  const L = A?.L;
  if (!L) return 'stone';
  if (L.theme === 'hall') {
    // the carpet runs from the gate to the exit
    const gx = -L.W / 2 + L.gate[0] + 1.5, ex = A.exitX ?? 0;
    const k = Math.max(0, Math.min(1, (L.D / 2 - z) / L.D));
    if (Math.abs(x - (gx + (ex - gx) * k)) < 1.1) return 'carpet';
  }
  if (L.theme === 'crypt' && L.style === 'tile') return 'tile';
  return THEME_SURFACE[L.theme] ?? 'stone';
}

// ---- music & ambience state ---------------------------------------------------------------------------
let mode = null;          // 'title' | 'arena' | 'corridor' | 'boss' | 'gameover' | 'victory' | 'silent' | 'board'
let bossPhase = 0;        // 0 intro, 1..3 fighting, 4 dead
let dead = false;
let activity = 0;
let intensity = 0;
const stemOn = {};        // hysteresis state for arena layers

const THREAT = { husk: 1, mite: 0.45, wisp: 1.2, brute: 3, warden: 4 };
const ARENA_LAYERS = [['drums', 0.2], ['bass', 0.36], ['arp', 0.55], ['lead', 0.78]];

function heroDied() {
  if (dead) return;
  dead = true;
  sfx.play('heroDeath', { x: hx() });
  music.filter('dead');
  audio.duck(10, 1.5, 1.5, 0.05);
  const at = mode;
  setTimeout(() => { if (mode !== at) return; music.stop(2.5); sfx.play('deathSting'); }, 450);
}

function enterMode(m, data = {}) {
  if (m === mode && m !== 'boss') return;
  mode = m;
  dead = false;
  activity = 0;
  music.filter('normal');
  switch (m) {
    case 'title':
      music.play('title', { fade: 1.5 }); music.only(['bed', 'bass', 'arp', 'lead']);
      ambience.set({ wind: 0.9, crackle: 0, drip: 0.15, debris: 0 });
      break;
    case 'arena':
    case 'corridor':
      music.play('crypt', { fade: 1.5 });
      break;
    case 'boss':
      bossPhase = 0;
      music.play('warden', { fade: 2 }); music.only(['intro']);
      ambience.set({ wind: 0.5, crackle: 3, drip: 0, debris: 0 });
      break;
    case 'gameover':
      music.filter('normal');
      music.play('title', { fade: 2.5 }); music.only(['bed', 'bass']);
      ambience.set({ wind: 0.8, crackle: 0, drip: 0.1, debris: 0 });
      break;
    case 'victory':
      music.filter('normal');
      setTimeout(() => { if (mode === 'victory') { music.play('title', { fade: 2 }); music.only(['bed', 'bass', 'arp', 'lead']); } }, 2500);
      music.stop(1.5);
      ambience.set({ wind: 0.6, crackle: 0, drip: 0.1, debris: 0 });
      break;
    case 'board':      // the audio showcase drives music itself
      break;
    default:
      music.stop(0.6);
      ambience.set({ wind: 0, crackle: 0, drip: 0, debris: 0 });
  }
}

events.on('scene:enter', (e) => {
  const n = e.name;
  if (n === 'pause') return;
  if (n === 'title') enterMode('title');
  else if (n === 'run') enterMode('arena');
  else if (n === 'gauntlet') enterMode('corridor');
  else if (n === 'boss') enterMode('boss');
  else if (n === 'gameover') enterMode('gameover');
  else if (n === 'victory') enterMode('victory');
  else if (n === 'showcase' && e.data?.id === 'audio') enterMode('board');
  else enterMode('silent');
});
events.on('pause', (e) => {
  if (e.paused) { music.filter('pause'); audio.duck(4, 0.1, 0.3, 0.1); }
  else music.filter('normal');
});

events.on('boss:fight', () => { bossPhase = 1; });
events.on('boss:phase', (e) => { bossPhase = Math.max(bossPhase, e.phase ?? bossPhase + 1); });
events.on('boss:death', () => { bossPhase = 4; music.stop(3); });
events.on('arena:clear', () => { intensity = 0; activity = 0; });
events.on('arena:wave', () => { activity += 0.15; });
events.on('gauntlet:start', () => { activity += 0.2; });

function setLayers(on) {
  for (const [sn] of ARENA_LAYERS) stemOn[sn] = on.includes(sn);
  music.only(on);
}

function arenaLayers() {
  // hysteresis: a layer comes in at its threshold and leaves 0.08 below it
  const list = ['bed'];
  for (const [sn, th] of ARENA_LAYERS) {
    const on = stemOn[sn] ? intensity > th - 0.08 : intensity >= th;
    stemOn[sn] = on;
    if (on) list.push(sn);
  }
  music.only(list);
}

let last = performance.now();
function update() {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  activity = Math.max(0, Math.min(0.3, activity) - dt * 0.12);
  const h = world.hero;
  const paused = scenes.paused;

  // low health: the music closes in (not while paused or dead: those have their own filters)
  if (!paused && !dead && (mode === 'arena' || mode === 'corridor' || mode === 'boss')) {
    const low = h && h.hp > 0 && (h.hp <= 1 || h.hp / (h.maxHp || 1) <= 0.25);
    music.filter(low ? 'lowhp' : 'normal');
  }

  if (mode === 'arena') {
    const room = world.room;
    const st = room?.state;
    let target = 0.08;
    if (st === 'fight') {
      let threat = 0;
      for (const e of world.enemies) if (!e.dead && (e.hp ?? 1) > 0) threat += THREAT[e.kind ?? e.type] ?? 0.6;
      target = 0.24 + threat * 0.085 + ((room.wave ?? 1) - 1) * 0.04 + activity;
    } else if (st === 'sealing') target = 0.22;
    target = Math.max(0, Math.min(1, target));
    const tau = target > intensity ? 0.7 : 3.5;
    intensity += (target - intensity) * (1 - Math.exp(-dt / tau));
    music.intensity = intensity;
    music.chase = false;
    arenaLayers();
    const theme = getActiveArena()?.L?.theme;
    ambience.set({ wind: 0.55, crackle: theme === 'deep' ? 5 : 2, drip: theme === 'sunken' ? 0.6 : 0.08, debris: 0 });
  } else if (mode === 'corridor') {
    const room = world.room;
    const st = room?.state;
    const col = room?.collapse;
    if (st === 'run' && col?.active && !col.stopped) {
      const gap = Number.isFinite(col.gap) ? col.gap : 20;
      const near = Math.max(0, Math.min(1, (8 - gap) / 6));
      music.chase = true; music.intensity = 0.75;
      setLayers(near > 0.05 ? ['bed', 'drums', 'bass', 'chase', 'alarm'] : ['bed', 'drums', 'bass', 'chase']);
      music.level('alarm', 0.35 + near * 0.65);
      ambience.set({ wind: 0.3, crackle: 1, drip: 0, debris: 0.25 + near * 0.75, debrisPan: Math.max(-0.9, Math.min(0.2, panFor(col.front) * 1.3 - 0.2)) });
    } else if (st === 'intro') {
      music.chase = false; music.intensity = 0.3;
      setLayers(['bed', 'bass']);
      ambience.set({ wind: 0.45, crackle: 1, drip: 0.1, debris: 0.05, debrisPan: -0.7 });
    } else {
      music.chase = false; music.intensity = 0.1;
      setLayers(['bed']);
      ambience.set({ wind: 0.5, crackle: 1, drip: 0.1, debris: 0 });
    }
  } else if (mode === 'boss') {
    const P = bossPhase;
    if (P === 0) music.only(['intro']);
    else if (P === 1) { music.intensity = 0.5; music.only(['organ', 'drums', 'bass', 'bell']); }
    else if (P === 2) { music.intensity = 0.65; music.only(['organ', 'drums', 'bass', 'bell', 'arp', 'choir']); }
    else if (P === 3) { music.intensity = 0.9; music.only(['organ', 'drums', 'bass', 'bell', 'arp', 'choir', 'lead']); }
  }
  ambience.update(dt);
}
setInterval(update, 50);

export const director = {
  get mode() { return mode; },
  enterMode,
  surfaceAt,
  info: () => ({ mode, bossPhase, intensity: +intensity.toFixed(2), activity: +activity.toFixed(2), dead }),
};
