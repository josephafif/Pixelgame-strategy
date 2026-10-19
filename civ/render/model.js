// A tiny 3D model and rasterizer for building sprites.
//
// World units: X east, Y south, Z up. One unit is one pixel at full zoom (a
// map tile is 16 units, a town cell 8). The view is orthographic, from the
// south and above: screen x = X, screen y = Y - K*Z (walls are drawn at
// three quarters of their height, so the back slope of a roof shows as a
// darker band behind the ridge), and of two points on the same pixel the one
// with the larger K*Y + Z is nearer. Every face is a
// flat convex polygon; curved parts (cones, cylinders, domes) are fine
// polygons shaded with the true surface normal, so they light smoothly.
//
// A sprite is rendered once: faces are scan-converted with a depth buffer,
// lit, textured by their material (roof courses, brick, timber framing,
// windows and doors as decals), then given eave shadows, rims where a near
// part stands in front of a far one, and a soft dark outline. The shadow the
// building casts on the ground is rendered as a separate mask.

import { BAYER4, mix } from '../../client/render/color.js';
import { makeCanvas } from '../../client/render/pix.js';

const INK = '#2b1d26';

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Light used for shading (towards the light: from the west, a little from the front, mostly above). */
export const LIGHT = norm([-0.6, 0.2, 0.77]);
/** Ground shift of a cast shadow per unit of height (to the lower right). */
const SHADOW = [0.62, 0.3];
/** Foreshortening of heights on screen. */
export const K = 0.72;
const AMB = 0.3;
const DIF = 0.75;

export class Model {
  constructor() {
    this.faces = [];
  }

  /**
   * A flat convex face. pts: [[x, y, z], ...] in order round the edge.
   * o.inside: a point inside the solid (orients the normal outwards); or
   * o.n: the outward normal. o.normal(X, Y, Z) gives a curved surface's
   * normal per point. o.deco: decals for wall textures. o.part: 'wall',
   * 'roof' or 'detail'. o.bias: depth bias (decals drawn over a face).
   */
  face(pts, mat, o = {}) {
    if (!mat) return null;
    let n;
    if (o.n) n = norm(o.n);
    else {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      n = norm([nx, ny, nz]);
      if (o.inside) {
        const c = centroid(pts);
        if (dot(n, [c[0] - o.inside[0], c[1] - o.inside[1], c[2] - o.inside[2]]) < 0) n = [-n[0], -n[1], -n[2]];
      }
    }
    // Texture axes: U along the face horizontally, V up the face.
    let U;
    if (Math.abs(n[2]) > 0.999) U = [1, 0, 0];
    else U = norm(cross([0, 0, 1], n));
    const V = norm(cross(n, U));
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of pts) {
      const u = dot(p, U);
      const v = dot(p, V);
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const f = {
      pts,
      n,
      d: dot(n, pts[0]),
      mat,
      normal: o.normal || null,
      deco: o.deco || null,
      part: o.part || (Math.abs(n[2]) < 0.2 ? 'wall' : 'roof'),
      // Roofs rest on walls and win ties along the eave; details stand in front.
      bias: (o.bias || 0) + ((o.part || (Math.abs(n[2]) < 0.2 ? 'wall' : 'roof')) === 'roof' ? 0.06 : o.part === 'detail' ? 0.02 : 0),
      U,
      V,
      uMin,
      uMax,
      vMin,
      vMax,
      z0: Math.min(...pts.map((p) => p[2])),
      shadow: o.shadow !== false,
      id: this.faces.length,
    };
    this.faces.push(f);
    return f;
  }

  quad(a, b, c, d, mat, o) {
    return this.face([a, b, c, d], mat, o);
  }

  tri(a, b, c, mat, o) {
    return this.face([a, b, c], mat, o);
  }

