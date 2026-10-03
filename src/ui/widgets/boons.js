// Boon row and tooltips (piece `hud`): bottom left. One framed icon per held boon, in its
// rarity colours, in the order taken, with stack pips under it. Takes over from the boons
// piece's stand-in bar (src/progression/hud.js), using that piece's icons, rarity table and
// runtime (procs, ward, leech motes, starfall count).
//
//   new boon     the slot drops in from above with a white frame, then its tooltip opens
//   proc         the icon flashes white and hops (runtime.lastProc)
//   spent/down   greys out (a used phoenix, a broken bulwark ward, with its regrow meter)
//   synergy      members wear a gold corner gem; completing a pair shows the SYNERGY banner
//   meters       leech motes, starfall hit count (pips over the slot), ward regrow (a bar)
//
// Tooltips: a framed card above the row (icon, name, level, the boon's own card text at its
// current stack, its synergy). One opens by itself for a new boon; Tab cycles through the held
// boons (keyboard), and hovering a slot with the mouse opens that one.
//
//   const b = createBoonRow();  b.tick({ runtime, mouse })  b.draw(g, x, bottomY)  b.inspect(i?)

import { drawText, textWidth, wrapText, LINE_H } from '../../core/pixelfont.js';
import { events } from '../../core/events.js';
import { BOONS, RARITY, progress, level, activeSynergies, synergiesOf, has } from '../../progression/boons.js';
import { drawIcon, iconCanvas } from '../../progression/icons.js';
import { richText } from '../../progression/cards.js';
import { boonSfx } from '../../progression/sfx.js';
import { rect, cutRect, panel, easeOutBack } from './draw.js';

export const SLOT = 20, PITCH = 24, PER_ROW = 8;
const TIP_W = 176;

