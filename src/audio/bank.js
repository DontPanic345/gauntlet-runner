// The SFX bank (piece `audio`): every sound the audio piece authors, as jsfxr-style layer lists.
//
//   import { sfx, SFX } from './audio/bank.js';
//   sfx.play('hit.heavy', { x, rate: 1, gain: 1, pan: 0, delay: 0 });   // -> true if it played
//   sfx.shard(step)        // the pickup ladder (D minor pentatonic, in key with the music)
//   sfx.step(surface)      // footsteps: 'stone' | 'grit' | 'wet' | 'tile' | 'bone' | 'carpet' | 'iron'
//
// Each sound is rendered offline into `variants` buffers (its params nudged by `vary`), lazily on
// first use and in idle time after the first gesture. Every play picks a variant other than the
// last one and adds its own pitch (`pitch`, fraction) and level (`vol`, fraction) jitter, so no
// sound ever repeats identically twice in a row. `gap` rate-limits a sound (seconds), `max`
// limits its polyphony (the oldest voice fades out in 15 ms), `duck` ducks the music.
// `bus`: 'sfx' (default), 'cue' (telegraphs: never ducked, never stolen by the music) or 'ui'.

import { audio } from './engine.js';
import { renderLayers, mutate, prng } from './synth.js';
import { display } from '../core/display.js';

const SR = 44100;

// ---- helpers for authoring -------------------------------------------------------------------
const thump = (f, d, gain = 0.8, more = {}) => ({ wave: 'sine', f, slide: -4.5, d, gain, drive: 0.3, ...more });
const click = (f, d = 0.02, gain = 0.3, more = {}) => ({ wave: 'square', f, slide: -6, duty: 0.3, d, gain, ...more });
const hiss = (lpf, d, gain = 0.4, more = {}) => ({ wave: 'white', lpf, d, gain, ...more });

