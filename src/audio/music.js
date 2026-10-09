// Music (piece `audio`): a lookahead sequencer, chiptune-ish instruments built from oscillators,
// and three songs, all in D minor so the stems, stings and the pickup ladder agree.
//
//   import { music, SONGS } from './audio/music.js';
//   music.play('crypt' | 'title' | 'warden' | null, { fade })   // crossfades; same song = no-op
//   music.want({ bed: true, drums: true, ... })   // stems on/off: applied on the next half bar
//   music.level('alarm', 0..1)                    // continuous stem level (smoothed)
//   music.intensity = 0..1                        // passed to the song (it adds fills / 16th hats)
//   music.filter('normal' | 'lowhp' | 'pause' | 'dead')
//
// Songs:
//   title  "Beneath the Mountain"  76 BPM   bed, bass, arp, lead (lead every other pass)
//   crypt  "The Gauntlet"         132 BPM   bed, drums, bass, arp, lead   (arena layers by intensity)
//                                           chase, alarm                   (corridor layers)
//   warden "The Warden"           148 BPM   intro, organ, drums, bass, bell, arp, choir, lead

import { audio } from './engine.js';
import { renderLayers } from './synth.js';

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---- chords ---------------------------------------------------------------------------------------
// root: bass register (octave 3); tones: a voicing around octave 4
const CH = {
  Dm: { root: 50, tones: [62, 65, 69] },
  Bb: { root: 46, tones: [58, 62, 65] },
  C: { root: 48, tones: [60, 64, 67] },
  Gm: { root: 43, tones: [58, 62, 67] },
  A: { root: 45, tones: [57, 61, 64] },
  F: { root: 41, tones: [60, 65, 69] },
  Eb: { root: 51, tones: [58, 63, 67] },
};

// ---- instruments ----------------------------------------------------------------------------------
let WAVES = null;
let DRUMS = null;

function pulse(c, duty, N = 48) {
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    re[n] = Math.sin(2 * Math.PI * n * duty) / (Math.PI * n);
    im[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (Math.PI * n);
  }
  return c.createPeriodicWave(re, im);
}
function harmonics(c, list) {
  const N = Math.max(...list.map((h) => h[0])) + 1;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (const [n, a] of list) im[n] = a;
  return c.createPeriodicWave(re, im);
}

function buildInstruments(c) {
  WAVES = {
    p12: pulse(c, 0.125), p25: pulse(c, 0.25), p50: pulse(c, 0.5),
    organ: harmonics(c, [[1, 1], [2, 0.55], [3, 0.3], [4, 0.28], [6, 0.12], [8, 0.1], [10, 0.04]]),
  };
  const mk = (layers) => { const d = renderLayers(layers, 44100); const b = c.createBuffer(1, d.length, 44100); b.copyToChannel(d, 0); return b; };
  DRUMS = {
    kick: mk([{ wave: 'sine', f: 155, slide: -5.5, d: 0.24, gain: 0.95, drive: 0.35, seed: 1 }, { wave: 'noise', f: 5000, d: 0.006, gain: 0.25, seed: 2 }]),
    snare: mk([{ wave: 'white', d: 0.15, gain: 0.5, lpf: 7000, hpf: 1000, curve: 1.4, seed: 3 }, { wave: 'tri', f: 200, slide: -2, d: 0.07, gain: 0.35, seed: 4 }]),
    hat: mk([{ wave: 'white', d: 0.03, gain: 0.3, hpf: 7000, seed: 5 }]),
    ohat: mk([{ wave: 'white', d: 0.2, gain: 0.2, hpf: 6500, curve: 1.6, seed: 6 }]),
    tom: mk([{ wave: 'sine', f: 130, slide: -1.6, d: 0.28, gain: 0.8, drive: 0.25, seed: 7 }, { wave: 'noise', f: 2000, d: 0.02, gain: 0.12, seed: 8 }]),
    crash: mk([{ wave: 'white', d: 1.3, gain: 0.22, hpf: 3500, lpf: 11000, curve: 2.2, seed: 9 }, { wave: 'noise', f: 7000, d: 0.9, gain: 0.08, hpf: 3000, curve: 2, seed: 10 }]),
    tick: mk([{ wave: 'noise', f: 6000, d: 0.012, gain: 0.25, hpf: 2500, seed: 11 }]),
  };
}

