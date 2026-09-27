// The music engine (piece `audio`): four tracks, each a small set of 16th-note step patterns
// ("layers") gated by a continuous 0..1 intensity so the arrangement thickens and thins instead
// of switching tracks. A standard lookahead scheduler (setInterval polling `ctx.currentTime`,
// scheduling ~120ms ahead) keeps timing sample-accurate without depending on the render loop.
//
//   import { music } from './audio/music.js';   // importing it is enough: it listens to events
//   music.play('title' | 'field' | 'chase' | 'boss', { intensity: 0..1 })
//   music.setIntensity(0..1)   music.sting(ms)   music.stop()
//
// Tracks (see TRACKS below for what each layer is):
//   title  – the menu: a slow pad and a sparse bell line, no intensity reactivity
//   field  – arena traversal and combat: bass+hats always on; kick, a lead riff, and an
//            accent layer join as `arena:*`/`combat:hit` push the intensity up
//   chase  – the gauntlet corridor: driven continuously by `chase.level` (world/collapse.js),
//            the same 0..1 the collapse's own visuals and shake use
//   boss   – The Warden: a layer per phase, switched by `boss:phase`
//
// Reacts to game state (GAME.md "Sound" / pieces.json must_have):
//   combat intensity  – `combat:hit`/`enemy:die` bump a decaying "heat" that drives `field`
//   chase             – `chase.level` every tick, while the `chase` track is playing
//   low health        – `hud:heartbeat` (already gated to low hp by the `hud` piece) muffles the
//                        music and adds a synced sub-bass thump; clears ~1.4s after the last beat
//   telegraphs        – `enemy:windup`/`boss:windup` duck the music briefly so the cue (played by
//                        the enemies/boss stand-in sfx) cuts through, per the "mix is balanced"
//                        must_have
//   pause             – muffled (not stopped): the crypt keeps breathing behind the menu

import { events } from '../core/events.js';
import { musicContext, musicVol, tone, noise, makeNoiseBuffer, duckMusic, muffleMusic } from './mixer.js';
import { chase } from '../world/collapse.js';

const STEPS = 16;
const LOOKAHEAD = 0.12;
const INTERVAL_MS = 25;

// A minor (field/title) and A phrygian (chase/boss, the flatted 2nd for menace) off A2 = 110Hz.
const A_MIN = [110, 123.47, 130.81, 146.83, 164.81, 174.61, 196, 220];
const A_PHR = [110, 116.54, 130.81, 146.83, 164.81, 174.61, 196, 220];
const deg = (scale, i, oct = 0) => scale[((i % scale.length) + scale.length) % scale.length] * 2 ** (oct + Math.floor(i / scale.length));

let nb = null;
function noiseBuf(c) { if (!nb || nb.c !== c) nb = { c, buf: makeNoiseBuffer(c, 909, 2) }; return nb.buf; }

// ---- instruments: each schedules one voice at time `t` into `out` --------------------------
const kick = (c, out, t, vel = 1) => tone(c, out, t, 0.16, { type: 'sine', f0: 150, f1: 44, gain: 0.42 * vel * musicVol(), attack: 0.002 });
const hat = (c, out, t, vel = 1, open = false) => noise(c, out, noiseBuf(c), t, open ? 0.11 : 0.032, { type: 'highpass', f0: 6200, gain: 0.13 * vel * musicVol(), attack: 0.001 });
const bass = (c, out, t, f, dur, vel = 1) => tone(c, out, t, dur, { type: 'sawtooth', f0: f, f1: f * 0.996, gain: 0.2 * vel * musicVol(), attack: 0.008 });
const lead = (c, out, t, f, dur, vel = 1, type = 'triangle') => tone(c, out, t, dur, { type, f0: f, f1: f, gain: 0.13 * vel * musicVol(), attack: 0.006 });
const pad = (c, out, t, f, dur, vel = 1) => {
  tone(c, out, t, dur, { type: 'sine', f0: f, f1: f, gain: 0.1 * vel * musicVol(), attack: 0.3 });
  tone(c, out, t, dur, { type: 'triangle', f0: f * 2, f1: f * 2, gain: 0.03 * vel * musicVol(), attack: 0.35 });
};
const stab = (c, out, t, f, vel = 1) => tone(c, out, t, 0.15, { type: 'square', f0: f, f1: f * 0.985, gain: 0.11 * vel * musicVol(), attack: 0.002 });
const boomLow = (c, out, t, vel = 1) => {
  tone(c, out, t, 0.5, { type: 'sine', f0: 64, f1: 28, gain: 0.36 * vel * musicVol(), attack: 0.01 });
  noise(c, out, noiseBuf(c), t, 0.4, { type: 'lowpass', f0: 900, f1: 90, gain: 0.18 * vel * musicVol(), attack: 0.01 });
};
const shaker = (c, out, t, vel = 1) => noise(c, out, noiseBuf(c), t, 0.05, { type: 'bandpass', f0: 4000, f1: 5500, q: 1.5, gain: 0.09 * vel * musicVol(), attack: 0.001 });

