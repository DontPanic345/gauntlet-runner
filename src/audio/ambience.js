// Ambience (piece `audio`): the crypt is never silent. A wind bed (looped noise through a slowly
// wandering bandpass), torch crackles and water drips scattered in time and stereo, and the
// collapse's debris patter in corridors. Levels per place; everything goes to the `amb` bus,
// which ducks with the music and has the deepest reverb send.
//
//   import { ambience } from './audio/ambience.js';
//   ambience.set({ wind: 0..1, crackle: per second, drip: per second, debris: 0..1, debrisPan: -1..1 })
//   ambience.update(dt)   // called by the director ~20x a second

import { audio } from './engine.js';
import { sfx } from './bank.js';

let W = null;   // wind nodes
const want = { wind: 0, crackle: 0, drip: 0, debris: 0, debrisPan: -0.5 };
const timers = { crackle: 1, drip: 3, debris: 0.2 };

function build(c) {
  const n = c.sampleRate * 3;
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  let s = 5;
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; const w = (s / 2147483647) * 2 - 1; d[i] = w * 0.6; }
  // seamless loop over [0, n - f): the first 50 ms are blended with the 50 ms that would follow
  // the loop end, so the jump back to 0 continues the waveform (no click on the seam)
  const f = Math.floor(c.sampleRate * 0.05);
  for (let i = 0; i < f; i++) { const k = (i / f) * Math.PI / 2; d[i] = d[i] * Math.sin(k) + d[n - f + i] * Math.cos(k); }
  const src = c.createBufferSource();
  src.buffer = buf; src.loop = true; src.loopStart = 0; src.loopEnd = (n - f) / c.sampleRate;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 360; bp.Q.value = 0.8;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 170; hp.Q.value = 0.6;
  const g = c.createGain(); g.gain.value = 0;
  const lfo = c.createOscillator(); lfo.frequency.value = 0.06;
  const lg = c.createGain(); lg.gain.value = 140;
  lfo.connect(lg).connect(bp.frequency);
  const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.11;
  const lg2 = c.createGain(); lg2.gain.value = 0.3;
  const sway = c.createGain(); sway.gain.value = 1;     // slow gusts: 0.7 .. 1.3
  lfo2.connect(lg2).connect(sway.gain);
  src.connect(hp).connect(bp).connect(lp).connect(g).connect(sway).connect(audio.bus('amb'));
  src.start(); lfo.start(); lfo2.start();
  W = { g, sway };
  apply();
}
audio.onUnlock(build);

function apply() {
  if (!W) return;
  W.g.gain.setTargetAtTime(want.wind * 0.07, audio.ctx.currentTime, 0.8);
}

const rand = (a, b) => a + Math.random() * (b - a);
/** Next gap for a Poisson-ish process at `rate` per second (never perfectly regular). */
const nextGap = (rate) => (rate > 0 ? -Math.log(1 - Math.random() * 0.95) / rate : 1);

export const ambience = {
  set(o) {
    const windWas = want.wind;
    Object.assign(want, o);
    if (want.wind !== windWas) apply();
  },
  update(dt) {
    if (!audio.ctx) return;
    for (const k of ['crackle', 'drip', 'debris']) {
      const rate = k === 'debris' ? want.debris * 14 : want[k];
      if (rate <= 0) { timers[k] = Math.min(timers[k], 1); continue; }
      timers[k] -= dt;
      if (timers[k] > 0) continue;
      timers[k] = nextGap(rate);
      if (k === 'crackle') sfx.play('crackle', { pan: rand(-0.6, 0.6), gain: rand(0.4, 1) });
      else if (k === 'drip') sfx.play('drip', { pan: rand(-0.7, 0.7), gain: rand(0.5, 1), rate: rand(0.8, 1.25) });
      else sfx.play('debris', { pan: Math.max(-0.9, Math.min(0.9, want.debrisPan + rand(-0.25, 0.25))), gain: 0.25 + want.debris * 0.75 });
    }
  },
  info: () => ({ ...want }),
};
