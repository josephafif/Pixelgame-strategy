// Names for peoples, realms, towns, religions and leaders. Every people
// belongs to a culture with its own sound (invented syllables, not real
// languages); colonies and breakaway realms keep their culture's sound.

import { Rng } from '../core/rng.js';

export const CULTURES = [
  {
    key: 'north', climates: [2, 0],
    a: ['Skar', 'Hald', 'Vik', 'Ulf', 'Tor', 'Ar', 'Bjar', 'Grim', 'Sval', 'Ey', 'Rang', 'Hvit', 'Sig', 'Ask', 'Fro', 'Lyng'],
    m: ['', '', 'e', 'a', 'ing', 's'],
    z: ['heim', 'vik', 'stad', 'borg', 'fjord', 'dal', 'holm', 'by', 'sund', 'nes', 'lund', 'vall', 'havn', 'berg'],
    land: ['land', 'mark', 'rike'], adj: 'ish', people: 'ings',
  },
  {
    key: 'high', climates: [0, 2],
    a: ['Bal', 'Dun', 'Kil', 'Glen', 'Inver', 'Aber', 'Tal', 'Mor', 'Bryn', 'Car', 'Lan', 'Pen', 'Ros', 'Strath'],
    m: ['', '', 'a', 'e', 'en'],
    z: ['more', 'dale', 'loch', 'ach', 'wyn', 'ock', 'an', 'ith', 'ross', 'garth', 'nish', 'ard'],
    land: ['ia', 'mor', 'wen'], adj: 'ic', people: 'ae',
  },
  {
    key: 'latin', climates: [0, 1],
    a: ['Aur', 'Val', 'Cal', 'Ver', 'Lum', 'Sev', 'Tar', 'Ost', 'Nov', 'Aqu', 'Cor', 'Fel', 'Mag', 'Prae'],
    m: ['i', 'e', 'o', 'a', 'en', 'ul'],
    z: ['um', 'ia', 'ona', 'ium', 'entum', 'ara', 'ica', 'anum', 'ae', 'is', 'ula', 'ensis'],
    land: ['ia', 'ania', 'ium'], adj: 'an', people: 'ani',
  },
  {
    key: 'isle', climates: [1, 0, 3],
    a: ['Thal', 'Kor', 'Ery', 'Mel', 'Amph', 'Lyk', 'Pho', 'Kyth', 'Dor', 'Hal', 'Tyr', 'Ath', 'Kal', 'Nax'],
    m: ['a', 'o', 'i', 'e'],
    z: ['nos', 'polis', 'ra', 'thos', 'kos', 'ssa', 'ne', 'ion', 'eia', 'tis', 'mos', 'ros'],
    land: ['is', 'ia', 'os'], adj: 'ian', people: 'ites',
  },
  {
    key: 'sand', climates: [1],
    a: ['Kar', 'Ur', 'Bab', 'Tel', 'Ash', 'Mar', 'Qad', 'Sur', 'Nin', 'Har', 'Lag', 'Eri', 'Zim', 'Mas'],
    m: ['a', 'i', 'u', ''],
    z: ['dur', 'shan', 'esh', 'im', 'ar', 'ak', 'ash', 'un', 'ir', 'ad', 'ut', 'ib'],
    land: ['ad', 'ur', 'ar'], adj: 'ite', people: 'ites',
  },
  {
    key: 'steppe', climates: [1, 2],
    a: ['Kar', 'Ak', 'Tal', 'Bur', 'Kyz', 'Sar', 'Ut', 'Ord', 'Kul', 'Tash', 'Tem', 'Bal', 'Ayr', 'Yul'],
    m: ['a', 'u', 'i', 'y'],
    z: ['khan', 'tash', 'kent', 'bek', 'yr', 'gan', 'lyk', 'tau', 'ar', 'ul', 'sun', 'dag'],
    land: ['ai', 'yr', 'ul'], adj: 'ic', people: 'ar',
  },
  {
    key: 'forest', climates: [0, 3, 4],
    a: ['Ael', 'Cel', 'Ith', 'Lor', 'Mir', 'Sil', 'Thal', 'Ny', 'El', 'Fae', 'Wyn', 'Ilm'],
    m: ['a', 'e', 'i', 'ia', 'or', ''],
    z: ['ndor', 'las', 'wen', 'mar', 'thil', 'ion', 'eth', 'rin', 'dell', 'ae', 'lin', 'nost'],
    land: ['dor', 'ia', 'wen'], adj: 'ian', people: 'ari',
  },
  {
    key: 'wave', climates: [3, 4],
    a: ['Ka', 'Ma', 'Lu', 'Ta', 'Ho', 'Ke', 'Na', 'Pu', 'Ri', 'Wa', 'Mo', 'Ha'],
    m: ['la', 'ma', 'na', 'ki', 'ha', 'lu', '', ''],
    z: ['nui', 'loa', 'ua', 'ika', 'ea', 'ono', 'ari', 'ani', 'oa', 'iti'],
    land: ['nui', 'ua', 'oa'], adj: 'an', people: 'ani',
  },
  {
    key: 'stone', climates: [0, 2],
    a: ['Brand', 'Eis', 'Wolf', 'Hoh', 'Gold', 'Stein', 'Rot', 'Fels', 'Mark', 'Ried', 'Alt', 'Schwar'],
    m: ['', '', 'en', 'el'],
    z: ['berg', 'burg', 'stein', 'bach', 'feld', 'furt', 'tal', 'hausen', 'wald', 'dorf', 'au', 'eck'],
    land: ['ia', 'mark', 'land'], adj: 'ish', people: 'er',
  },
  {
    key: 'river', climates: [0, 2],
    a: ['Vel', 'Bor', 'Mir', 'Kras', 'Nov', 'Gor', 'Rad', 'Vys', 'Zlat', 'Bel', 'Dob', 'Jar'],
    m: ['o', 'a', 'e', ''],
    z: ['grad', 'ov', 'sk', 'ava', 'ice', 'in', 'ets', 'omir', 'yn', 'ograd', 'ec', 'ino'],
    land: ['ia', 'ovia', 'ava'], adj: 'ian', people: 'ane',
  },
];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Pick a culture for a people founded in a climate. */
export function cultureFor(climate, rng) {
  const fits = CULTURES.map((c, i) => [i, c.climates.includes(climate) ? (c.climates[0] === climate ? 3 : 1.5) : 0.25]);
  return rng.weighted(fits);
}

