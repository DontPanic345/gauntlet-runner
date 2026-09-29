// The in-run HUD (piece `hud`): hearts with damage drain, dash pip, shard counter, boon row with
// tooltips, room-progress track (hidden during play, shown on pause), boss bar, damage numbers,
// low-health vignette and screen-edge flash, and boon acquisition toast.
//
// Layout consolidation (wave 2-3):
// - PRIMARY zone: hearts + dash pips (top-left, most prominent)
// - SECONDARY zones (hidden during play, visible on pause): shards (top-right), boons (bottom-left), track (bottom-center)
// - DYNAMIC overlays: boss bar (bottom-right, reduced size), boon toast (center-top)
// - EFFECTS: low-health vignette + screen-edge flash pulse in sync with heartbeat
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
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { Hearts } from './widgets/hearts.js';
import { Shards } from './widgets/shards.js';
import { BoonRow } from './widgets/boonrow.js';
import { Track } from './widgets/track.js';
import { BossBar } from './widgets/bossbar.js';
import { BoonToast } from './widgets/boontoast.js';
import { drawVignette, drawScreenEdgeFlash } from './widgets/vignette.js';
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
  const toast = new BoonToast();
  const nums = numbers ? createDamageNumbers() : null;
  const offs = [];
  const alpha = { hearts: 1, shards: 1, boons: 1, track: 0.55 };  // track dimmed by default to reduce clutter
  const rects = {};
  let vig = 0;
  let hidden = false;
  const hud = {
    hearts, shards: shardW, boons: boonRow, track: trackW, boss, toast, numbers: nums,
    showTrack: track,
    get visible() { return !hidden; },
    set visible(v) { hidden = !v; },
    vignette: true,
    vignetteIntensity: 1,  // multiplier for vignette opacity; increased during low health
    _dim: alpha,
  };

  const on = (n, f) => offs.push(events.on(n, f));
  const arena = (i) => Math.max(0, (i ?? 0) * 2);
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

  // Track boon changes to trigger toast notifications
  let lastBoonList = [];
  const checkBoonChanges = () => {
    const list = boonList();
    const newBoons = list.filter((b) => !lastBoonList.find((lb) => lb.id === b.id));
    const levelUps = list.filter((b) => {
      const last = lastBoonList.find((lb) => lb.id === b.id);
      return last && b.level > last.level;
    });
    
    if (newBoons.length > 0) {
      toast.show(newBoons[0].id, newBoons[0]);
    } else if (levelUps.length > 0) {
      toast.show(levelUps[0].id, levelUps[0]);
    }
    lastBoonList = list.map((b) => ({ id: b.id, level: b.level }));
  };

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
    toast.tick();
    checkBoonChanges();
    
    // vignette: eased in while low, pulsing on the beat. Increased opacity (50% peak) for better visibility.
    const want = hearts.low ? (0.5 + hearts.beat * 0.5) * hud.vignetteIntensity : 0;
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
    const isPaused = loop.paused;
    
    nums?.ui(g);
    if (hidden) return;
    
    // Low-health effects: vignette + screen-edge flash
    if (hud.vignette) {
      drawVignette(g, W, H, vig);
      drawScreenEdgeFlash(g, W, H, vig);
    }
    
    const a = (k, fn) => { 
      const shouldShow = isPaused || (k !== 'boons' && k !== 'track');
      const targetAlpha = shouldShow ? alpha[k] : 0;
      alpha[k] += (targetAlpha - alpha[k]) * 0.25;
      if (alpha[k] > 0.02) {
        g.globalAlpha = alpha[k];
        const r = fn();
        g.globalAlpha = 1;
        rects[k] = r;
      }
    };
    
    // PRIMARY zone: hearts + dash pips (top-left, most prominent)
    a('hearts', () => { const r = hearts.draw(g, MARGIN, MARGIN); return { x: MARGIN, y: MARGIN, w: r.w, h: r.h }; });
    
    // SECONDARY zones: shards (top-right, smaller), boons (bottom-left, focused, hidden during play)
    a('shards', () => shardW.draw(g, W - MARGIN, MARGIN));
    a('boons', () => boonRow.draw(g, MARGIN, H - MARGIN - 16 - 4, isPaused ? mousePos() : null));
    
    // PASSIVE info: track (bottom-center, dimmed and hidden during play)
    if (hud.showTrack) a('track', () => trackW.draw(g, Math.round(W / 2), H - MARGIN - 32));
    
    // DYNAMIC overlay: boss bar (bottom-right, compact)
    boss.draw(g, W, H);
    
    // Boon acquisition toast (center-top)
    g.globalAlpha = 1;
    toast.draw(g, W / 2, 40);
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
