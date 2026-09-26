// Enemy sounds (piece `enemies`), synthesised in WebAudio. Stand-ins for the `audio` piece,
// which can set enemySfx.enabled = false and play its own on the same events:
//   enemy:spawn, enemy:pop, enemy:windup {kind}, enemy:attack {kind}, enemy:hurt, enemy:die {kind},
//   enemy:flop, enemy:paw, enemy:wallStun, enemy:orbBurst
// The context is only created after a user gesture, so autoplay policy never logs a warning.

import { events } from '../core/events.js';
import { settings } from '../core/settings.js';

export const enemySfx = { enabled: true };
let ctx = null, out = null, buf = null, n = 0;

function ac() {
  if (!enemySfx.enabled) return null;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    ctx = new AudioContext();
    out = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    out.connect(comp).connect(ctx.destination);
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 3;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  } catch { ctx = null; return null; }
  return ctx;
}
const vol = () => (settings.get('masterVolume') ?? 0.8) * (settings.get('sfxVolume') ?? 0.9);
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(c, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 0.25, attack = 0.004 } = {}) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, attack, gain * vol(), dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + attack + 0.05);
}
function noise(c, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.25, attack = 0.004 } = {}) {
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain(); env(g, t, attack, gain * vol(), dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, (n * 0.173) % 0.8, dur + attack + 0.05);
}
const j = () => 1 + ((n++ % 5) - 2) * 0.03;

const S = {
  pop(c, t) { tone(c, t, 0.14, { type: 'triangle', f0: 240 * j(), f1: 520, gain: 0.16 }); noise(c, t, 0.1, { f0: 1800, f1: 500, gain: 0.12 }); },
  windup: {
    husk(c, t) { tone(c, t, 0.5, { type: 'sawtooth', f0: 90 * j(), f1: 70, gain: 0.1 }); noise(c, t, 0.45, { f0: 400, f1: 900, q: 3, gain: 0.08 }); },
    wisp(c, t) { tone(c, t, 0.66, { type: 'sine', f0: 300, f1: 1100, gain: 0.13 }); tone(c, t, 0.66, { type: 'triangle', f0: 452, f1: 1650, gain: 0.05 }); },
    brute(c, t) { tone(c, t, 0.9, { type: 'sawtooth', f0: 62, f1: 48, gain: 0.16 }); noise(c, t, 0.8, { type: 'lowpass', f0: 300, f1: 120, gain: 0.14 }); },
    mite(c, t) { for (let i = 0; i < 4; i++) tone(c, t + i * 0.05, 0.04, { type: 'square', f0: 2200 + i * 260, f1: 1800, gain: 0.05 }); },
  },
  attack: {
    husk(c, t) { noise(c, t, 0.14, { f0: 700, f1: 200, q: 1.2, gain: 0.22 }); tone(c, t, 0.12, { type: 'sine', f0: 110, f1: 45, gain: 0.3 }); },
    wisp(c, t) { tone(c, t, 0.22, { type: 'sawtooth', f0: 900, f1: 260, gain: 0.12 }); noise(c, t, 0.18, { f0: 3000, f1: 800, gain: 0.1 }); },
    brute(c, t) { noise(c, t, 0.4, { type: 'lowpass', f0: 500, f1: 150, gain: 0.2 }); tone(c, t, 0.3, { type: 'sawtooth', f0: 70, f1: 50, gain: 0.14 }); },
    mite(c, t) { tone(c, t, 0.1, { type: 'square', f0: 700, f1: 1500, gain: 0.09 }); },
  },
  hurt(c, t) { tone(c, t, 0.09, { type: 'square', f0: 260 * j(), f1: 150, gain: 0.08 }); },
  die: {
    husk(c, t) { tone(c, t, 0.3, { type: 'sawtooth', f0: 140, f1: 55, gain: 0.14 }); noise(c, t, 0.25, { f0: 900, f1: 200, gain: 0.12 }); },
    wisp(c, t) { noise(c, t, 0.35, { type: 'highpass', f0: 2000, f1: 5000, gain: 0.2 }); tone(c, t, 0.3, { type: 'triangle', f0: 1200, f1: 200, gain: 0.14 }); tone(c, t + 0.05, 0.2, { type: 'sine', f0: 1800, f1: 600, gain: 0.08 }); },
    brute(c, t) { tone(c, t, 0.7, { type: 'sawtooth', f0: 90, f1: 34, gain: 0.2 }); noise(c, t, 0.5, { type: 'lowpass', f0: 500, f1: 90, gain: 0.16 }); },
    mite(c, t) { tone(c, t, 0.1, { type: 'square', f0: 1500, f1: 300, gain: 0.1 }); noise(c, t, 0.08, { f0: 3500, f1: 1200, gain: 0.12 }); },
  },
  flop(c, t) { tone(c, t, 0.2, { type: 'sine', f0: 100, f1: 38, gain: 0.35 }); noise(c, t, 0.15, { type: 'lowpass', f0: 600, f1: 120, gain: 0.2 }); },
  paw(c, t) { tone(c, t, 0.14, { type: 'sine', f0: 80, f1: 40, gain: 0.28 }); noise(c, t, 0.12, { type: 'lowpass', f0: 800, f1: 150, gain: 0.16 }); },
  wall(c, t) { tone(c, t, 0.4, { type: 'sine', f0: 90, f1: 30, gain: 0.5 }); noise(c, t, 0.3, { f0: 1200, f1: 150, gain: 0.3 }); tone(c, t + 0.05, 0.3, { type: 'square', f0: 300, f1: 90, gain: 0.08 }); },
  orb(c, t) { tone(c, t, 0.12, { type: 'triangle', f0: 800, f1: 200, gain: 0.12 }); noise(c, t, 0.12, { f0: 2500, f1: 500, gain: 0.1 }); },
};
const play = (fn, x) => { const c = ac(); if (c) fn(c, c.currentTime + 0.001); };
events.on('enemy:spawn', () => play(S.pop));
events.on('enemy:windup', (e) => play(S.windup[e.kind] ?? S.windup.husk));
events.on('enemy:attack', (e) => play(S.attack[e.kind] ?? S.attack.husk));
events.on('enemy:hurt', () => play(S.hurt));
events.on('enemy:die', (e) => play(S.die[e.kind] ?? S.die.husk));
events.on('enemy:flop', () => play(S.flop));
events.on('enemy:paw', () => play(S.paw));
events.on('enemy:wallStun', () => play(S.wall));
events.on('enemy:orbBurst', () => play(S.orb));
