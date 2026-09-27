// Boon, shrine and pickup sounds (piece `boons`), synthesised in WebAudio at runtime.
// A stand-in until `audio` takes over: set boonSfx.enabled = false and listen to the same
// events ('pickup:*', 'boon:*', 'shrine:*'). The AudioContext is only created after a user
// gesture, so autoplay policy never logs a warning.
//
//   import { boonSfx } from './progression/sfx.js';
//   boonSfx.shard(ladderStep)   boonSfx.heart()   boonSfx.zap()   boonSfx.select('epic') ...

import { settings } from '../core/settings.js';
import { sfxContext, makeNoiseBuffer } from '../audio/mixer.js';

let ctx = null, out = null, noiseBuf = null, n = 0;

// Routed through the audio piece's shared mixer (one AudioContext, one compressor) instead of
// opening its own; see audio/mixer.js's header.
function ac() {
  if (!boonSfx.enabled) return null;
  const m = sfxContext();
  if (!m) { ctx = null; return null; }
  ctx = m.ctx; out = m.out;
  if (!noiseBuf) noiseBuf = makeNoiseBuffer(ctx, 7, 1);
  return ctx;
}
const vol = () => (settings.get('masterVolume') ?? 0.8) * (settings.get('sfxVolume') ?? 0.9);
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
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, attack, gain * vol(), dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, (n++ * 0.137) % 0.8, dur + attack + 0.05);
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

