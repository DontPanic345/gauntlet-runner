// The one screen-shake / flash / hitstop channel (GAME.md feel rules: "Screen shake and
// flashes go through one settings-scaled channel"). Nobody moves the camera for shake or
// paints full-screen flashes any other way.
//
//   feedback.shake(strength, ms)      strength in internal pixels (2 = small kick, 6 = big)
//   feedback.kick(dx, dz, strength)   directional screen kick, e.g. along a hit direction
//   feedback.flash(color, ms, alpha)  full-screen palette-colour flash, fades out
//   feedback.hitstop(ms)              freeze the sim (delegates to loop.hitstop)
//
// display.js reads feedback.offset() (integer pixels) and feedback.flashState() each frame.
// Shake decays in real time so it still reads during hitstop.

import { settings } from './settings.js';
import { loop } from './loop.js';
import { events } from './events.js';

let trauma = 0;        // current shake amplitude, px
let traumaMs = 1;
let traumaLeft = 0;
let kickX = 0, kickY = 0;
let flashColor = 'white', flashAlpha = 0, flashMs = 1, flashLeft = 0;
let seed = 1;
const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };

export const feedback = {
  shake(strength, ms = 160) {
    const s = strength * settings.get('shake');
    if (s <= 0) return;
    if (s >= trauma * (traumaLeft / traumaMs)) { trauma = s; traumaMs = ms; traumaLeft = ms; }
    events.emit('feedback:shake', { strength: s, ms });
  },
  /** Directional kick in screen space: (dx, dy) is a direction, strength in px. */
  kick(dx, dy, strength = 2) {
    const l = Math.hypot(dx, dy) || 1;
    const s = strength * settings.get('shake');
    kickX += (dx / l) * s; kickY += (dy / l) * s;
  },
  flash(color = 'white', ms = 80, alpha = 0.6) {
    const a = alpha * settings.get('flashes');
    if (a <= 0) return;
    flashColor = color; flashAlpha = a; flashMs = ms; flashLeft = ms;
    events.emit('feedback:flash', { color, ms, alpha: a });
  },
  hitstop(ms) { loop.hitstop(ms); },

  /** Advance decay. Called by display once per rendered frame with real dt (s). */
  update(realDt) {
    const ms = realDt * 1000;
    traumaLeft = Math.max(0, traumaLeft - ms);
    flashLeft = Math.max(0, flashLeft - ms);
    const k = Math.pow(0.001, realDt * 6); // kick springs back in ~150 ms
    kickX *= k; kickY *= k;
    if (Math.abs(kickX) < 0.05) kickX = 0;
    if (Math.abs(kickY) < 0.05) kickY = 0;
  },
  /** Integer pixel camera offset for this frame. */
  offset() {
    const t = traumaLeft / traumaMs;
    const amp = trauma * t * t;
    return { x: Math.round(noise() * amp + kickX), y: Math.round(noise() * amp + kickY) };
  },
  flashState() {
    return flashLeft > 0 ? { color: flashColor, alpha: flashAlpha * (flashLeft / flashMs) } : null;
  },
};
