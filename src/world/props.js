// Arena props (piece `arenas`): the voxel models for everything that stands on an arena
// floor, and the runtime that makes them react.
//
//   import { createProps, PROP_DEFS, arenaSfx } from './props.js';
//   const props = createProps(root, collisionWorld);
//   props.add('urn', x, z, { variant: 1, turn: 2 });      // turn = quarter turns
//   combat targets: () => [...world.enemies, ...props.targets()]
//   tick: props.tick(heroCtl)      render: props.render(alpha)
//   props.breakNear(x, z, radius, { dx, dz, power })  // brute crashes, slams, orb pops
//
// What reacts to what (GAME.md: "props break or react when hit where it makes sense"):
//   urn / pot / amphora   one hit: shatters into clay chips, leaves shards, collider removed
//   crate / barrel        two hits: the first cracks it (model swap, rock, splinters), the second
//                         bursts it into planks
//   bones                 not solid; a sword hit or a dash through scatters the pile
//   candles               one hit knocks them over: the flames go out in a puff of smoke
//   brazier               never breaks: rocks on its stand, coughs embers, its light flares
//   pillar / statue /     never break: a hit knocks grit and pebbles off the top and chips
//   sarcophagus           off the face (a brute crash does the same, harder)
//
// Props are combat targets whose takeHit() always returns false, so combat's own hit effects,
// damage numbers and hitstop never fire for them: each prop plays its own, lighter reaction.
// They carry `noAssist`, so keyboard aim assist never turns the hero toward a pot.
//
// Events: 'prop:hit' { prop, kind, x, z }   'prop:break' { prop, kind, x, z, cause }

