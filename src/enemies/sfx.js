// Enemy sounds (piece `enemies`), synthesised in WebAudio at runtime (GAME.md "Sound").
// A stand-in until the `audio` piece exists: audio can take over by setting
// enemySfx.enabled = false and listening to the enemy:* events instead.
//
// The AudioContext is created lazily, and only after a user gesture, so there is never an
// autoplay warning in the console. Volume: settings masterVolume * sfxVolume.

import { settings } from '../core/settings.js';

let ctx = null, out = null, noiseBuf = null, n = 0;

function ac() {
  if (!enemySfx.enabled) return null;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    ctx = new AudioContext();
    out = ctx.createGain();
    out.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5;
    out.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 7;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  } catch { ctx = null; return null; }
  return ctx;
}
const vol = () => (settings.get('masterVolume') ?? 0.8) * (settings.get('sfxVolume') ?? 0.9);
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
  src.start(t, (n * 0.173) % 0.8, dur + attack + 0.05);
}
function tone(c, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 0.3, attack = 0.003, vib = 0 } = {}) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  if (vib) {
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = vib; lg.gain.value = f0 * 0.06;
    l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + attack + dur + 0.05);
  }
  const g = c.createGain();
  env(g, t, attack, gain * vol(), dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + attack + dur + 0.05);
}

const play = (fn) => { const c = ac(); if (c) fn(c, c.currentTime, jit()); };

