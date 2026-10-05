// ?showcase=audio : the sound board. Every SFX (the audio piece's bank, plus the other pieces'
// voices that now run through the same mixer) and every music stem, with keys to play them, and
// live meters of the master bus: oscilloscope, spectrum, peak / RMS in dBFS, the music duck, and
// the last plays (variant, pitch, gain) so per-play variation can be read off the screen.
//
// Audio starts on the first key press (browser rule). Then:
//   LEFT PANEL (sounds)   A / D or LEFT / RIGHT: group     UP / DOWN (or S): select
//                         J / SPACE / ENTER: play          1..9: play row 1..9 of the group
//                         Q W E R T Y U I O P: play row 10..19 of the group
//                         Z: repeat the selected sound every 0.7 s (to hear the variation)
//                         Every key press counts, even several in one frame (own key queue).
//   RIGHT PANEL (music)   M: next song (TITLE, CRYPT, WARDEN, DIRGE, OFF)
//                         [ / ]: intensity -/+ (CRYPT: layers by intensity; WARDEN: phases)
//                         C: corridor chase on/off   G: alarm (collapse distance) step
//                         L: low health filter on/off   B: boss phase (intro, I, II, III)
//                         X: a telegraph cue now (music ducks and dips at 1.5-4 kHz)
//   TOUR                  V: start / stop the scripted 104 s tour (title -> arena fight -> clear ->
//                         corridor chase -> boss phases -> low health -> death -> game-over dirge)
//
// Params: &tour=1 (start the tour at once; with &t=<seconds> to start part-way)
//         &song=title|crypt|warden|dirge|off  &intensity=0..1  &chase=1  &alarm=0..1  &lowhp=1  &phase=0..3
//         &group=<GROUP>  &play=<bank sound> (repeat it)  &unlock=1 (create the context without a
//         gesture: only for headless capture launched with an autoplay flag)

import { display } from '../core/display.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { drawText, LINE_H } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { audio } from './engine.js';
import { sfx, SFX } from './bank.js';
import { music, SONGS } from './music.js';
import { ambience } from './ambience.js';
import { director, arenaStems, corridorStems, bossStems, TITLE_STEMS, ARENA_LAYERS } from './director.js';
import { combatSfx } from '../combat/sfx.js';
import { enemySfx } from '../enemies/sfx.js';
import { boonSfx } from '../progression/sfx.js';
import { bossSfx } from '../boss/sfx.js';
import { arenaSfx } from '../world/props.js';
import { gauntletSfx } from '../world/traps.js';
import { hudSfx } from '../ui/widgets/sfx.js';

// ---- the rows -------------------------------------------------------------------------------------
const bank = (name, opt) => ({ label: SFX[name].label, src: 'AUDIO', play: () => sfx.play(name, opt), name });
const ext = (label, src, fn) => ({ label, src, play: fn });

