# Realmwright

A real-time multiplayer kingdom strategy game. Each settlement grows on its own as procedurally generated
pixel art. You found a capital, grow it from hamlet to city, expand with settlers and roads, trade at
neutral free cities and fight rival realms. The rivals can be humans or AIs, and they all play by the
same rules.

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
  plus AI rivals. The server runs the simulation and only accepts validated commands. Players who
  disconnect rejoin with the same code and get their kingdom back. The server saves running matches every
  minute and when it stops (Ctrl-C). After a restart, a room comes back when its first player rejoins.

## Playing

- **Placement.** Pick a start site. The suggestions show what each site is good for: fertile plains,
  forests, iron hills, coasts or river crossings.
- **Settlements build themselves.** Houses go up as people need them. Streets, districts, fields, docks
  and walls are laid out by the town planner. You order workplaces and stage upgrades:
  outpost → hamlet → village → town → city.
- **Workers and soldiers.** People are the workforce. Each soldier is a worker taken off the land.
  Soldiers need barracks and training time; infantry costs iron, archers wood. They eat food and draw gold. Militia levies are fast,
  but they are weak and hurt production. Demobilised soldiers return to work gradually.
- **A small economy.** Four resources (food, wood, stone, iron) plus gold, and eight buildings: farm,
  fishery, lumber camp, quarry, iron mine, market, barracks and the Grand Exchange.
- **No fog of war.** Everyone sees the whole map.
- **Expansion is slow and deliberate.** Settlers (wood, food and people) found outposts within reach.
  Roads are built tile by tile and connect towns. Unconnected towns lose part of what they ship.
- **Trade.** Markets send caravans to the free cities, and prices follow supply and demand. You can place
  standing buy and sell orders and make agreements with other realms. Distance and roads set the
  cost and time of transport.
- **War.** At peace, borders are closed to armies. War opens them. Terrain favours defenders (hills,
  mountains, forest), and rivers without bridges slow attackers. Armies starve outside their supply
  range. Walls must be battered down (siege engines help) before a town can fall. A captured town keeps
  its buildings but is unruly for a while.
- **Victory.** You can win in four ways:
  - by conquest;
  - by holding two thirds of all towns and 60% of all people for four minutes (everyone is warned);
  - by building the Grand Exchange in a city and holding it for three minutes;
  - by having the best score when time runs out.

**Controls:** drag or WASD to pan, wheel to zoom, click to select, right-click to march a selected army,
H to jump to your capital, Space to pause (single player), 1/2/3 to set speed, Esc to cancel or open the
menu.

**On phones and tablets** the layout changes:

- A bar at the bottom opens Town, Realm, Trade, Diplomacy and Chronicle. In landscape it becomes a rail
  on the left.
- One sheet is open at a time, so the map stays visible. Drag the sheet's handle up to expand it, or
  down to close it.
- Drag to pan, pinch or double-tap to zoom, tap to select, and long-press the map to march the selected
  army.
- Orders on the map (settlers, roads, marches) show the spot first and wait for you to confirm.

## Development

```sh
npm test                  # unit, simulation, persistence and multiplayer tests (node --test)
npm run lint              # ESLint (fetched with npx; flat config in eslint.config.js)
npm run check             # both

npm run simulate -- 3 30 4 medium          # headless AI match: seed, minutes, AIs, size
npm run preview:world -- 7 medium out.png  # world overview PNG
npm run preview:settlement -- 1 0 40 3 out.png   # grow a settlement at a start site, write a PNG
node tools/play.mjs shots 7 small 60       # drive the real client in headless Chromium
node tools/save-check.mjs shots            # browser test: save, reload, continue
node tools/mp-browser.mjs shots            # two browsers in one multiplayer room
node tools/mobile-shots.mjs shots all       # every menu and panel: phone portrait, landscape, desktop
node tools/perf-zoom.mjs both              # frame times while zooming and panning (desktop and phone)
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
  world/       world generation, biomes, start sites and free cities, names
  settlement/  road-first settlement planner, building kinds, styles, local terrain, validator
  sim/         Match (authoritative state and ticks), economy, expansion, trade, military, commands, saves
  ai/          AI kingdoms (the same commands as humans)
  net/         wire protocol: per-player snapshots (private stores stay private)
server/   HTTP static server, WebSocket server (RFC 6455), rooms and lobby, save store
client/   browser client: transports, client world, Canvas renderer, DOM UI, debug pages
tests/    node:test suites
tools/    previews, headless simulation, browser drivers
docs/     asset audit and design notes
```

[docs/DESIGN.md](docs/DESIGN.md) describes how the systems work.
