// Boon acquisition toast: a 1.5-2 second banner showing the acquired boon
// with a large icon (32px), name, and rarity color. Animates in from above.

import { css } from '../../render/palette.js';
import { drawText, textWidth } from '../../core/pixelfont.js';
import { drawIcon } from '../../progression/icons.js';
import { RARITY } from '../../progression/boons.js';
import { plate } from './sprites.js';

const DURATION = 120;  // 2 seconds at 60 fps
const ICON_SIZE = 32;
const PADDING = 8;

export class BoonToast {
  constructor() {
    this.active = null;  // { id, def, t }
    this.t = 0;
  }

  show(boonId, boonDef) {
    this.active = { id: boonId, def: boonDef, t: 0 };
    this.t = 0;
  }

  tick() {
    this.t++;
    if (this.active) {
      this.active.t++;
      if (this.active.t > DURATION) {
        this.active = null;
      }
    }
  }

  draw(g, cx, y) {
    if (!this.active) return;
    const d = this.active.def;
    const r = RARITY[d.rarity];
    const t = Math.min(1, this.active.t / 12);  // animate in over 0.2s
    const easeOut = 1 - (1 - t) * (1 - t);
    
    // fade out in last 15 frames (0.25s)
    let alpha = 1;
    if (this.active.t > DURATION - 15) {
      alpha = (DURATION - this.active.t) / 15;
    }
    
    g.globalAlpha = alpha;
    
    // slide in from above
    const slideY = Math.round((1 - easeOut) * -40);
    const toastY = y + slideY;
    
    // measure text
    const nameText = d.name;
    const nameW = textWidth(nameText);
    const toastW = ICON_SIZE + nameW + PADDING * 4;
    const toastX = cx - toastW / 2;
    
    // background plate
    plate(g, toastX, toastY, toastW, ICON_SIZE + PADDING * 2, {
      edge: r.edge,
      fill: r.panel,
      light: r.edgeDark,
    });
    
    // large icon
    drawIcon(g, this.active.id, toastX + PADDING, toastY + PADDING, 2, { outline: true });
    
    // name text
    drawText(g, nameText, toastX + ICON_SIZE + PADDING * 2, toastY + PADDING + 8, r.hi, {
      outline: 'ink',
      shadow: 'ink',
    });
    
    g.globalAlpha = 1;
  }
}
