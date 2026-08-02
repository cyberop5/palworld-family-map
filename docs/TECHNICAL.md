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
| Ancient Ruin | `ItemPickupObtainForInstanceFlag` | `LevelObjectInstanceId` |
| Tower Boss | `TowerBossDefeatFlag` | `BOSS_BATTLE_NAME_<BossType>` |
| Alpha Pal | `NormalBossDefeatFlag` | spawner name (`SpawnerType: FieldBoss`) |
| Caged Boss | `NormalBossDefeatFlag` | spawner name (`SpawnerType: ImprisonmentBoss`) |
| Note | `NoteObtainForInstanceFlag` | `NoteRowName` |

Dungeons, Treasure Maps, Warp Points, Skill Fruit and Bounties have no per-instance flag. They are
**reference** categories (`reference: true` in `markers.json`'s `categories[]`): shown on the map,
searchable, hand-tickable, but with no counter and no progress bar.

That distinction is the point, not a technicality. Dungeons reset, skill fruit regrows, bounty
targets respawn, and a treasure map is a place you go rather than a thing you complete. Counting
them invented a score nobody was playing for — "0 / 170 dungeons" made the sidebar read as failure
at a game that was never being played. `app/app.js` sorts categories into three tiers
(auto-synced → hand-tracked collections → reference); the middle tier is empty today and exists so
that a future hand-tracked *collectible* isn't silently filed as reference.

### Ancient Ruins were shipping as "Item Pickup"

The 104 objects `build-markers.mjs` pulls out of cell `MainGrid_L15_X0_Y0_DLC881EFB3` are the
Ancient Ruins, and each awards a **unique** schematic — 106 ruins, 106 distinct rewards. They had
always auto-ticked correctly; what they lacked was a name, so a finishable collection of uniquely
rewarding pickups shipped as 104 identical pins reading "Item Pickup". `tools/merge-ancient-ruins.mjs`
names each one after its reward, matched against paldb.cc by in-game coordinate (all 104 paired,
worst case 0.66 map units, tolerance 3).

Marker ids carry the category, so the rename orphaned existing hand ticks. `migrate()` in
`app/app.js` rewrites the `itemPickup:` prefix on read, from both localStorage and `progress.json`.

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
| `/api/worldoption` | raw `WorldOption.sav` bytes; the page reads `autoSaveSpan` from it |
| `/api/localdata` | raw `LocalData.sav` bytes; the page reads the player's own map pins |
| `/api/status` | `{ mtime }` — a `stat`, cheap enough to poll every minute |
| `/api/save` | the player save bytes, with an `X-Save-Mtime` header |
| `/api/progress` | GET/POST hand-ticked markers — the only write path |

All the `.sav` endpoints hand over raw bytes and let the page decode them. That is what keeps
`server.mjs` on Node's standard library alone, and therefore keeps setup at "double-click the
launcher".

**Why the autosave notice exists.** Palworld flushes to disk on the world's own timer —
`OptionWorldData.Settings.autoSaveSpan`, 30 seconds by default. Nothing PalMap does can beat it, so
pressing *Sync now* straight after picking something up can only ever show the same numbers, which
reads as a broken button. The page reads the world's actual value rather than hardcoding 30, because
a server configured slower would otherwise look broken for minutes at a time.

**Player position and in-game map pins.** `LastTransform.Translation` in the player save is where
the character stood at the last write — free, since that file is already fetched and parsed every
sync. The pins the player dropped on the in-game map live in `LocalData.sav` under
`Local_CustomMarkerSaveData`. Neither is a collectible, so both sit in their own Leaflet layer with
no category, no count and no tick.

`LocalData.sav` gets a targeted reader (`app/lib/localpins.mjs`) rather than a full parse: it is a
normal GVAS container, but somewhere in its 5.4 MB of cached character data `gvas.mjs` hits a
property shape it mishandles and throws. The pin array sits at ~96% through the file, past whatever
trips the parser, so finding each `IconLocation` by name and reading the `Vector` after it needs no
knowledge of the rest. It fails soft in every direction — no pins beats a broken page.

Constrained deliberately: bound to **127.0.0.1 only**, read-only (no write path exists), and every
requested path is validated against the save root so it can't be traversed out of. `PAL_SAVES`
overrides the save location, `PORT` the port (it walks 5173→5177 if busy).

## Coordinates

Palworld has two maps, and says so itself: a save's `RecordData.UnlockedWorldMapFlags` reads
`{ MainMap, Tree }`. MainMap covers Palpagos plus both DLC island groups in one continuous
coordinate space; the World Tree is a separate instanced level with its own texture, its own corner
of world space, and — the part that isn't obvious — **its own coordinate origin and scale**. Nothing
about one carries over to the other. `MAPS` in `app/app.js` holds both.

On both, the image's horizontal axis is world Y (east positive), vertical is world X inverted
(north up).

Both boxes are square on purpose. Each texture is a square 8192px image, so the world region it
covers must be square too: the same world-units-per-pixel on both axes. MainMap's long-standing box
wasn't — its two axes differed by 0.75%, an error that is ~0 near the middle of the map and grows to
~30px out at Feybreak and the Sky Islands. That was the whole bug, and it is why DLC markers sat
*beside* the thing they marked while Palpagos looked fine.

Both were derived by cross-referencing [paldb.cc](https://paldb.cc/en/Palpagos_Islands), which
publishes the same two 8192px textures as tile pyramids:

- **MainMap** — 867 markers carrying both their in-game coordinates and their position on the
  artwork. A single uniform-scale affine fits all 867 to under 2px, and its two axis scales agree to
  0.002%.
- **Tree** — fitting on paldb's *displayed* coordinates would be much worse than it looks: they are
  rounded to integers, and at 32px per map unit that rounding alone is worth ±16px. So the fit pairs
  the 15 fast travel points **by name** and uses our own exact world coordinates against paldb's
  tile positions instead. Max residual **0.05px** over 15 points, axis scales agreeing to 0.0006%.
  Every other World Tree marker — 4 towers, 7 alpha pals, 2 watchtowers and all 47 effigies — is
  held out and lands correctly.

`tools/calibrate.mjs` no longer fits anything; it **verifies**, both maps. Every search-based fit
tried here produced a confidently wrong answer, so the script's job is to re-check the shipped
numbers and exit non-zero if they break. Current state: **100% of land-guaranteed markers on both
maps, and 407/407 effigies** — which no fit has ever looked at. The only two markers it reports off
land are Dumud and Whalaska: a mud Pal and a whale, which live in water.

Four traps worth keeping, each of which produced a good-looking number:

- **The land mask was wrong, twice.** First a colour heuristic tuned for Palpagos's greens and
  browns silently misread Feybreak's dark blue-purple terrain as water, so every score computed
  against it was meaningless while looking plausible. Replacing it with a local *variance* test
  fixed that — but variance in turn calls large flat expanses of snow and ice water, which stranded
  real markers standing on the ice. `isLand()` is now `brightness ≥ 120 || variance ≥ 15`. Those two
  populations are nowhere near each other: everything off-map measures 20–60 average brightness,
  flat ice measures 186–204, so the threshold sits in a very wide empty gap rather than on a tuned
  edge.
- **A land-hit score is blind to sub-island drift**, because a marker 40px off is usually still
  comfortably on the same island. One re-fit of Palpagos scored *higher* (97.9% vs 97.0%) while
  moving every Palpagos marker by up to 44px. Land-hit can refute a transform; it can't select one.
- **Per-region boxes were the wrong idea entirely.** They were an attempt to patch, landmass by
  landmass, the single global scale defect above. Fixing the scale fixed every region at once, and
  the per-region code is gone. The World Tree is *not* a fourth region — it is a genuinely separate
  level, which is why it gets its own box and the DLC islands do not.
- **Rounded reference data caps your precision.** The Tree fit against paldb's displayed integers
  gave a 22px max residual and looked like a modelling problem; it was quantisation. Pairing by name
  and using exact coordinates took the same data to 0.05px.

Marker popups show the in-game map coordinate rather than raw save units, so what a popup says is
directly comparable to what the game or paldb shows for the same spot. Each map has its own formula
(`coords` in the `MAPS` table): MainMap is `(sav_y − 158000)/459`, `(sav_x + 123888)/459`, verified
against Arena Entrance → 629, 14 and Azure Covenant Tower → −423, −1426. The World Tree divides by
**1334**, not 459, and reproduces paldb's published coordinate for 14 of the 15 fast travel points
exactly, the last off by one.

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

The steps above need the FModel exports. The rest are **self-contained** — they need only the
committed data, no game-file export, so they run on a clean clone, and all are idempotent:

```bash
node tools/assign-effigy-icons.mjs                 # point effigies at app/data/icons/effigy/*.webp
node tools/rename-bosses.mjs                        # internal code names -> Paldeck names
node tools/merge-skillfruit.mjs                    # 30 trees from guide/screenshot map coords
node tools/merge-ancient-ruins.mjs                 # name each ruin after the schematic it gives
node tools/merge-journals.mjs                      # real journal titles + the 15 DLC/Tree ones
node tools/name-dungeons.mjs                       # in-game dungeon names and levels
node tools/merge-bounties.mjs                      # 33 wanted-criminal targets
node tools/calibrate.mjs                           # verify both transforms; non-zero on regression
```

Run order matters in one place: `merge-journals.mjs` names the notes `merge-notes.mjs` placed, so it
goes after it.

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
- **One field boss is deliberately missing.** paldb lists an 83rd Palpagos boss (Dualith, Lv 55, at
  map 910,-99) that our spawner tables don't. It is left out on purpose rather than added blind: no
  save key can be derived for it, so in an auto-syncing category it would never tick, and there's no
  portrait for it either, so it would render as a bare dot among 82 portraits. Adding it needs a
  spawner-table source, not a coordinate.
- **Two Ancient Ruins have their save GUIDs assigned arbitrarily.** Our cell export holds 104 of
  106; the other two (Old Revolver Schematic 2, Vanguard Charm Schematic) are added from paldb
  coordinates. A real save carries exactly two `ItemPickupObtainForInstanceFlag` entries matching no
  marker, which are necessarily these — but nothing says which GUID belongs to which ruin, and they
  sit on different landmasses. The count is therefore always right; only the two identities can
  appear swapped, and only for a player who has collected exactly one of them.
- **Four World Tree journals are numbered by assumption.** `worldtree1`–`worldtree4` are the
  non-Zenara Tree journals, but nothing available says which title is which number, so they follow
  the order paldb lists the journals datatable. Same shape of risk as above: a real export would
  settle it. The Zenara and Auri diaries are *not* affected — those are numbered in their own titles
  and follow the author-per-region scheme every other region already confirms.

## Layout

```
Start PalMap.bat  the launcher a player double-clicks
server.mjs        static server + save API — Node standard library only
app/              static browser app (no build step)
  app.js          maps, sidebar, sync
  lib/            palsave.mjs (.sav -> GVAS) + gvas.mjs, shared browser/node
                  localpins.mjs — targeted reader for the in-game map pins
  vendor/         Leaflet and ooz-wasm, committed so nothing is installed
  data/           markers.json + T_WorldMap.png + T_TreeMap.png + icons  (committed)
docs/             this file, EXTRACTING.md, screenshot
tools/            data pipeline + calibration (dev only)
```

**Nothing needs installing to run PalMap.** `server.mjs` imports only `node:*` modules, and the
browser gets Leaflet and the Oodle decompressor from `app/vendor/`. The one place a save-parsing
library would have been needed server-side — naming worlds from `LevelMeta.sav` — is instead done
in the page, which already carries the decompressor. `package.json` exists solely for `tools/`.

© Void Possum
