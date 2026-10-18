# Realmwright

A real-time multiplayer strategy game about land. Every tile of the map belongs to someone or to
nobody. You raise soldiers of five kinds, march them where you want them and they hold the land they
stand on; the towns you build grow on their own into procedurally generated pixel-art cities, with
villagers chopping wood, quarrying stone, farming and carrying goods. Rivals can be humans or AIs, and
they all play by the same rules. The first realm to hold 80% of the land wins; otherwise the one with the
most land when time runs out (30 minutes by default).

The map-wide race for land is inspired by [OpenFront](https://openfront.io), raising troops by dropping
them on the map by Clash of Clans. It shares no code, art or numbers with either.

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

- **Start.** Tap open land to choose where your realm begins. You get a patch of land around a hamlet
  and a small army at its gate.
- **People and gold.** The more land and the bigger your towns, the more people you can have, and
  people earn gold. Soldiers cost gold to raise and a little upkeep while they live; an empty treasury
  makes them desert.
- **Raise soldiers like dropping troops.** Pick a realm to march on (🎯 in the army bar, or tap their
  land), pick a kind of soldier, then tap where they should go. They are raised at your nearest town,
  port or outpost and march there. The bulk button (×5, ×10, ×25 … ×200) sets how many each tap sends, and holding
  your finger (or mouse button) down keeps sending. A besieged town cannot raise soldiers.
- **Soldiers hold the ground they stand on.** Standing soldiers claim the land around them: unclaimed
  land quickly, a rival's land only where none of their soldiers stand and no town or outpost guards
  it. Soldiers only fight where they stand until you send them on.
- **Kinds of soldiers** (gold each):

  | Soldier | Cost | Good at |
  | --- | --- | --- |
  | Shieldbearers | 10 | cheap and sturdy; stop horsemen |
  | Longbows | 14 | shoot from afar; beat shields |
  | Outriders | 22 | fast horsemen; claim land quickly, run down archers and siege engines |
  | Knights | 45 | strong all round, costly |
  | Trebuchets | 120 | slow; break garrisons and walls from afar |

  Forests and hills give cover. Soldiers walk round lakes and bays; only to reach other land, such as
  an island, do they take to boats.
- **Towns fall** when their garrison is gone and enemy soldiers reach the gate. Garrisons fire on
  attackers and refill slowly when no enemy is near. A realm that has lost every town, port and outpost
  has a minute to take one back.
- **Build** with gold:
  - *towns* bring more people and gold, grow by themselves, and can be raised to village, town and
    walled city (a bigger garrison each time);
  - *ports* send trade ships to other players' ports, and both sides earn gold;
  - *outposts* have a garrison and are a place to raise soldiers near the front.
- **Alliances.** Long-press (or right-click) a realm to ask for an alliance. Allies neither fight nor
  take each other's land and earn more from trade. An alliance lasts five minutes and can be renewed.
  Whoever breaks one is a traitor for a minute.
- **No fog of war.** Everyone sees the whole map.
- **Victory:** hold 80% of all land, be the last realm standing, or hold the most land when time runs
  out.
- **AI rivals** are builders, merchants or warlords. They play easy, normal or hard. They gather an
  army at a staging point before they march on a town, keep guards at home and send riders to claim
  open land.
- **Map sizes:** small (320×224), medium, large (576×400, the default) and huge (768×544, up to 24 AI
  rivals).

**Screen:** your land share, people (the bar under it shows how close you are to your limit), soldiers
and gold (with income after upkeep) at the top left. The clock, speed, leaderboard and menu are at the
top right. The army bar at the bottom holds the target realm, the bulk size, the three build buttons and
a card for each kind of soldier. Selected soldiers show just above it.

**Controls:**

- *Mouse:* left click selects soldiers, left drag draws a selection box (Shift adds), right click sends
  the selected soldiers (or opens a small menu), right or middle drag pans, the wheel zooms.
- *Touch:* drag pans, pinch zooms, tap selects soldiers or sends the selected ones, hold and drag
  selects several, hold for a small menu, double tap zooms in.
- *Keys:* 1–5 pick a soldier (0 none), Q/E bulk size, T target, F select every soldier, X halt, H home,
  B/P/O build town/port/outpost, WASD or arrows pan, +/- zoom, Space pause, `,`/`.` speed (single
  player), Esc menu.

## Development

```sh
npm test                  # unit, simulation, persistence and multiplayer tests (node --test)
npm run lint              # ESLint (fetched with npx; flat config in eslint.config.js)
npm run check             # both

npm run simulate -- 3 20 10 medium         # headless AI match: seed, minutes, AIs, size (small … huge)
npm run preview:world -- 7 medium out.png  # world overview PNG
npm run preview:settlement -- 1 0 40 3 out.png   # grow a settlement at a start site, write a PNG
node tools/play.mjs shots 7 small 60       # drive the real client in headless Chromium
node tools/save-check.mjs shots            # browser test: save, reload, continue
node tools/mp-browser.mjs shots            # two browsers in one multiplayer room
node tools/mobile-shots.mjs shots all       # every menu and HUD state: phone portrait, landscape, desktop
node tools/perf-zoom.mjs both              # frame times while zooming, pinching and panning (desktop and phone)
node tools/perf-mobile.mjs large 10 4      # a 10-minute large match on a phone profile, CPU slowed 4x
node tools/shoot.mjs "/client/debug/sprites.html?scale=3" out.png 1200 900   # screenshot any page
```

Debug pages (served by `npm start`):

- `/client/debug/terrain.html?seed=7&size=small`: generated worlds;
- `/client/debug/settlements.html`: settlement growth in every style;
- `/client/debug/sprites.html?scale=2&kinds=keep,house&levels=1,2,3&styles=stone,adobe`: building sprites;
- `/client/debug/nature.html`: tree and rock variants in every biome;
- `/client/debug/biomes.html`: ground tiles and palettes;
- `/client/debug/people.html`: soldiers (all kinds, walk and fight frames) and villagers at work.

The browser tools use Playwright with a preinstalled Chromium. They look for `playwright` in
`node_modules` first, then in the global install.

## Layout

```
engine/   shared, deterministic game logic (no DOM, no Node APIs); runs on the server, in the worker and in tests
  core/        RNG and hashing, noise, heap, grid search (A*, flood), RLE
  world/       world generation, biomes, start sites, names
  settlement/  road-first settlement planner, building kinds, styles, local terrain, validator
  sim/         Match (territory, people, ticks), units (squads, paths, combat, claiming), territory,
               towns and garrisons, trade ships, alliances, commands, saves
  ai/          AI players (the same commands as humans)
  net/         wire protocol: per-player snapshots and territory deltas (gold stays private)
server/   HTTP static server, WebSocket server (RFC 6455), rooms and lobby, save store
client/   browser client: transports, client world, Canvas renderer, compact HUD, debug pages
tests/    node:test suites
tools/    previews, headless simulation, browser drivers
docs/     asset audit and design notes
```

[docs/DESIGN.md](docs/DESIGN.md) describes how the systems work.
