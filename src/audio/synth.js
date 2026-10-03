// A jsfxr-style offline synth: parameter sets in, sample buffers out (piece `audio`).
//
// It follows sfxr's voice (one oscillator per layer: square with duty and duty sweep, saw, sine,
// triangle, sample-and-hold "pitched" noise or white noise; frequency slide and slide
// acceleration; vibrato; one arpeggio jump; repeat; attack / sustain+punch / decay envelope;
// resonant lowpass and highpass with sweeps; phaser; bit and rate crush) but in physical units,
// so sounds can be authored by ear-math: Hz, seconds, octaves per second.
//
//   import { renderLayers, mutate } from './synth.js';
//   const data = renderLayers([{ wave: 'square', f: 440, d: 0.2 }, ...], 44100);   // Float32Array
//
// Layer parameters (all optional except f for tonal waves):
//   wave   'square' | 'saw' | 'sine' | 'tri' | 'noise' (sfxr: new random value every period) | 'white'
//   f      start frequency, Hz          slide   octaves per second (signed)   dslide  oct/s^2
//   fmin   the layer ends when the pitch falls below this (sfxr's frequency cutoff)
//   a s d  attack, sustain, decay in seconds;  punch 0..1 (sfxr sustain punch);  curve: decay exponent
//   duty   0..0.5 (square)   dutySweep  per second
//   vib    depth 0..1 (fraction of pitch)   vibHz   vibDelay seconds before vibrato starts
//   arp    frequency multiplier applied once at arpT seconds
//   repeat seconds: restart pitch (and arp) every repeat (sfxr repeat speed)
//   lpf    Hz, lpfSweep oct/s, res 0..1      hpf  Hz, hpfSweep oct/s
//   phaser seconds of comb delay, phaserSweep s/s
//   crush  sample-and-hold rate in Hz (lo-fi grit)   bits  quantise to n bits
//   drive  soft-clip amount (0 = clean)   gain  layer gain   delay  start offset in seconds

const TAU = Math.PI * 2;
// oversampling: 4x for the hard-edged waves (aliasing), 2x for sfxr noise, 1x for sine and white
const OS_FOR = { square: 4, saw: 4, tri: 4, noise: 2, sine: 1, white: 1 };

/** Small seeded PRNG (mulberry32). */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NUMERIC_VARY = { f: 1, slide: 0.6, a: 0.5, s: 0.6, d: 0.6, lpf: 1, hpf: 0.6, duty: 0.4, vibHz: 0.5, crush: 0.5, gain: 0.5, delay: 0.3 };

/** A variant of a layer list: every listed numeric param nudged by up to +-amount (relative). */
export function mutate(layers, amount, rnd) {
  return layers.map((L) => {
    const o = { ...L };
    for (const k in NUMERIC_VARY) {
      if (typeof o[k] !== 'number' || o[k] === 0) continue;
      if (k === 'delay' && o[k] < 0.01) continue;
      const u = (rnd() * 2 - 1) * amount * NUMERIC_VARY[k];
      o[k] = o[k] * (1 + u);
    }
    if (o.duty !== undefined) o.duty = Math.max(0.02, Math.min(0.5, o.duty));
    o.seed = Math.floor(rnd() * 1e9);
    return o;
  });
}

/** Length in seconds of one layer, including its delay. */
export function layerLength(L) {
  return (L.delay ?? 0) + (L.a ?? 0) + (L.s ?? 0) + (L.d ?? 0.1);
}

