// The shared audio mixer (piece `audio`): one AudioContext for the whole game, a compressor,
// and two buses:
//
//   sfx bus    -> compressor -> analyser -> destination (+ a recording tap)
//   music bus  -> lowpass filter (muffle) -> duck gain -> compressor -> ...
//
// Everything that makes a sound shares this. combat, enemies, boss, boons, arenas and gauntlet
// already synthesise their own stand-in SFX (per-piece jsfxr-style generators wired to their own
// events); rather than replace that sound design, each of those files' tiny `ac()` function was
// pointed at `sfxContext()` here instead of opening its own AudioContext, so the whole game
// mixes through one compressor and one set of settings-driven volumes. Search those files for
// `sfxContext` to see the (one-line) change.
//
// This piece's own new sound sits in `bank.js` (footsteps, dash, enemy barks) and `music.js`
// (the four music tracks). Both import the helpers below instead of duplicating them.
//
//   import { sfxContext, musicContext, mixer, tone, noise, env, makeNoiseBuffer, vary,
//            sfxVol, musicVol, duckMusic, muffleMusic } from './audio/mixer.js';

import { settings } from '../core/settings.js';
import { rng } from '../core/rng.js';

let ctx = null;
let sfxBus = null;        // stand-ins and bank.js synthesize into this
let musicRaw = null;      // music.js synthesizes into this
let musicFilter = null;   // lowpass; muffled under pause / low health
let musicDuck = null;     // transient gain dip: telegraphs, big hits
let compressor = null;
let analyser = null;
let recordDest = null;    // MediaStreamAudioDestinationNode; a critic's MediaRecorder taps this
let muffled = false;

function build() {
  ctx = new AudioContext();
  sfxBus = ctx.createGain(); sfxBus.gain.value = 1;
  musicRaw = ctx.createGain(); musicRaw.gain.value = 1;
  musicFilter = ctx.createBiquadFilter();
  musicFilter.type = 'lowpass'; musicFilter.frequency.value = 20000; musicFilter.Q.value = 0.3;
  musicDuck = ctx.createGain(); musicDuck.gain.value = 1;
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16; compressor.knee.value = 12; compressor.ratio.value = 4;
  compressor.attack.value = 0.003; compressor.release.value = 0.22;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.72;
  recordDest = ctx.createMediaStreamDestination();

  sfxBus.connect(compressor);
  musicRaw.connect(musicFilter).connect(musicDuck).connect(compressor);
  compressor.connect(analyser);
  analyser.connect(ctx.destination);
  analyser.connect(recordDest);
}

/** Lazily creates the context on the first call after a user gesture; never throws, never logs. */
function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try { build(); } catch { ctx = null; return null; }
  return ctx;
}

/** For SFX producers (this piece's bank, and the other pieces' stand-ins). */
export function sfxContext() { const c = ensure(); return c ? { ctx: c, out: sfxBus } : null; }
/** For the music engine. */
export function musicContext() { const c = ensure(); return c ? { ctx: c, out: musicRaw } : null; }

export const sfxVol = () => (settings.get('masterVolume') ?? 0.8) * (settings.get('sfxVolume') ?? 0.9);
export const musicVol = () => (settings.get('masterVolume') ?? 0.8) * (settings.get('musicVolume') ?? 0.7);

/** Exponential envelope: silence -> attack -> peak -> decay -> (near) silence. No pops or clicks. */
export function env(g, t, attack, peak, decay, end = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(end, t + attack + decay);
}

/** A seeded noise buffer (LCG, not Math.random, so it's identical every run). */
export function makeNoiseBuffer(c, seed = 1, seconds = 1) {
  const buf = c.createBuffer(1, Math.max(1, Math.round(c.sampleRate * seconds)), c.sampleRate);
  const d = buf.getChannelData(0);
  let s = seed || 1;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  return buf;
}

export function tone(c, dest, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 0.25, attack = 0.004 } = {}) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f0), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, attack, gain, dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + dur + attack + 0.05);
  return o;
}

export function noise(c, dest, buf, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.25, attack = 0.004, offset = 0 } = {}) {
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain(); env(g, t, attack, gain, dur);
  s.connect(f).connect(g).connect(dest);
  s.start(t, offset, dur + attack + 0.05);
  return s;
}

// ---- "never twice in a row" -----------------------------------------------------------------
// One RNG stream per key (lazily forked off the *live* run RNG, so ?seed still determines the
// exact sequence). Each draw is nudged away from the previous one for that key.
const streams = new Map();
export function vary(key, { pitch = 0.05, gain = 0.12 } = {}) {
  let st = streams.get(key);
  if (!st) { st = { r: rng.fork(`audio/${key}`), p: null, g: null }; streams.set(key, st); }
  let p = 1, g = 1;
  for (let i = 0; i < 4; i++) { p = 1 + st.r.signed() * pitch; if (st.p === null || Math.abs(p - st.p) > pitch * 0.2) break; }
  for (let i = 0; i < 4; i++) { g = 1 + st.r.signed() * gain; if (st.g === null || Math.abs(g - st.g) > gain * 0.2) break; }
  st.p = p; st.g = g;
  return { pitch: p, gain: g };
}

// ---- bus-level shaping ------------------------------------------------------------------------

/** A quick dip in the music so a telegraph cue or a big hit reads clearly, then it comes back. */
export function duckMusic(amount = 0.4, ms = 220) {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  musicDuck.gain.cancelScheduledValues(t);
  musicDuck.gain.setValueAtTime(Math.max(0.001, musicDuck.gain.value), t);
  musicDuck.gain.linearRampToValueAtTime(Math.max(0.001, amount), t + 0.03);
  musicDuck.gain.linearRampToValueAtTime(1, t + 0.03 + ms / 1000);
}

/** Low-pass the music toward `cutoff` (paused behind a menu, or the world going faint at low hp). */
export function muffleMusic(on, cutoff = 650) {
  muffled = on;
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  musicFilter.frequency.cancelScheduledValues(t);
  musicFilter.frequency.setValueAtTime(musicFilter.frequency.value, t);
  musicFilter.frequency.linearRampToValueAtTime(on ? cutoff : 20000, t + 0.35);
}

export const mixer = {
  get ctx() { return ctx; },
  get running() { return !!ctx && ctx.state === 'running'; },
  get analyser() { return analyser; },
  duckMusic,
  muffleMusic,
  /** 0..1 average level and the raw frequency bins, for the showcase meter. */
  meter() {
    if (!analyser) return { level: 0, bins: [] };
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0; for (const v of data) sum += v;
    return { level: sum / data.length / 255, bins: data };
  },
  /** Time-domain samples (0..255, 128 = silence), for a scope line. */
  waveform() {
    if (!analyser) return null;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    return data;
  },
  /** A MediaStream of the finished master mix, for a critic's MediaRecorder (PROTOCOL.md). */
  masterStream() { ensure(); return recordDest ? recordDest.stream : null; },
  state() { return { running: this.running, sampleRate: ctx?.sampleRate ?? 0, muffled }; },
};