// ---- the sounds ------------------------------------------------------------------------------------
export const SFX = {
  // ---- hero: swings (combo steps 0, 1 and the overhead finisher) -------------------------
  'swing.1': { gain: 3.5, group: 'HERO', label: 'swing (step 1)', pitch: 0.06, vol: 0.12, gap: 0.03, layers: [
    hiss(900, 0.11, 0.55, { a: 0.012, lpfSweep: 7, hpf: 500, res: 0.35 }),
    { wave: 'sine', f: 700, slide: 2.2, a: 0.01, d: 0.08, gain: 0.07 },
  ] },
  'swing.2': { gain: 3.2, group: 'HERO', label: 'swing (step 2)', pitch: 0.06, vol: 0.12, gap: 0.03, layers: [
    hiss(1300, 0.12, 0.55, { a: 0.01, lpfSweep: 6, hpf: 700, res: 0.4 }),
    { wave: 'sine', f: 900, slide: 2.5, a: 0.01, d: 0.08, gain: 0.07 },
  ] },
  'swing.3': { gain: 3.2, group: 'HERO', label: 'swing (overhead)', pitch: 0.05, vol: 0.1, gap: 0.03, layers: [
    hiss(450, 0.22, 0.7, { a: 0.04, lpfSweep: 4.5, hpf: 250, res: 0.45 }),
    { wave: 'saw', f: 95, slide: -1, a: 0.03, d: 0.2, gain: 0.12, lpf: 400 },
  ] },
  slam: { group: 'HERO', label: 'overhead floor slam', pitch: 0.05, vol: 0.1, duck: [5, 0.12, 0.4], layers: [
    thump(95, 0.32, 0.95), { wave: 'sine', f: 48, slide: -0.8, d: 0.4, gain: 0.5 },
    hiss(1400, 0.3, 0.5, { lpfSweep: -5, curve: 1.6 }),
    { wave: 'noise', f: 3000, d: 0.05, gain: 0.2, hpf: 1500 },
    { wave: 'white', delay: 0.08, d: 0.35, gain: 0.08, hpf: 2500, lpf: 6000, curve: 2 },
  ] },
  dash: { gain: 3, group: 'HERO', label: 'dash', pitch: 0.07, vol: 0.12, gap: 0.05, layers: [
    hiss(600, 0.17, 0.5, { a: 0.02, s: 0.02, lpfSweep: 5, hpf: 300, res: 0.3 }),
    { wave: 'noise', f: 220, d: 0.12, gain: 0.12, lpf: 900, vib: 0.4, vibHz: 30 },
    { wave: 'square', f: 520, slide: 3, duty: 0.25, d: 0.05, gain: 0.04 },
  ] },
  dashReady: { group: 'HERO', label: 'dash ready', bus: 'ui', pitch: 0.03, vol: 0.15, gap: 0.1, layers: [
    { wave: 'tri', f: 1760, d: 0.05, gain: 0.12 }, { wave: 'tri', f: 2637, delay: 0.035, d: 0.07, gain: 0.08 },
  ] },
  bonk: { group: 'HERO', label: 'bonk (dash into wall)', pitch: 0.08, vol: 0.12, gap: 0.08, layers: [
    thump(130, 0.09, 0.6), hiss(700, 0.06, 0.3), { wave: 'tri', f: 340, slide: -2, d: 0.05, gain: 0.08 },
  ] },
  land: { group: 'HERO', label: 'land', pitch: 0.06, vol: 0.1, layers: [
    thump(100, 0.1, 0.55), hiss(600, 0.08, 0.3, { hpf: 150 }),
  ] },
  dodge: { gain: 2.2, group: 'HERO', label: 'perfect dodge', pitch: 0.04, vol: 0.1, gap: 0.08, layers: [
    { wave: 'tri', f: 1500, slide: 1.4, d: 0.16, gain: 0.16 },
    { wave: 'sine', f: 3000, slide: 1.4, d: 0.12, gain: 0.06 },
    hiss(9000, 0.1, 0.18, { hpf: 4500, a: 0.01 }),
  ] },
  hurt: { group: 'HERO', label: 'hero hurt', pitch: 0.05, vol: 0.08, gap: 0.08, duck: [7, 0.25, 0.6], layers: [
    { wave: 'square', f: 640, slide: -4, duty: 0.25, d: 0.2, gain: 0.22, crush: 9000 },
    thump(170, 0.16, 0.7),
    hiss(2400, 0.12, 0.35, { lpfSweep: -4 }),
  ] },
  heroDeath: { group: 'HERO', label: 'hero death', pitch: 0.02, vol: 0.05, duck: [12, 1.2, 1.5], layers: [
    { wave: 'square', f: 440, slide: -1.3, duty: 0.25, s: 0.1, d: 0.9, gain: 0.18, vib: 0.03, vibHz: 7, crush: 11000 },
    { wave: 'square', f: 523, slide: -1.3, duty: 0.125, delay: 0.12, s: 0.08, d: 0.8, gain: 0.08 },
    thump(80, 0.6, 0.9), hiss(900, 0.7, 0.4, { lpfSweep: -3 }),
  ] },

  // ---- hits, by weight (power < 0.9 light, < 1.5 mid, heavier = heavy; finisher on top) -----
  'hit.light': { group: 'HITS', label: 'hit: light', pitch: 0.07, vol: 0.1, gap: 0.02, max: 6, layers: [
    click(2200, 0.018, 0.28),
    thump(190, 0.09, 0.75),
    { wave: 'noise', f: 2600, d: 0.06, gain: 0.32, lpf: 3200, lpfSweep: -4, hpf: 300 },
  ] },
  'hit.mid': { group: 'HITS', label: 'hit: medium', pitch: 0.06, vol: 0.1, gap: 0.02, max: 6, duck: [2, 0.06, 0.25], layers: [
    click(2000, 0.022, 0.32),
    thump(160, 0.13, 0.85),
    { wave: 'noise', f: 2200, d: 0.09, gain: 0.38, lpf: 2600, lpfSweep: -4, hpf: 250 },
    { wave: 'tri', f: 820, slide: -3, d: 0.05, gain: 0.08 },
  ] },
  'hit.heavy': { group: 'HITS', label: 'hit: heavy', pitch: 0.05, vol: 0.08, gap: 0.02, max: 5, duck: [3.5, 0.1, 0.35], layers: [
    click(1700, 0.028, 0.34),
    thump(125, 0.2, 0.95),
    { wave: 'sine', f: 62, slide: -1.2, d: 0.26, gain: 0.45 },
    { wave: 'noise', f: 1800, d: 0.14, gain: 0.42, lpf: 2200, lpfSweep: -3.5, hpf: 200, crush: 14000 },
  ] },
  'hit.finisher': { group: 'HITS', label: 'hit: finisher layer', pitch: 0.04, vol: 0.08, gap: 0.05, duck: [5, 0.16, 0.5], layers: [
    { wave: 'tri', f: 105, slide: -2, d: 0.34, gain: 0.55, drive: 0.4 },
    hiss(1900, 0.36, 0.38, { lpfSweep: -4, curve: 1.5 }),
    { wave: 'square', f: 1320, slide: -0.15, duty: 0.5, d: 0.16, gain: 0.05, vib: 0.01, vibHz: 18 },
    { wave: 'square', f: 1985, slide: -0.15, duty: 0.5, d: 0.1, gain: 0.03 },
  ] },
  kill: { group: 'HITS', label: 'kill confirm', pitch: 0.05, vol: 0.1, gap: 0.04, layers: [
    { wave: 'noise', f: 900, d: 0.16, gain: 0.3, lpf: 1600, lpfSweep: -3 },
    thump(90, 0.18, 0.6),
    { wave: 'square', f: 196, slide: -1.5, duty: 0.125, d: 0.12, gain: 0.05, crush: 6000 },
  ] },

  // ---- footsteps per surface (quiet; L and R feet differ a little in pitch) ------------------
  'step.stone': { group: 'STEPS', label: 'step: stone', pitch: 0.08, vol: 0.2, max: 3, variants: 6, layers: [
    { wave: 'noise', f: 2400, d: 0.035, gain: 0.22, lpf: 2600, hpf: 350, res: 0.2 },
    thump(150, 0.035, 0.22, { drive: 0 }),
  ] },
  'step.tile': { group: 'STEPS', label: 'step: tile', pitch: 0.08, vol: 0.2, max: 3, variants: 6, layers: [
    { wave: 'noise', f: 5000, d: 0.02, gain: 0.2, hpf: 1600, lpf: 7000 },
    { wave: 'tri', f: 920, slide: -2, d: 0.025, gain: 0.06 },
    thump(170, 0.03, 0.18, { drive: 0 }),
  ] },
  'step.grit': { group: 'STEPS', label: 'step: grit / rubble', pitch: 0.1, vol: 0.2, max: 3, variants: 6, layers: [
    hiss(5000, 0.06, 0.2, { hpf: 1100, crush: 9000 }),
    { wave: 'noise', f: 1800, d: 0.012, gain: 0.12, repeat: 0.018, hpf: 800, delay: 0.01 },
    thump(140, 0.03, 0.15, { drive: 0 }),
  ] },
  'step.wet': { group: 'STEPS', label: 'step: wet', pitch: 0.1, vol: 0.2, max: 3, variants: 6, layers: [
    { wave: 'sine', f: 420, slide: 3.5, d: 0.05, gain: 0.12 },
    hiss(3200, 0.08, 0.22, { hpf: 700, a: 0.006 }),
    thump(130, 0.03, 0.14, { drive: 0 }),
  ] },
  'step.bone': { group: 'STEPS', label: 'step: bone chips', pitch: 0.1, vol: 0.2, max: 3, variants: 6, layers: [
    { wave: 'noise', f: 4200, d: 0.018, gain: 0.16, hpf: 2000 },
    { wave: 'noise', f: 3400, delay: 0.022, d: 0.015, gain: 0.1, hpf: 1800 },
    thump(150, 0.03, 0.18, { drive: 0 }),
  ] },
  'step.carpet': { group: 'STEPS', label: 'step: carpet', pitch: 0.08, vol: 0.2, max: 3, variants: 6, layers: [
    hiss(700, 0.05, 0.3, { a: 0.004 }), thump(120, 0.035, 0.2, { drive: 0 }),
  ] },
  'step.iron': { group: 'STEPS', label: 'step: iron grate', pitch: 0.06, vol: 0.2, max: 3, variants: 6, layers: [
    { wave: 'tri', f: 410, d: 0.07, gain: 0.07 }, { wave: 'square', f: 1130, duty: 0.4, d: 0.04, gain: 0.025 },
    { wave: 'noise', f: 3000, d: 0.025, gain: 0.14, hpf: 900 }, thump(150, 0.03, 0.15, { drive: 0 }),
  ] },

  // ---- enemy barks -------------------------------------------------------------------------------
  'husk.spawn': { group: 'ENEMIES', label: 'husk: rises', pitch: 0.08, vol: 0.12, gap: 0.1, layers: [
    { wave: 'saw', f: 92, slide: -0.3, a: 0.12, s: 0.1, d: 0.4, gain: 0.28, lpf: 650, res: 0.5, vib: 0.06, vibHz: 7 },
    hiss(500, 0.45, 0.35, { a: 0.08, lpfSweep: -1 }),
  ] },
  'husk.hurt': { group: 'ENEMIES', label: 'husk: hurt grunt', pitch: 0.1, vol: 0.12, gap: 0.06, max: 3, layers: [
    { wave: 'saw', f: 150, slide: -1.6, a: 0.01, d: 0.13, gain: 0.26, lpf: 900, res: 0.4, crush: 8000 },
  ] },
  'husk.death': { group: 'ENEMIES', label: 'husk: death moan', pitch: 0.08, vol: 0.1, gap: 0.05, layers: [
    { wave: 'saw', f: 140, slide: -1.4, a: 0.02, s: 0.06, d: 0.45, gain: 0.26, lpf: 800, res: 0.5, vib: 0.07, vibHz: 6 },
    { wave: 'noise', f: 2400, delay: 0.1, d: 0.012, gain: 0.14, repeat: 0.035, hpf: 1200, s: 0.15 },
  ] },
  'wisp.spawn': { gain: 2.6, group: 'ENEMIES', label: 'wisp: ignites', pitch: 0.06, vol: 0.12, gap: 0.1, layers: [
    hiss(500, 0.32, 0.4, { a: 0.06, lpfSweep: 5, res: 0.6, hpf: 200 }),
    { wave: 'tri', f: 330, slide: 2, a: 0.04, d: 0.25, gain: 0.1, vib: 0.02, vibHz: 11 },
  ] },
  'wisp.hurt': { gain: 2.6, group: 'ENEMIES', label: 'wisp: hurt crackle', pitch: 0.1, vol: 0.12, gap: 0.06, max: 3, layers: [
    { wave: 'tri', f: 1400, slide: -3, d: 0.08, gain: 0.12 }, hiss(6000, 0.08, 0.22, { hpf: 2500 }),
  ] },
  'wisp.death': { gain: 2, group: 'ENEMIES', label: 'wisp: snuffed', pitch: 0.06, vol: 0.1, gap: 0.05, layers: [
    hiss(5000, 0.45, 0.35, { lpfSweep: -4, hpf: 300 }),
    { wave: 'tri', f: 990, slide: -3.2, d: 0.32, gain: 0.12 },
  ] },
  'brute.spawn': { group: 'ENEMIES', label: 'brute: roars in', pitch: 0.05, vol: 0.08, gap: 0.2, duck: [4, 0.4, 0.6], layers: [
    { wave: 'saw', f: 62, slide: -0.4, a: 0.06, s: 0.25, d: 0.5, gain: 0.34, lpf: 520, res: 0.55, vib: 0.08, vibHz: 9 },
    { wave: 'saw', f: 93, slide: -0.4, a: 0.08, s: 0.2, d: 0.45, gain: 0.16, lpf: 700, vib: 0.06, vibHz: 7 },
    hiss(800, 0.6, 0.35, { a: 0.05, lpfSweep: -1.5 }),
  ] },
  'brute.hurt': { group: 'ENEMIES', label: 'brute: hurt grunt', pitch: 0.08, vol: 0.1, gap: 0.08, max: 2, layers: [
    { wave: 'saw', f: 88, slide: -1.2, a: 0.01, d: 0.18, gain: 0.3, lpf: 600, res: 0.5, drive: 0.4 },
  ] },
  'brute.death': { group: 'ENEMIES', label: 'brute: death bellow', pitch: 0.05, vol: 0.08, duck: [4, 0.6, 0.8], layers: [
    { wave: 'saw', f: 78, slide: -0.9, a: 0.04, s: 0.2, d: 0.8, gain: 0.32, lpf: 520, res: 0.5, vib: 0.05, vibHz: 5 },
    hiss(700, 0.9, 0.25, { a: 0.1, lpfSweep: -1.5 }),
  ] },
  'mite.spawn': { gain: 2.2, group: 'ENEMIES', label: 'mite: chitter', pitch: 0.1, vol: 0.12, gap: 0.06, max: 3, layers: [
    { wave: 'square', f: 2300, slide: -1, duty: 0.2, d: 0.016, repeat: 0.034, s: 0.12, gain: 0.07, hpf: 900 },
  ] },
  'mite.hurt': { gain: 3, group: 'ENEMIES', label: 'mite: squeak', pitch: 0.12, vol: 0.12, gap: 0.04, max: 3, layers: [
    { wave: 'square', f: 1800, slide: 2.5, duty: 0.25, d: 0.045, gain: 0.07 },
  ] },
  'mite.death': { group: 'ENEMIES', label: 'mite: pop', pitch: 0.12, vol: 0.12, gap: 0.03, max: 4, layers: [
    { wave: 'noise', f: 2000, d: 0.06, gain: 0.3, lpf: 3000, lpfSweep: -5 },
    { wave: 'square', f: 1500, slide: -5, duty: 0.25, d: 0.06, gain: 0.06 },
  ] },

  // ---- pickups -------------------------------------------------------------------------------
  shard: { group: 'PICKUPS', label: 'shard (ladder: keys 1..9)', bus: 'ui', pitch: 0.004, vol: 0.12, max: 6, gap: 0.018, layers: [
    { wave: 'tri', f: 587.33, d: 0.16, gain: 0.3 },
    { wave: 'sine', f: 1174.66, d: 0.22, gain: 0.12 },
    { wave: 'square', f: 1762, duty: 0.25, d: 0.03, gain: 0.03 },
  ] },
  heart: { group: 'PICKUPS', label: 'heart', bus: 'ui', pitch: 0.02, vol: 0.08, duck: [4, 0.3, 0.5], layers: [
    { wave: 'tri', f: 587.33, d: 0.11, gain: 0.32 },
    { wave: 'tri', f: 880, delay: 0.08, s: 0.05, d: 0.3, gain: 0.32, vib: 0.006, vibHz: 6 },
    { wave: 'sine', f: 1174.66, delay: 0.08, d: 0.35, gain: 0.12 },
    hiss(9000, 0.3, 0.05, { hpf: 3000, delay: 0.05, a: 0.05 }),
  ] },

  // ---- world -----------------------------------------------------------------------------------
  clearSting: { group: 'WORLD', label: 'arena clear sting', bus: 'ui', pitch: 0.003, vol: 0.05, duck: [10, 1.4, 1.2], layers: [
    // D minor resolving to D major (picardy third), in key with the arena music
    { wave: 'tri', f: 73.42, a: 0.05, s: 0.6, d: 0.9, gain: 0.3 },
    { wave: 'square', f: 293.66, duty: 0.25, d: 0.22, gain: 0.07 },
    { wave: 'square', f: 349.23, duty: 0.25, delay: 0.08, d: 0.22, gain: 0.07 },
    { wave: 'square', f: 440, duty: 0.25, delay: 0.16, d: 0.22, gain: 0.07 },
    { wave: 'tri', f: 587.33, delay: 0.26, s: 0.3, d: 0.8, gain: 0.2, vib: 0.006, vibHz: 5, vibDelay: 0.2 },
    { wave: 'tri', f: 739.99, delay: 0.26, s: 0.3, d: 0.8, gain: 0.16, vib: 0.006, vibHz: 5, vibDelay: 0.2 },
    { wave: 'tri', f: 880, delay: 0.26, s: 0.3, d: 0.8, gain: 0.14 },
    { wave: 'sine', f: 1174.66, delay: 0.3, s: 0.2, d: 0.9, gain: 0.07 },
  ] },
  deathSting: { group: 'WORLD', label: 'death sting', bus: 'ui', pitch: 0.003, vol: 0.05, layers: [
    { wave: 'square', f: 587.33, duty: 0.25, d: 0.3, gain: 0.08 },
    { wave: 'square', f: 523.25, duty: 0.25, delay: 0.25, d: 0.3, gain: 0.08 },
    { wave: 'square', f: 466.16, duty: 0.25, delay: 0.5, d: 0.3, gain: 0.08 },
    { wave: 'square', f: 440, duty: 0.25, delay: 0.75, s: 0.3, d: 1.2, gain: 0.08, vib: 0.01, vibHz: 5, vibDelay: 0.3 },
    { wave: 'tri', f: 73.42, delay: 0.75, s: 0.3, d: 1.4, gain: 0.3 },
    { wave: 'tri', f: 277.18, delay: 0.75, s: 0.3, d: 1.2, gain: 0.1 },
  ] },
  quakeHit: { group: 'WORLD', label: 'collapse breaks loose', pitch: 0.03, vol: 0.06, duck: [6, 0.8, 1.0], layers: [
    { wave: 'sine', f: 52, slide: -0.6, d: 1.3, gain: 0.7, drive: 0.5 },
    hiss(1200, 1.4, 0.5, { lpfSweep: -2.2, curve: 1.3 }),
    { wave: 'noise', f: 1500, delay: 0.1, s: 0.8, d: 0.4, gain: 0.08, repeat: 0.07, hpf: 600 },
  ] },
  debris: { group: 'WORLD', label: 'collapse debris (one rock)', pitch: 0.2, vol: 0.3, max: 6, variants: 8, layers: [
    { wave: 'noise', f: 1500, d: 0.05, gain: 0.25, lpf: 2400, hpf: 300 },
    thump(110, 0.08, 0.35),
  ] },
  drip: { group: 'WORLD', label: 'water drip (ambience)', bus: 'amb', pitch: 0.15, vol: 0.3, max: 2, variants: 5, layers: [
    { wave: 'sine', f: 900, slide: 4, d: 0.045, gain: 0.22 },
    { wave: 'sine', f: 1500, slide: 3, delay: 0.04, d: 0.03, gain: 0.06 },
  ] },
  crackle: { group: 'WORLD', label: 'torch crackle (ambience)', bus: 'amb', pitch: 0.25, vol: 0.4, max: 3, variants: 8, layers: [
    { wave: 'noise', f: 6000, d: 0.012, gain: 0.16, hpf: 1500 },
    { wave: 'noise', f: 3000, delay: 0.018, d: 0.008, gain: 0.08, hpf: 1200 },
  ] },
};

