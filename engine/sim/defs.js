// Gameplay definitions: resources, buildings, settlement stages, units.
// Rates are per second of game time. All numbers live here so balance can be
// tuned in one place and the client can show the same figures to players.

export const TICK = 0.25; // seconds of game time per simulation tick

export const RESOURCES = {
  food: { name: 'Food', price: 2.2, eq: 900, color: '#d9b54a', perish: 0.0004 },
  wood: { name: 'Wood', price: 2.4, eq: 900, color: '#8f6a3e' },
  stone: { name: 'Stone', price: 3.2, eq: 700, color: '#9d9ca4' },
  iron: { name: 'Iron', price: 7.5, eq: 350, color: '#6c7a8a' },
  fuel: { name: 'Fuel', price: 4.0, eq: 450, color: '#3b3640' },
  herbs: { name: 'Herbs', price: 6.0, eq: 300, color: '#5fa64a' },
  crystal: { name: 'Crystal', price: 30, eq: 90, color: '#b45aff' },
  goods: { name: 'Goods', price: 14, eq: 260, color: '#c48a3a' },
  arms: { name: 'Arms', price: 18, eq: 160, color: '#a7a7af' },
};
export const RES_KEYS = Object.keys(RESOURCES);

/** Labour categories that the player prioritises. */
export const LABOR = ['food', 'wood', 'stone', 'iron', 'fuel', 'herbs', 'crystal', 'industry', 'build'];

/**
 * Buildings a player (or AI) can order. plan: settlement planner kind used
 * to place and draw it. jobs: worker slots. out/inp: per worker per second.
 * site: what the settlement's surroundings must offer (and what scales output).
 * stage: minimum settlement stage. once: at most one per settlement.
 */