/** A gain envelope: 0 -> vel (a) -> vel*sus (by a+d) -> hold -> 0 (r). Click-free. */
function envelope(g, t, dur, vel, a, d, sus, r) {
  const p = g.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(vel, t + a);
  const de = Math.min(a + d, Math.max(a, dur));
  const k = d > 0 ? Math.min(1, (de - a) / d) : 1;
  const lv = vel + (vel * sus - vel) * k;
  p.linearRampToValueAtTime(lv, t + de);
  if (dur > de) p.setValueAtTime(lv, t + dur);
  p.linearRampToValueAtTime(0, t + dur + r);
  return t + dur + r + 0.03;
}

const INST = {
  // chip pulses: bright lead / arps / bass
  pulse(c, out, f, t, dur, vel, o = {}) {
    const osc = c.createOscillator();
    osc.setPeriodicWave(WAVES[o.duty ?? 'p25']);
    osc.frequency.setValueAtTime(f, t);
    if (o.glideFrom) { osc.frequency.setValueAtTime(o.glideFrom, t); osc.frequency.exponentialRampToValueAtTime(f, t + 0.05); }
    const g = c.createGain();
    const end = envelope(g, t, dur, vel, o.a ?? 0.004, o.d ?? 0.08, o.sus ?? 0.7, o.r ?? 0.05);
    if (o.vib) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = o.vibHz ?? 5.5;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(0, t + (o.vibDelay ?? 0.15));
      lg.gain.linearRampToValueAtTime(f * o.vib, t + (o.vibDelay ?? 0.15) + 0.2);
      l.connect(lg).connect(osc.frequency);
      l.start(t); l.stop(end);
    }
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(end);
  },
  tri(c, out, f, t, dur, vel, o = {}) {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = c.createGain();
    const end = envelope(g, t, dur, vel, o.a ?? 0.004, o.d ?? 0.1, o.sus ?? 0.8, o.r ?? 0.06);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(end);
  },
  sub(c, out, f, t, dur, vel, o = {}) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = c.createGain();
    const end = envelope(g, t, dur, vel, o.a ?? 0.15, 0.1, 1, o.r ?? 0.4);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(end);
  },
  // two detuned saws through a soft lowpass: the crypt's air
  pad(c, out, f, t, dur, vel, o = {}) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(o.cut ?? 1300, t);
    const g = c.createGain();
    const end = envelope(g, t, dur, vel, o.a ?? 0.35, 0.3, 0.85, o.r ?? 0.8);
    for (const det of [-8, 8]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = det;
      osc.connect(lp);
      osc.start(t); osc.stop(end);
    }
    lp.connect(g).connect(out);
  },
  organ(c, out, f, t, dur, vel, o = {}) {
    const g = c.createGain();
    const end = envelope(g, t, dur, vel, o.a ?? 0.05, 0.2, 0.85, o.r ?? 0.25);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.cut ?? 2400;
    for (const det of [-5, 5]) {
      const osc = c.createOscillator();
      osc.setPeriodicWave(WAVES.organ); osc.frequency.value = f; osc.detune.value = det;
      osc.connect(lp);
      osc.start(t); osc.stop(end);
    }
    lp.connect(g).connect(out);
  },
  // two formant bands over detuned saws: a low, wordless choir
  choir(c, out, f, t, dur, vel, o = {}) {
    const g = c.createGain();
    const end = envelope(g, t, dur, vel, o.a ?? 0.45, 0.3, 0.9, o.r ?? 0.9);
    const mix = c.createGain();
    for (const det of [-11, 0, 11]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = det;
      osc.connect(mix);
      osc.start(t); osc.stop(end);
    }
    for (const [ff, q, gg] of [[650, 4, 1], [1080, 5, 0.6], [2500, 6, 0.2]]) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
      const bg = c.createGain(); bg.gain.value = gg;
      mix.connect(bp).connect(bg).connect(g);
    }
    g.connect(out);
  },
  // FM bell: a toll for the Warden, a chime for the title
  bell(c, out, f, t, dur, vel, o = {}) {
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.type = 'sine'; mod.type = 'sine';
    car.frequency.value = f; mod.frequency.value = f * (o.ratio ?? 3.5);
    const idx = o.index ?? 2.5;
    mg.gain.setValueAtTime(f * idx, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f * idx * 0.05), t + dur);
    mod.connect(mg).connect(car.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(vel * 0.002, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    car.connect(g).connect(out);
    car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  },
  // a palm-muted saw with a fast filter snap: the chase's engine
  chug(c, out, f, t, dur, vel, o = {}) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(o.open ?? 2400, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.09);
    const g = c.createGain();
    const end = envelope(g, t, dur, vel, 0.003, 0.06, 0.45, 0.04);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t); osc.stop(end);
  },
};