/** A town name in culture k. */
export function townName(k, rng) {
  const c = CULTURES[k];
  return cap(rng.pick(c.a) + rng.pick(c.m) + rng.pick(c.z));
}

/** A people: { root, land, adj, people }. */
export function peopleName(k, rng) {
  const c = CULTURES[k];
  const root = rng.pick(c.a) + (rng.chance(0.4) ? rng.pick(c.m) : '');
  const land = cap(root + rng.pick(c.land));
  const base = root.replace(/[aeiouy]+$/i, '');
  return { root: cap(root), land, adj: cap(base + c.adj), people: cap(base + c.people) };
}

/** A leader's name and the name of a religion's god. */
export function personName(k, rng) {
  const c = CULTURES[k];
  return cap(rng.pick(c.a) + rng.pick(c.m) + (rng.chance(0.5) ? rng.pick(['', 'r', 'n', 'd', 's']) : ''));
}

const FAITH = ['Faith of {g}', 'Way of {g}', 'Cult of {g}', 'Church of {g}', 'Light of {g}', '{a} Covenant', 'Path of the {n}', 'Order of {g}'];
const ABSTRACT = ['Seven Stars', 'Eternal Flame', 'Silent Sun', 'Twin Moons', 'Deep River', 'High Sky', 'Green Mother', 'Iron Word', 'Open Hand', 'White Mountain'];

export function religionName(k, rng, adj) {
  const t = rng.pick(FAITH);
  return t.replace('{g}', personName(k, rng)).replace('{a}', adj).replace('{n}', rng.pick(ABSTRACT));
}

/** Government titles by kind. */
export const GOV = [
  { key: 'tribe', name: 'Tribe' },
  { key: 'chiefdom', name: 'Chiefdom' },
  { key: 'kingdom', name: 'Kingdom' },
  { key: 'empire', name: 'Empire' },
  { key: 'republic', name: 'Republic' },
  { key: 'state', name: 'State' },
  { key: 'theocracy', name: 'Theocracy' },
];

/** The full name of a realm. */
export function realmName(civ) {
  const g = GOV[civ.gov].key;
  if (g === 'tribe') return `The ${civ.names.people}`;
  if (g === 'chiefdom') return `Chiefdom of ${civ.names.land}`;
  if (g === 'kingdom') return `Kingdom of ${civ.names.land}`;
  if (g === 'empire') return `${civ.names.adj} Empire`;
  if (g === 'republic') return `Republic of ${civ.names.land}`;
  if (g === 'theocracy') return `Holy ${civ.names.adj} State`;
  return civ.names.land;
}

/** A fresh RNG for naming, independent of the simulation stream. */
export function nameRng(seed, salt) {
  return new Rng((seed ^ Math.imul(salt + 7, 0x9e3779b1)) >>> 0);
}
