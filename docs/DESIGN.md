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

The game is a race for land played with soldiers you can see: you raise squads of five kinds, march
them where you want, and they hold the land they stand on. The map-wide race is in the spirit of
OpenFront and raising troops by dropping them on the map in the spirit of Clash of Clans, without
copying the look, code or numbers of either. What is Realmwright's own are the towns, which grow as
generated pixel-art settlements with villagers at work.

## Territory (`match.js`, `territory.js`)

Every land tile has an owner (`Int16Array`, −1 for nobody). `setOwner` is the only way a tile changes
hands; it keeps tile counts and bounding boxes and appends the tile to a change log for the clients.

Starting: each player picks open land at least 18 tiles from other realms. They get the land within
6 tiles that can be walked to from there (never across water), a hamlet, 300 people, 250 gold and an
army at the gate (12 Shieldbearers, 6 Longbows, 6 Outriders). Players who do not choose in time, and
all AIs, get spread-out spots.

Land changes hands in four ways:

- **Soldiers claim it** (`units.claim`, every 0.5 s). A squad earns claim points (its kind's rate ×
  √(soldiers / 9), at most 6 banked) and spends them on the tiles within its radius, nearest first:
  1 point for an unclaimed tile, 3 for a rival's. A rival's tile is only taken when no rival soldiers
  stand within 5 tiles of the squad and no rival town, port or outpost guards it (towns guard
  5 + 2 × level tiles, ports 4, outposts 8). Squads in a fight claim nothing; allies never take each
  other's land.
- **Towns claim** a little unclaimed land around them every second (1 + level tiles within
  4 + 2 × level).
- **Annexing** (every 3 s): a connected area whose only land neighbour is one realm becomes theirs: an
  unclaimed one up to 4,000 tiles, a rival one up to 300 tiles with no building and no soldiers of its
  own.
- **Capture**: a town, port or outpost whose garrison is gone falls to the first soldiers at its gate,
  and the land it guarded comes with it.

Once a second, `survey()` scans the map: who borders whom and how long each border is (with one
sample tile per border, which the AI uses as a target), how much unclaimed land each realm touches,
coast lengths and exact bounding boxes. Every two seconds a two-pass chamfer distance transform finds,
for each realm, the point deepest inside its land; the client writes the realm's name there, sized by
that depth. The survey is part of the saved state, so a loaded game makes the same decisions.

## People and gold

- **Limit:** 300 + 0.5 per tile + 250 / 500 / 900 / 1,400 for each hamlet / village / town / city.
- **Growth** is logistic (4% per second at low numbers, slowing toward the limit). Above the limit
  people drift back down.
- **Gold:** 0.009 per person per second plus 1 per town level per second, plus trade.
- **Soldiers** cost gold and people (one each, four for a trebuchet's crew) when they are raised, and
  upkeep while they live: 0.18% of their price per second each. When the treasury runs dry, 1% of
  every squad deserts each second.

## Soldiers (`units.js`)

A squad is a group of soldiers of one kind: `{ owner, type, n, x, y, post, path, state }`.

| | Cost | HP | Attack/s | Range | Speed | Claims/s | Strong against |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shieldbearers | 10 | 10 | 1 | 1.4 | 1.1 | 3 | riders ×1.7, knights ×1.4 |
| Longbows | 14 | 6 | 0.9 | 5 | 1.1 | 2.4 | shields ×1.4 |
| Outriders | 22 | 9 | 1.1 | 1.4 | 2.4 | 7 | bows ×1.8, trebuchets ×2 |
| Knights | 45 | 22 | 2.4 | 1.4 | 1.7 | 3 | bows ×1.6, shields ×1.2, trebuchets ×2 |
| Trebuchets | 120 | 30 | 0.4 | 7 | 0.6 | – | garrisons ×25 |

Speeds are tiles per second on grass; forests, hills, marsh, snow and rivers are slower and peaks
impassable.

- **Raising** (`deploy`): the player names a kind, a number and a target tile. The soldiers are raised
  at the player's town, port or outpost nearest the target that is not under siege (a rival squad
  within 8 tiles in the last 8 s) and march there. A squad holds at most 200.
- **Paths** come from a weighted A* over the tiles (`findPath`), with the cost of each step from the
  biome and the kind's speed. Water can be crossed: soldiers sail at 2 tiles per second, and boarding or
  leaving a boat costs extra. The heuristic is inflated ×2 and the search capped at 120,000 nodes,
  which keeps it fast on the huge map at the price of slightly imperfect routes.
- **Orders** (`move`, `stop`): selected squads are sent to a point and spread around it in a spiral.
  At the end of a march a squad holds that spot as its post. Foot and horse close in on enemies within
  3 tiles but never stray more than 5 from their post; then they walk back.