  /**
   * A box. o.top: material of the top face (false for none); o.south,
   * o.west, o.east, o.north: decals of the walls.
   */
  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    const inside = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const top = o.top === undefined ? mat : o.top;
    if (top) this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], top, { n: [0, 0, 1], part: o.topPart || 'roof', deco: o.topDeco });
    this.face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], o.southMat || mat, { n: [0, 1, 0], deco: o.south, part: o.part });
    this.face([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], o.westMat || mat, { n: [-1, 0, 0], deco: o.west, part: o.part });
    this.face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], o.eastMat || mat, { n: [1, 0, 0], deco: o.east, part: o.part });
    this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], mat, { n: [0, -1, 0], part: o.part });
    return inside;
  }

  /**
   * A gabled roof over x0..x1, y0..y1 resting at height z, ridge `rise`
   * above it. axis 'x': the ridge runs east-west (slopes face front and
   * back); 'y': it runs north-south (a gable faces the viewer).
   * o.over: overhang; o.gable: material of the gable ends; o.edge: barge
   * boards and fascia; o.gableDeco: decals of the front gable.
   */
  gable(x0, y0, x1, y1, z, rise, axis, mat, o = {}) {
    const ov = o.over ?? 1;
    const drop = (ov * rise) / ((axis === 'x' ? y1 - y0 : x1 - x0) / 2);
    const ze = z - drop;
    const zr = z + rise;
    const gm = o.gable || null;
    const edge = o.edge || null;
    if (axis === 'x') {
      const ym = (y0 + y1) / 2;
      const inside = [(x0 + x1) / 2, ym, z];
      this.quad([x0 - ov, y1 + ov, ze], [x1 + ov, y1 + ov, ze], [x1 + ov, ym, zr], [x0 - ov, ym, zr], mat, { inside, part: 'roof' });
      this.quad([x0 - ov, y0 - ov, ze], [x1 + ov, y0 - ov, ze], [x1 + ov, ym, zr], [x0 - ov, ym, zr], mat, { inside, part: 'roof' });
      if (edge) this.quad([x0 - ov, y1 + ov, ze], [x1 + ov, y1 + ov, ze], [x1 + ov, y1 + ov, ze - 1], [x0 - ov, y1 + ov, ze - 1], edge, { n: [0, 1, 0], part: 'roof' });
      if (gm) {
        this.tri([x0, y0, z], [x0, y1, z], [x0, ym, zr], gm, { n: [-1, 0, 0], part: 'wall' });
        this.tri([x1, y0, z], [x1, y1, z], [x1, ym, zr], gm, { n: [1, 0, 0], part: 'wall' });
      }
    } else {
      const xm = (x0 + x1) / 2;
      const inside = [xm, (y0 + y1) / 2, z];
      this.quad([x0 - ov, y0 - ov, ze], [x0 - ov, y1 + ov, ze], [xm, y1 + ov, zr], [xm, y0 - ov, zr], mat, { inside, part: 'roof' });
      this.quad([x1 + ov, y0 - ov, ze], [x1 + ov, y1 + ov, ze], [xm, y1 + ov, zr], [xm, y0 - ov, zr], mat, { inside, part: 'roof' });
      if (gm) {
        this.tri([x0, y1, z], [x1, y1, z], [xm, y1, zr], gm, { n: [0, 1, 0], part: 'wall', deco: o.gableDeco });
        this.tri([x0, y0, z], [x1, y0, z], [xm, y0, zr], gm, { n: [0, -1, 0], part: 'wall' });
      }
      if (edge) {
        const yf = y1 + ov;
        this.quad([x0 - ov, yf, ze], [xm, yf, zr], [xm, yf, zr - 1.2], [x0 - ov, yf, ze - 1.2], edge, { n: [0, 1, 0], part: 'roof', bias: 0.05 });
        this.quad([xm, yf, zr], [x1 + ov, yf, ze], [x1 + ov, yf, ze - 1.2], [xm, yf, zr - 1.2], edge, { n: [0, 1, 0], part: 'roof', bias: 0.05 });
      }
    }
  }

  /** A hipped roof (a pyramid on a square base); the ridge runs along the longer side. */
  hip(x0, y0, x1, y1, z, rise, mat, o = {}) {
    const ov = o.over ?? 1;
    const w = x1 - x0;
    const d = y1 - y0;
    const half = Math.min(w, d) / 2 + ov;
    const ze = z - (ov * rise) / (Math.min(w, d) / 2);
    const zr = z + rise;
    const X0 = x0 - ov;
    const X1 = x1 + ov;
    const Y0 = y0 - ov;
    const Y1 = y1 + ov;
    const inside = [(x0 + x1) / 2, (y0 + y1) / 2, z];
    const opt = { inside, part: 'roof' };
    if (w >= d) {
      const ym = (Y0 + Y1) / 2;
      const ra = X0 + half;
      const rb = X1 - half;
      this.quad([X0, Y1, ze], [X1, Y1, ze], [rb, ym, zr], [ra, ym, zr], mat, opt);
      this.quad([X0, Y0, ze], [X1, Y0, ze], [rb, ym, zr], [ra, ym, zr], mat, opt);
      this.tri([X0, Y0, ze], [X0, Y1, ze], [ra, ym, zr], mat, opt);
      this.tri([X1, Y0, ze], [X1, Y1, ze], [rb, ym, zr], mat, opt);
    } else {
      const xm = (X0 + X1) / 2;
      const ra = Y0 + half;
      const rb = Y1 - half;
      this.quad([X0, Y0, ze], [X0, Y1, ze], [xm, rb, zr], [xm, ra, zr], mat, opt);
      this.quad([X1, Y0, ze], [X1, Y1, ze], [xm, rb, zr], [xm, ra, zr], mat, opt);
      this.tri([X0, Y1, ze], [X1, Y1, ze], [xm, rb, zr], mat, opt);
      this.tri([X0, Y0, ze], [X1, Y0, ze], [xm, ra, zr], mat, opt);
    }
  }

  /** A lean-to roof sloping down towards `dir` ('s', 'n', 'e', 'w'). */
  shed(x0, y0, x1, y1, z, rise, dir, mat, o = {}) {
    const ov = o.over ?? 0.5;
    const X0 = x0 - ov;
    const X1 = x1 + ov;
    const Y0 = y0 - ov;
    const Y1 = y1 + ov;
    const hi = z + rise;
    const inside = [(x0 + x1) / 2, (y0 + y1) / 2, z - 1];
    const zAt = { s: [hi, hi, z, z], n: [z, z, hi, hi], e: [hi, z, z, hi], w: [z, hi, hi, z] }[dir];
    this.quad([X0, Y0, zAt[0]], [X1, Y0, zAt[1]], [X1, Y1, zAt[2]], [X0, Y1, zAt[3]], mat, { inside, part: 'roof' });
    if (o.wall) {
      if (dir === 'n') this.quad([x0, y1, z], [x1, y1, z], [x1, y1, hi], [x0, y1, hi], o.wall, { n: [0, 1, 0], part: 'wall', deco: o.deco });
      if (dir === 'e') this.tri([x0, y1, z], [x1, y1, z], [x0, y1, hi], o.wall, { n: [0, 1, 0], part: 'wall' });
      if (dir === 'w') this.tri([x0, y1, z], [x1, y1, z], [x1, y1, hi], o.wall, { n: [0, 1, 0], part: 'wall' });
    }
  }

  /** A vertical cylinder; o.top: material of the top disc. */
  cyl(cx, cy, r, z0, z1, mat, o = {}) {
    const seg = o.seg || Math.max(10, Math.round(r * 3));
    const normal = (X, Y) => norm([X - cx, Y - cy, 0]);
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2;
      const a1 = ((k + 1) / seg) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
      const p1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
      const am = (a0 + a1) / 2;
      this.quad([p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1], mat, { n: [Math.cos(am), Math.sin(am), 0], normal, part: o.part || 'wall', deco: o.deco });
    }
    if (o.top) {
      const pts = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z1]);
      }
      this.face(pts, o.top, { n: [0, 0, 1], part: 'roof' });
    }
  }

  /** A cone (conical roof) of radius r at height z0 rising h. */
  cone(cx, cy, r, z0, h, mat, o = {}) {
    const seg = o.seg || Math.max(10, Math.round(r * 3));
    const normal = (X, Y) => {
      const dx = X - cx;
      const dy = Y - cy;
      const rho = Math.hypot(dx, dy) || 1;
      return norm([(dx / rho) * h, (dy / rho) * h, r]);
    };
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2;
      const a1 = ((k + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      this.tri([cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z0], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z0], [cx, cy, z0 + h], mat, { n: [Math.cos(am) * h, Math.sin(am) * h, r], normal, part: 'roof' });
    }
  }

  /** A dome: half an ellipsoid of radius r and height h standing at z0. */
  dome(cx, cy, r, z0, h, mat, o = {}) {
    const seg = o.seg || Math.max(12, Math.round(r * 3));
    const rings = o.rings || Math.max(4, Math.round(h / 1.5));
    const normal = (X, Y, Z) => norm([(X - cx) / (r * r), (Y - cy) / (r * r), Math.max(0, Z - z0) / (h * h)]);
    for (let j = 0; j < rings; j++) {
      const b0 = (j / rings) * (Math.PI / 2);
      const b1 = ((j + 1) / rings) * (Math.PI / 2);
      const r0 = Math.cos(b0) * r;
      const r1 = Math.cos(b1) * r;
      const h0 = z0 + Math.sin(b0) * h;
      const h1 = z0 + Math.sin(b1) * h;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2;
        const a1 = ((k + 1) / seg) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const bm = (b0 + b1) / 2;
        const pts = [
          [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, h0],
          [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0, h0],
          [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, h1],
        ];
        if (r1 > 0.01) pts.push([cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1, h1]);
        this.face(pts, mat, { n: [Math.cos(am) * Math.cos(bm), Math.sin(am) * Math.cos(bm), Math.sin(bm) * (r / h)], normal, part: 'roof' });
      }
    }
  }

  /** A flat roof with a parapet round its edge. */
  flat(x0, y0, x1, y1, z, mat, o = {}) {
    const p = o.parapet ?? 1;
    const pm = o.parapetMat || mat;
    this.face([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], mat, { n: [0, 0, 1], part: 'roof', deco: o.deco });
    if (p > 0) {
      const t = o.thick ?? 1;
      this.box(x0, y1 - t, z, x1, y1, z + p, pm, { part: 'roof' });
      this.box(x0, y0, z, x1, y0 + t, z + p, pm, { part: 'roof' });
      this.box(x0, y0, z, x0 + t, y1, z + p, pm, { part: 'roof' });
      this.box(x1 - t, y0, z, x1, y1, z + p, pm, { part: 'roof' });
    }
  }

  /** A thin vertical pole (masts, flagpoles, chimneys' tops). */
  pole(x, y, z0, z1, mat, w = 1) {
    this.box(x, y, z0, x + w, y + w, z1, mat, { part: 'detail' });
  }
}

