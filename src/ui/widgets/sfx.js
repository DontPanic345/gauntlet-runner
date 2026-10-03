// HUD sounds (piece `hud`), synthesised in WebAudio: only the low-health heartbeat, a soft
// low thump (lub) and a smaller one (dub), felt more than heard. Nothing else in the HUD makes
// sound: shards, hearts and boons already have theirs (boons piece).
// The AudioContext is created lazily, and only after a user gesture (no autoplay warning).
// Volume: settings masterVolume * sfxVolume. `hudSfx.enabled = false` when `audio` takes over.

import { settings } from '../../core/settings.js';
import { audioContext, legacyBus, legacyVol } from '../../audio/engine.js';

let ctx = null, out = null;

function ac() {
  if (!hudSfx.enabled) return null;
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    ctx = audioContext(); if (!ctx) return null;   // shared context + mixer (src/audio)
    out = ctx.createGain();
    out.connect(legacyBus('hud'));
  } catch { ctx = null; return null; }
  return ctx;
}

const vol = () => legacyVol();   // the mixer applies the settings volumes

function thump(c, t, f0, f1, peak, dur) {
  const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  lp.type = 'lowpass'; lp.frequency.value = 180;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp).connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

export const hudSfx = {
  enabled: true,
  /** One heartbeat thump. big: the lub; otherwise the dub. */
  beat(big = true) {
    const c = ac();
    if (!c) return;
    const v = vol() * 0.55;
    if (v <= 0) return;
    const t = c.currentTime + 0.005;
    if (big) thump(c, t, 72, 38, v * 0.9, 0.16);
    else thump(c, t, 64, 36, v * 0.55, 0.12);
  },
};
