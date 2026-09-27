// The in-run HUD (piece `hud`): hearts with damage drain, dash pip, shard counter, boon row with
// tooltips, room-progress track, boss bar, damage numbers, and the low-health vignette.
//
//   import { createHud } from '../ui/hud.js';
//   const hud = createHud({ hero: () => world.hero, ctl, prog });   // ctl and prog are optional
//   tick()  { ...; hud.tick(); }          // every sim tick (after combat.tick / prog.tick)
//   ui(g)   { ...world-space UI...; hud.ui(g); }
//   exit()  { hud.dispose(); }
//
// Sources (all optional, all overridable so any scene can feed it):
//   hero    () => { hp, maxHp, x, z }      default: world.hero
//   ctl     the HeroController (dash cooldown)
//   prog    createProgression(...) result  (boons.list(), boons.synergies(), pickups.total)
//   boons   () => [{ id, level, ...boonDef }]   shards () => number       (instead of prog)
//
// Follows the game by events: arena:enter|wave|wavesDone|clear, gauntlet:enter|go|escape|exit,
// boss:intro|fightStart. Or drive it directly: hud.track.goto(n), hud.boss.show('NAME'), ...
// Elements dim while the hero stands behind them, so the HUD never covers the action.

import { display } from '../core/display.js';
import { events } from '../core/events.js';
import { input } from '../core/input.js';
import { world } from '../core/world.js';
import { Hearts } from './widgets/hearts.js';
import { Shards } from './widgets/shards.js';
import { BoonRow } from './widgets/boonrow.js';
import { Track } from './widgets/track.js';
import { BossBar } from './widgets/bossbar.js';
import { drawVignette } from './widgets/vignette.js';
import { createDamageNumbers } from './damage-numbers.js';

export { drawBossBar, BossBar } from './widgets/bossbar.js';
export { createDamageNumbers } from './damage-numbers.js';

const MARGIN = 8;
let current = null;
export const currentHud = () => current;

