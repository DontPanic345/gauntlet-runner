// The in-run HUD (piece `hud`). One call per scene that has a hero:
//
//   import { createHud, wardenSource } from '../ui/hud.js';
//   const hud = createHud({ health, runtime: prog.runtime, boss: wardenSource(fight) });
//   ui (after the scene's world-space UI, before prog.ui so the choice screen covers it): hud.ui(g)
//   exit: hud.dispose()
// It ticks itself on the 'tick' event (after the scene's tick), so scenes do not call tick().
//
// Layout at 640x360 (everything framed, integer pixels, palette colours, the 5x7 pixel font):
//   top left      hearts (drain, shatter, refill, low-health heartbeat) and the dash pip
//   top centre    the room track: 5 arenas, 4 corridors, the Warden; wave pips in an arena
//   top right     soul shards: an odometer that rolls up one shard at a time, "+n" tally
//   bottom left   held boons, with tooltips (a new boon opens its own; Tab cycles; mouse hover)
//   bottom centre the boss bar, when a boss source is given and it says show > 0
//   world         damage numbers (src/ui/damage-numbers.js)
//   screen edges  the low-health vignette, beating with the hearts
// Panels step aside: when the hero (or an enemy) walks under a panel, the panel dithers down
// to a quarter so the action is never covered. The panels slide in when the scene starts.
//
// Options: health (HeroHealth or () => it; default world.hero), ctl (default health.ctl),
//   runtime (the boons runtime or () => it), boss (() => bossSource | null), numbers (true),
//   track (true), intro (true: slide in), shards (true), boons (true),
//   waves (() => {wave, total, done} | null: overrides the active arena's wave pips)

import { events } from '../core/events.js';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { settings } from '../core/settings.js';
import { debug } from '../core/debug.js';
import { progress } from '../progression/boons.js';
import { getActiveArena } from '../world/arena.js';
import { WARDEN } from '../boss/warden.js';
import { createHearts } from './widgets/hearts.js';
import { createDash } from './widgets/dash.js';
import { createShards } from './widgets/shards.js';
import { createTrack } from './widgets/track.js';
import { createBoonRow } from './widgets/boons.js';
import { createBossBar } from './widgets/bossbar.js';
import { createVignette } from './widgets/vignette.js';
import { hudSfx } from './widgets/sfx.js';
import { panel, ditherFade, easeOut } from './widgets/draw.js';
import { createDamageNumbers } from './damage-numbers.js';

// Tab inspects boons; keep the browser from moving focus off the game.
if (typeof window !== 'undefined') addEventListener('keydown', (e) => { if (e.code === 'Tab') e.preventDefault(); });

let active = null;
export const activeHud = () => active;

