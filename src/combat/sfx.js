// Combat sounds (piece `combat`), synthesised in WebAudio at runtime (GAME.md "Sound").
// A stand-in until the `audio` piece exists: it listens to the same events, so `audio` can
// take over by calling combatSfx.enabled = false and playing its own.
//
//   import { combatSfx } from './combat/sfx.js';   // importing it is enough: it listens to events
//
// Sounds: swing whoosh (per step), hit (thump + click + crunch, scaled by power), the
// finisher's heavier hit, the overhead's floor slam, hero hurt, dodge shing, enemy windup creak.
// The AudioContext is created lazily and only after the page has had a user gesture, so
// autoplay policy never logs a warning. Volume: settings masterVolume * sfxVolume.

import { events } from '../core/events.js';
import { settings } from '../core/settings.js';
import { audioContext, legacyBus, legacyVol } from '../audio/engine.js';

let ctx = null, out = null, noiseBuf = null;
let n = 0; // variation counter (deterministic pitch jitter)

function ac() {
  if (!combatSfx.enabled) return null;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    ctx = audioContext(); if (!ctx) return null;   // shared context + mixer (src/audio)
    out = ctx.createGain();
    out.connect(legacyBus('combat'));
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 1;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  } catch { ctx = null; return null; }
  return ctx;
}

function vol() { return legacyVol(); }   // the mixer applies the settings volumes

function env(g, t, a, peak, d, end = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + d);
}

function noise(c, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.3, attack = 0.004 } = {}) {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 1;
  const f = c.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, attack, gain * vol(), dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, (n * 0.137) % 0.8, dur + attack + 0.05);
}

function tone(c, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 0.3, attack = 0.003 } = {}) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, attack, gain * vol(), dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + attack + dur + 0.05);
}

const jit = () => 1 + (((n++ * 37) % 11) - 5) * 0.012;

export const combatSfx = {
  enabled: true,
  swing(step) {
    const c = ac(); if (!c) return;
    const t = c.currentTime, j = jit();
    if (step === 2) {
      noise(c, t, 0.2, { f0: 300 * j, f1: 1400 * j, q: 1.4, gain: 0.3, attack: 0.03 });
      tone(c, t, 0.18, { type: 'triangle', f0: 90, f1: 60, gain: 0.08 });
    } else {
      const up = step === 1;
      noise(c, t, 0.11, { f0: (up ? 1400 : 900) * j, f1: (up ? 3200 : 2600) * j, q: 2, gain: 0.22, attack: 0.012 });
    }
  },
  hit(power = 1, finisher = false) {
    const c = ac(); if (!c) return;
    const t = c.currentTime, j = jit();
    const p = Math.min(2.4, power);
    // click: the blade biting
    noise(c, t, 0.025, { type: 'highpass', f0: 2600 * j, q: 0.7, gain: 0.35 + 0.1 * p, attack: 0.001 });
    // thump: the body taking it
    tone(c, t, 0.09 + 0.05 * p, { type: 'sine', f0: 190 * j / Math.sqrt(p), f1: 48, gain: 0.5 + 0.15 * p, attack: 0.002 });
    // crunch: burlap and straw
    noise(c, t + 0.005, 0.07 + 0.04 * p, { type: 'bandpass', f0: 700 * j, f1: 260, q: 1.2, gain: 0.3 + 0.1 * p, attack: 0.002 });
    if (finisher) {
      tone(c, t, 0.32, { type: 'triangle', f0: 110, f1: 32, gain: 0.55, attack: 0.002 });
      noise(c, t + 0.01, 0.35, { type: 'lowpass', f0: 1800, f1: 120, q: 0.8, gain: 0.4, attack: 0.002 });
      tone(c, t + 0.002, 0.12, { type: 'square', f0: 1320 * j, f1: 1180 * j, gain: 0.05, attack: 0.001 });
    }
  },
  slam() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.28, { type: 'lowpass', f0: 900, f1: 90, q: 0.9, gain: 0.35, attack: 0.002 });
    tone(c, t, 0.22, { type: 'sine', f0: 80, f1: 35, gain: 0.4 });
  },
  hurt() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.2, { type: 'square', f0: 520, f1: 130, gain: 0.12, attack: 0.002 });
    tone(c, t, 0.14, { type: 'sine', f0: 160, f1: 55, gain: 0.5, attack: 0.002 });
    noise(c, t, 0.12, { type: 'bandpass', f0: 1200, f1: 400, q: 1, gain: 0.3, attack: 0.001 });
  },
  dodge() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.16, { type: 'triangle', f0: 1800, f1: 2600, gain: 0.08, attack: 0.004 });
    noise(c, t, 0.12, { type: 'highpass', f0: 4000, q: 0.7, gain: 0.12, attack: 0.01 });
  },
  creak(len = 0.6) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, len, { type: 'sawtooth', f0: 70, f1: 140, gain: 0.05, attack: 0.08 });
    noise(c, t, len, { type: 'bandpass', f0: 300, f1: 900, q: 6, gain: 0.08, attack: 0.1 });
  },
  whack() {   // enemy swing
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.14, { f0: 400, f1: 1600, q: 1.2, gain: 0.25, attack: 0.02 });
  },
};

events.on('hero:swing', (e) => combatSfx.swing(e.step));
events.on('combat:hit', (e) => combatSfx.hit(e.power, e.finisher));
events.on('hero:slam', () => combatSfx.slam());
events.on('combat:heroHurt', () => combatSfx.hurt());
events.on('combat:dodge', () => combatSfx.dodge());
