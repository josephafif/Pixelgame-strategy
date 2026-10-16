// Game rules in one place. The match is a contest for land: every tile has
// an owner, people grow with the land you hold, and troops taken from your
// people push your borders outward. Towns, ports and outposts are the only
// things you build, and towns grow on their own as pixel-art settlements.

export const TICK = 0.1; // seconds of game time per simulation step

export const RULES = {
  spawnRadius: 5, // tiles claimed around a starting town
  spawnSpacing: 16, // minimum distance between starting towns
  startPop: 1500,
  baseMaxPop: 3000,
  popPerTile: 8,
  growth: 0.07, // logistic growth rate per second
  overflowDecay: 0.05, // share of the excess lost per second above the cap
  goldPerWorker: 0.004, // gold per worker per second
  goldPerTown: 1.5, // gold per town level per second
  troopShare: 0.6, // default share of people under arms
  rebalance: 0.05, // share of the gap to the slider closed per second
  attackRatio: 0.3, // default share of troops sent per attack
  minAttack: 10,
  neutralCost: 1.2, // troops per unclaimed tile (times terrain)
  defense: 2.4, // defender advantage per tile
  defLoss: 0.5, // share of the local garrison lost per tile taken
  retreatKeep: 0.75, // troops that come home from a called-off attack
  maxBoats: 3,
  boatSpeed: 12, // tiles per second
  tradeSpeed: 8,
  tradeEvery: [12, 22], // seconds between a port's trade ships
  tradeGold: 60,
  tradeGoldPerTile: 3,
  allyTradeBonus: 1.5,
  allianceTime: 300, // seconds an alliance lasts
  renewWindow: 60, // an alliance can be renewed in its last minute
  requestTime: 20, // seconds an alliance request stays open
  traitorTime: 60, // seconds of weakened defence after breaking an alliance
  traitorDefense: 0.5,
  outpostRadius: 9,
  outpostDefense: 2.5,
  structureSpacing: 6, // tiles between any two structures
  townSpacing: 12, // tiles between towns
  winShare: 0.8, // share of all land that wins the match
};

/** Speed of an attack in tiles per step. */
export function attackSpeed(troops, neutral) {
  if (neutral) return Math.max(2, Math.min(30, Math.round(2 + Math.sqrt(troops) / 5)));
  return Math.max(1, Math.min(14, Math.round(1 + Math.sqrt(troops) / 10)));
}

/** Town levels: each adds people and gold, and the town grows a stage. */
export const TOWN_LEVELS = [
  null,
  { name: 'Hamlet', stage: 1, pop: 6000, houses: 8 },
  { name: 'Village', stage: 2, pop: 12000, houses: 16, walls: 0 },
  { name: 'Town', stage: 3, pop: 20000, houses: 26, walls: 1 },
  { name: 'City', stage: 4, pop: 30000, houses: 40, walls: 2 },
];
export const MAX_TOWN_LEVEL = TOWN_LEVELS.length - 1;

/** What a town adds to its plan as it grows (besides houses). */
export const TOWN_PLAN = {
  1: ['farm', 'farm'],
  2: ['market', 'farm', 'lumber'],
  3: ['temple', 'granary', 'workshop', 'farm'],
  4: ['tavern', 'smithy', 'barracks', 'farm'],
};

export const STRUCTURES = {
  town: { name: 'Town', base: 1500, growth: 1.5, about: 'More people and gold. Grows into a city.' },
  port: { name: 'Port', base: 2000, growth: 1.6, about: 'Sends trade ships to other ports for gold.' },
  outpost: { name: 'Outpost', base: 1000, growth: 1.35, about: 'Land nearby is much harder to take.' },
};
export const STRUCTURE_KINDS = Object.keys(STRUCTURES);

/** Gold needed to raise a town from level `level` to the next. */
export function upgradeCost(level) {
  return Math.round(1200 * level * Math.pow(1.5, level - 1));
}

/** Cost of the next structure of a kind, given how many the player already built. */
export function structureCost(kind, built) {
  const d = STRUCTURES[kind];
  return Math.round(d.base * Math.pow(d.growth, built));
}