export function createHud(opts = {}) {
  const O = { numbers: true, track: true, intro: true, shards: true, boons: true, ...opts };
  const val = (v) => (typeof v === 'function' ? v() : v);
  const heroOf = () => val(O.health) ?? world.hero;
  const ctlOf = () => val(O.ctl) ?? heroOf()?.ctl ?? null;

  const hearts = createHearts();
  const dash = createDash();
  const shards = createShards();
  const track = createTrack();
  const boons = createBoonRow();
  const bossBar = createBossBar();
  const vignette = createVignette();
  const numbers = O.numbers ? createDamageNumbers() : null;

  let t = 0, vig = 0, hidden = false;
  const fades = new Map();   // panel name -> 0..16 dither level
  const rects = {};          // panel name -> {x, y, w, h} (last drawn)
  let layer = null, lg = null;

  function tick() {
    t++;
    const h = heroOf();
    hearts.tick(h);
    dash.tick(ctlOf());
    shards.tick(progress.shards);
    const A = getActiveArena();
    const room = world.room;
    let waves = O.waves ? O.waves() : null;
    if (!O.waves && A && room?.kind === 'arena' && A.waves?.info) {
      const w = A.waves.info();
      waves = { wave: w.wave, total: w.total, done: ['clearing', 'open', 'exited'].includes(A.state) };
    }
    track.tick(room, waves);
    boons.tick({ runtime: val(O.runtime), mouse: mouseInternal(), loopTick: loop.tick });
    bossBar.tick(O.boss ? O.boss() : null);
    numbers?.tick();
    if (hearts.lub && settings.get('sfxVolume') > 0) hudSfx.beat(hearts.beatT === 0);
    // the vignette eases toward its target; the heartbeat drives it
    const fl = settings.get('flashes') ?? 1;
    const target = hearts.low ? 0.06 + (0.42 * hearts.beat + (hearts.lowT < 60 ? (1 - hearts.lowT / 60) * 0.5 : 0)) * fl : 0;
    vig += (target - vig) * (target > vig ? 0.6 : 0.12);
    if (vig < 0.01) vig = 0;
    // panels make way for the hero and enemies under them
    const boxes = actorBoxes();
    for (const name in rects) {
      const r = rects[name];
      const under = boxes.some((b) => b.x < r.x + r.w + 4 && b.x + b.w > r.x - 4 && b.y < r.y + r.h + 4 && b.y + b.h > r.y - 4);
      const f = fades.get(name) ?? 0;
      fades.set(name, under ? Math.min(10, f + 2) : Math.max(0, f - 1));
    }
  }

  function actorBoxes() {
    const out = [];
    const z = display.zoom;
    const c = ctlOf();
    if (c) { const p = display.worldToScreen(c.x, 0.6, c.z); out.push({ x: p.x - 9 * z, y: p.y - 22 * z, w: 18 * z, h: 30 * z }); }
    for (const e of world.enemies ?? []) {
      if (!e || e.dead || !Number.isFinite(e.x)) continue;
      const p = display.worldToScreen(e.x, 0.5, e.z);
      const r = Math.max(10, (e.r ?? 0.4) * 32) * z;
      out.push({ x: p.x - r, y: p.y - r * 2, w: r * 2, h: r * 2.4 });
    }
    return out;
  }

  function mouseInternal() {
    if (!input.mouse.inside || !input.mouseActive()) return null;
    const c = display.uiCanvas;
    if (!c) return null;
    const b = c.getBoundingClientRect();
    return { x: (input.mouse.x - b.left) / display.scale, y: (input.mouse.y - b.top) / display.scale };
  }

  const offTick = events.on('tick', tick);

  function ui(g) {
    const W = display.width, H = display.height;
    if (hidden) return;
    if (input.ui.key('Tab')) boons.inspect();
    // pick up changes this frame, so a hit reads inside its hitstop (no sim ticks run then)
    hearts.sync(heroOf());
    bossBar.sync(O.boss ? O.boss() : null);
    // world space first: the vignette, then numbers
    if (vig > 0) vignette.draw(g, W, H, Math.min(1, vig));
    numbers?.ui(g);
    // the panels go on a layer so they can dither aside
    if (!layer || layer.width !== W || layer.height !== H) {
      layer = document.createElement('canvas'); layer.width = W; layer.height = H;
      lg = layer.getContext('2d'); lg.imageSmoothingEnabled = false;
    }
    lg.clearRect(0, 0, W, H);
    const k = O.intro ? easeOut(t / 18) : 1;
    const k2 = O.intro ? easeOut((t - 5) / 18) : 1;
    // top left: hearts and dash
    const hx = 6, hy = 5 - Math.round((1 - k) * 40);
    const hw = Math.max(hearts.width, dash.width) + 10;
    panel(lg, hx - 2, hy - 2, hw + 2, 33, { rim: hearts.hurtT < 8 ? ((hearts.hurtT >> 1) & 1 ? 'red' : 'rose') : hearts.healT < 8 ? 'gold' : hearts.low && hearts.beat > 0.5 ? 'blood' : 'violet' });
    hearts.draw(lg, hx + 3, hy + 3);
    dash.draw(lg, hx + 3, hy + 18);
    rects.hearts = { x: hx - 2, y: Math.max(0, hy - 2), w: hw + 2, h: 33 };
    // top right: shards
    if (O.shards) {
      const sx = W - 6 + Math.round((1 - k2) * 80);
      shards.draw(lg, sx, 5);
      rects.shards = { x: sx - shards.width, y: 5, w: shards.width, h: 32 };
    }
    // top centre: the track
    if (O.track && track.node >= 0) {
      const ty = 9 - Math.round((1 - k2) * 40);
      track.draw(lg, Math.round(W / 2), ty);
      rects.track = { x: Math.round(W / 2 - track.width / 2), y: Math.max(0, ty - 6), w: track.width, h: 30 };
    } else delete rects.track;
    // bottom: boons and the boss bar
    if (O.boons) {
      const by = H - 5 + Math.round((1 - k2) * 50);
      boons.draw(lg, 8, by);
      const n = progress.order.length;
      if (n) { const rows = Math.ceil(n / 8), cols = Math.min(8, n); rects.boons = { x: 6, y: by - 30 - (rows - 1) * 32, w: cols * 24, h: rows * 32 }; } else delete rects.boons;
    }
    if (boons.tipRect) rects.tip = boons.tipRect; else delete rects.tip;
    bossBar.draw(lg, W, H);
    // dither aside the panels the action is under
    for (const [name, f] of fades) {
      const r = rects[name];
      if (!r || f <= 0) continue;
      ditherFade(lg, r.x - 2, r.y - 2, r.w + 4, r.h + 4, f);
    }
    g.drawImage(layer, 0, 0);
  }

  const api = {
    hearts, dash, shards, track, boons, bossBar, numbers,
    ui,
    tick,
    /** Set or clear the boss source: () => ({ name, hp, maxHp, ... }) | null. */
    setBoss(fn) { O.boss = fn; },
    set hidden(v) { hidden = !!v; }, get hidden() { return hidden; },
    info() {
      const h = heroOf();
      return {
        hp: h?.hp ?? null, maxHp: h?.maxHp ?? null, low: hearts.low, vignette: +vig.toFixed(2),
        shards: progress.shards, node: track.node, boons: [...progress.order], tip: boons.tip,
        boss: O.boss ? (O.boss()?.show > 0) : false, numbers: numbers?.texts ?? [],
        faded: [...fades].filter(([, f]) => f > 0).map(([n]) => n),
      };
    },
    dispose() {
      offTick();
      boons.dispose();
      numbers?.dispose();
      if (active === api) active = null;
    },
  };
  active = api;
  return api;
}

