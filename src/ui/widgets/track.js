// Room progress track: the route as a chain of nodes (arena, corridor, ..., boss). Done nodes
// are lit and stamped, the current one pulses with a marker under it, the rest wait dim. The
// corridor nodes are ember coloured (they are the collapse); the link out of the current node
// fills as `progress` (arena: waves cleared, corridor: distance run).

import { css } from '../../render/palette.js';
import { drawText, textWidth } from '../../core/pixelfont.js';
import { NODE_ARENA, NODE_CORRIDOR, NODE_BOSS, drawSprite, plate } from './sprites.js';

export const DEFAULT_ROUTE = ['arena', 'corridor', 'arena', 'corridor', 'arena', 'corridor', 'arena', 'corridor', 'arena', 'boss'];
const STEP = 13;

const RECOLOUR = {
  arena: { done: { l: 'fog' }, now: { l: 'bone' }, next: { l: 'slate' } },
  corridor: { done: { e: 'red' }, now: { e: 'ember' }, next: { e: 'plum' } },
  boss: { done: { z: 'bone', b: 'red' }, now: { z: 'white', b: 'red' }, next: { z: 'mist', b: 'blood' } },
};
const SPR = { arena: NODE_ARENA, corridor: NODE_CORRIDOR, boss: NODE_BOSS };

export class Track {
  constructor(route = DEFAULT_ROUTE) {
    this.route = route;
    this.index = 0;          // current node
    this.progress = 0;       // 0..1 along the link out of the current node
    this.shown = 0;
    this.stampT = new Array(route.length).fill(99);
    this.arriveT = 99;
    this.t = 0;
    this.label = '';
    this.alarm = false;      // corridor chase: the label flashes ember
    this.doneUpTo = -1;      // nodes <= this are cleared
  }

  set(route, index) { if (route) { this.route = route; this.stampT = new Array(route.length).fill(99); } this.goto(index); }

  goto(i) {
    i = Math.max(0, Math.min(this.route.length - 1, i));
    if (i > this.index) { for (let k = this.index; k < i; k++) this.stampT[k] = 0; }
    if (i !== this.index) { this.arriveT = 0; this.progress = 0; }
    this.index = i;
    this.doneUpTo = Math.max(this.doneUpTo, i - 1);
  }
  clear(i = this.index) { this.doneUpTo = Math.max(this.doneUpTo, i); this.stampT[i] = 0; }
  setProgress(f) { this.progress = Math.max(0, Math.min(1, f)); }

  tick() {
    this.t++; this.arriveT++;
    this.shown += (this.progress - this.shown) * 0.25;
    this.stampT = this.stampT.map((v) => (v < 99 ? v + 1 : v));
  }

  width() { return this.route.length * STEP + 7; }
  draw(g, cx, y) {
    const n = this.route.length, w = this.width();
    const x = Math.round(cx - w / 2);
    plate(g, x, y, w, 21);
    const cur = this.route[this.index];
    for (let i = 0; i < n; i++) {
      const kind = this.route[i];
      const state = i <= this.doneUpTo ? 'done' : i === this.index ? 'now' : 'next';
      const spr = SPR[kind];
      const nx = x + 5 + i * STEP + 3;                 // node centre column
      const ny = y + 4;
      let dy = 0, flash = null;
      if (state === 'now') {
        const b = this.t % 60;
        dy = b < 30 ? 0 : -1;
        if (this.arriveT < 4) flash = 'white';
        if (kind === 'corridor' && this.t % 8 < 3) flash = 'flame';
      }
      if (this.stampT[i] < 5) flash = 'white';
      const px = nx - (spr.w >> 1), py = ny + (kind === 'boss' ? 0 : 1) + dy;
      drawSprite(g, spr, px, py, { map: RECOLOUR[kind][state], flash, outline: 'ink' });
      // link to the next node
      if (i < n - 1) {
        const lx = nx + (spr.w >> 1) + 2, lw = STEP - (spr.w >> 1) - (SPR[this.route[i + 1]].w >> 1) - 2;
        const filled = state === 'done' ? 1 : state === 'now' ? this.shown : 0;
        g.fillStyle = css('dusk'); g.fillRect(lx, y + 8, Math.max(1, lw), 1);
        g.fillStyle = css(kind === 'corridor' || this.route[i + 1] === 'corridor' ? 'red' : 'fog');
        g.fillRect(lx, y + 8, Math.round(Math.max(1, lw) * filled), 1);
      }
      if (state === 'now') {
        // marker: a little caret that bobs under the node
        const my = y + 14 + ((this.t >> 4) & 1);
        g.fillStyle = css('ink'); g.fillRect(nx - 2, my, 5, 1); g.fillRect(nx - 1, my - 1, 3, 1); g.fillRect(nx, my - 2, 1, 1);
        g.fillStyle = css(kind === 'corridor' ? 'ember' : 'gold'); g.fillRect(nx - 1, my, 3, 1); g.fillRect(nx, my - 1, 1, 1);
      }
    }
    if (this.label) {
      const flash = this.alarm && (this.t >> 3) % 2 === 0;
      const col = this.alarm ? (flash ? 'flame' : 'ember') : 'fog';
      drawText(g, this.label, cx, y + 23, col, { align: 'center', outline: 'ink' });
    }
    void cur; void textWidth;
    return { x, y, w, h: 21 + (this.label ? 10 : 0) };
  }
}
