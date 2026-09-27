// ?showcase=run-flow (piece `run-flow`): jumps straight to one of the three beats a critic needs
// to judge — the death sequence, the victory sequence, or the run-summary screen — by redirecting
// into the *real* scenes (`run`, `gameover`, `victory`) with either a fast-forward flag or a
// representative stats payload, rather than building a parallel demo. Normal play (`?scene=run`)
// already covers the rest of the piece (arena/corridor/boss sequencing, boon shrine, transitions).
//
//   ?showcase=run-flow                    same as &at=death
//   ?showcase=run-flow&at=death           a real death, a few seconds into arena I
//   ?showcase=run-flow&at=victory         a real boss kill, fast-forwarded, then the victory beat
//   ?showcase=run-flow&at=summary         the run-summary screen with representative stats
//   ?showcase=run-flow&at=summary&result=win   ... the victory-flavoured summary
//   &seed=<n>   seed to use for &at=death|victory (default 48213)

import { scenes } from '../core/scenes.js';

function fakeStats(win) {
  return {
    victory: win,
    seed: 48213,
    time: win ? 612 : 247,
    kills: win ? 86 : 34,
    deepestLabel: win ? 'THE WARDEN\'S LAIR' : 'THE COLLAPSED GALLERY',
    causeLabel: win ? null : 'trampled by a Brute',
    boons: [{ id: 'chain-spark', level: 2 }, { id: 'ember-trail', level: 1 }, { id: 'aegis', level: 1 }],
    bestTime: 598,
    isNewBest: win,
    newLore: [{ id: 'demo', text: 'A lore line unlocked by reaching deeper into the Gauntlet than before.' }],
    runNumber: 7,
  };
}

export default function showcaseRunFlow(params) {
  const at = params.get('at') || 'death';
  const result = params.get('result') || (at === 'victory' ? 'win' : 'lose');
  const seedParam = parseInt(params.get('seed') ?? '', 10);
  const seed = Number.isFinite(seedParam) ? seedParam : 48213;
  return {
    enter() {
      if (at === 'summary') scenes.go(result === 'win' ? 'victory' : 'gameover', fakeStats(result === 'win'));
      else scenes.go('run', { showcaseAt: at === 'victory' ? 'victory' : 'death', seed });
    },
  };
}
