// Deterministic randomness. Nothing in engine/ may call Math.random: every
// choice must be reproducible from the match seed so that the server, the
// single-player worker and the tests all agree.

/** 32-bit integer mix (a variant of the murmur3 finalizer). */
export function mix32(h) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash any number of integers into one unsigned 32-bit value. */
export function hash(...ints) {
  let h = 0x9e3779b9;
  for (let i = 0; i < ints.length; i++) {
    h = mix32(h ^ Math.imul((ints[i] | 0) + 0x7f4a7c15, 0x27d4eb2d));
  }
  return h;
}

/** Fast three-integer hash (no rest-argument allocation); hot paths use this. */
export function hash3(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash a string to a seed. */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mix32(h);
}

/** A [0,1) float for integer coordinates (cheap per-tile randomness). */
export function rand2(x, y, seed) {
  return hash3(x, y, seed) / 4294967296;
}

export function rand3(x, y, z, seed) {
  return hash(x, y, z, seed) / 4294967296;
}

/** Seedable PRNG (sfc32). */
export class Rng {
  constructor(seed) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.a = mix32(s ^ 0xdeadbeef);
    this.b = mix32(s ^ 0x41c64e6d);
    this.c = mix32(s ^ 0x6c078965);
    this.d = 1;
    for (let i = 0; i < 12; i++) this.u32();
  }

  u32() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0,1). */
  next() {
    return this.u32() / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo, hi) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  range(lo, hi) {
    return lo + this.next() * (hi - lo);
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick: items is [[value, weight], ...]. */
  weighted(items) {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r < 0) return v;
    }
    return items[items.length - 1][0];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** A child generator whose stream depends on this seed plus a label. */
  fork(label) {
    return new Rng(mix32(this.u32() ^ (typeof label === 'string' ? hashString(label) : label)));
  }
}