// ---- tracks ----------------------------------------------------------------------------------
const TRACKS = {
  title: {
    bpm: 70,
    layers: [
      { min: 0, bar: (c, out, t, step, bar) => {
        if (step === 0) pad(c, out, t, deg(A_MIN, 0, -1), 60 / 70 * 4.2, 0.55);
        if (step === 8) pad(c, out, t, deg(A_MIN, 2, -1), 60 / 70 * 4.2, 0.4);
        if (bar % 2 === 1 && [2, 6, 11].includes(step)) lead(c, out, t, deg(A_MIN, 4 + Math.floor(step / 4), 0), 60 / 70 * 0.9, 0.4, 'sine');
      } },
    ],
  },
  field: {
    bpm: 128,
    layers: [
      { min: 0, bar: (c, out, t, step) => {
        if (step % 4 === 0) bass(c, out, t, deg(A_MIN, 0, -1), 60 / 128 * 0.9, 0.65);
        if (step % 2 === 0) hat(c, out, t, step % 8 === 0 ? 0.85 : 0.45);
      } },
      { min: 0.28, bar: (c, out, t, step) => { if ([0, 3, 6, 10].includes(step)) kick(c, out, t, 0.75); } },
      { min: 0.55, bar: (c, out, t, step, bar) => { if ([2, 7, 11, 14].includes(step)) stab(c, out, t, deg(A_MIN, 3 + bar % 3, 0), 0.65); } },
      { min: 0.8, bar: (c, out, t, step) => { if (step % 2 === 1) hat(c, out, t, 0.55, true); if (step === 12) boomLow(c, out, t, 0.55); } },
    ],
  },
  chase: {
    bpm: 152,
    layers: [
      { min: 0, bar: (c, out, t, step) => { if (step % 4 === 0) bass(c, out, t, deg(A_PHR, 0, -1), 60 / 152 * 0.7, 0.6); } },
      { min: 0.15, bar: (c, out, t, step) => shaker(c, out, t, step % 2 === 0 ? 0.5 : 0.3) },
      { min: 0.4, bar: (c, out, t, step) => { if ([0, 4, 8, 12].includes(step)) kick(c, out, t, 0.8); } },
      { min: 0.65, bar: (c, out, t, step) => { if ([2, 6, 10, 14].includes(step)) hat(c, out, t, 0.5); } },
      { min: 0.85, bar: (c, out, t, step, bar) => { if ([2, 10].includes(step)) stab(c, out, t, deg(A_PHR, 5 + bar % 2, 0), 0.6); } },
    ],
  },
  boss: {
    bpm: 140,
    layers: [
      { min: 0, bar: (c, out, t, step, bar) => {
        if (step === 0) boomLow(c, out, t, 0.8);
        if (step === 8) boomLow(c, out, t, 0.5);
        if (step === 4 && bar % 2 === 1) lead(c, out, t, deg(A_PHR, 1, -1), 60 / 140 * 1.2, 0.4, 'sawtooth');
      } },
      { min: 0.3, bar: (c, out, t, step) => { if (step % 4 === 2) bass(c, out, t, deg(A_PHR, 0, -1), 60 / 140 * 0.55, 0.55); } },
      { min: 0.6, bar: (c, out, t, step) => { if ([0, 3, 6, 9, 12, 14].includes(step)) kick(c, out, t, 0.65); } },
      { min: 0.85, bar: (c, out, t, step, bar) => { if ([2, 6, 10, 14].includes(step)) stab(c, out, t, deg(A_PHR, 6 + bar % 2, 0), 0.5); } },
    ],
  },
};

class MusicEngine {
  constructor() {
    this.trackName = null;
    this.pendingTrack = null;
    this.intensity = 0;
    this.target = 0;
    this.stepIndex = 0;
    this.bar = 0;
    this.nextTime = 0;
    this.mutedUntil = 0;
    this.timer = null;
    this.lastCtx = null;
    this.manual = false; // true once something (the showcase) has hand-set intensity
  }
  _ensure() {
    const m = musicContext();
    if (!m) return null;
    if (m.ctx !== this.lastCtx) { this.lastCtx = m.ctx; this.nextTime = m.ctx.currentTime + 0.05; this.stepIndex = 0; this.bar = 0; }
    if (!this.timer) this.timer = setInterval(() => this._schedule(), INTERVAL_MS);
    return m;
  }
  /** Switch (or start) a track. Mid-track it waits for the next bar so the seam is clean.
   *  `manual: true` (the showcase's keys) latches out the reactive intensity driver below, so a
   *  hand-picked demo level sticks instead of being overwritten on the next tick. */
  play(name, { intensity, manual } = {}) {
    if (!TRACKS[name]) return;
    this._ensure();
    if (this.trackName === name) this.pendingTrack = null;
    else if (this.trackName === null) { this.trackName = name; this.stepIndex = 0; this.bar = 0; this.pendingTrack = null; }
    else this.pendingTrack = name;
    if (manual) this.manual = true;
    if (intensity != null) this.target = Math.max(0, Math.min(1, intensity));
  }
  setIntensity(v, { manual } = {}) { if (manual) this.manual = true; this.target = Math.max(0, Math.min(1, v)); }
  /** Cinematic beat: go quiet, then the current track slams back in. */
  sting(ms = 900) { const m = this._ensure(); if (m) this.mutedUntil = m.ctx.currentTime + ms / 1000; }
  stop() { this.trackName = null; this.pendingTrack = null; }
  _schedule() {
    const m = this._ensure(); if (!m) return;
    if (!this.trackName && !this.pendingTrack) { clearInterval(this.timer); this.timer = null; return; }
    const { ctx: c, out } = m;
    this.intensity += (this.target - this.intensity) * 0.08;
    while (this.nextTime < c.currentTime + LOOKAHEAD) {
      if (this.pendingTrack && this.stepIndex % STEPS === 0) { this.trackName = this.pendingTrack; this.pendingTrack = null; }
      const tr = this.trackName ? TRACKS[this.trackName] : null;
      const stepDur = 60 / (tr?.bpm ?? 120) / 4;
      if (tr && this.nextTime >= this.mutedUntil) {
        const step = this.stepIndex % STEPS;
        for (const layer of tr.layers) if (this.intensity >= layer.min - 0.02) layer.bar(c, out, this.nextTime, step, this.bar);
      }
      this.stepIndex++;
      if (this.stepIndex % STEPS === 0) this.bar++;
      this.nextTime += stepDur;
    }
  }
}

