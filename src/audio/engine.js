// The audio engine (piece `audio`): one AudioContext, one mixer, one master bus.
//
//   import { audio, audioContext, legacyBus, legacyVol } from './audio/engine.js';
//
// Graph (every sound in the game ends up here):
//
//   music  -> musicFilter (low-health / pause / death lowpass) -> musicEq (2.2 kHz dip: room for cues)
//          -> musicDuck -> musicVol (settings.musicVolume) --------------------------+
//   sfx    -> sfxDuckless --------------------------\                                |
//   cue    (telegraphs: never ducked) ----------------> sfxVol (settings.sfxVolume) -+-> sum
//   ui     ------------------------------------------/                               |
//   amb    -> ambDuck -----------------------------/                                 |
//   reverb sends (music 0.20, sfx 0.10, amb 0.35) -> convolver (crypt IR) -----------+
//   sum -> masterVol (settings.masterVolume) -> limiter -> masterOut -> destination
//                                                          masterOut -> analyser (meters)
//                                                          masterOut -> MediaStreamDestination (recording)
//
// The context is created on the first user gesture (keydown / pointerdown / touchstart), so
// the browser never logs an autoplay warning. Anything that asks for it earlier gets null.
// Other pieces' stand-in voices share this context through audioContext() + legacyBus(name).

import { settings } from '../core/settings.js';

let ctx = null;
let G = null;            // the graph, built once
let unlocked = false;
const unlockWaiters = new Set();

/** Perceptual taper for a 0..1 settings slider. */
const taper = (v) => (v <= 0 ? 0 : Math.min(1, v) ** 2);

function gestureSeen() {
  return !navigator.userActivation || navigator.userActivation.hasBeenActive;
}

/** Build the context and the graph. force: skip the gesture check (debug recording). */
function ensure(force = false) {
  if (ctx) {
    if (ctx.state === 'suspended' && (force || gestureSeen())) ctx.resume().catch(() => {});
    return ctx;
  }
  if (typeof AudioContext === 'undefined') return null;
  if (!force && !gestureSeen()) return null;
  try {
    ctx = new AudioContext({ latencyHint: 'interactive' });
  } catch { ctx = null; return null; }
  build();
  unlocked = true;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  for (const fn of [...unlockWaiters]) { try { fn(ctx); } catch (err) { console.error(err); } }
  unlockWaiters.clear();
  return ctx;
}

function gain(v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }

/** A synthetic crypt impulse response: stereo decorrelated noise, exponential decay, dark tail. */
function makeIR(seconds = 2.4, decay = 3.2) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let s = ch ? 91 : 17, lp = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const w = (s / 2147483647) * 2 - 1;
      const t = i / n;
      // the tail darkens as it decays (stone absorbs highs first)
      const k = 0.55 + 0.4 * t;
      lp = lp * k + w * (1 - k);
      const early = i < sr * 0.012 ? 0 : 1;           // pre-delay: 12 ms
      d[i] = lp * Math.pow(1 - t, decay) * early * 1.8;
    }
  }
  return buf;
}