function drum(c, out, name, t, vel, rate = 1) {
  const s = c.createBufferSource();
  s.buffer = DRUMS[name];
  s.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = vel * (0.9 + Math.random() * 0.2);   // a drummer never hits the same twice
  s.connect(g).connect(out);
  s.start(t);
}

// ---- songs ----------------------------------------------------------------------------------------
// play(stem, bar, step, t, S): schedule what `stem` plays at 16th `step` of `bar` (time t).
// S: { n(inst, midi, steps, vel, opts), d(drum, vel, rate), loop, intensity, sec (one step) }

const CRYPT_CHORDS = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'];
const CRYPT_LEAD = [
  [[0, 74, 6], [6, 77, 2], [8, 76, 4], [12, 74, 4]],
  [[0, 69, 8], [8, 72, 4], [12, 74, 4]],
  [[0, 77, 6], [6, 76, 2], [8, 74, 4], [12, 70, 4]],
  [[0, 72, 6], [6, 74, 2], [8, 76, 8]],
  [[0, 74, 6], [6, 77, 2], [8, 81, 4], [12, 79, 4]],
  [[0, 77, 6], [6, 76, 2], [8, 74, 8]],
  [[0, 82, 4], [4, 81, 4], [8, 79, 4], [12, 77, 4]],
  [[0, 76, 4], [4, 73, 4], [8, 69, 8]],
];
const ARP_SEQ = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1];
const tone = (ch, i) => { const T = CH[ch].tones; return T[i % 3] + 12 * Math.floor(i / 3); };

const TITLE_CHORDS = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'];
const TITLE_LEAD = [
  [[0, 69, 6], [6, 65, 2], [8, 74, 8]],
  [[0, 72, 4], [4, 74, 4], [8, 77, 8]],
  [[0, 76, 8], [8, 72, 8]],
  [[0, 74, 4], [4, 76, 4], [8, 67, 8]],
  [[0, 69, 6], [6, 74, 2], [8, 77, 8]],
  [[0, 79, 6], [6, 77, 2], [8, 74, 8]],
  [[0, 70, 4], [4, 74, 4], [8, 79, 8]],
  [[0, 76, 8], [8, 73, 8]],
];

const WARDEN_CHORDS = ['Dm', 'Eb', 'Dm', 'C', 'Dm', 'Eb', 'Bb', 'A'];
const WARDEN_LEAD = [
  [[0, 74, 4], [4, 75, 4], [8, 74, 4], [12, 72, 4]],
  [[0, 70, 8], [8, 67, 8]],
  [[0, 69, 4], [4, 70, 4], [8, 69, 4], [12, 65, 4]],
  [[0, 67, 8], [8, 64, 8]],
  [[0, 74, 2], [2, 74, 2], [4, 77, 4], [8, 75, 4], [12, 74, 4]],
  [[0, 79, 8], [8, 77, 4], [12, 75, 4]],
  [[0, 74, 8], [8, 77, 8]],
  [[0, 76, 4], [4, 73, 4], [8, 69, 8]],
];

function melody(table, bar, step, S, inst, vel, o) {
  for (const [st, m, len] of table[bar]) if (st === step) S.n(inst, m, len - 0.3, vel, o);
}

