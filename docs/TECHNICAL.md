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

Dungeons, Treasure Maps and Warp Points have no per-instance flag — reference markers only.

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
Bounds were fitted by `tools/calibrate.mjs` — 97.4% of known-on-land markers land on land pixels.
`diagnose-offset.mjs` then found a residual ~11px westward drift confined to the far-eastern edge
(invisible on the mainland, obvious on small islands like Arena Entrance); `maxY` is tightened to
null it there while keeping the rest within ~2px.

The marker data is provably exact — converting a fast-travel point's world coords through
Palworld's in-game map formula (`map_x = (sav_y - 158000)/459`, `map_y = (sav_x + 123888)/459`)
reproduces the exact coordinate the game shows (e.g. Arena Entrance → 629, 14).

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
node tools/assign-effigy-icons.mjs                 # attach Pal portraits to effigies
node tools/copy-ui-icons.mjs                       # official compass icons
node tools/merge-skillfruit.mjs                    # needs the 46 cells in work/skillfruit-cells.txt
node tools/verify-join.mjs                         # score markers against a real save
```

Everything after `build-markers.mjs` merges into an existing `markers.json`, so each can be re-run
on its own. `merge-locations.mjs` needs `--max-old-space-size=6144` (the persistent level is
~180 MB).

## Known gaps

- **Skill fruit, chests, eggs, resource nodes and fishing spots aren't included.** They sit in
  fine-grained World Partition cells — 46, 1427, 649, 849 and 457 cells respectively — so adding
  them means exporting the whole `MainWorld_5` folder. None has a save flag either (they respawn),
  so they could only ever be reference markers. `work/type-cells.json` lists which cells hold what.
- **Field boss names show internal codenames** ("Volcanic Monster" instead of "Blazamut").
  Re-running `merge-bosses.mjs` now that `DT_PalNameText_Common` is exported would fix it.
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