import * as THREE from 'three';
import { defineModel, voxelMesh, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { hex } from '../render/palette.js';
import { Rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { settings } from '../core/settings.js';
import { audioContext, legacyBus, legacyVol } from '../audio/engine.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';

const V = VOXEL;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------------------

/** A turned shape: radius per layer, colour per layer (or a function). Centre at (c, c). */
function lathe(g, c, radii, colour, y0 = 0) {
  const [sx, , sz] = g.size;
  radii.forEach((r, k) => {
    const y = y0 + k;
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const d = Math.hypot(x - c, z - c);
      if (d <= r) g.set(x, y, z, typeof colour === 'function' ? colour(x, y, z, d, r) : colour);
    }
  });
}

let built = false;
export function buildPropModels() {
  if (built) return;
  built = true;
  const R = new Rng('arena.props');

  // --- clay urns ---------------------------------------------------------------------
  {
    // tall urn: a painted bone band and a dark mouth
    const g = new VoxelGrid(5, 7, 5);
    lathe(g, 2, [1.2, 2.1, 2.5, 2.5, 2.2, 1.3, 1.6], (x, y, z, d, r) => {
      if (y === 6) return d < 1 ? 'dirt' : 'wood';
      if (y === 3) return (x + z) % 2 ? 'bone' : 'woodLight';
      if (y <= 1) return 'wood';
      return d > r - 0.8 && z < 2 ? 'wood' : (y === 4 && (x + z) % 3 === 0) ? 'bone' : 'woodLight';
    });
    g.set(3, 4, 4, 'bone'); g.set(1, 5, 3, 'bone');   // glaze glints
    defineModel('arena.urn.0', { grid: g });
  }
  {
    // squat grey-glazed pot with a teal band
    const g = new VoxelGrid(6, 5, 6);
    lathe(g, 2.5, [1.6, 2.7, 3.0, 2.6, 1.7], (x, y, z, d) => {
      if (y === 4) return d < 1.1 ? 'ink' : 'slate';
      if (y === 2) return 'teal';
      if (y === 0) return 'slate';
      return z < 2 ? 'mist' : 'fog';
    });
    g.set(1, 3, 4, 'fog'); g.set(4, 1, 4, 'fog');
    defineModel('arena.urn.1', { grid: g });
  }
  {
    // amphora: narrow neck, two handles
    const g = new VoxelGrid(7, 9, 7);
    lathe(g, 3, [1.0, 1.9, 2.5, 2.6, 2.4, 1.8, 1.0, 1.0, 1.5], (x, y, z, d) => {
      if (y === 8) return d < 0.9 ? 'ink' : 'wood';
      if (y === 4) return 'blood';
      if (y === 5 && (x + z) % 2 === 0) return 'blood';
      return z < 3 && d > 1.5 ? 'wood' : (y === 2 && (x + z) % 2) ? 'bone' : 'woodLight';
    });
    for (const x of [0, 6]) { g.set(x, 6, 3, 'wood'); g.set(x, 7, 3, 'wood'); g.set(x === 0 ? 1 : 5, 7, 3, 'wood'); }
    defineModel('arena.urn.2', { grid: g });
  }
  {
    // shards left on the floor
    const g = new VoxelGrid(9, 2, 9);
    for (let i = 0; i < 16; i++) {
      const a = R.range(0, TAU), d = R.range(0.5, 4);
      const x = Math.round(4 + Math.cos(a) * d), z = Math.round(4 + Math.sin(a) * d * 0.8);
      g.set(x, 0, z, R.pick(['woodLight', 'wood', 'wood', 'dirt']));
      if (R.chance(0.25)) g.set(x, 1, z, 'woodLight');
    }
    g.set(4, 0, 4, 'dirt'); g.set(5, 0, 4, 'wood'); g.set(4, 1, 4, 'wood');   // the base ring survives
    defineModel('arena.shards', { grid: g });
  }

  // --- crate and barrel ----------------------------------------------------------------
  const crate = (cracked) => {
    const g = new VoxelGrid(7, 6, 7);
    g.box(0, 0, 0, 6, 5, 6, 'wood');
    for (let y = 0; y < 6; y++) for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) {
      const ex = x === 0 || x === 6, ey = y === 0 || y === 5, ez = z === 0 || z === 6;
      if ((ex && ey) || (ex && ez) || (ey && ez)) g.set(x, y, z, 'dirt');
      else if ((ex || ez) && y % 2 === 1) g.set(x, y, z, 'woodLight');
      else if (ey && (x + z) % 3 === 0) g.set(x, y, z, 'woodLight');
    }
    for (let i = 1; i < 6; i++) g.set(i, Math.min(4, i), 6, 'dirt');
    if (cracked) {
      // a split down the front and a stove-in corner
      for (let y = 1; y < 5; y++) g.set(3 + (y % 2), y, 6, 'ink');
      g.box(5, 3, 5, 6, 5, 6, null);
      g.set(4, 5, 6, 'ink'); g.set(6, 2, 4, 'ink'); g.set(5, 2, 6, 'woodLight');
    }
    return g;
  };
  defineModel('arena.crate', { grid: crate(false) });
  defineModel('arena.crate.cracked', { grid: crate(true) });
  const barrel = (cracked) => {
    const g = new VoxelGrid(6, 7, 6);
    lathe(g, 2.5, [2.3, 2.7, 3.0, 3.0, 3.0, 2.7, 2.3], (x, y, z, d, r) => {
      if (y === 6) return d < 1.6 ? 'wood' : 'dirt';
      if ((y === 1 || y === 5) && d > r - 1) return 'slate';
      const stave = Math.round(Math.atan2(z - 2.5, x - 2.5) / (Math.PI / 5)) % 2 === 0;
      return stave ? 'wood' : 'woodLight';
    });
    if (cracked) { for (let y = 2; y < 5; y++) g.set(2, y, 5, 'ink'); g.set(3, 3, 5, 'ink'); g.box(4, 6, 3, 5, 6, 5, null); g.set(5, 5, 4, null); }
    return g;
  };
  defineModel('arena.barrel', { grid: barrel(false) });
  defineModel('arena.barrel.cracked', { grid: barrel(true) });
  {
    // planks: a burst crate's boards on the floor
    const g = new VoxelGrid(11, 2, 11);
    for (let i = 0; i < 7; i++) {
      const along = R.chance(0.5), len = R.int(3, 6), x = R.int(0, 10 - (along ? len : 0)), z = R.int(0, 10 - (along ? 0 : len));
      const c = R.pick(['wood', 'woodLight', 'wood']);
      for (let k = 0; k < len; k++) g.set(along ? x + k : x, i > 4 ? 1 : 0, along ? z : z + k, c);
    }
    for (let i = 0; i < 6; i++) g.set(R.int(1, 9), 0, R.int(1, 9), 'dirt');
    g.set(5, 0, 5, 'slate'); g.set(6, 0, 5, 'slate'); g.set(7, 0, 6, 'slate');
    defineModel('arena.planks', { grid: g });
  }

  // --- bones ----------------------------------------------------------------------------
  {
    const g = new VoxelGrid(9, 4, 8);
    for (let i = 0; i < 11; i++) {
      const x = R.int(0, 7), z = R.int(0, 7), len = R.int(2, 4), y = R.int(0, 1), along = R.chance(0.5);
      for (let k = 0; k < len; k++) g.set(along ? Math.min(8, x + k) : x, y, along ? z : Math.min(7, z + k), 'bone');
      g.set(x, y, z, 'frost');
    }
    // the skull, facing the camera
    g.box(3, 1, 3, 5, 3, 5, 'bone');
    g.set(3, 2, 5, 'ink'); g.set(5, 2, 5, 'ink'); g.set(4, 1, 5, 'ink');
    g.box(3, 3, 3, 5, 3, 4, 'frost');
    defineModel('arena.bones', { grid: g });
  }
  {
    const g = new VoxelGrid(13, 1, 12);
    for (let i = 0; i < 14; i++) {
      const a = R.range(0, TAU), d = R.range(1, 5.5);
      const x = Math.round(6 + Math.cos(a) * d), z = Math.round(6 + Math.sin(a) * d * 0.85), along = R.chance(0.5), len = R.int(1, 3);
      for (let k = 0; k < len; k++) g.set(along ? x + k : x, 0, along ? z : z + k, k === 0 ? 'frost' : 'bone');
    }
    defineModel('arena.bones.scatter', { grid: g });
  }

  // --- candles on a broken stump ----------------------------------------------------------
  const candles = (lit) => {
    const g = new VoxelGrid(8, 9, 8);
    lathe(g, 3.5, [3.6, 3.6, 3.4, 3.4, 3.2], (x, y, z) => (y === 0 ? 'stoneDark' : (x + y) % 3 === 0 ? 'dusk' : 'stone'));
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) if (g.get(x, 4, z)) g.set(x, 4, z, (x * 7 + z * 3) % 5 ? 'stoneLight' : 'stone');
    const put = (x, z, h) => {
      for (let k = 0; k < h; k++) g.set(x, 5 + k, z, 'bone');
      if (lit) g.set(x, 5 + h, z, 'torch', true);
      g.set(x + 1, 5, z, 'bone');   // wax pooled at the foot
    };
    if (lit) { put(2, 3, 2); put(4, 5, 3); put(5, 2, 1); put(1, 5, 1); }
    else { put(2, 3, 1); put(5, 5, 1); g.box(1, 5, 1, 4, 5, 1, 'bone'); g.set(0, 4, 5, 'bone'); }
    // wax drips down the side
    g.set(4, 3, 7, 'bone'); g.set(4, 2, 7, 'bone'); g.set(1, 3, 6, 'bone');
    return g;
  };
  defineModel('arena.candles', { grid: candles(true) });
  defineModel('arena.candles.out', { grid: candles(false) });

  // --- brazier: an iron bowl of coals on a stand ------------------------------------------
  {
    const g = new VoxelGrid(11, 11, 11);
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) for (let k = 1; k <= 4; k++) g.set(5 + dx * k, 0, 5 + dz * k, k === 4 ? 'slate' : 'shadow');
    g.box(4, 0, 4, 6, 1, 6, 'shadow');
    g.box(5, 2, 5, 5, 5, 5, 'shadow'); g.set(5, 3, 5, 'slate');
    for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) {
      const d = Math.hypot(x - 5, z - 5);
      if (d <= 2.6) g.set(x, 6, z, 'shadow');
      if (d <= 4.0) g.set(x, 7, z, 'shadow');
      if (d <= 5.2 && d > 3.8) g.set(x, 8, z, d > 4.6 ? 'slate' : 'shadow');
      if (d <= 3.9) g.set(x, 8, z, R.chance(0.35) ? 'ember' : 'blood', true);
      if (d <= 2.6 && R.chance(0.7)) g.set(x, 9, z, R.chance(0.4) ? 'gold' : 'ember', true);
      if (d <= 1.2 && R.chance(0.5)) g.set(x, 10, z, 'gold', true);
    }
    for (const [x, z] of [[0, 5], [10, 5], [5, 0], [5, 10]]) g.set(x, 8, z, 'fog');
    defineModel('arena.brazier', { grid: g });
  }

  // --- pillars ------------------------------------------------------------------------
  const pillar = (variant) => {
    const H = variant === 2 ? 9 : 18;
    const g = new VoxelGrid(8, H + 1, 8);
    const r = new Rng('arena.pillar' + variant);
    // a square plinth, then a round fluted shaft (it must read as a column from above, not a box)
    g.box(0, 0, 0, 7, 0, 7, 'stoneDark'); g.box(0, 1, 0, 7, 1, 7, 'stone');
    g.box(1, 2, 1, 6, 2, 6, 'stoneLight');
    for (let y = 3; y < H - 2; y++) for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
      const d = Math.hypot(x + 0.5 - 4, z + 0.5 - 4);
      if (d > 2.9) continue;
      const a = Math.atan2(z + 0.5 - 4, x + 0.5 - 4);
      const flute = Math.floor((a + Math.PI) / (Math.PI / 4)) % 2 === 0;
      let c = d > 2.1 ? (flute ? 'stoneLight' : 'stone') : 'stone';
      if (y === 9 && variant !== 2) c = d > 2.1 ? 'mist' : 'slate';   // a carved band
      if (!flute && r.chance(0.05)) c = 'dusk';
      g.set(x, y, z, c);
    }
    if (variant === 2) {
      // broken stump: a jagged top
      for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
        if (Math.hypot(x + 0.5 - 4, z + 0.5 - 4) > 2.9) continue;
        const top = H - 2 + Math.round(Math.sin(x * 1.7 + z) * 1.2 + (x + z > 7 ? 1 : -0.5));
        for (let y = H - 3; y <= top; y++) g.set(x, y, z, y === top ? 'fog' : 'stone');
      }
    } else {
      // capital: a round cushion and a square abacus, a dark top so it never reads as a lit box
      for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
        const d = Math.hypot(x + 0.5 - 4, z + 0.5 - 4);
        if (d <= 3.5) g.set(x, H - 2, z, 'stoneLight');
      }
      for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
        const d = Math.hypot(x + 0.5 - 4, z + 0.5 - 4);
        if (d <= 4) g.set(x, H - 1, z, d > 3.2 ? (z > 4 ? 'stoneLight' : 'stone') : 'stone');
        if (d <= 2.6) g.set(x, H, z, d > 1.6 ? 'stoneLight' : 'mist');
      }
      if (variant === 1) {
        // a chunk knocked out of the shaft, cracks running from it
        g.box(5, 9, 5, 7, 12, 7, null);
        g.set(4, 10, 6, 'ink'); g.set(3, 9, 6, 'ink'); g.set(5, 8, 6, 'ink');
      }
      if (variant === 0) for (let x = 1; x <= 6; x++) g.set(x, 6 + (x % 2), 6, x % 2 ? 'slate' : 'mist');   // a chain wrapped round
    }
    // moss creeping up from the floor
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) for (let y = 0; y < 6; y++) if (g.get(x, y, z) && r.chance(0.2 - y * 0.03)) g.set(x, y, z, r.chance(0.3) ? 'leaf' : 'moss');
    return g;
  };
  defineModel('arena.pillar.0', { grid: pillar(0) });
  defineModel('arena.pillar.1', { grid: pillar(1) });
  defineModel('arena.pillar.2', { grid: pillar(2) });

  // --- rubble -----------------------------------------------------------------------------
  {
    const g = new VoxelGrid(9, 3, 8);
    for (let i = 0; i < 7; i++) {
      const x = R.int(0, 7), z = R.int(0, 6), s = R.int(1, 2);
      g.box(x, 0, z, x + s - 1, R.int(0, s), z + s - 1, R.pick(['stone', 'stoneLight', 'stoneDark', 'dusk']));
    }
    for (let i = 0; i < 6; i++) g.set(R.int(0, 8), 0, R.int(0, 7), 'stoneDark');
    defineModel('arena.rubble', { grid: g });
  }

  // --- statue: a hooded runner of an older age, hands on a grounded sword -----------------
  {
    const g = new VoxelGrid(11, 25, 10);
    g.box(0, 0, 0, 10, 3, 9, 'stone');
    g.box(0, 3, 0, 10, 3, 9, 'stoneLight');
    g.box(1, 1, 9, 9, 2, 9, 'stoneDark');                 // an inscription panel on the front
    for (let x = 2; x <= 8; x += 2) g.set(x, 1, 9, 'slate');
    const S = 'mist', L = 'fog', D = 'slate';
    // robe, widening to the floor
    for (let y = 4; y <= 14; y++) {
      const w = y < 8 ? 3 : y < 12 ? 2.6 : 2.2;
      for (let z = 2; z <= 7; z++) for (let x = 1; x <= 9; x++) {
        const dx = Math.abs(x - 5), dz = Math.abs(z - 4.5) * 1.1;
        if (dx <= w && dz <= 2.4) g.set(x, y, z, dx >= w - 0.5 ? D : (y + x) % 5 === 0 ? D : S);
      }
    }
    // shoulders, hood
    g.box(2, 15, 3, 8, 16, 6, S); g.box(2, 16, 3, 8, 16, 6, L);
    g.box(3, 17, 2, 7, 20, 6, S); g.box(4, 21, 3, 6, 21, 5, S); g.set(5, 22, 3, D);
    g.box(4, 17, 6, 6, 19, 6, 'ink');                         // the face in shadow
    g.box(3, 20, 6, 7, 20, 7, L);                              // hood brim
    // hands folded on the pommel, blade down the front
    g.box(4, 12, 7, 6, 13, 8, L);
    g.set(5, 14, 8, D); g.box(3, 11, 8, 7, 11, 8, D);          // cross-guard
    g.box(5, 4, 8, 5, 10, 8, L); g.set(5, 4, 9, S);
    // moss on the shoulders and plinth
    const r = new Rng('arena.statue');
    for (let z = 0; z < 10; z++) for (let x = 0; x < 11; x++) for (const y of [3, 16, 20]) if (g.get(x, y, z) && r.chance(y === 3 ? 0.2 : 0.3)) g.set(x, y, z, r.chance(0.3) ? 'leaf' : 'moss');
    defineModel('arena.statue', { grid: g });
  }

  // --- sarcophagus ----------------------------------------------------------------------
  {
    const g = new VoxelGrid(16, 7, 9);
    g.box(0, 0, 0, 15, 3, 8, 'stone');
    g.box(0, 0, 0, 15, 0, 8, 'stoneDark');
    for (let x = 1; x < 15; x += 3) g.box(x, 1, 8, x + 1, 2, 8, 'stoneDark');   // carved panels
    g.box(0, 4, 0, 15, 4, 8, 'stoneLight');
    g.box(1, 4, 8, 14, 4, 8, 'gold');                                          // a gilded lip
    // the effigy on the lid: crossed arms, a hooded head at the far (left) end
    g.box(2, 5, 2, 13, 5, 6, 'stone');
    g.box(2, 6, 3, 4, 6, 5, 'fog'); g.set(3, 6, 5, 'slate');
    g.box(5, 6, 3, 11, 6, 5, 'mist');
    g.box(7, 6, 3, 8, 6, 5, 'fog'); g.set(8, 6, 4, 'slate');
    g.box(12, 6, 3, 13, 6, 5, 'mist');
    g.set(0, 4, 8, null); g.set(15, 4, 0, null); g.set(14, 5, 6, null);
    defineModel('arena.sarcophagus', { grid: g });
  }

  // --- skull pile (ossuary focal) ---------------------------------------------------------
  {
    const g = new VoxelGrid(12, 9, 11);
    const r = new Rng('arena.skullpile');
    const skull = (x, y, z, face = true) => {
      g.box(x, y, z, x + 2, y + 2, z + 2, 'bone');
      g.box(x, y + 2, z, x + 2, y + 2, z + 1, 'frost');
      if (face) { g.set(x, y + 1, z + 2, 'ink'); g.set(x + 2, y + 1, z + 2, 'ink'); g.set(x + 1, y, z + 2, 'ink'); }
    };
    lathe(g, 5.5, [5.5, 4.8, 3.8, 2.6], (x, y, z) => (r.chance(0.4) ? 'frost' : r.chance(0.3) ? 'stoneLight' : 'bone'));
    skull(1, 1, 6); skull(4, 1, 7); skull(7, 1, 6); skull(2, 3, 4); skull(6, 3, 5); skull(4, 5, 3); skull(4, 7, 2, true);
    g.set(5, 8, 3, 'frost');
    defineModel('arena.skullpile', { grid: g });
  }

  // ===== set-pieces: one per room, at least 3x3 tiles or well over the hero's height =====

  // --- the fallen colossus: a giant hooded head lying face-up, half sunk in the floor. The face
  //     is drawn on its top, so it reads from the high camera: hood, brow, two hollow eyes, the
  //     nose ridge, a split lip, and a crack running through it all
  {
    const SX = 30, SY = 16, SZ = 26;
    const g = new VoxelGrid(SX, SY, SZ);
    const r = new Rng('arena.colossus');
    const cx = 15, cz = 12, cy = -6;
    const topAt = new Int8Array(SX * SZ).fill(-1);
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      // the head: an egg, wider at the hood (back) and narrowing to the chin (front)
      const t = (z + 0.5 - cz) / 12;
      const rx = 13 * (1 - Math.max(0, t) * 0.35);
      const dx = (x + 0.5 - cx) / rx;
      const k = 1 - dx * dx - t * t;
      if (k <= 0) continue;
      const h = Math.min(SY - 1, Math.round(cy + 21 * Math.sqrt(k)));
      if (h < 0) continue;
      topAt[x + SX * z] = h;
      const face = t > -0.15 && Math.abs(dx) < 0.72 && t < 0.92;
      for (let y = 0; y <= h; y++) {
        let c = face ? 'mist' : (Math.floor(y / 3) + Math.floor(x / 5)) % 4 === 0 ? 'dusk' : 'violet';
        if (y === h) c = face ? ((x * 3 + z) % 11 === 0 ? 'frost' : 'fog') : (r.chance(0.25) ? 'slate' : 'violet');
        if (y < h && !face && y < 2) c = 'stoneDark';
        g.set(x, y, z, c);
      }
    }
    const top = (x, z) => topAt[x + SX * z];
    const paint = (x, z, c, dy = 0) => { const h = top(x, z); if (h < 0) return; if (dy < 0) { for (let y = h + dy + 1; y <= h; y++) g.set(x, y, z, null); g.set(x, h + dy, z, c); } else for (let y = h + 1; y <= h + dy; y++) g.set(x, y, z, c); if (dy === 0) g.set(x, h, z, c); };
    // the hood's rim: a raised fold of cloth-stone round the face
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      if (top(x, z) < 0) continue;
      const t = (z + 0.5 - cz) / 12, dx = (x + 0.5 - cx) / (13 * (1 - Math.max(0, t) * 0.35));
      const rim = Math.abs(Math.hypot(dx / 0.8, (t - 0.38) / 0.62) - 1) < 0.1 && t < 0.85;
      if (rim) paint(x, z, 'slate', 1);
    }
    // brow ridge
    for (let x = cx - 8; x <= cx + 7; x++) paint(x, cz + 1, Math.abs(x + 0.5 - cx) < 6 ? 'frost' : 'fog', 1);
    // the eyes: big hollow sockets, moss grown in one, a cold glint deep in the other
    for (const ex of [cx - 6, cx + 3]) for (let z = cz + 2; z <= cz + 5; z++) for (let x = ex - 1; x <= ex + 3; x++) {
      if ((x === ex - 1 || x === ex + 3) && (z === cz + 2 || z === cz + 5)) continue;
      paint(x, z, 'ink', -2);
    }
    for (let x = cx - 9; x <= cx + 8; x++) for (const z of [cz + 6]) if (Math.abs(x + 0.5 - cx) > 2.5) paint(x, z, 'frost', 0);   // cheekbones
    paint(cx - 6, cz + 4, 'moss', -1); paint(cx - 5, cz + 4, 'leaf', -1); paint(cx - 4, cz + 3, 'moss', -1);
    paint(cx + 4, cz + 3, 'cyan', -2);
    // the nose ridge, its tip broken off
    for (let z = cz + 2; z <= cz + 7; z++) for (let x = cx - 1; x <= cx; x++) paint(x, z, z === cz + 7 ? 'fog' : 'frost', z < cz + 7 ? 2 : 1);
    paint(cx - 2, cz + 7, 'slate', 0); paint(cx + 1, cz + 7, 'slate', 0);
    // the mouth: a stern line, the lower lip split
    for (let x = cx - 4; x <= cx + 3; x++) { paint(x, cz + 9, 'ink', -1); paint(x, cz + 10, x === cx + 1 ? 'ink' : 'frost', 0); }
    // the crack: from the crown down the right of the brow, round the eye, to the jaw
    let x = cx + 7, z = 1;
    for (let k = 0; k < 40 && z < SZ - 1; k++) {
      if (top(x, z) >= 0 && g.get(x, top(x, z), z)) paint(x, z, 'ink', 0);
      if (r.chance(0.55)) z++; else x += r.pick([-1, 0, 1, 1]);
      if (x > cx + 10) x--;
    }
    // a chunk knocked out of the hood, moss in the hollows and down the sides
    for (let z = 2; z < 7; z++) for (let x2 = cx + 7; x2 < cx + 12; x2++) if (top(x2, z) > 2) for (let y = top(x2, z) - 2; y <= top(x2, z); y++) g.set(x2, y, z, y === top(x2, z) - 2 ? 'stoneDark' : null);
    for (let z = 0; z < SZ; z++) for (let x2 = 0; x2 < SX; x2++) {
      const h = top(x2, z);
      if (h < 0) continue;
      const t = (z + 0.5 - cz) / 12;
      if (t < -0.2 && r.chance(0.16)) g.set(x2, h, z, r.chance(0.35) ? 'leaf' : 'moss');
      if (h < 4 && r.chance(0.35)) g.set(x2, h, z, r.chance(0.3) ? 'leaf' : 'moss');
    }
    defineModel('arena.colossus', { grid: g });
  }

  // --- the Warden's throne: a high-backed stone seat with gilded trim and a navy cushion
  {
    const SX = 18, SY = 30, SZ = 13;
    const g = new VoxelGrid(SX, SY, SZ);
    // steps
    g.box(0, 0, 0, 17, 1, 12, 'mist'); g.box(1, 2, 0, 16, 2, 10, 'fog'); g.box(0, 1, 12, 17, 1, 12, 'frost');
    // seat
    g.box(3, 3, 1, 14, 8, 10, 'slate'); g.box(3, 8, 1, 14, 8, 10, 'mist');
    g.box(4, 9, 2, 13, 9, 9, 'navy'); g.box(4, 9, 9, 13, 9, 9, 'blue'); g.set(4, 9, 9, 'gold'); g.set(13, 9, 9, 'gold');
    // armrests ending in carved skulls
    for (const ax of [1, 14]) {
      g.box(ax, 3, 1, ax + 2, 12, 10, 'slate'); g.box(ax, 12, 1, ax + 2, 12, 10, 'fog');
      g.box(ax, 10, 10, ax + 2, 12, 11, 'bone'); g.set(ax, 11, 11, 'ink'); g.set(ax + 2, 11, 11, 'ink');
    }
    // the back: tall, a pointed crown, a gold band and a sigil
    for (let y = 9; y < SY; y++) {
      const w = y < 24 ? 7 : Math.max(0, 7 - (y - 23) * 1.4);
      for (let x = 0; x < SX; x++) {
        const dx = Math.abs(x + 0.5 - 9);
        if (dx > w) continue;
        let c = dx > w - 1 ? 'mist' : (y % 6 === 0 ? 'violet' : 'slate');
        if (y === 18 || y === 19) c = 'gold';
        if (y >= 20 && y <= 23 && dx < 2) c = y === 21 && dx < 1 ? 'gold' : 'navy';
        g.set(x, y, 0, c); g.set(x, y, 1, c === 'gold' ? 'gold' : 'slate');
      }
    }
    g.set(8, SY - 1, 0, 'gold'); g.set(9, SY - 1, 0, 'gold');
    // finials on the back's shoulders
    for (const fx of [1, 16]) { g.box(fx - 1, 24, 0, fx, 25, 1, 'fog'); g.set(fx - 1, 26, 0, 'gold'); }
    defineModel('arena.throne', { grid: g });
  }

  // --- the root tree: an old tree that grew down through the vault, roots gripping the floor
  {
    const SX = 34, SY = 40, SZ = 34;
    const g = new VoxelGrid(SX, SY, SZ);
    const r = new Rng('arena.tree');
    const c = 17;
    // trunk: thick, twisting, bark in two tones
    for (let y = 0; y < 30; y++) {
      const rr = 3.6 - y * 0.03 + (y < 4 ? (4 - y) * 0.9 : 0);
      const ox = Math.sin(y * 0.18) * 1.6, oz = Math.cos(y * 0.13) * 1.2;
      for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
        const d = Math.hypot(x + 0.5 - c - ox, z + 0.5 - c - oz);
        if (d > rr) continue;
        const ridge = Math.floor(Math.atan2(z - c, x - c) * 3 + y * 0.25) % 2;
        g.set(x, y, z, d > rr - 1 ? (ridge ? 'wood' : 'woodLight') : 'wood');
      }
    }
    // roots: snaking out across the floor
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + r.range(-0.2, 0.2);
      let x = c + Math.cos(a) * 3, z = c + Math.sin(a) * 3, y = 2.5;
      const len = r.int(10, 15);
      for (let s = 0; s < len; s++) {
        const th = Math.max(0, 1.6 - s * 0.1);
        for (let dy = 0; dy <= Math.round(y); dy++) for (let ddx = -th; ddx <= th; ddx++) for (let ddz = -th; ddz <= th; ddz++) {
          if (Math.hypot(ddx, ddz) > th + 0.2) continue;
          g.set(Math.round(x + ddx), dy, Math.round(z + ddz), s % 4 === 3 ? 'woodLight' : 'wood');
        }
        x += Math.cos(a + Math.sin(s * 0.7) * 0.4); z += Math.sin(a + Math.sin(s * 0.7) * 0.4);
        y = Math.max(0, y - 0.25);
      }
    }
    // the crown: lumpy leaf masses, lit on top, a few gold blossoms
    const blobs = [[c, 34, c, 9], [c - 7, 31, c + 1, 6], [c + 7, 32, c - 2, 6], [c + 1, 31, c + 7, 6], [c - 2, 33, c - 7, 6]];
    for (const [bx, by, bz, br] of blobs) for (let y = by - br; y < Math.min(SY, by + br); y++) for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const d = Math.hypot(x - bx, (y - by) * 1.4, z - bz);
      if (d > br || r.chance(0.18)) continue;
      const top = y >= by + br * 0.35;
      g.set(x, y, z, top ? (r.chance(0.04) ? 'gold' : r.chance(0.35) ? 'leaf' : 'leaf') : r.chance(0.5) ? 'moss' : 'leaf');
    }
    // hanging vines from the crown
    for (let k = 0; k < 14; k++) {
      const x = r.int(4, SX - 5), z = r.int(4, SZ - 5);
      let top = -1; for (let y = SY - 1; y > 20; y--) if (g.get(x, y, z)) { top = y; }
      if (top < 0) continue;
      for (let y = top - 1; y > top - r.int(4, 10) && y > 6; y--) g.set(x, y, z, y % 3 ? 'moss' : 'leaf');
    }
    defineModel('arena.tree', { grid: g });
  }

  // --- the fountain: a round basin of dark water round a broken spout pillar
  {
    const S = 26, c = 13;
    const g = new VoxelGrid(S, 18, S);
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - c, z + 0.5 - c);
      if (d > 12.6) continue;
      if (d > 10.5) {
        for (let y = 0; y < 4; y++) g.set(x, y, z, y === 3 ? ((x + z) % 4 ? 'mist' : 'fog') : y === 0 ? 'stoneDark' : (Math.floor(Math.atan2(z - c, x - c) * 4) % 2 ? 'slate' : 'stone'));
      } else {
        g.set(x, 0, z, 'stoneDark');
        const ripple = Math.abs(Math.sin(d * 1.1)) > 0.93;
        g.set(x, 1, z, ripple ? 'teal' : (x * 7 + z * 3) % 41 === 0 ? 'sky' : 'navy');
      }
    }
    // the spout: a fluted pillar, broken, with a bowl and a trickle
    for (let y = 1; y < 15; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - c, z + 0.5 - c);
      const rr = y < 3 ? 3.2 : y < 10 ? 1.9 : y < 12 ? 3.6 : 0;
      if (d > rr) continue;
      if (y >= 10 && y < 12 && d < rr - 1 && y === 11) { g.set(x, y, z, 'teal'); continue; }
      g.set(x, y, z, y >= 10 ? (d > rr - 1 ? 'fog' : 'mist') : (Math.floor(Math.atan2(z - c, x - c) * 3) % 2 ? 'mist' : 'slate'));
    }
    for (let y = 2; y < 11; y++) g.set(c + 3, y, c + 1, y % 2 ? 'cyan' : 'sky');
    g.set(c + 3, 1, c + 2, 'frost'); g.set(c + 4, 1, c + 1, 'frost');
    for (let k = 0; k < 18; k++) { const a = k * 2.4, d = 4 + (k % 5) * 1.3; g.set(Math.round(c + Math.cos(a) * d), 2, Math.round(c + Math.sin(a) * d), k % 3 ? 'leaf' : 'moss'); }
    defineModel('arena.fountain', { grid: g });
  }

  // --- the bone mound: the ossuary's heart, a great heap of skulls crowned with candles
  {
    const S = 24, c = 12;
    const g = new VoxelGrid(S, 15, S);
    const r = new Rng('arena.mound');
    lathe(g, c, [11.5, 11, 10, 9, 8, 7, 6, 5, 4, 3], () => (r.chance(0.35) ? 'frost' : r.chance(0.2) ? 'stoneLight' : 'bone'));
    // skulls studded over the surface, facing out
    for (let k = 0; k < 34; k++) {
      const a = r.range(0, Math.PI * 2), y = r.int(0, 8), rr = [11.5, 11, 10, 9, 8, 7, 6, 5, 4][y] - 0.5;
      const x = Math.round(c + Math.cos(a) * rr), z = Math.round(c + Math.sin(a) * rr);
      g.box(x - 1, y, z - 1, x + 1, y + 2, z + 1, 'bone');
      g.box(x - 1, y + 2, z - 1, x + 1, y + 2, z + 1, 'frost');
      const fx = Math.round(Math.cos(a)), fz = Math.round(Math.sin(a));
      if (fz >= 0) { g.set(x - 1 + (fx > 0 ? 1 : 0), y + 1, z + 1, 'ink'); g.set(x + 1 - (fx < 0 ? 1 : 0), y + 1, z + 1, 'ink'); }
    }
    // candles on the crown
    for (const [x, z, h] of [[c, c, 3], [c - 2, c + 1, 2], [c + 2, c - 1, 2], [c + 1, c + 2, 1], [c - 1, c - 2, 1]]) {
      for (let y = 10; y < 10 + h; y++) g.set(x, y, z, 'bone');
      g.set(x, 10 + h, z, 'torch', true);
    }
    for (let k = 0; k < 10; k++) g.set(c + r.int(-3, 3), 10, c + r.int(-3, 3), 'bone');   // pooled wax
    defineModel('arena.mound', { grid: g });
  }
}

