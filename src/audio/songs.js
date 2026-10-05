// The scores (piece `audio`). Everything is in D minor, so the stems, the stings and the shard
// pickup ladder agree. Each song is written as sections of bars over a chord chart, with a lead
// melody, a counter-line, pads, bass, an arpeggio and drums as separate stems, so the director
// can layer them by game state. compile() flattens a song to plain note lists for the worklet.
//
//   title  "Beneath the Mountain"   84 BPM  intro 2 | A 8 | A2 8 | B 8 | A3 8   (loops from A)
//   crypt  "The Gauntlet"          132 BPM  A 8 | B 8 | A2 8 | B2 8             (arena + corridor)
//   warden "The Warden"            148 BPM  A 8 | B 8 | A2 8                    (boss, by phase)
//   dirge  "Fallen"                 72 BPM  6 bars, once                       (game over)
//
// Melody notation (mel): space-separated tokens, one per note: NOTE.len, where NOTE is like D5,
// F#4 or Bb3 (or r for a rest) and len is in 16th steps (kept from the previous token when left
// out). A trailing ! accents a note, ' ghosts it, ~ glides into it from the previous note.
// | is a bar line and is checked (it must fall on a multiple of 16).
// Drum grids (grid): 16 characters per bar, X 1.0, x 0.8, o 0.6, g 0.4, . rest.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteNum(tok) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(tok);
  if (!m) throw new Error(`songs: bad note "${tok}"`);
  return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** A melody line from step `at`. Returns note events {s, p, l, v, g}. */
