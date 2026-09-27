// The audio piece's entry point. Importing this once (main.js does, see its header) is enough:
// it pulls in the SFX bank and the music engine for their event-listener side effects, and
// registers the `debug.audio` hooks.
//
//   window.__GR.debug.audio.state()             mixer + music status
//   window.__GR.debug.audio.music(name, i)       force a track / intensity (for scripted tests)
//   window.__GR.debug.audio.stopMusic()
//   window.__GR.debug.audio.stream()             MediaStream of the finished mix (critic capture)

import { debug } from '../core/debug.js';
import { mixer } from './mixer.js';
import { music } from './music.js';
import './bank.js';

debug.add('audio', {
  state: () => ({ ...mixer.state(), music: { track: music.trackName, intensity: +music.intensity.toFixed(3), target: +music.target.toFixed(3) } }),
  music: (name, intensity) => { if (name) music.play(name, { intensity }); return { track: music.trackName, intensity: music.intensity }; },
  stopMusic: () => { music.stop(); return true; },
  stream: () => mixer.masterStream(),
});