const SURFACES = ['stone', 'tile', 'grit', 'wet', 'bone', 'carpet', 'iron'];
// D minor pentatonic (D F G A C), two octaves and a bit: the shard ladder
const LADDER = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34];

// ---- rendering --------------------------------------------------------------------------------------
const cache = new Map();   // name -> AudioBuffer[]

function variantLayers(name, def, v) {
  if (v === 0) return def.layers.map((L, i) => ({ seed: hash(name) + i, ...L }));
  return mutate(def.layers, def.vary ?? 0.08, prng(hash(name) * 31 + v));
}

/** The variant buffers of a sound (rendered lazily: entries are null until first needed). */
function buffersFor(name) {
  let bufs = cache.get(name);
  if (bufs) return bufs;
  if (!SFX[name] || !audio.ctx) return null;
  bufs = new Array(SFX[name].variants ?? 4).fill(null);
  cache.set(name, bufs);
  return bufs;
}

function variant(name, v) {
  const bufs = buffersFor(name);
  if (!bufs) return null;
  if (!bufs[v]) {
    const data = renderLayers(variantLayers(name, SFX[name], v), SR);
    const b = audio.ctx.createBuffer(1, data.length, SR);
    b.copyToChannel(data, 0);
    bufs[v] = b;
  }
  return bufs[v];
}

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// Warm the cache once the context exists, so first plays never render on the spot: in a Worker
// when the browser allows module workers (no main-thread cost at all), else in idle slices.
// Most frequent sounds first, then the rest of the first variants, then the other variants.
const WARM_FIRST = ['hit.light', 'hit.mid', 'hit.heavy', 'swing.1', 'swing.2', 'swing.3', 'step.stone', 'dash', 'hurt'];
let warmStats = { mode: 'none', done: 0, total: 0 };
audio.onUnlock(() => {
  const names = [...new Set([...WARM_FIRST, ...Object.keys(SFX)])];
  const jobs = [];
  for (const n of names) jobs.push([n, 0]);
  for (const n of names) for (let v = 1; v < (SFX[n].variants ?? 4); v++) jobs.push([n, v]);
  warmStats = { mode: 'worker', done: 0, total: jobs.length };
  let worker = null;
  try { worker = new Worker(new URL('./synth-worker.js', import.meta.url), { type: 'module' }); } catch { worker = null; }
  if (worker) {
    const pending = new Map();
    worker.onmessage = (e) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      warmStats.done++;
      const bufs = buffersFor(job[0]);
      if (bufs && !bufs[job[1]]) {
        const b = audio.ctx.createBuffer(1, e.data.data.length, SR);
        b.copyToChannel(e.data.data, 0);
        bufs[job[1]] = b;
      }
      if (!pending.size) worker.terminate();
    };
    worker.onerror = () => { worker.terminate(); idleWarm(jobs.filter(([n, v]) => !cache.get(n)?.[v])); };
    jobs.forEach((job, id) => { pending.set(id, job); worker.postMessage({ id, layers: variantLayers(job[0], SFX[job[0]], job[1]), sr: SR }); });
  } else idleWarm(jobs);
});