/** Banner cloth frames (3), hung from the back wall, in a theme's colours. Returns model names. */
export function bannerModels(cols) {
  const [body, stripe, trim] = cols;
  const key = `arena.banner.${body}.${stripe}.${trim}`;
  const names = [0, 1, 2].map((k) => `${key}.${k}`);
  if (bannerBuilt.has(key)) return names;
  bannerBuilt.add(key);
  // frame k: the lower hem sways to one side, the tails lag a row behind
  const sway = [[0, 0, 0, 0], [0, 0, 1, 1], [0, 0, -1, -1]];
  names.forEach((name, k) => {
    const W = 7, H = 16;
    const g = new VoxelGrid(W + 2, H, 1);
    for (let y = 0; y < H; y++) {
      const band = y >= H - 1 ? 0 : y < 4 ? sway[k][3] : y < 7 ? sway[k][2] : y < 10 ? sway[k][1] : 0;
      for (let x = 0; x < W; x++) {
        if (y < 3 && y < Math.abs(x - 3)) continue;            // swallowtail
        const edge = x === 0 || x === W - 1;
        let c = edge ? trim : body;
        if (y === 9 || y === 10) c = edge ? trim : stripe;
        if (y >= 11 && y <= 13 && x >= 2 && x <= 4) c = (x === 3 && y === 12) ? trim : stripe;   // sigil
        if (y === H - 1) c = 'wood';
        g.set(x + 1 + band, y, 0, c);
      }
    }
    g.set(0, H - 1, 0, 'wood'); g.set(W + 1, H - 1, 0, 'wood');
    defineModel(name, { grid: g, origin: [(W + 2) / 2, H, 0] });   // hangs from its rod
  });
  return names;
}
const bannerBuilt = new Set();