export const SONGS = {
  title: {
    title: 'BENEATH THE MOUNTAIN', bpm: 76, bars: 8,
    stems: {
      bed: { gain: 0.75, send: 0.5 },
      bass: { gain: 0.55 },
      arp: { gain: 7, pan: 0.3, echo: 0.5 },
      lead: { gain: 2.4, pan: -0.2, echo: 0.4, send: 0.5 },
    },
    play(stem, bar, step, S) {
      const ch = TITLE_CHORDS[bar];
      if (stem === 'bed' && step === 0) {
        for (const m of CH[ch].tones) S.n('pad', m, 16, 0.07, { cut: 1100 });
        S.n('sub', CH[ch].root - 12, 16, 0.04);
      }
      if (stem === 'bass' && (step === 0 || step === 8)) S.n('tri', CH[ch].root, 7.5, 0.34, { sus: 0.6, d: 0.5 });
      if (stem === 'arp' && step % 2 === 0) {
        const i = [0, 1, 2, 3, 4, 3, 2, 1][step / 2];
        S.n('pulse', tone(ch, i) + 12, 1.2, 0.07 * (step === 0 ? 1.2 : 1), { duty: 'p12', d: 0.15, sus: 0.3 });
      }
      if (stem === 'lead' && S.loop % 2 === 1) melody(TITLE_LEAD, bar, step, S, 'bell', 0.16, { ratio: 2, index: 1.2 });
      if (stem === 'lead' && S.loop % 2 === 0 && step === 0 && (bar === 0 || bar === 4)) S.n('bell', 74 + (bar ? 7 : 0), 14, 0.07, { ratio: 3.5, index: 2 });
    },
  },

  crypt: {
    title: 'THE GAUNTLET', bpm: 132, bars: 8,
    stems: {
      bed: { gain: 0.5, send: 0.4 },
      drums: { gain: 0.75 },
      bass: { gain: 1.5 },
      arp: { gain: 6.3, pan: 0.25, echo: 0.35 },
      lead: { gain: 1.4, pan: -0.15, echo: 0.3 },
      chase: { gain: 1.2 },
      alarm: { gain: 1.6, pan: 0.1, echo: 0.25 },
    },
    play(stem, bar, step, S) {
      const ch = CRYPT_CHORDS[bar];
      const R = CH[ch].root;
      switch (stem) {
        case 'bed':
          if (step === 0) { for (const m of CH[ch].tones) S.n('pad', m, 16, 0.06); S.n('sub', R - 12, 16, 0.04); }
          break;
        case 'drums': {
          const hot = S.intensity > 0.7;
          if (step === 0 || step === 6 || step === 8 || (hot && (step === 11 || step === 14))) S.d('kick', step === 0 ? 0.75 : 0.6);
          if (step === 4 || step === 12) S.d('snare', 0.6);
          if (bar === 7 && step >= 13) S.d('snare', 0.25 + (step - 13) * 0.1);
          if (step % 2 === 0) S.d('hat', step % 4 === 2 ? 0.75 : 0.45);
          else if (hot || S.chase) S.d('hat', 0.28);
          if (step === 14 && bar % 2 === 1) S.d('ohat', 0.35);
          if (step === 0 && bar === 0 && S.loop > 0 && S.intensity > 0.55) S.d('crash', 0.45);
          break;
        }
        case 'bass':
          if (step % 2 === 0) {
            const off = [0, 0, 12, 0, 0, 12, 0, 7][step / 2];
            S.n('pulse', R + off - 12, 1.6, step === 0 ? 0.2 : 0.15, { duty: 'p12', d: 0.12, sus: 0.6 });
          }
          break;
        case 'arp':
          S.n('pulse', tone(ch, ARP_SEQ[step]) + 12, 0.85, step % 4 === 0 ? 0.065 : 0.05, { duty: 'p12', d: 0.06, sus: 0.5 });
          break;
        case 'lead':
          melody(CRYPT_LEAD, bar, step, S, 'pulse', 0.085, { duty: 'p50', vib: 0.012, vibHz: 5.5, vibDelay: 0.18, d: 0.2, sus: 0.75 });
          break;
        case 'chase': {
          const acc = [0, 3, 6, 8, 11, 14].includes(step);
          S.n('chug', R - 12, 0.8, acc ? 0.16 : 0.09, { open: acc ? 2800 : 1500 });
          if ((bar === 3 || bar === 7) && step >= 12) S.d('tom', 0.55, [1.25, 1.1, 0.95, 0.8][step - 12]);
          break;
        }
        case 'alarm':
          if (step === 0 || step === 8) {
            const m = step === 0 ? 81 : 82;
            S.n('pulse', m, 7.5, 0.06, { duty: 'p25', vib: 0.02, vibHz: 9, vibDelay: 0.02, d: 0.3, sus: 0.8 });
            if (S.levelOf('alarm') > 0.7) S.n('pulse', m + 12, 7.5, 0.025, { duty: 'p12', vib: 0.02, vibHz: 9, vibDelay: 0.02 });
          }
          break;
        default:
      }
    },
  },

  warden: {
    title: 'THE WARDEN', bpm: 148, bars: 8,
    stems: {
      intro: { gain: 1, send: 0.6 },
      organ: { gain: 1.2, send: 0.4 },
      drums: { gain: 0.8 },
      bass: { gain: 1.8 },
      bell: { gain: 4.5, send: 0.6 },
      arp: { gain: 7, pan: -0.25, echo: 0.3 },
      choir: { gain: 2.5, send: 0.5 },
      lead: { gain: 2, pan: 0.15, echo: 0.3 },
    },
    play(stem, bar, step, S) {
      const ch = WARDEN_CHORDS[bar];
      const R = CH[ch].root;
      switch (stem) {
        case 'intro':
          if (step === 0) { S.n('organ', 38, 16, 0.08, { cut: 900, a: 0.4 }); S.n('organ', 45, 16, 0.05, { cut: 900, a: 0.4 }); }
          if (step === 0 && bar % 4 === 0) S.n('bell', 50, 30, 0.2, { ratio: 3.5, index: 3 });
          if (step === 0 && bar % 2 === 1) S.d('tom', 0.35, 0.55);
          break;
        case 'organ':
          if (step === 0) for (const m of CH[ch].tones) S.n('organ', m, 15.6, 0.04);
          break;
        case 'drums': {
          const p3 = S.intensity > 0.8;
          if ([0, 3, 8, 10].includes(step) || (p3 && step % 2 === 0)) S.d('kick', step % 8 === 0 ? 0.75 : 0.58);
          if (step === 4 || step === 12) S.d('snare', 0.65);
          if (step % 2 === 0) S.d('hat', step % 4 === 2 ? 0.7 : 0.42);
          if (bar === 7 && step >= 8) S.d('tom', 0.5, [1.3, 1.3, 1.15, 1.15, 1, 1, 0.85, 0.85][step - 8]);
          if (step === 0 && bar === 0) S.d('crash', 0.4);
          break;
        }
        case 'bass':
          if (step % 4 !== 1) S.n('pulse', R - 12, 0.8, step % 4 === 0 ? 0.2 : 0.13, { duty: 'p25', d: 0.05, sus: 0.5 });
          break;
        case 'bell':
          if (step === 0) S.n('bell', R + 12, 6, 0.09, { ratio: 3.5, index: 2.5 });
          if (step === 8 && bar % 2 === 1) S.n('bell', R + 19, 4, 0.05, { ratio: 3.5, index: 2 });
          break;
        case 'arp':
          S.n('pulse', tone(ch, [0, 2, 1, 3, 2, 4, 3, 1][step % 8]) + 12, 0.8, 0.05, { duty: 'p12', d: 0.05, sus: 0.5 });
          break;
        case 'choir':
          if (step === 0) for (const m of CH[ch].tones) S.n('choir', m - 12, 16, 0.05);
          break;
        case 'lead':
          melody(WARDEN_LEAD, bar, step, S, 'pulse', 0.085, { duty: 'p25', vib: 0.015, vibHz: 6, vibDelay: 0.12, d: 0.15, sus: 0.75 });
          break;
        default:
      }
    },
  },
};