/** Render one layer, mixing it into out (Float32Array at sr). */
function renderLayer(L, out, sr) {
  const wave = L.wave ?? 'square';
  const OS = Math.max(L.lpf ? 2 : 1, OS_FOR[wave] ?? 4);
  const fs = sr * OS;
  // every layer gets at least a 1.5 ms attack, so a delayed layer never starts on a step (click)
  const a = Math.max(0.0015, L.a ?? 0), s = Math.max(0, L.s ?? 0), d = Math.max(0.001, L.d ?? 0.1);
  const punch = L.punch ?? 0, curve = L.curve ?? 1;
  const total = a + s + d;
  const n0 = Math.floor((L.delay ?? 0) * sr);
  const n = Math.min(out.length - n0, Math.ceil(total * sr));
  if (n <= 0) return;
  const rnd = prng(L.seed ?? 1234);

  let f = L.f ?? 440;
  const f0 = f;
  const slideK0 = Math.pow(2, (L.slide ?? 0) / fs);
  let slideK = slideK0;
  const dslideK = Math.pow(2, (L.dslide ?? 0) / fs / fs);
  const fmin = L.fmin ?? 0, fmax = L.fmax ?? 20000;
  let duty = L.duty ?? 0.5;
  const dutyStep = (L.dutySweep ?? 0) / fs;
  const vib = L.vib ?? 0, vibW = TAU * (L.vibHz ?? 6) / fs, vibDelay = (L.vibDelay ?? 0) * fs;
  const arp = L.arp ?? 1, arpAt = (L.arpT ?? 0) * fs;
  const rep = (L.repeat ?? 0) * fs;
  let lpf = L.lpf ?? 0;           // 0 = off
  const lpfK = Math.pow(2, (L.lpfSweep ?? 0) / fs);
  const damp = 2 - 1.9 * Math.min(0.97, L.res ?? 0);
  const Fmax = -damp + Math.sqrt(damp * damp + 3.4);
  let hpf = L.hpf ?? 0;
  const hpfK = Math.pow(2, (L.hpfSweep ?? 0) / fs);
  const phLen = Math.floor((L.phaser ?? 0) * fs);
  const phStep = (L.phaserSweep ?? 0);
  const ph = phLen || phStep ? new Float32Array(4096) : null;
  let phD = phLen, pi = 0;
  const crush = L.crush ? sr / L.crush : 0;
  const bits = L.bits ? Math.pow(2, L.bits - 1) : 0;
  const drive = L.drive ?? 0;
  const g = (L.gain ?? 0.5);

  let phase = 0, noiseV = rnd() * 2 - 1, arpDone = false;
  let low = 0, band = 0, hpPrev = 0, hpOut = 0;
  let held = 0, holdT = 0;
  let k = 0;   // oversampled sample counter
  let ended = false;
  let endFade = 1;

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // envelope (at output rate)
    let env;
    if (t < a) env = t / a;
    else if (t < a + s) env = 1 + (1 - (t - a) / Math.max(1e-6, s)) * 2 * punch;
    else env = Math.pow(Math.max(0, 1 - (t - a - s) / d), curve);
    if (ended) { endFade *= 0.985; env *= endFade; }

    let acc = 0;
    for (let o = 0; o < OS; o++, k++) {
      if (rep && k > 0 && k % rep < 1) { f = f0; slideK = slideK0; arpDone = false; }
      if (!arpDone && arpAt && k >= arpAt) { f *= arp; arpDone = true; }
      slideK *= dslideK;
      f *= slideK;
      if (f < fmin) { ended = true; f = fmin; }
      if (f > fmax) f = fmax;
      let fr = f;
      if (vib && k > vibDelay) fr *= 1 + Math.sin(vibW * (k - vibDelay)) * vib;
      duty = Math.min(0.5, Math.max(0.02, duty + dutyStep));
      phase += fr / fs;
      if (phase >= 1) { phase -= Math.floor(phase); noiseV = rnd() * 2 - 1; }
      let x;
      switch (wave) {
        case 'square': x = phase < duty ? 0.5 : -0.5; break;
        case 'saw': x = 0.5 - phase; break;
        case 'sine': x = 0.5 * Math.sin(TAU * phase); break;
        case 'tri': x = phase < 0.5 ? phase * 2 - 0.5 : 1.5 - phase * 2; break;
        case 'noise': x = noiseV * 0.5; break;
        default: x = (rnd() * 2 - 1) * 0.5;   // white
      }
      // resonant lowpass (Chamberlin state-variable)
      if (lpf) {
        lpf = Math.min(fs / 6.5, Math.max(20, lpf * lpfK));
        // keep the state-variable filter inside its stable region: F^2 + 2*F*damp < 4
        const F = Math.min(2 * Math.sin(Math.PI * lpf / fs), Fmax);
        const high = x - low - damp * band;
        band += F * high;
        low += F * band;
        x = low;
      }
      // one-pole highpass
      if (hpf) {
        hpf = Math.min(fs / 4, Math.max(10, hpf * hpfK));
        const rc = 1 / (TAU * hpf), al = rc / (rc + 1 / fs);
        hpOut = al * (hpOut + x - hpPrev);
        hpPrev = x;
        x = hpOut;
      }
      // phaser (comb)
      if (ph) {
        ph[pi & 4095] = x;
        phD = Math.max(1, Math.min(4000, phD + phStep));
        x += ph[(pi - Math.floor(phD)) & 4095];
        pi++;
      }
      acc += x;
    }
    let y = acc / OS;
    if (crush) {
      holdT += 1;
      if (holdT >= crush) { holdT -= crush; held = y; }
      y = held;
    }
    if (bits) y = Math.round(y * bits) / bits;
    if (drive) y = Math.tanh(y * (1 + drive * 4)) / Math.tanh(1 + drive * 4) * 0.9;
    out[n0 + i] += y * env * g;
  }
}

/** Render a list of layers into one buffer, with a click-free start and end and no DC. */
export function renderLayers(layers, sr = 44100) {
  const len = Math.max(...layers.map(layerLength)) + 0.02;
  const out = new Float32Array(Math.ceil(len * sr));
  for (const L of layers) renderLayer(L, out, sr);
  // safety: a non-finite sample would poison every filter downstream for good
  for (let i = 0; i < out.length; i++) { const v = out[i]; out[i] = Number.isFinite(v) ? Math.max(-4, Math.min(4, v)) : 0; }
  // DC blocker (20 Hz)
  let xp = 0, yp = 0;
  const R = 1 - TAU * 20 / sr;
  for (let i = 0; i < out.length; i++) { const y = out[i] - xp + R * yp; xp = out[i]; yp = y; out[i] = y; }
  // 1 ms fade in, 6 ms fade out
  const fi = Math.floor(sr * 0.001), fo = Math.floor(sr * 0.006);
  for (let i = 0; i < fi && i < out.length; i++) out[i] *= i / fi;
  for (let i = 0; i < fo && i < out.length; i++) out[out.length - 1 - i] *= i / fo;
  return out;
}
