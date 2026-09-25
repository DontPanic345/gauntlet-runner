// Seeded RNG. sfc32 seeded through a string/int hash, so the same seed gives the same
// run on every machine. Use fork(label) to get an independent, stable stream per system
// ("arenas", "loot", ...): adding a random call in one system never shifts another.

function hash32(str) {
  // cyrb-style 32-bit mix of a string
  let h = 0x811c9dc5 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  /** @param {number|string} seed */
  constructor(seed = 1) {
    this.seed = seed;
    const s = String(seed);
    this.a = hash32(s + '#a');
    this.b = hash32(s + '#b');
    this.c = hash32(s + '#c');
    this.d = hash32(s + '#d') | 1;
    for (let i = 0; i < 12; i++) this.u32();
  }

  /** Uniform 32-bit unsigned integer. */
  u32() {
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next() { return this.u32() / 4294967296; }
  /** Float in [lo, hi). */
  range(lo, hi) { return lo + (hi - lo) * this.next(); }
  /** Integer in [lo, hi] inclusive. */
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  /** True with probability p. */
  chance(p) { return this.next() < p; }
  /** Random element of an array. */
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** Pick from [{w, ...}] or [[item, weight]] by weight. */
  weighted(items) {
    const w = (it) => (Array.isArray(it) ? it[1] : it.w);
    let total = 0;
    for (const it of items) total += w(it);
    let r = this.next() * total;
    for (const it of items) { r -= w(it); if (r < 0) return Array.isArray(it) ? it[0] : it; }
    const last = items[items.length - 1];
    return Array.isArray(last) ? last[0] : last;
  }
  /** Fisher-Yates shuffle in place; returns arr. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** Signed float in [-1, 1). */
  signed() { return this.next() * 2 - 1; }
  /** Independent stream derived from this seed and a label. Stable across code changes elsewhere. */
  fork(label) { return new Rng(`${this.seed}/${label}`); }
}

/** The run's root RNG. main.js reseeds it from ?seed. Fork it; don't draw from it directly. */
export let rng = new Rng(1);
export function reseed(seed) { rng = new Rng(seed); return rng; }