export function createHud({ hero = () => world.hero, ctl = null, prog = null, boons = null, shards = null, numbers = true, route = null, track = true } = {}) {
  const hearts = new Hearts();
  const shardW = new Shards(0);
  const boonRow = new BoonRow();
  const trackW = new Track(route ?? undefined);
  const boss = new BossBar();
  const nums = numbers ? createDamageNumbers() : null;
  const offs = [];
  const alpha = { hearts: 1, shards: 1, boons: 1, track: 1 };
  const rects = {};
  let vig = 0;
  let hidden = false;
  const hud = {
    hearts, shards: shardW, boons: boonRow, track: trackW, boss, numbers: nums,
    showTrack: track,
    get visible() { return !hidden; },
    set visible(v) { hidden = !v; },
    vignette: true,
    _dim: alpha,
  };

  const on = (n, f) => offs.push(events.on(n, f));
  const arena = (i) => Math.max(0, (i ?? 0)) * 2;
  const arenaTotal = () => Math.ceil(trackW.route.filter((k) => k === 'arena').length);
  on('arena:enter', (e) => { trackW.goto(arena(e.index)); trackW.alarm = false; trackW.label = `ARENA ${(e.index ?? 0) + 1}/${arenaTotal()}`; });
  on('arena:wave', (e) => { trackW.goto(arena(e.index)); trackW.setProgress((e.n - 1) / Math.max(1, e.total)); trackW.label = `ARENA ${(e.index ?? 0) + 1}/${arenaTotal()}  WAVE ${e.n}/${e.total}`; });
  on('arena:wavesDone', () => trackW.setProgress(1));
  on('arena:clear', (e) => { trackW.clear(arena(e.index)); trackW.setProgress(1); trackW.label = 'CLEARED'; });
  on('gauntlet:enter', (e) => { trackW.goto(arena(e.index) + 1); trackW.label = 'THE GAUNTLET'; trackW.alarm = false; });
  on('gauntlet:go', () => { trackW.label = 'RUN! THE ROOF IS COMING DOWN'; trackW.alarm = true; });
  on('gauntlet:escape', (e) => { trackW.clear(arena(e.index) + 1); trackW.setProgress(1); trackW.alarm = false; trackW.label = 'ESCAPED'; });
  on('boss:intro', () => { trackW.goto(trackW.route.length - 1); trackW.label = 'THE WARDEN'; trackW.alarm = false; });
  on('boss:fightStart', () => { trackW.goto(trackW.route.length - 1); trackW.label = 'THE WARDEN'; });

  // Tab cycles the boon tooltips (keyboard-only players); the page must not steal focus.
  const onKey = (e) => {
    if (e.code !== 'Tab' || e.repeat) return;
    e.preventDefault();
    boonRow.cycle();
  };
  addEventListener('keydown', onKey);
  offs.push(() => removeEventListener('keydown', onKey));

  const dashInfo = () => {
    if (!ctl || !ctl.T) return { max: 0, charges: 0, progress: 0 };
    const cd = ctl.T.dashCooldown || 1;
    const ready = ctl.dashReady;
    const progress = ctl.state === 'dash' ? 0 : ready ? 1 : Math.max(0, Math.min(0.999, 1 - ctl.cooldown / cd));
    return { max: ctl.T.dashCharges ?? 1, charges: ready ? 1 : 0, progress };
  };
  const boonList = () => (boons ? boons() : prog ? prog.boons.list() : []);
  const shardCount = () => (shards ? shards() : prog ? prog.pickups.total : 0);
  const synergies = () => (prog ? prog.boons.synergies() : []);

  hud.tick = function tick() {
    const h = hero();
    if (h) hearts.tick(h.hp, h.maxHp, dashInfo());
    shardW.tick(shardCount());
    boonRow.tick(boonList(), synergies());
    trackW.tick();
    boss.tick();
    nums?.tick();
    // vignette: eased in while low, pulsing on the beat
    const want = hearts.low ? 0.32 + hearts.beat * 0.68 : 0;
    vig += (want - vig) * (want > vig ? 0.5 : 0.1);
    // dim any element the hero is standing behind
    if (h) {
      const p = display.worldToScreen(h.x, 0.6, h.z);
      const zone = { x: p.x - 14, y: p.y - 34 * display.zoom, w: 28, h: 46 * display.zoom };
      for (const k of Object.keys(alpha)) {
        const r = rects[k];
        const hit = r && zone.x < r.x + r.w + 4 && zone.x + zone.w > r.x - 4 && zone.y < r.y + r.h + 4 && zone.y + zone.h > r.y - 4;
        alpha[k] += ((hit ? 0.35 : 1) - alpha[k]) * 0.25;
      }
    }
  };

  const mousePos = () => {
    const m = input.mouse;
    if (!m.inside || !input.mouseActive() || !display.uiCanvas) return null;
    const r = display.uiCanvas.getBoundingClientRect();
    return { x: (m.x - r.left) / display.scale, y: (m.y - r.top) / display.scale };
  };

  hud.ui = function ui(g) {
    const W = display.width, H = display.height;
    nums?.ui(g);
    if (hidden) return;
    if (hud.vignette) drawVignette(g, W, H, vig);
    const a = (k, fn) => { g.globalAlpha = alpha[k]; const r = fn(); g.globalAlpha = 1; rects[k] = r; };
    a('hearts', () => { const r = hearts.draw(g, MARGIN, MARGIN); return { x: MARGIN, y: MARGIN, w: r.w, h: r.h }; });
    a('shards', () => shardW.draw(g, W - MARGIN, MARGIN));
    if (hud.showTrack) a('track', () => trackW.draw(g, Math.round(W / 2), MARGIN));
    a('boons', () => boonRow.draw(g, MARGIN, H - MARGIN - 16 - 4, mousePos()));
    boss.draw(g, W, H);
  };

  hud.info = () => ({
    hp: hearts.lastHp, maxHp: hearts.lastMax, low: hearts.low, beat: +hearts.beat.toFixed(2), vignette: +vig.toFixed(2),
    shards: { total: shardW.total, shown: shardW.shown }, boons: boonRow.items.map((b) => ({ id: b.id, level: b.level })),
    tooltip: boonRow.tipId, track: { index: trackW.index, done: trackW.doneUpTo, progress: +trackW.progress.toFixed(2), label: trackW.label },
    boss: { on: boss.on, hp: +boss.target.toFixed(3), phase: boss.phase }, numbers: nums?.count ?? 0, dim: { ...alpha },
  });

  hud.dispose = function dispose() {
    offs.forEach((f) => f()); offs.length = 0;
    nums?.dispose();
    if (current === hud) current = null;
  };
  current = hud;
  return hud;
}
