// Boon and pickup sounds (piece `boons`), synthesised in WebAudio at runtime (GAME.md "Sound").
// A stand-in voice until `audio` exists: `audio` can set boonSfx.enabled = false and listen to
// the boon:* and pickup:* events instead.
//
//   boonSfx.shard(step)   the pickup ladder: each shard collected within 0.4 s of the last
//                         climbs one note of a pentatonic scale (two octaves and a bit)
//   boonSfx.heart()  .cardLand(i)  .cardFlip(i)  .hover(i)  .select(rarity)  .fly()  .gain(rarity)
//   boonSfx.zap()  .burn()  .crit()  .echo()  .wave()  .starFall()  .starHit()  .wardBlock()
//   boonSfx.wardGrow()  .phoenix()  .quake()  .reap()  .mote()  .shrine()  .synergy()
//
// The AudioContext is created lazily and only after the page has had a user gesture.

import { settings } from '../core/settings.js';

let ctx = null, out = null, noiseBuf = null;
const last = {};

function ac() {
  if (!boonSfx.enabled) return null;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    ctx = new AudioContext();
    out = ctx.createGain();
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
/** Rate limit: a sound that can fire many times per tick plays at most once per `ms`. */
function gate(name, ms) {
  const now = performance.now();
  if (now - (last[name] ?? -1e9) < ms) return false;
  last[name] = now;
  return true;
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(c, t, dur, { type = 'sine', f0 = 440, f1 = f0, gain = 0.2, attack = 0.004, dest = out } = {}) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, attack, gain * vol(), dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + attack + dur + 0.05);
}
function noise(c, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.2, attack = 0.004 } = {}) {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, attack, gain * vol(), dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5, dur + attack + 0.05);
}

// C major pentatonic from A5 up: the ladder climbs these
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33];
const note = (base, semis) => base * Math.pow(2, semis / 12);

