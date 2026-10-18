// Realmwright's palettes. Colour families follow the visual reference
// (see docs/ASSET-AUDIT.md); every value here was chosen for this game.

import { B } from '../../engine/world/biomes.js';

/**
 * Ground palettes per biome.
 * base/base2: two tones mixed by low-frequency dithering (soft patches)
 * dark/light: single-pixel speckles; detail: biome-specific extras
 */
export const GROUND = {
  [B.DEEP]: { base: '#2f6079', base2: '#2d5b74', dark: '#29536c', light: '#386b84', wave: '#5a8fa2' },
  [B.SEA]: { base: '#3c7a90', base2: '#39748a', dark: '#336b82', light: '#4a899d', wave: '#74abb6' },
  [B.LAKE]: { base: '#428595', base2: '#3f7f8f', dark: '#397687', light: '#5195a2', wave: '#7ab3b8' },
  [B.RIVER]: { base: '#4b91a0', base2: '#478a9a', dark: '#40808f', light: '#5aa0ac', wave: '#86bec1' },
  [B.BEACH]: { base: '#e7cf9b', base2: '#e1c893', dark: '#d0b27e', light: '#f1dfb4', detail: ['#f6ecd6', '#bd9d6e'] },
  [B.GRASS]: { base: '#7b9f4f', base2: '#75984b', dark: '#668a45', light: '#88ab59', tuft: '#98b963', flowers: ['#f4d460', '#ee9fae', '#f6efdc', '#aebde8'] },
  [B.MEADOW]: { base: '#88a955', base2: '#82a251', dark: '#73934a', light: '#96b562', tuft: '#a7c36d', flowers: ['#f4d460', '#ee9fae', '#f6efdc', '#c7a8e6', '#f5b25e'] },
  [B.FOREST]: { base: '#5f8443', base2: '#5a7d40', dark: '#4e703a', light: '#6a8f4a', tuft: '#789b52', flowers: ['#efe5cb', '#d9654c'] },
  [B.TAIGA]: { base: '#5a7553', base2: '#556f4f', dark: '#496246', light: '#66825e', tuft: '#748f66', snow: '#eef0ea' },
  [B.MARSH]: { base: '#6b7650', base2: '#656f4b', dark: '#576142', light: '#78835a', tuft: '#879455', puddle: '#4f7f80', puddleLight: '#88b4a8' },
  [B.DESERT]: { base: '#e2c38a', base2: '#dbbb82', dark: '#caa56f', light: '#edd3a1', detail: ['#c8a26a', '#a88862'] },
  [B.HILLS]: { base: '#8d9f5d', base2: '#869858', dark: '#74864e', light: '#9caf6a', tuft: '#aabd73', rock: '#a59b90' },
  [B.MOUNTAIN]: { base: '#9b918a', base2: '#928882', dark: '#7d7370', light: '#b2a9a0', crack: '#675c5b', snow: '#f3f2eb' },
  [B.PEAK]: { base: '#eaebe4', base2: '#e1e3dd', dark: '#c4c4c2', light: '#fafaf4', crack: '#9c9493' },
  [B.SNOW]: { base: '#e8ebe5', base2: '#e0e4df', dark: '#cbd2d1', light: '#f9faf4', detail: ['#b0b8b9', '#ffffff'] },
  [B.ASH]: { base: '#4f4650', base2: '#49404a', dark: '#3c343e', light: '#5e5560', crack: '#2f272f', ember: ['#ff8a4a', '#ffc35e'] },
};

export const FOAM = '#eef1e3';
export const FOAM2 = '#bcdcd2';
export const WET_SAND = '#c9ab78';

/**
 * Water by depth, shallow (at the shore) to deep, per kind of water. The
 * painter dithers between neighbouring steps, so depth reads as a soft
 * gradient away from the coast.
 */
export const WATER_DEPTH = {
  sea: ['#6eaeae', '#5fa1a8', '#5194a1', '#468798', '#3d7a8e', '#356e84', '#30647b', '#2c5b72'],
  lake: ['#6cada4', '#5ea0a0', '#52949a', '#488993', '#407e8b', '#3a7483', '#356b7b', '#316374'],
  river: ['#6fb0ae', '#63a6a9', '#589ba4', '#4f909e', '#478698', '#417d92', '#3c758b', '#386e85'],
};

