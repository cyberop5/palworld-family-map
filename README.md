# PalMap

**A Palworld map that ticks itself off.**

PalMap reads your save file and marks everything you've already collected — effigies, bosses,
fast travel points, watchtowers, notes and pickups. Keep it open while you play and it updates
itself.

![PalMap](docs/palmapdemo.png)

## Download

### ➡️ [**Download PalMap**](https://github.com/voidpossum/PalMap/archive/refs/heads/main.zip) ⬅️

That link downloads a `.zip`. **Right-click it → Extract All**, and put the folder anywhere you
like (Desktop is fine).

> Don't run it from inside the zip — Windows won't let it work properly. Extract it first.

## Start it

**1. Install Node.js** — only if you don't already have it.
Go to [nodejs.org](https://nodejs.org) and click the big green **LTS** button, then install it.

**2. Double-click `Start PalMap.bat`**

A black window opens and your browser opens the map with your progress already filled in.

Leave the black window open while you play. Close it when you're done.

> Windows may warn about an unrecognised app. Click **More info → Run anyway** — that warning
> appears for any program without a paid certificate.

> On Mac or Linux there's no `.bat`: open a terminal in the folder and run `npm start`.

## Using it

Your save is found automatically — there's nothing to set up.

- **Save** — pick which world, if you have more than one. They're listed by name.
- **Auto** — on by default, re-checks every few minutes while you play.
- **Sync now** — check immediately instead of waiting.
- **Palpagos / World Tree** — switch maps. Searching finds things on either one and takes you there.
- **Categories** — tick a box to show or hide that kind of marker.
- Click any marker on the map to tick it off by hand.

Next to each category is one of two symbols:

| | |
|---|---|
| ⟳ | **Fills in automatically** from your save. |
| ✋ | **You tick these yourself** — Palworld doesn't record them, so nothing can detect them. |

Below those is **Reference — not counted**: dungeons, treasure maps, warp points, skill fruit and
bounty targets. They're there to look up while you play, not to complete — they reset, regrow or
respawn — so they get no score. You can still tick one to grey it out.

The **●** button decides what happens to things you've already found: **●** keep showing them,
**◐** fade them, **○** hide them. Shift-click to change every category at once.

## Common questions

**Is this safe? Will I get banned?**
No. PalMap only *reads* your Palworld save — it never changes it, never touches the game, and never
sends any of your save data anywhere. Palworld has no anti-cheat. You can leave the game running.

**Does PalMap phone home?**
Once a day, one thing: it checks a public file on GitHub to see if a newer version exists, and shows
a link in the footer if so. That's it — no save data, no identifiers, nothing about you or your
world. It's `checkForUpdate()` in `app/app.js` if you'd rather see exactly what it does, or delete
it.

**Do I have to close Palworld?**
No. Play normally and the map keeps up.

**I collected something and it didn't show up.**
Palworld only writes your save to disk on a timer — usually every 30 seconds, and PalMap reads your
world's actual setting and shows it under the sync buttons. Nothing can make it faster, so pressing
*Sync now* repeatedly won't help. The status line tells you when the game last saved: if that's
older than when you picked the thing up, wait for the next save and it'll appear.

**Where is my progress kept?**
Things marked ⟳ come from your save, so they're never lost. Things you tick by hand are stored in
a `progress.json` file inside the PalMap folder — keep that file and you keep your progress.

**It can't find my save.**
Click *"Or pick a .sav file manually…"* and choose a file from
`AppData\Local\Pal\Saved\SaveGames\<numbers>\<numbers>\Players\`

**Can my friend use it?**
Yes — send them the download link above, or just copy the whole folder to them.

## What it tracks

**Both maps** — Palpagos with the Feybreak and Sunreach islands, and the World Tree. Switch between
them at the top of the category list.

Around 900 collectibles you can actually *finish*, most of them ticking themselves off as you play:

Effigies · Ancient Ruins · Alpha Pals · Caged Bosses · Tower Bosses · Fast Travel · Watchtowers ·
Journals

**Ancient Ruins** are the ruins you hack for a schematic. Every one of the 106 gives a *different*
one, and each is named after what it gives — so searching "Anubis" or "Air Walker" takes you
straight to the ruin that has it.

Then a reference section, for things worth finding but not worth counting — they reset, regrow or
respawn, so there's nothing to complete:

Dungeons (with their real names and levels) · Treasure Maps · Warp Points · Skill Fruit Trees ·
Bounty targets

It also shows **where you are** and **any pins you dropped on the in-game map**, both read straight
from your save.

It leaves out chests, eggs, ore and fishing spots on purpose. Those respawn forever, so they can
never be completed — and there are thousands of them, which would bury the island in icons.

## What's in this folder

| | |
|---|---|
| **Start PalMap.bat** | The thing you double-click. |
| `app` | The map itself. |
| `docs` | Screenshot and notes for the curious. |
| `tools` | Scripts for rebuilding map data from game files. You'll never need these. |
| everything else | Plumbing. Leave it alone. |

## Credits

Made by **[Void Possum](https://voidpossum.carrd.co/)**. Free and open source
([GPL-3.0](https://www.gnu.org/licenses/gpl-3.0)).

Map and icons belong to **Pocketpair, Inc.**, used here for a free fan tool.
Save decompression by [ooz-wasm](https://github.com/SnosMe/ooz-wasm); map by
[Leaflet](https://leafletjs.com).

Schematic names, journal titles, dungeon names and bounty locations were cross-checked against
**[paldb.cc](https://paldb.cc)**, which is also what both maps are calibrated against. Skill fruit
locations came from community guides. Thanks to all of them.

Curious how it works? See **[docs/TECHNICAL.md](docs/TECHNICAL.md)**.
