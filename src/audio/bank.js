// This piece's own SFX (piece `audio`): the sounds nobody else's stand-in covers yet.
// combat/enemies/boss/boons/arenas/gauntlet already synthesise swings, hits, barks-by-any-other-
// name (windups/attacks/deaths), pickups, doors and the collapse rumble on their own events; see
// mixer.js's header for how those are routed through this piece's mixer rather than reimplemented.
//
// New here: footsteps (voiced by room kind, since there is no per-tile surface material yet),
// the dash whoosh, and enemy vocal barks on spawn (a different register from the mechanical
// "pop" the enemies stand-in already plays at the same moment).
//
//   import { bank } from './audio/bank.js';   // importing it is enough: it listens to events
//   bank.footstep(speed)   bank.dash(dz)   bank.bark(kind)

import { events } from '../core/events.js';
import { world } from '../core/world.js';
import { sfxContext, sfxVol, tone, noise, makeNoiseBuffer, vary } from './mixer.js';

const bufCache = new Map(); // ctx -> (seed -> AudioBuffer)
function nbuf(c, seed) {
  let m = bufCache.get(c);
  if (!m) { m = new Map(); bufCache.set(c, m); }
  let b = m.get(seed);
  if (!b) { b = makeNoiseBuffer(c, seed, 1); m.set(seed, b); }
  return b;
}

/** Room kind stands in for floor material until a piece tracks per-tile surfaces (see notes). */
function surfaceOf() {
  const kind = world.room?.kind;
  return kind === 'corridor' ? 'rubble' : kind === 'boss' ? 'chain' : 'stone';
}

const BARK = {
  husk: { f0: 170, f1: 85, type: 'sawtooth', dur: 0.22, nf0: 1300, nf1: 450, gain: 0.16 },
  wisp: { f0: 680, f1: 1500, type: 'sine', dur: 0.32, nf0: 3200, nf1: 5200, gain: 0.11 },
  brute: { f0: 85, f1: 50, type: 'sawtooth', dur: 0.42, nf0: 480, nf1: 180, gain: 0.2 },
  mite: { f0: 1300, f1: 2400, type: 'square', dur: 0.08, nf0: 3600, nf1: 4600, gain: 0.09 },
};

export const bank = {
  enabled: true,

  /** A foot hits the floor: `speed` (units/s) scales loudness a little. */
  footstep(speed = 1) {
    if (!bank.enabled) return;
    const m = sfxContext(); if (!m) return;
    const { ctx: c, out } = m;
    const t = c.currentTime;
    const v = vary('footstep', { pitch: 0.09, gain: 0.22 });
    const gg = sfxVol() * v.gain * Math.min(1, 0.4 + speed * 0.2);
    const surf = surfaceOf();
    if (surf === 'rubble') {
      noise(c, out, nbuf(c, 21), t, 0.075, { type: 'bandpass', f0: 850 * v.pitch, f1: 240, q: 1.1, gain: 0.24 * gg, attack: 0.001 });
      noise(c, out, nbuf(c, 22), t, 0.05, { type: 'highpass', f0: 2400 * v.pitch, gain: 0.1 * gg, attack: 0.001 });
    } else if (surf === 'chain') {
      noise(c, out, nbuf(c, 23), t, 0.05, { type: 'bandpass', f0: 650 * v.pitch, f1: 280, q: 1.5, gain: 0.2 * gg, attack: 0.001 });
      tone(c, out, t, 0.07, { type: 'square', f0: 1500 * v.pitch, f1: 850, gain: 0.02 * gg, attack: 0.001 });
    } else {
      noise(c, out, nbuf(c, 24), t, 0.05, { type: 'bandpass', f0: 1050 * v.pitch, f1: 480, q: 1.7, gain: 0.19 * gg, attack: 0.001 });
    }
  },

  /** The hero's dash: a burst of displaced air. */
  dash(dz = 1) {
    if (!bank.enabled) return;
    const m = sfxContext(); if (!m) return;
    const { ctx: c, out } = m;
    const t = c.currentTime;
    const v = vary('dash', { pitch: 0.05, gain: 0.15 });
    const gg = sfxVol() * v.gain;
    noise(c, out, nbuf(c, 30), t, 0.19, { type: 'bandpass', f0: 650 * v.pitch, f1: 2500 * v.pitch, q: 1.1, gain: 0.32 * gg, attack: 0.006 });
    tone(c, out, t, 0.14, { type: 'triangle', f0: 250 * v.pitch, f1: 600 * v.pitch, gain: 0.1 * gg, attack: 0.003 });
  },

  /** A short vocal-ish blip per enemy kind, on top of (not instead of) the mechanical spawn pop. */
  bark(kind = 'husk') {
    if (!bank.enabled) return;
    const m = sfxContext(); if (!m) return;
    const { ctx: c, out } = m;
    const t = c.currentTime;
    const v = vary('bark:' + kind, { pitch: 0.1, gain: 0.18 });
    const gg = sfxVol() * v.gain;
    const s = BARK[kind] || BARK.husk;
    tone(c, out, t, s.dur, { type: s.type, f0: s.f0 * v.pitch, f1: s.f1 * v.pitch, gain: s.gain * gg, attack: 0.02 });
    noise(c, out, nbuf(c, 31), t, s.dur * 0.7, { type: 'bandpass', f0: s.nf0, f1: s.nf1, q: 1.6, gain: s.gain * 0.5 * gg, attack: 0.01 });
  },
};

events.on('hero:step', (e) => bank.footstep(e.speed));
events.on('move:dash', () => bank.dash(1));
events.on('enemy:spawn', (e) => bank.bark(e.kind));