// major pentatonic from A4: the shard ladder climbs it, two octaves
const PENTA = [0, 2, 4, 7, 9];
const note = (step, base = 440) => base * Math.pow(2, (PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12);
const last = { shard: 0, tick: 0 };
const throttle = (k, ms) => { const now = performance.now(); if (now - last[k] < ms) return false; last[k] = now; return true; };

export const boonSfx = {
  enabled: true,

  // ---- pickups ----
  drop() {
    const c = ac(); if (!c || !throttle('tick', 30)) return;
    const t = c.currentTime;
    tone(c, t, 0.05, { type: 'triangle', f0: 1500 + (n++ % 5) * 90, f1: 1100, gain: 0.12 });
  },
  /** step 0.. climbs a pentatonic ladder: 8 steps, then it holds at the top. */
  shard(step = 0) {
    const c = ac(); if (!c) return;
    const t = c.currentTime, f = note(Math.min(step, 9), 523.25);
    tone(c, t, 0.16, { type: 'square', f0: f, f1: f * 0.99, gain: 0.07, attack: 0.002 });
    tone(c, t, 0.24, { type: 'sine', f0: f * 2, f1: f * 2, gain: 0.09, attack: 0.002 });
    noise(c, t, 0.03, { type: 'highpass', f0: 5000, gain: 0.05, attack: 0.001 });
    if (step >= 7) tone(c, t + 0.03, 0.3, { type: 'sine', f0: f * 3, f1: f * 3, gain: 0.05 });
  },
  heart() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.14, { type: 'sine', f0: 120, f1: 55, gain: 0.5 });
    tone(c, t + 0.11, 0.14, { type: 'sine', f0: 110, f1: 52, gain: 0.4 });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, t + 0.05 + i * 0.07, 0.4, { type: 'triangle', f0: f, f1: f, gain: 0.09, attack: 0.004 }));
  },
  mote(step = 0) {
    const c = ac(); if (!c || !throttle('tick', 25)) return;
    const t = c.currentTime;
    tone(c, t, 0.09, { type: 'sine', f0: note(step, 330) * 2, f1: note(step, 330) * 2, gain: 0.06 });
  },

  // ---- shrine ----
  slide() {
    const c = ac(); if (!c) return;
    noise(c, c.currentTime, 0.22, { type: 'bandpass', f0: 500, f1: 2400, q: 1.5, gain: 0.12, attack: 0.05 });
  },
  flip(rarity = 'common') {
    const c = ac(); if (!c) return;
    const t = c.currentTime, k = rarity === 'epic' ? 2 : rarity === 'rare' ? 1 : 0;
    noise(c, t, 0.04, { type: 'highpass', f0: 3000, gain: 0.2, attack: 0.001 });
    tone(c, t, 0.12, { type: 'triangle', f0: 340 + k * 110, f1: 200, gain: 0.22 });
    if (k >= 1) [0, 1, 2].slice(0, k + 1).forEach((i) => tone(c, t + 0.04 + i * 0.06, 0.35, { type: 'sine', f0: note(3 + i * 2 + k, 440), gain: 0.09 + 0.03 * k, attack: 0.004 }));
    if (k === 2) noise(c, t, 0.5, { type: 'bandpass', f0: 800, f1: 5000, q: 2, gain: 0.1, attack: 0.1 });
  },
  hover() {
    const c = ac(); if (!c || !throttle('tick', 40)) return;
    const t = c.currentTime;
    tone(c, t, 0.06, { type: 'square', f0: 880, f1: 990, gain: 0.05 });
    noise(c, t, 0.04, { type: 'highpass', f0: 4500, gain: 0.05, attack: 0.001 });
  },
  select(rarity = 'common') {
    const c = ac(); if (!c) return;
    const t = c.currentTime, k = rarity === 'epic' ? 2 : rarity === 'rare' ? 1 : 0;
    tone(c, t, 0.35, { type: 'sine', f0: 150, f1: 45, gain: 0.55 });
    noise(c, t, 0.3, { type: 'lowpass', f0: 3000, f1: 200, gain: 0.25, attack: 0.002 });
    [0, 2, 4, 7].forEach((s, i) => tone(c, t + 0.02 + i * 0.05, 0.5 + k * 0.25, { type: i % 2 ? 'triangle' : 'square', f0: note(s + 2 * k, 392), gain: 0.07 + 0.01 * k, attack: 0.003 }));
    if (k === 2) noise(c, t + 0.05, 0.9, { type: 'bandpass', f0: 1500, f1: 7000, q: 1.2, gain: 0.12, attack: 0.15 });
  },
  reroll() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 4; i++) noise(c, t + i * 0.045, 0.04, { type: 'highpass', f0: 2500 + i * 500, gain: 0.16, attack: 0.001 });
    tone(c, t, 0.2, { type: 'triangle', f0: 300, f1: 700, gain: 0.1 });
  },
  denied() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.12, { type: 'square', f0: 180, f1: 140, gain: 0.1 });
    tone(c, t + 0.09, 0.14, { type: 'square', f0: 150, f1: 110, gain: 0.1 });
  },
  acquire(rarity = 'common') {
    const c = ac(); if (!c) return;
    const t = c.currentTime, k = rarity === 'epic' ? 2 : rarity === 'rare' ? 1 : 0;
    noise(c, t, 0.35, { type: 'bandpass', f0: 400, f1: 4000 + k * 2000, q: 1.4, gain: 0.16, attack: 0.02 });
    tone(c, t, 0.3, { type: 'sawtooth', f0: 110, f1: 220 + k * 110, gain: 0.05, attack: 0.05 });
  },

  // ---- boon effects ----
  zap() {
    const c = ac(); if (!c || !throttle('tick', 45)) return;
    const t = c.currentTime;
    noise(c, t, 0.09, { type: 'highpass', f0: 3500, f1: 6000, gain: 0.22, attack: 0.001 });
    tone(c, t, 0.1, { type: 'sawtooth', f0: 1800, f1: 260, gain: 0.08, attack: 0.001 });
  },
  fire() {
    const c = ac(); if (!c || !throttle('tick', 60)) return;
    noise(c, c.currentTime, 0.25, { type: 'bandpass', f0: 600, f1: 250, q: 0.8, gain: 0.14, attack: 0.03 });
  },
  wave() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.4, { type: 'sine', f0: 90, f1: 38, gain: 0.5 });
    noise(c, t, 0.45, { type: 'bandpass', f0: 300, f1: 1800, q: 1, gain: 0.3, attack: 0.04 });
  },
  thunder() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.06, { type: 'highpass', f0: 2000, gain: 0.5, attack: 0.001 });
    noise(c, t + 0.02, 0.7, { type: 'lowpass', f0: 2600, f1: 90, q: 0.8, gain: 0.45, attack: 0.004 });
    tone(c, t, 0.4, { type: 'sine', f0: 100, f1: 30, gain: 0.5 });
  },
  boom(big = 1) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.3 + 0.2 * big, { type: 'lowpass', f0: 1800, f1: 70, q: 0.8, gain: 0.4, attack: 0.002 });
    tone(c, t, 0.3 + 0.1 * big, { type: 'sine', f0: 120, f1: 32, gain: 0.55 });
  },
  blade() {
    const c = ac(); if (!c || !throttle('tick', 50)) return;
    const t = c.currentTime;
    tone(c, t, 0.12, { type: 'triangle', f0: 2400, f1: 1500, gain: 0.08 });
    noise(c, t, 0.05, { type: 'highpass', f0: 5000, gain: 0.1, attack: 0.001 });
  },
  glass() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.12, { type: 'highpass', f0: 4500, gain: 0.35, attack: 0.001 });
    [2637, 3136, 3951, 2093].forEach((f, i) => tone(c, t + i * 0.012, 0.25, { type: 'triangle', f0: f, f1: f * 0.98, gain: 0.07, attack: 0.001 }));
  },
  shield() {
    const c = ac(); if (!c || !throttle('tick', 60)) return;
    const t = c.currentTime;
    tone(c, t, 0.35, { type: 'sine', f0: 660, f1: 1320, gain: 0.08, attack: 0.02 });
  },
  phoenix() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.9, { type: 'sawtooth', f0: 110, f1: 660, gain: 0.1, attack: 0.05 });
    noise(c, t, 1.0, { type: 'bandpass', f0: 400, f1: 3000, q: 1, gain: 0.3, attack: 0.05 });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, t + 0.15 + i * 0.08, 0.9, { type: 'triangle', f0: f, gain: 0.09, attack: 0.01 }));
    tone(c, t, 0.5, { type: 'sine', f0: 100, f1: 30, gain: 0.6 });
  },
  haste() {
    const c = ac(); if (!c || !throttle('tick', 80)) return;
    noise(c, c.currentTime, 0.22, { type: 'bandpass', f0: 900, f1: 3500, q: 2, gain: 0.14, attack: 0.03 });
  },
  crit() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.2, { type: 'square', f0: 1568, f1: 1480, gain: 0.07 });
    tone(c, t + 0.05, 0.3, { type: 'square', f0: 2093, f1: 2000, gain: 0.06 });
    noise(c, t, 0.08, { type: 'highpass', f0: 5500, gain: 0.25, attack: 0.001 });
  },
};