function centroid(pts) {
  const c = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
}

/** Point-in-convex-polygon test in screen space (inclusive edges). */
function inside2(poly, x, y, sgn) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c * sgn < -1e-7) return false;
  }
  return true;
}

function area2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/**
 * Render a model. Returns { canvas, w, h, ox, oy, shadow } where (ox, oy)
 * is where the world origin falls on the canvas, and shadow is
 * { canvas, ox, oy } (an opaque mask to draw with low alpha), or null.
 * opts.snow: whitens upward faces; opts.ruin: 0..1 decay (burnt, broken);
 * opts.seed varies textures.
 */
export function renderModel(model, opts = {}) {
  const faces = model.faces;
  const vis = faces.filter((f) => K * f.n[1] + f.n[2] > 1e-4 && f.pts.length >= 3);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of vis) {
    for (const p of f.pts) {
      const sx = p[0];
      const sy = p[1] - K * p[2];
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
  }
  if (!vis.length) return null;
  const X0 = Math.floor(minX) - 1;
  const Y0 = Math.floor(minY) - 1;
  const W = Math.ceil(maxX) + 1 - X0;
  const H = Math.ceil(maxY) + 1 - Y0;
  const n = W * H;
  const depth = new Float32Array(n).fill(-Infinity);
  const fid = new Int16Array(n).fill(-1);
  const wx = new Float32Array(n);
  const wy = new Float32Array(n);
  const wz = new Float32Array(n);
  for (const f of vis) {
    const poly = f.pts.map((p) => [p[0], p[1] - K * p[2]]);
    const sgn = Math.sign(area2(poly)) || 1;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const p of poly) {
      bx0 = Math.min(bx0, p[0]);
      by0 = Math.min(by0, p[1]);
      bx1 = Math.max(bx1, p[0]);
      by1 = Math.max(by1, p[1]);
    }
    const den = K * f.n[1] + f.n[2];
    for (let py = Math.max(0, Math.floor(by0) - Y0); py <= Math.min(H - 1, Math.ceil(by1) - Y0); py++) {
      const sy = Y0 + py + 0.5;
      for (let px = Math.max(0, Math.floor(bx0) - X0); px <= Math.min(W - 1, Math.ceil(bx1) - X0); px++) {
        const sx = X0 + px + 0.5;
        if (!inside2(poly, sx, sy, sgn)) continue;
        const Z = (f.d - f.n[0] * sx - f.n[1] * sy) / den;
        const Y = sy + K * Z;
        const dp = K * Y + Z + f.bias;
        const i = py * W + px;
        if (dp > depth[i] + 1e-4) {
          depth[i] = dp;
          fid[i] = f.id;
          wx[i] = sx;
          wy[i] = Y;
          wz[i] = Z;
        }
      }
    }
  }

  // Shade every covered pixel: a tone index into its material's ramp.
  const tone = new Float32Array(n);
  const ramps = new Array(n);
  const flatT = new Uint8Array(n);
  const ctx = { seed: opts.seed | 0, snow: !!opts.snow, ruin: opts.ruin || 0 };
  for (let i = 0; i < n; i++) {
    const id = fid[i];
    if (id < 0) continue;
    const f = faces[id];
    const X = wx[i];
    const Y = wy[i];
    const Z = wz[i];
    const nn = f.normal ? f.normal(X, Y, Z) : f.n;
    const lum = AMB + DIF * Math.max(0, dot(nn, LIGHT));
    const mat = f.mat;
    let t = 0.5 + lum * 5.0;
    let ramp = mat.ramp;
    const px = i % W;
    const py = (i / W) | 0;
    if (mat.tex) {
      const u = dot([X, Y, Z], f.U) - f.uMin;
      const v = dot([X, Y, Z], f.V) - f.vMin;
      const r = mat.tex(u, v, f, X, Y, Z, X0 + px, Y0 + py, ctx);
      if (typeof r === 'number') t += r;
      else if (r) {
        if (r.ramp) ramp = r.ramp;
        if (r.d) t += r.d;
        if (r.t !== undefined) t = r.t;
      }
    }
    if (f.part === 'roof' && nn[2] < 0.97 && !f.normal) {
      // Ridge caps catch the light; verges at the gable ends are darker.
      const u = dot([X, Y, Z], f.U) - f.uMin;
      const v = dot([X, Y, Z], f.V) - f.vMin;
      if (v > f.vMax - f.vMin - 0.9) t += 0.55;
      else if (f.pts.length === 4 && (u < 0.8 || u > f.uMax - f.uMin - 0.8)) t -= 0.55;
    }
    if (f.deco) {
      const r = decal(f, X, Y, Z, ctx);
      if (r) {
        if (r.ramp) ramp = r.ramp;
        if (r.t !== undefined) t = r.t + (r.lit ? 0 : (lum - 0.6) * 3);
        if (r.d) t += r.d;
      }
    }
    if (ctx.snow && nn[2] > 0.45 && f.part === 'roof' && !mat.noSnow) {
      ramp = SNOW;
      t = 2.6 + lum * 3.6 + ((hashp(X0 + px, Y0 + py) & 7) === 0 ? -1 : 0);
    }
    if (f.part === 'wall' && Z < 1.2) t -= 0.8; // contact shading at the foot of walls
    ramps[i] = ramp;
    tone[i] = t;
    flatT[i] = f.normal ? 0 : 1;
  }

  // Eave shadows: wall pixels just under a nearer roof pixel; rims where a
  // nearer part stands in front of a farther one.
  const adj = new Float32Array(n);
  for (let py = 1; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const id = fid[i];
      if (id < 0) continue;
      const f = faces[id];
      if (f.part === 'wall') {
        const a = fid[i - W];
        if (a >= 0 && faces[a].part === 'roof' && depth[i - W] > depth[i] + 0.3) adj[i] -= 1.6;
        else if (py > 1) {
          const a2 = fid[i - 2 * W];
          if (a2 >= 0 && faces[a2].part === 'roof' && depth[i - 2 * W] > depth[i] + 0.3 && fid[i - W] === id) adj[i] -= 0.8;
        }
      }
    }
  }
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      if (fid[i] < 0) continue;
      const di = depth[i];
      const near = (j) => fid[j] >= 0 && depth[j] > di + 2.5;
      if ((px > 0 && near(i - 1)) || (px < W - 1 && near(i + 1)) || (py > 0 && near(i - W)) || (py < H - 1 && near(i + W))) adj[i] -= 1.2;
    }
  }

  // Creases between roof faces (ridges, hips, valleys): the darker side gets a line.
  for (let py = 0; py < H - 1; py++) {
    for (let px = 0; px < W - 1; px++) {
      const i = py * W + px;
      const a = fid[i];
      if (a < 0 || faces[a].part !== 'roof' || faces[a].normal) continue;
      for (const j of [i + 1, i + W]) {
        const b = fid[j];
        if (b < 0 || b === a || faces[b].part !== 'roof' || faces[b].normal) continue;
        if (dot(faces[a].n, faces[b].n) > 0.97) continue;
        if (Math.abs(depth[i] - depth[j]) > 1.5) continue;
        if (tone[i] + adj[i] <= tone[j] + adj[j]) adj[i] -= 0.9;
        else adj[j] -= 0.9;
      }
    }
  }

  // Colours.
  const canvas = makeCanvas(W, H);
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, H);
  const data = img.data;
  const col = new Array(n);
  for (let i = 0; i < n; i++) {
    if (fid[i] < 0) continue;
    const ramp = ramps[i];
    const px = i % W;
    const py = (i / W) | 0;
    let t = tone[i] + adj[i];
    let k;
    if (flatT[i]) k = Math.round(t);
    else k = Math.floor(t + BAYER4[(py & 3) * 4 + (px & 3)]);
    k = k < 0 ? 0 : k >= ramp.length ? ramp.length - 1 : k;
    col[i] = ramp[k];
  }
  // Soft outline: darkened neighbour colour round the silhouette.
  const outline = [];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      if (fid[i] >= 0) continue;
      let c = null;
      if (py < H - 1 && fid[i + W] >= 0) c = col[i + W];
      else if (px > 0 && fid[i - 1] >= 0) c = col[i - 1];
      else if (px < W - 1 && fid[i + 1] >= 0) c = col[i + 1];
      else if (py > 0 && fid[i - W] >= 0) c = col[i - W];
      if (c) outline.push([i, mix(c, INK, 0.72)]);
    }
  }
  for (const [i, c] of outline) col[i] = c;
  for (let i = 0; i < n; i++) {
    const c = col[i];
    if (!c) continue;
    const v = parseInt(c.slice(1), 16);
    data[i * 4] = v >> 16;
    data[i * 4 + 1] = (v >> 8) & 255;
    data[i * 4 + 2] = v & 255;
    data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  const shadow = opts.shadow === false ? null : castShadow(faces);
  const out = { canvas, w: W, h: H, ox: -X0, oy: -Y0, shadow };
  if (opts.debug) out.debug = { fid, col, tone, adj, W, H };
  return out;
}

