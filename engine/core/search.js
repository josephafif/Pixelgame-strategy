// Grid searches (A*, multi-source Dijkstra) over a W×H grid of cells indexed
// y*W + x. Buffers are allocated once per grid size and reused through a
// generation stamp, so repeated searches do not churn memory.

import { MinHeap } from './heap.js';

const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class GridSearch {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.g = new Float64Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
  }

  _next() {
    this.gen++;
    if (this.gen >= 0xfffffff0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    return this.gen;
  }

  /**
   * A* search. `cost(fromIdx, toIdx, diagonal)` returns the step cost or
   * Infinity when the step is not allowed. `goal` may be an index or a
   * predicate. `minStep` is the cheapest possible step cost, used for an
   * admissible heuristic toward `target` (an index) when one is given.
   * Returns the path as an array of indices (start..goal) or null.
   */
  astar({ start, goal, target = -1, cost, diag = false, minStep = 1, maxNodes = Infinity }) {
    const { w, h } = this;
    const gen = this._next();
    const g = this.g;
    const from = this.from;
    const stamp = this.stamp;
    const closed = this.closed;
    const isGoal = typeof goal === 'function' ? goal : (i) => i === goal;
    const tx = target >= 0 ? target % w : 0;
    const ty = target >= 0 ? (target / w) | 0 : 0;
    const heur = target >= 0
      ? (i) => {
        const dx = Math.abs((i % w) - tx);
        const dy = Math.abs(((i / w) | 0) - ty);
        return diag
          ? minStep * (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy))
          : minStep * (dx + dy);
      }
      : () => 0;
    const dirs = diag ? D8 : D4;
    const open = new MinHeap();
    g[start] = 0;
    from[start] = -1;
    stamp[start] = gen;
    open.push(start, heur(start));
    let expanded = 0;
    while (open.size > 0) {
      const cur = open.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (isGoal(cur)) return this._trace(cur);
      if (++expanded > maxNodes) return null;
      const cx = cur % w;
      const cy = (cur / w) | 0;
      const gc = g[cur];
      for (let d = 0; d < dirs.length; d++) {
        const nx = cx + dirs[d][0];
        const ny = cy + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni] === gen) continue;
        const isDiag = d >= 4;
        let c;
        if (isDiag) {
          // No corner cutting: both orthogonal neighbours must be passable.
          const a = cy * w + nx;
          const b = ny * w + cx;
          if (cost(cur, a, false) === Infinity || cost(cur, b, false) === Infinity) continue;
          c = cost(cur, ni, true);
        } else {
          c = cost(cur, ni, false);
        }
        if (c === Infinity) continue;
        const ng = gc + c;
        if (stamp[ni] !== gen || ng < g[ni]) {
          stamp[ni] = gen;
          g[ni] = ng;
          from[ni] = cur;
          open.push(ni, ng + heur(ni));
        }
      }
    }
    return null;
  }

  _trace(end) {
    const path = [];
    let c = end;
    while (c !== -1) {
      path.push(c);
      c = this.from[c];
    }
    path.reverse();
    return path;
  }

  /** Cost of the path found by the last search to `idx` (valid right after astar/flood). */
  costTo(idx) {
    return this.stamp[idx] === this.gen ? this.g[idx] : Infinity;
  }

  /**
   * Multi-source Dijkstra. sources: [{ idx, cost0 = 0, tag }]. Writes the
   * best cost into `outDist` and the winning source tag into `outTag` for
   * every cell reached within `maxCost` (cells not reached are untouched;
   * callers pre-fill). A source may carry its own `limit`.
   */
  flood({ sources, cost, maxCost = Infinity, diag = false, outDist, outTag }) {
    const { w, h } = this;
    const gen = this._next();
    const g = this.g;
    const stamp = this.stamp;
    const closed = this.closed;
    const tagOf = this.from;
    const limits = sources.map((s) => (s.limit ?? maxCost));
    const reached = [];
    const open = new MinHeap();
    sources.forEach((s, k) => {
      const c0 = s.cost0 ?? 0;
      if (stamp[s.idx] !== gen || c0 < g[s.idx]) {
        stamp[s.idx] = gen;
        g[s.idx] = c0;
        tagOf[s.idx] = k;
        open.push(s.idx, c0);
      }
    });
    const dirs = diag ? D8 : D4;
    while (open.size > 0) {
      const cur = open.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const k = tagOf[cur];
      if (outDist) outDist[cur] = g[cur];
      if (outTag) outTag[cur] = sources[k].tag;
      reached.push(cur);
      const cx = cur % w;
      const cy = (cur / w) | 0;
      for (let d = 0; d < dirs.length; d++) {
        const nx = cx + dirs[d][0];
        const ny = cy + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni] === gen) continue;
        const c = cost(cur, ni, d >= 4, sources[k].tag);
        if (c === Infinity) continue;
        const ng = g[cur] + c;
        if (ng > limits[k]) continue;
        if (stamp[ni] !== gen || ng < g[ni]) {
          stamp[ni] = gen;
          g[ni] = ng;
          tagOf[ni] = k;
          open.push(ni, ng);
        }
      }
    }
    return reached;
  }
}

export { D4, D8 };