/** A boss-bar source for the Warden fight (src/boss/fight.js). */
export function wardenSource(fight) {
  return () => {
    const w = fight?.warden;
    if (!w) return null;
    const stag = w.state === 'stagger';
    const lockMax = WARDEN.stagger.ticks + WARDEN.poiseLock;
    return {
      name: WARDEN.name, hp: Math.max(0, w.hp), maxHp: w.maxHp, phase: w.phase, phaseName: WARDEN.phases[w.phase],
      phaseColor: w.phase === 3 ? 'red' : w.phase === 2 ? 'gold' : 'sky', notches: [2 / 3, 1 / 3],
      poise: Math.min(1, w.poiseHit / WARDEN.poise),
      stagger: stag ? Math.max(0, 1 - w.st / WARDEN.stagger.ticks) : null,
      locked: !stag && w.poiseLockT > 0 ? Math.min(1, w.poiseLockT / lockMax) : null,
      show: fight.bar?.show ?? 1,
    };
  };
}

// __GR.debug.hud(action?, ...):
//   ()                 the active HUD's info: hp, low, vignette, shards, track node, boons, tooltip, boss, numbers
//   ('hide') ('show')  hide or show the whole HUD (clean captures of the world)
//   ('inspect', i?)    open boon i's tooltip (or the next one), as Tab does
debug.add('hud', (action, a) => {
  const H = active;
  if (!H) return { ok: false, error: 'no hud in this scene (try ?scene=run, ?scene=boss or ?showcase=hud)' };
  if (action === 'hide') { H.hidden = true; return { ok: true }; }
  if (action === 'show') { H.hidden = false; return { ok: true }; }
  if (action === 'inspect') return { ok: true, id: H.boons.inspect(a ?? null) };
  return { ok: true, ...H.info() };
});
