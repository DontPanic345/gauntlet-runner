// Low-health vignette: a dithered red frame around the screen, thicker on each heartbeat.
// The dither masks are baked once per (size, level) into offscreen canvases (ordered Bayer 4x4,
// so the edge steps down in hard pixels, never a smooth gradient), then blitted.

import { css } from '../../render/palette.js';
import { settings } from '../../core/settings.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LEVELS = 10;
const layers = new Map();

function bake(w, h, level, colour) {
  const key = `${w}x${h}:${level}:${colour}`;
  let c = layers.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const th = 4 + level * 3;                       // reach in px
  const hexv = css(colour), rgb = [1, 3, 5].map((i) => parseInt(hexv.slice(i, i + 2), 16));
  const hot = css('red'), hrgb = [1, 3, 5].map((i) => parseInt(hot.slice(i, i + 2), 16));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // slightly rounded frame: distance from the edge shrinks in the corners
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (d >= th) continue;
      const cover = (1 - d / th) * 0.86;
      if (BAYER[(y & 3) * 4 + (x & 3)] / 16 >= cover) continue;
      const i = (y * w + x) * 4;
      const c2 = cover > 0.6 ? hrgb : rgb;
      img.data[i] = c2[0]; img.data[i + 1] = c2[1]; img.data[i + 2] = c2[2]; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  layers.set(key, c);
  if (layers.size > 40) layers.delete(layers.keys().next().value);
  return c;
}

/** intensity 0..1 picks the layer. Honours the `flashes` accessibility setting. */
export function drawVignette(g, W, H, intensity, colour = 'blood') {
  const f = settings.get('flashes');
  if (intensity <= 0.02 || f <= 0) return;
  const level = Math.min(LEVELS - 1, Math.round(intensity * f * (LEVELS - 1)));
  if (level <= 0 && intensity * f < 0.05) return;
  g.drawImage(bake(W, H, level, colour), 0, 0);
}

/** Screen-edge flash for low-health heartbeat: a red flash at the edges that pulses in sync. */
export function drawScreenEdgeFlash(g, W, H, intensity, edgeWidth = 12) {
  const f = settings.get('flashes');
  if (intensity <= 0.02 || f <= 0) return;
  const alpha = Math.min(1, intensity * f * 0.15);  // subtle, 10-15% max opacity
  if (alpha < 0.02) return;
  g.fillStyle = `rgba(255, 120, 100, ${alpha})`;
  // top edge
  g.fillRect(0, 0, W, edgeWidth);
  // bottom edge
  g.fillRect(0, H - edgeWidth, W, edgeWidth);
  // left edge
  g.fillRect(0, 0, edgeWidth, H);
  // right edge
  g.fillRect(W - edgeWidth, 0, edgeWidth, H);
}
