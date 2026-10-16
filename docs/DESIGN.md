# Realmwright design notes

This document explains how the game works and why it is built the way it is. Numbers are quoted from
`engine/sim/defs.js`. If they ever disagree with this text, the code wins.

## Principles

- **One authoritative simulation.** `engine/sim/match.js` owns the game state. It advances in fixed
  ticks of 0.25 s and changes state only through validated commands (`engine/sim/commands.js`). The
  same class runs on the multiplayer server, in the single-player Web Worker and in the tests. Clients
  never simulate; they render snapshots.
- **Deterministic.** Nothing in `engine/` calls `Math.random`. All randomness comes from seeded
  hashes (`hash3`, `sfc32`). The same seed, the same commands and the same tick count give the same
  match. Tests check this, and saved games depend on it.
- **AIs play by the human rules.** `engine/ai/ai.js` acts only through `m.exec(kid, command)`. It pays
  the same costs, waits for the same construction and travel times and sees only what its kingdom has
  explored.
- **Separated layers.** `engine/` has no DOM and no Node APIs. `server/` adds transport, rooms and save
  files. `client/` adds rendering and UI. Settlement layouts are gameplay data, because they decide where
  buildings stand and where roads run. The client turns them into pixel art.

## World generation (`engine/world/`)

`generateWorld({ seed, width, height })` runs a fixed pipeline over typed arrays:

1. Continental elevation from layered gradient noise. Ridged noise adds mountain ranges, and a radial
   falloff keeps the map edges at sea.
2. The sea level is chosen so that a target fraction of tiles is land.
3. Drainage uses a priority flood, which fills pits and creates lakes. Flow accumulation then marks
   rivers wherever enough water collects.
4. Climate: temperature falls with latitude and altitude, and moisture comes from distance to water
   plus noise.
5. Biomes are picked from elevation, temperature and moisture: deep sea, sea, lake, river, beach,
   grass, meadow, forest, taiga, marsh, desert, hills, mountain, peak, snow and ash. Vegetation density
   is set per biome.
6. Deposits (iron, coal, crystal, herbs, fish shoals, quarry stone) are placed where geology and
   biome make sense.

`sites.js` surveys a location (buildable land, fertility, timber, stone, water, coast, deposits) and
derives strengths such as *farming*, *timber*, *highland*, *maritime*, *trade* and *rare*.
`pickTradeHubs` places the neutral free cities, spaced out and preferring coasts and rivers.
`pickStartSites` proposes varied capital sites. These keep their distance from free cities and from
each other, and every one of them has room for a capital (this is tested).

## Settlement generation (`engine/settlement/`)

Each settlement owns a local square grid of 49×49 tiles (radius 24) centred on its plaza. The planner
works **roads first**:

1. **Terrain analysis** (`terrain.js`): base class per cell (water, shore, flat, slope, rock, forest,
   marsh), 3×3-smoothed slope, tree cover, fertility and rock. The planner also marks cells already used
   by other settlements' structures as blocked.
2. **Destinations**: the flattest open plaza near the centre, then:
   - *arteries*: main roads toward the capital, roads and neighbours, ending in gates;
   - a harbour on the shore if there is one;
   - lots reserved for civic buildings (keep or hall, market, temple) close to the plaza.
3. **Roads** are routed with a terrain-aware A* whose state is cell × heading, so turns cost extra and
   streets come out straight-ish and organic rather than grid-like. Slope, water and forest add cost.
   Existing roads are cheap, so new streets join the network.
4. **Lots** are found along road frontage. A summed-area table finds candidate districts quickly.
   Candidates are scored by distance to the network, flatness, the kind's preferred ring around the
   plaza and its preferred terrain (fields on fertile land, lumber camps by the forest, quarries by rock).
5. **Buildings** get a footprint, a door facing the road and spacing rules. Houses fill streets first,
   and new side streets are cut when frontage runs out.
6. **Decoration**: gardens, fields, fences, wells, carts, market stalls, piers.
7. **Validation and repair** (`validate.js`) checks these invariants:
   - nothing overlaps;
   - every door faces a road connected to the plaza;
   - the network is one component;
   - no road dead-ends without a reason (gate, door, pier, plaza);
   - spacing and terrain rules hold.

   Repair prunes dead ends and reconnects what it can. The tests validate layouts after every operation.

**Growth is incremental.** `applyStage` widens the usable radius and adds arteries. `addBuilding`
grafts new districts onto the existing streets. Buildings and streets never move or disappear when a
settlement grows. Walls are traced around a dilated outline of the built-up core, and arteries breach
them through gates. Kingdom roads become streets only where they join the street network.

**Styles** (`styles.js`) come from the biome and change the layout as well as the art:

| Style | Layout |
| --- | --- |
| farmstead | open, many fields |
| timber | winding |
| highland stone | terraced, tolerates slope |
| harbour | dense along the shore |
| stilt | marsh-tolerant |
| adobe | dense, flat roofs |
| nordic | compact |
| basalt (ash) | — |
| free city | dense neutral hub |

