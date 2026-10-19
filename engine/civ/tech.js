// Ages and knowledge. A realm learns techs one at a time; each belongs to an
// age, and a realm enters an age once it knows most of that age's techs.
// What a tech does is read elsewhere by its key (has(civ, 'sailing')).

export const ERAS = [
  { key: 'stone', name: 'Stone Age', yield: 1.0, urban: 0.04, perHouse: 5, reach: 4 },
  { key: 'bronze', name: 'Bronze Age', yield: 1.55, urban: 0.06, perHouse: 7, reach: 5 },
  { key: 'iron', name: 'Iron Age', yield: 2.0, urban: 0.08, perHouse: 8, reach: 6 },
  { key: 'classical', name: 'Classical Age', yield: 2.5, urban: 0.11, perHouse: 10, reach: 7 },
  { key: 'medieval', name: 'Middle Ages', yield: 3.1, urban: 0.12, perHouse: 11, reach: 8 },
  { key: 'renaissance', name: 'Renaissance', yield: 3.9, urban: 0.16, perHouse: 14, reach: 9 },
  { key: 'industrial', name: 'Industrial Age', yield: 6.5, urban: 0.34, perHouse: 22, reach: 11 },
  { key: 'modern', name: 'Modern Age', yield: 11, urban: 0.6, perHouse: 34, reach: 13 },
];

/**
 * cost: research points; req: techs needed first. The first age's
 * agriculture is known to every people from the start.
 */
export const TECHS = [
  { key: 'agriculture', name: 'Agriculture', era: 0, cost: 0, req: [] },
  { key: 'pottery', name: 'Pottery', era: 0, cost: 60, req: [], text: 'Granaries soften famines.' },
  { key: 'husbandry', name: 'Animal Husbandry', era: 0, cost: 80, req: [], text: 'Herds feed more people.' },
  { key: 'mysticism', name: 'Mysticism', era: 0, cost: 90, req: [], text: 'Shrines, and the first faiths.' },

  { key: 'bronze', name: 'Bronze Working', era: 1, cost: 420, req: ['pottery'], text: 'Bronze arms: stronger armies.' },
  { key: 'writing', name: 'Writing', era: 1, cost: 480, req: ['pottery'], text: 'Records speed up learning.' },
  { key: 'masonry', name: 'Masonry', era: 1, cost: 400, req: [], text: 'Stone walls round towns.' },
  { key: 'wheel', name: 'The Wheel', era: 1, cost: 440, req: ['husbandry'], text: 'Carts: roads and trade.' },
  { key: 'sailing', name: 'Sailing', era: 1, cost: 460, req: ['pottery'], text: 'Fishing, harbours, crossing narrow seas.' },

  { key: 'iron', name: 'Iron Working', era: 2, cost: 1100, req: ['bronze'], text: 'Iron arms and ploughs.' },
  { key: 'mathematics', name: 'Mathematics', era: 2, cost: 1150, req: ['writing'], text: 'Siege engines, better building.' },
  { key: 'currency', name: 'Currency', era: 2, cost: 1050, req: ['writing', 'wheel'], text: 'Coins: more trade and wealth.' },
  { key: 'riding', name: 'Horseback Riding', era: 2, cost: 1000, req: ['wheel'], text: 'Cavalry: armies march faster.' },

  { key: 'philosophy', name: 'Philosophy', era: 3, cost: 2600, req: ['mathematics'], text: 'Schools: faster learning, steadier realms.' },
  { key: 'engineering', name: 'Engineering', era: 3, cost: 2700, req: ['mathematics', 'masonry'], text: 'Paved roads and aqueducts: bigger cities.' },
  { key: 'law', name: 'Law', era: 3, cost: 2500, req: ['writing'], text: 'Rule from afar: larger realms hold together.' },
  { key: 'monotheism', name: 'Monotheism', era: 3, cost: 2400, req: ['mysticism', 'philosophy'], text: 'Great faiths spread far.' },

  { key: 'feudalism', name: 'Feudalism', era: 4, cost: 5200, req: ['law'], text: 'Castles and vassals.' },
  { key: 'plough', name: 'Heavy Plough', era: 4, cost: 5000, req: ['iron'], text: 'More food from heavy soils.' },
  { key: 'navigation', name: 'Navigation', era: 4, cost: 5400, req: ['sailing', 'mathematics'], text: 'Ships cross open seas.' },
  { key: 'guilds', name: 'Guilds', era: 4, cost: 5100, req: ['currency'], text: 'Crafts and long trade routes.' },

  { key: 'printing', name: 'Printing Press', era: 5, cost: 10500, req: ['philosophy', 'guilds'], text: 'Books everywhere: learning booms.' },
  { key: 'banking', name: 'Banking', era: 5, cost: 10000, req: ['guilds'], text: 'Credit: wealth and trade.' },
  { key: 'gunpowder', name: 'Gunpowder', era: 5, cost: 10800, req: ['feudalism'], text: 'Cannon break old walls.' },
  { key: 'oceans', name: 'Ocean Voyages', era: 5, cost: 11000, req: ['navigation'], text: 'Fleets reach any shore.' },

  { key: 'steam', name: 'Steam Power', era: 6, cost: 20000, req: ['printing', 'banking'], text: 'Machines and factories.' },
  { key: 'railways', name: 'Railways', era: 6, cost: 21000, req: ['steam'], text: 'Trains: fast trade and marching.' },
  { key: 'medicine', name: 'Medicine', era: 6, cost: 19000, req: ['printing'], text: 'Fewer die of plague; people live longer.' },
  { key: 'rifles', name: 'Rifles', era: 6, cost: 20000, req: ['gunpowder'], text: 'Modern armies.' },

  { key: 'electricity', name: 'Electricity', era: 7, cost: 36000, req: ['steam'], text: 'Lit cities and new industry.' },
  { key: 'combustion', name: 'Combustion', era: 7, cost: 37000, req: ['railways'], text: 'Motor vehicles.' },
  { key: 'fertilizer', name: 'Fertilizer', era: 7, cost: 34000, req: ['medicine'], text: 'Harvests multiply.' },
  { key: 'radio', name: 'Radio', era: 7, cost: 38000, req: ['electricity'], text: 'News at once: realms hold together.' },
];

/** Research cost by age; each tech varies a little round it. */
export const COST = [300, 4500, 220000, 110000, 290000, 540000, 700000, 900000];
for (const t of TECHS) if (t.cost) t.cost = Math.round(COST[t.era] * (0.9 + (t.cost % 7) * 0.035));

export const TECH = Object.fromEntries(TECHS.map((t, i) => [t.key, { ...t, i }]));
export const BY_ERA = ERAS.map((_, e) => TECHS.filter((t) => t.era === e));

/** How many of an age's techs a realm must know to enter it. */
export function needed(era) {
  return Math.max(1, BY_ERA[era].length - 1);
}

export function has(civ, key) {
  return civ.techs.has(key);
}

/** The age a set of known techs puts a realm in. */
export function eraOf(techs) {
  let era = 0;
  for (let e = 1; e < ERAS.length; e++) {
    const n = BY_ERA[e].filter((t) => techs.has(t.key)).length;
    if (n >= needed(e)) era = e;
    else break;
  }
  return era;
}

/** Techs a realm can study next. */
export function available(techs) {
  return TECHS.filter((t) => !techs.has(t.key) && t.req.every((r) => techs.has(r)));
}
