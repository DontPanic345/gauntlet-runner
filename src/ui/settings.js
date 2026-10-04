// Settings, controls and credits pages (piece `title`), shared by the title screen and the
// pause menu. Values live in core/settings.js (localStorage) and apply live: the mixer reads
// the volumes, the feedback channel reads shake and flashes, prompts read keyDisplay.
//
//   import { settingsPage, controlsPage, creditsPage, confirmPage, menuBindHandler } from './ui/settings.js';
//   stack.open(settingsPage());
//   new MenuStack({ onBind: menuBindHandler })      // the controls page's rebinding
//
// Rebinding replaces an action's primary keyboard key. A key already used by another gameplay
// action swaps over (that action takes the old key), so no two actions ever share a key.

import { settings, SETTING_DEFAULTS } from '../core/settings.js';
import { input, DEFAULT_BINDINGS } from '../core/input.js';
import { feedback } from '../core/feedback.js';
import { drawText } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { uiSound, drawFlame } from './menus.js';

const slider = (label, key, extra = {}) => ({
  kind: 'slider', id: key, label, steps: 10,
  get: () => settings.get(key),
  set: (v) => settings.set(key, Math.round(v * 100) / 100),
  ...extra,
});

/** The settings page. Every change applies at once and is saved. */
export function settingsPage() {
  return {
    id: 'settings', style: 'panel', title: 'SETTINGS', w: 330,
    items: [
      slider('MASTER VOLUME', 'masterVolume'),
      slider('MUSIC', 'musicVolume'),
      slider('SOUND EFFECTS', 'sfxVolume'),
      { kind: 'gap' },
      slider('SCREEN SHAKE', 'shake', {
        // show what the new strength feels like, through the same settings-scaled channel
        demo: (v) => { if (v > 0) feedback.shake(5, 260); },
      }),
      slider('SCREEN FLASHES', 'flashes', {
        demo: (v) => { if (v > 0) feedback.flash('torch', 140, 0.35); },
      }),
      {
        kind: 'choice', id: 'keyDisplay', label: 'BUTTON PROMPTS',
        options: [{ value: 'auto', label: 'AUTO' }, { value: 'keyboard', label: 'KEYBOARD' }, { value: 'gamepad', label: 'GAMEPAD' }],
        get: () => settings.get('keyDisplay') ?? 'auto',
        set: (v) => settings.set('keyDisplay', v),
      },
      { kind: 'gap' },
      {
        kind: 'action', id: 'reset', label: 'RESTORE DEFAULTS',
        onSelect: (stack) => {
          for (const k in SETTING_DEFAULTS) if (k !== 'showFps') settings.set(k, SETTING_DEFAULTS[k]);
          for (const it of stack.page.items) if (it.kind === 'slider') { const n = Math.round(it.get() * 10); it._pop[n] = 1; }
        },
      },
      { kind: 'action', id: 'back', label: 'BACK', silent: true, onSelect: (stack) => stack.back() },
    ],
  };
}