function idleWarm(jobs) {
  warmStats.mode = 'idle';
  const idle = typeof requestIdleCallback === 'function' ? (fn) => requestIdleCallback(fn, { timeout: 200 }) : (fn) => setTimeout(fn, 16);
  const step = (dl) => {
    const t0 = performance.now();
    const budget = dl?.timeRemaining ? Math.max(4, Math.min(12, dl.timeRemaining())) : 6;
    while (jobs.length && performance.now() - t0 < budget) { const [n, v] = jobs.shift(); variant(n, v); warmStats.done++; }
    if (jobs.length) idle(step);
  };
  setTimeout(() => idle(step), 100);
}

// ---- playing ----------------------------------------------------------------------------------------
const lastVariant = new Map();
const lastAt = new Map();
const voices = new Map();       // name -> [{src, g, end}]
const recent = [];              // last plays, for debug
let playCount = 0;

/** Stereo position for a world x: the middle of the view is centre. */
export function panFor(x) {
  if (typeof x !== 'number') return 0;
  const cx = display.cameraTarget?.x ?? x;
  return Math.max(-0.7, Math.min(0.7, (x - cx) / 10));
}

function play(name, opt = {}) {
  const c = audio.ctx;
  const def = SFX[name];
  if (!c || !def) return false;
  const now = c.currentTime;
  if (def.gap && now - (lastAt.get(name) ?? -1) < def.gap) return false;
  const bufs = buffersFor(name);
  if (!bufs?.length) return false;
  lastAt.set(name, now);
  // prefer variants already rendered, so a first play never waits on more than one render
  const ready = bufs.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);

  // a variant other than the last one
  const pool = ready.length >= 2 ? ready : bufs.map((_, i) => i);
  const prev = lastVariant.get(name);
  const choices = pool.length > 1 ? pool.filter((i) => i !== prev) : pool;
  const vi = choices[Math.floor(Math.random() * choices.length)];
  lastVariant.set(name, vi);
  const buf = variant(name, vi);

  // polyphony: fade out the oldest voice
  const list = (voices.get(name) ?? []).filter((v) => v.end > now);
  const max = def.max ?? 4;
  while (list.length >= max) {
    const v = list.shift();
    try { v.g.gain.cancelScheduledValues(now); v.g.gain.setValueAtTime(v.g.gain.value, now); v.g.gain.linearRampToValueAtTime(0, now + 0.015); v.src.stop(now + 0.02); } catch { /* gone */ }
  }

  const jitP = (Math.random() * 2 - 1) * (def.pitch ?? 0.04);
  const jitV = 1 - Math.random() * (def.vol ?? 0.1);
  const rate = (opt.rate ?? 1) * (1 + jitP);
  const level = (def.gain ?? 1) * (opt.gain ?? 1) * jitV;
  const t = now + (opt.delay ?? 0);

  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = level;
  let node = src.connect(g);
  const pan = opt.pan ?? (opt.x !== undefined ? panFor(opt.x) : 0);
  if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
  node.connect(audio.bus(opt.bus ?? def.bus ?? 'sfx'));
  src.start(t);
  const end = t + buf.duration / rate;
  list.push({ src, g, end });
  voices.set(name, list);
  src.onended = () => { try { g.disconnect(); } catch { /* ok */ } };

  if (def.duck) audio.duck(def.duck[0], def.duck[1], def.duck[2]);
  playCount++;
  recent.push({ name, t: +now.toFixed(3), v: vi, rate: +rate.toFixed(3), gain: +level.toFixed(3) });
  if (recent.length > 16) recent.shift();
  return true;
}

