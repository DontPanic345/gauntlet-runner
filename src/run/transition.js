// Screen wipes (piece `run-flow`): the cover used between run segments (arena -> corridor ->
// arena -> ... -> boss) and the punctuation used at the end of the death and victory sequences.
// Pure 2D canvas, drawn on `display.ui` after everything else, so a segment can be disposed and
// rebuilt behind full cover without a visible pop or a loading screen (there isn't one: arenas
// and corridors build synchronously).

import { css } from '../render/palette.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2);

/** Two ink curtains sliding in from left/right with a glowing ember seam. k: 0 open .. 1 covered. */
export function drawCurtainWipe(g, W, H, k, { color = 'ink', seam = 'ember' } = {}) {
  const e = easeInOut(clamp01(k));
  const w = Math.round(e * (W / 2 + 6));
  if (w <= 0) return;
  g.fillStyle = css(color);
  g.fillRect(0, 0, w, H);
  g.fillRect(W - w, 0, w, H);
  if (e > 0.03 && e < 0.985) {
    g.fillStyle = css(seam);
    g.fillRect(Math.max(0, w - 2), 0, 2, H);
    g.fillRect(Math.min(W - 2, W - w), 0, 2, H);
    // a few embers drifting off the seam, deterministic (no allocation, no RNG state)
    for (let i = 0; i < 5; i++) {
      const ph = (i * 0.37 + k * 1.7) % 1;
      const y = Math.round(ph * H);
      const dx = Math.round(Math.sin((i + k * 6) * 2.1) * 3);
      g.fillStyle = css(i % 2 ? 'flame' : 'gold');
      g.fillRect(w + dx - 1, y, 1, 1);
      g.fillRect(W - w - dx, H - y, 1, 1);
    }
  }
}

/** Four ink bars closing from every edge toward the centre: a hard punctuation beat. */
export function drawIrisWipe(g, W, H, k, { color = 'ink' } = {}) {
  const e = clamp01(k);
  if (e <= 0) return;
  const bw = Math.round(e * (W / 2 + 4));
  const bh = Math.round(e * (H / 2 + 4));
  g.fillStyle = css(color);
  g.fillRect(0, 0, W, bh);
  g.fillRect(0, H - bh, W, bh);
  g.fillRect(0, 0, bw, H);
  g.fillRect(W - bw, 0, bw, H);
}

/**
 * A close -> hold -> open curtain wipe, timed in real seconds (so it stays a fixed length
 * regardless of `loop.timeScale`). `onCovered` fires once, at full coverage: the moment to
 * dispose the old segment and build the next one. `onDone` fires once the curtain has reopened.
 */
export class SegmentWipe {
  constructor({ closeS = 0.26, holdS = 0.10, openS = 0.30 } = {}) {
    this.closeS = closeS; this.holdS = holdS; this.openS = openS;
    this.phase = 'idle'; this.t = 0;
    this.onCovered = null; this.onDone = null; this._fired = false;
  }
  get active() { return this.phase !== 'idle'; }
  start({ onCovered = null, onDone = null } = {}) {
    this.phase = 'close'; this.t = 0; this._fired = false;
    this.onCovered = onCovered; this.onDone = onDone;
  }
  /** Coverage 0..1, for drawing. */
  get k() {
    if (this.phase === 'close') return clamp01(this.t / this.closeS);
    if (this.phase === 'hold') return 1;
    if (this.phase === 'open') return 1 - clamp01(this.t / this.openS);
    return 0;
  }
  update(realDt) {
    if (this.phase === 'idle') return;
    this.t += realDt;
    if (this.phase === 'close' && this.t >= this.closeS) {
      if (!this._fired) { this._fired = true; this.onCovered?.(); }
      this.phase = 'hold'; this.t = 0;
    } else if (this.phase === 'hold' && this.t >= this.holdS) {
      this.phase = 'open'; this.t = 0;
    } else if (this.phase === 'open' && this.t >= this.openS) {
      this.phase = 'idle'; this.t = 0;
      this.onDone?.();
    }
  }
  ui(g, W, H) { if (this.active) drawCurtainWipe(g, W, H, this.k); }
}
