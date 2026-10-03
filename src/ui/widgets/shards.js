// Soul shard counter (piece `hud`): top right. A crystal and an odometer.
//
// The shown value chases progress.shards one step at a time (faster when far behind), and
// every step rolls the changed digits: the old digit slides up out of a clipped window while
// the new one slides in from below. Each step flashes the crystal and kicks the panel. A "+n"
// tally under the panel adds up a burst of pickups, then drops away. Spending rolls down, red.
//
//   const s = createShards();   s.tick(value)   s.draw(g, rightX, y)   s.width

import { drawText } from '../../core/pixelfont.js';
import { drawIcon } from '../../progression/icons.js';
import { panel } from './draw.js';

const DIGIT_W = 12, DIGIT_H = 14;   // 5x7 tabular digits at scale 2, 1px (x2) apart
const ROLL = [0.45, 0.8];             // the roll's progress on its first two ticks, then settled

export function createShards() {
  let shown = null, target = 0, stepT = 99, dir = 1, wait = 0, prev = 0;
  let tally = 0, tallyT = 999;
  const api = { width: 0 };

  api.tick = (value) => {
    target = value | 0;
    if (shown === null) { shown = target; prev = target; }
    stepT++; tallyT++;
    if (wait > 0) wait--;
    else if (shown !== target) {
      const gap = Math.abs(target - shown);
      const step = gap > 40 ? Math.ceil(gap / 12) : 1;
      prev = shown;
      dir = target > shown ? 1 : -1;
      shown += dir * Math.min(step, gap);
      stepT = 0;
      wait = gap > 12 ? 2 : 4;
      if (dir > 0) { if (tallyT > 70) tally = 0; tally += Math.min(step, gap); tallyT = 0; }
    }
  };

  api.draw = (g, xr, y) => {
    const txt = String(Math.max(0, shown ?? 0));
    const old = String(Math.max(0, prev));
    const digits = Math.max(2, txt.length);
    const w = 22 + digits * DIGIT_W + 2;
    api.width = w;
    const x0 = xr - w;
    const kick = stepT < 2 ? -1 : 0;
    panel(g, x0, y + kick, w, 22);
    // crystal: white on a step, otherwise its own colours; it bobs a pixel slowly
    drawIcon(g, 'shard', x0 + 2, y + 2 + kick, { scale: 1, tint: stepT < 2 ? 'white' : null });
    // the odometer window
    const wx = x0 + 22, wy = y + 4 + kick;
    const pad = txt.padStart(digits, ' '), padOld = old.padStart(digits, ' ');
    const roll = stepT < ROLL.length ? ROLL[stepT] : 1;
    g.save();
    g.beginPath(); g.rect(wx - 1, wy - 1, digits * DIGIT_W + 2, DIGIT_H + 3); g.clip();
    for (let i = 0; i < digits; i++) {
      const a = padOld[i], b = pad[i];
      const dx = wx + i * DIGIT_W;
      const colour = stepT < 2 ? 'white' : dir < 0 && stepT < 20 ? 'rose' : 'sky';
      if (a === b || roll >= 1) { if (b !== ' ') drawText(g, b, dx, wy, colour, { scale: 2, shadow: 'ink' }); continue; }
      const off = Math.round(roll * (DIGIT_H + 2)) * dir;
      if (a !== ' ') drawText(g, a, dx, wy - off, 'frost', { scale: 2, shadow: 'ink' });
      if (b !== ' ') drawText(g, b, dx, wy - off + (DIGIT_H + 2) * dir, colour, { scale: 2, shadow: 'ink' });
    }
    g.restore();
    // tally: "+n" hangs under the panel, then drops away and blinks out
    if (tally > 1 && tallyT < 80) {
      if (tallyT > 60 && (tallyT >> 1) & 1) return;
      const s = `+${tally}`;
      const ty = y + 24 + (tallyT < 4 ? 3 - tallyT : 0) + (tallyT > 60 ? (tallyT - 60) >> 2 : 0);
      drawText(g, s, xr - 3, ty, tallyT < 3 ? 'white' : 'frost', { align: 'right', outline: 'ink' });
    }
  };
  return api;
}
