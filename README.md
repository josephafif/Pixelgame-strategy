# Realmwright

A real-time multiplayer strategy game about land. Every tile of the map belongs to someone or to
nobody. Your people grow with the land you hold, your troops push your borders outward, and the towns
you build grow on their own into procedurally generated pixel-art cities. Rivals can be humans or AIs,
and they all play by the same rules. The first realm to hold 80% of the land wins, usually within
10–20 minutes.

The way it plays is inspired by [OpenFront](https://openfront.io). It shares no code, art or numbers
with it.

Realmwright is a new, independent project. It uses [Pixelgame](https://github.com/josephafif/Pixelgame)
only as a *visual* reference: pixel scale, palettes and the look of terrain and vegetation. It shares no
code, systems, maps or assets with Pixelgame. See [docs/ASSET-AUDIT.md](docs/ASSET-AUDIT.md).

## Running it

You need Node.js 20 or newer. The game has no dependencies, so there is nothing to install.

```sh
npm start                 # http://localhost:8080 serves the game; multiplayer is at ws://<host>:8080/ws
node server/index.js --port 9000 --host 127.0.0.1
node server/index.js --saves /var/lib/realmwright   # where running matches are saved (default ./saves)
node server/index.js --no-saves
```

Open <http://localhost:8080> in a browser.

- **Single player** (*New realm*): the authoritative simulation runs in a Web Worker in your browser. You
  can save from the menu (Esc or ☰), and the game autosaves every three minutes. *Continue saved realm*
  resumes it. *Download save file* and *Load save file…* move a realm between browsers.
- **Multiplayer**: one player creates a room and shares the five-letter code. Up to 8 humans can join,
  plus up to 24 AI rivals. The server runs the simulation and only accepts validated commands. Players who
  disconnect rejoin with the same code and get their realm back. The server saves running matches every
  minute and when it stops (Ctrl-C). After a restart, a room comes back when its first player rejoins.

## Playing

- **Start.** Tap open land to choose where your realm begins. You get a patch of land around a hamlet.
- **People and troops.** The more land and the bigger your towns, the more people you can have. The
  *Troops* slider sets how many of them are under arms; the rest work and earn gold.
- **Attack** by tapping land. Unclaimed land is cheap. A rival's land costs more, and more still in
  forests, hills and mountains or near an outpost. The *Attack* slider sets the share of your troops
  each attack sends. Your border pushes outward like a wave until the troops are spent, and what is
  left comes home. ✕ calls an attack off.
- **Boats.** A tap on a shore across the water sends a boat with troops (three at a time). They land
  and attack from the beach.
- **Build** with gold:
  - *towns* bring more people and gold, grow by themselves, and can be raised to village, town and
    walled city;
  - *ports* send trade ships to other players' ports, and both sides earn gold;
  - *outposts* make the land around them much harder to take.
- **Alliances.** Long-press (or right-click) a realm to ask for an alliance. Allies cannot attack each
  other and earn more from trade. An alliance lasts five minutes and can be renewed. Whoever breaks one
  is a traitor for a minute, and their land is easier to take.
- **No fog of war.** Everyone sees the whole map.
- **Victory:** hold 80% of all land, be the last realm standing, or hold the most land when time runs
  out.
- **AI rivals** are builders, merchants or warlords. They play easy, normal or hard. On easy and
  normal they want a bigger edge before they turn on a human, and only one or two of them attack the
  same human at a time.

**Screen:** your land share, people (the bar under it shows how close you are to your limit), troops
and gold at the top left. The clock, speed, leaderboard and menu are at the top right. Requests and
incoming attacks appear as small notices under the top bar. The bottom bar holds the two sliders and
the three build buttons. Your attacks under way show just above it.

**Controls:** drag to pan, wheel or pinch to zoom (it glides and settles on a sharp scale), click or tap
to attack, right-click or long-press for a small menu (alliances, boats, building on that spot,
growing a town). Double-tap zooms in. Keys: H home, B/P/O build town/port/outpost, Q/E attack share,
+/- zoom, WASD pan, Space pause, 1/2/3 speed (single player), Esc menu.

## Development

```sh
npm test                  # unit, simulation, persistence and multiplayer tests (node --test)
npm run lint              # ESLint (fetched with npx; flat config in eslint.config.js)
npm run check             # both

npm run simulate -- 3 20 10 medium         # headless AI match: seed, minutes, AIs, size
npm run preview:world -- 7 medium out.png  # world overview PNG
npm run preview:settlement -- 1 0 40 3 out.png   # grow a settlement at a start site, write a PNG
node tools/play.mjs shots 7 small 60       # drive the real client in headless Chromium
node tools/save-check.mjs shots            # browser test: save, reload, continue
node tools/mp-browser.mjs shots            # two browsers in one multiplayer room
node tools/mobile-shots.mjs shots all       # every menu and HUD state: phone portrait, landscape, desktop
node tools/perf-zoom.mjs both              # frame times while zooming, pinching and panning (desktop and phone)
node tools/shoot.mjs "/client/debug/sprites.html?scale=3" out.png 1200 900   # screenshot any page
```

Debug pages (served by `npm start`):

- `/client/debug/terrain.html?seed=7&size=small`: generated worlds;
- `/client/debug/settlements.html`: settlement growth in every style;
- `/client/debug/sprites.html?scale=2&kinds=keep,house&levels=1,2,3&styles=stone,adobe`: building sprites.

The browser tools use Playwright with a preinstalled Chromium. They look for `playwright` in
`node_modules` first, then in the global install.

## Layout

```
engine/   shared, deterministic game logic (no DOM, no Node APIs); runs on the server, in the worker and in tests
  core/        RNG and hashing, noise, heap, grid search (A*, flood), RLE
  world/       world generation, biomes, start sites, names
  settlement/  road-first settlement planner, building kinds, styles, local terrain, validator
  sim/         Match (territory, people, ticks), attacks, boats and trade, towns, alliances, commands, saves
  ai/          AI players (the same commands as humans)
  net/         wire protocol: per-player snapshots and territory deltas (gold stays private)
server/   HTTP static server, WebSocket server (RFC 6455), rooms and lobby, save store
client/   browser client: transports, client world, Canvas renderer, compact HUD, debug pages
tests/    node:test suites
tools/    previews, headless simulation, browser drivers
docs/     asset audit and design notes
```

[docs/DESIGN.md](docs/DESIGN.md) describes how the systems work.