function buildGroups() {
  const G = {};
  for (const [name, def] of Object.entries(SFX)) (G[def.group] ??= []).push(bank(name));
  // the ladder: one row per rung
  G.PICKUPS.splice(0, 1, ...Array.from({ length: 9 }, (_, i) => ({ label: `shard ladder rung ${i + 1}`, src: 'AUDIO', play: () => sfx.shard(i) })));
  G.TELLS = [
    ext('husk wind-up', 'ENEMIES', () => enemySfx.windup('husk', 0.5)),
    ext('wisp wind-up', 'ENEMIES', () => enemySfx.windup('wisp', 0.6)),
    ext('brute charge wind-up', 'ENEMIES', () => enemySfx.windup('charge', 0.5)),
    ext('brute slam wind-up', 'ENEMIES', () => enemySfx.windup('slam', 0.6)),
    ext('mite wind-up', 'ENEMIES', () => enemySfx.windup('mite')),
    ext('warden: chain whirl (sweep)', 'BOSS', () => bossSfx.whirl(0.9)),
    ext('warden: chain drawn (lash)', 'BOSS', () => bossSfx.drawback(0.6)),
    ext('warden: armour creak (stomp)', 'BOSS', () => bossSfx.creak(0.5)),
    ext('warden: inhale (leap)', 'BOSS', () => bossSfx.inhale(0.6)),
    ext('warden: keys (summon)', 'BOSS', () => bossSfx.keys()),
    ext('warden: bell (cage)', 'BOSS', () => bossSfx.bell()),
    ext('trap: spikes rattle', 'GAUNTLET', () => gauntletSfx.rattle(1)),
    ext('trap: fire jet hiss', 'GAUNTLET', () => gauntletSfx.hiss(1)),
    ext('dummy: creak', 'COMBAT', () => combatSfx.creak(0.6)),
  ];
  G['ENEMY FX'] = [
    ext('husk swipe', 'ENEMIES', () => enemySfx.swipe()), ext('wisp fire', 'ENEMIES', () => enemySfx.fire()),
    ext('wisp orb pop', 'ENEMIES', () => enemySfx.orbPop()), ext('brute paw', 'ENEMIES', () => enemySfx.paw()),
    ext('brute charge', 'ENEMIES', () => enemySfx.charge()), ext('brute crash', 'ENEMIES', () => enemySfx.crash()),
    ext('brute dizzy', 'ENEMIES', () => enemySfx.dizzy()), ext('brute slam', 'ENEMIES', () => enemySfx.slam()),
    ext('mite bite', 'ENEMIES', () => enemySfx.bite()), ext('mite hop', 'ENEMIES', () => enemySfx.hop()),
    ext('body thud', 'ENEMIES', () => enemySfx.thud(1)), ext('big body thud', 'ENEMIES', () => enemySfx.thud(2)),
    ext('crumble', 'ENEMIES', () => enemySfx.crumble()), ext('dummy whack', 'COMBAT', () => combatSfx.whack()),
  ];
  G.DOORS = [
    ext('arena gate slam', 'ARENAS', () => arenaSfx.slam()), ext('portcullis clank', 'ARENAS', () => arenaSfx.clank(2)),
    ext('exit seal shatters', 'ARENAS', () => arenaSfx.seal()), ext('torch ignites', 'ARENAS', () => arenaSfx.ignite()),
    ext('urn breaks', 'ARENAS', () => arenaSfx.pot()), ext('crate bursts', 'ARENAS', () => arenaSfx.wood(true)),
    ext('bones scatter', 'ARENAS', () => arenaSfx.bones()), ext('blade on iron', 'ARENAS', () => arenaSfx.clink(true)),
    ext('corridor gate slam', 'GAUNTLET', () => gauntletSfx.slam()), ext('collapse boom on gate', 'GAUNTLET', () => gauntletSfx.boom()),
    ext('safe: release chord', 'GAUNTLET', () => gauntletSfx.release()),
  ];
  G.TRAPS = [
    ext('spikes fire', 'GAUNTLET', () => gauntletSfx.spikes(1)), ext('blade whoosh', 'GAUNTLET', () => gauntletSfx.whoosh(1)),
    ext('fire jet roar', 'GAUNTLET', () => gauntletSfx.roar(1)), ext('floor cracks', 'GAUNTLET', () => gauntletSfx.crack(1)),
    ext('floor drops', 'GAUNTLET', () => gauntletSfx.drop(1)), ext('hero falls', 'GAUNTLET', () => gauntletSfx.fall()),
    ext('boulder lands', 'GAUNTLET', () => gauntletSfx.thud(1, true)), ext('the collapse begins', 'GAUNTLET', () => gauntletSfx.quake()),
  ];
  G.BOSS = ['rumble', 'gate', 'ignite', 'rune', 'eyes', 'rise', 'snap', 'roar', 'card', 'sweep', 'lash', 'impact', 'stomp', 'leap', 'land', 'wave', 'yank', 'bars', 'hit', 'stagger', 'break', 'clatter', 'deathHit', 'groan', 'beams', 'burst', 'soul', 'victory']
    .map((k) => ext(`warden: ${k}`, 'BOSS', () => bossSfx[k]()));
  G.BOONS = ['cardLand', 'cardFlip', 'hover', 'select', 'fly', 'gain', 'zap', 'burn', 'crit', 'echo', 'wave', 'starFall', 'starHit', 'wardBlock', 'wardGrow', 'phoenix', 'quake', 'reap', 'mote', 'shrine', 'synergy']
    .map((k) => ext(`boon: ${k}`, 'BOONS', () => (k === 'select' || k === 'gain' ? boonSfx[k]('legendary') : boonSfx[k](1))));
  G.HUD = [ext('heartbeat: lub', 'HUD', () => hudSfx.beat(true)), ext('heartbeat: dub', 'HUD', () => hudSfx.beat(false))];
  const ORDER = ['HERO', 'HITS', 'STEPS', 'ENEMIES', 'TELLS', 'ENEMY FX', 'PICKUPS', 'WORLD', 'DOORS', 'TRAPS', 'BOSS', 'BOONS', 'HUD'];
  return ORDER.filter((k) => G[k]?.length).map((k) => ({ name: k, rows: G[k] }));
}

