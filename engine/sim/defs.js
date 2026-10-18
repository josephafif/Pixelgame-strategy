// Game rules in one place. Every tile of land has an owner. Land comes from
// settlements: each town, port and outpost slowly takes the unclaimed land
// around it, more as a town grows. People grow with the land and the towns
// and earn gold; gold and people raise soldiers, as many as the realm's
// places can command, who march out from them, fight whoever is not an ally
// and take a rival's places (and with them their land). Towns grow on their
// own as pixel-art settlements.

export const TICK = 0.1; // seconds of game time per simulation step

export const RULES = {
  spawnRadius: 5, // tiles claimed around a starting town
  spawnSpacing: 18, // minimum distance between starting towns
  startPop: 300,
  startGold: 400,
  startArmy: [['shield', 8], ['bow', 4], ['rider', 3]],
  baseMaxPop: 300,
  popPerTile: 0.5,
  growth: 0.025, // logistic growth rate per second
  overflowDecay: 0.05, // share of the excess lost per second above the cap
  goldPerPerson: 0.008, // gold per person per second
  goldPerTown: 1, // gold per town level per second
  upkeep: 0.0015, // gold per second per gold of a soldier's price
  desertion: 0.01, // share of soldiers lost per second while the treasury is empty
  landEvery: 1, // seconds between a place's claims of the unclaimed land around it
  annexEvery: 10, // seconds between sweeps for enclosed pockets
  annexNeutral: 300, // largest unclaimed pocket a single realm annexes
  annexRival: 120, // largest rival pocket (without buildings) that is annexed
  aggro: 8, // tiles within which idle soldiers go for enemies by themselves
  leash: 12, // ... but no further than this from where they were posted
  embark: 6, // extra path cost to board or leave a boat
  sailSpeed: 2, // tiles per second on water, for every kind of soldier
  maxSquad: 200,
  maxSquads: 30, // separate squads a realm can lead
  baseCommand: 10, // soldiers a realm can command besides what its places add
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
 * speed in tiles per second on open ground.
 * vs: damage multipliers against other types ('works': towns and outposts).
 */
export const UNITS = {
  shield: { name: 'Shieldbearers', short: 'Shields', cost: 30, people: 1, hp: 10, atk: 1, range: 1.4, speed: 1.1, vs: { rider: 1.7, knight: 1.4, works: 1 }, about: 'Sturdy spears and shields. Hold ground and stop horsemen.' },
  bow: { name: 'Longbows', short: 'Bows', cost: 40, people: 1, hp: 6, atk: 0.9, range: 8, speed: 1.1, vs: { shield: 1.4, works: 0.6 }, about: 'Shoot from eight tiles away. Easy prey for riders.' },
  rider: { name: 'Outriders', short: 'Riders', cost: 60, people: 1, hp: 9, atk: 1.1, range: 1.4, speed: 2.4, vs: { bow: 1.8, trebuchet: 2, works: 0.6 }, about: 'Fast light horse. Run down archers and siege engines.' },
  knight: { name: 'Knights', short: 'Knights', cost: 120, people: 1, hp: 22, atk: 2.4, range: 1.4, speed: 1.7, vs: { bow: 1.6, shield: 1.2, trebuchet: 2, works: 1.2 }, about: 'Armoured horsemen. Expensive and hard-hitting.' },
  trebuchet: { name: 'Trebuchets', short: 'Trebuchets', cost: 320, people: 4, hp: 30, atk: 0.4, range: 12, speed: 0.6, vs: { works: 25 }, about: 'Siege engines. Smash garrisons from twelve tiles away.' },
};
export const UNIT_KEYS = Object.keys(UNITS);

/** Damage a squad's ground takes ×: rough country shelters defenders. */
export const COVER = { forest: 0.8, taiga: 0.8, hills: 0.75, mountain: 0.65, marsh: 1.1, river: 1.25, water: 1.3 };

/**
 * Town levels: each adds people and gold, a bigger garrison, more land
 * around the town (radius in tiles) and more soldiers it can command, and
 * the town grows a stage.
 */
export const TOWN_LEVELS = [
  null,
  { name: 'Hamlet', stage: 1, pop: 250, houses: 8, garrison: 25, land: 7, command: 30 },
  { name: 'Village', stage: 2, pop: 500, houses: 16, garrison: 45, walls: 0, land: 10, command: 50 },
  { name: 'Town', stage: 3, pop: 900, houses: 26, garrison: 70, walls: 1, land: 13, command: 80 },
  { name: 'City', stage: 4, pop: 1400, houses: 40, garrison: 100, walls: 2, land: 16, command: 120 },
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
  town: { name: 'Town', base: 600, growth: 1.2, about: 'Takes land around it, more as it grows. More people and gold. Grows into a city.' },
  port: { name: 'Port', base: 600, growth: 1.3, garrison: 20, land: 5, command: 10, about: 'Trade ships earn gold. Takes a little land on the coast.' },
  outpost: { name: 'Outpost', base: 350, growth: 1.15, garrison: 40, land: 7, command: 25, range: 7, about: 'A fort with archers in its towers. Takes the land around it.' },
};
export const STRUCTURE_KINDS = Object.keys(STRUCTURES);

/** Garrison size of a structure. */
export function garrisonMax(s) {
  return s.kind === 'town' ? TOWN_LEVELS[s.level].garrison + (s.capital ? 20 : 0) : STRUCTURES[s.kind].garrison;
}

/** How far around it a structure takes land (and holds it: taking the place takes this land). */
export function landRadius(s) {
  return s.kind === 'town' ? TOWN_LEVELS[s.level].land : STRUCTURES[s.kind].land;
}

/** Soldiers a structure lets its owner command. */
export function commandOf(s) {
  return s.kind === 'town' ? TOWN_LEVELS[s.level].command + (s.capital ? 20 : 0) : STRUCTURES[s.kind].command;
}

/** Gold needed to raise a town from level `level` to the next. */
export function upgradeCost(level) {
  return Math.round(500 * level * Math.pow(1.5, level - 1));
}

/** Cost of the next structure of a kind, given how many the player already built. */
export function structureCost(kind, built) {
  const d = STRUCTURES[kind];
  return Math.round(d.base * Math.pow(d.growth, built));
}