/** The shadow a model casts on the ground: every face projected along the light, filled. */
function castShadow(faces) {
  const polys = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of faces) {
    if (!f.shadow) continue;
    const poly = f.pts.map((p) => [p[0] + p[2] * SHADOW[0], p[1] + p[2] * SHADOW[1]]);
    if (Math.abs(area2(poly)) < 1e-6) continue;
    polys.push(poly);
    for (const p of poly) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  if (!polys.length) return null;
  const X0 = Math.floor(minX);
  const Y0 = Math.floor(minY);
  const W = Math.ceil(maxX) - X0 + 1;
  const H = Math.ceil(maxY) - Y0 + 1;
  const mask = new Uint8Array(W * H);
  for (const poly of polys) {
    const sgn = Math.sign(area2(poly)) || 1;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const p of poly) {
      bx0 = Math.min(bx0, p[0]);
      by0 = Math.min(by0, p[1]);
      bx1 = Math.max(bx1, p[0]);
      by1 = Math.max(by1, p[1]);
    }
    for (let py = Math.max(0, Math.floor(by0) - Y0); py <= Math.min(H - 1, Math.ceil(by1) - Y0); py++) {
      for (let px = Math.max(0, Math.floor(bx0) - X0); px <= Math.min(W - 1, Math.ceil(bx1) - X0); px++) {
        if (inside2(poly, X0 + px + 0.5, Y0 + py + 0.5, sgn)) mask[py * W + px] = 1;
      }
    }
  }
  const canvas = makeCanvas(W, H);
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    img.data[i * 4] = 0x2b;
    img.data[i * 4 + 1] = 0x1d;
    img.data[i * 4 + 2] = 0x26;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { canvas, ox: -X0, oy: -Y0 };
}