// ---------------------------------------------------------------------------------------
// the environment's own sounds (stand-ins until the `audio` piece; arenaSfx.enabled = false
// to silence them, then listen to the arena:* and prop:* events)
// ---------------------------------------------------------------------------------------
let actx = null, aout = null, anoise = null, an = 0;
function ac() {
  if (!arenaSfx.enabled) return null;
  if (actx) { if (actx.state === 'suspended') actx.resume().catch(() => {}); return actx; }
  if (typeof AudioContext === 'undefined') return null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  try {
    actx = audioContext(); if (!actx) return null;   // shared context + mixer (src/audio)
    aout = actx.createGain();
    aout.gain.value = 0.8;
    aout.connect(legacyBus('arena'));
    anoise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = anoise.getChannelData(0);
    let s = 11;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  } catch { actx = null; return null; }
  return actx;
}
const avol = () => legacyVol();   // the mixer applies the settings volumes
function aenv(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function anz(c, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.3, attack = 0.003 } = {}) {
  const src = c.createBufferSource(); src.buffer = anoise;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  const g = c.createGain(); aenv(g, t, attack, gain * avol(), dur);
  src.connect(f).connect(g).connect(aout);
  src.start(t, (an++ * 0.191) % 0.8, dur + attack + 0.05);
}
function atone(c, t, dur, { type = 'sine', f0 = 200, f1 = f0, gain = 0.3, attack = 0.003 } = {}) {
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  const g = c.createGain(); aenv(g, t, attack, gain * avol(), dur);
  o.connect(g).connect(aout); o.start(t); o.stop(t + attack + dur + 0.05);
}
const aplay = (fn) => { const c = ac(); if (c) fn(c, c.currentTime, 1 + ((an++ * 37) % 9 - 4) * 0.02); };