// ---- the player -----------------------------------------------------------------------------------
class SongPlayer {
  constructor(c, name, startAt) {
    const def = SONGS[name];
    this.c = c; this.name = name; this.def = def;
    this.sec = 60 / def.bpm / 4;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.connect(audio.bus('music'));
    // tempo-synced echo: a dotted eighth, darkened each repeat
    this.echo = c.createDelay(2);
    this.echo.delayTime.value = this.sec * 3;
    const fb = c.createGain(); fb.gain.value = 0.32;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const ret = c.createGain(); ret.gain.value = 0.6;
    this.echo.connect(lp).connect(fb).connect(this.echo);
    lp.connect(ret).connect(this.out);
    this.stems = {};
    for (const [sn, cfg] of Object.entries(def.stems)) {
      const on = c.createGain(); on.gain.value = 0;
      const lvl = c.createGain(); lvl.gain.value = 1;
      const pan = c.createStereoPanner(); pan.pan.value = cfg.pan ?? 0;
      const trim = c.createGain(); trim.gain.value = cfg.gain ?? 0.5;
      on.connect(lvl).connect(trim).connect(pan).connect(this.out);
      if (cfg.echo) { const s = c.createGain(); s.gain.value = cfg.echo; pan.connect(s).connect(this.echo); }
      const an = c.createAnalyser(); an.fftSize = 512;   // for the sound board's stem meters
      trim.connect(an);
      this.stems[sn] = { on, lvl, an, isOn: false, want: false, level: 1, tailUntil: 0 };
    }
    this.t = startAt; this.step = 0; this.bar = 0; this.loop = 0;
    this.stopAt = Infinity;
  }
  /** Schedule everything up to time `until`. */
  schedule(until, state) {
    const S = this.S ??= {
      n: (inst, midi, steps, vel, o) => INST[inst](this.c, this.dest, hz(midi), this.t, steps * this.sec, vel, o),
      d: (name, vel, rate) => drum(this.c, this.dest, name, this.t, vel, rate),
      levelOf: (sn) => this.stems[sn]?.level ?? 0,
    };
    if (!this.begun) {
      // anchor the first beat to the first scheduling pass, not to creation: unlocking does a
      // burst of setup work, and a song must never open by skipping its downbeat
      this.begun = true;
      this.t = Math.max(this.t, this.c.currentTime + 0.04);
    }
    while (this.t < until && this.t < this.stopAt) {
      if (this.step % 8 === 0) this.apply(this.t);
      S.loop = this.loop; S.intensity = state.intensity; S.chase = state.chase; S.sec = this.sec;
      // a stalled main thread can leave us behind the clock: skip what is already late rather
      // than firing a burst of notes at once (keeps the groove; the loop position stays true)
      const late = this.t < this.c.currentTime - 0.02;
      if (!late) {
        for (const [sn, st] of Object.entries(this.stems)) {
          if (!st.isOn) continue;           // released stems only ring out, they get no new notes
          this.dest = st.on;
          this.def.play(sn, this.bar, this.step, S);
        }
      } else this.skipped = (this.skipped ?? 0) + 1;
      this.t += this.sec;
      if (++this.step >= 16) { this.step = 0; if (++this.bar >= this.def.bars) { this.bar = 0; this.loop++; } }
    }
  }
  /** Bring stems in or out at a half-bar boundary. */
  apply(t) {
    for (const st of Object.values(this.stems)) {
      if (st.want === st.isOn) continue;
      st.isOn = st.want;
      if (st.isOn) st.on.gain.setTargetAtTime(1, t, 0.03);
      else { st.on.gain.setTargetAtTime(0, t, 0.5); st.tailUntil = t + 3; }
    }
  }
  setLevel(sn, v) {
    const st = this.stems[sn];
    if (!st || Math.abs(st.level - v) < 0.01) return;
    st.level = v;
    st.lvl.gain.setTargetAtTime(v, this.c.currentTime, 0.2);
  }
  fadeIn(t, tau) { this.out.gain.setValueAtTime(0, t); this.out.gain.setTargetAtTime(1, t, tau); }
  fadeOut(fade) {
    const t = this.c.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.setTargetAtTime(0, t, fade / 4);
    this.stopAt = t + fade;
    this.killAt = t + fade + 2;
  }
  dispose() { try { this.out.disconnect(); } catch { /* ok */ } }
}

