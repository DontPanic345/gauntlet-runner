// ?showcase=audio : the sound board. Every SFX in the game (this piece's own, and the other
// pieces' stand-ins, all now sharing this piece's mixer) listed and playable by key, plus the
// four music tracks with a live intensity slider, and a meter + scope reading the master bus.
//
// This is also the piece a critic drives while recording the master bus (MediaStreamDestination
// + MediaRecorder, per PROTOCOL.md "Blind comparison rules: Audio") — `window.__GR.debug.audio
// .stream()` returns that MediaStream directly, so a script never needs to find it.
//
// Keys:  Up/Down   move the list selection (playing each entry as you pass it)
//        Left/Right   jump to the previous/next section header
//        Enter (confirm)   replay the selected sound
//        1-4       start a music track (title, field, chase, boss)
//        [ / ]     lower / raise that track's target intensity
//        X         stop the music                    S     sting (name-card style silence+slam)
//        D         demo a music duck (telegraph clarity)   F     toggle a muffle demo
// Params: &sel=<n>  start on entry n     &hud=0  hide the legend (clean stills)
//         &auto=1   auto-advance through the list on a timer (for an unattended capture)

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { buildStage } from '../core/stage.js';
import { drawText, textWidth, wrapText, LINE_H } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { mixer } from './mixer.js';
import { music } from './music.js';
import { bank } from './bank.js';
import { combatSfx } from '../combat/sfx.js';
import { boonSfx } from '../progression/sfx.js';
import '../enemies/sfx.js';   // event-driven only: importing registers its listeners
import '../boss/sfx.js';
import '../world/arena.js';   // arenaSfx: same (also defines Arena, unused here)
import '../world/corridor.js'; // gauntletSfx: same

const KINDS = ['husk', 'wisp', 'brute', 'mite'];
const TRACK_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const TRACK_NAMES = ['title', 'field', 'chase', 'boss'];
const TRACK_LABELS = { title: 'TITLE THEME', field: 'FIELD / COMBAT', chase: 'GAUNTLET CHASE', boss: 'THE WARDEN' };

function withRoom(kind, fn) {
  const prev = world.room;
  world.room = { kind };
  fn();
  world.room = prev;
}