export const arenaSfx = {
  enabled: true,
  /** the entry gate slamming up: a deep boom, an iron clang, grit */
  slam: () => aplay((c, t) => {
    atone(c, t, 0.5, { f0: 90, f1: 32, gain: 0.7 });
    anz(c, t, 0.5, { type: 'lowpass', f0: 1600, f1: 90, gain: 0.55 });
    atone(c, t + 0.01, 0.35, { type: 'square', f0: 420, f1: 400, gain: 0.05 });
    atone(c, t + 0.01, 0.5, { type: 'triangle', f0: 1270, f1: 1240, gain: 0.05 });
    anz(c, t + 0.12, 0.6, { type: 'highpass', f0: 3000, f1: 1500, gain: 0.06, attack: 0.05 });
  }),
  /** one ratchet step of the portcullis */
  clank: (k = 0) => aplay((c, t, j) => {
    anz(c, t, 0.06, { f0: 2400 * j, q: 4, gain: 0.25 });
    atone(c, t, 0.12, { type: 'square', f0: 180 + k * 12, f1: 150, gain: 0.05 });
    anz(c, t, 0.16, { type: 'lowpass', f0: 500, f1: 120, gain: 0.2 });
  }),
  /** the exit seal shattering */
  seal: () => aplay((c, t) => {
    anz(c, t, 0.25, { type: 'highpass', f0: 5000, f1: 2500, gain: 0.3 });
    atone(c, t, 0.6, { type: 'triangle', f0: 1568, f1: 1560, gain: 0.08 });
    atone(c, t + 0.04, 0.6, { type: 'triangle', f0: 2093, f1: 2090, gain: 0.06 });
  }),
  /** the room-clear sting: a rising minor-to-major arpeggio over a low drone */
  clear: () => aplay((c, t) => {
    atone(c, t, 1.4, { type: 'triangle', f0: 110, f1: 110, gain: 0.12, attack: 0.05 });
    [262, 311, 392, 523, 659].forEach((f, k) => atone(c, t + 0.07 * k, 0.7 - k * 0.05, { type: k < 2 ? 'square' : 'triangle', f0: k === 1 ? 330 : f, gain: k < 2 ? 0.035 : 0.07 }));
  }),
  /** a torch roaring up */
  ignite: () => aplay((c, t, j) => { anz(c, t, 0.35, { f0: 300 * j, f1: 1400, q: 1, gain: 0.12, attack: 0.04 }); }),
  /** clay breaking */
  pot: () => aplay((c, t, j) => {
    anz(c, t, 0.09, { f0: 3200 * j, q: 2, gain: 0.35 });
    for (let k = 1; k < 4; k++) anz(c, t + k * 0.035, 0.05, { f0: (2000 + k * 700) * j, q: 5, gain: 0.12 });
    atone(c, t, 0.08, { f0: 260 * j, f1: 120, gain: 0.15 });
  }),
  /** wood cracking / bursting */
  wood: (big = false) => aplay((c, t, j) => {
    anz(c, t, big ? 0.22 : 0.1, { type: 'lowpass', f0: 1800 * j, f1: 300, gain: big ? 0.45 : 0.3 });
    atone(c, t, 0.12, { type: 'square', f0: 110 * j, f1: 60, gain: 0.08 });
    if (big) for (let k = 1; k < 4; k++) anz(c, t + k * 0.05, 0.06, { f0: 900 * j + k * 200, q: 3, gain: 0.1 });
  }),
  /** bones rattling */
  bones: () => aplay((c, t, j) => { for (let k = 0; k < 5; k++) anz(c, t + k * 0.03 + (k % 2) * 0.01, 0.04, { f0: (1500 + k * 400) * j, q: 6, gain: 0.14 }); }),
  /** a sword on stone or iron */
  clink: (iron = false) => aplay((c, t, j) => {
    atone(c, t, 0.25, { type: 'triangle', f0: (iron ? 1850 : 1320) * j, f1: (iron ? 1800 : 1250) * j, gain: 0.07 });
    anz(c, t, 0.07, { f0: 4000, q: 3, gain: 0.2 });
    anz(c, t, 0.2, { type: 'lowpass', f0: 800, f1: 200, gain: 0.12 });
  }),
  /** a puff: candles snuffed */
  puff: () => aplay((c, t) => { anz(c, t, 0.2, { type: 'lowpass', f0: 900, f1: 200, gain: 0.15, attack: 0.01 }); }),
  /** a low rumble (the room waking, the portcullis starting) */
  rumble: (dur = 0.8) => aplay((c, t) => { anz(c, t, dur, { type: 'lowpass', f0: 220, f1: 60, gain: 0.4, attack: 0.08 }); atone(c, t, dur, { f0: 48, f1: 40, gain: 0.25, attack: 0.1 }); }),
};