The same layout seed and the same sequence of operations always give the same layout.

## Population, work and soldiers (`economy.js`, `military.js`)

- **Labour.** 80% of a settlement's people can work. Workplaces offer job slots by category: food,
  wood, stone, iron, fuel, herbs, crystal, industry and building. Workers fill high-priority categories
  first, and equal priorities share workers in proportion to their slots. A starving realm sends
  everyone to the fields. Idle hands forage a little food and gather a little deadwood.
- **Growth** needs housing and food security. Houses are built automatically while there is room in
  the layout and stage limit, wood and stone, and food that isn't running out. A starving town shrinks.
- **Stages**:

  | Stage | Needs |
  | --- | --- |
  | outpost → hamlet | 18 people, wood |
  | hamlet → village | 40 people, wood, stone |
  | village → town | 100 people, market and hall, goods |
  | town → city | 220 people, temple, road to the capital, stone, goods, iron, crystal |

  Each stage claims more land and allows more buildings and houses. A settlement that has run out of
  room may grow a stage at three quarters of the usual population.
- **Soldiers come from the workforce.**
  - Recruiting needs barracks (10 recruits training at once), arms (and iron, wood or food for some
    units) and training time: 20–40 s.
  - Every recruit leaves the workforce immediately.
  - Soldiers eat food and cost coin every second; unpaid soldiers lose morale and desert.
  - A militia levy takes up to 15% of the people in 6 s. It is weak, and production suffers.
  - Demobilising returns 70% of the arms, and the people go back to work after 12 s.

## Economy and production chains

| Building | Output | Needs |
| --- | --- | --- |
| Farm | food | fertile land |
| Fishery | food | coast, lake or river |
| Lumber camp | wood | forest |
| Quarry | stone | rock, hills |
| Iron mine | iron | iron vein |
| Coal pit | fuel | coal seam |
| Charcoal kiln | fuel | burns wood |
| Herbalist | herbs | green land |
| Crystal mine | crystal | crystal geode |
| Workshop | goods | wood + iron |
| Smithy | arms | iron + fuel + wood |

People consume:

- food, everywhere;
- fuel, in cold towns;
- herbs, from village size;
- goods, from town size.

Shortages lower prosperity, which lowers taxes and growth. Output scales with the settlement's site
survey (fertility, forest cover, deposits). Towns without a road to the capital lose 15–40% of what
they ship. Storage grows with stages and granaries, and food spoils slowly.

## Expansion (`expansion.js`)

- **Scouts** reveal the map. Fog of war is per kingdom.
- **Settlers** cost 60 wood, 50 food and 12 people from a settlement of at least 40. They walk
  to an explored, valid site within reach and found an outpost with 12 people, which starts small
  and grows like any town.
- **Roads** are surveyed with A*, paid in wood (and stone for bridges), and built tile by tile by the
  connected settlements' builders. Roads double movement speed and link towns to the capital for
  logistics.

## Trade (`trade.js`)

- **Market.** The free cities share one market with a stock per resource.
  `price = base × (equilibrium / stock)^0.75`, clamped to 0.3–4 × base. Selling raises the stock and
  lowers the price; stocks drift back toward equilibrium over time.
- **Orders.** Standing buy and sell orders (amount, price limit, stock level to keep) are carried out
  by caravans. A market supports two caravans and a harbour one. Caravans carry 40 units, take real
  travel time over roads or by sea between harbours, and pay a fare per tile. At war, enemy armies can
  seize them.
- **Agreements** are proposed between realms: give X every N seconds for Y, a number of times. They are
  delivered by caravan, and they stop at war or when a side cannot pay.

## War (`military.js`)

- **Diplomacy.** Kingdoms start at peace with closed borders: armies cannot enter. Declaring war opens
  borders and cancels agreements. War weariness grows over time and lowers prosperity.
- **Units:**

  | Unit | Role |
  | --- | --- |
  | infantry | solid all-round |
  | archers | strong defenders |
  | cavalry | strong on open ground, weak in rough terrain; needs stables |
  | siege engines | break walls; need siege works, crewed by 3 |
  | militia | levy |

- **Armies** move along A* paths (0.75 tiles/s off-road). They carry 150 s of supply and refill inside
  or near their own territory (6 tiles). Out of supply they starve and lose morale.
- **Battles** start when hostile armies meet. Damage depends on attack against defence:
  - defenders gain 1.25× on hills, 1.5× in mountains and 1.2× in forest;
  - attackers fight at 0.7× across an unbridged river.

  Broken armies retreat home.
- **Sieges.**
  - Walls have hit points and a defence multiplier: palisade 240 hp ×1.5, stone 700 hp ×2.0,
    fortress 1500 hp ×2.6.
  - Walls must be breached before the garrison can be attacked.
  - A besieged town stops growing and may levy militia.
  - A town is taken when its walls are down and its garrison is gone. Its unfinished projects are lost,
    and it loses about a quarter of its people. It suffers unrest (lower output, no new houses or projects) for a while,
    and the winner loots part of the loser's stores.
  - Losing the capital moves the court to the largest remaining town.
  - A kingdom with no towns falls.

