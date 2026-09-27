// Light run-to-run meta (piece `run-flow`): best victory time and a handful of lore lines
// unlocked as a player reaches deeper into the Gauntlet. Persisted to localStorage, exactly
// like `core/settings.js` (same pattern: read once, write through `recordRun`).
//
//   import { recordRun, getMeta } from './run/meta.js';
//   const result = recordRun({ victory, time, node, seed });   // called once per finished run
//   // result: { bestTime, isNewBest, unlocked: [{id, text}], runs, victories }

const STORE_KEY = 'gr.meta.v1';

// One line per depth milestone (0..9, matching run.js's PLAN index of the deepest segment
// reached), plus one that unlocks only on an actual victory. Kept short: this is "light" meta,
// not a codex.
const LORE = [
  { id: 'l0', min: 0, text: 'The vestibule\'s entry gate is barred from the far side, not the near one. Something down here wanted to keep the Warden in, not keep raiders out.' },
  { id: 'l1', min: 2, text: 'A husk\'s tabard still carries the old garrison sigil, half eaten by moss. These were the mountain\'s own soldiers, once.' },
  { id: 'l2', min: 4, text: 'The Pillared Hall\'s frieze shows a coronation. In every panel, the crown has been chiselled away afterward.' },
  { id: 'l3', min: 6, text: 'The rubble choking the Collapsed Gallery still smells of fresh mortar under the dust. The roof came down on purpose.' },
  { id: 'l4', min: 8, text: 'The Antechamber\'s blood-dyed rug is re-woven yearly, not centuries old. Someone has been keeping this place ready.' },
  { id: 'lwin', min: 10, winOnly: true, text: 'The gaol key turns easy in your hand, oiled and warm, as if it had been waiting for someone exactly like you.' },
];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') return { runs: 0, victories: 0, bestTime: null, deepest: -1, lore: [], ...saved };
  } catch { /* storage blocked */ }
  return { runs: 0, victories: 0, bestTime: null, deepest: -1, lore: [] };
}

function save(m) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

/** Current meta, read-only (for a title screen or debug readout). */
export function getMeta() { return load(); }

/**
 * Record a finished run. `node` is the PLAN index (0..9) of the deepest segment reached.
 * Returns { bestTime, isNewBest, unlocked, runs, victories } for the summary screen.
 */
export function recordRun({ victory = false, time = 0, node = 0, seed = 1 } = {}) {
  const m = load();
  m.runs += 1;
  if (victory) m.victories += 1;
  let isNewBest = false;
  if (victory && (m.bestTime == null || time < m.bestTime)) { m.bestTime = time; isNewBest = true; }
  m.deepest = Math.max(m.deepest, node);
  const known = new Set(m.lore);
  const unlocked = [];
  for (const l of LORE) {
    if (known.has(l.id)) continue;
    const reached = l.winOnly ? victory : m.deepest >= l.min;
    if (reached) { known.add(l.id); unlocked.push(l); }
  }
  m.lore = [...known];
  m.lastSeed = seed;
  save(m);
  return { bestTime: m.bestTime, isNewBest, unlocked, runs: m.runs, victories: m.victories };
}

export function resetMeta() { save({ runs: 0, victories: 0, bestTime: null, deepest: -1, lore: [] }); }