export function mel(str, at = 0, { vel = 1, shift = 0, inst } = {}) {
  const out = [];
  let pos = 0, len = 4;
  for (let tok of str.trim().split(/\s+/)) {
    if (tok === '|') { if (pos % 16) throw new Error(`songs: bar line at step ${pos} in "${str.slice(0, 40)}..."`); continue; }
    let accent = 0, glide = 0;
    while (/[!'~]$/.test(tok)) {
      const c = tok.slice(-1); tok = tok.slice(0, -1);
      if (c === '!') accent = 1; else if (c === "'") accent = -1; else glide = 1;
    }
    const [n, l] = tok.split('.');
    if (l) len = +l;
    if (n !== 'r') {
      // natural phrasing: downbeats lean in, offbeats sit back
      const beat = pos % 8 === 0 ? 1 : pos % 4 === 0 ? 0.88 : pos % 2 === 0 ? 0.8 : 0.72;
      const v = accent > 0 ? 1 : accent < 0 ? 0.55 : beat;
      const e = { s: at + pos, p: noteNum(n) + shift, l: len, v: v * vel, g: glide };
      if (inst) e.i = inst;
      out.push(e);
    }
    pos += len;
  }
  if (pos % 16) throw new Error(`songs: melody ends mid-bar (${pos}) in "${str.slice(0, 40)}..."`);
  return out;
}

/** A drum grid (16 chars per bar, bars separated by spaces) for one kit piece. */
export function grid(str, piece, at = 0, { vel = 1, rate, pan } = {}) {
  const V = { X: 1, x: 0.8, o: 0.6, g: 0.4 };
  const out = [];
  let pos = 0;
  for (const ch of str.replace(/\s+/g, '')) {
    if (V[ch]) { const e = { s: at + pos, p: piece, l: 1, v: V[ch] * vel }; if (rate) e.r = typeof rate === 'function' ? rate(pos) : rate; if (pan != null) e.pan = pan; out.push(e); }
    pos++;
  }
  return out;
}

// ---- chords --------------------------------------------------------------------------------------
// root: bass register (D2..C3). pad: a close voicing around F4, voice-led between neighbours.
export const CH = {
  Dm: { root: 38, pad: [62, 65, 69] },
  Bb: { root: 46, pad: [62, 65, 70] },
  F: { root: 41, pad: [60, 65, 69] },
  C: { root: 48, pad: [60, 64, 67] },
  Gm: { root: 43, pad: [62, 67, 70] },
  A: { root: 45, pad: [61, 64, 69] },
  Eb: { root: 39, pad: [63, 67, 70] },
};

// ---- instruments ---------------------------------------------------------------------------------
// Voice params are read by music-worklet.js (see Voice there). gain is per voice, before the stem.
const I = {
  pad: { type: 'saw', uni: 3, det: 14, a: 0.45, d: 0.8, s: 0.8, r: 1.1, cut: 1100, res: 0.6, key: 0.2, velCut: 0.8, gain: 0.32, gate: 1 },
  padDark: { type: 'saw', uni: 3, det: 12, a: 0.6, d: 1, s: 0.85, r: 1.4, cut: 750, res: 0.6, key: 0.1, gain: 0.34, gate: 1 },
  tribass: { type: 'tri', a: 0.008, d: 0.6, s: 0.75, r: 0.12, cut: 900, key: 0.2, gain: 0.85 },
  pbass: { type: 'pulse', duty: 0.25, a: 0.004, d: 0.12, s: 0.55, r: 0.05, cut: 520, cutEnv: 2.2, fd: 0.07, res: 1.1, key: 0.4, gain: 0.55 },
  harp: { type: 'pluck', a: 0.002, s: 1, r: 0.35, decay: 1.6, bright: 0.45, cut: 4200, key: 0.2, gain: 0.55, gate: 1.4 },
  harpHi: { type: 'pluck', a: 0.002, s: 1, r: 0.18, decay: 0.7, bright: 0.55, cut: 5200, key: 0.1, gain: 0.42, gate: 1.3 },
  flute: { type: 'pulse', duty: 0.5, a: 0.03, d: 0.4, s: 0.78, r: 0.16, cut: 1400, cutEnv: 0.6, fd: 0.18, res: 0.8, key: 0.6, velCut: 0.9, vib: 0.18, vibHz: 5.2, vibDelay: 0.22, glide: 0.06, mono: true, gain: 0.32 },
  sqlead: { type: 'pulse', duty: 0.5, a: 0.006, d: 0.25, s: 0.72, r: 0.09, cut: 2400, cutEnv: 1.2, fd: 0.12, res: 0.9, key: 0.5, velCut: 0.9, vib: 0.16, vibHz: 5.6, vibDelay: 0.16, glide: 0.04, mono: true, gain: 0.3 },
  sawlead: { type: 'saw', uni: 2, det: 9, a: 0.008, d: 0.3, s: 0.7, r: 0.12, cut: 1900, cutEnv: 1.5, fd: 0.14, res: 1, key: 0.5, vib: 0.2, vibHz: 6, vibDelay: 0.14, glide: 0.04, mono: true, gain: 0.3 },
  ep: { type: 'fm', ratio: 1, index: 1.6, a: 0.004, d: 1.2, s: 0.25, r: 0.4, fd: 0.35, cut: 3600, key: 0.2, gain: 0.34 },
  chime: { type: 'fm', ratio: 3.5, index: 1.8, a: 0.002, d: 1.8, s: 0, r: 1.2, fd: 0.5, cut: 6000, key: 0, gain: 0.22, gate: 1 },
  counter: { type: 'pulse', duty: 0.25, a: 0.006, d: 0.3, s: 0.6, r: 0.1, cut: 1500, cutEnv: 1, fd: 0.1, res: 0.8, key: 0.5, vib: 0.1, vibHz: 5, vibDelay: 0.3, gain: 0.3 },
  flute2: { type: 'tri', a: 0.02, d: 0.3, s: 0.8, r: 0.12, cut: 4000, key: 0.2, vib: 0.15, vibHz: 5.4, vibDelay: 0.2, glide: 0.05, mono: true, gain: 0.42 },
  chug: { type: 'saw', a: 0.003, d: 0.08, s: 0.4, r: 0.04, cut: 260, cutEnv: 7, fd: 0.05, res: 2.2, key: 0, drive: 0.4, gain: 0.5 },
  siren: { type: 'pulse', duty: 0.25, a: 0.01, d: 0.2, s: 0.8, r: 0.06, cut: 2400, res: 1.2, key: 0, vib: 0.25, vibHz: 9, vibDelay: 0.02, gain: 0.3 },
  organ: { type: 'organ', a: 0.06, d: 0.4, s: 0.85, r: 0.3, cut: 2600, key: 0.2, gain: 0.28, gate: 0.98 },
  drone: { type: 'organ', a: 0.8, d: 1, s: 0.9, r: 1.5, cut: 900, key: 0, gain: 0.34, gate: 1 },
  choir: { type: 'choir', uni: 2, det: 16, a: 0.5, d: 0.6, s: 0.9, r: 1, vib: 0.08, vibHz: 4.6, vibDelay: 0.4, gain: 0.26, gate: 1 },
  toll: { type: 'fm', ratio: 3.5, index: 2.6, a: 0.002, d: 3, s: 0, r: 2, fd: 0.9, cut: 4000, key: 0, gain: 0.34, gate: 1 },
  kit: { type: 'kit', gain: 1, pans: { hat: 0.25, ohat: 0.25, shaker: -0.3, rim: -0.1, crash: 0.15 } },
};

// ---- helpers -------------------------------------------------------------------------------------
const bars = (n) => n * 16;
function pads(chords, at, { vel = 0.7, spread = 0.5, len = 16, inst } = {}) {
  const out = [];
  chords.forEach((c, b) => {
    const P = CH[c].pad;
    P.forEach((m, k) => { const e = { s: at + b * 16, p: m, l: len, v: vel, pan: (k - 1) * spread }; if (inst) e.i = inst; out.push(e); });
  });
  return out;
}
/** Bass: per bar, a list of [step, interval from root, len, vel]. */
function bassline(chords, at, pattern, { oct = 0 } = {}) {
  const out = [];
  chords.forEach((c, b) => {
    const pat = typeof pattern === 'function' ? pattern(b, c) : pattern;
    for (const [s, iv, l, v] of pat) out.push({ s: at + b * 16 + s, p: CH[c].root + iv + oct, l, v });
  });
  return out;
}
/** An arpeggio over each bar's chord: ladder [root+12, pad 0, 1, 2, then pad 0, 1, 2 an octave up]. */
function arp(chords, at, seq, { every = 1, oct = 0, vel = 0.8, len = 1, accent = 4 } = {}) {
  const out = [];
  chords.forEach((c, b) => {
    const C = CH[c];
    const ladder = [C.root + 12, ...C.pad, C.pad[0] + 12, C.pad[1] + 12, C.pad[2] + 12];
    for (let k = 0; k < 16 / every; k++) {
      const s = k * every;
      out.push({ s: at + b * 16 + s, p: ladder[seq[k % seq.length]] + oct, l: len, v: vel * (s % (accent * 4) === 0 ? 1 : s % 4 === 0 ? 0.85 : 0.68) });
    }
  });
  return out;
}
const rep = (n, s) => Array(n).fill(s).join(' ');

/** Flatten a song to what the worklet needs. */
export function compile(song) {
  const notes = {};
  for (const [stem, list] of Object.entries(song.parts)) notes[stem] = list.flat().sort((a, b) => a.s - b.s);
  const sections = [];
  let at = 0;
  for (const [name, n] of song.form) { sections.push({ name, at }); at += n * 16; }
  return {
    name: song.name, title: song.title, bpm: song.bpm, steps: at, loop: song.loop !== false,
    loopStart: song.loopFrom ? sections.find((s) => s.name === song.loopFrom).at : 0,
    sections, echoFb: song.echoFb, gain: song.gain ?? 1, stems: song.stems, notes,
  };
}

// =================================================================================================
// TITLE: "Beneath the Mountain". A lyrical theme over a harp, opened by a swell and a deep boom.
// =================================================================================================
const T_A = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'];
const T_B = ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Gm', 'A'];
const T_MEL_A = 'D5.6 E5.2 F5.4 A5.4 | G5.6 F5.2 D5.8 | C5.6 D5.2 E5.4 F5.4 | E5.10 r.2 A4.2 C5.2 | D5.6 E5.2 F5.4 A5.4 | Bb5.6 A5.2 G5.8 | G5.4 F5.4 E5.4 D5.4 | C#5.8 r.4 A4.2 C#5.2';
const T_MEL_A2 = 'D5.6 E5.2 F5.4 A5.4 | G5.6 F5.2 D5.8 | C5.6 D5.2 E5.4 F5.4 | E5.10 r.2 A4.2 C5.2 | D5.6 E5.2 F5.4 A5.4 | Bb5.6 A5.2 G5.8 | Bb5.4 A5.4 G5.4 E5.4 | E5.6 C#5.2 A4.8';
const T_MEL_B = 'A5.4 C6.4~ A5.4 G5.4 | E5.8 G5.8 | F5.6 E5.2 D5.4 F5.4 | D5.12 r.4 | A5.4 C6.4 A5.4 G5.4 | E5.6 F5.2 G5.8 | Bb5.6 A5.2 G5.4 F5.4 | E5.8 r.4 A4.2 C5.2';
const T_CTR_A = 'A4.8 F4.4 E4.4 | D4.8 F4.8 | A4.8 G4.4 F4.4 | E4.4 G4.4 C5.8 | A4.8 F4.4 E4.4 | D4.8 Bb4.4 D5.4 | D5.8 Bb4.8 | A4.8 E4.4 C#4.4';
const T_CTR_B = 'C5.8 A4.8 | G4.8 E4.8 | F4.8 A4.8 | Bb4.8 F4.8 | C5.8 A4.8 | G4.4 E4.4 C4.8 | D4.8 G4.4 Bb4.4 | C#5.8 A4.8';
const HARP8 = [0, 1, 2, 3, 4, 3, 2, 1];

function titleSong() {
  const A = bars(2), A2 = bars(10), B = bars(18), A3 = bars(26);
  return {
    name: 'title', title: 'BENEATH THE MOUNTAIN', bpm: 84, loopFrom: 'A', gain: 1.45,
    form: [['intro', 2], ['A', 8], ['A2', 8], ['B', 8], ['A3', 8]],
    echoFb: 0.36,
    stems: {
      bed: { inst: I.pad, gain: 0.55, catchUp: true },
      bass: { inst: I.tribass, gain: 0.34 },
      harp: { inst: I.harp, gain: 2.0, pan: 0.2, echo: 0.22 },
      lead: { inst: I.flute, gain: 0.75, pan: -0.08, echo: 0.3 },
      counter: { inst: I.ep, gain: 0.85, pan: 0.3, echo: 0.18, insts: { chime: I.chime } },
      perc: { inst: I.kit, gain: 0.9 },
      fx: { inst: I.kit, gain: 1 },
    },
    parts: {
      bed: [pads(['Dm', 'Dm'], 0, { vel: 0.55 }), pads(T_A, A, { vel: 0.6 }), pads(T_A, A2, { vel: 0.66 }), pads(T_B, B, { vel: 0.72 }), pads(T_A, A3, { vel: 0.8 })],
      bass: [
        [{ s: 16, p: 38, l: 16, v: 0.8 }],
        bassline(T_A, A, [[0, 0, 12, 0.9], [12, 7, 4, 0.7]]),
        bassline(T_A, A2, [[0, 0, 12, 0.9], [12, 7, 4, 0.7]]),
        bassline(T_B, B, [[0, 0, 6, 0.9], [6, 0, 2, 0.6], [8, 7, 4, 0.75], [12, 12, 2, 0.6], [14, 0, 2, 0.7]]),
        bassline(T_A, A3, [[0, 0, 6, 0.95], [6, 0, 2, 0.6], [8, 7, 4, 0.8], [12, 12, 2, 0.6], [14, 0, 2, 0.7]]),
      ],
      harp: [
        arp(['Dm'], 16, HARP8, { every: 2, len: 2, vel: 0.75, oct: 12 }),
        arp(T_A, A, HARP8, { every: 2, len: 2, vel: 0.7, oct: 12 }),
        arp(T_A, A2, HARP8, { every: 2, len: 2, vel: 0.72, oct: 12 }),
        arp(T_B, B, [0, 2, 3, 4, 5, 4, 3, 2], { every: 2, len: 2, vel: 0.75, oct: 12 }),
        arp(T_A, A3, [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 2, 3, 4, 3], { every: 1, len: 2, vel: 0.62 }),
      ],
      lead: [mel(T_MEL_A, A), mel(T_MEL_A2, A2), mel(T_MEL_B, B, { vel: 1.05 }), mel(T_MEL_A, A3, { vel: 1.1 })],
      counter: [
        mel('r.16 | D5.16', 0, { inst: 'chime', vel: 0.9 }),
        mel(`D5.16 | ${rep(3, 'r.16 |')} A4.16 | ${rep(2, 'r.16 |')} r.16`, A, { inst: 'chime', vel: 0.7 }),
        mel(T_CTR_A, A2, { vel: 0.85 }),
        mel(T_CTR_B, B, { vel: 0.9 }),
        mel(T_CTR_A, A3, { vel: 0.95 }),
      ],
      perc: [
        grid(rep(8, 'X.........x.....'), 'kick', B, { vel: 0.5 }),
        grid(rep(8, '..g...g...g...g.'), 'shaker', B, { vel: 0.7 }),
        grid(rep(8, 'X.........x.....'), 'kick', A3, { vel: 0.6 }),
        grid(rep(8, '....x.......x...'), 'rim', A3, { vel: 0.7 }),
        grid(rep(8, 'g.g.o.g.g.g.o.g.'), 'shaker', A3, { vel: 0.7 }),
        grid('............xxXX', 'tom', A3 + bars(7), { vel: 0.5, rate: (p) => [1.3, 1.15, 1, 0.85][p - 12] }),
      ],
      fx: [
        [{ s: 0, p: 'swell', l: 16, v: 0.5 }, { s: 16, p: 'boom', l: 1, v: 1 }],
        [{ s: A3 - 16, p: 'swell', l: 16, v: 0.55 }, { s: A3, p: 'crash', l: 1, v: 0.5 }, { s: A3, p: 'boom', l: 1, v: 0.6 }],
      ],
    },
  };
}

// =================================================================================================
// CRYPT: "The Gauntlet". The arena and corridor theme: a driving square lead, a counter-line that
// moves when the lead holds, a harp arpeggio, and drums that go half-time in the B section.
// =================================================================================================
const C_A = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'];
const C_B = ['Bb', 'C', 'F', 'Dm', 'Bb', 'C', 'Eb', 'A'];
const C_MEL_A_HEAD = 'D5.3 D5.3 F5.2 A5.4 G5.2 F5.2 | E5.3 F5.3 E5.2 D5.8 | D5.3 F5.3 Bb5.2 A5.4 G5.2 F5.2 | G5.3 E5.3 C5.2 E5.8 | D5.3 D5.3 F5.2 A5.4 G5.2 F5.2 | A5.3 C6.3 A5.2 D6.8~';
const C_MEL_A = `${C_MEL_A_HEAD} | Bb5.3 A5.3 G5.2 D5.4 G5.4 | A5.3 G5.3 E5.2 C#5.8`;
const C_MEL_A2 = `${C_MEL_A_HEAD} | Bb5.3 A5.3 G5.2 Bb5.4 D6.4 | C#6.4 A5.4 E5.4 G5.4`;
const C_MEL_B = 'F5.6 G5.2 A5.8 | G5.6 E5.2 C5.8 | A5.6 C6.2 A5.4 F5.4 | A5.8 F5.4 D5.4 | F5.6 G5.2 A5.4 Bb5.4 | C6.6 Bb5.2 G5.8 | Bb5.4 G5.4 Eb5.4 G5.4 | A5.4 E5.4 C#5.4 E5.4';
const C_MEL_B2 = 'F5.6 G5.2 A5.8 | G5.6 E5.2 C5.8 | A5.6 C6.2 A5.4 F5.4 | A5.8 F5.4 D5.4 | F5.6 G5.2 A5.4 Bb5.4 | C6.6 Bb5.2 G5.8 | Bb5.4 G5.4 Eb5.4 G5.4 | A5.8 r.4 C#5.2 E5.2';
const C_CTR_A = 'D4.8 F4.8 | A4.8 C5.2 A4.2 F4.2 E4.2 | D4.8 F4.8 | G4.8 C5.2 G4.2 E4.2 G4.2 | D4.8 F4.8 | A4.8 D5.2 C5.2 A4.2 F4.2 | G4.8 Bb4.8 | A4.8 E5.2 C#5.2 A4.2 G4.2';
const C_CTR_B = 'D4.8 F4.2 A4.2 Bb4.2 D5.2 | E4.8 G4.2 C5.2 E5.2 G4.2 | F4.8 A4.8 | D4.8 F4.4 A4.4 | D4.8 F4.8 | E4.8 G4.2 C5.2 Bb4.2 G4.2 | Eb4.8 G4.8 | C#4.8 E4.8';
const ARP16 = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1];
const ARP16B = [1, 2, 3, 4, 3, 2, 3, 4, 5, 4, 3, 2, 3, 4, 3, 2];