/** Rock tones (dark → light) with outline and moss, per kind of stone. */
export const ROCKS = {
  stone: { tones: ['#5d5451', '#776d68', '#91877f', '#aaa096', '#c5bcb0'], out: '#3a2a2d', lit: '#5d5451' },
  granite: { tones: ['#59545a', '#716b70', '#8a8485', '#a39e9c', '#c0bbb6'], out: '#31262e', lit: '#59545a' },
  sandstone: { tones: ['#8b6149', '#a77a58', '#bf9369', '#d4ab80', '#e7c79c'], out: '#4b2f27', lit: '#8b6149' },
  basalt: { tones: ['#27212a', '#342d37', '#433a46', '#544a57', '#675c6a'], out: '#160f17', lit: '#27212a' },
  moss: ['#556f37', '#6c8a41', '#87a24f'],
  snow: ['#bfc8cb', '#dde3e2', '#f6f7f1'],
  ember: ['#e2602f', '#ffb04c'],
};

/** Base hue/saturation/lightness of each tree species' foliage. */
export const FOLIAGE = {
  oak: [96, 0.4, 0.4],
  birch: [80, 0.42, 0.455],
  pine: [138, 0.27, 0.32],
  willow: [84, 0.38, 0.43],
  bush: [100, 0.37, 0.38],
  palm: [92, 0.42, 0.4],
  cactus: [100, 0.32, 0.42],
  reeds: [84, 0.3, 0.41],
};

/** Bark tones (dark → light). */
export const BARK = {
  oak: ['#3f2c22', '#5a3f2c', '#74543a', '#8c6a4a'],
  pine: ['#3a281f', '#53392a', '#6b4b35', '#835f43'],
  birch: ['#3b3034', '#a59d90', '#d6cfbf', '#f0ebdd'],
  palm: ['#5a3f29', '#7a5838', '#9a7449', '#b58d5c'],
  dead: ['#3a302f', '#56493f', '#716254', '#8d7d6c'],
  willow: ['#3f3123', '#5b4630', '#77603f', '#8f774f'],
};

/** Deep warm outline used around foliage and wood. */
export const NATURE_INK = '#2a1e1c';

/** Road surfaces. */
export const ROADS = {
  dirt: { base: '#bc9e6e', dark: '#a3865d', light: '#cdb486', edge: '#8c7252' },
  path: { base: '#c6ab7e', dark: '#b0966b', light: '#d6bf95', edge: '#9a8262' },
  cobble: { base: '#aca59b', dark: '#847b74', light: '#c8c1b5', edge: '#6e6460' },
  sand: { base: '#d9b980', dark: '#c1a06a', light: '#e8ce9a', edge: '#a9895a' },
  plank: { base: '#9e744a', dark: '#725032', light: '#b88d5c', edge: '#4f3422' },
};

