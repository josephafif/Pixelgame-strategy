// Biomes, terrain features and deposits of the strategic world, with the
// gameplay properties that the economy, movement and settlement planner read.

export const B = Object.freeze({
  DEEP: 0, // deep ocean
  SEA: 1, // shallow coastal water
  LAKE: 2,
  RIVER: 3,
  BEACH: 4,
  GRASS: 5, // grassland
  MEADOW: 6, // fertile river plains
  FOREST: 7, // broadleaf forest
  TAIGA: 8, // pine forest
  MARSH: 9,
  DESERT: 10,
  HILLS: 11,
  MOUNTAIN: 12,
  PEAK: 13, // impassable snow-capped summits
  SNOW: 14, // tundra
  ASH: 15, // volcanic ash fields
});

export const BIOME_COUNT = 16;

/**
 * Per-biome properties.
 * move: movement cost multiplier (Infinity = impassable on foot)
 * fert: farm fertility, wood: timber yield, stone: quarry yield
 * build: 0 = not buildable, 1 = buildable, 2 = buildable with stilts only
 * style: preferred architecture when a settlement centres here
 */
export const BIOMES = [
  { id: B.DEEP, key: 'deep', name: 'Deep sea', water: true, move: Infinity, fert: 0, wood: 0, stone: 0, build: 0, color: '#1f4f8f' },
  { id: B.SEA, key: 'sea', name: 'Coastal sea', water: true, move: Infinity, fert: 0, wood: 0, stone: 0, build: 0, color: '#2f6fb8' },
  { id: B.LAKE, key: 'lake', name: 'Lake', water: true, move: Infinity, fert: 0, wood: 0, stone: 0, build: 0, color: '#3277bf' },
  { id: B.RIVER, key: 'river', name: 'River', water: true, move: 7, fert: 0, wood: 0, stone: 0, build: 0, color: '#3b80c8' },
  { id: B.BEACH, key: 'beach', name: 'Beach', move: 1.3, fert: 0.35, wood: 0, stone: 0.1, build: 1, color: '#dcc285', style: 'harbor' },
  { id: B.GRASS, key: 'grass', name: 'Grassland', move: 1, fert: 1.0, wood: 0.15, stone: 0.05, build: 1, color: '#55a046', style: 'farm' },
  { id: B.MEADOW, key: 'meadow', name: 'Fertile meadow', move: 1, fert: 1.35, wood: 0.1, stone: 0, build: 1, color: '#68b04e', style: 'farm' },
  { id: B.FOREST, key: 'forest', name: 'Forest', move: 1.8, fert: 0.6, wood: 1.0, stone: 0.05, build: 1, color: '#2f7a37', style: 'timber' },
  { id: B.TAIGA, key: 'taiga', name: 'Pine forest', move: 1.9, fert: 0.4, wood: 0.9, stone: 0.1, build: 1, color: '#2d6347', style: 'nordic' },
  { id: B.MARSH, key: 'marsh', name: 'Marsh', move: 2.6, fert: 0.5, wood: 0.25, stone: 0, build: 2, color: '#4e6b45', style: 'stilt' },
  { id: B.DESERT, key: 'desert', name: 'Desert', move: 1.6, fert: 0.2, wood: 0.02, stone: 0.35, build: 1, color: '#e2c27e', style: 'adobe' },
  { id: B.HILLS, key: 'hills', name: 'Hills', move: 2.0, fert: 0.55, wood: 0.25, stone: 0.8, build: 1, color: '#7d9a5e', style: 'stone' },
  { id: B.MOUNTAIN, key: 'mountain', name: 'Mountains', move: 4.0, fert: 0.1, wood: 0.1, stone: 1.0, build: 1, color: '#8a8790', style: 'stone' },
  { id: B.PEAK, key: 'peak', name: 'High peaks', move: Infinity, fert: 0, wood: 0, stone: 0, build: 0, color: '#e8eef5' },
  { id: B.SNOW, key: 'snow', name: 'Tundra', move: 2.2, fert: 0.2, wood: 0.15, stone: 0.2, build: 1, color: '#e6eef6', style: 'nordic', cold: true },
  { id: B.ASH, key: 'ash', name: 'Ash fields', move: 1.8, fert: 0.45, wood: 0.05, stone: 0.6, build: 1, color: '#4b4552', style: 'ash' },
];

export function isWater(b) {
  return b <= B.RIVER;
}

export function isOpenWater(b) {
  return b === B.DEEP || b === B.SEA || b === B.LAKE;
}

/** Objects standing on tiles (purely environmental; drawn by the client). */
export const F = Object.freeze({
  NONE: 0,
  OAK: 1,
  BIRCH: 2,
  PINE: 3,
  SNOWPINE: 4,
  PALM: 5,
  DEADTREE: 6,
  BUSH: 7,
  ROCK: 8,
  BOULDER: 9,
  CACTUS: 10,
  REEDS: 11,
  WILLOW: 12,
  CRAG: 13, // big mountain rock
  ASHROCK: 14,
});

export const TREE_FEATURES = new Set([F.OAK, F.BIRCH, F.PINE, F.SNOWPINE, F.PALM, F.DEADTREE, F.WILLOW]);

/** Discrete resource deposits found by exploration. */
export const D = Object.freeze({
  NONE: 0,
  IRON: 1,
  COAL: 2,
  CRYSTAL: 3,
  HERBS: 4,
  FISH: 5,
  STONE: 6, // rich quarry stone (marble)
});

export const DEPOSITS = [
  { id: D.NONE, key: 'none', name: '' },
  { id: D.IRON, key: 'iron', name: 'Iron vein', resource: 'iron' },
  { id: D.COAL, key: 'coal', name: 'Coal seam', resource: 'fuel' },
  { id: D.CRYSTAL, key: 'crystal', name: 'Crystal geode', resource: 'crystal' },
  { id: D.HERBS, key: 'herbs', name: 'Herb grove', resource: 'herbs' },
  { id: D.FISH, key: 'fish', name: 'Fish shoal', resource: 'food' },
  { id: D.STONE, key: 'stone', name: 'Marble outcrop', resource: 'stone' },
];