function cryptSong() {
  const A = 0, B = bars(8), A2 = bars(16), B2 = bars(24);
  const secs = [[A, C_A], [B, C_B], [A2, C_A], [B2, C_B]];
  const drumA = { kick: 'X.....x.X.......', snare: '....X.......X...', hat: 'g.x.g.x.g.x.g.x.' };
  const drumB = { kick: 'X.........x.....', snare: '........X.......', hat: 'g.x.g.x.g.x.g.x.' };
  const drums = [];
  for (const [at, , half] of [[A], [B, 0, 1], [A2], [B2, 0, 1]]) {
    const P = half ? drumB : drumA;
    drums.push(grid(rep(8, P.kick), 'kick', at, { vel: 0.85 }));
    drums.push(grid(rep(7, P.snare) + ' ' + (half ? '........X...xxXX' : '....X.......xxXX'), 'snare', at, { vel: 0.75 }));
    drums.push(grid(rep(8, P.hat), 'hat', at, { vel: 0.8 }));
  }
  const perc = [];
  for (const [at] of secs) {
    perc.push(grid(rep(8, '.g.g.g.g.g.g.g.g'), 'hat', at, { vel: 0.7 }));
    perc.push(grid(rep(8, '..........x...x.'), 'kick', at, { vel: 0.6 }));
    perc.push(grid(rep(4, '................ ..............o.'), 'ohat', at, { vel: 0.7 }));
    perc.push(grid('X', 'crash', at, { vel: 0.7 }));
    perc.push(grid('........xxxxXXXX', 'tom', at + bars(7), { vel: 0.55, rate: (p) => 1.45 - (p - 8) * 0.08 }));
  }
  const bassA = (b) => [0, 0, 12, 0, 0, 12, 0, 7].map((iv, k) => [k * 2, iv, 2, k === 0 ? 1 : k % 2 ? 0.7 : 0.82]);
  const bassB = (b) => [0, 0, 12, 0, 7, 0, 12, 10].map((iv, k) => [k * 2, iv === 10 && b % 2 === 0 ? 7 : iv, 2, k === 0 ? 1 : k % 2 ? 0.7 : 0.82]);
  return {
    name: 'crypt', title: 'THE GAUNTLET', bpm: 132, gain: 1.12,
    form: [['A', 8], ['B', 8], ['A2', 8], ['B2', 8]],
    echoFb: 0.3,
    stems: {
      bed: { inst: I.pad, gain: 0.52, catchUp: true },
      bass: { inst: I.pbass, gain: 0.53 },
      lead: { inst: I.sqlead, gain: 0.85, pan: -0.06, echo: 0.2 },
      drums: { inst: I.kit, gain: 0.7 },
      counter: { inst: I.counter, gain: 0.57, pan: 0.32, echo: 0.12 },
      arp: { inst: I.harpHi, gain: 1.7, pan: -0.3, echo: 0.25 },
      perc: { inst: I.kit, gain: 0.75 },
      lead2: { inst: I.flute2, gain: 0.57, pan: 0.18, echo: 0.2 },
      chase: { inst: I.chug, gain: 0.7 },
      alarm: { inst: I.siren, gain: 0.55, pan: 0.15, echo: 0.15 },
    },
    parts: {
      bed: secs.map(([at, ch], i) => pads(ch, at, { vel: i % 2 ? 0.72 : 0.62 })),
      bass: [bassline(C_A, A, bassA), bassline(C_B, B, bassB), bassline(C_A, A2, bassA), bassline(C_B, B2, bassB)],
      lead: [mel(C_MEL_A, A), mel(C_MEL_B, B), mel(C_MEL_A2, A2), mel(C_MEL_B2, B2)],
      lead2: [mel(C_MEL_A, A, { shift: 12, vel: 0.8 }), mel(C_MEL_B, B, { shift: 12, vel: 0.8 }), mel(C_MEL_A2, A2, { shift: 12, vel: 0.8 }), mel(C_MEL_B2, B2, { shift: 12, vel: 0.8 })],
      counter: [mel(C_CTR_A, A), mel(C_CTR_B, B), mel(C_CTR_A, A2, { shift: 12, vel: 0.85 }), mel(C_CTR_B, B2)],
      arp: [arp(C_A, A, ARP16, { oct: 12 }), arp(C_B, B, ARP16B, { oct: 0 }), arp(C_A, A2, ARP16B, { oct: 12 }), arp(C_B, B2, ARP16, { oct: 0 })],
      drums,
      perc,
      chase: secs.map(([at, ch]) => bassline(ch, at, Array.from({ length: 16 }, (_, s) => [s, -12 + 12, 1, [0, 3, 6, 8, 11, 14].includes(s) ? 1 : 0.55]), { oct: 0 })),
      alarm: secs.map(([at, ch]) => {
        // two beats on, two off; a minor second that rubs against every chord
        const out = [];
        for (let b = 0; b < 8; b++) for (const [s, m] of [[0, 69], [2, 70], [4, 69], [6, 70]]) out.push({ s: at + b * 16 + s, p: m, l: 2, v: s === 0 ? 1 : 0.75 });
        return out;
      }),
    },
  };
}