- **Combat** happens every step: each squad hits the nearest hostile squad in range (damage =
  soldiers × attack × the counter multiplier × the target's cover, divided by the target's HP), or else
  a hostile town, port or outpost in reach. Damage is collected first and applied at the end of the
  step, so the order squads are processed in does not matter. Cover: forests and taiga ×0.8, hills
  ×0.75, mountains ×0.65, marsh ×1.1, rivers ×1.25, on the water ×1.3. A traitor takes more.
- **Garrisons** shoot back: an outpost's 0.45 per garrison soldier per second within 5 tiles, a
  town's 0.3 within 2 (3.5 for a walled town or city). Outposts and walled towns take ×0.6
  damage. A garrison refills at 0.35 soldiers per second when it has not been hit
  for 6 s and is not under siege.
- **Merging:** idle squads of one owner and kind within 2.5 tiles become one (checked every second),
  which keeps the number of squads down.

## Trade (`naval.js`)

Every port keeps one ship at sea. Every 12–22 s it sends one to a port of another player on the same
water, favouring allies and nearer ports. When it arrives both owners get 30 + 1.2 gold per tile of
route (×1.5 between allies). Routes are cached.

## Towns, ports and outposts (`structures.js`)

The only buildings. Each is a settlement layout from the planner.

| | Cost (grows with each one built) | Garrison | What it does |
| --- | --- | --- | --- |
| Town | 400 gold (×1.45) | 25 / 45 / 70 / 100 by level (+20 for the capital) | More people and gold; grows itself, can be raised |
| Port | 500 gold (×1.5) | 20 | Must stand on the coast; sends trade ships |
| Outpost | 250 gold (×1.35) | 40 | Archers in its towers; guards 8 tiles |

All three raise soldiers. Towns must be 12 tiles apart, and all structures 6 tiles apart. Raising a
town costs 300 × level × 1.5^(level−1) gold. A town goes from hamlet to village, town and city, which
is planner stages 1–4: palisade walls at town level and stone walls at city level. Houses and civic
buildings (fields, a lumber camp, a quarry, a market, a temple, a granary, a tavern…) go up on their
own, a few planner operations per step across all towns. A port is a harbour village; an outpost is a
walled post with towers and barracks.

A realm that loses its last town, port and outpost has a minute to take one back (as long as it has
soldiers); then it falls and its land returns to the wilds.

## Alliances (`diplomacy.js`)

A player asks; the other accepts or declines within 20 s (asking someone who already asked you seals
it). Allies neither fight nor take each other's land. An alliance lasts five minutes and can be renewed
in its last minute. Whoever breaks one is a traitor for a minute: their soldiers and garrisons take
more damage, and AIs favour them as targets.

## Victory

- holding 80% of all land;
- being the last realm standing;
- holding the most land when the time limit (30 minutes by default) runs out.

With soldiers on foot, land is won more slowly than in a pure territory game. Headless AI matches
(`npm run simulate`) usually reach the time limit with the leader holding 10–30% of the map, after
dozens of towns have changed hands.

## AI (`engine/ai/ai.js`)

Each AI thinks once a second, staggered across ticks, and issues ordinary commands (at most four
deploy or move orders per think, since each finds a path). Every squad it owns has a role:

1. **Diplomacy:** answer alliance requests (strong neighbours are welcome, warlords refuse prey,
   nobody allies with a traitor), ask much stronger neighbours, renew alliances worth keeping, and
   (warlords only) break one with a weak ally when nothing else is left to take.
2. **Defence:** when a rival column comes within reach of one of its places, it raises reinforcements
   there and pulls nearby squads in.
3. **Spending** (when not under threat): new towns placed deep inside its land, raising towns, ports
   on the coast, outposts facing the most dangerous neighbour.
4. **Claimers:** small rider squads roam the unclaimed land nearby.
5. **Guards:** shields and bows stand at the towns and outposts that face the most dangerous
   neighbour.
6. **Campaigns:** when its strength (squads plus garrisons) beats the nearest place of a rival by its
   temperament's margin, it picks that town or outpost, gathers a mixed army (with trebuchets) at a
   staging point eleven tiles out, assaults it, and moves on to the next target after a capture.

Temperaments: builders grow and fortify, merchants trade and ally, warlords keep a large army and look
for prey. The difficulty setting scales the edge an AI wants before marching, how much more it wants
before turning on a human (easy ×2.5, normal ×1.5, hard ×1.1), its army size, and how many AIs may
march on the same human at once (1, 2 or 3).

## Network protocol (`engine/net/protocol.js`)

The server sends each player:

- an `init` with the seed, size, total land and suggested start spots. The client regenerates the
  terrain locally from the seed instead of downloading it;