function build() {
  const c = ctx;
  G = {};
  G.masterOut = gain(1);
  G.limiter = c.createDynamicsCompressor();
  G.limiter.threshold.value = -4; G.limiter.knee.value = 2; G.limiter.ratio.value = 20;
  G.limiter.attack.value = 0.002; G.limiter.release.value = 0.12;
  G.masterVol = gain(taper(settings.get('masterVolume') ?? 0.8));
  G.sum = gain(1);
  // a gentle 36 Hz highpass: nothing below it is audible on game speakers, and it eats headroom
  G.rumbleCut = c.createBiquadFilter();
  G.rumbleCut.type = 'highpass'; G.rumbleCut.frequency.value = 36; G.rumbleCut.Q.value = 0.7;
  G.sum.connect(G.rumbleCut).connect(G.masterVol).connect(G.limiter).connect(G.masterOut).connect(c.destination);

  G.analyser = c.createAnalyser();
  G.analyser.fftSize = 2048;
  G.analyser.smoothingTimeConstant = 0.6;
  G.masterOut.connect(G.analyser);

  // reverb
  G.verb = c.createConvolver();
  G.verb.buffer = makeIR();
  G.verbOut = gain(0.55);
  G.verb.connect(G.verbOut).connect(G.sum);

  // music
  G.music = gain(1.25);
  G.musicFilter = c.createBiquadFilter();
  G.musicFilter.type = 'lowpass'; G.musicFilter.frequency.value = 20000; G.musicFilter.Q.value = 0.7;
  G.musicEq = c.createBiquadFilter();
  G.musicEq.type = 'peaking'; G.musicEq.frequency.value = 2200; G.musicEq.Q.value = 0.6; G.musicEq.gain.value = -3;
  G.musicDuck = gain(1);
  G.musicVol = gain(taper(settings.get('musicVolume') ?? 0.7));
  G.music.connect(G.musicFilter).connect(G.musicEq).connect(G.musicDuck).connect(G.musicVol).connect(G.sum);
  G.musicSend = gain(0.2);
  G.musicVol.connect(G.musicSend).connect(G.verb);

  // effects
  G.sfxVol = gain(taper(settings.get('sfxVolume') ?? 0.9));
  G.sfxVol.connect(G.sum);
  G.sfxSend = gain(0.1);
  G.sfxVol.connect(G.sfxSend).connect(G.verb);
  G.sfx = gain(1); G.sfx.connect(G.sfxVol);
  G.cue = gain(1); G.cue.connect(G.sfxVol);
  G.ui = gain(0.9); G.ui.connect(G.sfxVol);
  G.amb = gain(1);
  G.ambDuck = gain(1);
  G.amb.connect(G.ambDuck).connect(G.sfxVol);
  G.ambSend = gain(0.35);
  G.ambDuck.connect(G.ambSend).connect(G.verb);

  G.legacy = {};

  settings.onChange((key, v) => {
    if (!G) return;
    const t = ctx.currentTime;
    const p = key === 'masterVolume' ? G.masterVol : key === 'musicVolume' ? G.musicVol : key === 'sfxVolume' ? G.sfxVol : null;
    if (p) p.gain.setTargetAtTime(taper(v), t, 0.03);
  });
}

// ---- ducking --------------------------------------------------------------------------------
// One duck envelope per ducked bus. A new duck never makes an ongoing deeper one shallower.
const duckState = { music: { depth: 1, end: 0 }, amb: { depth: 1, end: 0 } };

function duckBus(which, db, hold, release, attack) {
  if (!G) return;
  const node = which === 'music' ? G.musicDuck : G.ambDuck;
  const st = duckState[which];
  const t = ctx.currentTime;
  let depth = Math.pow(10, -Math.abs(db) / 20);
  let end = t + attack + hold;
  if (t < st.end) { depth = Math.min(depth, st.depth); end = Math.max(end, st.end); }
  st.depth = depth; st.end = end;
  const p = node.gain;
  const now = p.value;
  p.cancelScheduledValues(t);
  p.setValueAtTime(now, t);
  p.linearRampToValueAtTime(Math.min(now, depth), t + attack);
  p.setValueAtTime(depth, end);
  p.setTargetAtTime(1, end, release / 3);
}

// ---- recording ---------------------------------------------------------------------------------
let streamDest = null;
function stream() {
  const c = ensure(true);
  if (!c) return null;
  if (!streamDest) { streamDest = c.createMediaStreamDestination(); G.masterOut.connect(streamDest); }
  return streamDest.stream;
}

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Record the master bus with MediaRecorder for ms. Resolves {ok, mime, bytes, b64}. */
function record(ms = 5000) {
  const st = stream();
  if (!st) return Promise.resolve({ ok: false, error: 'no audio context' });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  return new Promise((resolve) => {
    const rec = new MediaRecorder(st, mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: rec.mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      resolve({ ok: true, mime: rec.mimeType, bytes: bytes.length, b64: toB64(bytes) });
    };
    rec.start(250);
    setTimeout(() => rec.stop(), ms);
  });
}

