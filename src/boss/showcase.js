// ?showcase=boss : The Warden, in the round arena, with a bot at the controls.
//
//   ?showcase=boss                  phase 1 from the start of the fight (no intro), the bot plays
//   ?showcase=boss&intro=1          the intro: dark arena, footsteps, eyes, roar, name card, then the fight
//   ?showcase=boss&phase=1|2|3      the fight starting at that phase (2 and 3 begin with the armour cracked
//                                   and, for 3, the cage already up)
//   ?showcase=boss&death=1          phase 3 with the Warden one hit from death: the death sequence
//   Params: &bot=0 (you play; any key takes over from the bot)  &hp=<0..1> fraction of the phase's health
//           &hud=0 (clean stills)  &slow=<x> (time scale)  &zoom=1..3  &cx= &cz= (camera centre, for close-ups)  &attack=<sweep|lash|slam|slam2|leap|summon> (first attack)
//   Keys: WASD move  J attack  K dash  1 2 3 phase  I intro  X kill  B bot  R restart  H hud  E skip intro
import { createBossScene } from './scene.js';

export default function bossShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  const death = P('death', '0') === '1';
  const intro = P('intro', '0') === '1';
  const phase = death ? 3 : Math.max(1, Math.min(3, parseInt(P('phase', '1'), 10) || 1));
  const hp = params.has('hp') ? parseFloat(P('hp', '1')) : (death ? 0.02 : null);
  const def = createBossScene({ phase, intro, bot: P('bot', '1') !== '0', hud: P('hud', '1') !== '0', hp, showcase: true, zoom: Math.max(1, Math.min(3, parseInt(P('zoom', '1'), 10) || 1)), cam: params.has('cx') || params.has('cz') ? [parseFloat(P('cx', '0')), parseFloat(P('cz', '-0.2'))] : null, slow: parseFloat(P('slow', '')) || null });
  const enter = def.enter;
  const first = P('attack', null);
  def.enter = function (d, r) {
    enter.call(this, d, r);
    if (first) window.__GR?.debug.boss('attack', first);
  };
  return def;
}