export const BUILDINGS = {
  farm: { name: 'Farm', plan: 'farm', cost: { wood: 20 }, work: 22, jobs: 6, cat: 'food', out: { food: 0.075 }, site: 'fert', stage: 0, desc: 'Fields and a barn. Output depends on soil fertility.' },
  fishery: { name: 'Fishery', plan: 'fishery', cost: { wood: 25 }, work: 22, jobs: 4, cat: 'food', out: { food: 0.065 }, site: 'water', stage: 0, desc: 'Needs coast, lake or river. Fish shoals boost the catch.' },
  lumber: { name: 'Lumber camp', plan: 'lumber', cost: { wood: 10, stone: 5 }, work: 18, jobs: 6, cat: 'wood', out: { wood: 0.08 }, site: 'wood', stage: 0, desc: 'Fells nearby forest.' },
  quarry: { name: 'Quarry', plan: 'quarry', cost: { wood: 25 }, work: 24, jobs: 6, cat: 'stone', out: { stone: 0.045 }, site: 'stone', stage: 0, desc: 'Cuts stone from hills and mountains.' },
  mine: { name: 'Iron mine', plan: 'mine', cost: { wood: 30, stone: 10 }, work: 32, jobs: 6, cat: 'iron', out: { iron: 0.024 }, site: 'iron', stage: 1, desc: 'Requires an iron vein in the territory.' },
  coalpit: { name: 'Coal pit', plan: 'mine', cost: { wood: 25, stone: 10 }, work: 28, jobs: 5, cat: 'fuel', out: { fuel: 0.04 }, site: 'coal', stage: 1, desc: 'Requires a coal seam in the territory.' },
  kiln: { name: 'Charcoal kiln', plan: 'kiln', cost: { stone: 15 }, work: 18, jobs: 4, cat: 'fuel', inp: { wood: 0.06 }, out: { fuel: 0.035 }, stage: 0, desc: 'Burns wood into fuel anywhere.' },
  herbalist: { name: 'Herbalist', plan: 'herbalist', cost: { wood: 15 }, work: 16, jobs: 3, cat: 'herbs', out: { herbs: 0.03 }, site: 'green', stage: 1, desc: 'Gathers herbs in forest and marsh; herb groves boost it.' },
  crystalmine: { name: 'Crystal mine', plan: 'crystalmine', cost: { wood: 30, stone: 30, iron: 10 }, work: 45, jobs: 4, cat: 'crystal', out: { crystal: 0.009 }, site: 'crystal', stage: 2, desc: 'Requires a crystal geode in the territory.' },
  workshop: { name: 'Workshop', plan: 'workshop', cost: { wood: 30, stone: 20 }, work: 30, jobs: 6, cat: 'industry', inp: { wood: 0.025, iron: 0.008 }, out: { goods: 0.028 }, stage: 2, desc: 'Turns wood and iron into goods.' },
  smithy: { name: 'Smithy', plan: 'smithy', cost: { stone: 25, wood: 15 }, work: 26, jobs: 4, cat: 'industry', inp: { iron: 0.02, fuel: 0.014, wood: 0.008 }, out: { arms: 0.024 }, stage: 1, desc: 'Forges arms for soldiers from iron and fuel.' },
  market: { name: 'Market', plan: 'market', cost: { wood: 40, stone: 20 }, work: 40, jobs: 3, cat: 'industry', stage: 1, once: true, effect: { caravans: 2, prosperity: 0.06 }, desc: 'Enables trade: each market sends two caravans.' },
  granary: { name: 'Granary', plan: 'granary', cost: { wood: 40 }, work: 26, jobs: 2, cat: 'food', stage: 1, effect: { storage: 400, spoil: 0.5 }, desc: 'More storage; food spoils more slowly.' },
  harbor: { name: 'Harbour', plan: 'harbor', cost: { wood: 50, stone: 20 }, work: 40, jobs: 4, cat: 'industry', site: 'coast', stage: 1, once: true, effect: { caravans: 1, sea: 1 }, desc: 'Sea trade routes and fast links to other harbours.' },
  barracks: { name: 'Barracks', plan: 'barracks', cost: { wood: 40, stone: 30 }, work: 36, jobs: 0, stage: 1, effect: { recruit: 10 }, desc: 'Trains up to 10 recruits at a time.' },
  stables: { name: 'Stables', plan: 'stables', cost: { wood: 45 }, work: 30, jobs: 0, stage: 2, once: true, effect: { cavalry: 1 }, desc: 'Allows cavalry.' },
  siegeworks: { name: 'Siege works', plan: 'siegeworks', cost: { wood: 60, iron: 20 }, work: 45, jobs: 0, stage: 2, once: true, effect: { siege: 1 }, desc: 'Allows siege engines.' },
  temple: { name: 'Temple', plan: 'temple', cost: { stone: 60, wood: 20 }, work: 60, jobs: 0, stage: 2, once: true, effect: { prosperity: 0.12, unrest: 2 }, desc: 'Prosperity; unrest after conquest fades faster. Needed for cities.' },
  tavern: { name: 'Tavern', plan: 'tavern', cost: { wood: 30 }, work: 22, jobs: 0, stage: 2, once: true, effect: { prosperity: 0.06 }, desc: 'Prosperity and happier soldiers.' },
  hall: { name: 'Town hall', plan: 'hall', cost: { wood: 40, stone: 30 }, work: 40, jobs: 0, stage: 1, once: true, notCapital: true, effect: { admin: 1 }, desc: 'Administration: required for a town.' },
  tower: { name: 'Watchtower', plan: 'tower', cost: { wood: 20, stone: 10 }, work: 16, jobs: 0, stage: 0, effect: { vision: 4, defense: 0.1 }, desc: 'Vision and a little defence.' },
  wonder: { name: 'Grand Exchange', plan: 'wonder', cost: { goods: 250, crystal: 80, stone: 350, coin: 2500 }, work: 300, jobs: 0, stage: 4, once: true, capitalOnly: true, effect: { prosperity: 0.2 }, desc: 'A trade wonder. Hold it for 3 minutes to win by prosperity.' },
};

export const HOUSE = {
  cost: [{ wood: 12 }, { wood: 12 }, { wood: 12, stone: 2 }, { wood: 10, stone: 6 }, { wood: 10, stone: 8 }],
  work: 10,
  capacity: [0, 6, 9, 12], // by house level
};

export const STAGES = [
  { name: 'Outpost', radius: 7, baseHousing: 8, maxBuild: 4, maxHouses: 3 },
  { name: 'Hamlet', radius: 10, baseHousing: 10, maxBuild: 10, maxHouses: 9, up: { pop: 18, cost: { wood: 40 }, work: 30 } },
  { name: 'Village', radius: 13, baseHousing: 12, maxBuild: 13, maxHouses: 20, up: { pop: 40, cost: { wood: 70, stone: 20 }, work: 45 } },
  { name: 'Town', radius: 16, baseHousing: 16, maxBuild: 19, maxHouses: 38, up: { pop: 100, cost: { wood: 120, stone: 80, goods: 15 }, work: 70, needs: ['market', 'hall'] } },
  { name: 'City', radius: 20, baseHousing: 20, maxBuild: 28, maxHouses: 70, up: { pop: 220, cost: { stone: 200, goods: 50, iron: 20, crystal: 6 }, work: 110, needs: ['temple'], connected: true } },
];

