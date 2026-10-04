// Run-flow sounds (piece `run-flow`), authored in the audio piece's layer format and added to
// its bank at import (the same way the title piece adds its UI sounds; bank.js is not edited).
//
//   import { runSound } from './run/sfx.js';   runSound('run.slab', { rate, gain })

import { SFX, sfx } from '../audio/bank.js';

const thump = (f, d, gain = 0.8, more = {}) => ({ wave: 'sine', f, slide: -4.5, d, gain, drive: 0.3, ...more });
const hiss = (lpf, d, gain = 0.4, more = {}) => ({ wave: 'white', lpf, d, gain, ...more });

const RUN_SFX = {
  // a stone block lands in the transition wall
  'run.block': { group: 'RUN', label: 'transition: block lands', pitch: 0.12, vol: 0.25, max: 5, gap: 0.025, variants: 6, layers: [
    thump(120, 0.09, 0.55), { wave: 'noise', f: 1800, d: 0.04, gain: 0.18, lpf: 3000, hpf: 400 },
    hiss(900, 0.08, 0.15, { hpf: 200 }),
  ] },
  // the wall closes: a low rumble under the blocks
  'run.close': { group: 'RUN', label: 'transition: wall closes', pitch: 0.04, vol: 0.1, duck: [4, 0.2, 0.5], layers: [
    { wave: 'sine', f: 58, slide: -0.5, a: 0.03, d: 0.5, gain: 0.55, drive: 0.4 },
    hiss(700, 0.45, 0.32, { a: 0.05, lpfSweep: -1.5, curve: 1.3 }),
    { wave: 'noise', f: 1300, delay: 0.05, s: 0.15, d: 0.2, gain: 0.07, repeat: 0.06, hpf: 500 },
  ] },
  // the wall drops away into the dark
  'run.open': { group: 'RUN', label: 'transition: wall falls away', pitch: 0.04, vol: 0.1, layers: [
    hiss(1600, 0.5, 0.35, { a: 0.02, lpfSweep: -3, hpf: 120 }),
    { wave: 'sine', f: 90, slide: -1.6, d: 0.45, gain: 0.35 },
    { wave: 'noise', f: 900, delay: 0.12, d: 0.25, gain: 0.06, repeat: 0.08, hpf: 400 },
  ] },
  // death: the screen cracks
  'run.crack': { group: 'RUN', label: 'death: the screen cracks', pitch: 0.06, vol: 0.12, max: 3, gap: 0.05, variants: 5, layers: [
    { wave: 'noise', f: 5200, d: 0.06, gain: 0.3, hpf: 1500 },
    { wave: 'noise', f: 2600, delay: 0.03, d: 0.09, gain: 0.18, hpf: 800 },
    { wave: 'square', f: 1900, slide: -5, duty: 0.2, d: 0.05, gain: 0.04 },
    thump(80, 0.16, 0.35),
  ] },
  // death: the screen collapses
  'run.crumble': { group: 'RUN', label: 'death: the screen collapses', pitch: 0.03, vol: 0.06, duck: [6, 0.4, 1.4], layers: [
    { wave: 'sine', f: 48, slide: -0.6, a: 0.02, s: 0.3, d: 1.5, gain: 0.75, drive: 0.6 },
    hiss(1400, 1.6, 0.5, { a: 0.02, lpfSweep: -1.6, curve: 1.2 }),
    { wave: 'noise', f: 1600, delay: 0.08, s: 0.7, d: 0.5, gain: 0.1, repeat: 0.05, hpf: 500 },
    { wave: 'noise', f: 600, delay: 0.3, s: 0.5, d: 0.6, gain: 0.08, repeat: 0.09, lpf: 1600 },
  ] },
  // the summary slab lands
  'run.slab': { group: 'RUN', label: 'summary: slab lands', pitch: 0.03, vol: 0.08, layers: [
    thump(70, 0.35, 0.95, { drive: 0.6 }), hiss(500, 0.3, 0.4, { curve: 1.6 }),
    { wave: 'noise', f: 2200, d: 0.05, gain: 0.15, hpf: 900 },
    { wave: 'tri', f: 73.42, delay: 0.02, d: 0.6, gain: 0.18 },
  ] },
  // a stat counts up (rate climbs the D minor pentatonic)
  'run.tally': { group: 'RUN', label: 'summary: stat tick', bus: 'ui', pitch: 0.004, vol: 0.06, gap: 0.03, max: 3, layers: [
    { wave: 'square', f: 1174.66, duty: 0.25, d: 0.03, gain: 0.06, lpf: 4500 },
    { wave: 'tri', f: 587.33, d: 0.05, gain: 0.14 },
  ] },
  // a stat row settles
  'run.row': { group: 'RUN', label: 'summary: row lands', bus: 'ui', pitch: 0.01, vol: 0.06, gap: 0.04, layers: [
    thump(160, 0.07, 0.4), { wave: 'tri', f: 293.66, d: 0.12, gain: 0.16 }, { wave: 'noise', f: 4000, d: 0.015, gain: 0.06, hpf: 2000 },
  ] },
  // NEW BEST stamp
  'run.stamp': { group: 'RUN', label: 'summary: new best stamp', bus: 'ui', pitch: 0.004, vol: 0.05, duck: [6, 0.3, 0.8], layers: [
    thump(110, 0.18, 0.8, { drive: 0.5 }),
    { wave: 'square', f: 587.33, duty: 0.25, delay: 0.04, d: 0.18, gain: 0.08 },
    { wave: 'square', f: 880, duty: 0.25, delay: 0.1, d: 0.2, gain: 0.08 },
    { wave: 'tri', f: 1174.66, delay: 0.16, s: 0.15, d: 0.5, gain: 0.14, vib: 0.006, vibHz: 6, vibDelay: 0.2 },
  ] },
  // a lore line is unlocked
  'run.lore': { group: 'RUN', label: 'summary: lore unlocked', bus: 'ui', pitch: 0.003, vol: 0.04, layers: [
    { wave: 'tri', f: 440, a: 0.02, d: 0.6, gain: 0.14 },
    { wave: 'tri', f: 659.25, delay: 0.12, a: 0.02, d: 0.7, gain: 0.12, vib: 0.005, vibHz: 5 },
    { wave: 'sine', f: 880, delay: 0.24, a: 0.03, d: 0.9, gain: 0.1 },
    hiss(9000, 0.4, 0.04, { hpf: 4000, delay: 0.1, a: 0.1 }),
  ] },
  // the type-on of a lore letter
  'run.type': { group: 'RUN', label: 'summary: lore letter', bus: 'ui', pitch: 0.08, vol: 0.2, gap: 0.03, max: 2, variants: 6, layers: [
    { wave: 'noise', f: 3000, d: 0.012, gain: 0.07, hpf: 1500 },
    { wave: 'tri', f: 1320, d: 0.02, gain: 0.03 },
  ] },
  // restart: the runner drops back in
  'run.rise': { group: 'RUN', label: 'restart: drop back in', bus: 'ui', pitch: 0.01, vol: 0.06, layers: [
    hiss(2400, 0.28, 0.35, { a: 0.01, lpfSweep: 3, hpf: 300 }),
    { wave: 'tri', f: 293.66, slide: 1.2, d: 0.22, gain: 0.16 },
    { wave: 'square', f: 587.33, duty: 0.2, delay: 0.06, d: 0.14, gain: 0.05 },
  ] },
  // the drop-in lands at the start of a run
  'run.impact': { group: 'RUN', label: 'run start: hero lands', pitch: 0.04, vol: 0.08, duck: [4, 0.15, 0.4], layers: [
    thump(90, 0.3, 0.95, { drive: 0.5 }), hiss(1100, 0.3, 0.45, { lpfSweep: -4, curve: 1.5 }),
    { wave: 'noise', f: 1500, delay: 0.05, d: 0.25, gain: 0.08, repeat: 0.07, hpf: 600 },
  ] },
  // victory: dawn swell (D major, over the picardy third)
  'run.dawn': { group: 'RUN', label: 'victory: dawn', bus: 'ui', pitch: 0.002, vol: 0.03, duck: [8, 1.2, 2], layers: [
    { wave: 'tri', f: 73.42, a: 0.4, s: 1.2, d: 1.6, gain: 0.3 },
    { wave: 'tri', f: 293.66, a: 0.5, s: 1.0, d: 1.4, gain: 0.12 },
    { wave: 'tri', f: 369.99, a: 0.6, delay: 0.2, s: 0.9, d: 1.4, gain: 0.1 },
    { wave: 'tri', f: 440, a: 0.6, delay: 0.4, s: 0.8, d: 1.4, gain: 0.1, vib: 0.004, vibHz: 5 },
    { wave: 'sine', f: 1174.66, a: 0.3, delay: 0.9, s: 0.4, d: 1.2, gain: 0.06 },
    hiss(8000, 1.6, 0.04, { a: 0.8, hpf: 3000 }),
  ] },
};
for (const k in RUN_SFX) if (!SFX[k]) SFX[k] = RUN_SFX[k];

/** Play a run-flow sound. step climbs D minor pentatonic. */
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
export function runSound(name, { step = null, rate = 1, gain = 1, x } = {}) {
  const r = step === null ? rate : rate * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12);
  try { return sfx.play(name, { rate: r, gain, x }); } catch { return false; }
}