// =================================================================================================
// WARDEN: "The Warden". Phrygian dread (Eb over D), an organ, tolling bells, a choir in phase II.
// =================================================================================================
const W_A = ['Dm', 'Eb', 'Dm', 'C', 'Dm', 'Eb', 'Bb', 'A'];
const W_B = ['Gm', 'Eb', 'Bb', 'A', 'Gm', 'Eb', 'C', 'A'];
const W_MEL_A = 'D5.4 A4.4 D5.4 F5.4 | Eb5.8 D5.4 Bb4.4 | A4.4 D5.4 F5.4 A5.4 | G5.8 E5.4 C5.4 | D5.4 A4.4 D5.4 F5.4 | G5.8 Bb5.4 G5.4 | F5.4 D5.4 Bb4.4 D5.4 | E5.8 C#5.8';
const W_MEL_A2 = 'D5.4 A4.4 D5.4 F5.4 | Eb5.8 D5.4 Bb4.4 | A4.4 D5.4 F5.4 A5.4 | G5.8 E5.4 C5.4 | D5.4 A4.4 D5.4 F5.4 | G5.8 Bb5.4 G5.4 | F5.4 D5.4 Bb4.4 D5.4 | E5.4 F5.4 E5.4 C#5.4';
const W_MEL_B = 'Bb5.6 A5.2 G5.8 | G5.6 F5.2 Eb5.8 | D5.6 F5.2 Bb5.8 | A5.16 | Bb5.6 A5.2 G5.4 D6.4 | C6.6 Bb5.2 G5.8 | G5.4 E5.4 C5.4 E5.4 | E5.8 C#5.4 A4.4';

