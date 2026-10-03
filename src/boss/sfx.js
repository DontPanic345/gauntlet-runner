// Boss sounds (piece `boss`), synthesised in WebAudio at runtime (GAME.md "Sound").
// A stand-in until the `audio` piece exists: audio can take over by setting
// bossSfx.enabled = false and listening to the boss:* events instead.
//
// The AudioContext is created lazily and only after a user gesture, so there is never an
// autoplay warning in the console. Volume: settings masterVolume * sfxVolume.
//
// Every Warden attack has its own tell: the chain whirl rises for the sweep, the chain draws
// back with a ratchet for the lash, a creak of armour for the stomp, a deep inhale for the
// leap, a key-rattle for the summon and a bell for the cage.

import { settings } from '../core/settings.js';
import { audioContext, legacyBus, legacyVol } from '../audio/engine.js';

let ctx = null, out = null, noiseBuf = null, n = 0;

function ac() {
  if (!bossSfx.enabled) return null;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    ctx = audioContext(); if (!ctx) return null;   // shared context + mixer (src/audio)
    out = ctx.createGain();
    out.gain.value = 0.8;
    out.connect(legacyBus('boss'));
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 11;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  } catch { ctx = null; return null; }
  return ctx;
}
const vol = () => legacyVol();   // the mixer applies the settings volumes
const jit = () => 1 + (((n++ * 37) % 11) - 5) * 0.015;

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function noise(c, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.3, attack = 0.004 } = {}) {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  const g = c.createGain();
  env(g, t, attack, gain * vol(), dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, (n * 0.173) % 1.5, dur + attack + 0.05);
}
function tone(c, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 0.3, attack = 0.003, vib = 0, vibAmt = 0.06 } = {}) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  if (vib) {
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = vib; lg.gain.value = f0 * vibAmt;
    l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + attack + dur + 0.05);
  }
  const g = c.createGain();
  env(g, t, attack, gain * vol(), dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + attack + dur + 0.05);
}
/** A metallic ping: a few inharmonic partials. */
function clang(c, t, f, gain = 0.1, dur = 0.5) {
  for (const [m, gg] of [[1, 1], [2.76, 0.5], [5.4, 0.3], [8.9, 0.15]]) if (f * m < 15000) tone(c, t, dur / (m * 0.4 + 0.6), { type: 'sine', f0: f * m, f1: f * m * 0.995, gain: gain * gg, attack: 0.001 });
}
function boom(c, t, big = 1) {
  tone(c, t, 0.5 * big, { type: 'triangle', f0: 85, f1: 26, gain: 0.55, attack: 0.002 });
  tone(c, t, 0.35 * big, { f0: 55, f1: 30, gain: 0.5, attack: 0.002 });
  noise(c, t, 0.55 * big, { type: 'lowpass', f0: 2400, f1: 70, gain: 0.5, attack: 0.002 });
}

const play = (fn) => { const c = ac(); if (c) fn(c, c.currentTime, jit()); };

