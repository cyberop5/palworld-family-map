# Extracting the map and marker data from your game files

This is a one-time step. It reads your installed game files and pulls out two things:

1. **The map image** — the actual in-game map of Palpagos Island.
2. **The marker data** — where every effigy, boss, chest, egg, note and skill fruit tree is.

You only need to redo this if Palworld updates and adds new locations.

> **Is this safe?** Yes. FModel is a file viewer — it opens the game's `.pak` file the same way
> an image viewer opens a photo. It never touches the running game, never injects anything, and
> never modifies a single file. Your Palworld install has no anti-cheat (verified — no
> EasyAntiCheat, no BattlEye). **You do not need to close the game.**

---

## Step 1 — Install FModel

1. Go to **https://fmodel.app/** and click Download.
2. Run the installer. It needs .NET — if it complains, it'll link you to the download.

## Step 2 — Point FModel at Palworld

Open FModel. The first screen asks for a game directory.

1. Click the **`...`** button next to *Directory* and choose:
   ```
   S:\SteamLibrary\steamapps\common\Palworld
   ```
2. In the dropdown next to it, pick **`GAME_UE5_1`**.

   > If FModel auto-detects Palworld and fills this in, great — just confirm it matches.
3. Click **OK**. FModel will load the archive. It may take a minute (it's a 38 GB file).

## Step 3 — Load the mappings file

This tells FModel what the data inside the game means. **I've already downloaded it for you.**

1. Go to **Settings** (gear icon) → **General**.
2. Find **Local Mappings File** and set it to **Enabled**.
3. In **Mapping File Path**, browse to:
   ```
   D:\AI\Claude\Code\PalMap\extract\Mappings.usmap
   ```
4. While you're in Settings, also set:
   - **Texture Format** → `PNG`
5. Click **Save** and restart FModel if it asks.

## Step 4 — Export the map image

1. In the search box at the top, type: `T_WorldMap`
2. You want the result at this path:
   ```
   Pal/Content/Pal/Texture/UI/Map/T_WorldMap
   ```
3. **Right-click it → Export Raw Data (.png)**

   (If you see a "Save Textures" or "Export" option instead, that's fine too — we just need the PNG.)

## Step 5 — Export the world data

> **Don't right-click the `MainWorld_5` folder unless you mean it.** Palworld's world is UE5 World
> Partition, so that folder holds ~9,700 streaming-cell packages — exporting it takes about an hour
> and writes tens of thousands of files. Almost everything useful lives in the single persistent
> level asset, and the cells you actually need can be looked up from it afterwards.

1. In the folder tree on the left, navigate to:
   ```
   Pal/Content/Pal/Maps/MainWorld_5
   ```
2. **Right-click the `PL_MainWorld5` asset inside it → Save Packages Properties (.json)**

   That one file is the persistent level: every fast-travel point, tower and dungeon portal, plus
   `SubObjectsToCellRemapping` — an index of which streaming cell each actor lives in. It exports
   in seconds.

3. Only if a marker category turns out to live in streaming cells, export **just those cells** by
   name (`extract/build-markers.mjs` prints the ones it wants). Exporting the whole folder is
   almost never the right move.

3. Now navigate to:
   ```
   Pal/Content/L10N/en/Pal/DataTable/Text
   ```
4. **Right-click that `Text` folder → Save Folder's Packages Properties (.json)**

   This gives us the readable English names for everything.

## Step 6 — Tell me where the files went

By default FModel writes to something like:
```
C:\Users\<you>\Documents\FModel\Output\Exports\
```

You can check the exact path in FModel under **Settings → General → Output Directory**.

**Just paste that path to me and I'll take it from there.** I'll run the parser that turns those
exports into the map's marker data.

---

## Troubleshooting

**"Failed to load archive" / nothing appears**
Double-check the directory is the folder *containing* `Palworld.exe`, not the `Paks` folder itself.

**Properties export as `Unknown` or garbled names**
The mappings file didn't load. Re-check Step 3 — *Local Mappings File* must be **Enabled**, and
the path must point at the `.usmap` file itself.

**FModel is slow**
Normal. The `.pak` is 38 GB. Step 5 in particular can take several minutes.

**It says the file is in use**
Rare, but if it happens, it's the only case where you'd need to close Palworld briefly. Reading
normally works fine while the game runs.
