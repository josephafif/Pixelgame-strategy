// Seeded 2D gradient noise, built on integer hashing so it needs no
// permutation tables and gives the same output for the same seed everywhere.

import { hash3 } from './rng.js';

const GRAD = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
];

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function dotGrad(ix, iy, seed, dx, dy) {
  const g = GRAD[hash3(ix, iy, seed) & 7];
  return g[0] * dx + g[1] * dy;
}

/** Gradient noise in roughly [-1, 1]. */
export function gradNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fade(fx);
  const v = fade(fy);
  const n00 = dotGrad(x0, y0, seed, fx, fy);
  const n10 = dotGrad(x0 + 1, y0, seed, fx - 1, fy);
  const n01 = dotGrad(x0, y0 + 1, seed, fx, fy - 1);
  const n11 = dotGrad(x0 + 1, y0 + 1, seed, fx - 1, fy - 1);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.414;
}

/** Fractal sum of gradient noise, normalised to roughly [-1, 1]. */
export function fbm(x, y, seed, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gradNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal noise in [0, 1]; sharp crests suit mountain chains. */
export function ridged(x, y, seed, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(gradNoise(x * freq, y * freq, seed + o * 7919));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

/** Cheap value noise on an integer lattice, [0,1). Used for pixel-level art. */
export function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const h = (ix, iy) => hash3(ix, iy, seed) / 4294967296;
  const a = h(x0, y0);
  const b = h(x0 + 1, y0);
  const c = h(x0, y0 + 1);
  const d = h(x0 + 1, y0 + 1);
  return a + u * (b - a) + v * (c - a) + u * v * (a - b - c + d);
}