export const sfx = {
  play,
  has: (name) => name in SFX,
  names: () => Object.keys(SFX),
  surfaces: SURFACES,
  /** The pickup ladder: step 0.. climbs D minor pentatonic. */
  shard(step = 0) {
    const semis = LADDER[Math.max(0, Math.min(LADDER.length - 1, step | 0))];
    return play('shard', { rate: Math.pow(2, semis / 12), gain: 1 - Math.min(0.3, step * 0.02) });
  },
  /** A footstep on a surface. foot 'L' | 'R' (R is a hair lower). */
  step(surface = 'stone', foot = 'L', opt = {}) {
    const name = `step.${SURFACES.includes(surface) ? surface : 'stone'}`;
    return play(name, { ...opt, rate: (opt.rate ?? 1) * (foot === 'R' ? 0.94 : 1) });
  },
  /** A hit by weight. power: combat's hit power (0.6 .. 2.6). */
  hit(power = 1, finisher = false, opt = {}) {
    const name = power < 0.9 ? 'hit.light' : power < 1.5 ? 'hit.mid' : 'hit.heavy';
    const ok = play(name, opt);
    if (finisher) play('hit.finisher', opt);
    return ok;
  },
  info: () => ({ warm: { ...warmStats }, rendered: [...cache.values()].reduce((a, b) => a + b.filter(Boolean).length, 0), plays: playCount, recent: recent.slice(-8) }),
  recent: () => recent.slice(),
  /** Render every sound now (the showcase does this so a critic never waits). */
  warm() { for (const n of Object.keys(SFX)) for (let v = 0; v < (SFX[n].variants ?? 4); v++) variant(n, v); return cache.size; },
};