// ---------------------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------------------

// Every kind of prop. r: body radius. solid: collider. hp: hits to break (Infinity: reacts only).
export const PROP_DEFS = {
  urn: { models: ['arena.urn.0', 'arena.urn.1', 'arena.urn.2'], r: 0.22, h: 0.8, hp: 1, solid: true, wreck: 'arena.shards',
    debris: [['woodLight', 'wood', 'bone'], ['mist', 'slate', 'teal'], ['woodLight', 'wood', 'blood']], sound: 'pot' },
  crate: { models: ['arena.crate'], cracked: 'arena.crate.cracked', r: 0.36, h: 0.75, hp: 2, solid: true, wreck: 'arena.planks', debris: [['wood', 'woodLight', 'dirt']], sound: 'wood' },
  barrel: { models: ['arena.barrel'], cracked: 'arena.barrel.cracked', r: 0.33, h: 0.9, hp: 2, solid: true, wreck: 'arena.planks', debris: [['wood', 'woodLight', 'slate']], sound: 'wood' },
  bones: { models: ['arena.bones'], r: 0.5, h: 0.35, hp: 1, solid: false, wreck: 'arena.bones.scatter', debris: [['bone', 'frost', 'bone']], sound: 'bones' },
  candles: { models: ['arena.candles'], r: 0.38, h: 0.9, hp: 1, solid: true, wreck: 'arena.candles.out', keepCollider: true, debris: [['bone', 'torch', 'bone']], sound: 'puff' },
  brazier: { models: ['arena.brazier'], r: 0.5, h: 1.3, hp: Infinity, solid: true, react: 'brazier', debris: [['slate', 'shadow']], light: { color: 'flame', intensity: 1.8, radius: 9.5, y: 1.55 }, fire: { y: 10 * V, size: 1.6 } },
  pillar: { models: ['arena.pillar.0', 'arena.pillar.1', 'arena.pillar.2'], box: 0.5, h: 2.2, hp: Infinity, solid: true, react: 'stone', debris: [['stone', 'stoneLight', 'dusk']] },
  statue: { models: ['arena.statue'], box: 0.66, h: 3.1, hp: Infinity, solid: true, react: 'stone', debris: [['mist', 'fog', 'slate']] },
  sarcophagus: { models: ['arena.sarcophagus'], boxW: 1.0, boxD: 0.56, h: 0.9, hp: Infinity, solid: true, react: 'stone', debris: [['stone', 'stoneLight', 'gold']] },
  skullpile: { models: ['arena.skullpile'], r: 0.66, h: 1.1, hp: Infinity, solid: true, react: 'bones', debris: [['bone', 'frost']] },
  rubble: { models: ['arena.rubble'], r: 0, h: 0.2, hp: 0, solid: false, decor: true },
  // set-pieces: big, never break, react like stone (the tree sheds leaves, the mound rattles)
  colossus: { models: ['arena.colossus'], boxW: 1.45, boxD: 1.25, h: 2.0, hp: Infinity, solid: true, react: 'stone', debris: [['stoneLight', 'stone', 'fog']], setPiece: true },
  throne: { models: ['arena.throne'], boxW: 1.05, boxD: 0.75, h: 3.6, hp: Infinity, solid: true, react: 'stone', debris: [['mist', 'gold', 'slate']], setPiece: true },
  tree: { models: ['arena.tree'], r: 0.55, h: 4.5, hp: Infinity, solid: true, react: 'tree', debris: [['leaf', 'moss', 'wood']], setPiece: true },
  fountain: { models: ['arena.fountain'], r: 1.55, h: 1.6, hp: Infinity, solid: true, react: 'stone', debris: [['mist', 'slate', 'sky']], setPiece: true },
  mound: { models: ['arena.mound'], r: 1.35, h: 1.6, hp: Infinity, solid: true, react: 'bones', debris: [['bone', 'frost']], setPiece: true },
};

