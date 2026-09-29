// The held-boon row: one framed cell per boon (12x12 icon, rarity edge, level pips), synergies
// linked with a gold bar. New boons drop in with a flash; a level-up flashes its pips.
// Tooltips: mouse hover, or Tab cycles through the boons from the keyboard, or a boon that was
// just gained announces itself for a couple of seconds.
//
// Wave 3: Enhanced visual depth with subtle shadows and better color separation for crafted appearance.

import { css } from '../../render/palette.js';
import { drawText, textWidth, wrapText } from '../../core/pixelfont.js';
import { drawIcon } from '../../progression/icons.js';
import { RARITY } from '../../progression/boons.js';
import { plate, plus } from './sprites.js';

const CELL = 18;  // wave 2: increased from 16 for better readability
const GAP = 3;   // wave 2: increased from 2 for better spacing
const TIP_W = 176;

export class BoonRow {
  constructor() {
    this.items = [];          // [{ id, level, def, popT, lvT }]
    this.t = 0;
    this.sel = -1;            // keyboard-cycled selection
    this.selT = 0;            // ticks the selection stays up
    this.auto = null;         // { id, t } announcement of a new boon
    this.hover = -1;
    this.bounds = [];
    this.tipT = 0;
    this.tipId = null;
    this.sparks = [];
    this.synergies = [];
  }

