// The one palette (GAME.md "Look"). 32 colours, named. Everything draws from here,
// UI included. Owned by the `look` piece; seeded by `foundation` so the engine,
// the voxel mesher and the debug overlays had colours to use. `look` may retune the
// hex values freely; keep the names stable (other pieces refer to them by name).
//
// Mood: cool blue-violet shadow against warm torch and ember light. `ember` is the
// signature accent, reserved for danger, fire, and the collapse.

export const PALETTE = {
  // cool ramp, darkest to lightest
  ink: '#0b0a12',
  night: '#15131f',
  shadow: '#1f1b2e',
  dusk: '#2c2640',
  violet: '#3d3457',
  slate: '#4f4a6e',
  mist: '#6b6b8f',
  fog: '#8f93b3',
  frost: '#bfc6dc',
  bone: '#e8e4d8',
  white: '#fbf7ef',
  // stone and earth
  stoneDark: '#2a2530',
  stone: '#413a47',
  stoneLight: '#5e5563',
  dirt: '#4a3328',
  wood: '#6e4a32',
  woodLight: '#9a6a42',
  // warm: blood to torchlight
  blood: '#7a1f2e',
  red: '#c4323f',
  ember: '#ff7a2f',
  flame: '#ffb347',
  gold: '#ffd86b',
  torch: '#fff1b0',
  // cool and natural accents
  moss: '#3e5b3f',
  leaf: '#6f9a52',
  teal: '#2f6f78',
  cyan: '#5fc4d0',
  sky: '#9fe3f0',
  navy: '#243a6b',
  blue: '#3f64b8',
  plum: '#6b2f5c',
  rose: '#d0637d',
};

export const NAMES = Object.keys(PALETTE);

/** CSS colour string for a palette name. Throws on an unknown name (catches typos early). */
export function css(name) {
  const c = PALETTE[name];
  if (!c) throw new Error(`palette: unknown colour "${name}"`);
  return c;
}

/** 0xRRGGBB integer for a palette name (for THREE.Color and friends). */
export function hex(name) {
  return parseInt(css(name).slice(1), 16);
}