// lossless capture of the master bus through an AudioWorklet (for measuring clicks, DC, peaks)
const TAP_SRC = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = e.data; }; }
  process(inputs) {
    const i = inputs[0];
    if (this.on && i && i.length) this.port.postMessage([i[0].slice(0), (i[1] || i[0]).slice(0)]);
    return true;
  }
}
registerProcessor('gr-tap', Tap);`;
let tapNode = null;
async function tap() {
  const c = ensure(true);
  if (!c) return null;
  if (tapNode) return tapNode;
  const url = URL.createObjectURL(new Blob([TAP_SRC], { type: 'text/javascript' }));
  await c.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  tapNode = new AudioWorkletNode(c, 'gr-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
  const sink = gain(0);
  G.masterOut.connect(tapNode).connect(sink).connect(c.destination);
  return tapNode;
}

/** Record the master bus as 16-bit stereo WAV for ms. Resolves {ok, bytes, b64}. */
async function recordWav(ms = 5000) {
  const node = await tap();
  if (!node) return { ok: false, error: 'no audio context' };
  const L = [], R = [];
  node.port.onmessage = (e) => { L.push(e.data[0]); R.push(e.data[1]); };
  node.port.postMessage(true);
  await new Promise((r) => setTimeout(r, ms));
  node.port.postMessage(false);
  node.port.onmessage = null;
  const n = L.reduce((a, b) => a + b.length, 0);
  const sr = ctx.sampleRate;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let k = 0; k < L.length; k++) {
    const a = L[k], b = R[k];
    for (let i = 0; i < a.length; i++) {
      v.setInt16(o, Math.max(-1, Math.min(1, a[i])) * 32767, true);
      v.setInt16(o + 2, Math.max(-1, Math.min(1, b[i])) * 32767, true);
      o += 4;
    }
  }
  return { ok: true, sampleRate: sr, samples: n, bytes: buf.byteLength, b64: toB64(new Uint8Array(buf)) };
}

// ---- meters ------------------------------------------------------------------------------------
let wave = null, spec = null;
/** Peak and RMS of the master bus right now (linear), plus the arrays for drawing. */
function meter() {
  if (!G) return { peak: 0, rms: 0, wave: null, spec: null };
  if (!wave) { wave = new Float32Array(G.analyser.fftSize); spec = new Uint8Array(G.analyser.frequencyBinCount); }
  G.analyser.getFloatTimeDomainData(wave);
  G.analyser.getByteFrequencyData(spec);
  let peak = 0, sum = 0;
  for (let i = 0; i < wave.length; i++) { const a = Math.abs(wave[i]); if (a > peak) peak = a; sum += wave[i] * wave[i]; }
  return { peak, rms: Math.sqrt(sum / wave.length), wave, spec };
}

// ---- unlock listeners ----------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  const onGesture = () => { ensure(); };
  for (const ev of ['keydown', 'pointerdown', 'mousedown', 'touchstart']) window.addEventListener(ev, onGesture, { capture: true, passive: true });
  // gamepad presses grant activation too; catch them lazily
  const poll = setInterval(() => { if (ctx) { clearInterval(poll); return; } if (gestureSeen() && navigator.userActivation) ensure(); }, 250);
}

export const audio = {
  /** The shared AudioContext, or null before the first gesture. */
  get ctx() { return ctx; },
  get unlocked() { return unlocked && !!ctx; },
  get graph() { return G; },
  ensure,
  /** Call fn(ctx) once the context exists (now, if it already does). */
  onUnlock(fn) { if (ctx) fn(ctx); else unlockWaiters.add(fn); },
  /** A bus input node: 'music' | 'sfx' | 'cue' | 'ui' | 'amb'. Null before unlock. */
  bus(name) { return G ? G[name] ?? G.sfx : null; },
  /** Duck the music (and ambience) under something important. db: depth, seconds for the rest. */
  duck(db = 6, hold = 0.2, release = 0.5, attack = 0.015) { duckBus('music', db, hold, release, attack); duckBus('amb', db * 0.7, hold, release, attack); },
  /** The master bus as a MediaStream (for MediaRecorder). Creates the context if needed. */
  stream,
  record,
  recordWav,
  meter,
  /** The node every sound passes through last (post-limiter). */
  get master() { return G?.masterOut ?? null; },
  get time() { return ctx ? ctx.currentTime : 0; },
};

// ---- other pieces' stand-in voices ------------------------------------------------------------------
/** The shared context for a stand-in voice module (null before the first gesture). */
export function audioContext() { return ensure(); }

/**
 * The input node a stand-in voice module connects its output to. Each module gets its own trim
 * gain into the sfx bus, so the mixer can balance pieces against each other.
 */
const LEGACY_TRIM = { combat: 1, enemies: 0.9, boons: 0.85, hud: 1.1, boss: 0.95, arena: 0.9, gauntlet: 0.95 };
export function legacyBus(name) {
  ensure();
  if (!G) return null;
  if (!G.legacy[name]) {
    const g = gain(LEGACY_TRIM[name] ?? 1);
    g.connect(G.sfx);
    G.legacy[name] = g;
  }
  return G.legacy[name];
}

/**
 * Volume for one layer of a stand-in sound. The mixer applies the settings volumes, so this is
 * only a small random variation (0.8 .. 1.0), which keeps repeated sounds from being identical.
 */
let boost = 1;
export function legacyVol() { return (0.8 + Math.random() * 0.2) * boost; }

/**
 * Run fn (a stand-in voice call) with its layers boosted by mult. The stand-ins read legacyVol()
 * synchronously while they build a sound, so this scales exactly that one sound.
 */
export function withBoost(mult, fn) {
  const prev = boost;
  boost = mult;
  try { return fn(); } finally { boost = prev; }
}
