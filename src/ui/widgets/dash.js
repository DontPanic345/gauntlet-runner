// Dash pip (piece `hud`): under the hearts. A small chevron and a capsule that shows the
// dash's state at a glance:
//   ready      sky, with a 1px glint that walks along it now and then
//   dashing    white while the dash's i-frames are up, then empty
//   cooldown   refills left to right in navy -> blue
//   ready!     the moment it is back: a white flash, a 1px hop, and a glint sweep
//
//   const d = createDash();   d.tick(ctl)   d.draw(g, x, y)   d.width

import { rect, cutRect, sprite } from './draw.js';

const CHEV = sprite(['k.k..', 'sk.k.', '.sk.k', 'sk.k.', 'k.k..'].map((r) => r.replace(/k/g, 'x')), { x: 'sky', s: 'teal' });
const CHEV_DIM = sprite(['k.k..', 'sk.k.', '.sk.k', 'sk.k.', 'k.k..'].map((r) => r.replace(/k/g, 'x')), { x: 'slate', s: 'violet' });
const W = 30, H = 5;

export function createDash() {
  let fill = 1, readyT = 99, coolMax = 1, state = 'ready', iframe = false, t = 0;
  const api = { width: W + 8 };
  api.tick = (ctl) => {
    t++;
    readyT++;
    if (!ctl) return;
    const was = state;
    if (ctl.state === 'dash') { state = 'dash'; fill = 0; iframe = !!ctl.invulnerable; }
    else if (ctl.cooldown > 0) {
      if (was !== 'cool') coolMax = Math.max(1, ctl.cooldown);
      state = 'cool';
      fill = 1 - ctl.cooldown / coolMax;
      iframe = false;
    } else { state = 'ready'; fill = 1; iframe = false; }
    if (state === 'ready' && was !== 'ready') readyT = 0;
  };
  api.draw = (g, x, y) => {
    const hop = readyT < 4 ? -1 : 0;
    g.drawImage(state === 'ready' ? CHEV : CHEV_DIM, x, y + hop);
    const bx = x + 7, by = y + hop;
    cutRect(g, 'ink', bx - 1, by - 1, W + 2, H + 2, 1);
    rect(g, 'shadow', bx, by, W, H);
    if (state === 'dash') {
      if (iframe) { rect(g, 'white', bx, by, W, H); }
    } else if (state === 'cool') {
      const fw = Math.round(W * fill);
      rect(g, 'navy', bx, by, fw, H);
      rect(g, 'blue', bx, by, fw, 1);
      if (fw > 0 && fw < W) rect(g, 'sky', bx + fw - 1, by, 1, H);
    } else {
      const flash = readyT < 3;
      rect(g, flash ? 'white' : 'cyan', bx, by, W, H);
      rect(g, flash ? 'white' : 'sky', bx, by, W, 2);
      rect(g, flash ? 'white' : 'teal', bx, by + H - 1, W, 1);
      // a glint sweeps along on recharge, and idly every few seconds
      const sweep = readyT < 14 ? readyT * 3 : ((t % 200) < 12 ? (t % 200) * 3 : -9);
      if (sweep >= 0 && sweep < W + 4) for (let k = 0; k < 2; k++) {
        const gx = sweep - k * 2;
        if (gx >= 0 && gx < W) rect(g, 'white', bx + gx, by + 1, 1, H - 2);
      }
    }
  };
  return api;
}
