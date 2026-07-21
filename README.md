# PalMap

A local Palworld progress map. Tracks Lifmunk Effigies, bosses, dungeons and fast travel
points, and reads your save file to tick off what you've already found.

Runs entirely in your browser. No account, no upload, no subscription.

## Running it

```bash
npm install
npm start
```

Then open **http://localhost:5173/**

## Using it

1. Click **Sync from save file**.
2. Pick your player save from:
   ```
   %LOCALAPPDATA%\Pal\Saved\SaveGames\<SteamID>\<WorldID>\Players\<something>.sav
   ```
   Pick a file from `Players\` — not `Level.sav`.
3. Everything the save knows about gets marked automatically. Click any other marker to
   tick it off by hand.

Use **Export progress** to keep a backup — progress otherwise lives only in this browser.

### Is this safe to use?

Yes. PalMap **only ever reads** your save file, and does so in the browser — nothing is
uploaded and nothing is written back. It never touches the running game: no injection, no
memory reading, no DLL, no UE4SS. Your Palworld install has no anti-cheat (no EasyAntiCheat,
no BattlEye). You can leave the game running.

## How it works

Palworld v0.6+ saves use the `PlM` container: a small header wrapping an **Oodle Kraken**
compressed [GVAS](https://github.com/cheahjs/palworld-save-tools) blob. This is why
`palworld-save-tools` and most save editors fail on current saves — they only handle the older
zlib-based `PlZ`. PalMap decompresses Oodle in the browser via
[`ooz-wasm`](https://www.npmjs.com/package/ooz-wasm) (the uncompressed size sits in the header,
which is exactly what the decompressor needs), then parses the GVAS properties directly.

Progress lives in the **player** save under `RecordData`, so `Level.sav` is never needed —
which also means none of Palworld's custom binary blobs have to be decoded.

Markers join to save flags two ways:

| Category | Save flag | Joins on |
|---|---|---|
| Lifmunk Effigy | `RelicObtainForInstanceFlag` | `LevelObjectInstanceId` (GUID) |
| Fast Travel | `FastTravelPointUnlockFlag` | `LevelObjectInstanceId` (GUID) |
| Item Pickup | `ItemPickupObtainForInstanceFlag` | `LevelObjectInstanceId` (GUID) |
| Tower Boss | `TowerBossDefeatFlag` | `BOSS_BATTLE_NAME_<BossType>` |
| Alpha Pal | `NormalBossDefeatFlag` | spawner name (`SpawnerType: FieldBoss`) |
| Caged Boss | `NormalBossDefeatFlag` | spawner name (`SpawnerType: ImprisonmentBoss`) |
| Note | `NoteObtainForInstanceFlag` | `NoteRowName` |

Alpha Pals and Caged Bosses share one save flag but are different things in game — a roaming
Alpha versus one held in a syndicate camp — so they're separate categories with separate counters.

## Regenerating the map data

Only needed if Palworld updates and adds new locations. See **[EXTRACTING.md](EXTRACTING.md)**
for the FModel walkthrough, then:

```bash
node extract/build-markers.mjs           # FModel exports -> app/data/markers.json
node extract/merge-bosses.mjs            # spawner datatables -> field bosses + portraits
node extract/merge-cell.mjs itemPickup <cell.json>   # one World Partition cell at a time
node extract/merge-notes.mjs             # note locations (transcribed, see the script)
node extract/assign-effigy-icons.mjs     # attach Pal portraits to effigies
node extract/verify-join.mjs             # check markers against a real save
node extract/calibrate.mjs               # refit world->image transform, overlay in work/
```

Everything after `build-markers.mjs` merges into an existing `markers.json` rather than
rebuilding it, so each can be re-run on its own without re-exporting the level.

The transform in `app/app.js` was fitted by `calibrate.mjs`: it places 97.4% of
known-on-land markers on land pixels, and the fitted world box is square to within 1%,
as a square texture requires. `diagnose-offset.mjs` later found a residual ~11px westward
drift confined to the far-eastern edge (invisible on the mainland, but obvious on small
eastern islands like Arena Entrance); `maxY` is tightened slightly to null it there while
keeping the rest within ~2px. The marker *data* is provably exact — converting a fast-travel
point's world coords through Palworld's documented in-game-map formula reproduces the exact
coordinate the game shows for it (e.g. Arena Entrance → 629, 14).

## Using the map

Each category row has a **●/◐/○ button** controlling what happens to markers you've already
found, independently per category — so you can hide found effigies while keeping found fast-travel
points on screen. Click cycles shown → dimmed → hidden; **shift-click sets every category at
once**. The checkbox beside it still toggles the whole category. Both persist per browser.

## Marker icons

Fast travel, dungeons, towers and item pickups use the **game's own compass icons** from
`Texture/UI/InGame` — the same glyphs Palworld draws on its HUD. Effigies and bosses show the
actual Pal portrait (`Texture/PalIcon`, 128×128) instead, because that tells you *which* Pal, which
a generic icon can't. Notes have no counterpart anywhere in the UI textures, so they keep a drawn
SVG glyph.

Effigy portraits are matched via a display-name → internal-codename table in
`extract/assign-effigy-icons.mjs` — the game labels them "Lamball Effigy" but the icon file is
`T_SheepBall_icon_normal.png`.

Pins scale with zoom via a single `--pin-scale` CSS variable, so ~900 markers don't bury the
island at full-map zoom without needing to resize every icon in the DOM.

## Rendering performance

Panning went from **86.7 ms/frame to 16.7 ms** (≈11 fps → 60 fps). Nearly all of it was one line:
`filter: drop-shadow` on the marker pins. A CSS filter forces the browser to re-rasterize each
element every time the marker pane composites — once per frame while panning. Contrast now comes
from opaque backdrops, which composite for free.

Two smaller traps worth remembering if this code is touched again:

- **Don't put `transition` on a pin's base rule.** `--pin-scale` changes on zoom, so a base-rule
  transition animates ~900 elements simultaneously — a 368 ms hitch. It's declared on `:hover` only.
- **Viewport culling made it worse, and was removed.** It cut the DOM from ~900 markers to ~345,
  but the bulk add/remove on every `moveend` cost a 158 ms hitch — far more than the smooth
  full-set render costs. See the comment on `applyVisibility()` in `app/app.js`.
- **Icons inside a grid pin need `min-width: 0; min-height: 0`.** Grid items default to
  `min-width: auto`, so the track grows to the image's intrinsic size (100 px for the compass
  PNGs) and a percentage width resolves against *that*, not the pin. Without it the icons render
  ~3× their pin and overflow it — which is exactly how they shipped until it was measured.

## Known gaps

- **Field boss names show internal codenames** ("Volcanic Monster" instead of "Blazamut"), and
  four "Yakumo" effigies have no portrait, both for the same reason: no display-name table.
  Exporting `Pal/Content/L10N/en/Pal/DataTable/Text/DT_PalNameText_Common` and re-running
  `merge-bosses.mjs` + `assign-effigy-icons.mjs` fixes both.
- **Field bosses match 20 of 27.** The remaining 7 are *human* bosses (`BOSS_Hunter_Rifle`,
  `BOSS_Male_Soldier`…) which aren't in the Pal spawner tables at all.
- **Fast travel matches 50 of 57.** The other 7 are in World Partition cells that weren't exported.
- **Herbil / Munchill effigy portraits are inferred** by elimination from `LeafMomonga` /
  `IceCrocodile`. If they look swapped in game, swap them in `assign-effigy-icons.mjs`.
- **Chests, eggs and skill fruit** aren't included. They're respawning spawners (~9,000 of them),
  so they can't be "completed" — they'd be reference markers only.
- The **World Tree** is a separate map with its own texture (`T_TreeMap`); its markers are
  filtered out rather than shown.

## Layout

```
app/            static browser app (no build step)
  app.js        map, sidebar, sync, import/export
  data/         markers.json + T_WorldMap.png + icons  (generated, committed)
src/
  palsave.mjs   .sav container -> GVAS bytes   (shared: browser + node)
  gvas.mjs      GVAS property reader
extract/        one-off data pipeline + calibration
server.mjs      static server
```

## Credits

Marker extraction approach follows
[ARXII-13/Palworld-Interactive-Map](https://github.com/ARXII-13/Palworld-Interactive-Map)
(Apache-2.0). Oodle decompression by [ooz-wasm](https://github.com/SnosMe/ooz-wasm) (GPL-3.0);
PalMap is GPL-3.0 as a result.

## Game assets

The map texture, marker data and Pal icons under `app/data/` are extracted from Palworld and are
included here so the map works on a fresh clone with no extraction step. They remain the property
of **Pocketpair, Inc.** and are used here under fair community use: PalMap is free, open-source and
non-monetised, and does not compete with or reproduce the game. Many community tools ship the same
assets on the same basis. If you fork this, keep it free and non-commercial. To regenerate the
assets yourself from your own install instead, see [EXTRACTING.md](EXTRACTING.md).

© Void Possum