// ---- the tour -------------------------------------------------------------------------------------
// [time s, label | null, fn]. Sound-only: a fight is "played" by firing the same calls the game makes.
function tourScript() {
  const S = [];
  const at = (t, label, fn) => S.push([t >= 9 ? t + TITLE_EXTRA : t, label, fn]);
  const steps = (t0, t1, every, surface) => { let k = 0; for (let t = t0; t < t1; t += every) { const f = k++ % 2 ? 'R' : 'L'; at(t, null, () => sfx.step(surface, f, { gain: 0.85 })); } };
  // 0: title
  at(0, 'TITLE THEME', () => { setSong('title'); music.only(TITLE_STEMS); ambience.set({ wind: 0.9, crackle: 0, drip: 0.15, debris: 0 }); music.filter('normal'); });
  // 9: arena
  at(9, 'ARENA: THE GATE SEALS', () => { setSong('crypt'); setIntensity(0.1); ambience.set({ wind: 0.55, crackle: 2, drip: 0.1 }); });
  steps(9.2, 11.5, 0.3, 'stone');
  at(11.6, null, () => arenaSfx.slam());
  at(12.6, 'WAVE 1: HUSKS (LAYERS IN)', () => { setIntensity(0.35); sfx.play('husk.spawn', { pan: -0.4 }); });
  at(13.1, null, () => sfx.play('husk.spawn', { pan: 0.4 }));
  steps(13.4, 15, 0.3, 'stone');
  at(15.2, null, () => enemySfx.windup('husk', 0.5));
  at(15.8, null, () => sfx.play('dash'));
  for (const [t, s, p] of [[16.5, 0, 0.7], [16.85, 1, 0.8], [17.3, 2, 1.6]]) { at(t, null, () => sfx.play(['swing.1', 'swing.2', 'swing.3'][s])); at(t + 0.06, null, () => { sfx.hit(p, s === 2); if (s === 2) sfx.play('slam'); }); }
  at(17.4, null, () => sfx.play('husk.hurt', { pan: 0.3 }));
  at(18.2, null, () => { sfx.play('swing.1'); });
  at(18.26, null, () => { sfx.hit(0.8); sfx.play('husk.death', { pan: 0.3 }); sfx.play('kill'); });
  for (let i = 0; i < 6; i++) at(18.7 + i * 0.07, null, () => sfx.shard(i));
  at(19.6, 'WAVE 2: MITES, A WISP, A BRUTE', () => { setIntensity(0.62); sfx.play('mite.spawn', { pan: -0.5 }); sfx.play('wisp.spawn', { pan: 0.5 }); });
  at(20.4, null, () => sfx.play('brute.spawn', { pan: 0.2 }));
  steps(20.2, 22, 0.28, 'stone');
  at(21.2, null, () => enemySfx.windup('wisp', 0.6));
  at(21.8, null, () => enemySfx.fire());
  at(22.1, null, () => sfx.play('dodge'));
  for (let i = 0; i < 4; i++) { at(22.6 + i * 0.35, null, () => sfx.play(i % 2 ? 'swing.2' : 'swing.1')); at(22.66 + i * 0.35, null, () => { sfx.hit(0.7); sfx.play('mite.hurt', { pan: -0.3 }); }); }
  at(24.1, null, () => { sfx.play('mite.death', { pan: -0.3 }); sfx.play('mite.death', { pan: -0.1, delay: 0.09 }); });
  at(24.6, 'BRUTE CHARGES: MUSIC STEPS BACK FOR THE TELL', () => { setIntensity(0.85); enemySfx.windup('charge', 0.5); });
  at(25.2, null, () => enemySfx.charge());
  at(25.8, null, () => enemySfx.crash());
  at(26.3, null, () => sfx.play('hurt'));
  for (const [t, s, p] of [[27, 0, 1.2], [27.35, 1, 1.4], [27.8, 2, 2.4]]) { at(t, null, () => sfx.play(['swing.1', 'swing.2', 'swing.3'][s])); at(t + 0.06, null, () => { sfx.hit(p, s === 2); sfx.play('brute.hurt'); }); }
  at(28.5, null, () => { sfx.play('swing.3'); });
  at(28.56, null, () => { sfx.hit(2.6, true); sfx.play('slam'); sfx.play('brute.death'); setIntensity(0.4); });
  at(29.4, null, () => { sfx.play('wisp.death', { pan: 0.4 }); });
  at(30.2, 'ARENA CLEARED', () => { arenaSfx.clear(); setIntensity(0); });
  at(31.5, null, () => sfx.play('heart'));
  for (let i = 0; i < 5; i++) at(32.2 + i * 0.25, null, () => arenaSfx.clank(i));
  // 34: corridor
  at(34, 'CORRIDOR: THE COLLAPSE BREAKS LOOSE', () => { music.only(corridorStems('intro')); music.chase = false; ambience.set({ wind: 0.4, crackle: 1, drip: 0 }); });
  steps(34.2, 36, 0.3, 'grit');
  at(36, null, () => { gauntletSfx.quake(); music.chase = true; music.intensity = 0.75; music.only(corridorStems('run', 0)); music.level('lead', 0.8); });
  steps(36.4, 46, 0.22, 'grit');
  for (let i = 0; i < 20; i++) at(36.5 + i * 0.5, null, () => { const near = Math.min(1, i / 14); ambience.set({ debris: 0.25 + near * 0.75, debrisPan: -0.7 }); if (i === 4) music.want({ alarm: true }); music.level('alarm', 0.3 + near * 0.7); });
  at(38, 'CHASE: THE ALARM RISES AS THE ROCK CLOSES IN', () => gauntletSfx.rattle(1));
  at(38.6, null, () => gauntletSfx.spikes(1));
  at(39.3, null, () => sfx.play('dash'));
  at(40.2, null, () => gauntletSfx.hiss(1));
  at(40.8, null, () => gauntletSfx.roar(1));
  at(41.6, null, () => gauntletSfx.whoosh(1));
  at(42.4, null, () => gauntletSfx.crack(1));
  at(42.9, null, () => { gauntletSfx.drop(1); sfx.play('dash'); });
  at(44, null, () => gauntletSfx.whoosh(1));
  at(46.2, 'SAFE: THE GATE SLAMS', () => { gauntletSfx.slam(); music.chase = false; music.only(corridorStems('safe')); ambience.set({ debris: 0 }); });
  at(46.9, null, () => gauntletSfx.boom());
  at(47.6, null, () => gauntletSfx.release());
  // 50: boss
  at(50, 'THE WARDEN: INTRO', () => { setSong('warden'); music.level('lead', 1); music.only(bossStems(0)); ambience.set({ wind: 0.5, crackle: 3, drip: 0 }); });
  at(51, null, () => bossSfx.rumble(1.6));
  at(52.5, null, () => bossSfx.eyes());
  at(53.3, null, () => bossSfx.roar());
  at(55, 'PHASE I: THE CHAIN', () => { music.intensity = 0.5; music.only(bossStems(1)); });
  steps(55.2, 57, 0.28, 'stone');
  at(57, null, () => bossSfx.whirl(0.9));
  at(58, null, () => bossSfx.sweep());
  at(58.3, null, () => sfx.play('dodge'));
  for (let i = 0; i < 3; i++) { at(59 + i * 0.35, null, () => sfx.play(['swing.1', 'swing.2', 'swing.3'][i])); at(59.06 + i * 0.35, null, () => { sfx.hit(1 + i * 0.6, i === 2); bossSfx.hit(i === 2); }); }
  at(60.4, 'PHASE II: THE QUAKE', () => { bossSfx.break(); music.intensity = 0.65; music.only(bossStems(2)); });
  at(62, null, () => bossSfx.inhale(0.6));
  at(62.7, null, () => bossSfx.leap());
  at(63.4, null, () => bossSfx.land());
  at(64.2, null, () => sfx.play('hurt'));
  at(65.2, 'PHASE III: THE CAGE', () => { bossSfx.break(); music.intensity = 0.9; music.only(bossStems(3)); });
  at(66.3, null, () => bossSfx.bell());
  at(67.8, null, () => bossSfx.keys());
  at(68.4, 'ONE HEART LEFT: THE MUSIC CLOSES IN', () => { sfx.play('hurt'); music.filter('lowhp'); });
  for (let i = 0; i < 5; i++) { at(68.9 + i * 0.87, null, () => hudSfx.beat(true)); at(69.2 + i * 0.87, null, () => hudSfx.beat(false)); }
  at(70.5, null, () => bossSfx.lash());
  at(71.5, null, () => sfx.play('dodge'));
  at(73.3, 'DEATH', () => { sfx.play('heroDeath'); music.filter('dead'); audio.duck(10, 1.5, 1.5, 0.05); });
  at(73.8, null, () => { music.stop(2.5); sfx.play('deathSting'); });
  at(75.6, 'GAME OVER: "FALLEN"', () => { music.filter('normal'); music.only(['bed', 'bass', 'lead', 'counter', 'harp']); setSong('dirge', true); });
  S.sort((a, b) => a[0] - b[0]);
  return S;
}
const TITLE_EXTRA = 7;   // the title gets 16 s: its arrival, then the theme's first phrase
const TOUR_LEN = 97 + TITLE_EXTRA;
const VIS = 21;   // visible sound rows