  tick(list, synergies) {
    this.t++;
    const known = new Map(this.items.map((it) => [it.id, it]));
    const next = list.map((b) => {
      const old = known.get(b.id);
      if (!old) {
        this.auto = { id: b.id, t: 0 };
        return { id: b.id, level: b.level, def: b, popT: 0, lvT: 99 };
      }
      if (b.level !== old.level) { old.lvT = 0; this.auto = { id: b.id, t: 0 }; }
      old.level = b.level; old.def = b;
      old.popT++; old.lvT++;
      return old;
    });
    this.items = next;
    this.synergies = synergies ?? [];
    if (this.auto) { this.auto.t++; if (this.auto.t > 170) this.auto = null; }
    if (this.selT > 0 && --this.selT === 0) this.sel = -1;
    for (const s of this.sparks) { s.x += s.vx; s.y += s.vy; s.vy += 0.1; s.life--; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  cycle() {
    if (!this.items.length) return;
    this.sel = (this.sel + 1) % this.items.length;
    this.selT = 220;
  }

  width() { return this.items.length * (CELL + GAP) - GAP; }

  /** Draw with the row's top-left at (x, y). mouse = internal-pixel {x, y} or null. */
  draw(g, x, y, mouse) {
    x = Math.round(x); y = Math.round(y);
    this.bounds = [];
    this.hover = -1;
    const pos = {};
    this.items.forEach((it, i) => {
      const cx = x + i * (CELL + GAP);
      pos[it.id] = cx;
      let dy = 0;
      if (it.popT < 16) { const k = it.popT / 15; dy = -Math.round((1 - k) * (1 - k) * 14) + (k > 0.7 ? 0 : 0); if (it.popT === 0) this._burst(cx + CELL / 2, y + CELL / 2, it.def.rarity); }
      const r = RARITY[it.def.rarity];
      const hov = mouse && mouse.x >= cx && mouse.x < cx + CELL && mouse.y >= y - 2 && mouse.y < y + CELL + 2;
      if (hov) this.hover = i;
      this.bounds.push([cx, y, CELL, CELL]);
      const sel = this.sel === i || hov || (this.auto && this.auto.id === it.id);
      const lift = sel ? -2 : 0;
      
      // Wave 3: subtle shadow for depth
      g.fillStyle = 'rgba(0, 0, 0, 0.2)';
      g.fillRect(cx + 1, y + dy + CELL + lift, CELL - 2, 1);
      
      plate(g, cx, y + dy + lift, CELL, CELL, { edge: r.edge, fill: it.popT < 3 ? 'frost' : sel ? r.panel : 'night', light: r.edgeDark });
      drawIcon(g, it.id, cx + 3, y + dy + 3 + lift, 1, { outline: false });
      // level pips (larger, clearer)
      for (let k = 0; k < it.def.max; k++) {
        g.fillStyle = css(k < it.level ? (it.lvT < 12 && (it.lvT >> 1) % 2 === 0 && k === it.level - 1 ? 'white' : r.hi) : 'ink');
        g.fillRect(cx + 4 + k * 4, y + dy + CELL - 4 + lift, 2, 2);
      }
      if (it.popT < 3) { g.fillStyle = css('white'); g.globalAlpha = 0.7; g.fillRect(cx + 1, y + dy + 1 + lift, CELL - 2, CELL - 2); g.globalAlpha = 1; }
    });
    // synergy bars under linked boons
    for (const s of this.synergies) {
      const a = pos[s.a], b = pos[s.b];
      if (a === undefined || b === undefined) continue;
      const x0 = Math.min(a, b) + CELL / 2, x1 = Math.max(a, b) + CELL / 2;
      g.fillStyle = css('ink'); g.fillRect(x0 - 1, y + CELL + 2, x1 - x0 + 3, 3);
      g.fillStyle = css('gold'); g.fillRect(x0, y + CELL + 3, x1 - x0 + 1, 1);
      const sweep = x0 + ((this.t >> 1) % Math.max(1, x1 - x0 + 24)) - 12;
      if (sweep >= x0 && sweep <= x1) { g.fillStyle = css('white'); g.fillRect(sweep, y + CELL + 3, 1, 1); }
    }
    for (const s of this.sparks) { g.fillStyle = css(s.c); g.fillRect(Math.round(s.x), Math.round(s.y), 1, 1); }

    // tooltip
    let ti = this.hover >= 0 ? this.hover : this.sel >= 0 ? this.sel : -1;
    if (ti < 0 && this.auto) ti = this.items.findIndex((it) => it.id === this.auto.id);
    if (ti >= 0 && this.items[ti]) {
      if (this.tipId !== this.items[ti].id) { this.tipId = this.items[ti].id; this.tipT = 0; }
      this.tipT++;
      this._tooltip(g, this.items[ti], x + ti * (CELL + GAP), y);
    } else { this.tipId = null; this.tipT = 0; }
    return { x, y, w: Math.max(0, this.width()), h: CELL + 6 };
  }

  _burst(x, y, rarity) {
    const c = { common: 'frost', rare: 'sky', epic: 'gold' }[rarity];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.sparks.push({ x, y, vx: Math.cos(a) * 1.2, vy: Math.sin(a) * 1.2 - 0.6, life: 14 + (i & 3) * 3, c: i & 1 ? 'white' : c });
    }
  }

  _tooltip(g, it, cx, y) {
    const d = it.def, r = RARITY[d.rarity];
    const lv = it.level;
    const lines = wrapText(d.desc(lv), TIP_W - 12);
    const syn = this.synergies.filter((s) => s.a === it.id || s.b === it.id);
    const synLines = [];
    for (const s of syn) synLines.push(...wrapText(`${s.name}: ${s.text}`, TIP_W - 12).map((t, i) => (i ? '  ' : '+ ') + t));
    const h = 8 + 11 + lines.length * 9 + (synLines.length ? 4 + synLines.length * 9 : 0) + 4;
    const open = Math.min(1, this.tipT / 5);
    const hh = Math.max(12, Math.round(h * (1 - (1 - open) * (1 - open))));
    const W = g.canvas.width;
    const tx = Math.max(4, Math.min(W - TIP_W - 4, cx + CELL / 2 - TIP_W / 2));
    const ty = y - hh - 6;
    plate(g, tx, ty, TIP_W, hh, { edge: r.edge, fill: r.panel, light: r.edgeDark });
    // pointer notch toward the icon
    const px = Math.max(tx + 6, Math.min(tx + TIP_W - 12, cx + CELL / 2));
    g.fillStyle = css('ink'); g.fillRect(px, ty + hh, 7, 1); g.fillRect(px + 1, ty + hh + 1, 5, 1); g.fillRect(px + 2, ty + hh + 2, 3, 1);
    g.fillStyle = css(r.panel); g.fillRect(px + 1, ty + hh - 1, 5, 2); g.fillRect(px + 2, ty + hh + 1, 3, 1); g.fillRect(px + 3, ty + hh + 2, 1, 1);
    if (open < 1) return;
    drawText(g, d.name, tx + 6, ty + 5, r.hi, { shadow: 'ink' });
    const tag = `${r.name}  LV ${lv}/${d.max}`;
    drawText(g, tag, tx + TIP_W - 6 - textWidth(tag), ty + 5, r.edge, { shadow: 'ink' });
    g.fillStyle = css(r.edgeDark); g.fillRect(tx + 6, ty + 15, TIP_W - 12, 1);
    lines.forEach((ln, i) => drawText(g, ln, tx + 6, ty + 19 + i * 9, 'bone', { shadow: 'ink' }));
    synLines.forEach((ln, i) => drawText(g, ln, tx + 6, ty + 23 + lines.length * 9 + i * 9, 'gold', { shadow: 'ink' }));
    void plus;
  }
}
