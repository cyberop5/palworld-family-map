// merge-ancient-ruins.mjs — name the Ancient Ruins after what they give you.
//
// The category itself is not new. build-markers.mjs has always extracted these
// 104 objects from the World Partition cell MainGrid_L15_X0_Y0_DLC881EFB3, and
// they have always auto-ticked from ItemPickupObtainForInstanceFlag. What they
// never had was a name: every single one shipped labelled "Item Pickup", which
// made a category of 104 finishable, uniquely-rewarding collectibles read like
// scattered junk. This script gives each one the schematic it awards.
//
// Where the names come from
// -------------------------
// paldb.cc's Palpagos map publishes the same objects as "Ancient Ruin", 106 of
// them, each popup naming its reward. Matching those against our markers by
// in-game map coordinate paired all 104 of ours, worst case 0.66 map units
// apart — for scale, the tolerance below is 3. All 106 rewards are distinct:
// no ruin repeats another's schematic, which is what makes this a collection
// worth finishing rather than a resource node.
//
// The two we don't extract
// ------------------------
// paldb lists 106; our cell export holds 104. The missing pair — Old Revolver
// Schematic 2 and Vanguard Charm Schematic — live in cells that have never been
// exported, so they're added here from paldb coordinates, the same way
// merge-skillfruit.mjs adds trees we don't export either.
//
// Their save GUIDs are known but *not individually identified*. A real save
// carried two ItemPickupObtainForInstanceFlag entries matching no marker, which
// are necessarily these two; nothing in the save or on paldb says which GUID
// belongs to which ruin, and the two sit on different landmasses. So the
// assignment below is a coin flip. What that costs is bounded and small: the
// count is always right, and the identities can only appear swapped for a
// player who has collected exactly one of the two. When a future export covers
// their cells, replace the pair with real data and this note goes away.
//
// Idempotent, and safe to run before or after a rename: it collects markers
// under either category id, drops the two synthetic ones, and re-emits.
//
// © Void Possum

import fs from 'node:fs';

