# PalMap — technical notes

How it works, and the traps worth knowing if you change it. For using PalMap, see
[README.md](../README.md).

## Reading the save

Palworld v0.6+ saves use the `PlM` container: a small header wrapping an **Oodle Kraken**
compressed [GVAS](https://github.com/cheahjs/palworld-save-tools) blob. This is why
`palworld-save-tools` and most save editors fail on current saves — they only handle the older
zlib-based `PlZ`. PalMap decompresses Oodle via [`ooz-wasm`](https://www.npmjs.com/package/ooz-wasm)
(the uncompressed size sits in the header, which is exactly what the decompressor needs), then
parses the GVAS properties directly.

Progress lives in the **player** save under `RecordData`, so `Level.sav` is never needed — which
also means none of Palworld's custom binary blobs have to be decoded. `LevelMeta.sav` in each world
folder holds `WorldName`, `HostPlayerName` and `HostPlayerLevel`, which is what turns a folder
called `8247F1A5…` into "PP Island — Jim (Lv 48)".

## Marker → save-flag joins

| Category | Save flag | Joins on |
|---|---|---|
| Effigy | `RelicObtainForInstanceFlag` **+** `RelicObtainForInstanceFlagByType` | `LevelObjectInstanceId` |
| Fast Travel | `FastTravelPointUnlockFlag` | `LevelObjectInstanceId` |
| Watchtower | `FastTravelPointUnlockFlag` | `LevelObjectInstanceId` |
| Item Pickup | `ItemPickupObtainForInstanceFlag` | `LevelObjectInstanceId` |
| Tower Boss | `TowerBossDefeatFlag` | `BOSS_BATTLE_NAME_<BossType>` |
| Alpha Pal | `NormalBossDefeatFlag` | spawner name (`SpawnerType: FieldBoss`) |
| Caged Boss | `NormalBossDefeatFlag` | spawner name (`SpawnerType: ImprisonmentBoss`) |
| Note | `NoteObtainForInstanceFlag` | `NoteRowName` |

Dungeons, Treasure Maps, Warp Points and Skill Fruit have no per-instance flag — reference
markers only.

### Two traps that silently under-count

**Effigies are recorded in two places.** The flat `RelicObtainForInstanceFlag` only holds the
classic Lifmunk (`CapturePower`) relics. Since 1.0 every effigy variant is its own relic type with
its own perk, stored in `RelicObtainForInstanceFlagByType` as
`{ Type, Flags: [[guid, bool], …] }` — one level deeper:

| Relic type | Effigy | | Relic type | Effigy |
|---|---|---|---|---|
| `CapturePower` | Lifmunk | | `ClimbSpeed` | Tanzee |
| `HungerReduction` | Lamball | | `SphereHoming` | Lunaris |
| `FoodDecayReduction` | Munchill | | `ExpBonus` | Relaxaurus |
| `SwimSpeed` | Pengullet | | | |

Reading only the flat list found 23 of a real save's 45 effigies and left every non-Lifmunk one
unticked. `recordKeys()` in `app/app.js` accepts either shape.

**Watchtowers are fast-travel points.** `BP_LevelObject_UnlockMapPoint_C` — the tower you activate
to reveal map — carries a `FastTravelPointID`, so the game files it under
`FastTravelPointUnlockFlag` alongside ordinary statues. Missing them was why a save had 10 unlock
flags with no marker; adding the category took fast travel from 58/68 to **70/70, zero orphans**.
This is also the "hackable EXP tower" and the "map-reveal tower" — one object, three names.

## The local API

Auto-sync needs to re-read a file on a timer. In a browser only the File System Access API can do
that, and **Brave disables it** while Firefox never shipped it. So the server does the reading and
the page polls it — works everywhere, no flags, no folder picking.

| Endpoint | Returns |
|---|---|
| `/api/worlds` | the world folders it found (ids only — no parsing) |
| `/api/meta` | raw `LevelMeta.sav` bytes; the page decodes it for the world name |
| `/api/status` | `{ mtime }` — a `stat`, cheap enough to poll every minute |
| `/api/save` | the player save bytes, with an `X-Save-Mtime` header |
| `/api/progress` | GET/POST hand-ticked markers — the only write path |

Constrained deliberately: bound to **127.0.0.1 only**, read-only (no write path exists), and every
requested path is validated against the save root so it can't be traversed out of. `PAL_SAVES`
overrides the save location, `PORT` the port (it walks 5173→5177 if busy).

## Coordinates

The map's horizontal axis is world Y (east positive), vertical is world X inverted (north up).
**One** box covers the whole world — Palpagos and both DLC island groups sit in a single continuous
coordinate space at a single scale.

The box is square on purpose. `T_WorldMap` is a square 8192px texture, so the world region it
covers must be square too: the same world-units-per-pixel on both axes. The long-standing box
wasn't — its two axes differed by 0.75%, an error that is ~0 near the middle of the map and grows
to ~30px out at Feybreak and the Sky Islands. That is the whole bug, and it is why DLC markers sat
*beside* the thing they marked while Palpagos looked fine.

It was derived by cross-referencing [paldb.cc](https://paldb.cc/en/Palpagos_Islands), which
publishes the same 8192px artwork as a tile pyramid and lists 867 markers with both their in-game
coordinates and their position on it. A single uniform-scale affine fits all 867 to under 2px, and
its two axis scales agree to 0.002% — the square-texture constraint confirmed from an independent
working implementation rather than assumed.

`tools/calibrate.mjs` no longer fits anything; it **verifies**. Every search-based fit tried here
produced a confidently wrong answer, so the script's job is to re-check the shipped numbers and
exit non-zero if they break. It reports per-landmass (so a regression confined to one can't hide in
a healthy average) and against held-out data, and writes `work/calibration-overlay.png` to judge by
eye. Current state: 332/332 land-guaranteed markers on land, and 360/360 effigies — which no fit
has ever looked at.

Three traps worth keeping, each of which produced a good-looking number:

- **The land mask was wrong.** A colour heuristic tuned for Palpagos's greens and browns silently
  misread Feybreak's dark blue-purple terrain as water, and some open ocean as land, so every score
  computed against it was meaningless while looking plausible. `isLand()` now tests local texture
  *variance* — water is a near-flat gradient, every real landmass has grain — which works
  regardless of palette.
- **A land-hit score is blind to sub-island drift**, because a marker 40px off is usually still
  comfortably on the same island. One re-fit of Palpagos scored *higher* (97.9% vs 97.0%) while
  moving every Palpagos marker by up to 44px. Land-hit can refute a transform; it can't select one.
- **Per-region boxes were the wrong idea entirely.** They were an attempt to patch, landmass by
  landmass, the single global scale defect above. Fixing the scale fixed every region at once, and
  the per-region code is gone.

The marker data is provably exact — converting a world coordinate through Palworld's in-game map
formula (`map_x = (sav_y - 158000)/459`, `map_y = (sav_x + 123888)/459`) reproduces the exact
coordinate the game itself shows, in both Palpagos (Arena Entrance → 629, 14) and Sky Islands
(Azure Covenant Tower → -423, -1426, matched live against a player's own in-game screenshot). This
formula is unrelated to the per-region pixel-placement fit above — it's the game's own coordinate
system, not a texture-fit approximation — so it's what marker popups display instead of raw
save-file units: what a popup shows is directly comparable to what the game or a site like
paldb.cc shows for the same spot.

## Rendering performance

Panning went from **86.7 ms/frame to 16.7 ms** (≈11 → 60 fps). Nearly all of it was one line:
`filter: drop-shadow` on the marker pins. A CSS filter forces the browser to re-rasterise each
element every time the marker pane composites — once per frame while panning. Contrast now comes
from opaque backdrops, which composite for free.

Four smaller traps, all still live in the code:

- **Don't put `transition` on a pin's base rule.** `--pin-scale` changes on zoom, so a base-rule
  transition animates ~900 elements at once — a 368 ms hitch. It's declared on `:hover` only.
- **No `backdrop-filter` on the sidebar.** The map pans *underneath* it, so the backdrop would
  re-blur every frame. Plain alpha composites for free.
- **Viewport culling made it worse, and was removed.** It cut the DOM from ~900 markers to ~345,
  but the bulk add/remove on every `moveend` cost a 158 ms hitch. See `applyVisibility()`.
- **Icons inside a grid pin need `min-width: 0; min-height: 0`.** Grid items default to
  `min-width: auto`, so the track grows to the image's intrinsic size (100 px) and a percentage
  width resolves against *that*, not the pin. Without it icons render ~3× their pin.

Also: an explicit `display` on `.row`/`.field` outranks the UA `[hidden]` rule, so hidden panels
stayed visible until `[hidden] { display: none !important }` was added.

## Regenerating the data

Only needed if Palworld updates and moves things. See **[EXTRACTING.md](EXTRACTING.md)** for the
FModel walkthrough — note the World Partition trap documented there, exporting the wrong folder
takes an hour and 23 GB.

```bash
node tools/build-markers.mjs                       # FModel exports -> markers.json
node tools/merge-bosses.mjs                        # spawners -> alpha pals + caged bosses
node tools/merge-locations.mjs                     # watchtowers, treasure maps, warp points
node tools/merge-cell.mjs itemPickup <cell.json>   # one World Partition cell at a time
node tools/merge-notes.mjs                         # note locations
node tools/copy-ui-icons.mjs                       # official compass icons
node tools/verify-join.mjs                         # score markers against a real save
```

The steps above need the FModel exports. Three more transforms are **self-contained** — they need
only the committed data, no game-file export, so they run on a clean clone:

```bash
node tools/assign-effigy-icons.mjs                 # point effigies at app/data/icons/effigy/*.webp
node tools/rename-bosses.mjs                        # internal code names -> Paldeck names
node tools/merge-skillfruit.mjs                     # 19 Palpagos trees from guide map coords
```

Everything after `build-markers.mjs` merges into an existing `markers.json`, so each can be re-run
on its own. `merge-locations.mjs` needs `--max-old-space-size=6144` (the persistent level is
~180 MB).

## Known gaps

- **Chests, eggs, resource nodes and fishing spots aren't included.** They sit in fine-grained
  World Partition cells — 1427, 649, 849 and 457 cells respectively — so adding them means exporting
  the whole `MainWorld_5` folder. None has a save flag either (they respawn), so they could only
  ever be reference markers. `work/type-cells.json` lists which cells hold what. **Skill fruit** was
  in this bucket (46 cells) but is now shipped from guide/screenshot map coordinates instead — see
  `tools/merge-skillfruit.mjs` — covering all 30 trees (19 Palpagos, 7 Feybreak, 4 Sky Islands).
- **Four newest boss names are descriptive, not Paldeck.** `tools/rename-bosses.mjs` maps 85 of 89
  boss code names to real Paldeck names; PoseidonOrca, RockBeast, ThunderFluffyBird and WhiteDeer
  aren't in any accessible datamine yet, so they keep a cleaned descriptive name until a source
  lists them. A handful of elemental variants show the base species name for the same reason.
- **A couple of tower bosses keep internal placeholder names.** `tools/rename-bosses.mjs` only
  covers `alphaPal`/`cagedBoss`; `towerBoss` labels come straight from the code name
  (`PIDF Tower`, whose real in-game name — confirmed against a player screenshot — is "Azure
  Covenant Tower"). Not yet mapped.
- **Alpha/Caged bosses match 20 of 27.** The other 7 are *human* bosses (`BOSS_Hunter_Rifle`…)
  which aren't in the Pal spawner tables.
- The **World Tree** is a separate map with its own texture; its markers are filtered out.

## Layout

```
Start PalMap.bat  the launcher a player double-clicks
server.mjs        static server + save API — Node standard library only
app/              static browser app (no build step)
  app.js          map, sidebar, sync
  lib/            palsave.mjs (.sav -> GVAS) + gvas.mjs, shared browser/node
  vendor/         Leaflet and ooz-wasm, committed so nothing is installed
  data/           markers.json + T_WorldMap.png + icons  (committed)
docs/             this file, EXTRACTING.md, screenshot
tools/            data pipeline + calibration (dev only)
```

**Nothing needs installing to run PalMap.** `server.mjs` imports only `node:*` modules, and the
browser gets Leaflet and the Oodle decompressor from `app/vendor/`. The one place a save-parsing
library would have been needed server-side — naming worlds from `LevelMeta.sav` — is instead done
in the page, which already carries the decompressor. `package.json` exists solely for `tools/`.

© Void Possum