export const music = new MusicEngine();

// ---- reactive wiring --------------------------------------------------------------------------

let combatHeat = 0;
let arenaBase = 0;
events.on('tick', () => {
  combatHeat = Math.max(0, combatHeat - 0.0028);
  if (music.manual) return; // a hand-picked demo level (the showcase) overrides the driver below
  if (music.trackName === 'field' || music.pendingTrack === 'field') music.setIntensity(Math.max(arenaBase, combatHeat));
  if (music.trackName === 'chase') music.setIntensity(Math.max(0.15, chase.level));
});
events.on('combat:hit', () => { combatHeat = Math.min(1, combatHeat + 0.22); });
events.on('enemy:die', () => { combatHeat = Math.min(1, combatHeat + 0.1); });

events.on('scene:enter', (e) => {
  if (e.name !== 'showcase') music.manual = false; // leaving the sound board's manual demo controls
  if (e.name === 'title') music.play('title', { intensity: 0.5 });
  else if (e.name === 'run') { arenaBase = 0.12; music.play('field', { intensity: 0.12 }); }
  else if (e.name === 'boss') music.play('boss', { intensity: Math.max(0, ((e.data?.phase ?? 1) - 1) * 0.4 + 0.15) });
  else if (e.name === 'gameover') music.stop();
});

events.on('arena:enter', () => { arenaBase = 0.15; music.play('field', { intensity: 0.15 }); });
events.on('arena:seal', () => { arenaBase = 0.45; });
events.on('arena:wave', (e) => { arenaBase = Math.min(0.9, 0.5 + 0.35 * (e.n / Math.max(1, e.total))); });
events.on('arena:clear', () => { arenaBase = 0.2; });
events.on('arena:exit', () => { arenaBase = 0.12; });

events.on('gauntlet:enter', () => music.play('chase', { intensity: 0.15 }));
events.on('gauntlet:go', () => music.setIntensity(0.6));
events.on('gauntlet:escape', () => { arenaBase = 0.15; music.play('field', { intensity: 0.15 }); });
events.on('gauntlet:exit', () => { arenaBase = 0.15; music.play('field', { intensity: 0.15 }); });

events.on('boss:phase', (e) => music.play('boss', { intensity: Math.min(1, (e.to - 1) * 0.4 + 0.2) }));
events.on('boss:nameCard', () => music.sting(900));
events.on('boss:defeated', () => music.stop());
events.on('combat:heroDeath', () => music.stop());

// telegraph clarity ("mix is balanced": music never masks a telegraph cue)
events.on('enemy:windup', () => duckMusic(0.45, 260));
events.on('boss:windup', () => duckMusic(0.4, 320));
events.on('combat:heroHurt', () => duckMusic(0.5, 320));
events.on('boss:hurt', (e) => duckMusic(e.armored ? 0.6 : 0.45, 220));

// low health: muffle plus a thump synced to the HUD's own (already low-hp-gated) heartbeat
const muffle = { pause: false, low: false };
const applyMuffle = () => muffleMusic(muffle.pause || muffle.low);
let lowClear = null;
events.on('hud:heartbeat', (e) => {
  muffle.low = true; applyMuffle();
  clearTimeout(lowClear);
  lowClear = setTimeout(() => { muffle.low = false; applyMuffle(); }, 1400);
  const m = musicContext(); if (!m) return;
  const { ctx: c, out } = m;
  tone(c, out, c.currentTime, 0.22, { type: 'sine', f0: e.strong ? 56 : 48, f1: 28, gain: (e.strong ? 0.32 : 0.2) * musicVol(), attack: 0.004 });
});

// pause: muffled, not silenced (see class header)
events.on('pause', (e) => { muffle.pause = e.paused; applyMuffle(); });