/** Architecture palettes per settlement style. */
export const ARCH = {
  farm: { wall: '#ecdec0', wallDark: '#d0be98', frame: '#6c4a2c', roof: '#bb5a3e', roofDark: '#90402e', roofLight: '#d27354', thatch: '#d0aa56', thatchDark: '#a9853d', base: '#928a7f', door: '#6a4527', window: '#3f4858', trim: '#f7efdf' },
  timber: { wall: '#8c5b33', wallDark: '#6c4325', frame: '#4f311b', roof: '#5e7a3c', roofDark: '#46602c', roofLight: '#76924c', thatch: '#6f4a2d', thatchDark: '#553722', base: '#6d6a62', door: '#4e321c', window: '#2f3a33', trim: '#b58a5a' },
  stone: { wall: '#a39d97', wallDark: '#827b76', frame: '#625a58', roof: '#5a6176', roofDark: '#454a5d', roofLight: '#737a91', thatch: '#5a6176', thatchDark: '#454a5d', base: '#736c69', door: '#5a3d26', window: '#2e3040', trim: '#c9c2b8' },
  harbor: { wall: '#f2ebdc', wallDark: '#d8cebb', frame: '#7b6a55', roof: '#4a7f98', roofDark: '#37637a', roofLight: '#6198b0', thatch: '#4a7f98', thatchDark: '#37637a', base: '#9c9488', door: '#3f5f74', window: '#2f4a5c', trim: '#fffaf0' },
  stilt: { wall: '#9a7a4b', wallDark: '#7a5e37', frame: '#5b4326', roof: '#bea15c', roofDark: '#957d43', roofLight: '#d4bb76', thatch: '#bea15c', thatchDark: '#957d43', base: '#5b4326', door: '#4e3820', window: '#2f3326', trim: '#c9ad73' },
  adobe: { wall: '#dcb47e', wallDark: '#c09464', frame: '#a57c4f', roof: '#c79d66', roofDark: '#a8814f', roofLight: '#e2be88', thatch: '#c79d66', thatchDark: '#a8814f', base: '#b38d5e', door: '#6d4a2c', window: '#3c2e24', trim: '#f0d9ae', dome: '#e9d3a0', domeDark: '#c6ab74' },
  nordic: { wall: '#5f3f29', wallDark: '#47311f', frame: '#33231a', roof: '#4c3625', roofDark: '#37271a', roofLight: '#614631', thatch: '#4c3625', thatchDark: '#37271a', base: '#6e6966', door: '#33231a', window: '#efc86a', trim: '#8a6a4c', snow: '#f4f5ef', snowDark: '#d3dadb' },
  ash: { wall: '#433d48', wallDark: '#332e38', frame: '#27232c', roof: '#7b2f2b', roofDark: '#5b211f', roofLight: '#994038', thatch: '#7b2f2b', thatchDark: '#5b211f', base: '#2e2a33', door: '#2a2024', window: '#ffaf4a', trim: '#6b6370' },
  free: { wall: '#f0e4ca', wallDark: '#d5c4a4', frame: '#7a5a3a', roof: '#b8523f', roofDark: '#8e3e30', roofLight: '#d06f5a', thatch: '#4a8099', thatchDark: '#376279', base: '#9e968a', door: '#6a4527', window: '#38465a', trim: '#fffaf0', alt: ['#b8523f', '#4a8099', '#638c48', '#c78d3e'] },
};

/** Kingdom banner colours (distinct, readable on grass and water). */
export const KINGDOM_COLORS = ['#d23c3c', '#3a68d8', '#e6b422', '#8e44c4', '#20a68c', '#e0702a', '#e05a9a', '#6c7a2a', '#3cb4e6', '#a05a32', '#f0f0f0', '#404048'];

export const NEUTRAL_COLOR = '#c8b88a';

/** Crop colours for fields. */
export const CROPS = {
  wheat: { soil: '#6e4a2c', soilDark: '#5a3b22', plant: '#d9b54a', plantDark: '#b8932f', top: '#f0d27a' },
  barley: { soil: '#6a4a30', soilDark: '#563b25', plant: '#c8b46a', plantDark: '#a8944a', top: '#e2d08e' },
  corn: { soil: '#6e4a2c', soilDark: '#5a3b22', plant: '#5c9a3a', plantDark: '#3f7a2a', top: '#e8cc4a' },
  cabbage: { soil: '#6e4a2c', soilDark: '#5a3b22', plant: '#7cbf5a', plantDark: '#4f9a3c', top: '#a8dc84' },
  turnip: { soil: '#704c2e', soilDark: '#5a3b22', plant: '#6aa848', plantDark: '#4a8434', top: '#d48ac0' },
  rice: { soil: '#4f6f7a', soilDark: '#3e5a64', plant: '#7cc05a', plantDark: '#5a9a40', top: '#a8d884' },
  millet: { soil: '#8a6a44', soilDark: '#735634', plant: '#c9a24a', plantDark: '#a5822f', top: '#e8c870' },
  dates: { soil: '#9a7a4c', soilDark: '#82643c', plant: '#4f8a3a', plantDark: '#3a6a2a', top: '#8a5a2a' },
};
