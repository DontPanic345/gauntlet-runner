// Health hearts with a damage drain, plus the dash pips that sit under them.
//
// One heart per hit point. Each heart keeps its own `fill` (the truth) and `ghost` (the pale
// trail behind it). Losing a heart: the heart flashes white and shakes, its shell bursts into
// bits, and the pale ghost holds for a beat, then drains away downward. Healing: the heart
// refills from the bottom with a hop and a sparkle, staggered along the row.
//
// Low health (hp <= 1, or a quarter of max): the last heart beats "lub-dub" with an echo ring,
// and `beat` (0..1) is exposed so the vignette can pulse in step.

import { css } from '../../render/palette.js';
import { settings } from '../../core/settings.js';
import { events } from '../../core/events.js';
import { HEART, HEART_EMPTY, PIP, PIP_EMPTY, drawSprite, drawRing, plate, plus } from './sprites.js';

const HW = 9, HH = 8, STEP = 11, PAD = 4, PER_ROW = 10;
const BEAT_LEN = 54, BEAT2 = 11;
const env = (t, at, len) => (t < at || t > at + len ? 0 : 1 - (t - at) / len);

export class Hearts {
  constructor() {
    this.hearts = [];
    this.bits = [];
    this.shakeT = 99;
    this.beatT = 0;
    this.beat = 0;          // 0..1 pulse envelope, for the vignette
    this.low = false;
    this.lastHp = null;
    this.lastMax = null;
    this.t = 0;
    // dash pips
    this.pipFill = [];      // per pip 0..1
    this.pipFlash = [];     // ticks since the pip became ready
    this.pipSpent = [];     // ticks since the pip was spent
    this.pipWasReady = [];
  }

  width() { return PAD * 2 + Math.min(this.hearts.length, PER_ROW) * STEP - (STEP - HW); }
  height() { return PAD * 2 + Math.ceil(Math.max(1, this.hearts.length) / PER_ROW) * (HH + 3) - 3 + 1; }

