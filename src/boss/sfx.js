// The Warden's sounds (piece `boss`), synthesised in WebAudio. Stand-ins for the `audio` piece,
// which can set bossSfx.enabled = false and play its own on the same events:
//   boss:beat  boss:step  boss:eyes  boss:roar {big}  boss:windup {attack}  boss:attack {attack}
//   boss:sweepPass  boss:sweepEnd  boss:lashHit  boss:slam  boss:land  boss:ring  boss:summon
//   boss:hurt {armored}  boss:clang  boss:crit  boss:punish  boss:stagger  boss:phase {to}
//   boss:crack  boss:reel  boss:cage  boss:heroHit  boss:deathHit  boss:deathBeat  boss:deathBurst  boss:defeated
//   boss:nameCard  boss:barFill
// The context is only created after a user gesture, so autoplay policy never logs a warning.

import { events } from '../core/events.js';
import { settings } from '../core/settings.js';

export const bossSfx = { enabled: true };
let ctx = null, out = null, buf = null, n = 0;

function ac() {
  if (!bossSfx.enabled) return null;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    ctx = new AudioContext();
    out = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 8;
    out.connect(comp).connect(ctx.destination);
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 7;
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
const chainRattle = (c, t, k = 5, gain = 0.09) => { for (let i = 0; i < k; i++) { const u = t + i * 0.035 + (i * 7 % 3) * 0.008; tone(c, u, 0.05, { type: 'square', f0: 1900 - i * 90, f1: 900, gain: gain * (1 - i / (k + 2)) }); noise(c, u, 0.04, { f0: 4200, f1: 2500, gain: gain * 0.7 }); } };
const roar = (c, t, big) => {
  const d = big ? 1.5 : 0.9;
  tone(c, t, d, { type: 'sawtooth', f0: 92, f1: 42, gain: 0.32, attack: 0.05 });
  tone(c, t, d, { type: 'square', f0: 61, f1: 33, gain: 0.2, attack: 0.05 });
  tone(c, t + 0.05, d * 0.9, { type: 'sawtooth', f0: 184, f1: 70, gain: 0.1, attack: 0.06 });
  noise(c, t, d, { type: 'lowpass', f0: 900, f1: 120, gain: 0.3, attack: 0.05 });
  noise(c, t, d * 0.6, { type: 'bandpass', f0: 700, f1: 300, q: 2, gain: 0.16, attack: 0.04 });
};
const boom = (c, t, big = 1) => {
  tone(c, t, 0.55 * big, { type: 'sine', f0: 120, f1: 28, gain: 0.7 });
  noise(c, t, 0.4 * big, { type: 'lowpass', f0: 1400, f1: 90, gain: 0.5 });
  tone(c, t + 0.02, 0.3, { type: 'square', f0: 220, f1: 60, gain: 0.12 });
};

const S = {
  beat(c, t) { tone(c, t, 0.35, { type: 'sine', f0: 58, f1: 34, gain: 0.5 }); tone(c, t + 0.22, 0.3, { type: 'sine', f0: 52, f1: 32, gain: 0.35 }); },
  step(c, t) { tone(c, t, 0.22, { type: 'sine', f0: 90 * j(), f1: 34, gain: 0.5 }); noise(c, t, 0.16, { type: 'lowpass', f0: 700, f1: 120, gain: 0.3 }); chainRattle(c, t + 0.04, 3, 0.05); },
  eyes(c, t) { tone(c, t, 0.9, { type: 'sawtooth', f0: 70, f1: 210, gain: 0.16, attack: 0.5 }); tone(c, t, 0.9, { type: 'sine', f0: 300, f1: 1200, gain: 0.08, attack: 0.6 }); noise(c, t + 0.6, 0.35, { type: 'highpass', f0: 3000, f1: 6000, gain: 0.2 }); },
  roar(c, t, e) { roar(c, t, e.big !== false); },
  windup: {
    sweep(c, t) { tone(c, t, 0.9, { type: 'sawtooth', f0: 60, f1: 110, gain: 0.16, attack: 0.4 }); chainRattle(c, t, 9, 0.08); noise(c, t, 0.9, { type: 'lowpass', f0: 250, f1: 700, gain: 0.14, attack: 0.5 }); },
    lash(c, t) { chainRattle(c, t, 6, 0.09); tone(c, t, 0.6, { type: 'sawtooth', f0: 80, f1: 130, gain: 0.12, attack: 0.3 }); },
    slam(c, t) { tone(c, t, 0.85, { type: 'sawtooth', f0: 55, f1: 90, gain: 0.16, attack: 0.5 }); chainRattle(c, t, 5, 0.07); noise(c, t, 0.7, { type: 'lowpass', f0: 300, f1: 800, gain: 0.1, attack: 0.5 }); },
    leap(c, t) { tone(c, t, 0.7, { type: 'sawtooth', f0: 50, f1: 75, gain: 0.16, attack: 0.4 }); noise(c, t, 0.7, { f0: 200, f1: 900, q: 2, gain: 0.08 }); },
    summon(c, t) { roar(c, t, false); tone(c, t + 0.3, 1.1, { type: 'sine', f0: 200, f1: 660, gain: 0.08, attack: 0.5 }); },
  },
  attack: {
    sweepGo(c, t) { noise(c, t, 0.5, { type: 'bandpass', f0: 500, f1: 1800, q: 1.5, gain: 0.3, attack: 0.15 }); tone(c, t, 0.5, { type: 'sawtooth', f0: 90, f1: 200, gain: 0.14 }); },
    lash(c, t) { noise(c, t, 0.22, { f0: 3000, f1: 700, q: 1, gain: 0.3 }); tone(c, t, 0.18, { type: 'sawtooth', f0: 600, f1: 120, gain: 0.14 }); chainRattle(c, t, 5, 0.1); },
    slam(c, t) { noise(c, t, 0.1, { type: 'highpass', f0: 1500, f1: 600, gain: 0.2 }); },
    leap(c, t) { tone(c, t, 0.3, { type: 'sine', f0: 120, f1: 60, gain: 0.5 }); noise(c, t, 0.3, { type: 'lowpass', f0: 900, f1: 200, gain: 0.3 }); },
  },
  sweepPass(c, t) { noise(c, t, 0.4, { type: 'bandpass', f0: 400, f1: 1400, q: 1.2, gain: 0.16, attack: 0.1 }); chainRattle(c, t, 3, 0.06); },
  sweepEnd(c, t) { tone(c, t, 0.4, { type: 'sine', f0: 90, f1: 40, gain: 0.35 }); noise(c, t, 0.4, { type: 'lowpass', f0: 500, f1: 100, gain: 0.2 }); },
  lashHit(c, t) { boom(c, t, 0.6); chainRattle(c, t + 0.05, 5, 0.08); },
  slam(c, t) { boom(c, t, 1); tone(c, t + 0.03, 0.5, { type: 'sawtooth', f0: 70, f1: 30, gain: 0.25 }); },
  land(c, t) { boom(c, t, 1.1); noise(c, t + 0.05, 0.5, { type: 'lowpass', f0: 600, f1: 80, gain: 0.35 }); },
  ring(c, t) { tone(c, t, 0.9, { type: 'sine', f0: 250, f1: 80, gain: 0.16 }); noise(c, t, 0.9, { type: 'bandpass', f0: 1200, f1: 300, q: 0.7, gain: 0.14 }); },
  summon(c, t) { for (let i = 0; i < 3; i++) tone(c, t + i * 0.12, 0.5, { type: 'triangle', f0: 200 + i * 60, f1: 500 + i * 80, gain: 0.1 }); boom(c, t, 0.6); },
  hurt(c, t, e) { if (e.armored) { tone(c, t, 0.16, { type: 'square', f0: 700 * j(), f1: 260, gain: 0.14 }); noise(c, t, 0.1, { f0: 3500, f1: 1200, gain: 0.16 }); } else { tone(c, t, 0.12, { type: 'square', f0: 420 * j(), f1: 160, gain: 0.16 }); tone(c, t, 0.24, { type: 'sine', f0: 140, f1: 55, gain: 0.3 }); noise(c, t, 0.14, { f0: 2400, f1: 500, gain: 0.2 }); } },
  clang(c, t) { tone(c, t, 0.4, { type: 'square', f0: 1400, f1: 900, gain: 0.08 }); tone(c, t, 0.5, { type: 'triangle', f0: 2100, f1: 1500, gain: 0.08 }); noise(c, t, 0.06, { f0: 5000, f1: 2500, gain: 0.2 }); },
  crit(c, t) { tone(c, t, 0.25, { type: 'triangle', f0: 900, f1: 1800, gain: 0.12 }); tone(c, t + 0.05, 0.25, { type: 'triangle', f0: 1350, f1: 2700, gain: 0.09 }); },
  punish(c, t) { tone(c, t, 0.2, { type: 'triangle', f0: 660, f1: 990, gain: 0.08 }); },
  stagger(c, t) { boom(c, t, 0.5); tone(c, t, 0.4, { type: 'triangle', f0: 500, f1: 1400, gain: 0.1 }); },
  phase(c, t) { boom(c, t, 1.4); tone(c, t, 1.4, { type: 'sawtooth', f0: 40, f1: 25, gain: 0.35 }); },
  crack(c, t) { noise(c, t, 0.3, { type: 'highpass', f0: 1500, f1: 700, gain: 0.35 }); tone(c, t, 0.4, { type: 'square', f0: 200, f1: 50, gain: 0.15 }); boom(c, t, 0.7); },
  reel(c, t) { chainRattle(c, t, 3, 0.09); },
  cage(c, t) { for (let i = 0; i < 6; i++) { const u = t + i * 0.09; tone(c, u, 0.3, { type: 'sine', f0: 110, f1: 45, gain: 0.3 }); noise(c, u, 0.2, { f0: 1800, f1: 400, gain: 0.2 }); } chainRattle(c, t, 8, 0.1); },
  heroHit(c, t) { noise(c, t, 0.1, { f0: 900, f1: 200, gain: 0.15 }); },
  deathHit(c, t) { boom(c, t, 1.6); tone(c, t, 1.4, { type: 'sawtooth', f0: 160, f1: 30, gain: 0.3, attack: 0.02 }); roar(c, t + 0.05, true); },
  deathBeat(c, t) { tone(c, t, 0.4, { type: 'sine', f0: 70, f1: 30, gain: 0.5 }); noise(c, t, 0.3, { f0: 2000, f1: 500, gain: 0.15 }); },
  deathBurst(c, t) { boom(c, t, 2.2); noise(c, t, 1.3, { type: 'lowpass', f0: 4000, f1: 200, gain: 0.5 }); tone(c, t, 1.6, { type: 'sawtooth', f0: 400, f1: 40, gain: 0.25 }); },
  defeated(c, t) {
    // a rising major fanfare in triads, then a bell
    const notes = [261.6, 329.6, 392, 523.3, 659.3, 784];
    notes.forEach((f, i) => { tone(c, t + i * 0.12, 1.4 - i * 0.05, { type: 'triangle', f0: f, f1: f, gain: 0.13, attack: 0.01 }); tone(c, t + i * 0.12, 1.2, { type: 'sine', f0: f * 2, f1: f * 2, gain: 0.05 }); });
    tone(c, t + 0.9, 2.2, { type: 'sine', f0: 1046, f1: 1046, gain: 0.1, attack: 0.005 });
    noise(c, t + 0.7, 1.4, { type: 'highpass', f0: 5000, f1: 9000, gain: 0.05, attack: 0.2 });
  },
  nameCard(c, t) { boom(c, t, 1.2); roar(c, t, true); },
  barFill(c, t) { for (let i = 0; i < 10; i++) tone(c, t + i * 0.05, 0.08, { type: 'square', f0: 200 + i * 30, f1: 220 + i * 30, gain: 0.04 }); },
};
const play = (fn, e) => { const c = ac(); if (c) fn(c, c.currentTime + 0.001, e ?? {}); };
for (const k of ['beat', 'step', 'eyes', 'roar', 'sweepPass', 'sweepEnd', 'lashHit', 'slam', 'land', 'ring', 'summon', 'hurt', 'clang', 'crit', 'punish', 'stagger', 'phase', 'crack', 'reel', 'cage', 'heroHit', 'deathHit', 'deathBeat', 'deathBurst', 'defeated', 'nameCard', 'barFill']) {
  events.on(`boss:${k}`, (e) => play(S[k], e));
}
events.on('boss:windup', (e) => { const f = S.windup[e.attack]; if (f) play(f, e); });
events.on('boss:attack', (e) => { const f = S.attack[e.attack]; if (f) play(f, e); });
