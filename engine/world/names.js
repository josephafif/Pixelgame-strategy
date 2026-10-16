// Syllable-based place and kingdom names, deterministic per seed.

import { Rng } from '../core/rng.js';

const START = ['Ash', 'Bram', 'Cal', 'Dun', 'El', 'Fen', 'Gal', 'Hol', 'Ister', 'Kel', 'Lor', 'Mar', 'Nor', 'Oak', 'Pell', 'Quen', 'Ros', 'Sel', 'Tam', 'Ul', 'Ven', 'Wyn', 'Yar', 'Thorn', 'Brin', 'Cor', 'Hart', 'Mire', 'Stan', 'Wick'];
const MID = ['', '', '', 'a', 'e', 'i', 'o', 'ar', 'en', 'ol', 'ri', 'ver'];
const END = ['ford', 'by', 'wick', 'ton', 'mere', 'holm', 'dale', 'stead', 'barrow', 'march', 'haven', 'gate', 'field', 'crest', 'moor', 'brook', 'hollow', 'reach', 'watch', 'well'];

const BIOME_END = {
  forest: ['wood', 'glade', 'hollow', 'shaw'],
  taiga: ['pines', 'fell', 'holt'],
  marsh: ['fen', 'mire', 'carr'],
  desert: ['sand', 'oasis', 'dune'],
  hills: ['tor', 'down', 'ridge'],
  mountain: ['peak', 'crag', 'spire'],
  snow: ['frost', 'rime', 'cold'],
  ash: ['cinder', 'ember', 'soot'],
  beach: ['haven', 'port', 'strand', 'quay'],
};

const KINGDOMS = ['Aldmark', 'Brightvale', 'Corvane', 'Dunmere', 'Eskerholt', 'Falconreach', 'Greywater', 'Highmoor', 'Ironhold', 'Jadecrown', 'Kestrel', 'Lionsgate', 'Marrowdeep', 'Northwatch', 'Oakenshire', 'Pyrewood', 'Ravenmoor', 'Silverfen', 'Thornwall', 'Wyvernrest'];

export function placeName(seed, salt, biomeKey) {
  const rng = new Rng((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
  const ends = BIOME_END[biomeKey] && rng.chance(0.45) ? BIOME_END[biomeKey] : END;
  const name = rng.pick(START) + rng.pick(MID) + rng.pick(ends);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function kingdomNames(seed, count) {
  const rng = new Rng(seed ^ 0x51ed270b);
  return rng.shuffle(KINGDOMS.slice()).slice(0, count);
}
