// Realmwright's palettes. Colour families follow the visual reference
// (see docs/ASSET-AUDIT.md); every value here was chosen for this game.

import { B } from '../../engine/world/biomes.js';

/**
 * Ground palettes per biome.
 * base/base2: two tones mixed by low-frequency dithering (soft patches)
 * dark/light: single-pixel speckles; detail: biome-specific extras
 */
export const GROUND = {
  [B.DEEP]: { base: '#1d4c8c', base2: '#1b4683', dark: '#173d74', light: '#295c9e', wave: '#3a6fb0' },
  [B.SEA]: { base: '#2c6db5', base2: '#2967ad', dark: '#245c9d', light: '#3d7fc4', wave: '#5d9ad6' },
  [B.LAKE]: { base: '#3072ba', base2: '#2c6bb1', dark: '#2760a2', light: '#4385c9', wave: '#62a0da' },
  [B.RIVER]: { base: '#377cc4', base2: '#3375bb', dark: '#2d6aab', light: '#4a8ed2', wave: '#6eaae2' },
  [B.BEACH]: { base: '#e0c486', base2: '#d9bc7d', dark: '#c8a86b', light: '#eed8a2', detail: ['#f5eedf', '#b99a62'] },
  [B.GRASS]: { base: '#4c9842', base2: '#468e3d', dark: '#3c7c36', light: '#5aaa4c', tuft: '#69bd58', flowers: ['#ffd74e', '#ff8db6', '#fbf8ee', '#8db4ff'] },
  [B.MEADOW]: { base: '#58a447', base2: '#519a41', dark: '#43883a', light: '#68b653', tuft: '#7ac764', flowers: ['#ffd74e', '#ff8db6', '#fbf8ee', '#c79bff', '#ffb24e'] },
  [B.FOREST]: { base: '#3e7f38', base2: '#397533', dark: '#2e652e', light: '#4a8f41', tuft: '#579f4a', flowers: ['#e8e2c8', '#d24a3a'] },
  [B.TAIGA]: { base: '#3d6e4a', base2: '#386643', dark: '#2b5638', light: '#4a7e55', tuft: '#5a8e60', snow: '#e4ecf3' },
  [B.MARSH]: { base: '#4e6a45', base2: '#48633f', dark: '#3a5236', light: '#5d7a4f', tuft: '#6d8c4c', puddle: '#3c6c82', puddleLight: '#6b9fb6' },
  [B.DESERT]: { base: '#e2bf79', base2: '#dab570', dark: '#c89f5d', light: '#eed295', detail: ['#c7a15b', '#a98757'] },
  [B.HILLS]: { base: '#6c9853', base2: '#658e4d', dark: '#557b43', light: '#7daa61', tuft: '#8bba6c', rock: '#8e8f96' },
  [B.MOUNTAIN]: { base: '#8a8992', base2: '#7f7e88', dark: '#6a6974', light: '#a2a1aa', crack: '#5a5964', snow: '#eef3f8' },
  [B.PEAK]: { base: '#e8edf3', base2: '#dfe6ee', dark: '#b8c2ce', light: '#ffffff', crack: '#8a92a0' },
  [B.SNOW]: { base: '#e5ecf4', base2: '#dbe3ed', dark: '#c4d1df', light: '#fbfdff', detail: ['#a9b7c6', '#ffffff'] },
  [B.ASH]: { base: '#4a4452', base2: '#433d4b', dark: '#37323f', light: '#5a5463', crack: '#2b2731', ember: ['#ff7a3a', '#ffb44c'] },
};

export const FOAM = '#d5ebf7';
export const FOAM2 = '#a9d0ec';
export const WET_SAND = '#c2a46a';