let propSeq = 0;

class Prop {
  constructor(set, kind, x, z, { variant = 0, turn = 0, y = 0 } = {}) {
    const D = PROP_DEFS[kind];
    this.set = set; this.def = D; this.kind = kind; this.type = 'prop';
    this.id = `${kind}${++propSeq}`;
    this.x = x; this.z = z; this.y = y;   // y: standing on a ledge
    this.r = D.r ?? (D.box ? D.box * 0.75 : Math.max(D.boxW ?? 0.5, D.boxD ?? 0.5) * 0.8);
    this.h = D.h; this.hitY = y + Math.min(0.7, D.h * 0.5);
    this.hp = D.hp; this.maxHp = D.hp;
    this.variant = variant % D.models.length;
    this.turn = turn;
    this.dead = false;       // broken (combat skips dead targets)
    this.noAssist = true;    // keyboard aim assist ignores props
    this.hits = 0;
    this.tx = 0; this.tz = 0; this.tvx = 0; this.tvz = 0; this.ptx = 0; this.ptz = 0;   // rock spring (rad)
    this.flashT = 0; this.flare = 0;
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    set.root.add(this.group);
    this.mat = null;
    this.mesh = this.makeMesh(D.models[this.variant]);
    this.wreck = null;
    if (D.solid && !y) {
      const cw = set.cw;
      if (D.box) this.collider = cw.addRect(x, z, D.box * 2 * 0.86, D.box * 2 * 0.86, 'prop');
      else if (D.boxW) this.collider = turn % 2 ? cw.addRect(x, z, D.boxD * 2, D.boxW * 2, 'prop') : cw.addRect(x, z, D.boxW * 2, D.boxD * 2, 'prop');
      else this.collider = cw.addCircle(x, z, this.r, 'prop');
    }
    if (D.light) this.light = look.torch(this.group, { color: D.light.color, intensity: D.light.intensity, radius: D.light.radius, y: D.light.y, flicker: D.light.flicker ?? 1 });
  }

  makeMesh(name) {
    const m = voxelMesh(name, { ownMaterial: !this.def.decor });
    m.rotation.y = this.turn * Math.PI / 2;
    this.group.add(m);
    this.mat = m.material;
    return m;
  }
  swapModel(name) {
    this.group.remove(this.mesh);
    this.mesh = this.makeMesh(name);
  }

  get breakable() { return Number.isFinite(this.def.hp) && this.def.hp > 0; }
  get hittable() { return !this.def.decor && !this.dead; }

  /** combat contract: react, then return false so combat plays none of its own hit effects */
  takeHit(hit) {
    if (!this.hittable) return false;
    this.react(hit.dx, hit.dz, hit.power ?? 1, 'hit', hit);
    return false;
  }

  react(dx, dz, power, cause = 'hit', hit = null) {
    const D = this.def;
    this.hits++;
    events.emit('prop:hit', { prop: this, kind: this.kind, x: this.x, z: this.z, cause });
    // rock away from the blow
    const k = this.breakable ? 0.9 : D.react === 'brazier' ? 0.55 : 0.08;
    this.tvx += dz * k * power; this.tvz -= dx * k * power;
    this.flashT = 4;
    const cx = this.x - dx * this.r * 0.7, cz = this.z - dz * this.r * 0.7;
    if (this.breakable) {
      this.hp -= cause === 'hit' ? 1 : this.hp;
      if (this.hp <= 0) { this.shatter(dx, dz, power, cause); return; }
      // cracked: splinters and a model swap
      if (D.cracked) this.swapModel(D.cracked);
      chips(cx, this.hitY, cz, dx, dz, D.debris[0], 5, 0.8);
      vfx.dust(this.x, this.z, { dx, dz, n: 4, size: 0.7, palette: 'dustWarm' });
      arenaSfx[D.sound]?.(false);
      if (cause === 'hit') { feedback.hitstop(30); feedback.kick(dx, dz * 0.77, 1); }
      return;
    }
    // things that never break
    if (D.react === 'brazier') {
      this.flare = 1;
      vfx.embers(this.x, 1.3, this.z, { n: 18, spread: 0.45, up: 1.4 });
      chips(cx, 0.9, cz, dx, dz, ['ember', 'gold', 'flame'], 5, 1.1);
      look.flash(this.x, 1.5, this.z, { color: 'flame', ms: 140, intensity: 2.2, radius: 5 });
      arenaSfx.clink(true);
    } else if (D.react === 'bones') {
      chips(cx, 0.6, cz, dx, dz, D.debris[0], 6, 0.9);
      arenaSfx.bones();
    } else if (D.react === 'tree') {
      // bark chips off the trunk, leaves shaken down out of the crown
      chips(cx, 0.6, cz, dx, dz, ['wood', 'woodLight'], 4, 0.8);
      leaves(this.x, 3.4, this.z, cause === 'hit' ? 10 : 22);
      arenaSfx.wood(false);
    } else {
      // stone: chips off the face, grit and pebbles shaken off the top
      chips(cx, this.hitY + 0.2, cz, dx, dz, D.debris[0], cause === 'hit' ? 5 : 9, 0.9);
      vfx.hitSpark(cx, this.hitY + 0.2, cz, { dx, dz, power: 0.5, palette: 'cool', light: false });
      grit(this.x, D.h, this.z, cause === 'hit' ? 6 : 16, this.r);
      if (cause === 'hit') arenaSfx.clink(false);
    }
    if (cause === 'hit') { feedback.hitstop(28); feedback.kick(dx, dz * 0.77, 0.8); }
  }

  shatter(dx, dz, power, cause) {
    const D = this.def;
    this.dead = true;
    this.hp = 0;
    const cols = D.debris[this.variant % D.debris.length];
    if (this.kind === 'candles') {
      smoke(this.x, 0.9, this.z);
      chips(this.x, 0.8, this.z, dx, dz, cols, 5, 0.8);
      if (this.light) { this.light.remove(); this.light = null; }
    } else {
      chips(this.x, this.hitY, this.z, dx, dz, cols, this.kind === 'bones' ? 12 : 16, 1.3 + power * 0.2);
      vfx.dust(this.x, this.z, { dx, dz, n: 7, size: 1, palette: 'dustWarm' });
      if (this.kind !== 'bones') vfx.hitSpark(this.x, this.hitY, this.z, { dx, dz, power: 0.6, palette: 'hit', light: false });
    }
    // a few pieces stay on the floor for the rest of the room
    if (this.kind !== 'candles') look.impact?.chips?.(this.x, this.hitY, this.z, dx, dz, { n: this.kind === 'bones' ? 3 : 5, colors: cols, speed: 2.2 });
    arenaSfx[D.sound]?.(true);
    if (cause === 'hit') { feedback.hitstop(45); feedback.kick(dx, dz * 0.77, 1.4); feedback.shake(1.2, 90); }
    this.swapModel(D.wreck);
    this.mesh.rotation.y = Math.round(Math.atan2(dx, dz) / (Math.PI / 2)) * Math.PI / 2;
    this.tx = this.tz = this.tvx = this.tvz = 0;
    if (this.collider && !D.keepCollider) { this.set.cw.remove(this.collider); this.collider = null; }
    events.emit('prop:break', { prop: this, kind: this.kind, x: this.x, z: this.z, cause });
  }

