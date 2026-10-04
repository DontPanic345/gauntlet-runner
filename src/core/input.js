// Input layer: keyboard, mouse and gamepad -> named actions, via one rebinding table.
//
// Two consumers read input at different rates, and each sees every press exactly once:
//   - the sim, per tick:   input.pressed(a), input.held(a), input.buffered(a), input.consume(a), input.move()
//   - UI/menus, per frame: input.ui.pressed(a), input.ui.key(code)   (works while paused)
// Raw events are queued with timestamps, so a press+release inside one frame is never lost.
//
// Buffering: attack and dash stay "buffered" for BUFFER_TICKS sim ticks (about 120 ms)
// after the press until consumed. Hitstop and pause do not age the buffer (it counts ticks).
//
// Codes: keyboard uses KeyboardEvent.code ('KeyJ', 'Space', 'ArrowUp'); mouse buttons are
// 'Mouse0' (left), 'Mouse1' (middle), 'Mouse2' (right); gamepad buttons use the standard
// mapping as 'Pad0'..'Pad16' (Pad0 = A/cross, Pad2 = X/square, Pad9 = Start), and the left
// stick doubles as 'PadLeft' / 'PadRight' / 'PadUp' / 'PadDown' digital codes.

import { events } from './events.js';

export const BUFFER_TICKS = 7; // 7 / 60 s = 117 ms
const BUFFERED_ACTIONS = new Set(['attack', 'dash', 'interact']);
const STICK_DEADZONE = 0.22;
const MOUSE_IDLE_MS = 2000; // GAME.md: no mouse movement for 2 s -> aim along facing
const STORE_KEY = 'gr.bindings.v1';

export const DEFAULT_BINDINGS = {
  up: ['KeyW', 'ArrowUp', 'PadUp', 'Pad12'],
  down: ['KeyS', 'ArrowDown', 'PadDown', 'Pad13'],
  left: ['KeyA', 'ArrowLeft', 'PadLeft', 'Pad14'],
  right: ['KeyD', 'ArrowRight', 'PadRight', 'Pad15'],
  attack: ['KeyJ', 'Mouse0', 'Pad2'],
  dash: ['KeyK', 'Space', 'Mouse2', 'Pad0'],
  interact: ['KeyE', 'Pad3'],
  pause: ['Escape', 'KeyP', 'Pad9'],
  confirm: ['Enter', 'NumpadEnter', 'Pad0'],
  cancel: ['Escape', 'Backspace', 'Pad1'],
};

export const ACTIONS = Object.keys(DEFAULT_BINDINGS);

// Short human labels for codes (key display in menus and overlays).
const PAD_NAMES = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'SELECT', 9: 'START',
  10: 'LS', 11: 'RS', 12: 'DPAD UP', 13: 'DPAD DOWN', 14: 'DPAD LEFT', 15: 'DPAD RIGHT', 16: 'HOME' };
export function codeLabel(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Mouse2') return 'RMB';
  if (code.startsWith('Pad') && /^Pad\d+$/.test(code)) return 'PAD ' + PAD_NAMES[code.slice(3)];
  if (code.startsWith('Pad')) return 'STICK ' + code.slice(3).toUpperCase();
  if (code === 'Escape') return 'ESC';
  return code.toUpperCase();
}

function deviceOf(code) {
  if (code.startsWith('Mouse')) return 'mouse';
  if (code.startsWith('Pad')) return 'gamepad';
  return 'keyboard';
}

function loadBindings() {
  const b = structuredClone(DEFAULT_BINDINGS);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const a of ACTIONS) if (Array.isArray(saved[a])) b[a] = saved[a].filter((c) => typeof c === 'string');
    }
  } catch { /* storage blocked or corrupt: defaults */ }
  return b;
}

const codesDown = new Set();
let simQueue = [];
let uiQueue = [];
let tick = 0;

const tickPressed = new Set();
const tickReleased = new Set();
const bufferedUntil = {};      // action -> tick until which a press stays buffered
const bufferedAt = {};         // action -> tick of the buffered press
const pressTime = {};          // action -> event timestamp (ms) of the latest press
const uiPressed = new Set();
const uiCounts = new Map();     // action -> presses this frame (two fast taps in one frame count twice)
const uiKeys = new Set();
const injected = new Set();    // actions held by input.inject()
const stick = { x: 0, z: 0 };
const padPrev = [];
let stickDigital = { PadLeft: false, PadRight: false, PadUp: false, PadDown: false };