const SNOW = ['#9aa6b0', '#b4bfc6', '#cdd6da', '#e2e8ea', '#f1f4f2', '#fbfcf8', '#ffffff'];

export function hashp(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Decals: windows, doors and shutters on walls, given per face as
// { win: { ramp, w, h, bay, rows: [z...], lit, frame }, door: { ramp, u, w, h },
//   shutters: ramp, sill: ramp, arch: bool }

function decal(f, X, Y, Z, ctx) {
  const d = f.deco;
  const u = X * f.U[0] + Y * f.U[1] + Z * f.U[2] - f.uMin;
  const z = Z - f.z0;
  const width = f.uMax - f.uMin;
  if (d.door) {
    const dr = d.door;
    const du = dr.u === undefined ? Math.floor((width - dr.w) / 2) : dr.u;
    if (u >= du && u < du + dr.w && z < dr.h) {
      if (dr.arch && z >= dr.h - 1 && (u < du + 0.99 || u >= du + dr.w - 0.99)) return null;
      const edge = u < du + 1 && dr.w > 2;
      return { ramp: dr.ramp, t: edge ? 1.5 : z > dr.h - 1.5 ? 1.8 : 2.6 };
    }
  }
  if (d.win) {
    const w = d.win;
    const bay = w.bay || 4;
    const margin = w.margin ?? Math.max(1, Math.floor((width - Math.floor((width - 1) / bay) * bay) / 2));
    const cols = Math.max(1, Math.floor((width - 2 * margin + (bay - w.w)) / bay));
    const used = cols * bay - (bay - w.w);
    const start = Math.floor((width - used) / 2);
    const k = Math.floor((u - start) / bay);
    const fu = u - start - k * bay;
    if (k >= 0 && k < cols && !(d.door && d.skip && Math.abs(start + k * bay + w.w / 2 - width / 2) < (d.door.w + 1) / 2 + 0.5)) {
      for (const rz of w.rows) {
        if (z >= rz && z < rz + w.h && fu >= 0 && fu < w.w) {
          const top = z >= rz + w.h - 1;
          const lit = w.lit && hashp(Math.floor(X / bay), Math.floor(Z) + ctx.seed) % 5 < 2;
          if (w.arch && top && w.w > 1 && (fu < 0.99 || fu >= w.w - 0.99)) return null;
          if (lit) return { ramp: LIT, t: top ? 3 : 4, lit: true };
          return { ramp: w.ramp, t: fu < 1 && top ? 3.4 : top ? 2.4 : 1.6 };
        }
        if (w.sill && z >= rz - 1 && z < rz && fu >= -0.01 && fu < w.w + 0.01) return { ramp: w.sill, d: 1 };
        if (d.shutters && z >= rz && z < rz + w.h && ((fu >= -1 && fu < 0) || (fu >= w.w && fu < w.w + 1))) return { ramp: d.shutters, t: 3 };
        if (d.boxes && z >= rz - 1 && z < rz && fu >= -0.01 && fu < w.w + 0.01) return { ramp: FLOWERS, t: hashp(Math.floor(X), Math.floor(Z)) % 3 === 0 ? 2 : 4 };
      }
    }
  }
  if (d.band && d.band.some((bz) => z >= bz && z < bz + 1)) return { ramp: d.bandRamp || f.mat.ramp, d: 1.2 };
  return null;
}

const LIT = ['#7a4a1e', '#a4662a', '#c9862f', '#e8a83f', '#f5c35a', '#ffdc86', '#fff0c0'];
const FLOWERS = ['#5a2a2a', '#8a2f2f', '#c2403a', '#e05a4a', '#f08a6a', '#f6b48c', '#fbd6b6'];