  tick() {
    this.ptx = this.tx; this.ptz = this.tz;
    // a stiff, damped spring back to upright
    this.tvx += -this.tx * 0.32; this.tvz += -this.tz * 0.32;
    this.tvx *= 0.78; this.tvz *= 0.78;
    this.tx += this.tvx * 0.25; this.tz += this.tvz * 0.25;
    if (Math.abs(this.tx) < 1e-4 && Math.abs(this.tvx) < 1e-4) this.tx = this.tvx = 0;
    if (Math.abs(this.tz) < 1e-4 && Math.abs(this.tvz) < 1e-4) this.tz = this.tvz = 0;
    if (this.flashT > 0) this.flashT--;
    if (this.flare > 0) this.flare = Math.max(0, this.flare - 0.03);
  }

  render(alpha) {
    const tx = this.ptx + (this.tx - this.ptx) * alpha, tz = this.ptz + (this.tz - this.ptz) * alpha;
    // pivot on the base: rocking tilts about the floor contact
    this.group.rotation.set(tx, 0, tz);
    if (this.mat?.userData.flash) {
      const f = this.flashT > 2 ? 0.8 : this.flashT > 0 ? 0.35 : 0;
      this.mat.userData.flash.value = f;
      if (f) this.mat.userData.flashColor.value.setHex(hex('white'));
    }
    if (this.light) this.light.intensity = this.def.light.intensity * (1 + this.flare * 1.4 + (this.set.glow ?? 0));
  }

  dispose() {
    this.light?.remove();
    if (this.collider) this.set.cw.remove(this.collider);
    this.set.root.remove(this.group);
  }
}

/** Voxel chips bursting from a point, along (dx, dz). */
function chips(x, y, z, dx, dz, cols, n, spd = 1) {
  const base = Math.atan2(dx, dz);
  for (let k = 0; k < n; k++) {
    const a = base + (k / n - 0.5) * 2.6 + Math.sin(k * 12.9898 + x) * 0.3;
    const s = spd * (1.3 + (k % 4) * 0.6);
    const i = vfx.core.add(x, y, z, Math.sin(a) * s, 2.2 + (k % 5) * 0.8, Math.cos(a) * s, 0.8 + (k % 3) * 0.2, 2 + (k % 3 === 0 ? 1 : 0), cols[k % cols.length], vfx.core.CUBE);
    if (i < 0) break;
    const P = vfx.core.P;
    P.grav[i] = 22; P.bounce[i] = 0.35; P.floorY[i] = 0.04; P.pop[i] = 1; P.shrinkAt[i] = 0.8; P.fadeAt[i] = 0.82;
  }
}
/** Grit and pebbles sifting down from height h. */
function grit(x, h, z, n, r) {
  for (let k = 0; k < n; k++) {
    const a = k * 2.399, d = r * (0.3 + (k % 5) * 0.15);
    const i = vfx.core.add(x + Math.sin(a) * d, h + (k % 3) * 0.05, z + Math.cos(a) * d * 0.7, Math.sin(a) * 0.3, -0.5 - (k % 4) * 0.4, Math.cos(a) * 0.3,
      0.9 + (k % 4) * 0.12, k % 4 === 0 ? 2 : 1, k % 3 ? 'grit' : 'dust', k % 4 === 0 ? vfx.core.CUBE : vfx.core.SPRITE);
    if (i < 0) break;
    const P = vfx.core.P;
    P.grav[i] = 14; P.delay[i] = (k % 6) * 0.03; P.bounce[i] = 0.2; P.floorY[i] = 0.03; P.fadeAt[i] = 0.8;
  }
}
/** A grey smoke puff (snuffed candles). */
function smoke(x, y, z) {
  for (let k = 0; k < 8; k++) {
    const a = k * 0.785;
    const i = vfx.core.add(x + Math.sin(a) * 0.12, y, z + Math.cos(a) * 0.1, Math.sin(a) * 0.25, 0.7 + (k % 3) * 0.25, Math.cos(a) * 0.2, 0.9 + (k % 3) * 0.2, 2 + (k % 2), k % 2 ? 'mist' : 'fog', vfx.core.CUBE);
    if (i < 0) break;
    const P = vfx.core.P;
    P.drag[i] = 0.93; P.grav[i] = -0.3; P.shrinkAt[i] = 0.4; P.fadeAt[i] = 0.55; P.wob[i] = 0.6;
  }
}

/** Leaves shaken out of a crown: they flutter and drift down. */
function leaves(x, y, z, n) {
  for (let k = 0; k < n; k++) {
    const a = k * 2.399, d = 0.4 + (k % 5) * 0.3;
    const i = vfx.core.add(x + Math.sin(a) * d, y + (k % 3) * 0.15, z + Math.cos(a) * d * 0.8, Math.sin(a) * 0.4, -0.2, Math.cos(a) * 0.3,
      2.2 + (k % 4) * 0.3, k % 3 === 0 ? 2 : 1, k % 4 === 0 ? 'moss' : 'leaf', vfx.core.CUBE);
    if (i < 0) break;
    const P = vfx.core.P;
    P.grav[i] = 1.6; P.drag[i] = 0.96; P.wob[i] = 2.5; P.delay[i] = (k % 7) * 0.05; P.floorY[i] = 0.03; P.fadeAt[i] = 0.85;
  }
}

/** The props of one room. */
export function createProps(root, cw) {
  buildPropModels();
  const set = {
    root, cw, list: [], glow: 0,
    add(kind, x, z, opts) { const p = new Prop(set, kind, x, z, opts); set.list.push(p); return p; },
    /** Hittable props (for combat's targets list). */
    targets() { return set.list.filter((p) => p.hittable); },
    /** Break or shake everything within radius of (x, z): brute crashes and slams, orb pops. */
    breakNear(x, z, radius, { power = 1.5, cause = 'blast', only = null } = {}) {
      let n = 0;
      for (const p of set.list) {
        if (!p.hittable || (only && !only(p))) continue;
        const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
        if (d > radius + p.r) continue;
        const l = d || 1;
        p.react(dx / l, dz / l, power, cause);
        n++;
      }
      return n;
    },
    /** Per tick. hero: {x, z, speed} (bones scatter when the hero dashes through them). */
    tick(hero) {
      for (const p of set.list) {
        p.tick();
        if (hero && p.kind === 'bones' && !p.dead && hero.speed > 6.5) {
          const dx = p.x - hero.x, dz = p.z - hero.z, d = Math.hypot(dx, dz);
          if (d < p.r + 0.25) { const v = Math.hypot(hero.vx ?? dx, hero.vz ?? dz) || 1; p.react((hero.vx ?? dx) / v, (hero.vz ?? dz) / v, 1, 'dash'); }
        }
      }
    },
    render(alpha) { for (const p of set.list) p.render(alpha); },
    info() { return set.list.filter((p) => !p.def.decor).map((p) => ({ id: p.id, kind: p.kind, x: +p.x.toFixed(2), z: +p.z.toFixed(2), hp: Number.isFinite(p.hp) ? p.hp : null, broken: p.dead, hits: p.hits })); },
    dispose() { for (const p of set.list) p.dispose(); set.list.length = 0; },
  };
  return set;
}