- the territory once (`terr`, run-length encoded); after that every `snap` carries only the tiles
  that changed since the last one (`td`). Changed tiles are grouped by new owner, sorted and
  gap-encoded. A player who falls too far behind the change log gets the full map again;
- a `snap` five times a second with every player's public data (land, people, army size), that
  player's gold, income and upkeep, towns, ports and outposts (with garrisons), every squad (position,
  kind, size, state; destinations only for the player's own), trade ships, alliances, their own
  requests, label spots and new events;
- `layout` messages when a settlement layout changes.

Clients send `{ t: 'cmd', cmd }`. Commands are validated by the same code path the AI uses.

`server/ws.js` is a small RFC 6455 implementation (no dependencies). `server/rooms.js` handles the
lobby, seats, reconnect tokens, spectators for late arrivals and per-client snapshot streaming with
backpressure.

## Saved games (`engine/sim/persist.js`, `server/saves.js`)

A save stores the following; the world is not stored but regenerated from its seed:

- the options and the full state (squads keep their paths, ships their routes);
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
- **Flat map** (below 2.5 pixels per tile): the one-pixel-per-tile terrain overview and the
  territory image, drawn from the visible rectangle only, with town, port and outpost markers.
- **Territory image** (`territory.js`): one pixel per tile, a translucent fill in the owner's colour
  and an opaque rim along borders (lighter for your own). Changed tiles and their neighbours are
  repainted in the ImageData, and only the touched rectangle is uploaded. Crisp border lines replace
  the rims from 8 pixels per tile.
- **Pixel view** (fading in from 2.5 pixels per tile, covering the map from 3.5): terrain chunks
  (32×32 tiles at 16 px) and settlement pictures, at three sizes. A pool of up to three workers
  (`paint-pool.js`, `paint-worker.js`) paints them into OffscreenCanvas and returns ImageBitmaps:
  - *quarter size* (4 px per tile) for every chunk and every settlement, painted for the whole map in
    the background whenever a worker is idle, nearest the view first, so even the most zoomed-out view
    shows every tree and town;
  - *half and full size* for the chunks near the view from 6 pixels per tile, requested before they
    are needed, nearest the centre first, plus a ring ahead, and dropped again when far away (phones
    keep fewer).

  New pictures fade in instead of popping, and a changed chunk keeps its old picture until the new one
  arrives.
- **Soldiers** (`people.js`): each squad is drawn as a small formation of up to nine soldiers in its
  owner's colours, walking, standing or fighting (animated, facing the way it moves), with a banner
  showing its size. Zoomed far out a squad becomes a single figure with its count. Positions are
  interpolated between snapshots. Selected squads get a ring and their destination a line and a flag.
- **Villagers** (`workers.js`): every town shows a few people at work, planned once per layout version
  from the layout itself: woodcutters at the nearest trees to the lumber camp, miners at the quarry's
  rocks, farmers in the fields, fishers on the piers, and porters (about a third) walking the streets
  between the market and the houses. More with each town level. Purely visual.
- **Labels:** each realm's name and army size at its deepest point, prerendered per text and size and
  gliding when the spot moves.
- **Nature** (`nature.js`, `ground.js`): every species has 16 shape variants (size, canopy
  silhouette, trunk height and lean, each also mirrored) and several colourings (hue and lightness
  jitter, autumn, blossom; rock kinds per biome, moss, snow), picked per tile from a hash, so no two
  neighbours look copied. Canopies and rocks are shaded from a small heightfield of spheres lit from
  the upper left, and each casts a soft shadow down-right. The ground has relief shading, water depth,
  shore foam and wet banks. The palette (`palette.js`, `color.js`) is warm and soft: shadows lean
  toward a plum ink, highlights toward cream.
- **Buildings, walls** (`buildings.js`, `decor.js`): every building kind in every style and level,
  walls, gates, piers, fields, boats and ships, with drop shadows.

`tools/perf-zoom.mjs` measures frame times over scripted eased zooms, a pinch and pans on a desktop
and a phone profile. `client/debug/` has pages for inspecting terrain, ground and palettes, trees and
rocks, settlement growth in every style, building sprites, and soldiers and villagers.

## Verification

- `npm test` runs these suites:
  - world generation (determinism, biome balance, rivers, sites);
  - settlements (validity after every operation, incremental growth, determinism, serialisation,
    performance);
  - simulation (starting, growth and limits, gold, raising and marching soldiers, claiming empty and
    rival land, counters, sieges and captures, alliances and betrayal, merging, upkeep and desertion,
    annexing, towns growing into cities, trade ships, both victories, AI matches, determinism,
    territory deltas);
  - persistence (a loaded match continues identically);
  - multiplayer over real WebSockets (shared match, private data, validation, deltas, reconnect,
    restart with restore).
- Browser tools in `tools/` drive the real client headlessly and take screenshots, which were inspected
  during development.
