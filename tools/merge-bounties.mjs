// merge-bounties.mjs — add the wanted-criminal bounty targets.
//
// Bounties are the human targets you turn in for Gold at a bounty board. They
// aren't in any datatable we extract — the Pal spawner tables that feed
// merge-bosses.mjs cover Pals, and these are people — so the coordinates come
// from paldb.cc's Bounty layer, the same way merge-skillfruit.mjs sources trees.
//
// paldb's layer lists 66 entries, but that is every marker double-counted: each
// target appears exactly twice at the same coordinate. Deduplicating leaves 33,
// which is the real number of targets.
//
// Reference markers, deliberately. Bounty targets respawn, and nothing in the
// save records which ones you've turned in — NormalBossDefeatFlag holds only
// shared type-level flags for human bosses (boss_hunter_rifle and friends), not
// per-instance ones. So there is nothing to auto-tick against and no total to
// finish; they're here because knowing where a level-57 target stands is useful
// while you're playing, which is exactly what the reference section is for.
//
// Idempotent.
//
// © Void Possum

import fs from 'node:fs';

// [label, map_x, map_y] — in-game map coordinates. The epithet is kept in front
// of the name because the bounty board shows both, and searching either finds it.
const BOUNTIES = [
  ['Amateur Hunter Hawk (Lv 12)', 52, -513],
  ['Attention-Seeking Monster Dazzle (Lv 56)', -845, -1281],
  ['Black Magic Fanatic Shadow (Lv 41)', -432, -453],
  ['Blundering Klutz Fumble (Lv 28)', 162, -2],
  ['Bounty Hunter Hunter Turncoat (Lv 15)', -2, -386],
  ['Cannibal Gnaw (Lv 57)', -740, -1003],
  ['Cattle Rustler Lasso (Lv 21)', -67, -203],
  ['Chronic Spoiler Whisper (Lv 37)', 413, 590],
  ['Counterfeiter Mimic (Lv 57)', -1193, -1707],
  ['Dango Thief Nimble (Lv 52)', -524, 105],
  ['Dine-and-Dasher Scoot (Lv 10)', -20, -461],
  ['Escape Artist Phantom (Lv 36)', 533, 133],
  ['Gloating Narcissist Ego (Lv 23)', -12, -88],
  ['Horse Rustler Billy (Lv 57)', -1080, -904],
  ['Hostile Defender Brick (Lv 30)', 76, 96],
  ['Human Collector Cache (Lv 58)', -1387, -1485],
  ['Insurance Fraudster Crash (Lv 15)', -290, -622],
  ['Intimidating Interviewer Grill (Lv 20)', -265, -258],
  ['Kidnapper Whisk (Lv 45)', -9, 292],
  ['Pineapple Pizza Enthusiast Aloha (Lv 39)', -592, -235],
  ['Prolific Smoker Dart (Lv 23)', 261, -218],
  ['Pyromaniac Flare (Lv 38)', -520, -755],
  ['Scam Artist Jade (Lv 19)', -323, -117],
  ['Serial Borrower Pinch (Lv 57)', -1173, -1226],
  ['Serial Cheater Siren (Lv 16)', -266, -394],
  ['Serial Embezzler Skim (Lv 42)', -91, 145],
  ['Street Assassin Urchin (Lv 53)', -674, 230],
  ['Trigger-Happy Gunslinger Clint (Lv 49)', -362, 318],
  ['Twin Bombers Dyna (Lv 26)', 349, -6],
  ['Twin Bombers Mite (Lv 26)', 349, -2],
  ['Uninvited Guest Ram (Lv 59)', -1237, -1183],
  ['Well-Meaning Quack Quill (Lv 43)', -195, 481],
  ['Workplace Tyrant Whip (Lv 40)', 320, 370],
];

const toSav = (mx, my) => ({ x: my * 459 - 123888, y: mx * 459 + 158000 });

const path = 'app/data/markers.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

data.markers = data.markers.filter(m => m.category !== 'bounty');

BOUNTIES.forEach(([label, mx, my], i) => {
  const key = `bounty_${i + 1}`;
  const { x, y } = toSav(mx, my);
  data.markers.push({ id: `bounty:${key}`, category: 'bounty', key, label, x, y, z: 0 });
});

if (!data.categories.some(c => c.id === 'bounty')) {
  data.categories.push({ id: 'bounty', name: 'Bounty', saveFlag: null, reference: true });
}

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log(`added ${BOUNTIES.length} bounty targets`);
