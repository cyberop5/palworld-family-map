# PalMap

**A Palworld map that ticks itself off.**

PalMap reads your save file and marks everything you've already collected — effigies, bosses,
fast travel points, watchtowers, notes and pickups. Keep it open while you play and it updates
itself.

## Getting started

**1. Install Node.js** (one time, only if you don't have it)
Go to [nodejs.org](https://nodejs.org), download the big green **LTS** button, install it.

**2. Double-click `Start PalMap.bat`**

That's it. A black window opens, your browser opens the map, and your progress is already filled
in. The first run takes an extra minute to set itself up.

Leave the black window open while you use the map. Close it when you're done.

> On Mac or Linux there's no `.bat` — open a terminal in this folder and run `npm install` once,
> then `npm start`.

## Using it

Your save is found automatically — there's nothing to configure.

- **Save** — pick which world, if you have more than one. They're listed by name.
- **Auto-sync** — on by default. It re-checks every minute while you play.
- **Refresh** — check right now instead of waiting.
- **Categories** — tick a box to show or hide that kind of marker on the map.
- Click any marker to mark it found by hand.

Next to each category you'll see one of two symbols:

| | |
|---|---|
| ⟳ | **Fills in automatically** from your save. |
| ✋ | **You tick these yourself** — Palworld doesn't record them, so nothing can detect them. |

The **●** button next to each category decides what happens to things you've already found:
**●** keep showing them, **◐** fade them, **○** hide them. Shift-click to change every category
at once.

## Common questions

**Is this safe? Will I get banned?**
No. PalMap only *reads* your save file — it never changes it, never touches the game, and never
sends anything anywhere. Palworld has no anti-cheat. You can leave the game running.

**Do I have to close Palworld?**
No. Play normally and the map keeps up.

**I collected something and it didn't appear.**
Palworld only writes your save to disk every few minutes. The status line tells you when the game
last saved — if that time is older than when you picked the thing up, wait a moment and it'll
turn up on the next sync.

**Where is my progress stored?**
In your browser, on your machine. Use **Export progress** to save a backup file, and **Import** to
restore it or move it to another computer.

**Nothing shows up / it can't find my save.**
Use *"Or pick a .sav file manually…"* and choose a file from:
`AppData\Local\Pal\Saved\SaveGames\<numbers>\<numbers>\Players\`

**Can my friend use it?**
Yes — send them this whole folder. Everything needed is included.

## What it tracks

Roughly 760 collectibles that you can actually *finish*:

Effigies · Alpha Pals · Caged Bosses · Tower Bosses · Fast Travel · Watchtowers · Notes ·
Item Pickups · Dungeons · Treasure Maps · Warp Points

It deliberately leaves out chests, eggs, ore and fishing spots. Those respawn forever, so they can
never be completed — and there are thousands of them, which would bury the island in icons.

## Credits

Made by **Void Possum**. Free and open source ([GPL-3.0](https://www.gnu.org/licenses/gpl-3.0)).

Map and icons belong to **Pocketpair, Inc.**, used here for a free fan tool.
Save decompression by [ooz-wasm](https://github.com/SnosMe/ooz-wasm); map by
[Leaflet](https://leafletjs.com).

Curious how it works, or want to change it? See **[TECHNICAL.md](TECHNICAL.md)**.
