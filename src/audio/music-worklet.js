// The music synth (piece `audio`), running on the audio thread as an AudioWorkletProcessor.
//
// The main thread (music.js) sends the scores (songs.js, compiled to plain note lists) once, then
// only small control messages: which song, which stems are gated in, stem levels. Everything
// else happens here, sample-accurately: the sequencer, every voice, the drum kit and a tempo-synced
// ping-pong echo. A stalled main thread (scene loads, mesh builds) cannot drop or bunch a note.
//
// Every voice starts from zero amplitude and ends with an exponential release, oscillators are
// band-limited (polyBLEP pulse and saw), and every voice runs through its own lowpass, so nothing
// clicks and nothing fizzes up to 15 kHz.
//
// Messages in:  {type:'load', songs}            the compiled scores (see songs.js compile())
//               {type:'play', name, fade, from} crossfade to song `name` (null: fade to silence);
//                                               from: a section name or a step to start at
//               {type:'gates', map}             {stem: bool}: stems in / out at the next beat
//               {type:'level', stem, v}         a stem's level 0..1 (smoothed)
// Messages out: {type:'pos', song, bar, step, loop, section, rms:{stem: rms}, voices}   ~20x a second
//               {type:'ended', name}            a song with loop:false reached its end

const TAU = Math.PI * 2;
const SR = sampleRate;
const MAX_VOICES = 10;   // per stem (16 for plucked stems); stealing is rare and fades the oldest in 4 ms

