# Realmwright design notes

This document explains how the game works and why it is built the way it is. Numbers are quoted from
`engine/sim/defs.js`. If they ever disagree with this text, the code wins.

## Principles

- **One authoritative simulation.** `engine/sim/match.js` owns the game state. It advances in fixed
  ticks of 0.1 s and changes state only through validated commands (`engine/sim/commands.js`). The
  same class runs on the multiplayer server, in the single-player Web Worker and in the tests. Clients
  never simulate; they render snapshots.
- **Deterministic.** Nothing in `engine/` calls `Math.random`. All randomness comes from seeded
  hashes (`hash3`, `sfc32`). The same seed, the same commands and the same tick count give the same
  match. Tests check this, and saved games depend on it.
- **AIs play by the human rules.** `engine/ai/ai.js` acts only through `m.exec(pid, command)`. There
  is no fog of war: everyone, human or AI, sees the same map.
- **Separated layers.** `engine/` has no DOM and no Node APIs. `server/` adds transport, rooms and save
  files. `client/` adds rendering and UI. Settlement layouts are gameplay data (they decide where
  buildings stand); the client turns them into pixel art.

The game is a race for land in the spirit of OpenFront, without copying its look, code or numbers:
territory grows tile by tile, people grow with territory, and troops push borders. What is
Realmwright's own are the towns, which grow as generated pixel-art settlements.

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

`sites.js` surveys a location (buildable land, water, coast) and `pickStartSites` proposes spread-out
starting spots with room for a town. Players may also start anywhere else on open land.

The match derives three static tables from the world (`Match.analyzeTerrain`): which tiles can be
owned (everything but open water; rivers are land that is slow to take), what a tile costs to take
(grass and meadow 1, forest 1.3, hills 1.5, rivers 1.8, mountains 2.2, peaks 3), and the water bodies
with their coasts, for ports and boats. Ponds smaller than 60 tiles carry no boats.

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
them through gates.

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

The same layout seed and the same sequence of operations always give the same layout.

## Territory (`match.js`)

Every land tile has an owner (`Int16Array`, −1 for nobody). `setOwner` is the only way a tile changes
hands; it keeps tile counts and bounding boxes, appends the tile to a change log for the clients, and
hands over a structure standing on it.

Starting: each player picks open land at least 16 tiles from other realms. They get the land within
5 tiles that can be walked to from there (never across water), a hamlet and 1,500 people. Players who
do not choose in time, and all AIs, get spread-out spots.

Once a second, `survey()` scans the map: who borders whom and how long each border is (with one
sample tile per border, which the AI uses as a target), how much unclaimed land each realm touches,
coast lengths and exact bounding boxes. Every two seconds a two-pass chamfer distance transform finds,
for each realm, the point deepest inside its land; the client writes the realm's name there, sized by
that depth. The survey is part of the saved state, so a loaded game makes the same decisions.

## People, troops and gold

- **Limit:** 3,000 + 8 per tile + 6,000 / 12,000 / 20,000 / 30,000 for each hamlet / village / town /
  city.
- **Growth** is logistic (7% per second at low numbers, slowing toward the limit). Above the limit
  people drift back down.
- **Troops and workers** are two pools. Growth goes to both by the troop slider (default 60% troops),
  and 5% of the gap to the slider is closed each second, so moving it takes effect over half a minute.
  Attacks take troops only.
- **Gold:** 0.004 per worker per second plus 1.5 per town level per second, plus trade.

## Attacks (`attack.js`)

An attack is `{ from, to, troops }` with its own frontier: a binary heap of target tiles next to the
attacker's land. It starts from every such tile along the shared border (or from a beach for troops
landing by boat). Each step it takes the cheapest tiles off the heap. A captured tile adds its
neighbours with a key equal to its own plus the neighbour's terrain cost (times a little noise), so the
border advances as a wave front, slower through rough country. A tap sets a focus point that makes
steps toward it a little cheaper, so the push leans that way.

- **Speed:** 2–30 tiles per step into unclaimed land and 1–14 against a realm, growing with the square
  root of the troops.