## Victory

The match ends in one of four ways:

- **Conquest:** the last realm standing wins.
- **Domination:** two thirds of all kingdom towns and 60% of all people, held for 4 minutes. Every
  realm is warned when the clock starts.
- **Prosperity:** build the Grand Exchange in your capital city and hold it for 3 minutes.
- **Score:** the best score when the time limit runs out.

## AI (`engine/ai/ai.js`)

Each AI thinks every 2 s with a personality:

- **builder:** steady growth and expansion;
- **merchant:** trade, agreements and the Grand Exchange;
- **warlord:** early arms, forward settling and attacks.

It does the following:

- **Labour priorities.** It sets them from its stocks. Hunger and wood shortage use hysteresis, so
  workers don't flip-flop, and kilns idle when fuel is plentiful.
- **Development.** It ranks wanted buildings and stage-ups and saves for the most important. Producers
  of a resource it is saving for get to skip the savings.
- **Expansion.** It sends settlers to the best explored sites. Warlords favour sites toward their
  weakest neighbour.
- **Trade.** Surpluses go to market, shortages are bought, and merchants propose agreements.
- **War.** It declares war on weaker neighbours near its explored frontier. It attacks the weakest town
  in reach from its best-held town, relieves its own besieged towns, offers or accepts peace when
  losing or weary, and keeps its army within the upkeep it can afford.

Headless AI matches (`npm run simulate`) measure this behaviour: growth, trade, wars, sieges and
captures.

## Network protocol (`engine/net/protocol.js`)

The server sends each player:

- an `init` with the seed, size and suggested sites. The client regenerates the terrain locally from
  the seed instead of downloading it;
- a `snap` every 0.5 s with public kingdom data, that player's private stocks, visible settlements,
  armies and parties (fog of war), and new events tracked by sequence number;
- versioned bulk messages (`terr`, `roads`, `explored`, `layout`), run-length encoded and only when
  they change.

Clients send `{ t: 'cmd', cmd }`. Commands are rate-limited and validated by the same code path the AI
uses.

`server/ws.js` is a small RFC 6455 implementation (no dependencies). `server/rooms.js` handles the
lobby, seats, reconnect tokens, spectators for late arrivals and per-client snapshot streaming with
backpressure.

## Saved games (`engine/sim/persist.js`, `server/saves.js`)

A save stores the following; the world is not stored but regenerated from its seed:

- the options and the full state;
- every layout;
- the per-tile masks (territory, roads, structures, exploration);
- the RNG position, path cache and pending commands.

A fingerprint of the regenerated world must match the saved one. A loaded match continues exactly as
the original would have, and the tests check this.

- **Single player:** saves are kept in the browser's localStorage or as a downloadable file, and the
  game autosaves every 3 minutes.
- **Server:**
  - Running matches are written atomically to `saves/<CODE>.json` every minute and on shutdown, and
    finished matches are removed.
  - Rooms are restored lazily when a player rejoins with the code, and the match stays paused until
    then.
  - Saves untouched for a week are pruned.

## Rendering (`client/render/`)

All art is drawn procedurally at runtime into pixel buffers (`pix.js`) with nearest-neighbour scaling.
No image assets are used.

- **Terrain chunks** (32×32 tiles at 16 px per tile) are painted per pixel. They have ragged, noisy
  biome borders, smooth river channels, relief lighting interpolated per tile, shore foam, ground
  speckles, tufts and flowers. Chunks are cached and built a few per frame.
- **Nature** (`nature.js`): deciduous and pine trees, palms, dead trees, rocks, reeds, cacti and snowy
  variants, each with outlines and shadows.
- **Buildings** (`buildings.js`): every kind in every style and level. Examples are pitched, thatched,
  snowy and flat adobe roofs with parapets, and keeps that grow from a hall and donjon into curtain
  walls with towers. Walls, gates, palisades, piers, fields and decor come from `decor.js`.
  `settlement-layer.js` prerenders each settlement, y-sorted, and rebuilds it only when its layout
  version changes.
- **Overlays:** territory fill and borders, fog of war, armies, caravans and selections.
- **Zoomed out:** a one-pixel-per-tile strategic overview with labels, plus a minimap.

`client/debug/` has pages for inspecting terrain, settlement growth in every style and sprite sheets.

## Verification

- `npm test` runs these suites:
  - world generation (determinism, biome balance, rivers, sites);
  - settlements (validity after every operation, incremental growth, determinism, serialisation,
    performance);
  - simulation (labour, starvation, recruitment, upkeep, levies, expansion, roads, prices, caravans,
    agreements, borders, terrain combat, sieges and capture, AI growth, determinism, start sites,
    domination);
  - persistence;
  - multiplayer over real WebSockets (shared match, private data, validation, reconnect, restart
    with restore).
- Browser tools in `tools/` drive the real client headlessly and take screenshots, which were inspected
  during development.