export const bossSfx = {
  enabled: true,
  // ---- the intro -------------------------------------------------------------------------
  rumble: (len = 1.6) => play((c, t) => { noise(c, t, len, { type: 'lowpass', f0: 160, f1: 60, gain: 0.35, attack: 0.4 }); tone(c, t, len, { f0: 38, f1: 34, gain: 0.25, attack: 0.5 }); }),
  gate: () => play((c, t) => { boom(c, t, 0.7); clang(c, t + 0.01, 210, 0.1, 0.7); clang(c, t + 0.07, 330, 0.06, 0.5); }),
  ignite: (k = 0) => play((c, t, j) => {
    noise(c, t, 0.35, { type: 'bandpass', f0: 300 * j, f1: 2400, q: 0.8, gain: 0.22, attack: 0.02 });
    tone(c, t + 0.02, 0.4, { type: 'triangle', f0: 220 * Math.pow(1.122, k), f1: 230 * Math.pow(1.122, k), gain: 0.04 });
  }),
  rune: (k = 0) => play((c, t) => tone(c, t, 0.6, { type: 'sine', f0: 523 * Math.pow(1.0595, [0, 3, 7, 10, 12, 15][k % 6]), gain: 0.05, attack: 0.01 })),
  eyes: () => play((c, t) => { tone(c, t, 0.9, { type: 'sine', f0: 880, f1: 1760, gain: 0.07, attack: 0.02 }); noise(c, t, 0.5, { type: 'highpass', f0: 4000, f1: 9000, gain: 0.06, attack: 0.15 }); }),
  rise: () => play((c, t) => { for (let k = 0; k < 6; k++) clang(c, t + k * 0.07, 140 + k * 23, 0.05, 0.25); noise(c, t, 0.7, { type: 'lowpass', f0: 300, f1: 900, gain: 0.25, attack: 0.2 }); }),
  snap: () => play((c, t) => { clang(c, t, 700, 0.14, 0.4); noise(c, t, 0.12, { type: 'highpass', f0: 3000, gain: 0.3, attack: 0.001 }); clang(c, t + 0.05, 520, 0.1, 0.4); }),
  roar: (pitch = 1) => play((c, t) => {
    tone(c, t, 1.4, { type: 'sawtooth', f0: 70 * pitch, f1: 52 * pitch, gain: 0.22, attack: 0.08, vib: 11, vibAmt: 0.09 });
    tone(c, t, 1.3, { type: 'sawtooth', f0: 104 * pitch, f1: 75 * pitch, gain: 0.12, attack: 0.1, vib: 7 });
    noise(c, t, 1.5, { type: 'bandpass', f0: 380, f1: 180, q: 0.7, gain: 0.45, attack: 0.06 });
    noise(c, t, 1.2, { type: 'lowpass', f0: 900, f1: 120, gain: 0.3, attack: 0.02 });
  }),
  card: () => play((c, t) => { boom(c, t, 0.8); tone(c, t, 1.2, { type: 'triangle', f0: 110, gain: 0.12, attack: 0.01 }); tone(c, t, 1.2, { type: 'triangle', f0: 164.8, gain: 0.08, attack: 0.01 }); tone(c, t, 1.2, { type: 'triangle', f0: 130.8, gain: 0.08, attack: 0.01 }); }),

  // ---- tells -------------------------------------------------------------------------------
  whirl: (len = 0.9) => play((c, t) => {   // the chain spun overhead, rising
    const k = Math.round(len * 7);
    for (let i = 0; i < k; i++) {
      const u = i / k;
      noise(c, t + Math.pow(u, 0.8) * len, 0.11, { f0: 300 + u * 900, f1: 900 + u * 1500, q: 1.4, gain: 0.08 + u * 0.12, attack: 0.04 });
    }
    for (let i = 0; i < 5; i++) clang(c, t + i * len / 5, 900 + i * 60, 0.025, 0.12);
  }),
  drawback: (len = 0.6) => play((c, t) => { for (let i = 0; i < 6; i++) clang(c, t + i * len / 7, 600 - i * 40, 0.04, 0.1); noise(c, t, len, { type: 'bandpass', f0: 1200, f1: 400, q: 2, gain: 0.08, attack: 0.1 }); }),
  creak: (len = 0.5) => play((c, t) => tone(c, t, len, { type: 'sawtooth', f0: 70, f1: 110, gain: 0.07, attack: 0.1, vib: 23, vibAmt: 0.1 })),
  inhale: (len = 0.6) => play((c, t) => { noise(c, t, len, { type: 'bandpass', f0: 200, f1: 1200, q: 0.8, gain: 0.25, attack: len * 0.8 }); tone(c, t, len, { type: 'sawtooth', f0: 50, f1: 75, gain: 0.08, attack: len * 0.6 }); }),
  keys: () => play((c, t) => { for (let i = 0; i < 9; i++) clang(c, t + i * 0.045 + (i % 3) * 0.01, 1900 + ((i * 7) % 5) * 260, 0.035, 0.15); }),
  bell: () => play((c, t) => { clang(c, t, 155, 0.2, 2.2); clang(c, t, 233, 0.1, 1.8); }),

  // ---- strikes -----------------------------------------------------------------------------
  sweep: () => play((c, t, j) => { noise(c, t, 0.32, { f0: 260 * j, f1: 1600, q: 0.8, gain: 0.55, attack: 0.02 }); for (let i = 0; i < 4; i++) clang(c, t + i * 0.03, 800 + i * 70, 0.04, 0.1); }),
  lash: () => play((c, t, j) => { noise(c, t, 0.12, { type: 'highpass', f0: 1500 * j, f1: 5000, gain: 0.4, attack: 0.002 }); for (let i = 0; i < 6; i++) clang(c, t + i * 0.018, 700 + i * 50, 0.04, 0.08); }),
  impact: (big = 1) => play((c, t) => { boom(c, t, big); clang(c, t + 0.005, 180, 0.12, 0.6); }),
  stomp: () => play((c, t) => { boom(c, t, 0.7); clang(c, t, 120, 0.06, 0.3); }),
  leap: () => play((c, t) => { noise(c, t, 0.45, { type: 'bandpass', f0: 500, f1: 120, q: 0.7, gain: 0.35, attack: 0.02 }); for (let i = 0; i < 4; i++) clang(c, t + i * 0.05, 300 + i * 40, 0.03, 0.1); }),
  land: () => play((c, t) => { boom(c, t, 1.5); noise(c, t + 0.05, 1.0, { type: 'lowpass', f0: 600, f1: 60, gain: 0.35, attack: 0.05 }); clang(c, t, 140, 0.1, 0.8); }),
  wave: () => play((c, t) => { noise(c, t, 0.7, { type: 'lowpass', f0: 500, f1: 120, gain: 0.25, attack: 0.03 }); }),
  yank: () => play((c, t) => { for (let i = 0; i < 8; i++) clang(c, t + i * 0.035, 500 + i * 35, 0.045, 0.09); noise(c, t, 0.3, { type: 'lowpass', f0: 1500, f1: 300, gain: 0.2, attack: 0.01 }); }),
  bars: (k = 0) => play((c, t) => { noise(c, t, 0.15, { type: 'lowpass', f0: 1800, f1: 200, gain: 0.3, attack: 0.002 }); clang(c, t, 260 + k * 31, 0.08, 0.6); tone(c, t, 0.2, { f0: 80, f1: 40, gain: 0.25 }); }),

  // ---- hits on the Warden ------------------------------------------------------------------
  hit: (finisher = false) => play((c, t, j) => { clang(c, t, (finisher ? 300 : 430) * j, finisher ? 0.09 : 0.06, finisher ? 0.5 : 0.25); }),
  stagger: () => play((c, t) => {
    clang(c, t, 260, 0.14, 0.8); clang(c, t + 0.02, 390, 0.08, 0.6);
    tone(c, t, 0.9, { type: 'sawtooth', f0: 120, f1: 40, gain: 0.12, attack: 0.02, vib: 6 });
    noise(c, t, 0.4, { type: 'lowpass', f0: 1800, f1: 120, gain: 0.35, attack: 0.002 });
  }),
  break: () => play((c, t) => {   // a phase breaks: armour tears off
    boom(c, t, 1.2);
    clang(c, t, 210, 0.16, 1.2); clang(c, t + 0.03, 470, 0.1, 0.9); clang(c, t + 0.09, 690, 0.07, 0.7);
    noise(c, t, 0.25, { type: 'highpass', f0: 2500, f1: 6000, gain: 0.25, attack: 0.002 });
  }),
  clatter: (k = 0) => play((c, t, j) => { clang(c, t, (380 + (k % 5) * 90) * j, 0.07, 0.35); noise(c, t, 0.08, { type: 'bandpass', f0: 2000, f1: 700, q: 1.5, gain: 0.15, attack: 0.001 }); }),
  // ---- death ---------------------------------------------------------------------------------
  deathHit: () => play((c, t) => {
    boom(c, t, 1.8);
    clang(c, t, 196, 0.2, 2.0); clang(c, t, 294, 0.12, 1.6);
    noise(c, t, 0.4, { type: 'highpass', f0: 3000, f1: 8000, gain: 0.3, attack: 0.001 });
  }),
  groan: () => play((c, t) => { tone(c, t, 2.2, { type: 'sawtooth', f0: 82, f1: 41, gain: 0.16, attack: 0.15, vib: 5, vibAmt: 0.05 }); noise(c, t, 2.0, { type: 'bandpass', f0: 300, f1: 100, q: 0.8, gain: 0.25, attack: 0.3 }); }),
  beams: () => play((c, t) => {
    for (const [f, d] of [[392, 0], [494, 0.08], [587, 0.16], [784, 0.3]]) tone(c, t + d, 2.4, { type: 'triangle', f0: f, gain: 0.05, attack: 0.3, vib: 5, vibAmt: 0.008 });
    noise(c, t, 2.4, { type: 'highpass', f0: 3000, f1: 7000, gain: 0.07, attack: 1.2 });
  }),
  burst: () => play((c, t) => {
    boom(c, t, 2.2);
    for (let i = 0; i < 10; i++) clang(c, t + i * 0.06 + (i % 3) * 0.02, 260 + (i * 97) % 600, 0.07, 0.45);
  }),
  soul: () => play((c, t) => { for (const [f, d] of [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.5]]) tone(c, t + d, 1.8, { type: 'sine', f0: f, f1: f * 1.01, gain: 0.06, attack: 0.08 }); }),
  victory: () => play((c, t) => {
    const notes = [[262, 0], [330, 0.12], [392, 0.24], [523, 0.4]];
    for (const [f, d] of notes) { tone(c, t + d, 1.6 - d, { type: 'square', f0: f, gain: 0.035, attack: 0.005 }); tone(c, t + d, 1.6 - d, { type: 'triangle', f0: f / 2, gain: 0.06, attack: 0.005 }); }
    clang(c, t + 0.4, 523, 0.06, 1.5);
  }),
};