- **Unclaimed land** costs 1.2 troops per tile times terrain.
- **A rival's tile** costs 1 + density × terrain × defence × 2.4 × ratio, where:
  - density is the defender's troops per tile;
  - defence is ×2.5 within 9 tiles of one of the defender's outposts and ×0.5 while the defender is a
    traitor;
  - ratio = (defender troops / attack troops)^0.35, clamped to 0.4–2.5, so a big attack on a thin
    garrison pays less and the reverse.

  The defender loses half of the local density × terrain × defence per tile.
- An attack ends when its troops cannot pay for the next tile or it has no frontier left. What
  remains goes home. Calling one off (✕) brings 75% home.
- Two attacks between the same realms merge. Attacks in opposite directions first cancel troops.
- A realm left with no land has fallen.

## Boats and trade (`naval.js`)

**Troop boats.** A tap on a shore you do not border sends a boat (at most three at sea). The landing
beach is the nearest coastal tile to the tap. The route comes from an A* search over the water,
running from that beach back to the nearest of your own shores. Boats sail at 12 tiles per second. On
arrival the troops take the beach (paying its cost) and start an attack from there. Troops landing on
their own or an ally's land go home.

**Trade ships.** Every port keeps one ship at sea. Every 12–22 s it sends one to a port of another
player on the same water, favouring allies and nearer ports. When it arrives both owners get
60 + 3 gold per tile of route (×1.5 between allies). Routes are cached.

## Towns, ports and outposts (`structures.js`)

The only buildings. Each is a settlement layout from the planner, and whoever takes the tile it stands
on takes it.

| | Cost (grows with each one built) | What it does |
| --- | --- | --- |
| Town | 1,500 gold (×1.5) | More people and gold; grows itself, can be raised |
| Port | 2,000 gold (×1.6) | Must stand on the coast; sends trade ships |
| Outpost | 1,000 gold (×1.35) | Land within 9 tiles is 2.5× harder to take |

Towns must be 12 tiles apart, and all structures 6 tiles apart. Raising a town costs
1,200 × level × 1.5^(level−1) gold. A town goes from hamlet to village, town and city, which is
planner stages 1–4: palisade walls at town level and stone walls at city level. Houses and civic
buildings (fields, a market, a temple, a granary, a tavern…) go up on their own, a few planner
operations per step across all towns. A port is a harbour village; an outpost is a walled post with
towers.

## Alliances (`diplomacy.js`)

A player asks; the other accepts or declines within 20 s (asking someone who already asked you seals
it). Allies cannot attack each other; attacks between them are called off when they ally, and boats
landing on an ally's shore go home. An alliance lasts five minutes and can be renewed in its last
minute. Whoever breaks one is a traitor for a minute: their land is half as hard to take, and AIs
favour them as targets.

## Victory

- holding 80% of all land;
- being the last realm standing;
- holding the most land when the time limit (20 minutes by default) runs out.

Headless AI matches (`npm run simulate`) end by domination after 8–14 minutes on the medium and large
maps.

## AI (`engine/ai/ai.js`)

Each AI thinks once a second, staggered across ticks. It reads the survey and issues ordinary
commands.

1. Set its troop slider (builders 55%, merchants 45%, warlords 70%).
2. Answer alliance requests. Strong neighbours are welcome. Warlords refuse weak neighbours, which
   they see as prey. Nobody allies with a traitor or with the other big realm near the end.
3. Ask much stronger neighbours for an alliance, renew alliances worth keeping, and (warlords only)
   break one with a weak ally when nothing else is left to take.
4. Spend gold: a new town per ~650 tiles, placed deep inside its land; raise towns; ports on the
   coast; outposts facing the most dangerous neighbour.
5. Attack: unclaimed land first; then the neighbour against which it has the best troop ratio, when
   the ratio passes its temperament's threshold and its realm is full enough; with no land targets, it
   sends a boat to a shore across the water.

The difficulty setting scales the edge an AI wants before attacking, and how much more it wants
before attacking a human (easy ×3, normal ×1.6, hard ×1.1). It also caps how many AIs may attack the
same human at once (1, 2 or 3).

