// Fixed-timestep main loop: 60 Hz simulation, interpolated rendering.
//
// Every frame (requestAnimationFrame):
//   1. frame(realDt)   : always runs, even when paused. Menus, UI, pause screen.
//   2. tick() * n      : 0..MAX_STEPS sim ticks at exactly DT seconds each. The only place
//                        game state changes. Skipped entirely while paused or in hitstop.
//   3. render(alpha)   : draw. alpha in [0,1) is how far real time is between the previous
//                        and current sim state; lerp positions with it (see lerp helpers).
//
// timeScale (debug slow-motion) scales how fast sim time accrues, not DT: a tick is always
// 1/60 s of game time, so gameplay code never sees a different dt.

export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;
const MAX_FRAME = 0.1; // seconds; a longer frame (tab switch, GC) is clamped, not caught up
const MAX_STEPS = 6;

export const loop = {
  tick: 0,            // sim ticks run since boot (window.__GR.frame)
  frameCount: 0,      // rendered frames since boot
  alpha: 0,
  timeScale: 1,
  paused: false,
  stepsLastFrame: 0,
  realTime: 0,        // seconds since boot, real
  simTime: 0,         // seconds of sim time (tick * DT)
  fps: 60,            // smoothed rendered frames per second
  frameMs: 16.7,      // last real frame duration in ms
  history: new Float32Array(120), // recent frame durations (ms) for pacing graphs
  historyIndex: 0,
  _acc: 0,
  _hitstop: 0,        // real seconds of hitstop remaining
  _manualSteps: 0,
  _hooks: null,
  _last: 0,

  /**
   * @param {{frame?: (realDt:number)=>void, tick: ()=>void, render: (alpha:number, realDt:number)=>void}} hooks
   */
  start(hooks) {
    this._hooks = hooks;
    this._last = performance.now();
    const onFrame = (now) => {
      requestAnimationFrame(onFrame);
      this._frame(now);
    };
    requestAnimationFrame(onFrame);
  },

  _frame(now) {
    let realDt = (now - this._last) / 1000;
    this._last = now;
    if (!(realDt >= 0)) realDt = 0;
    this.frameMs = realDt * 1000;
    this.history[this.historyIndex] = this.frameMs;
    this.historyIndex = (this.historyIndex + 1) % this.history.length;
    if (this.frameCount % 15 === 0) {
      // fps from the mean of the last 60 real frame durations (matches the pacing graph)
      let sum = 0, n = 0;
      for (let i = 1; i <= 60; i++) {
        const v = this.history[(this.historyIndex - i + this.history.length) % this.history.length];
        if (v > 0) { sum += v; n++; }
      }
      if (n) this.fps = 1000 / (sum / n);
    }
    realDt = Math.min(realDt, MAX_FRAME);
    this.realTime += realDt;

    const h = this._hooks;
    h.frame?.(realDt);

    let steps = 0;
    if (this._manualSteps > 0) {
      // debug.step(): run exact ticks even while paused
      while (this._manualSteps > 0 && steps < 60) { this._runTick(); this._manualSteps--; steps++; }
      this._acc = 0;
    } else if (!this.paused) {
      if (this._hitstop > 0) {
        this._hitstop -= realDt;
        this._acc = 0;
      } else {
        this._acc += realDt * this.timeScale;
        while (this._acc >= DT && steps < MAX_STEPS) {
          this._runTick();
          this._acc -= DT;
          steps++;
        }
        if (steps === MAX_STEPS) this._acc = Math.min(this._acc, DT);
      }
    }
    this.stepsLastFrame = steps;
    this.alpha = this.paused || this._hitstop > 0 ? this.alpha : Math.min(this._acc / DT, 1);
    h.render(this.alpha, realDt);
    this.frameCount++;
  },

  _runTick() {
    this.tick++;
    this.simTime = this.tick * DT;
    this._hooks.tick();
  },

  /** Freeze the sim for `ms` real milliseconds (hit-stop). Overlapping calls take the max. */
  hitstop(ms) { this._hitstop = Math.max(this._hitstop, ms / 1000); },
  get inHitstop() { return this._hitstop > 0; },

  setTimeScale(s) { this.timeScale = Math.max(0, Math.min(4, Number(s) || 0)); return this.timeScale; },

  /** Run exactly n sim ticks on the next frame, whether paused or not (deterministic captures). */
  step(n = 1) { this._manualSteps += Math.max(0, n | 0); },
};

// ---- interpolation helpers -------------------------------------------------------------

export const lerp = (a, b, t) => a + (b - a) * t;

/** Shortest-path angle lerp (radians). */
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Interpolated scalar/vec state. Call snap() at the start of each tick (copies cur -> prev),
 * mutate .cur during the tick, read at(alpha) when rendering.
 *   const p = new Interp({x:0, z:0});  // tick: p.snap(); p.cur.x += vx*DT;  render: p.at(alpha).x
 */
export class Interp {
  constructor(init) {
    this.cur = { ...init };
    this.prev = { ...init };
    this._out = { ...init };
    this.angles = new Set();
  }
  /** Mark keys that are angles (lerped the short way round). */
  angle(...keys) { keys.forEach((k) => this.angles.add(k)); return this; }
  snap() { Object.assign(this.prev, this.cur); }
  /** Teleport: no interpolation smear on the next frame. */
  set(values) { Object.assign(this.cur, values); Object.assign(this.prev, values); }
  at(alpha) {
    for (const k in this.cur) {
      this._out[k] = this.angles.has(k) ? lerpAngle(this.prev[k], this.cur[k], alpha) : lerp(this.prev[k], this.cur[k], alpha);
    }
    return this._out;
  }
}
