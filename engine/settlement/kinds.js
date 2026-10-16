// Building kinds as the settlement planner sees them: footprint, which road
// classes they may face, how far from the centre they like to sit, and what
// terrain they want nearby. (Gameplay costs and jobs live in sim/defs.js.)

export const ROAD = Object.freeze({ NONE: 0, MAIN: 1, STREET: 2, PATH: 3 });

/**
 * front: frontage types allowed ('plaza', 'main', 'street', 'path')
 * ring: [min, ideal, max] distance from the plaza centre in tiles (max is soft)
 * near: terrain the building wants close by
 */
export const KINDS = {
  keep: { w: 5, h: 4, front: ['plaza'], ring: [0, 2, 6], civic: true, alt: [[4, 4], [4, 3], [3, 3]] },
  hall: { w: 3, h: 3, front: ['plaza', 'main'], ring: [0, 2, 7], civic: true, alt: [[3, 2]] },
  lodge: { w: 3, h: 2, front: ['plaza', 'main'], ring: [0, 2, 6], civic: true, alt: [[2, 2]] },
  house: { w: 2, h: 2, front: ['street', 'main', 'path'], ring: [2, 3, 30], house: true },
  farm: { w: 2, h: 2, front: ['street', 'main', 'path'], ring: [5, 10, 30], field: true, near: 'fertile' },
  lumber: { w: 3, h: 2, front: ['street', 'main', 'path'], ring: [3, 8, 30], near: 'forest' },
  quarry: { w: 3, h: 2, front: ['street', 'main', 'path'], ring: [3, 8, 30], near: 'rock', steep: true },
  mine: { w: 2, h: 2, front: ['street', 'main', 'path'], ring: [3, 9, 30], near: 'rock', steep: true },
  crystalmine: { w: 2, h: 2, front: ['street', 'main', 'path'], ring: [3, 9, 30], near: 'rock', steep: true },
  kiln: { w: 2, h: 2, front: ['street', 'main', 'path'], ring: [3, 7, 30], near: 'forest' },
  herbalist: { w: 2, h: 2, front: ['street', 'main', 'path'], ring: [3, 7, 30], near: 'green' },
  fishery: { w: 2, h: 2, front: ['street', 'main', 'path'], ring: [2, 6, 30], dock: true },
  harbor: { w: 3, h: 2, front: ['main', 'street'], ring: [2, 5, 30], dock: true },
  market: { w: 4, h: 3, front: ['plaza', 'main'], ring: [1, 3, 9], civic: true, alt: [[3, 3], [3, 2]] },
  granary: { w: 3, h: 3, front: ['main', 'street', 'plaza'], ring: [2, 5, 14] },
  workshop: { w: 3, h: 2, front: ['main', 'street'], ring: [3, 6, 16] },
  smithy: { w: 2, h: 2, front: ['main', 'street'], ring: [3, 6, 16] },
  barracks: { w: 4, h: 3, front: ['main', 'street'], ring: [4, 8, 18], gate: true },
  stables: { w: 4, h: 2, front: ['main', 'street'], ring: [5, 9, 20], gate: true },
  siegeworks: { w: 3, h: 3, front: ['main', 'street'], ring: [5, 9, 20], gate: true },
  temple: { w: 3, h: 4, front: ['plaza', 'main'], ring: [1, 4, 10], civic: true, alt: [[3, 3]] },
  tavern: { w: 3, h: 2, front: ['main', 'plaza', 'street'], ring: [2, 4, 12] },
  tower: { w: 1, h: 1, front: ['main', 'street', 'path'], ring: [5, 12, 30] },
  wonder: { w: 6, h: 5, front: ['plaza', 'main', 'street'], ring: [1, 5, 16], civic: true, alt: [[5, 5], [5, 4]] },
};

export const KIND_KEYS = Object.keys(KINDS);

/** Field sizes tried for farms, largest first. */
export const FIELD_SIZES = [[6, 4], [5, 4], [6, 3], [4, 4], [5, 3], [4, 3], [3, 3]];

/** Artery (main road) target length by settlement stage. */
export const ARTERY_RADIUS = [4, 6, 9, 12, 16];

/** Stage names. */
export const STAGES = ['Outpost', 'Hamlet', 'Village', 'Town', 'City'];