// ---- controls -----------------------------------------------------------------------------------
const GAMEPLAY = ['up', 'down', 'left', 'right', 'attack', 'dash', 'interact', 'pause'];
const ACTION_LABEL = { up: 'MOVE UP', down: 'MOVE DOWN', left: 'MOVE LEFT', right: 'MOVE RIGHT', attack: 'ATTACK', dash: 'DASH', interact: 'INTERACT', pause: 'PAUSE' };
const isKey = (c) => !c.startsWith('Pad') && !c.startsWith('Mouse');
const RESERVED = new Set(['Backquote', 'Tab', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight']);

/** Rebind an action's primary keyboard key; swaps with any gameplay action already using it. */
export function rebindPrimary(action, code) {
  const cur = input.bindings[action] || [];
  if (cur.includes(code)) return { ok: true, same: true };
  const ki = cur.findIndex(isKey);
  const old = ki >= 0 ? cur[ki] : null;
  let swapped = null;
  for (const other of GAMEPLAY) {
    if (other === action || !input.bindings[other].includes(code)) continue;
    const ob = input.bindings[other].map((c) => (c === code ? old : c)).filter(Boolean);
    input.rebind(other, [...new Set(ob)]);
    swapped = other;
  }
  const nb = [...cur];
  if (ki >= 0) nb[ki] = code; else nb.unshift(code);
  input.rebind(action, nb);
  return { ok: true, action, code, old, swapped };
}

/** MenuStack onBind: listen for the next key and rebind (Escape cancels). */
export function menuBindHandler(stack, item) {
  uiSound('ui.select');
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    removeEventListener('keydown', onKey, true);
    stack.listen = null;
    stack.swallow = 2;   // this key also reaches the input queue: do not let it navigate
    if (e.code === 'Escape' && item.action !== 'pause') { uiSound('ui.back'); return; }
    if (RESERVED.has(e.code)) { uiSound('ui.deny'); item._off.vel -= 200; return; }
    const r = rebindPrimary(item.action, e.code);
    item._flashBind = stack.t;
    item._off.vel += 160;
    stack.sparks.burst(item._rect[0] + item._rect[2] - 40, item._rect[1] + 6, 8, { spread: 30, up: 14, life: 0.4 });
    stack.lastRebind = r;
    if (r.swapped) {
      const other = stack.page.items.find((it) => it.action === r.swapped);
      if (other) { other._flashBind = stack.t; other._off.vel -= 120; }
    }
    uiSound('ui.select', { rate: 1.12 });
    stack.emit('rebind', stack.page, item);
  };
  stack.listen = { item, off: () => removeEventListener('keydown', onKey, true) };
  addEventListener('keydown', onKey, true);
}

/** The controls page: every gameplay action with its keys (rebindable) and its pad button. */
export function controlsPage() {
  const items = GAMEPLAY.map((a) => ({ kind: 'bind', id: a, label: ACTION_LABEL[a], action: a, padCol: 44 }));
  items.push({ kind: 'gap' });
  items.push({
    kind: 'action', id: 'resetBinds', label: 'RESET KEYS',
    onSelect: (stack) => {
      for (const a of Object.keys(DEFAULT_BINDINGS)) input.rebind(a, DEFAULT_BINDINGS[a]);
      for (const it of stack.page.items) if (it.kind === 'bind') { it._flashBind = stack.t; it._off.vel += 100; }
    },
  });
  items.push({ kind: 'action', id: 'back', label: 'BACK', silent: true, onSelect: (stack) => stack.back() });
  return {
    id: 'controls', style: 'panel', title: 'CONTROLS', w: 340, lineH: 17,
    extraTopH: 12,
    extraTop(g, box) {
      drawText(g, 'KEYS', box.x + box.w - 4 - 44 - 3, box.y - 2, 'mist', { align: 'right' });
      drawText(g, 'PAD', box.x + box.w - 4, box.y - 2, 'mist', { align: 'right' });
      g.fillStyle = css('dusk'); g.fillRect(box.x - 4, box.y + 7, box.w + 8, 1);
    },
    extraH: 22,
    extraBottom(g, b) {
      drawText(g, 'MOUSE: LMB ATTACKS TOWARD THE CURSOR, RMB DASHES.', b.x + b.w / 2, b.y + 2, 'mist', { align: 'center' });
      drawText(g, 'NO MOUSE FOR 2 S: ATTACKS FOLLOW YOUR FACING.', b.x + b.w / 2, b.y + 12, 'slate', { align: 'center' });
    },
    onBack(stack) { if (stack.listen) { stack.listen.off(); stack.listen = null; return true; } return false; },
    items,
  };
}

// ---- credits ----------------------------------------------------------------------------------------
const CREDITS = [
  ['h', 'GAUNTLET-RUNNER'],
  ['t', 'A RUNNER, A CRYPT, A MOUNTAIN COMING DOWN.'],
  ['s', ''],
  ['h', 'MADE BY'],
  ['t', 'THE HURDLES LOOP: CLAUDE AS BUILDERS,'],
  ['t', 'CRITICS AND BLIND JUDGES, WAVE AFTER WAVE.'],
  ['s', ''],
  ['h', 'EVERYTHING IS MADE IN CODE'],
  ['t', 'VOXELS, PIXEL FONT, SOUND EFFECTS AND MUSIC'],
  ['t', 'ARE AUTHORED OR SYNTHESISED AT RUNTIME.'],
  ['t', 'NO THIRD-PARTY ART OR AUDIO.'],
  ['s', ''],
  ['h', 'BUILT WITH'],
  ['t', 'THREE.JS (MIT LICENCE)'],
];

export function creditsPage() {
  const lineH = 10;
  const h = CREDITS.reduce((s, [k]) => s + (k === 's' ? 5 : k === 'h' ? 12 : lineH), 0);
  return {
    id: 'credits', style: 'panel', title: 'CREDITS', w: 330,
    extraTopH: h + 8,
    extraTop(g, box, stack) {
      let y = box.y;
      for (const [k, s] of CREDITS) {
        if (k === 's') { y += 5; continue; }
        if (k === 'h') {
          drawText(g, s, box.x + box.w / 2, y + 2, 'gold', { align: 'center', shadow: 'ink' });
          y += 12;
        } else { drawText(g, s, box.x + box.w / 2, y, 'frost', { align: 'center' }); y += lineH; }
      }
      // a small flame keeps the page alive
      drawFlame(g, Math.round(box.x + box.w / 2 - 2), box.y - 30, Math.floor(stack.t * 8) % 3);
    },
    items: [{ kind: 'action', id: 'back', label: 'BACK', silent: true, onSelect: (stack) => stack.back() }],
  };
}

/** A yes / no page. no() defaults to going back. */
export function confirmPage({ title = 'ARE YOU SURE?', text = '', yes, yesLabel = 'YES', noLabel = 'NO' }) {
  return {
    id: 'confirm', style: 'panel', title, w: 280,
    extraTopH: text ? 16 : 0,
    extraTop(g, box) { if (text) drawText(g, text, box.x + box.w / 2, box.y, 'frost', { align: 'center' }); },
    focus: 0,
    items: [
      { kind: 'action', id: 'no', label: noLabel, silent: true, onSelect: (stack) => stack.back() },
      { kind: 'action', id: 'yes', label: yesLabel, onSelect: (stack) => yes(stack) },
    ],
  };
}

export { GAMEPLAY };