function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// choir formants: [a1, a2, a3, weight] per band, for a TPT state-variable bandpass
const FORMANTS = new Float64Array(12);
[[650, 4, 1], [1080, 5, 0.6], [2500, 6, 0.22]].forEach(([fc, q, w], k) => {
  const g = Math.tan(Math.PI * fc / SR), kk = 1 / q, a1 = 1 / (1 + g * (g + kk));
  FORMANTS.set([a1, g * a1, g * g * a1, w], k * 4);
});
// the organ: one band-limited drawbar cycle, read with linear interpolation
const ORGAN = new Float32Array(2049);
for (let i = 0; i <= 2048; i++) {
  const a = TAU * i / 2048;
  ORGAN[i] = 0.6 * (Math.sin(a) + 0.5 * Math.sin(2 * a) + 0.28 * Math.sin(3 * a) + 0.2 * Math.sin(4 * a) + 0.08 * Math.sin(6 * a));
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// a one-pole time constant (seconds) as a per-sample coefficient
const coef = (tau) => (tau <= 0 ? 0 : Math.exp(-1 / (tau * SR)));

let seed = 0x9e3779b9;
function rnd() {   // xorshift32, -1..1
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
  return seed / 2147483648 - 1;
}

// ---- the tonal voice ----------------------------------------------------------------------------
// inst: { type: 'pulse'|'saw'|'tri'|'sine'|'organ'|'fm'|'pluck'|'choir', duty, uni, det,
//         a, d, s, r (seconds), cut, cutEnv, fd (filter env decay), res, velCut, key (cutoff tracks pitch 0..1),
//         vib (semitones), vibHz, vibDelay, glide (seconds), ratio, index (fm), decay (pluck T60), bright (pluck),
//         gain, drive }
class Voice {
  constructor(withPluck) {
    this.active = false;
    this.ks = withPluck ? new Float32Array(4096) : null;
    this.ph = new Float64Array(3);
    this.fst = new Float64Array(6);
  }
  start(inst, midi, vel, durS, pan) {
    this.inst = inst;
    this.active = true;
    this.vel = vel;
    this.f = mtof(midi); this.fCur = this.f; this.fFrom = this.f;
    this.glideK = 0;
    this.t = 0;
    this.offAt = Math.max(1, Math.round(durS * SR));
    this.stage = 0; this.env = 0;
    this.attInc = 1 / Math.max(1, (inst.a ?? 0.005) * SR);
    this.decK = coef((inst.d ?? 0.2) / 3);
    this.sus = inst.s ?? 0.7;
    this.relK = coef(Math.max(0.006, inst.r ?? 0.08) / 4);
    this.fenv = 1; this.fenvK = coef((inst.fd ?? 0.15) / 2);
    this.ic1 = 0; this.ic2 = 0; this.fst.fill(0);
    this.ph[0] = Math.random(); this.ph[1] = Math.random(); this.ph[2] = Math.random();
    this.mph = 0; this.vibM = 1;
    const p = Math.max(-1, Math.min(1, pan));
    this.gl = Math.cos((p + 1) * Math.PI / 4); this.gr = Math.sin((p + 1) * Math.PI / 4);
    this.g = (inst.gain ?? 1) * vel;
    this.cutBase = (inst.cut ?? 3000) * (1 + (inst.velCut ?? 0.6) * (vel - 0.8)) * Math.pow(this.f / 440, inst.key ?? 0.3);
    this.coefT = 0;
    if (inst.type === 'pluck') this.pluckInit(inst);
  }
  pluckInit(inst) {
    const buf = this.ks;
    this.w = 0;
    const N = Math.min(4000, Math.ceil(SR / this.f) + 4);
    let lp = 0;
    const b = Math.max(0.05, Math.min(0.98, (inst.bright ?? 0.5) * (0.7 + 0.4 * this.vel)));
    // the pick: noise, softened by brightness, with its DC removed
    let mean = 0;
    for (let i = 1; i <= N; i++) { lp += (rnd() - lp) * b; buf[(-i) & 4095] = lp; mean += lp; }
    mean /= N;
    for (let i = 1; i <= N; i++) buf[(-i) & 4095] -= mean;
    this.ksD = SR / this.f - 0.5;
    this.ksDamp = Math.pow(10, -3 / ((inst.decay ?? 1.2) * this.f));
  }
  /** Re-pitch a held mono voice (legato glide). */
  glideTo(midi, vel, durS) {
    this.fFrom = this.fCur; this.f = mtof(midi);
    this.glideK = coef((this.inst.glide ?? 0.05) / 3);
    this.offAt = this.t + Math.max(1, Math.round(durS * SR));
    this.vel = vel;
    if (this.stage === 2) this.stage = 1;
  }
  release() { if (this.stage < 2) { this.stage = 2; } }
  kill() { this.relK = coef(0.004); this.stage = 2; }
  /** Add n samples into L/R from offset o. */
  render(L, R, o, n) {
    const I = this.inst, type = I.type;
    const vib = I.vib ?? 0, vibHz = I.vibHz ?? 5.5, vibDel = (I.vibDelay ?? 0.2) * SR;
    const duty = I.duty ?? 0.5, uni = I.uni ?? 1, det = (I.det ?? 0) / 1200;
    const res = I.res ?? 0.7, cutEnv = I.cutEnv ?? 0, drive = I.drive ?? 0;
    for (let i = o; i < o + n; i++) {
      // envelope
      if (this.t === this.offAt && this.stage < 2) this.stage = 2;
      if (this.stage === 0) { this.env += this.attInc; if (this.env >= 1) { this.env = 1; this.stage = 1; } }
      else if (this.stage === 1) this.env = this.sus + (this.env - this.sus) * this.decK;
      else { this.env *= this.relK; if (this.env < 1e-4) { this.active = false; return; } }
      this.fenv *= this.fenvK;
      // pitch: glide and delayed vibrato
      if (this.glideK) { this.fCur = this.f + (this.fCur - this.f) * this.glideK; }
      let f = this.fCur;
      if (vib && this.t > vibDel) {
        if ((this.t & 15) === 0) {
          const k = Math.min(1, (this.t - vibDel) / (0.25 * SR));
          this.vibM = 1 + 0.0578 * vib * k * Math.sin(TAU * vibHz * this.t / SR);
        }
        f *= this.vibM;
      }
      const dt = f / SR;
      // oscillator
      let x = 0;
      if (type === 'pulse') {
        for (let u = 0; u < uni; u++) {
          const d2 = dt * (1 + det * (u - (uni - 1) / 2));
          let p = this.ph[u] + d2; if (p >= 1) p -= 1; this.ph[u] = p;
          let v = p < duty ? 1 : -1;
          v += polyblep(p, d2);
          let q = p - duty; if (q < 0) q += 1;
          v -= polyblep(q, d2);
          x += v - (2 * duty - 1);
        }
        x /= uni;
      } else if (type === 'saw' || type === 'choir') {
        for (let u = 0; u < uni; u++) {
          const d2 = dt * (1 + det * (u - (uni - 1) / 2));
          let p = this.ph[u] + d2; if (p >= 1) p -= 1; this.ph[u] = p;
          x += 2 * p - 1 - polyblep(p, d2);
        }
        x /= Math.sqrt(uni);
      } else if (type === 'tri') {
        let p = this.ph[0] + dt; if (p >= 1) p -= 1; this.ph[0] = p;
        x = 4 * Math.abs(p - 0.5) - 1;
      } else if (type === 'sine') {
        let p = this.ph[0] + dt; if (p >= 1) p -= 1; this.ph[0] = p;
        x = Math.sin(TAU * p);
      } else if (type === 'organ') {
        let p = this.ph[0] + dt; if (p >= 1) p -= 1; this.ph[0] = p;
        const fi = p * 2048, ii = fi | 0;
        x = ORGAN[ii] + (ORGAN[ii + 1] - ORGAN[ii]) * (fi - ii);
      } else if (type === 'fm') {
        let p = this.ph[0] + dt; if (p >= 1) p -= 1; this.ph[0] = p;
        let m = this.mph + dt * (I.ratio ?? 2); if (m >= 1) m -= 1; this.mph = m;
        const idx = (I.index ?? 1.5) * (0.35 + 0.65 * this.fenv) * (0.6 + 0.5 * this.vel);
        x = Math.sin(TAU * p + idx * Math.sin(TAU * m));
      } else if (type === 'pluck') {
        const buf = this.ks;
        const rp = this.w - this.ksD;
        const ri = Math.floor(rp), fr = rp - ri;
        const a0 = buf[ri & 4095], a1 = buf[(ri + 1) & 4095], b0 = buf[(ri - 1) & 4095];
        const s0 = a0 + (a1 - a0) * fr, s1 = b0 + (a0 - b0) * fr;
        x = (s0 + s1) * 0.5 * this.ksDamp;
        buf[this.w & 4095] = x;
        this.w++;
        x *= 1.6;
      }
      if (drive) x = Math.tanh(x * (1 + drive * 3)) / Math.tanh(1 + drive * 3);
      // filter: TPT state-variable (lowpass; choir uses three bandpasses as formants)
      if (type === 'choir') {
        // three fixed formant bandpasses ("ah"), coefficients computed once (FORMANTS)
        const st = this.fst;
        let y = 0;
        for (let k = 0; k < 3; k++) {
          const a1 = FORMANTS[k * 4], a2 = FORMANTS[k * 4 + 1], a3 = FORMANTS[k * 4 + 2];
          const s1 = st[k * 2], s2 = st[k * 2 + 1];
          const v3 = x - s2;
          const v1 = a1 * s1 + a2 * v3;
          const v2 = s2 + a2 * s1 + a3 * v3;
          st[k * 2] = 2 * v1 - s1 + 1e-20; st[k * 2 + 1] = 2 * v2 - s2;
          y += v1 * FORMANTS[k * 4 + 3];
        }
        x = y * 1.6;
      } else {
        if (--this.coefT <= 0) {
          this.coefT = 16;
          const fc = Math.min(SR * 0.45, Math.max(40, this.cutBase * (1 + cutEnv * this.fenv)));
          const g = Math.tan(Math.PI * fc / SR), kk = 1 / res;
          this.a1 = 1 / (1 + g * (g + kk)); this.a2 = g * this.a1; this.a3 = g * this.a2;
        }
        const v3 = x - this.ic2;
        const v1 = this.a1 * this.ic1 + this.a2 * v3;
        const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
        this.ic1 = 2 * v1 - this.ic1 + 1e-20; this.ic2 = 2 * v2 - this.ic2;
        x = v2;
      }
      const y = x * this.env * this.g;
      L[i] += y * this.gl; R[i] += y * this.gr;
      this.t++;
    }
  }
}

// ---- the drum kit -------------------------------------------------------------------------------
// One voice per hit; each piece is a few lines of synthesis. rate: pitch (toms), len: steps (swell).
class Drum {
  constructor() { this.active = false; }
  start(name, vel, rate, durS, pan) {
    this.name = name; this.active = true; this.t = 0; this.vel = vel; this.rate = rate || 1;
    this.dur = Math.max(0.05, durS) * SR;
    this.ph = 0; this.h1 = 0; this.h2 = 0; this.l1 = 0; this.l2 = 0; this.l3 = 0; this.x1 = 0;
    const p = Math.max(-1, Math.min(1, pan));
    this.gl = Math.cos((p + 1) * Math.PI / 4); this.gr = Math.sin((p + 1) * Math.PI / 4);
    this.rel = -1;
  }
  kill() { this.rel = 0; }
  render(L, R, o, n) {
    const nm = this.name, v = this.vel;
    for (let i = o; i < o + n; i++) {
      const t = this.t / SR;
      let y = 0;
      if (nm === 'kick') {
        const f = 48 + 120 * Math.exp(-t * 28);
        this.ph += f / SR;
        y = Math.sin(TAU * this.ph) * Math.exp(-t * 9) * 1.1;
        y = Math.tanh(y * 1.6) * 0.8;
        // the beater: a short, softened noise tick (low-passed, faded in over 1 ms: a thump, not a click)
        if (t < 0.008) { this.l3 += (rnd() - this.l3) * 0.3; y += this.l3 * 0.3 * Math.min(1, t / 0.001) * (1 - t / 0.008); }
        if (t > 0.45) { this.active = false; return; }
      } else if (nm === 'snare' || nm === 'rim') {
        const rim = nm === 'rim';
        const f = (rim ? 420 : 190) * this.rate * (1 + 0.4 * Math.exp(-t * 60));
        this.ph += f / SR;
        const tone = Math.sin(TAU * this.ph) * Math.exp(-t * (rim ? 60 : 30)) * (rim ? 0.5 : 0.45);
        // noise: highpassed, then softened
        const w = rnd();
        this.h1 += (w - this.h1) * 0.25;                 // ~2 kHz lowpass state
        const hp = w - this.h1;
        this.l1 += (hp - this.l1) * 0.6;                 // tame the top
        const nz = this.l1 * Math.exp(-t * (rim ? 70 : 18)) * (rim ? 0.25 : 0.6);
        y = (tone + nz) * Math.min(1, t / 0.0007);
        if (t > (rim ? 0.12 : 0.35)) { this.active = false; return; }
      } else if (nm === 'hat' || nm === 'ohat' || nm === 'shaker') {
        const w = rnd();
        this.h1 += (w - this.h1) * 0.55;
        let x = w - this.h1;                              // highpass ~6 kHz
        this.l1 += (x - this.l1) * 0.62;                  // lowpass ~10 kHz: no fizz above
        x = this.l1;
        const d = nm === 'hat' ? 55 : nm === 'ohat' ? 9 : 30;
        const att = nm === 'shaker' ? Math.min(1, t / 0.012) : 1;
        y = x * Math.exp(-t * d) * att * Math.min(1, t / 0.0007) * (nm === 'shaker' ? 0.45 : 0.5);
        if (t > (nm === 'ohat' ? 0.6 : 0.2)) { this.active = false; return; }
      } else if (nm === 'tom') {
        const f = (95 + 70 * Math.exp(-t * 14)) * this.rate;
        this.ph += f / SR;
        y = Math.sin(TAU * this.ph) * Math.exp(-t * 7) * 0.8;
        if (t < 0.01) { this.l3 += (rnd() - this.l3) * 0.3; y += this.l3 * 0.15 * Math.min(1, t / 0.001) * (1 - t / 0.01); }
        if (t > 0.6) { this.active = false; return; }
      } else if (nm === 'crash') {
        const w = rnd();
        this.h1 += (w - this.h1) * 0.4;
        let x = w - this.h1;
        this.l1 += (x - this.l1) * 0.55;
        y = this.l1 * Math.exp(-t * 2.6) * 0.45 * Math.min(1, t / 0.003);
        if (t > 2) { this.active = false; return; }
      } else if (nm === 'boom') {
        // a deep arrival: a falling sub thump with a dark rumble tail
        const f = 52 + 60 * Math.exp(-t * 7);
        this.ph += f / SR;
        const w = rnd();
        this.l1 += (w - this.l1) * 0.03; this.l2 += (this.l1 - this.l2) * 0.06;
        y = (Math.sin(TAU * this.ph) * 0.8 + this.l2 * 1.4) * Math.exp(-t * 3.2) * Math.min(1, t / 0.004);
        if (t > 2.5) { this.active = false; return; }
      } else if (nm === 'swell') {
        // a reversed-cymbal rise over the note's length: noise through an opening lowpass
        const k = Math.min(1, t * SR / this.dur);
        const w = rnd();
        const fc = 0.01 + 0.22 * k * k;   // opens to about 2 kHz: a rush of air, not a hiss
        this.l1 += (w - this.l1) * fc; this.l2 += (this.l1 - this.l2) * fc;
        // rises to the downbeat, then lets go over 20 ms (never stops at full level)
        const tail = Math.max(0, Math.min(1, (this.dur + 0.02 * SR - this.t) / (0.02 * SR)));
        y = this.l2 * Math.pow(k, 2.2) * 1.4 * tail;
        if (this.t >= this.dur + 0.02 * SR) { this.active = false; return; }
      }
      if (this.rel >= 0) { this.rel++; y *= Math.max(0, 1 - this.rel / (0.004 * SR)); if (this.rel > 0.004 * SR) { this.active = false; return; } }
      y *= v;
      L[i] += y * this.gl; R[i] += y * this.gr;
      this.t++;
    }
  }
}

// ---- a song being played ------------------------------------------------------------------------
class Player {
  constructor(song, gates, levels, fadeIn, from = 0) {
    this.song = song;
    this.stepLen = SR * 60 / song.bpm / 4;
    this.k = 0;                 // absolute step counter
    this.next = Math.round(SR * 0.02);   // samples until step k
    this.s = Math.max(0, Math.min(song.steps - 1, from | 0));   // song step of k
    this.loop = 0;
    this.gain = 0; this.target = song.gain ?? 1; this.gainK = coef(fadeIn);
    this.done = false; this.ending = false; this.idle = 0;
    this.stems = [];
    for (const [name, def] of Object.entries(song.stems)) {
      const want = !!gates[name];
      const isKit = def.inst.type === 'kit';
      const st = {
        name, def, events: song.notes[name] ?? [], idx: 0, loopIdx: 0,
        gate: want, want, lvl: want ? (levels[name] ?? 1) : 0, user: levels[name] ?? 1,
        L: new Float32Array(128), R: new Float32Array(128), rms: 0,
        voices: [], kit: isKit,
      };
      st.loopIdx = st.events.findIndex((e) => e.s >= song.loopStart); if (st.loopIdx < 0) st.loopIdx = st.events.length;
      st.idx = st.events.findIndex((e) => e.s >= this.s); if (st.idx < 0) st.idx = st.events.length;
      const usesPluck = def.inst.type === 'pluck' || Object.values(def.insts ?? {}).some((x) => x.type === 'pluck');
      const poly = def.poly ?? (usesPluck || isKit ? 16 : MAX_VOICES);
      for (let v = 0; v < poly; v++) st.voices.push(isKit ? new Drum() : new Voice(usesPluck));
      if (def.insts) st.drums = Array.from({ length: 4 }, () => new Drum());
      this.stems.push(st);
    }
    this.byName = Object.fromEntries(this.stems.map((s) => [s.name, s]));
    // echo: a ping-pong dotted eighth, darkened on every repeat
    this.eL = new Float32Array(SR * 2); this.eR = new Float32Array(SR * 2); this.ew = 0;
    this.eD = Math.min(SR * 2 - 1, Math.round(this.stepLen * 3));
    this.eLp = 0; this.eRp = 0;
    this.sendL = new Float32Array(128); this.sendR = new Float32Array(128);
  }
  setGates(map) { for (const [n, on] of Object.entries(map)) { const st = this.byName[n]; if (st) st.want = !!on; } }
  setLevel(n, v) { const st = this.byName[n]; if (st) st.user = v; }
  fadeOut(fade) { this.target = 0; this.gainK = coef(Math.max(0.05, fade) / 4); this.ending = true; }

  voiceFor(st, kit) {
    const pool = kit ? st.drums ?? st.voices : st.voices;
    let best = null, bestT = -1;
    for (const v of pool) { if (!v.active) return v; if (v.t > bestT) { bestT = v.t; best = v; } }
    st.stolen = (st.stolen ?? 0) + 1;
    best.kill();   // steal the oldest (it fades in 4 ms: the new one takes a fresh object below)
    // find another free slot by replacing the stolen voice object (keep the stolen one ringing out)
    const idx = pool.indexOf(best);
    const fresh = kit ? new Drum() : new Voice(!!best.ks);
    pool[idx] = fresh;
    (st.dying ??= []).push(best);
    return fresh;
  }

  trigger(st, e, remainSteps = null) {
    const def = st.def;
    const inst = e.i ? def.insts[e.i] : def.inst;
    const lenSteps = remainSteps ?? e.l;
    const durS = lenSteps * this.stepLen / SR * (inst.gate ?? 0.92);
    const pan = e.pan ?? def.pan ?? 0;
    const vel = e.v * (1 + rnd() * (def.human ?? 0.05));
    if (inst.type === 'kit') {
      const d = this.voiceFor(st, true);
      d.start(e.p, vel * (inst.gain ?? 1), e.r ?? 1, durS, pan + (inst.pans?.[e.p] ?? 0));
      return;
    }
    if (inst.mono) {
      let cur = null;
      for (const v of st.voices) if (v.active && (!cur || v.t < cur.t)) cur = v;
      if (cur && e.g) { cur.glideTo(e.p, vel, durS); return; }
      if (cur) cur.release();
    }
    const v = this.voiceFor(st, false);
    v.start(inst, e.p, vel, durS, pan);
    if (remainSteps != null) { v.env = 0; v.attInc = 1 / (0.25 * SR); }   // catching up: fade in
  }

  /** Bring wanted gates in on the beat. Sustained stems catch up on notes already sounding. */
  applyGates() {
    for (const st of this.stems) {
      if (st.want === st.gate) continue;
      st.gate = st.want;
      if (st.gate && st.def.catchUp) {
        for (const e of st.events) {
          if (e.s < this.s && e.s + e.l > this.s + 2) this.trigger(st, e, e.s + e.l - this.s);
        }
      }
      if (!st.gate) for (const v of st.voices) if (v.active && st.def.cutOnGate) v.release();
    }
  }

  step() {
    const song = this.song;
    if (this.s % 4 === 0 || this.k === 0) this.applyGates();
    for (const st of this.stems) {
      if (!st.gate) { // skip past this step's events
        while (st.idx < st.events.length && st.events[st.idx].s <= this.s) st.idx++;
        continue;
      }
      while (st.idx < st.events.length && st.events[st.idx].s <= this.s) {
        const e = st.events[st.idx++];
        if (e.s === this.s) this.trigger(st, e);
      }
    }
    this.k++;
    this.s++;
    if (this.s >= song.steps) {
      if (song.loop) {
        this.s = song.loopStart; this.loop++;
        for (const st of this.stems) st.idx = st.loopIdx;
      } else if (!this.ended) { this.ended = true; this.endedAt = 0; }
    }
  }

  /** Mix n samples into out L/R and echo sends from offset o. */
  render(oL, oR, o, n) {
    // sequencer
    let i = o;
    const end = o + n;
    while (i < end) {
      if (this.next <= 0 && !this.ended) { this.step(); this.next += this.stepLen; }
      const seg = this.ended ? end - i : Math.min(end - i, Math.max(1, Math.ceil(this.next)));
      for (const st of this.stems) {
        for (const v of st.voices) if (v.active) v.render(st.L, st.R, i, seg);
        if (st.drums) for (const v of st.drums) if (v.active) v.render(st.L, st.R, i, seg);
        if (st.dying) { for (const v of st.dying) if (v.active) v.render(st.L, st.R, i, seg); st.dying = st.dying.filter((v) => v.active); if (!st.dying.length) st.dying = null; }
      }
      this.next -= seg;
      i += seg;
    }
    // stems -> mix (level smoothing per sample: in quickly on the beat, out slowly)
    let active = 0;
    for (const st of this.stems) {
      const tgt = st.gate ? st.user : 0;
      // a silent stem (out, faded, nothing ringing) costs nothing
      if (!st.gate && st.lvl < 1e-5 && !st.voices.some((v) => v.active) && !st.dying && !(st.drums && st.drums.some((v) => v.active))) { st.rms *= 0.8; continue; }
      const k = tgt > st.lvl ? 0.9995 : 0.99993;
      const g = st.def.gain ?? 1, echo = st.def.echo ?? 0;
      let sum = 0;
      for (let j = o; j < end; j++) {
        st.lvl = tgt + (st.lvl - tgt) * k;
        const a = st.L[j] * st.lvl * g, b = st.R[j] * st.lvl * g;
        oL[j] += a; oR[j] += b;
        if (echo) { this.sendL[j] += a * echo; this.sendR[j] += b * echo; }
        sum += a * a + b * b;
        st.L[j] = 0; st.R[j] = 0;
      }
      st.rms = st.rms * 0.8 + 0.2 * Math.sqrt(sum / (2 * n));
      for (const v of st.voices) if (v.active) active++;
      if (st.drums) for (const v of st.drums) if (v.active) active++;
    }
    this.active = active;
    // echo
    const ws = this.eL.length, fb = this.song.echoFb ?? 0.32, lpk = 0.35;
    for (let j = o; j < end; j++) {
      const r = (this.ew - this.eD + ws) % ws;
      const dl = this.eL[r], dr = this.eR[r];
      this.eLp += (dl - this.eLp) * lpk; this.eRp += (dr - this.eRp) * lpk;
      // ping-pong: the left input feeds the right line and back
      this.eL[this.ew] = this.sendR[j] + this.eRp * fb;
      this.eR[this.ew] = this.sendL[j] + this.eLp * fb;
      oL[j] += this.eLp * 0.55; oR[j] += this.eRp * 0.55;
      this.sendL[j] = 0; this.sendR[j] = 0;
      this.ew = (this.ew + 1) % ws;
    }
  }
}

class MusicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.songs = {};
    this.players = [];
    this.gates = {};
    this.levels = {};
    this.mixL = new Float32Array(128); this.mixR = new Float32Array(128);
    this.report = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }
  current() { const p = this.players[this.players.length - 1]; return p && !p.ending ? p : null; }
  onMsg(m) {
    if (m.type === 'load') this.songs = m.songs;
    else if (m.type === 'play') {
      const cur = this.current();
      if (cur && cur.song.name === m.name && !m.restart) return;
      if (cur) cur.fadeOut(m.fade ?? 1.2);
      const song = this.songs[m.name];
      const from = typeof m.from === 'string' ? song?.sections.find((x) => x.name === m.from)?.at ?? 0 : m.from ?? 0;
      if (song) this.players.push(new Player(song, this.gates, this.levels, cur ? Math.max(0.05, (m.fade ?? 1.2) / 6) : 0.01, from));
    } else if (m.type === 'gates') {
      Object.assign(this.gates, m.map);
      this.current()?.setGates(m.map);
    } else if (m.type === 'level') {
      this.levels[m.stem] = m.v;
      this.current()?.setLevel(m.stem, m.v);
    } else if (m.type === 'stop') {
      for (const p of this.players) p.fadeOut(m.fade ?? 1.2);
    }
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    const n = L.length;
    const mL = this.mixL, mR = this.mixR;
    mL.fill(0, 0, n); mR.fill(0, 0, n);
    for (const p of this.players) {
      const tL = p.tmpL ??= new Float32Array(128), tR = p.tmpR ??= new Float32Array(128);
      tL.fill(0, 0, n); tR.fill(0, 0, n);
      p.render(tL, tR, 0, n);
      for (let j = 0; j < n; j++) {
        p.gain = p.target + (p.gain - p.target) * p.gainK;
        mL[j] += tL[j] * p.gain; mR[j] += tR[j] * p.gain;
      }
      if (p.ended) { p.endedAt += n; if (!p.endedReported) { p.endedReported = true; this.port.postMessage({ type: 'ended', name: p.song.name }); } }
      // a finished song (faded out, or played to its end and rung out) is dropped
      if ((p.ending && p.gain < 1e-4) || (p.ended && p.endedAt > SR * 6)) p.done = true;
    }
    if (this.players.some((p) => p.done)) this.players = this.players.filter((p) => !p.done);
    L.set(mL.subarray(0, n));
    if (R !== L) R.set(mR.subarray(0, n));
    // report position and stem levels ~20 times a second
    this.report += n;
    if (this.report >= 2048) {
      this.report = 0;
      const p = this.current() ?? this.players[this.players.length - 1];
      if (p) {
        const s = Math.max(0, p.s - 1);
        const sec = p.song.sections?.findLast?.((x) => x.at <= s) ?? null;
        this.port.postMessage({
          type: 'pos', song: p.song.name, step: s % 16, bar: Math.floor(s / 16), loop: p.loop,
          section: sec?.name ?? '', ended: !!p.ended,
          rms: Object.fromEntries(p.stems.map((st) => [st.name, st.rms])),
          gates: Object.fromEntries(p.stems.map((st) => [st.name, st.gate ? +st.lvl.toFixed(2) : 0])),
          voices: p.active ?? 0, players: this.players.length,
        });
      } else this.port.postMessage({ type: 'pos', song: null, players: 0 });
    }
    return true;
  }
}

registerProcessor('gr-music', MusicProcessor);