function wardenSong() {
  const A = 0, B = bars(8), A2 = bars(16);
  const secs = [[A, W_A], [B, W_B], [A2, W_A]];
  const drums = [], perc = [];
  for (const [at, , i] of secs.map((x, k) => [...x, k])) {
    drums.push(grid(rep(8, i === 1 ? 'X..x..x.X..x..x.' : 'X..x....X.x.....'), 'kick', at, { vel: 0.85 }));
    drums.push(grid(rep(7, '....X.......X...') + ' ....X...xxxxXXXX', 'snare', at, { vel: 0.75 }));
    drums.push(grid(rep(8, 'x.g.x.g.x.g.x.g.'), 'hat', at, { vel: 0.75 }));
    perc.push(grid(rep(8, 'x.x.x.x.x.x.x.x.'), 'kick', at, { vel: 0.5 }));
    perc.push(grid('X', 'crash', at, { vel: 0.8 }));
    perc.push(grid(rep(3, '................ ') + '............xxXX', 'tom', at + bars(4), { vel: 0.6, rate: (p) => [1.3, 1.15, 1, 0.8][p - 12] }));
    perc.push(grid('........xxxxXXXX', 'tom', at + bars(7), { vel: 0.6, rate: (p) => 1.4 - (p - 8) * 0.08 }));
  }
  const bassPat = (b, c) => [[0, 0, 2, 1], [2, 0, 2, 0.6], [4, 12, 2, 0.8], [6, 0, 2, 0.6], [8, 0, 2, 0.9], [10, 0, 2, 0.6], [12, 12, 2, 0.8], [14, 1, 2, 0.7]];
  return {
    name: 'warden', title: 'THE WARDEN', bpm: 148,
    form: [['A', 8], ['B', 8], ['A2', 8]],
    echoFb: 0.28,
    stems: {
      intro: { inst: I.drone, gain: 0.8, catchUp: true, insts: { toll: I.toll, kit: I.kit } },
      organ: { inst: I.organ, gain: 0.54, catchUp: true },
      drums: { inst: I.kit, gain: 0.6 },
      bass: { inst: I.pbass, gain: 0.53 },
      lead: { inst: I.sawlead, gain: 1.35, pan: -0.05, echo: 0.2 },
      bell: { inst: I.toll, gain: 0.7, pan: 0.2, echo: 0.1 },
      arp: { inst: I.harpHi, gain: 1.3, pan: -0.3, echo: 0.22 },
      choir: { inst: I.choir, gain: 0.26, catchUp: true },
      lead2: { inst: I.flute2, gain: 0.53, pan: 0.2, echo: 0.2 },
      perc: { inst: I.kit, gain: 0.5 },
    },
    parts: {
      intro: [
        Array.from({ length: 24 }, (_, b) => [{ s: b * 16, p: 38, l: 16, v: 0.8 }, { s: b * 16, p: 45, l: 16, v: 0.55 }]).flat(),
        Array.from({ length: 6 }, (_, k) => ({ s: k * 64, p: 50, l: 32, v: 0.9, i: 'toll' })),
        Array.from({ length: 12 }, (_, k) => ({ s: k * 32 + 16, p: 'tom', l: 1, v: 0.5, r: 0.55, i: 'kit' })),
      ],
      organ: secs.map(([at, ch]) => pads(ch, at, { vel: 0.75, spread: 0.4 })),
      drums,
      perc,
      bass: secs.map(([at, ch]) => bassline(ch, at, bassPat, {})),
      lead: [mel(W_MEL_A, A), mel(W_MEL_B, B), mel(W_MEL_A2, A2)],
      lead2: [mel(W_MEL_A, A, { shift: 12, vel: 0.8 }), mel(W_MEL_B, B, { shift: 12, vel: 0.8 }), mel(W_MEL_A2, A2, { shift: 12, vel: 0.8 })],
      bell: secs.map(([at, ch]) => ch.map((c, b) => [{ s: at + b * 16, p: CH[c].root + 24, l: 8, v: 0.8 }, ...(b % 2 ? [{ s: at + b * 16 + 8, p: CH[c].root + 31, l: 8, v: 0.5 }] : [])]).flat()),
      arp: secs.map(([at, ch]) => arp(ch, at, [0, 2, 1, 3, 2, 4, 3, 1], { oct: 0, vel: 0.75 })),
      choir: secs.map(([at, ch]) => pads(ch, at, { vel: 0.8, spread: 0.6 }).map((e) => ({ ...e, p: e.p - 12 }))),
    },
  };
}