export function createBoonRow() {
  const born = new Map();     // id -> tick it arrived
  let t = 0;
  let tip = null;             // { id, t, until, src: 'new'|'key'|'mouse' }
  let syn = null;             // { s, t }
  let cursor = -1;
  const slots = [];           // last drawn rects, for mouse hover
  const offs = [];
  offs.push(events.on('boon:gain', (e) => {
    if (!born.has(e.id)) born.set(e.id, t);
    else born.set(e.id + '#lv', t);
    open(e.id, 'new', e.quiet ? 0 : 30, 200);
    if (e.synergies?.length) syn = { s: e.synergies[0], t: -(e.quiet ? 10 : 46), played: false };
  }));

  function open(id, src, delay = 0, len = 220) {
    if (tip && tip.id === id && tip.src === src && t < tip.until) { tip.until = t + delay + len; return; }
    tip = { id, src, t0: t + delay, until: t + delay + len, closeT: -1 };
  }

  const api = {
    get tip() { return tip && t >= tip.t0 && t < tip.until ? tip.id : null; },
    /** Keyboard inspect: next held boon (or boon i). */
    inspect(i = null) {
      const ids = progress.order;
      if (!ids.length) return null;
      cursor = i === null ? (cursor + 1) % ids.length : Math.max(0, Math.min(ids.length - 1, i));
      open(ids[cursor], 'key', 0, 300);
      return ids[cursor];
    },
    tick({ runtime = null, mouse = null, loopTick = 0 } = {}) {
      t++;
      api.runtime = runtime;
      api.loopTick = loopTick;
      if (syn) syn.t++;
      // mouse hover
      if (mouse) {
        const hit = slots.find((s) => mouse.x >= s.x && mouse.x < s.x + SLOT && mouse.y >= s.y && mouse.y < s.y + SLOT + 6);
        if (hit) open(hit.id, 'mouse', 0, 20);
      }
      if (tip && !progress.held.has(tip.id)) tip = null;
    },
    dispose() { offs.forEach((f) => f()); offs.length = 0; },
  };

  api.draw = (g, x0, yb) => {
    const ids = progress.order;
    slots.length = 0;
    const runtime = api.runtime;
    const inSyn = new Set(activeSynergies().flatMap((s) => [s.a, s.b]));
    ids.forEach((id, i) => {
      const row = Math.floor(i / PER_ROW), col = i % PER_ROW;
      const x = x0 + col * PITCH, y = yb - 26 - row * 32;
      slots.push({ id, x, y });
      const B = BOONS[id], R = RARITY[B.rarity];
      const age = t - (born.get(id) ?? -99);
      if (age < 0) return;
      const lvAge = t - (born.get(id + '#lv') ?? -99);
      const drop = age < 12 ? Math.round((1 - easeOutBack(age / 12)) * -14) : 0;
      if (age < 12 && age < 3 && (age & 1)) return;
      const last = runtime?.lastProc?.[id] ?? -99;
      const procAge = procAgeOf(runtime, id, last);
      const flash = age < 4 || lvAge < 4 || (procAge >= 0 && procAge < 4);
      const hop = procAge >= 0 && procAge < 6 ? -[2, 2, 1, 1, 0, 0][procAge] : lvAge < 8 ? -[3, 3, 2, 2, 1, 1, 0, 0][lvAge] : 0;
      const spent = (id === 'phoenix' && progress.spent.has('phoenix')) || (id === 'bulwark' && runtime && !runtime.ward.up);
      const yy = y + hop + drop;
      const tipped = api.tip === id;
      cutRect(g, 'ink', x - 1, yy - 1, SLOT + 2, SLOT + 2, 2);
      cutRect(g, flash ? 'white' : tipped ? 'torch' : spent ? 'slate' : R.frame, x, yy, SLOT, SLOT, 2);
      cutRect(g, 'night', x + 1, yy + 1, SLOT - 2, SLOT - 2, 1);
      rect(g, R.edge, x + 2, yy + SLOT - 2, SLOT - 4, 1);
      drawIcon(g, id, x + 1, yy + 1, { scale: 1, tint: flash ? 'white' : null, dim: spent && !flash });
      if (inSyn.has(id)) {
        rect(g, 'ink', x + 15, yy - 2, 6, 6);
        rect(g, (t >> 4) % 4 === 0 ? 'torch' : 'gold', x + 16, yy - 1, 4, 4);
        rect(g, 'white', x + 16, yy - 1, 1, 1);
      }
      // stack pips
      const n = progress.held.get(id) ?? 0;
      const pw = Math.min(6, Math.floor((SLOT + 2) / B.max));
      for (let k = 0; k < B.max; k++) {
        rect(g, 'ink', x + 1 + k * pw, yy + SLOT + 2, pw - 1, 4);
        rect(g, k < n ? (lvAge < 10 && k === n - 1 ? 'white' : R.frame) : 'violet', x + 2 + k * pw, yy + SLOT + 3, pw - 3, 2);
      }
      // live meters
      if (id === 'leech' && runtime) {
        const per = level('leech').per, m = runtime.leechMotes;
        for (let k = 0; k < per; k++) rect(g, k < m ? 'red' : 'blood', x + 2 + k * 3, yy - 4, 2, 2);
      }
      if (id === 'starfall' && runtime) {
        const every = level('starfall').every;
        for (let k = 0; k < every; k++) rect(g, k < runtime.hitCount ? 'gold' : 'violet', x + 2 + k * 3, yy - 4, 2, 2);
      }
      if (id === 'bulwark' && runtime && !runtime.ward.up && runtime.ward.meshes.length) {
        const k = 1 - runtime.ward.regrowT / level('bulwark').regrow;
        const h = Math.round((SLOT - 4) * k);
        rect(g, 'sky', x + 2, yy + SLOT - 2 - h, 2, h);
      }
    });
    drawTip(g, x0, yb);
    drawSynergy(g);
  };

  function procAgeOf(runtime, id, last) {
    if (!runtime || last < 0) return -1;
    return (api.loopTick ?? 0) - last;   // lastProc is stamped with loop.tick
  }

  // ---- tooltip ------------------------------------------------------------------------------
  const tipCache = new Map();
  function tipCanvas(id) {
    const n = progress.held.get(id) ?? 1;
    const syns = synergiesOf(id);
    const on = syns.find((s) => has(s.partner));
    const key = `${id}|${n}|${on?.id ?? ''}`;
    let c = tipCache.get(key);
    if (c) return c;
    const B = BOONS[id], R = RARITY[B.rarity];
    const scratch = document.createElement('canvas');
    scratch.width = TIP_W; scratch.height = 160;
    const g = scratch.getContext('2d');
    let y = 5;
    drawIcon(g, id, 5, y - 1, { scale: 1 });
    drawText(g, B.name, 26, y + 1, R.order >= 3 ? 'gold' : 'bone', { shadow: 'ink' });
    const lv = B.max > 1 ? `LV ${n}/${B.max}` : '';
    if (lv) drawText(g, lv, TIP_W - 6, y + 1, n >= B.max ? 'gold' : 'fog', { align: 'right' });
    drawText(g, R.label, 26, y + 10, R.text);
    y += 22;
    rect(g, R.edge, 6, y - 2, TIP_W - 12, 1);
    const lines = richText(g, B.text(n, B.lv(n)), 7, y + 1, TIP_W - 14, 'frost', B.color === 'bone' ? 'white' : B.color, { align: 'left' });
    y += lines * LINE_H + 4;
    const s = on ?? syns[0];
    if (s) {
      g.drawImage(iconCanvas(s.partner, 1, { dim: !on }), 5, y - 1);
      drawText(g, on ? `SYNERGY: ${s.name}` : 'PAIRS WITH', 26, y + 1, on ? 'gold' : 'mist');
      if (on) {
        const lines = wrapText(s.text, TIP_W - 32);
        lines.forEach((l, i) => drawText(g, l, 26, y + 10 + i * LINE_H, 'torch'));
        y += 12 + lines.length * LINE_H;
      } else {
        drawText(g, BOONS[s.partner].name, 26, y + 10, 'fog');
        y += 21;
      }
    }
    c = document.createElement('canvas');
    c.width = TIP_W; c.height = y + 3;
    c.getContext('2d').drawImage(scratch, 0, 0);
    c.rarity = R;
    tipCache.set(key, c);
    return c;
  }

  function drawTip(g, x0, yb) {
    api.tipRect = null;
    if (!tip) return;
    if (t < tip.t0) return;
    if (t >= tip.until + 5) { tip = null; return; }
    const i = progress.order.indexOf(tip.id);
    if (i < 0) return;
    const c = tipCanvas(tip.id);
    const R = c.rarity;
    const rows = Math.ceil(progress.order.length / PER_ROW);
    const slotX = x0 + (i % PER_ROW) * PITCH;
    const H = c.height + 6;
    const age = t - tip.t0, out = tip.until - t;
    const k = out < 0 ? Math.max(0, 1 + out / 5) : Math.min(1, age / 5);
    const h = Math.max(3, Math.round(H * k));
    const x = Math.max(4, Math.min(slotX - 6, g.canvas.width - TIP_W - 10));
    const yTop = yb - 26 - (rows - 1) * 32 - 7 - h;
    panel(g, x, yTop, TIP_W + 6, h, { rim: R.frame });
    api.tipRect = { x, y: yTop, w: TIP_W + 6, h };
    if (k >= 1) g.drawImage(c, x + 3, yTop + 3);
    else g.drawImage(c, 0, 0, c.width, Math.max(0, h - 6), x + 3, yTop + 3, c.width, Math.max(0, h - 6));
    if (tip.src === 'key' && k >= 1) drawText(g, 'TAB', x + TIP_W + 3, yTop - 8, 'slate', { align: 'right', shadow: 'ink' });
  }

  // ---- synergy banner (centre screen) -------------------------------------------------------------
  function drawSynergy(g) {
    if (!syn) return;
    const tt = syn.t;
    if (tt < 0) return;
    if (!syn.played) { syn.played = true; boonSfx.synergy?.(); }
    if (tt > 156) { syn = null; return; }
    if (tt > 138 && (tt >> 1) & 1) return;
    const W = g.canvas.width;
    const s = syn.s;
    const k = Math.min(1, tt / 9);
    const y = Math.round(78 + (1 - k) * 10);
    const w = Math.max(textWidth(s.name, 2) + 56, textWidth(s.text) + 14, 160);
    const x0 = Math.round(W / 2 - w / 2);
    panel(g, x0, y, w, 46, { rim: 'gold', edge: 'ink', tone: 'night' });
    drawText(g, 'SYNERGY', W / 2, y + 4, tt < 6 ? 'white' : 'gold', { align: 'center' });
    drawIcon(g, s.a, x0 + 5, y + 13, { scale: 1 });
    drawIcon(g, s.b, x0 + w - 23, y + 13, { scale: 1 });
    drawText(g, s.name, W / 2, y + 15, tt < 6 ? 'white' : 'torch', { align: 'center', scale: 2, outline: 'ink' });
    drawText(g, s.text, W / 2, y + 33, 'frost', { align: 'center' });
  }

  return api;
}