export const enemySfx = {
  enabled: true,
  spawn: (kind) => play((c, t, j) => {
    if (kind === 'brute') { tone(c, t, 0.35, { f0: 70, f1: 30, gain: 0.5 }); noise(c, t, 0.4, { type: 'lowpass', f0: 1200, f1: 80, gain: 0.4, attack: 0.002 }); }
    else if (kind === 'wisp') { noise(c, t, 0.3, { f0: 300 * j, f1: 2200, q: 2, gain: 0.2, attack: 0.05 }); tone(c, t, 0.25, { type: 'triangle', f0: 220, f1: 660, gain: 0.06 }); }
    else if (kind === 'mite') { for (let k = 0; k < 4; k++) noise(c, t + k * 0.05, 0.03, { type: 'highpass', f0: 3000 * j, q: 3, gain: 0.12 }); }
    else { noise(c, t, 0.45, { type: 'lowpass', f0: 500, f1: 150, gain: 0.25, attack: 0.08 }); tone(c, t + 0.1, 0.5, { type: 'sawtooth', f0: 95 * j, f1: 70, gain: 0.05, attack: 0.1, vib: 7 }); }
  }),
  // telegraphs: each archetype has its own tell, so you can hear who is about to hit you
  windup: (kind, len = 0.5) => play((c, t, j) => {
    if (kind === 'husk') { tone(c, t, len, { type: 'sawtooth', f0: 110 * j, f1: 150 * j, gain: 0.07, attack: 0.06, vib: 9 }); noise(c, t, len * 0.8, { f0: 500, f1: 900, q: 4, gain: 0.08, attack: 0.1 }); }
    else if (kind === 'wisp') { tone(c, t, len, { type: 'triangle', f0: 180 * j, f1: 900 * j, gain: 0.07, attack: 0.05 }); noise(c, t, len, { f0: 600, f1: 3000, q: 3, gain: 0.1, attack: len * 0.8 }); }
    else if (kind === 'charge') { tone(c, t, 0.5, { type: 'sawtooth', f0: 80, f1: 55, gain: 0.12, attack: 0.05, vib: 5 }); noise(c, t, 0.35, { type: 'lowpass', f0: 900, f1: 200, gain: 0.25, attack: 0.02 }); }
    else if (kind === 'slam') { tone(c, t, len, { type: 'sawtooth', f0: 60, f1: 90, gain: 0.08, attack: 0.1 }); }
    else if (kind === 'mite') { for (let k = 0; k < 3; k++) noise(c, t + k * 0.06, 0.025, { type: 'highpass', f0: 4200 * j, q: 4, gain: 0.1 }); }
  }),
  paw: () => play((c, t, j) => noise(c, t, 0.12, { type: 'lowpass', f0: 700 * j, f1: 200, gain: 0.2, attack: 0.01 })),
  swipe: () => play((c, t, j) => noise(c, t, 0.13, { f0: 500 * j, f1: 2000 * j, q: 1.3, gain: 0.22, attack: 0.015 })),
  fire: () => play((c, t, j) => { noise(c, t, 0.22, { type: 'lowpass', f0: 2400 * j, f1: 300, gain: 0.3, attack: 0.003 }); tone(c, t, 0.18, { type: 'triangle', f0: 520 * j, f1: 160, gain: 0.1 }); }),
  orbPop: () => play((c, t, j) => { noise(c, t, 0.14, { type: 'bandpass', f0: 1400 * j, f1: 300, gain: 0.2, attack: 0.002 }); }),
  charge: () => play((c, t) => { noise(c, t, 0.6, { type: 'lowpass', f0: 400, f1: 900, gain: 0.3, attack: 0.03 }); tone(c, t, 0.5, { f0: 55, f1: 45, gain: 0.3 }); }),
  crash: () => play((c, t) => {
    tone(c, t, 0.45, { type: 'triangle', f0: 90, f1: 28, gain: 0.6, attack: 0.002 });
    noise(c, t, 0.5, { type: 'lowpass', f0: 2600, f1: 100, gain: 0.5, attack: 0.002 });
    tone(c, t + 0.01, 0.2, { type: 'square', f0: 900, f1: 700, gain: 0.05, attack: 0.001 });
  }),
  dizzy: () => play((c, t) => { for (let k = 0; k < 3; k++) tone(c, t + k * 0.09, 0.08, { type: 'triangle', f0: 1400 - k * 180, f1: 1300 - k * 180, gain: 0.04 }); }),
  slam: () => play((c, t) => { tone(c, t, 0.3, { f0: 75, f1: 30, gain: 0.5 }); noise(c, t, 0.3, { type: 'lowpass', f0: 1500, f1: 90, gain: 0.4, attack: 0.002 }); }),
  bite: () => play((c, t, j) => { noise(c, t, 0.04, { type: 'highpass', f0: 2500 * j, q: 2, gain: 0.25, attack: 0.001 }); tone(c, t, 0.06, { type: 'square', f0: 700 * j, f1: 300, gain: 0.05 }); }),
  hop: () => play((c, t, j) => noise(c, t, 0.06, { f0: 1800 * j, f1: 3500, q: 2, gain: 0.08, attack: 0.01 })),
  death: (kind) => play((c, t, j) => {
    if (kind === 'husk') { tone(c, t, 0.5, { type: 'sawtooth', f0: 140 * j, f1: 50, gain: 0.08, attack: 0.02, vib: 6 }); }
    else if (kind === 'wisp') { noise(c, t, 0.5, { type: 'highpass', f0: 3000, f1: 400, gain: 0.15, attack: 0.01 }); tone(c, t, 0.3, { type: 'triangle', f0: 700, f1: 90, gain: 0.08 }); }
    else if (kind === 'brute') { tone(c, t, 0.7, { type: 'sawtooth', f0: 90, f1: 40, gain: 0.1, attack: 0.03, vib: 4 }); }
    else if (kind === 'mite') { noise(c, t, 0.07, { type: 'bandpass', f0: 1800 * j, f1: 500, q: 2, gain: 0.3, attack: 0.001 }); tone(c, t, 0.05, { type: 'square', f0: 1200 * j, f1: 400, gain: 0.04 }); }
  }),
  // a body hits the floor (husk flop, brute topple) or a coal skull shatters (wisp)
  thud: (big = 1) => play((c, t) => { tone(c, t, 0.2 + 0.15 * big, { f0: 120 / big, f1: 35, gain: 0.3 + 0.2 * big }); noise(c, t, 0.2 + 0.1 * big, { type: 'lowpass', f0: 900, f1: 100, gain: 0.25 + 0.15 * big, attack: 0.002 }); }),
  crumble: () => play((c, t) => { for (let k = 0; k < 5; k++) noise(c, t + k * 0.045, 0.06, { type: 'bandpass', f0: 900 + k * 230, f1: 300, q: 1.5, gain: 0.12, attack: 0.002 }); }),
};
