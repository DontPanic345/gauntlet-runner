// Audio piece entry point: import once from main.js. Sets up the mixer, the SFX bank, the music,
// the ambience and the director, and registers the debug hooks.
//
//   __GR.debug.audio()                         info: context, mixer, music, director, recent plays, meter
//   __GR.debug.audio('play', name, opts)       play a bank sound ('hit.heavy', 'step.wet', ...)
//   __GR.debug.audio('music', song)            'title' | 'crypt' | 'warden' | null
//   __GR.debug.audio('stems', ['bed', ...])    exactly these stems
//   __GR.debug.audio('intensity', 0..1)        also: 'filter', mode; 'level', stem, v; 'duck', db, hold; 'amb', {wind, crackle, drip, debris}
//   __GR.debug.audio('record', ms)             -> Promise {ok, mime, bytes, b64}: MediaRecorder on the master bus
//   __GR.debug.audio('wav', ms)                -> Promise {ok, sampleRate, b64}: lossless 16-bit WAV of the master bus
//   __GR.debug.audio('unlock')                 create the context without a gesture (headless capture)
//   __GR.debug.audioStream()                   the master bus as a MediaStream (bring your own MediaRecorder)

import { audio } from './engine.js';
import { sfx } from './bank.js';
import { music } from './music.js';
import { ambience } from './ambience.js';
import { director } from './director.js';
import { debug } from '../core/debug.js';

function info() {
  const c = audio.ctx;
  const m = audio.meter();
  return {
    ok: true,
    unlocked: audio.unlocked, state: c?.state ?? 'none', sampleRate: c?.sampleRate ?? null, time: c ? +c.currentTime.toFixed(2) : 0,
    music: music.info(), director: director.info(), ambience: ambience.info(), sfx: sfx.info(),
    meter: { peak: +m.peak.toFixed(3), rms: +m.rms.toFixed(3) },
    duck: audio.graph ? +audio.graph.musicDuck.gain.value.toFixed(3) : 1,
  };
}

debug.add('audio', (action, a, b) => {
  switch (action) {
    case undefined: case 'info': return info();
    case 'unlock': audio.ensure(true); return { ok: !!audio.ctx, state: audio.ctx?.state };
    case 'play': audio.ensure(true); return { ok: sfx.play(a, b ?? {}) };
    case 'shard': return { ok: sfx.shard(a ?? 0) };
    case 'step': return { ok: sfx.step(a, b) };
    case 'music': audio.ensure(true); music.play(a ?? null); return { ok: true, song: a ?? null };
    case 'stems': music.only(a ?? []); return { ok: true };
    case 'intensity': music.intensity = a; return { ok: true };
    case 'level': music.level(a, b); return { ok: true };
    case 'filter': music.filter(a); return { ok: true };
    case 'duck': audio.duck(a ?? 6, b ?? 0.5); return { ok: true };
    case 'mode': director.enterMode(a); return { ok: true };
    case 'amb': ambience.set(a ?? {}); return { ok: true, ambience: ambience.info() };
    case 'record': return audio.record(a ?? 5000);
    case 'wav': return audio.recordWav(a ?? 5000);
    case 'names': return sfx.names();
    default: return { ok: false, error: `unknown audio action "${action}"` };
  }
});
debug.add('audioStream', () => audio.stream());

export { audio, sfx, music, ambience, director };