// ---- the public music object --------------------------------------------------------------------------
const LOOKAHEAD = 0.6;   // seconds of notes committed ahead: survives 500 ms main-thread stalls (headless GL)
let players = [];          // current one last
let timer = null;
const state = { intensity: 0, chase: false };
let wantedSong = null, wantedStems = {}, wantedLevels = {};
let filterMode = 'normal';

const FILTERS = { normal: [20000, 0.7], lowhp: [950, 1.6], pause: [520, 0.9], dead: [260, 0.7] };

function tick() {
  const c = audio.ctx;
  if (!c) return;
  const until = c.currentTime + LOOKAHEAD;
  for (const p of players) p.schedule(until, state);
  const now = c.currentTime;
  players = players.filter((p) => { if (p.killAt && now > p.killAt) { p.dispose(); return false; } return true; });
}

function current() { const p = players[players.length - 1]; return p && !p.killAt ? p : null; }

function start(c) {
  if (!WAVES) buildInstruments(c);
  if (!timer) timer = setInterval(tick, 25);
  if (wantedSong && !current()) music.play(wantedSong, { fade: 1.5 });
}
audio.onUnlock(start);

export const music = {
  get song() { return current()?.name ?? null; },
  get intensity() { return state.intensity; },
  set intensity(v) { state.intensity = Math.max(0, Math.min(1, v)); },
  get chase() { return state.chase; },
  set chase(v) { state.chase = !!v; },
  /** Switch songs with a crossfade. null fades to silence. */
  play(name, { fade = 1.2 } = {}) {
    wantedSong = name;
    const c = audio.ctx;
    if (!c || !WAVES) return;
    const cur = current();
    if (cur && cur.name === name) return;
    if (cur) cur.fadeOut(fade);
    if (!name || !SONGS[name]) return;
    const p = new SongPlayer(c, name, c.currentTime + 0.08);
    for (const [sn, on] of Object.entries(wantedStems)) if (p.stems[sn]) p.stems[sn].want = !!on;
    for (const [sn, v] of Object.entries(wantedLevels)) if (p.stems[sn]) { p.stems[sn].level = v; p.stems[sn].lvl.gain.value = v; }
    p.fadeIn(c.currentTime + 0.05, cur ? fade / 5 : 0.08);
    players.push(p);
    tick();
  },
  stop(fade = 1.2) { music.play(null, { fade }); },
  /** Which stems should be playing. Stems not named keep their state. */
  want(map) {
    Object.assign(wantedStems, map);
    const p = current();
    if (p) for (const [sn, on] of Object.entries(map)) if (p.stems[sn]) p.stems[sn].want = !!on;
  },
  /** Exactly these stems (all others off). */
  only(list) {
    const p = current();
    const names = p ? Object.keys(p.stems) : Object.keys(wantedStems);
    const map = {};
    for (const sn of new Set([...names, ...list])) map[sn] = list.includes(sn);
    wantedStems = {};
    music.want(map);
  },
  level(sn, v) {
    wantedLevels[sn] = v;
    current()?.setLevel(sn, v);
  },
  filter(mode) {
    if (mode === filterMode || !FILTERS[mode]) return;
    filterMode = mode;
    const G = audio.graph;
    if (!G) return;
    const [f, q] = FILTERS[mode];
    const t = audio.ctx.currentTime;
    G.musicFilter.frequency.cancelScheduledValues(t);
    G.musicFilter.frequency.setTargetAtTime(f, t, mode === 'normal' ? 0.35 : 0.25);
    G.musicFilter.Q.setTargetAtTime(q, t, 0.2);
  },
  get filterMode() { return filterMode; },
  info() {
    const p = current();
    return {
      song: p?.name ?? null, wanted: wantedSong, bpm: p?.def.bpm ?? null, bar: p?.bar ?? null, loop: p?.loop ?? null,
      intensity: +state.intensity.toFixed(2), chase: state.chase, filter: filterMode,
      stems: p ? Object.fromEntries(Object.entries(p.stems).map(([k, s]) => [k, s.isOn ? +s.level.toFixed(2) : 0])) : {},
      players: players.length, skipped: p?.skipped ?? 0,
    };
  },
  /** Live RMS of each stem of the current song (0..1), for meters. */
  meters() {
    const p = current();
    if (!p) return {};
    const buf = music._buf ??= new Float32Array(512);
    const out = {};
    for (const [sn, st] of Object.entries(p.stems)) {
      st.an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      out[sn] = Math.sqrt(sum / buf.length);
    }
    return out;
  },
  /** Stem names of a song. */
  stemsOf: (name) => Object.keys(SONGS[name]?.stems ?? {}),
};
// re-apply the filter once the graph exists
audio.onUnlock(() => { const m = filterMode; filterMode = 'normal'; if (m !== 'normal') music.filter(m); });
