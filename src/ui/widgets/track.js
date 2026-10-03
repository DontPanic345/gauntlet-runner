// Room track (piece `hud`): top centre. The run as a row of nodes:
//
//   [A]-<>-[A]-<>-[A]-<>-[A]-<>-[A]-SKULL       5 arenas, 4 gauntlet corridors, the Warden
//
//   passed     filled slate, the link behind it solid fog
//   current    gold (arena), ember (corridor: the collapse is coming), or a red-eyed skull,
//              pulsing, with the hooded runner marker bobbing above it
//   ahead      hollow, the links dotted
// On entering a room the marker hops along the track from the last room it stood on (kept
// across scenes in this module). In an arena the waves show as pips under the current node:
// cleared waves gold, the live one blinking, the rest dark.
//
//   const t = createTrack();   t.tick(room, waves)   t.draw(g, centreX, y)   t.width
//   room: world.room ({index, kind}) or null;  waves: {wave, total, done} or null

import { rect, cutRect, outlined, sprite, panel, easeOut } from './draw.js';

export const NODES = ['arena', 'corridor', 'arena', 'corridor', 'arena', 'corridor', 'arena', 'corridor', 'arena', 'boss'];
const STEP = 14;

const SKULL = ['.xxxxx.', 'xxxxxxx', 'xeexeex', 'xeexeex', 'xxx.xxx', '.xxxxx.', '.x.x.x.'];
const HOOD = sprite(['..k..', '.kbk.', 'kbbbk', 'kbfbk', 'kkkkk'], { k: 'ink', b: 'bone', f: 'fog' });

let lastNode = null;   // the node the marker stood on last (survives scene changes)

export function nodeOf(room) {
  if (!room) return -1;
  const i = room.index | 0;
  if (room.kind === 'arena') return Math.max(0, Math.min(4, i)) * 2;
  if (room.kind === 'corridor') return Math.max(0, Math.min(3, i)) * 2 + 1;
  if (room.kind === 'boss') return 9;
  return -1;
}

export function createTrack() {
  let cur = -1, from = -1, moveT = 99, t = 0, waves = null;
  const api = { width: (NODES.length - 1) * STEP + 22, node: -1 };
  api.tick = (room, w) => {
    t++; moveT++;
    const n = nodeOf(room);
    if (n !== cur) {
      from = cur >= 0 ? cur : (lastNode !== null && lastNode !== n ? lastNode : n);
      cur = n;
      moveT = from === n ? 99 : 0;
      if (n >= 0) lastNode = n;
    }
    api.node = cur;
    waves = w;
  };
  api.draw = (g, cx, y) => {
    if (cur < 0) return;
    const w0 = (NODES.length - 1) * STEP;
    const x0 = Math.round(cx - w0 / 2);
    panel(g, x0 - 11, y, w0 + 22, 17);
    const my = y + 8;
    // links
    for (let i = 0; i < NODES.length - 1; i++) {
      const a = x0 + i * STEP, b = a + STEP;
      const done = i < cur;
      for (let x = a + 4; x <= b - 4; x++) {
        if (done) rect(g, 'mist', x, my, 1, 1);
        else if ((x & 1) === 0) rect(g, i === cur ? ((t >> 3) % 2 ? 'fog' : 'slate') : 'violet', x, my, 1, 1);
      }
    }
    // nodes
    for (let i = 0; i < NODES.length; i++) {
      const x = x0 + i * STEP;
      const kind = NODES[i];
      const state = i < cur ? 'done' : i === cur ? 'here' : 'ahead';
      const pulse = state === 'here' && (t % 40) < 20;
      if (kind === 'arena') {
        const c = state === 'done' ? ['ink', 'slate', 'mist'] : state === 'here' ? ['ink', pulse ? 'torch' : 'gold', pulse ? 'white' : 'torch'] : ['ink', 'shadow', 'violet'];
        cutRect(g, c[0], x - 4, my - 4, 9, 9, 1);
        rect(g, c[1], x - 3, my - 3, 7, 7);
        rect(g, c[2], x - 3, my - 3, 7, 1);
        if (state === 'here') rect(g, 'flame', x - 3, my + 3, 7, 1);
        if (state === 'done') { rect(g, 'fog', x - 1, my, 1, 1); rect(g, 'fog', x, my + 1, 1, 1); rect(g, 'fog', x + 1, my - 1, 1, 1); rect(g, 'fog', x + 2, my - 2, 1, 1); }
      } else if (kind === 'corridor') {
        const c = state === 'done' ? 'slate' : state === 'here' ? (pulse ? 'flame' : 'ember') : 'dusk';
        const shake = state === 'here' && (t % 6) < 3 ? 1 : 0;
        diamond(g, x + shake, my, 3, 'ink');
        diamond(g, x + shake, my, 2, c);
        if (state === 'here') rect(g, 'white', x + shake, my - 1, 1, 1);
      } else {
        const col = state === 'here' ? 'bone' : 'slate';
        const eye = state === 'here' ? (pulse ? 'red' : 'blood') : 'ink';
        g.drawImage(outlined(SKULL, { x: col, e: eye }), x - 4, my - 4);
      }
    }
    // the runner marker hops from the last room to this one
    const k = easeOut(moveT / 24);
    const fx = x0 + from * STEP, tx = x0 + cur * STEP;
    const mx = Math.round(fx + (tx - fx) * k);
    const hop = moveT < 24 ? Math.round(Math.sin(k * Math.PI) * 5) : 0;
    const bob = (t % 60) < 30 ? 0 : 1;
    g.drawImage(HOOD, mx - 2, y - 5 - hop + bob);
    // arena waves: pips under the current node
    if (waves && waves.total > 0 && NODES[cur] === 'arena') {
      const n = waves.total, wx = Math.round(tx - (n * 4 - 1) / 2), wy = y + 18;
      for (let i = 0; i < n; i++) {
        const cleared = waves.done ? true : i < waves.wave - 1;
        const live = !waves.done && i === waves.wave - 1;
        rect(g, 'ink', wx + i * 4 - 1, wy - 1, 5, 4);
        rect(g, cleared ? 'gold' : live ? ((t >> 3) & 1 ? 'red' : 'flame') : 'shadow', wx + i * 4, wy, 3, 2);
      }
    }
  };
  return api;
}

function diamond(g, cx, cy, r, c) {
  for (let dy = -r; dy <= r; dy++) {
    const w = r - Math.abs(dy);
    rect(g, c, cx - w, cy + dy, w * 2 + 1, 1);
  }
}