export const WALLS = [
  null,
  { name: 'Palisade', cost: { wood: 80 }, work: 40, hp: 240, def: 1.5 },
  { name: 'Stone walls', cost: { stone: 200, wood: 20 }, work: 90, hp: 700, def: 2.0, stage: 3 },
  { name: 'Fortress', cost: { stone: 380, iron: 50, crystal: 15 }, work: 140, hp: 1500, def: 2.6, stage: 4 },
];

/** Military units. atk/def per soldier; wall: wall damage per second. */
export const UNITS = {
  militia: { name: 'Militia', atk: 0.45, def: 0.65, wall: 0.06, speed: 1, train: 6, cost: {}, food: 0.025, coin: 0.005, levy: true },
  inf: { name: 'Infantry', atk: 1.0, def: 1.25, wall: 0.12, speed: 1, train: 20, cost: { arms: 1 }, food: 0.03, coin: 0.02 },
  arch: { name: 'Archers', atk: 0.9, def: 1.1, wall: 0.08, speed: 1, train: 22, cost: { arms: 1, wood: 2 }, food: 0.03, coin: 0.02, defendBonus: 0.4 },
  cav: { name: 'Cavalry', atk: 1.75, def: 0.95, wall: 0.08, speed: 1.6, train: 30, cost: { arms: 2, iron: 1, food: 10 }, food: 0.06, coin: 0.04, needs: 'cavalry' },
  siege: { name: 'Siege engine', atk: 0.3, def: 0.2, wall: 6, speed: 0.6, train: 40, cost: { wood: 40, iron: 10 }, crew: 3, food: 0.03, coin: 0.05, needs: 'siege' },
};
export const UNIT_KEYS = Object.keys(UNITS);

export const RULES = {
  laborShare: 0.8, // share of population able to work
  foodPerPop: 0.02,
  fuelPerPopCold: 0.0015,
  coldLoss: 0.0015, // population share lost per second in a cold town without fuel
  herbsPerPop: 0.0015, // village and larger
  goodsPerPop: 0.0025, // town and larger
  growth: 0.0075,
  starve: 0.004,
  forage: 0.02, // food per idle worker per second (kitchen gardens)
  gatherWood: 0.01, // wood per idle worker per second (deadwood), times the site's forest
  taxPerPop: 0.006,
  baseStorage: 500,
  builderRate: 0.18, // work units per builder per second
  minBuilders: 2,
  settlerCost: { wood: 60, food: 50 },
  settlerPop: 12,
  settlerMinPop: 40,
  minSettlementGap: 9,
  maxFoundDistance: 70,
  scoutCost: { food: 10, coin: 15 },
  roadCostPerTile: { wood: 1 },
  bridgeCostPerTile: { wood: 6, stone: 4 },
  roadRate: 0.5, // tiles per second
  caravanCargo: 40,
  caravanCostPerTile: 0.05, // coin per tile, each way
  marketFee: 0.1,
  armySpeed: 0.75, // tiles per second on open ground
  roadSpeed: 2.0,
  supplyRange: 6,
  supplyCap: 150, // seconds of food carried
  engageRange: 1.4,
  siegeRange: 2.5,
  levyMax: 0.15,
  unrestCapture: 90,
  wonderHold: 180,
  // Domination: this share of all kingdom towns and of all people, held this long.
  dominationTowns: 0.66,
  dominationPop: 0.6,
  dominationHold: 240,
  demobilizeTime: 12,
};

/** People needed for the next stage; a settlement out of room may grow at three quarters. */
export function stagePopNeed(s) {
  const up = STAGES[s.stage + 1]?.up;
  if (!up) return Infinity;
  return s.full ? Math.ceil(Math.min(up.pop, Math.max(up.pop * 0.75, s.housing - 2))) : up.pop;
}

export function costText(cost) {
  return Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(', ');
}