function buildEntries() {
  const E = [];
  const sec = (name) => E.push({ header: name });
  const add = (label, fn) => E.push({ label, fn });

  sec('COMBAT');
  add('Swing - light', () => combatSfx.swing(0));
  add('Swing - heavy', () => combatSfx.swing(1));
  add('Swing - overhead', () => combatSfx.swing(2));
  add('Hit - light', () => combatSfx.hit(1, false));
  add('Hit - heavy', () => combatSfx.hit(2, false));
  add('Hit - finisher', () => combatSfx.hit(2.4, true));
  add('Overhead slam', () => combatSfx.slam());
  add('Hero hurt', () => combatSfx.hurt());
  add('Dodge', () => combatSfx.dodge());
  add('Enemy windup creak', () => combatSfx.creak(0.6));
  add('Enemy whack', () => combatSfx.whack());

  sec('ENEMIES');
  add('Spawn pop', () => events.emit('enemy:pop', {}));
  for (const k of KINDS) add(`Windup - ${k}`, () => events.emit('enemy:windup', { kind: k }));
  for (const k of KINDS) add(`Attack - ${k}`, () => events.emit('enemy:attack', { kind: k }));
  add('Hurt', () => events.emit('enemy:hurt', {}));
  for (const k of KINDS) add(`Die - ${k}`, () => events.emit('enemy:die', { kind: k }));
  add('Flop (brute lands)', () => events.emit('enemy:flop', {}));
  add('Paw (brute tell)', () => events.emit('enemy:paw', {}));
  add('Wall stun (brute)', () => events.emit('enemy:wallStun', {}));
  add('Orb burst (wisp)', () => events.emit('enemy:orbBurst', {}));

  sec('BOSS: THE WARDEN');
  add('Idle beat', () => events.emit('boss:beat', {}));
  add('Heavy step', () => events.emit('boss:step', {}));
  add('Eyes ignite', () => events.emit('boss:eyes', {}));
  add('Roar - small', () => events.emit('boss:roar', { big: false }));
  add('Roar - big', () => events.emit('boss:roar', { big: true }));
  for (const a of ['sweep', 'lash', 'slam', 'leap', 'summon']) add(`Windup - ${a}`, () => events.emit('boss:windup', { attack: a }));
  for (const a of ['sweepGo', 'lash', 'slam', 'leap']) add(`Attack - ${a}`, () => events.emit('boss:attack', { attack: a }));
  add('Sweep pass', () => events.emit('boss:sweepPass', {}));
  add('Sweep end', () => events.emit('boss:sweepEnd', {}));
  add('Chain lash hit', () => events.emit('boss:lashHit', {}));
  add('Ground slam', () => events.emit('boss:slam', {}));
  add('Landing', () => events.emit('boss:land', {}));
  add('Chain ring', () => events.emit('boss:ring', {}));
  add('Summon', () => events.emit('boss:summon', {}));
  add('Hurt - normal', () => events.emit('boss:hurt', { armored: false }));
  add('Hurt - armored', () => events.emit('boss:hurt', { armored: true }));
  add('Clang (blocked)', () => events.emit('boss:clang', {}));
  add('Crit', () => events.emit('boss:crit', {}));
  add('Punish window', () => events.emit('boss:punish', {}));
  add('Stagger', () => events.emit('boss:stagger', {}));
  add('Phase transition', () => events.emit('boss:phase', { to: 2 }));
  add('Armor cracks', () => events.emit('boss:crack', {}));
  add('Chain reel', () => events.emit('boss:reel', {}));
  add('Cage rises', () => events.emit('boss:cage', {}));
  add('Hero hit landed', () => events.emit('boss:heroHit', {}));
  add('Death hit', () => events.emit('boss:deathHit', {}));
  add('Death beat', () => events.emit('boss:deathBeat', {}));
  add('Death burst', () => events.emit('boss:deathBurst', {}));
  add('Defeated fanfare', () => events.emit('boss:defeated', {}));
  add('Name card sting', () => events.emit('boss:nameCard', {}));
  add('Bar fill tick', () => events.emit('boss:barFill', {}));

  sec('PICKUPS & BOONS');
  add('Shard drop', () => boonSfx.drop());
  add('Shard ladder - low step', () => boonSfx.shard(1));
  add('Shard ladder - top step', () => boonSfx.shard(8));
  add('Heart pickup', () => boonSfx.heart());
  add('Shrine slides open', () => boonSfx.slide());
  add('Shrine card hover', () => boonSfx.hover());
  for (const r of ['common', 'rare', 'epic']) add(`Card flip - ${r}`, () => boonSfx.flip(r));
  for (const r of ['common', 'rare', 'epic']) add(`Boon select - ${r}`, () => boonSfx.select(r));
  add('Reroll', () => boonSfx.reroll());
  add("Denied (can't afford)", () => boonSfx.denied());
  add('Acquire jingle', () => boonSfx.acquire('rare'));
  add('Boon fx: zap', () => boonSfx.zap());
  add('Boon fx: fire', () => boonSfx.fire());
  add('Boon fx: wave', () => boonSfx.wave());
  add('Boon fx: thunder', () => boonSfx.thunder());
  add('Boon fx: boom', () => boonSfx.boom(1.5));
  add('Boon fx: blade', () => boonSfx.blade());
  add('Boon fx: glass', () => boonSfx.glass());
  add('Boon fx: shield', () => boonSfx.shield());
  add('Boon fx: phoenix', () => boonSfx.phoenix());
  add('Boon fx: haste', () => boonSfx.haste());
  add('Boon fx: crit', () => boonSfx.crit());

  sec('DOORS & ARENA');
  add('Gate seals', () => events.emit('arena:seal', {}));
  add('Gate slams shut', () => events.emit('arena:slam', {}));
  add('Wave horn', () => events.emit('arena:wave', {}));
  add('Room clear chime', () => events.emit('arena:clear', {}));
  add('Exit slab rises', () => events.emit('arena:slabRise', {}));
  add('Exit opens', () => events.emit('arena:exitOpen', {}));
  add('Prop hit - brazier', () => events.emit('arena:propHit', { kind: 'brazier' }));
  add('Prop hit - crate', () => events.emit('arena:propHit', { kind: 'crate' }));
  add('Prop break', () => events.emit('arena:propBreak', {}));

  sec('GAUNTLET (THE COLLAPSE)');
  add('Spike trap - warn', () => events.emit('gauntlet:trap', { kind: 'spikes', phase: 'warn' }));
  add('Spike trap - live', () => events.emit('gauntlet:trap', { kind: 'spikes', phase: 'live' }));
  add('Fire jet - warn', () => events.emit('gauntlet:trap', { kind: 'jet', phase: 'warn' }));
  add('Fire jet - live', () => events.emit('gauntlet:trap', { kind: 'jet', phase: 'live' }));
  add('Crumbling tile - warn', () => events.emit('gauntlet:trap', { kind: 'tile', phase: 'warn' }));
  add('Crumbling tile - falls', () => events.emit('gauntlet:trap', { kind: 'tile', phase: 'live' }));
  add('Swinging blade whoosh', () => events.emit('gauntlet:whoosh', {}));
  add('Trap hit', () => events.emit('gauntlet:trapHit', {}));
  add('Trap dodge', () => events.emit('gauntlet:dodge', {}));
  add('Fall (pit)', () => events.emit('gauntlet:fall', {}));
  add('Collapse begins ("RUN!")', () => events.emit('gauntlet:go', {}));
  add('Gate slams (escape)', () => events.emit('gauntlet:slam', {}));
  add('Collapse crashes into gate', () => events.emit('gauntlet:collapseSlam', {}));
  add('Escape release fanfare', () => events.emit('gauntlet:release', {}));
  add('Caught by the collapse', () => events.emit('gauntlet:catch', {}));

  sec('AUDIO: FOOTSTEPS, DASH, BARKS');
  add('Footstep - arena stone', () => withRoom('arena', () => bank.footstep(1)));
  add('Footstep - gauntlet rubble', () => withRoom('corridor', () => bank.footstep(1)));
  add('Footstep - boss floor', () => withRoom('boss', () => bank.footstep(1)));
  add('Dash whoosh', () => bank.dash(1));
  for (const k of KINDS) add(`Bark - ${k}`, () => bank.bark(k));

  return E;
}

