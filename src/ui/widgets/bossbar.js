// Boss health bar: a framed iron bar with a gold drain trail behind the red, phase notches,
// a white flash when hit, and a fill-in animation on entry. Positioned at bottom-right
// in a compact 50-60% width layout. `drawBossBar` is the stateless renderer (the boss scene
// can call it with its own eased values); `BossBar` owns the easing and entrance animation.
//
//   drawBossBar(g, x, y, w, { name, hp, ghost, flash, fill, phase, phases, t, shake })
//   const bar = new BossBar(); bar.show('THE WARDEN', { phases: 3 }); bar.set(0.7); bar.hide();

import { css } from '../../render/palette.js';
import { drawText, textWidth } from '../../core/pixelfont.js';
import { NODE_BOSS, drawSprite, plate } from './sprites.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

export function drawBossBar(g, x, y, w, o) {
  const { name = 'BOSS', hp = 1, ghost = hp, flash = 0, fill = 1, phase = 1, phases = 3, t = 0, shake = 0 } = o;
  const h = 10;
  x = Math.round(x) + (shake ? (shake % 2 ? 1 : -1) : 0); y = Math.round(y);
  const a = Math.min(1, fill * 3);
  g.globalAlpha = a;
  // name row: skull, name, phase tag
  drawSprite(g, NODE_BOSS, x, y - 17, { outline: 'ink' });
  drawText(g, name, x + 12, y - 15, 'bone', { outline: 'ink' });
  const tag = `PHASE ${ROMAN[phase - 1] ?? phase}`;
  const tcol = phase >= phases ? 'red' : phase === 2 ? 'ember' : 'fog';
  drawText(g, tag, x + w - textWidth(tag), y - 15, tcol, { outline: 'ink' });
  g.globalAlpha = 1;
  // frame with iron end-caps
  plate(g, x - 3, y - 3, w + 6, h + 6, { edge: 'mist', light: 'slate', fill: 'ink', notch: true });
  g.fillStyle = css('night'); g.fillRect(x, y, w, h);
  const fw = Math.round(w * fill);
  const pw = Math.min(fw, Math.round(w * hp)), gw = Math.min(fw, Math.round(w * ghost));
  if (gw > pw) { g.fillStyle = css(flash > 0 ? 'white' : 'gold'); g.fillRect(x + pw, y, gw - pw, h); g.fillStyle = css('flame'); g.fillRect(x + pw, y + h - 2, gw - pw, 2); }
  const enraged = phase >= phases;
  const body = flash > 3 ? 'white' : enraged ? (t % 40 < 6 ? 'rose' : 'red') : 'red';
  g.fillStyle = css(body); g.fillRect(x, y, pw, h);
  if (flash <= 3) {
    g.fillStyle = css('blood'); g.fillRect(x, y + h - 3, pw, 3);
    g.fillStyle = css('rose'); g.fillRect(x, y, pw, 2);
    // a dithered sheen so the bar is never a flat slab
    g.fillStyle = css('red');
    for (let i = 0; i < pw; i += 2) g.fillRect(x + i, y + 2 + (i & 2 ? 0 : 0), 1, 1);
  }
  // the bar's leading edge
  if (pw > 1 && pw < w) { g.fillStyle = css('white'); g.fillRect(x + pw - 1, y + 1, 1, h - 2); }
  // phase notches
  g.fillStyle = css('ink');
  for (let k = 1; k < phases; k++) g.fillRect(x + Math.round((w * k) / phases) - 1, y - 3, 2, h + 6);
  g.fillStyle = css('mist');
  for (let k = 1; k < phases; k++) { const nx = x + Math.round((w * k) / phases); g.fillRect(nx - 1, y - 3, 1, 1); g.fillRect(nx - 1, y + h + 2, 1, 1); }
}

export class BossBar {
  constructor() { 
    this.on = false;
    this.hp = 1;
    this.ghost = 1;
    this.shown = 1;
    this.flash = 0;
    this.fill = 0;
    this.t = 0;
    this.name = 'BOSS';
    this.phases = 3;
    this.phase = 1;
    this.shake = 99;
    this.target = 1;
    this.entranceT = 99;  // ticks since show() was called; controls slide-in animation
    this.entranceShake = 0;
  }
  show(name, { phases = 3, hp = 1 } = {}) {
    this.on = true;
    this.name = name;
    this.phases = phases;
    this.target = hp;
    this.shown = this.ghost = hp;
    this.fill = 0;
    this.flash = 0;
    this.phase = this._phaseOf(hp);
    this.entranceT = 0;  // trigger entrance animation
    this.entranceShake = 0;
  }
  hide() { this.on = false; }
  _phaseOf(f) { return Math.min(this.phases, this.phases - Math.ceil(f * this.phases - 1e-6) + 1); }
  set(frac) {
    frac = Math.max(0, Math.min(1, frac));
    if (frac < this.target) { this.flash = 6; this.shake = 0; }
    this.target = frac;
  }
  tick() {
    this.t++;
    if (!this.on) { this.fill = Math.max(0, this.fill - 0.08); return; }
    this.fill = Math.min(1, this.fill + 0.04);
    if (this.flash > 0) this.flash--;
    if (this.shake < 99) this.shake++;
    if (this.entranceT < 99) this.entranceT++;
    this.shown += (this.target - this.shown) * 0.4;
    if (Math.abs(this.shown - this.target) < 0.002) this.shown = this.target;
    if (this.ghost > this.target) { if (this.flash === 0 || this.t % 1 === 0) this.ghost = Math.max(this.target, this.ghost - 0.0035); } else this.ghost = this.target;
    const p = this._phaseOf(this.target);
    if (p !== this.phase) { this.phase = p; this.flash = 10; }
  }
  draw(g, W, H) {
    if (!this.on && this.fill <= 0) return;
    
    // Wave 3: Reduced size (50-60% of original, now ~150-160px) and repositioned to bottom-right
    const w = Math.min(180, W * 0.55);
    
    // entrance animation: slide in from top-right (0..12 ticks, 0.2s), with scale-grow and shake
    let entranceX = 0;
    let entranceY = 0;
    let entranceAlpha = 1;
    if (this.entranceT < 12) {
      const k = this.entranceT / 12;  // 0..1 over 12 ticks
      const easeOut = 1 - (1 - k) * (1 - k);  // quadratic ease-out
      entranceX = Math.round((1 - easeOut) * 80);  // slides in from right
      entranceY = -Math.round((1 - easeOut) * 30);  // slides down from top
      entranceAlpha = easeOut;
      this.entranceShake = this.entranceT < 6 ? this.entranceT % 2 : 0;
    }
    
    // Position at bottom-right corner with margin
    const MARGIN = 12;
    const baseX = W - w - MARGIN - entranceX;
    const baseY = H - 26 - entranceY;
    
    g.globalAlpha = entranceAlpha;
    drawBossBar(g, baseX + this.entranceShake, baseY, w, { 
      name: this.name, hp: this.shown, ghost: this.ghost, flash: this.flash, fill: this.fill, 
      phase: this.phase, phases: this.phases, t: this.t, shake: this.shake < 6 ? this.shake : 0 
    });
    g.globalAlpha = 1;
  }
}