/** Road surfaces. */
export const ROADS = {
  dirt: { base: '#b89b6a', dark: '#a0845a', light: '#cbb182', edge: '#8d7550' },
  path: { base: '#c2a87b', dark: '#ad9367', light: '#d3bc92', edge: '#9a8460' },
  cobble: { base: '#a8a59d', dark: '#7f7c76', light: '#c6c3bb', edge: '#6f6c66' },
  sand: { base: '#d6b77e', dark: '#bf9f68', light: '#e6cc98', edge: '#a88a58' },
  plank: { base: '#9b7448', dark: '#6f5030', light: '#b48b5a', edge: '#4d3520' },
};

/** Architecture palettes per settlement style. */
export const ARCH = {
  farm: { wall: '#e9ddc0', wallDark: '#cdbd98', frame: '#6c4a2c', roof: '#b9553c', roofDark: '#8f3d2c', roofLight: '#d06d50', thatch: '#cfa851', thatchDark: '#a8833a', base: '#8f8a80', door: '#6a4527', window: '#3b4a5c', trim: '#f6efe0' },
  timber: { wall: '#8c5b33', wallDark: '#6c4325', frame: '#4f311b', roof: '#5e7a3c', roofDark: '#46602c', roofLight: '#76924c', thatch: '#6f4a2d', thatchDark: '#553722', base: '#6d6a62', door: '#4e321c', window: '#2f3a33', trim: '#b58a5a' },
  stone: { wall: '#9d9ca4', wallDark: '#7d7c86', frame: '#5e5d66', roof: '#4f5b70', roofDark: '#3b4557', roofLight: '#66748b', thatch: '#4f5b70', thatchDark: '#3b4557', base: '#6e6d76', door: '#5a3d26', window: '#283040', trim: '#c4c3ca' },
  harbor: { wall: '#f1ece0', wallDark: '#d6cfbf', frame: '#7b6a55', roof: '#3d7ba3', roofDark: '#2c5d7e', roofLight: '#5596c0', thatch: '#3d7ba3', thatchDark: '#2c5d7e', base: '#9a958a', door: '#3f5f74', window: '#2a4a63', trim: '#ffffff' },
  stilt: { wall: '#9a7a4b', wallDark: '#7a5e37', frame: '#5b4326', roof: '#bea15c', roofDark: '#957d43', roofLight: '#d4bb76', thatch: '#bea15c', thatchDark: '#957d43', base: '#5b4326', door: '#4e3820', window: '#2f3326', trim: '#c9ad73' },
  adobe: { wall: '#dcb47e', wallDark: '#c09464', frame: '#a57c4f', roof: '#c79d66', roofDark: '#a8814f', roofLight: '#e2be88', thatch: '#c79d66', thatchDark: '#a8814f', base: '#b38d5e', door: '#6d4a2c', window: '#3c2e24', trim: '#f0d9ae', dome: '#e9d3a0', domeDark: '#c6ab74' },
  nordic: { wall: '#5d3e28', wallDark: '#46301f', frame: '#33231a', roof: '#4a3524', roofDark: '#36261a', roofLight: '#5e4430', thatch: '#4a3524', thatchDark: '#36261a', base: '#6a6a70', door: '#33231a', window: '#e9c56a', trim: '#8a6a4c', snow: '#f3f7fb', snowDark: '#cfdae6' },
  ash: { wall: '#433d48', wallDark: '#332e38', frame: '#27232c', roof: '#7b2f2b', roofDark: '#5b211f', roofLight: '#994038', thatch: '#7b2f2b', thatchDark: '#5b211f', base: '#2e2a33', door: '#2a2024', window: '#ffaf4a', trim: '#6b6370' },
  free: { wall: '#efe4cc', wallDark: '#d3c4a6', frame: '#7a5a3a', roof: '#b64c3e', roofDark: '#8c3a2f', roofLight: '#cf6a58', thatch: '#3f7f9e', thatchDark: '#2e6079', base: '#9e968a', door: '#6a4527', window: '#33465e', trim: '#ffffff', alt: ['#b64c3e', '#3f7f9e', '#5d8c46', '#c48a3a'] },
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