  _burst(x, y, n, cols, speed = 1.4, up = 1) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + i * 0.7;
      this.bits.push({ x, y, vx: Math.cos(a) * speed * (0.6 + (i % 3) * 0.3), vy: Math.sin(a) * speed * 0.8 - up, life: 16 + (i % 4) * 4, c: cols[i % cols.length], g: 0.12 });
    }
  }

  /** Feed the current values every tick. */
  tick(hp, maxHp, dash) {
    this.t++;
    hp = Math.max(0, Math.round(hp)); maxHp = Math.max(1, Math.round(maxHp));
    const first = this.lastHp === null;
    // resize
    while (this.hearts.length < maxHp) this.hearts.push({ fill: first ? (this.hearts.length < hp ? 1 : 0) : 0, ghost: first ? (this.hearts.length < hp ? 1 : 0) : 0, hold: 0, flashT: 99, popT: this.t && !first ? 0 : 99, delay: 0, shake: 99, want: first && this.hearts.length < hp ? 1 : 0 });
    if (this.hearts.length > maxHp) this.hearts.length = maxHp;
    let lostN = 0, gainN = 0;
    this.hearts.forEach((h, i) => {
      const want = i < hp ? 1 : 0;
      if (want !== h.want) {
        h.want = want;
        if (!want) {           // lost
          h.fill = 0; h.ghost = 1; h.hold = 24 + lostN * 2; h.flashT = -lostN * 3; h.shake = -lostN * 3; h.burst = -lostN * 3; lostN++;
        } else {               // gained
          h.delay = gainN * 4; h.gain = true; gainN++;
        }
      }
      if (h.gain) {
        if (h.delay > 0) h.delay--;
        else {
          if (h.popT >= 99 || h.fill === 0) { h.popT = 0; h.flashT = 0; this._burst(this._cx(i), this._cy(i), 6, ['white', 'rose', 'gold'], 1.1, 1.5); }
          h.fill = Math.min(1, h.fill + 0.14);
          h.ghost = Math.max(h.ghost, h.fill);
          if (h.fill >= 1) h.gain = false;
        }
      }
      // lost-heart timers (negative = waiting for its stagger)
      if (h.flashT < 99) h.flashT++;
      if (h.shake < 99) h.shake++;
      if (h.burst !== undefined) { h.burst++; if (h.burst === 0) { this._burst(this._cx(i), this._cy(i), 9, ['white', 'red', 'rose', 'blood'], 1.7, 0.6); h.burst = undefined; } }
      if (h.popT < 99) h.popT++;
      // ghost drains after its hold
      if (!h.want && h.ghost > 0) { if (h.hold > 0) h.hold--; else h.ghost = Math.max(0, h.ghost - 1 / 22); }
      if (h.want && !h.gain) h.ghost = h.fill = 1;
    });
    if (!first && hp < this.lastHp) this.shakeT = 0; else if (this.shakeT < 99) this.shakeT++;
    if (!first && hp > this.lastHp) this.healT = 0; else if (this.healT !== undefined && this.healT < 99) this.healT++;
    this.lastHp = hp; this.lastMax = maxHp;

    // heartbeat
    const low = hp > 0 && (hp <= 1 || hp / maxHp <= 0.25);
    if (low && !this.low) this.beatT = 0;
    this.low = low;
    if (low) {
      const prev = this.beatT;
      this.beatT = (this.beatT + 1) % BEAT_LEN;
      if (this.beatT === 0 || (prev < BEAT2 && this.beatT >= BEAT2)) events.emit('hud:heartbeat', { strong: this.beatT === 0 });
      this.beat = Math.max(env(this.beatT, 0, 9), env(this.beatT, BEAT2, 9) * 0.6);
    } else { this.beatT = 0; this.beat *= 0.8; if (this.beat < 0.02) this.beat = 0; }

    // bits
    for (const b of this.bits) { b.x += b.vx; b.y += b.vy; b.vy += b.g; b.vx *= 0.96; b.life--; }
    this.bits = this.bits.filter((b) => b.life > 0);

    this._tickDash(dash);
  }

  _tickDash(d) {
    const n = d.max;
    while (this.pipFill.length < n) { this.pipFill.push(1); this.pipFlash.push(99); this.pipSpent.push(99); this.pipWasReady.push(true); }
    this.pipFill.length = this.pipFlash.length = this.pipSpent.length = this.pipWasReady.length = n;
    for (let i = 0; i < n; i++) {
      const ready = d.charges > i;
      const target = i < d.charges ? 1 : i === d.charges ? d.progress : 0;
      if (this.pipWasReady[i] && !ready) this.pipSpent[i] = 0;
      if (!this.pipWasReady[i] && ready) this.pipFlash[i] = 0;
      this.pipWasReady[i] = ready;
      // fill follows in whole steps so it reads as a chunky bar, not a smear
      this.pipFill[i] = ready ? 1 : target;
      if (this.pipFlash[i] < 99) this.pipFlash[i]++;
      if (this.pipSpent[i] < 99) this.pipSpent[i]++;
    }
  }

  _cx(i) { return this.ox + PAD + (i % PER_ROW) * STEP + HW / 2; }
  _cy(i) { return this.oy + PAD + Math.floor(i / PER_ROW) * (HH + 3) + HH / 2; }

  /** Draw at (x, y). Returns { w, h } of the whole widget (hearts plate plus the dash row). */
  draw(g, x, y) {
    const shk = settings.get('shake');
    let sx = 0, sy = 0;
    if (this.shakeT < 10 && shk > 0) { sx = (this.shakeT % 2 ? 1 : -1) * (this.shakeT < 5 ? 2 : 1); sy = 0; }
    this.ox = Math.round(x) + sx; this.oy = Math.round(y) + sy;
    const w = this.width(), h = this.height();
    plate(g, this.ox, this.oy, w, h, { edge: this.low ? 'blood' : 'slate', light: this.low ? 'plum' : 'violet' });
    const lowPulse = this.low ? this.beat : 0;
    // the last living heart is the one that beats
    let lastIdx = -1;
    this.hearts.forEach((hh, i) => { if (hh.want) lastIdx = i; });

    this.hearts.forEach((hh, i) => {
      const hx = this.ox + PAD + (i % PER_ROW) * STEP, hy = this.oy + PAD + Math.floor(i / PER_ROW) * (HH + 3);
      let dy = 0, dx = 0;
      if (hh.popT < 10) dy = -Math.round(Math.sin(Math.min(1, hh.popT / 9) * Math.PI) * 2);
      const beating = this.low && i === lastIdx;
      if (beating && lowPulse > 0.5) dy -= 1;
      if (hh.shake >= 0 && hh.shake < 8) dx = (hh.shake % 2 ? 1 : -1) * (hh.shake < 4 ? 1 : 0);
      drawSprite(g, HEART_EMPTY, hx + dx, hy + dy, { outline: 'ink' });
      // the ghost: what you had, pale, draining downward
      if (hh.ghost > hh.fill + 0.001) {
        const rows = Math.ceil(hh.ghost * HH);
        drawSprite(g, HEART, hx + dx, hy + dy, { flash: hh.ghost > 0.5 ? 'bone' : 'frost', minRow: HH - rows, outline: null });
      }
      if (hh.fill > 0.001) {
        const rows = Math.ceil(hh.fill * HH);
        const flash = hh.flashT >= 0 && hh.flashT < 4 ? 'white' : null;
        drawSprite(g, HEART, hx + dx, hy + dy, { flash, minRow: HH - rows, outline: null, map: beating && lowPulse > 0.55 ? { r: 'rose', b: 'red' } : null });
        // a moving glint on full hearts, so the row is never quite still
      } else if (hh.flashT >= 0 && hh.flashT < 3) {
        drawSprite(g, HEART, hx + dx, hy + dy, { flash: 'white', outline: null });
      }
      if (beating && lowPulse > 0.25) {
        drawRing(g, HEART, lowPulse > 0.7 ? 1 : 2, hx + dx, hy + dy, lowPulse > 0.7 ? 'red' : 'blood');
      }
    });

    // bits
    for (const b of this.bits) {
      g.fillStyle = css(b.life < 5 && b.c === 'white' ? 'frost' : b.c);
      g.fillRect(Math.round(b.x), Math.round(b.y), b.life > 9 ? 2 : 1, b.life > 9 ? 2 : 1);
    }
    // heal sparkles ride above the plate
    if (this.healT !== undefined && this.healT < 12 && this.healT % 3 === 0) {
      plus(g, this.ox + w - 6 - (this.healT % 6) * 4, this.oy - 2 - (this.healT >> 1), 'white', 1);
    }

    // dash pips, in their own little strip under the plate
    const n = this.pipFill.length;
    let totalH = h;
    if (n) {
      const pw = n * 11 + 3, py = this.oy + h + 2;
      plate(g, this.ox, py, pw, 11);
      for (let i = 0; i < n; i++) {
        const px = this.ox + 3 + i * 11, pyy = py + 3;
        const f = this.pipFill[i];
        const sp = this.pipSpent[i], fl = this.pipFlash[i];
        drawSprite(g, PIP_EMPTY, px, pyy, { outline: 'ink' });
        if (f > 0.001) {
          const cols = Math.ceil(f * 9);
          drawSprite(g, PIP, px, pyy, { maxCol: cols - 1, outline: null, flash: f >= 1 && fl < 3 ? 'white' : null, map: f < 1 ? { c: 'teal', s: 'cyan', w: 'sky', u: 'navy' } : null });
        }
        if (sp < 3) drawSprite(g, PIP, px, pyy, { flash: 'white', outline: null });
        if (fl < 8) drawRing(g, PIP, fl < 4 ? 1 : 2, px, pyy, fl < 4 ? 'sky' : 'cyan');
      }
      totalH = h + 2 + 11;
    }
    return { w: Math.max(w, n * 11 + 3), h: totalH };
  }
}
