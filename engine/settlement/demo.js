// Reproducible growth scenarios for tests, previews and visual inspection.
// A scenario grows one settlement through its stages with a fixed sequence
// of operations, so the same seed always produces the same town.

import { createLayout, addBuilding, applyStage, buildWalls } from './planner.js';
import { validateLayout } from './validate.js';

export const DEMO_PLAN = ['farm', 'lumber', 'farm', 'market', 'quarry', 'granary', 'farm', 'smithy', 'workshop', 'temple', 'barracks', 'harbor', 'fishery', 'tavern', 'farm', 'herbalist', 'mine', 'kiln', 'stables', 'tower', 'farm', 'farm'];

/** Stage reached after placing n houses in the demo growth curve. */
export function demoStageFor(n) {
  return n < 6 ? 1 : n < 18 ? 2 : n < 40 ? 3 : 4;
}

export function growDemo(world, site, { houses = 40, stage = 3, walls = 0, kind = 'capital', plan = DEMO_PLAN, validate = false } = {}) {
  const L = createLayout(world, { cx: site.x, cy: site.y, seed: world.seed, kind });
  const todo = plan.slice();
  const failures = [];
  applyStage(world, L, kind === 'outpost' ? 0 : 1);
  for (let i = 0; i < houses; i++) {
    const want = Math.min(stage, demoStageFor(i));
    if (want > L.stage) applyStage(world, L, want);
    if (walls && L.stage >= 3 && !L.walls) buildWalls(world, L, walls);
    if (!addBuilding(world, L, 'house')) failures.push('house');
    if (i % 3 === 1 && todo.length) {
      const k = todo.shift();
      if (!addBuilding(world, L, k)) failures.push(k);
    }
  }
  if (stage > L.stage) applyStage(world, L, stage);
  if (walls && !L.walls && L.stage >= 2) buildWalls(world, L, walls);
  return { L, failures, check: validate ? validateLayout(world, L) : null };
}
