// Colour helpers for the pixel painters.

const cache = new Map();

/** '#rrggbb' → [r, g, b] (cached). */
export function rgb(hex) {
  let v = cache.get(hex);
  if (!v) {
    v = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    cache.set(hex, v);
  }
  return v;
}

export function hex([r, g, b]) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix two hex colours, t in [0,1]. */
export function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** Darken (k<0) or lighten (k>0) a hex colour by a fraction. */
export function shade(c, k) {
  return k < 0 ? mix(c, '#000000', -k) : mix(c, '#ffffff', k);
}

/** Pick a darker, slightly cooler outline colour for a fill. */
export function outlineOf(c) {
  const [r, g, b] = rgb(c);
  return hex([r * 0.35, g * 0.35, b * 0.42 + 8]);
}

/** 4×4 Bayer matrix thresholds in [0,1) for ordered dithering. */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
