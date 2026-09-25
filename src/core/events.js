// Tiny synchronous event bus shared by all pieces.
//
//   import { events } from './core/events.js';
//   const off = events.on('hit', (e) => ...);  events.emit('hit', { damage: 3 });  off();
//
// Events emitted by foundation:
//   'scene:enter'  { name, prev, data }      after a scene's enter()
//   'scene:exit'   { name, next }            before a scene's exit()
//   'pause'        { paused: boolean }
//   'input:press'  { action, device, tick }  every action press (after rebinding)
//   'input:device' { device }                'keyboard' | 'mouse' | 'gamepad' when it changes
//   'tick'         { tick }                  after every sim tick (cheap listeners only)
//   'feedback:shake' / 'feedback:flash'      see feedback.js

const handlers = new Map();

export const events = {
  on(name, fn) {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(fn);
    return () => handlers.get(name)?.delete(fn);
  },
  once(name, fn) {
    const off = this.on(name, (e) => { off(); fn(e); });
    return off;
  },
  off(name, fn) { handlers.get(name)?.delete(fn); },
  emit(name, payload) {
    const set = handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  },
};