// =================================================================================================
// DIRGE: "Fallen". After death: the title's opening phrase, slowed and darkened, played once.
// =================================================================================================
function dirgeSong() {
  const ch = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Dm'];
  return {
    name: 'dirge', title: 'FALLEN', bpm: 72, loop: false, gain: 1.4,
    form: [['phrase', 6]],
    echoFb: 0.4,
    stems: {
      bed: { inst: I.padDark, gain: 0.6, catchUp: true },
      bass: { inst: I.tribass, gain: 0.34 },
      lead: { inst: I.flute, gain: 0.75, echo: 0.35 },
      counter: { inst: I.chime, gain: 0.8, pan: 0.25, echo: 0.3 },
      harp: { inst: I.harp, gain: 1.7, pan: 0.2, echo: 0.3 },
    },
    parts: {
      bed: [pads(ch.slice(0, 4), 0, { vel: 0.65 }), pads(['Dm'], bars(4), { vel: 0.6, len: 32 })],
      bass: [bassline(ch.slice(0, 4), 0, [[0, 0, 16, 0.8]]), [{ s: bars(4), p: 38, l: 32, v: 0.75 }]],
      lead: [mel('D5.6 E5.2 F5.4 A5.4 | G5.6 F5.2 D5.8 | Bb4.6 A4.2 G4.8 | E4.8 C#5.8 | D5.16 | r.16', 0, { vel: 0.85 })],
      counter: [mel('r.16 | r.16 | r.16 | r.16 | A5.16 | r.16', 0, { vel: 0.6 }), mel('r.16 | r.16 | r.16 | r.16 | D5.16 | r.16', 0, { vel: 0.7 })],
      harp: [arp(['Dm'], bars(4), [0, 1, 2, 3, 4, 5, 6, 5], { every: 2, len: 3, vel: 0.5 })],
    },
  };
}

const RAW = [titleSong(), cryptSong(), wardenSong(), dirgeSong()];
/** The compiled songs, by name: {name, title, bpm, steps, loop, loopStart, sections, stems, notes}. */
export const SONGS = Object.fromEntries(RAW.map((s) => [s.name, compile(s)]));