// [reward, map_x, map_y] — in-game map coordinates, as paldb and the game itself
// report them.
const RUINS = [
  ['Pelt Armor Schematic 3', 85, -575],
  ['Crossbow Schematic 3', 49, -330],
  ['Feathered Hair Band Schematic 3', 169, -586],
  ['Pendant of Diligence Schematic', -72, -489],
  ['Ring of Water Resistance Schematic', -495, -44],
  ['Heat-Resistant Undershirt Schematic', -379, -154],
  ['Heat Resistant Metal Armor Schematic 2', -102, -102],
  ['Metal Helm Schematic 2', -195, -194],
  ['Musket Schematic 3', -276, -559],
  ['Water Support Whistle Schematic', -311, -312],
  ['Neutral Support Whistle Schematic', -167, -449],
  ['Thermal Undershirt Schematic', -271, 91],
  ['Ring of Electric Resistance Schematic', -251, -75],
  ['Makeshift Handgun Schematic 2', -164, -548],
  ['Ring of Neutral Resistance Schematic', -216, -279],
  ['Electric Support Whistle Schematic', -161, -719],
  ['Applied Planting Handbook I', -49, -219],
  ['Cold Resistant Metal Armor Schematic 2', -78, -331],
  ['Life Pendant Schematic', 106, -232],
  ['Ring of Dark Resistance Schematic', 19, -157],
  ['Dark Support Whistle Schematic', -90, -244],
  ['Sword Schematic 3', 46, -253],
  ['Growth Acceleration Bell Schematic', -26, -92],
  ['Old Revolver Schematic 2', 93, -64],
  ['Grass Support Whistle Schematic', 186, -139],
  ['Ring of Ice Resistance Schematic', 239, 114],
  ['Makeshift Assault Rifle Schematic 2', 309, -78],
  ['Dragon Support Whistle Schematic', 369, 8],
  ['Ice Support Whistle Schematic', 146, 166],
  ['Ring of Grass Resistance Schematic', 302, -335],
  ['Ring of Freight Schematic', 50, 30],
  ['Makeshift Shotgun Schematic 2', 176, 34],
  ['Ring of Dragon Resistance Schematic', 524, -208],
  ['Ground Support Whistle Schematic', 567, 146],
  ['Assault Rifle Schematic 2', 755, 191],
  ['Pal Metal Helm Schematic 2', 533, 578],
  ['Pal Metal Armor Schematic 2', 268, 633],
  ['Defense Support Whistle Schematic', 307, 491],
  ['Ring of Ground Resistance Schematic', 513, 101],
  ['Semi-Auto Shotgun Schematic 2', 390, 712],
  ['Multiclimate Undershirt Schematic', 605, 304],
  ['Applied Transporting Handbook I', 302, 279],
  ['Reptyro Charm Schematic', 386, 202],
  ['Attack Pendant Schematic', 427, 338],
  ["Earth Emperor's Baton Schematic", 175, 334],
  ['Refined Metal Armor Schematic 2', -383, -682],
  ['Refined Metal Helm Schematic 2', -735, -654],
  ['SMG Schematic 2', -841, -398],
  ['Single-Shot Rifle Schematic 3', -724, -218],
  ['Attack Support Whistle Schematic', -502, -508],
  ['Fire Support Whistle Schematic', -441, -558],
  ['Ring of Fire Resistance Schematic', -612, -429],
  ['Defense Pendant Schematic', -372, -335],
  ['Ring of Trust Schematic', -513, -207],
  ['Metal Bat Schematic 3', -489, -638],
  ['Applied Cooling Handbook I', -302, 537],
  ["Celestial Emperor's Baton Schematic", -433, 384],
  ['Applied Lumbering Handbook I', -247, 185],
  ['Applied Gathering Handbook I', 44, 236],
  ['Phantom Ring Schematic', 108, 472],
  ["Frostallion's Talisman Schematic", -100, 177],
  ["Lyleen Noct's Talisman Schematic", -298, 342],
  ['Cryolinx Ring Schematic', -124, 595],
  ['Wumpo Charm Schematic', -229, 470],
  ["Islander's Tool Belt Schematic", -161, 343],
  ["Pal Tamer's Glasses Schematic", 8, 121],
  ["Neptilius's Talisman Schematic", -170, 495],
  ['Air Walker Mk I Schematic', -432, 489],
  ["Lyleen's Talisman Schematic", -492, 214],
  ['Applied Handiwork Handbook I', -568, 349],
  ['Applied Generating Electricity Handbook I', -759, 144],
  ["Warsect Terra's Belt Schematic", -665, 30],
  ['Air Walker Mk II Schematic', -687, 289],
  ['Vanguard Charm Schematic', -815, -850],
  ["Lord of the Sea's Baton Schematic", -643, -1088],
  ['Wandering Merchant Charm Schematic', -784, -1222],
  ["Lord of the Underworld's Baton Schematic", -920, -1127],
  ["Jetragon's Talisman Schematic", -1186, -829],
  ["Flame Emperor's Baton Schematic", -1314, -1082],
  ['Applied Watering Handbook I', -922, -1398],
  ["Divine Dragon's Baton Schematic", -1307, -1497],
  ['Applied Kindling Handbook I', -1214, -1668],
  ['Elphidran Ring Schematic', -752, -995],
  ["Lord of Lightning's Baton Schematic", -1316, -992],
  ["Hartalis's Talisman Schematic", -1237, -1179],
  ["Ice Emperor's Baton Schematic", -960, -1034],
  ['Silvegis Emblem Schematic', -1036, -1146],
  ["Spirit Emperor's Baton Schematic", -986, -1320],
  ["Blazamut's Talisman Schematic", -1209, -1325],
  ["Anubis's Talisman Schematic", -983, -839],
  ["Orserk's Talisman Schematic", -1274, -1307],
  ['Air Walker Mk III Schematic', -1201, -1524],
  ['Applied Mining Handbook I', -463, -1458],
  ['Dogen Emblem Schematic', -300, -1505],
  ['Air Walker EX Schematic', -299, -1365],
  ['Disposable Implant: Swift', -554, -1432],
  ['Applied Medicine Production Handbook I', -466, -1535],
  ['Blazehowl Ring Schematic', 757, 424],
  ['Faleris Aqua Ring Schematic', 406, -726],
  ['Fenglope Lux Ring Schematic', -1279, -575],
  ['Menasting Terra Ring Schematic', -897, 125],
  ['Vaelet Ring Schematic', 859, -94],
  ['Katress Ring Schematic', -1730, -990],
  ['Faleris Ring Schematic', -1219, -1930],
  ['Disposable Implant: Mastery of Fasting', -525, -1375],
  ['Disposable Implant: Heart of the Immovable King', -327, -1488],
];