// ---- state ------------------------------------------------------------------------------------------
let songIdx = 1;
const SONG_LIST = ['title', 'crypt', 'warden', 'dirge', null];
function setSong(name, restart = false) { songIdx = SONG_LIST.indexOf(name); music.play(name, { restart }); }
function setIntensity(v) {
  music.intensity = v;
  music.only(arenaStems(v, true));
  music.level('lead', 0.62 + 0.38 * Math.min(1, v / 0.8));
}
const ROW_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'];
const ROW_LABEL = '123456789QWERTYUIOP';

export default function audioShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  let groups = buildGroups();
  let gi = 0, ri = 0, scroll = 0;
  let repeat = P('play', null);
  let repeatT = 0;
  let chase = P('chase', '0') === '1';
  let alarm = Math.max(0, Math.min(1, parseFloat(P('alarm', '0')) || 0));
  let lowhp = P('lowhp', '0') === '1';
  let bossP = Math.max(0, Math.min(3, parseInt(P('phase', '1'), 10) || 0));
  let intensity = Math.max(0, Math.min(1, parseFloat(P('intensity', '0.5'))));
  let tour = null;            // { t0, i, label }
  let flash = 0, flashRow = -1;
  let clipT = 0;
  let peakHold = 0, peakHoldT = 0;
  const spec = [];
  const stemHold = {};
  const unlockParam = P('unlock', '0') === '1';
  const startTour = P('tour', '0') === '1';
  const tourAt = parseFloat(P('t', '0')) || 0;
  let started = false;
  // a private key queue: input.ui.key() is a per-frame set, so two quick presses of the same
  // key in one (slow, headless) frame would count once; here every press counts
  const keyQ = [];
  const onKey = (e) => { if (!e.repeat) keyQ.push(e.code); };
  addEventListener('keydown', onKey);

  const g0 = P('group', null);
  if (g0) { const k = groups.findIndex((g) => g.name === g0.toUpperCase()); if (k >= 0) gi = k; }
  const s0 = P('song', 'crypt');
  songIdx = Math.max(0, SONG_LIST.indexOf(s0 === 'off' ? null : s0));

  function applyMusic() {
    const song = SONG_LIST[songIdx];
    music.level('lead', 1);
    if (song === 'crypt') {
      if (chase) {
        music.chase = true; music.intensity = 0.75;
        music.only(corridorStems('run', alarm)); music.level('alarm', 0.35 + alarm * 0.65); music.level('lead', 0.8);
      } else { music.chase = false; setIntensity(intensity); }
    } else if (song === 'title') music.only(TITLE_STEMS);
    else if (song === 'warden') { music.intensity = [0, 0.5, 0.65, 0.9][bossP]; music.only(bossStems(bossP)); }
    else if (song === 'dirge') music.only(['bed', 'bass', 'lead', 'counter', 'harp']);
    music.play(song, { restart: song === 'dirge' });
    music.filter(lowhp ? 'lowhp' : 'normal');
    ambience.set(song === 'title' || song === 'dirge' ? { wind: 0.9, crackle: 0, drip: 0.15, debris: 0 }
      : song === 'warden' ? { wind: 0.5, crackle: 3, drip: 0, debris: 0 }
        : { wind: 0.55, crackle: chase ? 1 : 2, drip: 0.1, debris: chase ? 0.25 + alarm * 0.75 : 0, debrisPan: -0.7 });
  }

  function begin() {
    if (started) return;
    started = true;
    applyMusic();
    if (startTour) tour = { t0: audio.time - tourAt, i: 0, label: '', script: tourScript() };
  }

  function play(row, idx) {
    if (!audio.ctx) return;
    row.play();
    flash = 1; flashRow = idx;
  }

  function stepTour() {
    if (!tour) return;
    const t = audio.time - tour.t0;
    while (tour.i < tour.script.length && tour.script[tour.i][0] <= t) {
      const [, label, fn] = tour.script[tour.i++];
      if (label) tour.label = label;
      try { fn(); } catch (err) { console.error(err); }
    }
    if (t > TOUR_LEN) { tour = { t0: audio.time, i: 0, label: '', script: tourScript() }; }
  }

  return {
    pausable: false,
    enter() {
      world.room = { index: 0, kind: 'showcase', id: 'audio' };
      director.enterMode('board');
      if (unlockParam) audio.ensure(true);
      if (audio.ctx) begin();
    },
    exit() { removeEventListener('keydown', onKey); music.stop(0.5); ambience.set({ wind: 0, crackle: 0, drip: 0, debris: 0 }); },
    tick() {},
    frame(realDt) {
      if (!started && audio.ctx) { begin(); keyQ.length = 0; return; }   // the key that unlocked audio does nothing else
      if (!started) { keyQ.length = 0; return; }
      for (const code of keyQ.splice(0)) {
        const rows = groups[gi].rows;
        const row = ROW_KEYS.indexOf(code);
        if (row >= 0) { if (rows[row]) { ri = row; play(rows[row], row); } continue; }
        switch (code) {
          case 'KeyA': case 'ArrowLeft': gi = (gi + groups.length - 1) % groups.length; ri = 0; scroll = 0; break;
          case 'KeyD': case 'ArrowRight': gi = (gi + 1) % groups.length; ri = 0; scroll = 0; break;
          case 'ArrowUp': ri = (ri + rows.length - 1) % rows.length; break;
          case 'ArrowDown': case 'KeyS': ri = (ri + 1) % rows.length; break;
          case 'KeyJ': case 'Space': case 'Enter': play(rows[ri], ri); break;
          case 'KeyZ': repeat = repeat ? null : rows[ri]; break;
          case 'KeyM': songIdx = (songIdx + 1) % SONG_LIST.length; applyMusic(); break;
          case 'BracketLeft': intensity = Math.max(0, +(intensity - 0.1).toFixed(2)); chase = false; songIdx = 1; applyMusic(); break;
          case 'BracketRight': intensity = Math.min(1, +(intensity + 0.1).toFixed(2)); chase = false; songIdx = 1; applyMusic(); break;
          case 'KeyC': chase = !chase; songIdx = 1; applyMusic(); break;
          case 'KeyG': alarm = alarm >= 1 ? 0 : +(alarm + 0.25).toFixed(2); chase = true; songIdx = 1; applyMusic(); break;
          case 'KeyL': lowhp = !lowhp; music.filter(lowhp ? 'lowhp' : 'normal'); break;
          case 'KeyB': bossP = (bossP + 1) % 4; songIdx = 2; applyMusic(); break;
          case 'KeyX': audio.cue(6, 0.6, 0.5); break;
          case 'KeyV': tour = tour ? null : { t0: audio.time, i: 0, label: '', script: tourScript() }; break;
          default:
        }
      }
      if (ri < scroll) scroll = ri;
      if (ri >= scroll + VIS) scroll = ri - VIS + 1;

      // repeat mode
      if (repeat) {
        repeatT -= realDt;
        if (repeatT <= 0) {
          repeatT = 0.7;
          if (typeof repeat === 'string') sfx.play(repeat); else repeat.play();
        }
      }
      stepTour();
      flash = Math.max(0, flash - realDt * 4);
    },
    render() {},
    ui(g) {
      const W = display.width, H = display.height;
      g.fillStyle = css('night'); g.fillRect(0, 0, W, H);
      // header
      g.fillStyle = css('shadow'); g.fillRect(0, 0, W, 18);
      g.fillStyle = css('ember'); g.fillRect(0, 18, W, 1);
      drawText(g, 'GAUNTLET-RUNNER  SOUND BOARD', 8, 6, 'bone', { shadow: 'ink' });
      const c = audio.ctx;
      const status = !c ? 'AUDIO LOCKED' : `${c.state.toUpperCase()}  ${c.sampleRate} HZ`;
      drawText(g, status, W - 8, 6, c ? 'leaf' : 'rose', { align: 'right', shadow: 'ink' });

      if (!started) {
        const pulse = 0.5 + 0.5 * Math.sin(loop.realTime * 4);
        drawText(g, 'PRESS A KEY TO START AUDIO', W / 2, H / 2 - 10, pulse > 0.5 ? 'gold' : 'flame', { align: 'center', scale: 2, shadow: 'ink' });
        drawText(g, 'browsers only allow sound after a key press or click (not shift alone)', W / 2, H / 2 + 12, 'fog', { align: 'center' });
        return;
      }

      // ---- left: sounds ----
      const LX = 6, LY = 24, LW = 300;
      g.fillStyle = css('shadow'); g.fillRect(LX, LY, LW, 232);
      // group tabs (current, with neighbours)
      const gname = groups[gi].name;
      drawText(g, '<', LX + 4, LY + 4, 'mist');
      drawText(g, `${gname}  ${gi + 1}/${groups.length}`, LX + LW / 2, LY + 4, 'gold', { align: 'center', shadow: 'ink' });
      const owners = [...new Set(groups[gi].rows.map((r) => r.src))];
      drawText(g, `BY ${owners.join(', ')}`, LX + LW / 2, LY + 14, owners.length === 1 && owners[0] === 'AUDIO' ? 'cyan' : 'slate', { align: 'center' });
      drawText(g, '>', LX + LW - 8, LY + 4, 'mist');
      const rows = groups[gi].rows;
      for (let i = 0; i < VIS && scroll + i < rows.length; i++) {
        const idx = scroll + i, r = rows[idx];
        const y = LY + 25 + i * LINE_H + 1;
        const sel = idx === ri;
        if (sel) { g.fillStyle = css('violet'); g.fillRect(LX + 2, y - 1, LW - 4, LINE_H); }
        if (idx === flashRow && flash > 0) { g.fillStyle = css('ember'); g.globalAlpha = flash; g.fillRect(LX + 2, y - 1, 3, LINE_H); g.globalAlpha = 1; }
        drawText(g, ROW_LABEL[idx] ?? ' ', LX + 8, y, 'mist');
        drawText(g, r.label.toUpperCase(), LX + 18, y, sel ? 'white' : 'frost');
        if (owners.length > 1) drawText(g, r.src, LX + LW - 6, y, 'slate', { align: 'right' });
      }
      if (rows.length > VIS) drawText(g, `${scroll + 1}-${Math.min(rows.length, scroll + VIS)} OF ${rows.length}`, LX + LW - 6, LY + 221, 'mist', { align: 'right' });
      drawText(g, repeat ? `REPEATING: ${(typeof repeat === 'string' ? repeat : repeat.label).toUpperCase()}  (Z STOPS)` : 'Z: REPEAT SELECTED', LX + 6, LY + 221, repeat ? 'flame' : 'slate');

      // ---- right: music ----
      const RX = 312, RY = 24, RW = W - RX - 6;
      g.fillStyle = css('shadow'); g.fillRect(RX, RY, RW, 140);
      const mi = music.info();
      const song = mi.song;
      drawText(g, 'MUSIC', RX + 4, RY + 4, 'gold', { shadow: 'ink' });
      drawText(g, song ? `${SONGS[song].title}  ${mi.bpm} BPM  ${mi.section || '-'}  BAR ${(mi.bar ?? 0) + 1}/${mi.bars}` : 'OFF', RX + RW - 4, RY + 4, song ? 'bone' : 'mist', { align: 'right' });
      if (song) {
        const stems = Object.keys(SONGS[song].stems);
        const mt = music.meters();
        stems.forEach((sn, i) => {
          const y = RY + 17 + i * LINE_H;
          const on = (mi.stems[sn] ?? 0) > 0;
          // the meter: live stem RMS on a 36 dB scale, with a slow-falling hold
          const v = mt[sn] ?? 0;
          const k = v > 1e-4 ? Math.max(0, Math.min(1, (20 * Math.log10(v) + 48) / 36)) : 0;
          stemHold[sn] = Math.max(k, (stemHold[sn] ?? 0) - 0.02);
          drawText(g, sn.toUpperCase(), RX + 6, y, on ? 'bone' : 'slate');
          g.fillStyle = css('ink'); g.fillRect(RX + 58, y, 64, 6);
          g.fillStyle = css(sn === 'alarm' || sn === 'chase' ? 'ember' : on ? 'teal' : 'violet');
          g.fillRect(RX + 58, y, Math.round(64 * stemHold[sn]), 6);
          if (on) { g.fillStyle = css('bone'); g.fillRect(RX + 54, y + 2, 2, 2); }
        });
        const iy = RY + 17;
        const lines = [
          ['INTENSITY', `${Math.round(mi.intensity * 100)}%`, '[ ]'],
          ['CHASE', mi.chase ? 'ON' : 'OFF', 'C'],
          ['ALARM', `${Math.round((mi.stems.alarm ?? 0) * 100)}%`, 'G'],
          ['LOW HEALTH', music.filterMode === 'lowhp' ? 'ON' : 'OFF', 'L'],
          ['BOSS PHASE', ['INTRO', 'I', 'II', 'III'][bossP], 'B'],
          ['SONG', 'NEXT', 'M'],
          ['DUCK', 'NOW', 'X'],
          ['TOUR', tour ? 'STOP' : 'START', 'V'],
        ];
        lines.forEach(([a, b, key], i) => {
          const y = iy + i * (LINE_H + 1);
          drawText(g, key, RX + 132, y, 'gold');
          drawText(g, a, RX + 152, y, 'fog');
          drawText(g, b, RX + RW - 6, y, 'bone', { align: 'right' });
        });
        // intensity bar with crypt layer thresholds
        const by = RY + 128, bx = RX + 132, bw = RW - 138;
        g.fillStyle = css('ink'); g.fillRect(bx, by, bw, 5);
        g.fillStyle = css('flame'); g.fillRect(bx, by, Math.round(bw * mi.intensity), 5);
        if (song === 'crypt') for (const [, th] of ARENA_LAYERS) { g.fillStyle = css('bone'); g.fillRect(bx + Math.round(bw * th), by - 2, 1, 9); }
      } else {
        drawText(g, 'M: PLAY A SONG   V: TOUR', RX + 6, RY + 20, 'fog');
      }

      // tour banner
      if (tour) {
        const t = audio.time - tour.t0;
        g.fillStyle = css('plum'); g.fillRect(RX, RY + 144, RW, 18);
        drawText(g, `TOUR ${t.toFixed(1)}S / ${TOUR_LEN}S`, RX + 4, RY + 149, 'gold');
        drawText(g, tour.label, RX + RW - 4, RY + 149, 'white', { align: 'right' });
        g.fillStyle = css('gold'); g.fillRect(RX, RY + 160, Math.round(RW * Math.min(1, t / TOUR_LEN)), 2);
      }

      // ---- last plays (variation is visible here) ----
      const recent = sfx.recent().filter((p) => SFX[p.name]?.bus !== 'amb').slice(-5).reverse();
      const PY = RY + 168;
      g.fillStyle = css('shadow'); g.fillRect(RX, PY, RW, 62);
      drawText(g, 'LAST PLAYS   VARIANT  PITCH  GAIN', RX + 4, PY + 3, 'mist');
      recent.forEach((p, i) => {
        const y = PY + 13 + i * LINE_H;
        drawText(g, p.name.toUpperCase(), RX + 4, y, i === 0 ? 'bone' : 'fog');
        drawText(g, `V${p.v + 1}`, RX + 128, y, 'cyan');
        drawText(g, `x${p.rate.toFixed(3)}`, RX + 160, y, 'frost');
        drawText(g, p.gain.toFixed(2), RX + 205, y, 'frost');
      });

      // ---- bottom: scope, spectrum, meters ----
      const m = audio.meter();
      const BY = 262, BH = H - BY - 6;
      g.fillStyle = css('shadow'); g.fillRect(6, BY, W - 12, BH);
      // oscilloscope
      const SW = 220, SX = 10;
      g.fillStyle = css('ink'); g.fillRect(SX, BY + 12, SW, BH - 16);
      g.fillStyle = css('dusk'); g.fillRect(SX, BY + 12 + Math.floor((BH - 16) / 2), SW, 1);
      drawText(g, 'MASTER BUS', SX, BY + 3, 'mist');
      if (m.wave) {
        // trigger on a rising zero crossing so the trace stands still
        let start = 0;
        for (let i = 1; i < m.wave.length - SW * 2; i++) if (m.wave[i - 1] < 0 && m.wave[i] >= 0) { start = i; break; }
        g.fillStyle = css('cyan');
        const mid = BY + 12 + (BH - 16) / 2, amp = (BH - 18) / 2;
        let py = mid;
        for (let x = 0; x < SW; x++) {
          const v = m.wave[start + x * 2] ?? 0;
          const y = Math.round(mid - Math.max(-1, Math.min(1, v)) * amp);
          const y0 = Math.min(py, y), y1 = Math.max(py, y);
          g.fillRect(SX + x, y0, 1, y1 - y0 + 1);
          py = y;
        }
      }
      // spectrum (log frequency, 48 bars)
      const QX = SX + SW + 8, QW = 250;
      drawText(g, 'SPECTRUM 40 HZ - 16 KHZ', QX, BY + 3, 'mist');
      g.fillStyle = css('ink'); g.fillRect(QX, BY + 12, QW, BH - 16);
      if (m.spec && c) {
        const N = 48, bw = Math.floor(QW / N);
        const ny = c.sampleRate / 2;
        for (let b = 0; b < N; b++) {
          const f0 = 40 * Math.pow(16000 / 40, b / N), f1 = 40 * Math.pow(16000 / 40, (b + 1) / N);
          const i0 = Math.floor(f0 / ny * m.spec.length), i1 = Math.max(i0 + 1, Math.floor(f1 / ny * m.spec.length));
          let v = 0;
          for (let i = i0; i < i1; i++) v = Math.max(v, m.spec[i]);
          spec[b] = Math.max(v / 255, (spec[b] ?? 0) - 0.03);
          const h = Math.round(spec[b] * (BH - 18));
          g.fillStyle = css(b < 10 ? 'teal' : b < 30 ? 'cyan' : 'sky');
          g.fillRect(QX + b * bw + 1, BY + 12 + (BH - 16) - h, bw - 1, h);
        }
      }
      // peak / rms meter
      const MX = QX + QW + 8, MW = W - 12 - MX;
      const db = (v) => (v > 1e-5 ? 20 * Math.log10(v) : -99);
      if (m.peak > peakHold || loop.realTime - peakHoldT > 1.2) { peakHold = m.peak; peakHoldT = loop.realTime; }
      if (m.peak >= 0.999) clipT = loop.realTime;
      const bar = (y, v, col) => { const k = Math.max(0, Math.min(1, (db(v) + 48) / 48)); g.fillStyle = css('ink'); g.fillRect(MX, y, MW - 4, 6); g.fillStyle = css(col); g.fillRect(MX, y, Math.round((MW - 4) * k), 6); };
      drawText(g, 'PEAK', MX, BY + 3, 'mist'); drawText(g, `${db(peakHold).toFixed(1)} DB`, MX + MW - 4, BY + 3, 'bone', { align: 'right' });
      bar(BY + 12, m.peak, m.peak > 0.9 ? 'red' : 'leaf');
      drawText(g, 'RMS', MX, BY + 22, 'mist'); drawText(g, `${db(m.rms).toFixed(1)} DB`, MX + MW - 4, BY + 22, 'bone', { align: 'right' });
      bar(BY + 31, m.rms, 'gold');
      const duck = (audio.graph?.musicDuck.gain.value ?? 1) * Math.pow(10, (audio.graph?.musicCue.gain.value ?? 0) / 40);
      drawText(g, 'MUSIC DUCK', MX, BY + 41, 'mist'); drawText(g, `${db(duck).toFixed(1)} DB`, MX + MW - 4, BY + 41, duck < 0.95 ? 'flame' : 'bone', { align: 'right' });
      g.fillStyle = css('ink'); g.fillRect(MX, BY + 50, MW - 4, 4);
      g.fillStyle = css('flame'); g.fillRect(MX, BY + 50, Math.round((MW - 4) * (1 - duck)), 4);
      drawText(g, loop.realTime - clipT < 1.5 ? 'CLIP' : 'NO CLIP', MX, BY + 59, loop.realTime - clipT < 1.5 ? 'red' : 'moss');
    },
    state() { return { audio: { started, group: groups[gi].name, row: ri, tour: tour ? +(audio.time - tour.t0).toFixed(1) : null, music: music.info() } }; },
  };
}