export const boonSfx = {
  enabled: true,
  shard(step = 0) {
    const c = ac(); if (!c || !gate('shard', 22)) return;
    const t = c.currentTime;
    const f = note(784, LADDER[Math.min(LADDER.length - 1, step)]);
    tone(c, t, 0.16, { type: 'triangle', f0: f, gain: 0.13 });
    tone(c, t, 0.22, { type: 'sine', f0: f * 2, gain: 0.05 });
    tone(c, t + 0.002, 0.05, { type: 'square', f0: f * 3, gain: 0.015 });
  },
  heart() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.12, { type: 'triangle', f0: 523, gain: 0.16 });
    tone(c, t + 0.08, 0.3, { type: 'triangle', f0: 784, gain: 0.16 });
    tone(c, t + 0.08, 0.35, { type: 'sine', f0: 1046, gain: 0.07 });
    noise(c, t + 0.05, 0.3, { f0: 3000, f1: 6000, q: 2, gain: 0.03 });
  },
  cardLand(i = 0) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.12, { f0: 150 - i * 12, f1: 60, gain: 0.22 });
    noise(c, t, 0.05, { type: 'lowpass', f0: 2200, f1: 400, gain: 0.12 });
  },
  cardFlip(i = 0) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.07, { f0: 900, f1: 3800, q: 3, gain: 0.1 });
    tone(c, t + 0.03, 0.12, { type: 'triangle', f0: 660 + i * 110, gain: 0.06 });
  },
  hover(i = 0) {
    const c = ac(); if (!c || !gate('hover', 30)) return;
    const t = c.currentTime;
    tone(c, t, 0.03, { type: 'square', f0: 1100 + i * 180, gain: 0.03 });
    noise(c, t, 0.02, { f0: 4000, q: 4, gain: 0.04 });
  },
  select(rarity = 'common') {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const chord = rarity === 'legendary' ? [0, 4, 7, 12, 16, 19] : rarity === 'epic' ? [0, 3, 7, 12, 15] : rarity === 'rare' ? [0, 4, 7, 12] : [0, 4, 7];
    chord.forEach((s, k) => tone(c, t + k * 0.045, 0.35, { type: 'triangle', f0: note(392, s), gain: 0.09 }));
    tone(c, t, 0.08, { f0: 120, f1: 50, gain: 0.25 });
    noise(c, t, 0.4, { type: 'highpass', f0: 3000, f1: 8000, gain: 0.04 });
  },
  fly() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.3, { f0: 600, f1: 2600, q: 2, gain: 0.08 });
  },
  gain(rarity = 'common') {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.4, { type: 'sine', f0: 196, f1: 392, gain: 0.12 });
    [0, 7, 12, 19].forEach((s, k) => tone(c, t + 0.03 * k, 0.5, { type: 'triangle', f0: note(rarity === 'legendary' ? 523 : 440, s), gain: 0.06 }));
    noise(c, t, 0.25, { type: 'lowpass', f0: 1200, f1: 200, gain: 0.12 });
  },
  zap() {
    const c = ac(); if (!c || !gate('zap', 45)) return;
    const t = c.currentTime;
    tone(c, t, 0.09, { type: 'sawtooth', f0: 1900, f1: 260, gain: 0.05 });
    noise(c, t, 0.08, { f0: 5000, f1: 2000, q: 3, gain: 0.12 });
    noise(c, t + 0.03, 0.06, { f0: 3000, q: 5, gain: 0.07 });
  },
  burn() {
    const c = ac(); if (!c || !gate('burn', 90)) return;
    const t = c.currentTime;
    noise(c, t, 0.14, { type: 'lowpass', f0: 1800, f1: 500, gain: 0.07 });
    noise(c, t, 0.05, { f0: 3500, q: 6, gain: 0.03 });
  },
  crit() {
    const c = ac(); if (!c || !gate('crit', 40)) return;
    const t = c.currentTime;
    tone(c, t, 0.18, { type: 'square', f0: 2093, f1: 2000, gain: 0.04 });
    tone(c, t, 0.25, { type: 'sine', f0: 3136, gain: 0.05 });
    noise(c, t, 0.04, { f0: 6000, q: 3, gain: 0.08 });
  },
  echo() {
    const c = ac(); if (!c || !gate('echo', 60)) return;
    const t = c.currentTime;
    noise(c, t, 0.14, { f0: 2400, f1: 900, q: 6, gain: 0.07, attack: 0.03 });
    tone(c, t, 0.2, { type: 'sine', f0: 1320, f1: 1250, gain: 0.03, attack: 0.02 });
  },
  wave() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.35, { f0: 700, f1: 3400, q: 2, gain: 0.12 });
    tone(c, t, 0.4, { type: 'triangle', f0: 880, f1: 1760, gain: 0.05 });
  },
  starFall() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.4, { type: 'sine', f0: 2600, f1: 500, gain: 0.07 });
    noise(c, t, 0.4, { f0: 4000, f1: 900, q: 4, gain: 0.05 });
  },
  starHit() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.45, { f0: 110, f1: 38, gain: 0.35 });
    noise(c, t, 0.5, { type: 'lowpass', f0: 3000, f1: 150, gain: 0.3 });
    [0, 4, 7, 12].forEach((s, k) => tone(c, t + 0.02 * k, 0.6, { type: 'triangle', f0: note(1046, s), gain: 0.04 }));
  },
  wardBlock() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    for (const [f, d] of [[2349, 0.3], [3136, 0.24], [4186, 0.18], [1568, 0.35]]) tone(c, t, d, { type: 'sine', f0: f, f1: f * 0.98, gain: 0.06 });
    noise(c, t, 0.12, { type: 'highpass', f0: 5000, gain: 0.12 });
    tone(c, t, 0.1, { f0: 300, f1: 120, gain: 0.15 });
  },
  wardGrow() {
    const c = ac(); if (!c || !gate('ward', 60)) return;
    const t = c.currentTime;
    tone(c, t, 0.12, { type: 'triangle', f0: 1568, f1: 2093, gain: 0.04 });
  },
  phoenix() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 1.0, { type: 'lowpass', f0: 300, f1: 4000, gain: 0.3, attack: 0.05 });
    [0, 7, 12, 16, 19].forEach((s, k) => tone(c, t + 0.06 * k, 0.9, { type: 'sawtooth', f0: note(220, s), gain: 0.03 }));
    tone(c, t, 0.6, { f0: 90, f1: 40, gain: 0.3 });
  },
  quake() {
    const c = ac(); if (!c || !gate('quake', 80)) return;
    const t = c.currentTime;
    tone(c, t, 0.3, { f0: 80, f1: 34, gain: 0.3 });
    noise(c, t, 0.3, { type: 'lowpass', f0: 900, f1: 120, gain: 0.22 });
  },
  reap() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.22, { f0: 1800, f1: 500, q: 3, gain: 0.14 });
    tone(c, t + 0.05, 0.6, { type: 'triangle', f0: 233, gain: 0.1 });
    tone(c, t + 0.05, 0.6, { type: 'sine', f0: 349, gain: 0.06 });
  },
  mote() {
    const c = ac(); if (!c || !gate('mote', 50)) return;
    const t = c.currentTime;
    tone(c, t, 0.08, { type: 'sine', f0: 660, f1: 990, gain: 0.05 });
  },
  shrine() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.9, { type: 'sine', f0: 98, f1: 147, gain: 0.16, attack: 0.15 });
    [0, 7, 12, 19, 24].forEach((s, k) => tone(c, t + 0.08 * k, 0.6, { type: 'triangle', f0: note(523, s), gain: 0.05 }));
    noise(c, t, 0.8, { f0: 1500, f1: 5000, q: 1, gain: 0.04, attack: 0.2 });
  },
  synergy() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    [[0, 4, 7], [5, 9, 12, 17]].forEach((ch, k) => ch.forEach((s) => tone(c, t + k * 0.16, 0.45, { type: 'triangle', f0: note(523, s), gain: 0.06 })));
  },
};