// The two ruins our cell exports miss, and the two save GUIDs that must belong
// to them. See the header: the pairing is unverifiable, so it is arbitrary.
const UNEXPORTED = [
  ['Old Revolver Schematic 2', '4bdb51a64a259844e547629abb44eaee'],
  ['Vanguard Charm Schematic', '486837a0436f0097fd509395fe1b32c3'],
];

// map_x = (sav_y - 158000)/459, map_y = (sav_x + 123888)/459 — and its inverse.
const toMap = m => [(m.y - 158000) / 459, (m.x + 123888) / 459];
const toSav = (mx, my) => ({ x: my * 459 - 123888, y: mx * 459 + 158000 });

// 3 map units ≈ 8px on the map image. Generous next to the 0.66 worst case, and
// still far tighter than the closest two ruins are to each other.
const TOLERANCE = 3;

const path = 'app/data/markers.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

const isRuin = m => m.category === 'itemPickup' || m.category === 'ancientRuin';
const synthetic = new Set(UNEXPORTED.map(([, guid]) => guid));
const extracted = data.markers.filter(m => isRuin(m) && !synthetic.has(m.key));
data.markers = data.markers.filter(m => !isRuin(m));

let named = 0;
const claimed = new Set();
for (const m of extracted) {
  const [mx, my] = toMap(m);
  let best = -1;
  let bestDist = Infinity;
  RUINS.forEach(([, rx, ry], i) => {
    const d = Math.hypot(rx - mx, ry - my);
    if (d < bestDist) { bestDist = d; best = i; }
  });

  if (bestDist > TOLERANCE) {
    console.warn(`  no reward within ${TOLERANCE} for ruin at ${Math.round(mx)},${Math.round(my)} (nearest ${bestDist.toFixed(1)})`);
  } else if (claimed.has(best)) {
    // Two markers claiming one reward means the match is ambiguous, not that
    // one of them is wrong — better to leave both generic than to guess.
    console.warn(`  ${RUINS[best][0]} claimed twice; leaving one unnamed`);
  } else {
    claimed.add(best);
    m.label = RUINS[best][0];
    named++;
  }

  m.category = 'ancientRuin';
  m.id = `ancientRuin:${m.key}`;
  data.markers.push(m);
}

for (const [reward, key] of UNEXPORTED) {
  const entry = RUINS.find(([r]) => r === reward);
  if (!entry) throw new Error(`${reward} is not in RUINS`);
  const { x, y } = toSav(entry[1], entry[2]);
  data.markers.push({
    id: `ancientRuin:${key}`,
    category: 'ancientRuin',
    key,
    label: reward,
    x, y, z: 0,
  });
}

const cat = data.categories.find(c => c.id === 'itemPickup' || c.id === 'ancientRuin');
if (cat) {
  cat.id = 'ancientRuin';
  cat.name = 'Ancient Ruin';
} else {
  data.categories.push({ id: 'ancientRuin', name: 'Ancient Ruin', saveFlag: 'ItemPickupObtainForInstanceFlag' });
}

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log(`named ${named}/${extracted.length} extracted ruins, added ${UNEXPORTED.length} unexported — ${extracted.length + UNEXPORTED.length} total`);
