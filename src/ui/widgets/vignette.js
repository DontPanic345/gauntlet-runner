// Low-health vignette (piece `hud`): at critical health the screen edges close in with an
// ordered-dither band of blood that swells on each heartbeat (lub, then a smaller dub) and
// ebbs between beats. Corners close in more than edge middles, so the centre of the screen,
// where the fight is, stays clear. No alpha: every pixel is either palette blood/red or clear.
// The pulse scales with the `flashes` setting; at 0 only a thin still band remains.
//
//   const v = createVignette();   v.draw(g, W, H, level0to1)

import { css } from '../../render/palette.js';
import { bayer } from './draw.js';

const LEVELS = 12;
const MAX_BAND = 26;

export function createVignette() {
  let W = 0, H = 0;
  const cache = new Map();

  function mask(level) {
    let c = cache.get(level);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const k = level / (LEVELS - 1);
    // a superellipse: r = 1 on the screen edge, more in the corners, so corners close in first
    const cx = (W - 1) / 2, cy = (H - 1) / 2, P = 5;
    const bandPx = 4 + k * (MAX_BAND - 4);
    const b = bandPx / cy;
    const [br, bg, bb] = rgb(css('blood')), [rr, rg, rb] = rgb(css('red'));
    const lim = Math.ceil(bandPx * 1.9) + 2;
    for (let y = 0; y < H; y++) {
      const ny = Math.abs(y - cy) / cy;
      const ey = Math.min(y, H - 1 - y);
      for (let x = 0; x < W; x++) {
        const ex = Math.min(x, W - 1 - x);
        if (ex > lim && ey > lim) { x = W - 2 - lim; continue; }
        const ax = Math.max(0, Math.abs(x - cx) - (cx - cy)) / cy;
        const r = (ax ** P + ny ** P) ** (1 / P);
        let f = (r - (1 - b)) / b;
        if (f <= 0) continue;
        f = Math.min(1, f) ** 1.7;
        if (bayer(x, y) >= f * 16) continue;
        const hot = k > 0.75 && f > 0.9;
        const i = (y * W + x) * 4;
        d[i] = hot ? rr : br; d[i + 1] = hot ? rg : bg; d[i + 2] = hot ? rb : bb; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    cache.set(level, c);
    return c;
  }

  return {
    draw(g, w, h, level) {
      if (level <= 0) return;
      if (w !== W || h !== H) { W = w; H = h; cache.clear(); }
      const L = Math.max(0, Math.min(LEVELS - 1, Math.round(level * (LEVELS - 1))));
      if (L === 0 && level < 0.04) return;
      g.drawImage(mask(L), 0, 0);
    },
  };
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