export default function audioShowcase(params) {
  const hud = params.get('hud') !== '0';
  const auto = params.get('auto') === '1';
  const ENTRIES = buildEntries();
  let sel = Math.max(0, Math.min(ENTRIES.length - 1, parseInt(params.get('sel') ?? '', 10) || 1));
  while (ENTRIES[sel]?.header) sel = (sel + 1) % ENTRIES.length;
  let scrollTop = 0;
  let flashUntil = -1;
  let autoT = 0;
  let root, stage;
  let musicIntensity = { title: 0.5, field: 0.3, chase: 0.3, boss: 0.3 };
  let demoMuffle = false;

  function playSel(i) {
    sel = i; flashUntil = loop.realTime + 0.12;
    ENTRIES[sel]?.fn?.();
  }
  function moveSel(dir) {
    let i = sel;
    for (let n = 0; n < ENTRIES.length; n++) { i = (i + dir + ENTRIES.length) % ENTRIES.length; if (!ENTRIES[i].header) break; }
    playSel(i);
  }
  function jumpSection(dir) {
    let i = sel;
    for (let n = 0; n < ENTRIES.length; n++) {
      i = (i + dir + ENTRIES.length) % ENTRIES.length;
      if (ENTRIES[i].header) { let j = i; while (ENTRIES[j]?.header) j = (j + 1) % ENTRIES.length; playSel(j); return; }
    }
  }

  return {
    enter(data, r) {
      root = r;
      stage = buildStage(root, { torches: [[-2.6, -2.2], [2.6, -2.2]] });
      display.setZoom(2);
      display.setCameraTarget(0, 1.1, 0);
    },
    exit() {},
    tick() {
      stage.tick();
      if (auto) {
        autoT++;
        if (autoT % 40 === 0) moveSel(1);
      }
    },
    render(alpha) { stage.render(alpha); },
    ui(g) {
      const W = display.width, H = display.height;
      const headerH = 20, footerH = hud ? 18 : 0;
      const leftW = Math.round(W * 0.6);
      const rightX = leftW + 8, rightW = W - leftW - 12;

      g.fillStyle = 'rgba(11,10,18,0.72)';
      g.fillRect(0, 0, W, H);

      drawText(g, 'AUDIO', 6, 5, 'gold', { shadow: 'ink', scale: 2 });
      drawText(g, 'SOUND BOARD: SFX + MUSIC', 6 + textWidth('AUDIO', 2) + 8, 9, 'frost', { shadow: 'ink' });
      const state = mixer.state();
      const readout = state.running ? `${state.sampleRate} HZ${state.muffled ? '  MUFFLED' : ''}` : 'CLICK OR PRESS A KEY';
      drawText(g, readout, W - 6, 7, state.running ? 'leaf' : 'ember', { shadow: 'ink', align: 'right' });

      // ---- left: the scrollable list --------------------------------------------------
      const listY = headerH + 4, listH = H - listY - footerH - 2;
      const visibleRows = Math.max(1, Math.floor(listH / LINE_H));
      if (sel < scrollTop + 2) scrollTop = Math.max(0, sel - 2);
      if (sel > scrollTop + visibleRows - 3) scrollTop = Math.min(Math.max(0, ENTRIES.length - visibleRows), sel - visibleRows + 3);

      g.fillStyle = css('shadow'); g.fillRect(4, listY - 2, leftW - 8, listH + 4);
      for (let row = 0; row < visibleRows; row++) {
        const idx = scrollTop + row;
        const e = ENTRIES[idx];
        if (!e) break;
        const y = listY + row * LINE_H;
        if (e.header) { drawText(g, e.header, 8, y, 'ember', { shadow: 'ink' }); continue; }
        const isSel = idx === sel;
        if (isSel) { g.fillStyle = loop.realTime < flashUntil ? css('gold') : 'rgba(191,198,220,0.18)'; g.fillRect(6, y - 1, leftW - 12, LINE_H); }
        drawText(g, (isSel ? '• ' : '  ') + e.label, 8, y, isSel && loop.realTime < flashUntil ? 'ink' : 'bone');
      }

      // ---- right: music panel -----------------------------------------------------------
      let ry = headerH + 4;
      drawText(g, 'MUSIC', rightX, ry, 'ember', { shadow: 'ink' }); ry += LINE_H + 2;
      for (let t = 0; t < TRACK_NAMES.length; t++) {
        const name = TRACK_NAMES[t];
        const on = music.trackName === name;
        drawText(g, `${t + 1} ${TRACK_LABELS[name]}`, rightX, ry, on ? 'gold' : 'frost', { shadow: on ? 'ink' : null });
        ry += LINE_H;
      }
      ry += 2;
      const curTrack = music.trackName;
      const iv = curTrack ? musicIntensity[curTrack] ?? 0 : 0;
      drawText(g, `TRACK  ${curTrack ? TRACK_LABELS[curTrack] : '-'}`, rightX, ry, 'bone'); ry += LINE_H;
      drawText(g, `DIAL   [${'#'.repeat(Math.round(iv * 10)).padEnd(10, '.')}] ${iv.toFixed(2)}`, rightX, ry, 'sky'); ry += LINE_H;
      drawText(g, `ACTUAL [${'#'.repeat(Math.round(music.intensity * 10)).padEnd(10, '.')}] ${music.intensity.toFixed(2)}`, rightX, ry, 'leaf'); ry += LINE_H + 4;

      // ---- meter + scope ------------------------------------------------------------------
      drawText(g, 'MASTER BUS', rightX, ry, 'ember', { shadow: 'ink' }); ry += LINE_H + 2;
      const m = mixer.meter();
      const meterW = rightW - 4, meterH = 8;
      g.fillStyle = css('ink'); g.fillRect(rightX, ry, meterW, meterH);
      g.fillStyle = m.level > 0.85 ? css('rose') : css('leaf');
      g.fillRect(rightX, ry, Math.round(meterW * Math.min(1, m.level * 1.4)), meterH);
      ry += meterH + 4;
      const wf = mixer.waveform();
      const scopeH = 26;
      g.fillStyle = css('ink'); g.fillRect(rightX, ry, meterW, scopeH);
      if (wf) {
        g.strokeStyle = css('cyan'); g.lineWidth = 1; g.beginPath();
        const n = wf.length, step = Math.max(1, Math.floor(n / meterW));
        for (let x = 0; x * step < n; x++) {
          const v = wf[x * step] / 255;
          const py = ry + (1 - v) * scopeH;
          if (x === 0) g.moveTo(rightX + x, py); else g.lineTo(rightX + x, py);
        }
        g.stroke();
      }
      ry += scopeH + 6;

      if (hud) {
        const legend = [
          'UP/DN SELECT   L/R SECTION',
          'ENTER REPLAY   1-4 TRACK',
          '[ ] INTENSITY   X STOP',
          'S STING   D DUCK   F MUFFLE',
        ];
        for (const line of legend) { drawText(g, line, rightX, ry, 'fog'); ry += LINE_H; }
      }

      if (!hud) return;
      drawText(g, 'PRESS ENTER TO REPLAY THE SELECTED SOUND', 6, H - footerH + 4, 'mist');
    },
    frame() {
      if (input.ui.pressed('up')) moveSel(-1);
      if (input.ui.pressed('down')) moveSel(1);
      if (input.ui.pressed('left')) jumpSection(-1);
      if (input.ui.pressed('right')) jumpSection(1);
      if (input.ui.pressed('confirm')) playSel(sel);
      for (let t = 0; t < TRACK_KEYS.length; t++) {
        if (input.ui.key(TRACK_KEYS[t])) music.play(TRACK_NAMES[t], { intensity: musicIntensity[TRACK_NAMES[t]], manual: true });
      }
      if (input.ui.key('BracketLeft') && music.trackName) { musicIntensity[music.trackName] = Math.max(0, musicIntensity[music.trackName] - 0.1); music.setIntensity(musicIntensity[music.trackName], { manual: true }); }
      if (input.ui.key('BracketRight') && music.trackName) { musicIntensity[music.trackName] = Math.min(1, musicIntensity[music.trackName] + 0.1); music.setIntensity(musicIntensity[music.trackName], { manual: true }); }
      if (input.ui.key('KeyX')) music.stop();
      if (input.ui.key('KeyS')) music.sting(700);
      if (input.ui.key('KeyD')) mixer.duckMusic(0.35, 350);
      if (input.ui.key('KeyF')) { demoMuffle = !demoMuffle; mixer.muffleMusic(demoMuffle); }
    },
  };
}
