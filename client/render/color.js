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

// ---------------------------------------------------------------------------
// Cozy shading helpers. Shadows lean towards a deep plum and highlights
// towards a warm cream instead of plain black and white, which keeps every
// palette soft and warm.

/** Deep warm ink for outlines and cast shadows. */
export const INK = '#2b1d26';
/** Warm light used for highlights. */
export const CREAM = '#fff2cc';

/** '#rrggbb' → [h (0..360), s (0..1), l (0..1)]. */
export function toHsl(c) {
  const [R, G, B] = rgb(c);
  const r = R / 255;
  const g = G / 255;
  const b = B / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** HSL (h in degrees, s and l in 0..1) → '#rrggbb'. */
export function fromHsl(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) return hex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return hex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]);
}

/** Shift hue (degrees), saturation and lightness (fractions) of a colour. */
export function adjust(c, dh = 0, ds = 0, dl = 0) {
  const [h, s, l] = toHsl(c);
  return fromHsl(h + dh, s + ds, l + dl);
}

/**
 * Cozy shade: k < 0 darkens towards the plum ink (shadows get a little
 * cooler and redder), k > 0 lightens towards warm cream.
 */
export function cozy(c, k) {
  return k < 0 ? mix(c, INK, Math.min(1, -k)) : mix(c, CREAM, Math.min(1, k));
}

/**
 * A 7-step ramp around a fill colour: [-3, -2, -1, 0, +1, +2, +3].
 * `dark` and `light` (optional) pin the ±1 steps to hand-picked tones.
 */
export function ramp7(base, dark = null, light = null, step = 0.13) {
  const d = dark || cozy(base, -step);
  const l = light || cozy(base, step * 0.9);
  return [cozy(d, -step * 2.2), cozy(d, -step), d, base, l, cozy(l, step * 0.8), cozy(l, step * 1.7)];
}

/** Pack '#rrggbb' to a little-endian ABGR uint32 (for ImageData writes). */
export function packABGR(c, a = 255) {
  const [r, g, b] = rgb(c);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