export const input = {
  bindings: loadBindings(),
  device: 'keyboard',
  gamepadConnected: false,
  /** Mouse in CSS px, and normalised -1..1 over the canvas (y down). lastMove is performance.now() ms. */
  mouse: { x: 0, y: 0, nx: 0, ny: 0, lastMove: -1e9, inside: false },
  /** Latest raw events for overlays: [{code, down, t}] newest last, capped. */
  recent: [],

  attach(target = window) {
    addEventListener('keydown', (e) => {
      if (e.repeat) { if (isGameKey(e.code)) e.preventDefault(); return; }
      if (isGameKey(e.code)) e.preventDefault();
      push(e.code, true, e.timeStamp);
    });
    addEventListener('keyup', (e) => push(e.code, false, e.timeStamp));
    target.addEventListener('mousedown', (e) => { push('Mouse' + e.button, true, e.timeStamp); e.preventDefault(); });
    addEventListener('mouseup', (e) => push('Mouse' + e.button, false, e.timeStamp));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      const m = input.mouse;
      if (e.movementX === 0 && e.movementY === 0 && m.x === e.clientX && m.y === e.clientY) return;
      m.x = e.clientX; m.y = e.clientY;
      m.nx = (e.clientX / innerWidth) * 2 - 1;
      m.ny = (e.clientY / innerHeight) * 2 - 1;
      m.lastMove = e.timeStamp;
      m.inside = true;
      setDevice('mouse');
    });
    document.addEventListener('mouseleave', () => { input.mouse.inside = false; });
    addEventListener('blur', () => releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
    addEventListener('gamepadconnected', () => { input.gamepadConnected = true; });
    addEventListener('gamepaddisconnected', () => { input.gamepadConnected = navigator.getGamepads?.().some(Boolean) ?? false; });
  },

  // ---- per-frame (UI) ----------------------------------------------------------------

  /** Call once per rendered frame, before UI code. Polls the gamepad. */
  beginFrame() {
    pollGamepad();
    uiPressed.clear();
    uiKeys.clear();
    uiCounts.clear();
    for (const ev of uiQueue) {
      if (!ev.down) continue;
      uiKeys.add(ev.code);
      for (const a of actionsFor(ev.code)) { uiPressed.add(a); uiCounts.set(a, (uiCounts.get(a) ?? 0) + 1); }
    }
    uiQueue = [];
  },

  ui: {
    /** Action pressed since the last frame (menus, pause screen). */
    pressed: (action) => uiPressed.has(action),
    /** Raw code pressed since the last frame (debug/showcase keys outside the bindings table). */
    key: (code) => uiKeys.has(code),
    /** How many times the action was pressed since the last frame (menus step once per press). */
    count: (action) => uiCounts.get(action) ?? 0,
  },

  // ---- per-tick (sim) ----------------------------------------------------------------

  /** Call at the start of every sim tick. */
  beginTick(t) {
    tick = t;
    tickPressed.clear();
    tickReleased.clear();
    for (const ev of simQueue) {
      for (const a of actionsFor(ev.code)) {
        if (ev.down) {
          tickPressed.add(a);
          pressTime[a] = ev.t;
          if (BUFFERED_ACTIONS.has(a)) { bufferedUntil[a] = tick + BUFFER_TICKS; bufferedAt[a] = tick; }
          events.emit('input:press', { action: a, device: deviceOf(ev.code), code: ev.code, tick, t: ev.t });
        } else if (!input.held(a)) tickReleased.add(a);
      }
    }
    simQueue = [];
  },

  /** Pressed during this tick (edge). */
  pressed: (action) => tickPressed.has(action),
  /** Released during this tick (edge). */
  released: (action) => tickReleased.has(action),
  /** Currently held (any bound code, the stick, or an injected hold). */
  held(action) {
    if (injected.has(action)) return true;
    const codes = input.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (codesDown.has(c)) return true;
    return false;
  },
  /** A press of this action is inside its buffer window and not yet consumed. */
  buffered: (action) => (bufferedUntil[action] ?? -1) >= tick,
  /** Ticks since the buffered press (0 = this tick), or -1 if none. */
  bufferAge: (action) => (input.buffered(action) ? tick - bufferedAt[action] : -1),
  /** If buffered, clear the buffer and return true. Call when the action actually fires. */
  consume(action) {
    if (!input.buffered(action)) return false;
    bufferedUntil[action] = -1;
    return true;
  },
  /** Event timestamp (performance.now ms) of the latest press of this action. */
  pressTime: (action) => pressTime[action] ?? -1,

  /**
   * Movement vector {x, z}, length <= 1. x: screen right, z: screen down (toward the camera).
   * The analog stick wins when it is outside its deadzone; keys give 8-way unit vectors.
   */
  move() {
    const sl = Math.hypot(stick.x, stick.z);
    if (sl > STICK_DEADZONE) {
      const k = Math.min(1, (sl - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / sl;
      return { x: stick.x * k, z: stick.z * k };
    }
    let x = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    let z = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
    const l = Math.hypot(x, z);
    if (l > 0) { x /= l; z /= l; }
    return { x, z };
  },

  /** True if the mouse moved within the last 2 s (then aim at cursor, else along facing). */
  mouseActive(now = performance.now()) { return now - input.mouse.lastMove < MOUSE_IDLE_MS; },

  // ---- rebinding -----------------------------------------------------------------------

  /** Replace the codes bound to an action. Persists to localStorage. */
  rebind(action, codes) {
    if (!ACTIONS.includes(action)) throw new Error(`input.rebind: unknown action "${action}"`);
    input.bindings[action] = [...codes];
    save();
  },
  resetBindings() { input.bindings = structuredClone(DEFAULT_BINDINGS); save(); },
  /** "J / LMB / PAD X" style label for an action, optionally filtered to one device. */
  describe(action, device = null) {
    return (input.bindings[action] || [])
      .filter((c) => !device || deviceOf(c) === device)
      .filter((c) => !/^Pad1[2-5]$/.test(c) && !/^Pad(Left|Right|Up|Down)$/.test(c))
      .map(codeLabel).join(' / ');
  },

  // ---- scripted input (debug, tests) ---------------------------------------------------

  /** Simulate a raw code going down/up (goes through the same queue as real events). */
  injectCode(code, down) { push(code, down, performance.now()); },
  /** Hold (true) or release (false) an action directly, bypassing bindings. A press edge fires on hold. */
  inject(action, down) {
    if (down && !injected.has(action)) {
      injected.add(action);
      const ev = { code: '@' + action, down: true, t: performance.now() };
      simQueue.push(ev); uiQueue.push(ev);
    } else if (!down) injected.delete(action);
  },

  /** Raw code state, for debug overlays. */
  codeDown: (code) => codesDown.has(code),
  get stick() { return stick; },
};

function isGameKey(code) {
  for (const a of ACTIONS) if (input.bindings[a].includes(code)) return true;
  return code === 'Tab';
}

function actionsFor(code) {
  if (code.startsWith('@')) return [code.slice(1)];
  const out = [];
  for (const a of ACTIONS) if (input.bindings[a].includes(code)) out.push(a);
  return out;
}

function setDevice(d) {
  if (input.device !== d) { input.device = d; events.emit('input:device', { device: d }); }
}

function push(code, down, t) {
  if (down) { if (codesDown.has(code)) return; codesDown.add(code); setDevice(deviceOf(code)); }
  else { if (!codesDown.has(code)) return; codesDown.delete(code); }
  const ev = { code, down, t };
  simQueue.push(ev);
  uiQueue.push(ev);
  input.recent.push(ev);
  if (input.recent.length > 32) input.recent.shift();
}

function releaseAll() {
  for (const c of [...codesDown]) push(c, false, performance.now());
  injected.clear();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(input.bindings)); } catch { /* ignore */ }
}

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null;
  for (const p of pads) if (p && p.connected) { pad = p; break; }
  if (!pad) { stick.x = 0; stick.z = 0; return; }
  input.gamepadConnected = true;
  const now = performance.now();
  pad.buttons.forEach((b, i) => {
    const on = b.pressed || b.value > 0.5;
    if (on !== !!padPrev[i]) push('Pad' + i, on, now);
    padPrev[i] = on;
  });
  stick.x = pad.axes[0] || 0;
  stick.z = pad.axes[1] || 0;
  // digital stick directions with hysteresis, for menus and digital-bound actions
  const dirs = { PadLeft: -stick.x, PadRight: stick.x, PadUp: -stick.z, PadDown: stick.z };
  for (const k in dirs) {
    const on = stickDigital[k] ? dirs[k] > 0.35 : dirs[k] > 0.55;
    if (on !== stickDigital[k]) { stickDigital[k] = on; push(k, on, now); }
  }
}
