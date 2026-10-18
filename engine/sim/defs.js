// Game rules in one place. Every tile of land has an owner. People grow
// with the land and the towns you hold and earn gold; gold and people raise
// soldiers, who march out from your towns and outposts, claim the land they
// stand on and fight whoever is not your ally. Towns grow on their own as
// pixel-art settlements.

export const TICK = 0.1; // seconds of game time per simulation step

export const RULES = {
  spawnRadius: 6, // tiles claimed around a starting town
  spawnSpacing: 18, // minimum distance between starting towns
  startPop: 300,
  startGold: 250,
  startArmy: [['shield', 12], ['bow', 6], ['rider', 6]],
  baseMaxPop: 300,
  popPerTile: 0.5,
  growth: 0.04, // logistic growth rate per second
  overflowDecay: 0.05, // share of the excess lost per second above the cap
  goldPerPerson: 0.009, // gold per person per second
  goldPerTown: 1, // gold per town level per second
  upkeep: 0.0018, // gold per second per gold of a soldier's price
  desertion: 0.01, // share of soldiers lost per second while the treasury is empty
  claimEvery: 0.5, // seconds between land claims by soldiers
  enemyClaimCost: 3, // claim points for a rival's tile (unclaimed land costs 1)
  contestRadius: 5, // rival soldiers this close stop their land from being claimed
  townClaimEvery: 1, // seconds between a town's claims of unclaimed land around it
  annexEvery: 3, // seconds between sweeps for enclosed pockets
  annexNeutral: 4000, // largest unclaimed pocket a single realm annexes
  annexRival: 300, // largest rival pocket (without buildings) that is annexed
  aggro: 3, // tiles within which idle foot and horse soldiers close in on enemies
  leash: 5, // ... but no further than this from where they were posted
  embark: 6, // extra path cost to board or leave a boat
  sailSpeed: 2, // tiles per second on water, for every kind of soldier
  maxSquad: 200,
  garrisonRegen: 0.35, // garrison soldiers per second when no enemy is near
  tradeSpeed: 8,
  tradeEvery: [12, 22], // seconds between a port's trade ships
  tradeGold: 30,
  tradeGoldPerTile: 1.2,
  allyTradeBonus: 1.5,
  allianceTime: 300, // seconds an alliance lasts
  renewWindow: 60, // an alliance can be renewed in its last minute
  requestTime: 20, // seconds an alliance request stays open
  traitorTime: 60, // seconds a traitor's garrisons and soldiers are weakened
  traitorDefense: 0.6, // damage taken ×1/this while a traitor
  structureSpacing: 6, // tiles between any two structures
  townSpacing: 12, // tiles between towns
  winShare: 0.8, // share of all land that wins the match
};

/**
 * Soldier types. cost: gold each (people: 1 each, crew for engines).
 * hp and atk per soldier (atk is damage per second), range in tiles,
 * speed in tiles per second on open ground, claim: land claimed per second
 * by a squad of 9, radius: how far around them they claim.
 * vs: damage multipliers against other types ('works': towns and outposts).
 */
export const UNITS = {
  shield: { name: 'Shieldbearers', short: 'Shields', cost: 10, people: 1, hp: 10, atk: 1, range: 1.4, speed: 1.1, claim: 3, radius: 3, vs: { rider: 1.7, knight: 1.4, works: 1 }, about: 'Sturdy spears and shields. Hold ground and stop horsemen.' },
  bow: { name: 'Longbows', short: 'Bows', cost: 14, people: 1, hp: 6, atk: 0.9, range: 5, speed: 1.1, claim: 2.4, radius: 3, vs: { shield: 1.4, works: 0.6 }, about: 'Shoot from five tiles away. Easy prey for riders.' },
  rider: { name: 'Outriders', short: 'Riders', cost: 22, people: 1, hp: 9, atk: 1.1, range: 1.4, speed: 2.4, claim: 7, radius: 4, vs: { bow: 1.8, trebuchet: 2, works: 0.6 }, about: 'Fast light horse. Claim land quickly and run down archers.' },
  knight: { name: 'Knights', short: 'Knights', cost: 45, people: 1, hp: 22, atk: 2.4, range: 1.4, speed: 1.7, claim: 3, radius: 3, vs: { bow: 1.6, shield: 1.2, trebuchet: 2, works: 1.2 }, about: 'Armoured horsemen. Expensive and hard-hitting.' },
  trebuchet: { name: 'Trebuchets', short: 'Trebuchets', cost: 120, people: 4, hp: 30, atk: 0.4, range: 7, speed: 0.6, claim: 0, radius: 0, vs: { works: 25 }, about: 'Siege engines. Smash garrisons from seven tiles away.' },
};
export const UNIT_KEYS = Object.keys(UNITS);

/** Damage a squad's ground takes ×: rough country shelters defenders. */
export const COVER = { forest: 0.8, taiga: 0.8, hills: 0.75, mountain: 0.65, marsh: 1.1, river: 1.25, water: 1.3 };

/** Town levels: each adds people and gold, a bigger garrison, and the town grows a stage. */
export const TOWN_LEVELS = [
  null,
  { name: 'Hamlet', stage: 1, pop: 250, houses: 8, garrison: 25 },
  { name: 'Village', stage: 2, pop: 500, houses: 16, garrison: 45, walls: 0 },
  { name: 'Town', stage: 3, pop: 900, houses: 26, garrison: 70, walls: 1 },
  { name: 'City', stage: 4, pop: 1400, houses: 40, garrison: 100, walls: 2 },
];
export const MAX_TOWN_LEVEL = TOWN_LEVELS.length - 1;

/** What a town adds to its plan as it grows (besides houses). */
export const TOWN_PLAN = {
  1: ['farm', 'lumber', 'farm'],
  2: ['market', 'quarry', 'farm'],
  3: ['temple', 'granary', 'workshop', 'farm', 'barracks'],
  4: ['tavern', 'smithy', 'stables', 'farm'],
};

export const STRUCTURES = {
  town: { name: 'Town', base: 400, growth: 1.45, guard: 1, about: 'More people and gold. Grows into a city. Soldiers march out from here.' },
  port: { name: 'Port', base: 500, growth: 1.5, garrison: 20, guard: 4, about: 'Trade ships earn gold. Soldiers can set sail from here.' },
  outpost: { name: 'Outpost', base: 250, growth: 1.35, garrison: 40, guard: 8, range: 5, about: 'A fort with archers in its towers. Soldiers march out from here.' },
};
export const STRUCTURE_KINDS = Object.keys(STRUCTURES);

/** Garrison size of a structure. */
export function garrisonMax(s) {
  return s.kind === 'town' ? TOWN_LEVELS[s.level].garrison + (s.capital ? 20 : 0) : STRUCTURES[s.kind].garrison;
}

/** Tiles around a structure that rival soldiers cannot claim while it stands. */
export function guardRadius(s) {
  return s.kind === 'town' ? 5 + 2 * s.level : STRUCTURES[s.kind].guard;
}

/** Gold needed to raise a town from level `level` to the next. */
export function upgradeCost(level) {
  return Math.round(300 * level * Math.pow(1.5, level - 1));
}

/** Cost of the next structure of a kind, given how many the player already built. */
export function structureCost(kind, built) {
  const d = STRUCTURES[kind];
  return Math.round(d.base * Math.pow(d.growth, built));
}
