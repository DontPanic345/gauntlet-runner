// Soul-shard counter. The shown number chases the real total one step at a time (bigger jumps
// take bigger steps), every step pops the digits, and the gain floats up as +N (merging while
// more arrive). Spending rolls down in rose. A glint crosses the gem now and then.

import { css } from '../../render/palette.js';
import { drawText, textWidth } from '../../core/pixelfont.js';
import { drawGlyph } from '../../progression/icons.js';
import { plate, plus } from './sprites.js';

export class Shards {
  constructor(total = 0) {
    this.total = total;
    this.shown = total;
    this.popT = 99;
    this.dir = 1;
    this.float = null;       // { n, t }
    this.t = 0;
    this.gemT = 99;          // bounce of the gem on a step
    this.acc = 0;
  }

  tick(total) {
    this.t++;
    if (total !== this.total) {
      const d = total - this.total;
      this.total = total;
      this.dir = d > 0 ? 1 : -1;
      if (this.float && this.float.t < 30 && Math.sign(this.float.n) === Math.sign(d)) { this.float.n += d; this.float.t = 6; }
      else this.float = { n: d, t: 0 };
    }
    if (this.float) { this.float.t++; if (this.float.t > 46) this.float = null; }
    this.popT++; this.gemT++;
    if (this.shown !== this.total) {
      const diff = this.total - this.shown;
      const every = Math.abs(diff) > 12 ? 1 : 2;
      if (this.t % every === 0) {
        const step = Math.max(1, Math.ceil(Math.abs(diff) / 10));
        this.shown += Math.sign(diff) * Math.min(step, Math.abs(diff));
        this.popT = 0; this.gemT = 0;
      }
    }
  }

  width() { return 22 + textWidth(String(Math.max(0, this.shown)), 2); }
  /** Right-aligned at x (the right edge of the plate). Returns { x, y, w, h } bounds. */
  draw(g, xRight, y) {
    const s = String(Math.max(0, this.shown));
    const tw = textWidth(s, 2);
    const w = Math.max(38, 25 + tw), h = 17;
    const x = Math.round(xRight - w);
    plate(g, x, y, w, h);
    const rolling = this.shown !== this.total;
    const bounce = this.gemT < 4 ? -1 : 0;
    drawGlyph(g, 'shard', x + 5, y + 4 + bounce, 2);
    // digits: white flash on a step, then sky; right-aligned in a fixed slot so they do not jitter
    const pop = this.popT < 3;
    const col = pop ? 'white' : this.dir < 0 && rolling ? 'rose' : 'sky';
    const dy = pop ? -1 : 0;
    drawText(g, s, x + w - 5 - tw, y + 2 + dy, col, { scale: 2, shadow: 'ink' });
    // glint
    const gl = this.t % 220;
    if (gl < 8) {
      const gx = x + 6 + (gl >> 1) * 2, gy = y + 4 + (gl >> 1);
      plus(g, gx, gy, gl < 5 ? 'white' : 'sky', gl < 5 ? 1 : 0);
    }
    if (this.float) {
      const f = this.float, k = Math.min(1, f.t / 14);
      const fy = y + h + 3 - Math.round((1 - (1 - k) * (1 - k)) * 5);
      const txt = (f.n > 0 ? '+' : '') + f.n;
      if (f.t < 34 || f.t % 3) drawText(g, txt, x + w - 5 - textWidth(txt), fy, f.n > 0 ? (f.t < 4 ? 'white' : 'cyan') : 'rose', { outline: 'ink' });
    }
    return { x, y, w, h };
  }
}
void css;