## Network protocol (`engine/net/protocol.js`)

The server sends each player:

- an `init` with the seed, size, total land and suggested start spots. The client regenerates the
  terrain locally from the seed instead of downloading it;
- the territory once (`terr`, run-length encoded); after that every `snap` carries only the tiles
  that changed since the last one (`td`). Changed tiles are grouped by new owner, sorted and
  gap-encoded. A player who falls too far behind the change log gets the full map again;
- a `snap` five times a second with every player's public data (land, people, troops), that player's
  gold and slider, towns, ports and outposts, boats, attacks, alliances, their own requests, label
  spots and new events;
- `layout` messages when a settlement layout changes.

Clients send `{ t: 'cmd', cmd }`. Commands are validated by the same code path the AI uses.

`server/ws.js` is a small RFC 6455 implementation (no dependencies). `server/rooms.js` handles the
lobby, seats, reconnect tokens, spectators for late arrivals and per-client snapshot streaming with
backpressure.

## Saved games (`engine/sim/persist.js`, `server/saves.js`)

A save stores the following; the world is not stored but regenerated from its seed:

- the options and the full state (attacks keep their frontier heaps, boats their routes);
- every layout;
- the territory and the structure mask;
- the RNG position and pending commands.

A fingerprint of the regenerated world must match the saved one. A loaded match continues exactly as
the original would have, and the tests check this. Saves from earlier versions of the game are
refused with a clear message.

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

- **Camera.** Zoom is continuous: pinches and trackpads follow the fingers, while wheel notches,
  double taps and keys ease in log space over about 0.2 s. When a gesture ends, the camera eases to
  the nearest "crisp" scale (whole pixels per tile, and whole multiples or halves of the 16-pixel art),
  so pixel art never rests at an uneven size. A flick keeps the map gliding.
- **Strategic view** (below 8 pixels per tile): the one-pixel-per-tile terrain overview and the
  territory image, both drawn from the visible rectangle only, with town, port and outpost markers.
- **Territory image** (`territory.js`): one pixel per tile, a translucent fill in the owner's colour
  and an opaque rim along borders (lighter for your own). Changed tiles and their neighbours are
  repainted in the ImageData, and only the touched rectangle is uploaded.
- **Pixel view** (from 8 pixels per tile, fading in up to 11): terrain chunks (32×32 tiles at 16 px)
  and settlement pictures. A pool of up to three workers (`paint-pool.js`, `paint-worker.js`) paints
  them into OffscreenCanvas and returns ImageBitmaps, plus a half-size copy of each chunk for the
  zoomed-out end. Chunks are requested from 6 pixels per tile on, before they are needed, nearest the
  centre first, plus a ring ahead. New chunks fade in over the overview instead of popping. Borders
  are crisp lines built per colour for the visible tiles only.
- **Labels:** each realm's name and troops at its deepest point, prerendered per text and size and
  gliding when the spot moves.
- **Nature, buildings, walls** (`nature.js`, `buildings.js`, `decor.js`): trees, rocks, every building
  kind in every style and level, walls, gates, piers, fields, boats and ships.

`tools/perf-zoom.mjs` measures frame times over scripted eased zooms, a pinch and pans on a desktop
and a phone profile. `client/debug/` has pages for inspecting terrain, settlement growth in every style
and sprite sheets.

## Verification

- `npm test` runs these suites:
  - world generation (determinism, biome balance, rivers, sites);
  - settlements (validity after every operation, incremental growth, determinism, serialisation,
    performance);
  - simulation (starting, growth and limits, gold, attacks on empty land and rivals, terrain, outposts,
    alliances and betrayal, boats, trade ships, towns growing into cities, both victories, AI matches,
    determinism, territory deltas);
  - persistence (a loaded match continues identically);
  - multiplayer over real WebSockets (shared match, private data, validation, deltas, reconnect,
    restart with restore).
- Browser tools in `tools/` drive the real client headlessly and take screenshots, which were inspected
  during development.
