# Visual asset audit: Pixelgame → Realmwright

Reference repository: <https://github.com/josephafif/Pixelgame>, inspected at commit
`f310fb8a607b9f93512f66869b6720fc486b9212` (2026-10-12). I used it **only as a visual
reference**. I copied no code, data, maps, systems or files into Realmwright.

## What the repository contains

| Kind | Files | Finding |
| --- | --- | --- |
| Raster/vector images | `icons/*.png`, `icons/icon.svg` | App icons and favicons for Pixelgame (a sword). They are branding, not environmental art. **Not used.** |
| Fonts | `fonts/pixelify-sans-*.woff2`, `fonts/OFL.txt` | Third-party font (Pixelify Sans, SIL OFL 1.1). Not Pixelgame's own work, and not environmental art. **Not copied.** Realmwright loads its fonts from Google Fonts instead (see below). |
| Environmental art | none as files | Every terrain tile, tree, rock, plant, water surface and structure in Pixelgame is **drawn at runtime by JavaScript** (`src/render/*.js`). There are no sprite sheets, tile sets or image files for the environment. |
| License | none | The repository has **no LICENSE file**, and the README states no license for code or art. `package.json` is marked `"private": true`. |

## Conclusion on reuse

- Pixelgame has **no environmental art asset files**. Its environment art *is* source code,
  and these instructions forbid reusing Pixelgame's source code. Even without that rule,
  the missing license means reuse is not clearly allowed.
- Therefore **I reused no Pixelgame asset**. Realmwright draws all of its art with its own
  procedural pixel-art painters (`client/render/`), written from scratch. They aim for a
  compatible look, not identical output.
- **Limitation:** The game evokes Pixelgame's look through matching pixel scale, palettes
  and drawing conventions. It contains none of Pixelgame's actual sprites. If the owner
  later adds a license that permits art reuse, that would need a new decision.

## What I took as visual reference (by looking at screenshots)

I ran the reference game locally and took screenshots of the plains, deep forest, snow and
taiga, desert, ash fields, coast, ocean and a village. I noted these visual traits:

- **Pixel scale:** 16×16 px ground tiles, drawn with integer upscaling and nearest-neighbour
  filtering. Realmwright uses the same 16 px tile grid.
- **Ground:** flat base colours broken up by single-pixel speckles in a darker and a lighter
  tone, small grass tufts, and scattered four-pixel flowers in pastel yellow, pink, white and
  blue on grassland.
- **Biome transitions:** ragged, pixel-noisy borders instead of straight tile edges.
- **Trees:** round, clustered deciduous canopies in three or four greens with a dark outline,
  a brown trunk and a soft elliptical shadow. Pines are layered dark-green triangles.
  Desert has cacti. Ash fields have dead trees.
- **Rocks:** rounded grey boulders with a dark outline, a highlight and a darker underside.
- **Water:** medium blue with lighter speckle and wave strokes, a pale foam line at the
  shore, and sandy beaches.
- **General palette families:** greens (`#3f7f38`–`#6cc15c`), sand (`#d4b56e`–`#f0d9a0`),
  snow and ice (`#d6e2ee`–`#ffffff`, `#b8e0f4`), volcanic ash (`#3a3540`–`#5c5562`, ember
  orange), water blues. I studied these as colour families and re-picked colours for
  Realmwright (`client/render/palette.js`). I did not copy any palette table.

## Things deliberately *not* taken

Gameplay, rules, progression, combat, weapons, inventory, world generation, maps and
layouts, architecture, game loop, AI, UI, menus, controls, game flow, multiplayer,
economy, villages and their layout logic. Realmwright's UI also has a different look: a
parchment and oak theme instead of Pixelgame's dark navy and gold panels.

## Fonts used by Realmwright

The fonts are loaded from Google Fonts at runtime, with a fallback to the system monospace font:

- **Jacquard 12** (headings) and **Pixelify Sans** (body). Both use the SIL Open Font License
  and come from their own authors via Google Fonts. Neither file is taken from the
  Pixelgame repository.
