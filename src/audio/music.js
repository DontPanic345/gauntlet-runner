// Music (piece `audio`): the main-thread side. The scores live in songs.js; the synth and the
// sequencer run on the audio thread (music-worklet.js), so a stalled frame never drops a note.
// This module only says which song plays, which stems are in, and at what level.
//
//   import { music, SONGS } from './audio/music.js';
//   music.play('title' | 'crypt' | 'warden' | 'dirge' | null, { fade })   // crossfade; same song = no-op
//   music.want({ lead: true, drums: false })   // stems in / out (applied on the next beat)
//   music.only(['bed', 'lead', 'bass'])        // exactly these stems
//   music.level('alarm', 0..1)                 // continuous stem level (smoothed)
//   music.filter('normal' | 'lowhp' | 'pause' | 'dead')
//   music.onEnd(fn(name))                      // a song with loop:false (the dirge) finished
//
// Songs (all D minor; see songs.js for the forms):
//   title  "Beneath the Mountain"  84 BPM  bed, bass, harp, lead, counter, perc, fx
//   crypt  "The Gauntlet"         132 BPM  bed, bass, lead, drums, counter, arp, perc, lead2 (arena)
//                                          chase, alarm (corridor)
//   warden "The Warden"           148 BPM  intro, organ, drums, bass, lead, bell, arp, choir, lead2, perc
//   dirge  "Fallen"                72 BPM  bed, bass, lead, counter, harp (once, after death)

import { audio } from './engine.js';
import { SONGS } from './songs.js';

export { SONGS };

let node = null;
let failed = null;
let wantedSong = null;
let wantedFade = 1.2;
let wantedFrom = 0;
let playing = null;            // the song the worklet was last told to play
const stems = {};              // stem -> on (persists across songs; stems share names)
const levels = {};             // stem -> 0..1
let pos = { song: null };      // the worklet's last report
const endFns = new Set();
const state = { intensity: 0, chase: false };
let filterMode = 'normal';

const FILTERS = { normal: [20000, 0.7], lowhp: [950, 1.6], pause: [520, 0.9], dead: [260, 0.7] };

const send = (m) => { if (node) node.port.postMessage(m); };

async function start(c) {
  if (node || failed) return;
  try {
    await c.audioWorklet.addModule(new URL('./music-worklet.js', import.meta.url));
    node = new AudioWorkletNode(c, 'gr-music', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(audio.bus('music'));
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'pos') pos = m;
      else if (m.type === 'ended') for (const fn of [...endFns]) { try { fn(m.name); } catch (err) { console.error(err); } }
    };
    node.port.postMessage({ type: 'load', songs: SONGS });
    node.port.postMessage({ type: 'gates', map: { ...stems } });
    for (const [sn, v] of Object.entries(levels)) node.port.postMessage({ type: 'level', stem: sn, v });
    if (wantedSong) { playing = null; music.play(wantedSong, { fade: wantedFade, from: wantedFrom }); }
  } catch (err) {
    failed = String(err?.message ?? err);
    console.warn('music: AudioWorklet unavailable, music is off:', failed);
  }
}
audio.onUnlock(start);

export const music = {
  get song() { return playing; },
  /** Informational: the director's combat intensity (layers are chosen by the director). */
  get intensity() { return state.intensity; },
  set intensity(v) { state.intensity = Math.max(0, Math.min(1, v)); },
  get chase() { return state.chase; },
  set chase(v) { state.chase = !!v; },
  /**
   * Switch songs with a crossfade. null fades to silence. restart: replay the same song.
   * from: start at a section name ('B') or a 16th step instead of the top (sound board, tests).
   */
  play(name, { fade = 1.2, restart = false, from = 0 } = {}) {
    if (name && !SONGS[name]) name = null;
    wantedSong = name; wantedFade = fade; wantedFrom = from;
    if (!node) return;
    if (name === playing && !restart) return;
    playing = name;
    if (name) send({ type: 'play', name, fade, restart, from });
    else send({ type: 'stop', fade });
  },
  stop(fade = 1.2) { music.play(null, { fade }); },
  /** Which stems should be playing. Stems not named keep their state. */
  want(map) {
    const diff = {};
    for (const [sn, on] of Object.entries(map)) if (stems[sn] !== !!on) { stems[sn] = !!on; diff[sn] = !!on; }
    if (Object.keys(diff).length) send({ type: 'gates', map: diff });
  },
  /** Exactly these stems (all others off). */
  only(list) {
    const names = new Set([...Object.keys(stems), ...list]);
    for (const s of Object.values(SONGS)) for (const sn of Object.keys(s.stems)) names.add(sn);
    const map = {};
    for (const sn of names) map[sn] = list.includes(sn);
    music.want(map);
  },
  level(sn, v) {
    v = Math.max(0, Math.min(1, v));
    if (levels[sn] !== undefined && Math.abs(levels[sn] - v) < 0.01) return;
    levels[sn] = v;
    send({ type: 'level', stem: sn, v });
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
  onEnd(fn) { endFns.add(fn); return () => endFns.delete(fn); },
  /** Length of one pass of a song in seconds (the intro included). */
  lengthOf(name) { const s = SONGS[name]; return s ? s.steps * 60 / s.bpm / 4 : 0; },
  info() {
    const s = playing ? SONGS[playing] : null;
    return {
      song: playing, wanted: wantedSong, bpm: s?.bpm ?? null,
      bar: pos.song === playing ? pos.bar ?? null : null, step: pos.song === playing ? pos.step ?? null : null,
      bars: s ? s.steps / 16 : null, section: pos.song === playing ? pos.section : '', loop: pos.loop ?? 0,
      intensity: +state.intensity.toFixed(2), chase: state.chase, filter: filterMode,
      stems: s ? Object.fromEntries(Object.keys(s.stems).map((k) => [k, stems[k] ? +(levels[k] ?? 1).toFixed(2) : 0])) : {},
      live: pos.gates ?? {}, voices: pos.voices ?? 0, players: pos.players ?? 0,
      engine: node ? 'worklet' : failed ? `off (${failed})` : 'waiting', skipped: 0,
    };
  },
  /** Live RMS of each stem of the current song (0..1), for meters. */
  meters() { return pos.song === playing ? { ...(pos.rms ?? {}) } : {}; },
  /** Stem names of a song. */
  stemsOf: (name) => Object.keys(SONGS[name]?.stems ?? {}),
};
// re-apply the filter once the graph exists
audio.onUnlock(() => { const m = filterMode; filterMode = 'normal'; if (m !== 'normal') music.filter(m); });
