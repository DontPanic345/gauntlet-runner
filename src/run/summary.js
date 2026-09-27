// The run summary screen (piece `run-flow`): shared between the `gameover` and `victory`
// scenes. Time, kills, deepest room reached, boons taken, the seed (so a run can be shared or
// replayed), the best victory time, and any lore line unlocked this run.

import { display } from '../core/display.js';
import { drawText, textWidth, wrapText } from '../core/pixelfont.js';
import { drawPanel, drawGem, ease, clamp01 } from '../ui/menus.js';
import { drawIcon } from '../progression/icons.js';
import { BOONS, RARITY } from '../progression/boons.js';
import { input } from '../core/input.js';

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60), ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/** `stats`: see run.js's `finishRun` for the exact shape. `t`: seconds since this scene opened. */
export function drawSummary(g, stats, t) {
  const W = display.width, H = display.height;
  const pop = ease.out(clamp01(t / 0.4));
  const oy = Math.round((1 - pop) * 16);
  const panelW = 304, panelH = 254;
  const x = Math.round((W - panelW) / 2), y = Math.round((H - panelH) / 2) + oy - 6;
  const gold = stats.victory;

  g.globalAlpha = pop;
  drawPanel(g, x, y, panelW, panelH, { edge: gold ? 'gold' : 'blood' });
  drawGem(g, x + 10, y + 10, gold ? 'gold' : 'rose'); drawGem(g, x + panelW - 10, y + 10, gold ? 'gold' : 'rose');

  let cy = y + 14;
  drawText(g, gold ? 'GAUNTLET CLEARED' : 'YOU FELL', Math.round(W / 2), cy, gold ? 'gold' : 'rose', { align: 'center', scale: 2, outline: 'ink' });
  cy += 21;
  const sub = gold ? 'ZONE I CONQUERED' : (stats.causeLabel || 'the dark claimed you').toUpperCase();
  drawText(g, sub, Math.round(W / 2), cy, gold ? 'bone' : 'red', { align: 'center', shadow: 'ink' });
  cy += 12;
  g.fillStyle = 'rgba(0,0,0,0)';
  const ruleW = Math.round(textWidth(sub) * 0.8);
  g.fillStyle = gold ? '#ffd86b' : '#c4323f';
  g.fillRect(Math.round(W / 2 - ruleW / 2), cy, ruleW, 1);
  cy += 10;

  const row = (label, value, color = 'bone') => {
    drawText(g, label, x + 16, cy, 'fog');
    drawText(g, value, x + panelW - 16 - textWidth(value), cy, color, { shadow: 'ink' });
    cy += 13;
  };
  row('TIME SURVIVED', fmtTime(stats.time));
  row('KILLS', String(stats.kills));
  row('REACHED', stats.deepestLabel || '-');
  if (stats.bestTime != null) row('BEST VICTORY TIME', fmtTime(stats.bestTime) + (stats.isNewBest ? '  NEW!' : ''), stats.isNewBest ? 'gold' : 'fog');
  cy += 5;

  drawText(g, `BOONS TAKEN (${stats.boons.length})`, x + 16, cy, 'fog');
  cy += 12;
  if (!stats.boons.length) {
    drawText(g, 'NONE - A CLEAN RUN', x + 16, cy, 'slate');
    cy += 17;
  } else {
    let bx = x + 18;
    const iconY = cy;
    for (const b of stats.boons) {
      const def = BOONS[b.id];
      if (!def) continue;
      const r = RARITY[def.rarity];
      g.fillStyle = 'rgba(0,0,0,0.001)';
      drawIcon(g, b.id, bx, iconY, 2);
      if (b.level > 1) drawText(g, `x${b.level}`, bx + 13, iconY + 6, r?.hi ?? 'frost', { scale: 1 });
      bx += 22;
      if (bx > x + panelW - 24) { bx = x + 18; cy += 20; }
    }
    cy += 22;
  }

  drawText(g, 'SEED', x + 16, cy, 'fog');
  const seedStr = String(stats.seed);
  drawText(g, seedStr, x + panelW - 16 - textWidth(seedStr), cy, 'sky', { shadow: 'ink' });
  cy += 13;
  drawText(g, 'SHARE THIS NUMBER TO RUN THE SAME GAUNTLET', x + 16, cy, 'slate');
  cy += 15;

  if (stats.newLore && stats.newLore.length) {
    const l = stats.newLore[0];
    drawText(g, 'LORE UNLOCKED', x + 16, cy, 'gold');
    cy += 12;
    for (const line of wrapText(`"${l.text}"`, panelW - 32)) { drawText(g, line, x + 16, cy, 'frost'); cy += 11; }
  }
  g.globalAlpha = 1;

  if (pop > 0.6) {
    const fa = clamp01((pop - 0.6) / 0.4);
    g.globalAlpha = fa;
    const footer = `${input.describe('confirm') || 'ENTER'}: RUN AGAIN   ${input.describe('interact') || 'E'}: SAME SEED   ${input.describe('cancel') || 'ESC'}: TITLE`;
    drawText(g, footer, Math.round(W / 2), y + panelH + 13, 'mist', { align: 'center', shadow: 'ink' });
    g.globalAlpha = 1;
  }
}
