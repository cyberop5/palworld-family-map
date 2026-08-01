// rename-bosses.mjs — give alpha pals and caged bosses their real Paldeck names.
//
// merge-bosses.mjs derives a label from the Pal's internal code name
// (T_GrassMammoth_icon_normal.png -> "Grass Mammoth"), which is a placeholder,
// not what the game shows the player. This maps every code name that appears in
// the data to its Paldeck display name and rewrites the labels, keeping the
// "(Lv N)" suffix.
//
// The mapping was compiled from the Palworld wiki internal-names table and the
// oMaN-Rod/palworld-save-pal English localization data, and cross-checked against
// known anchors. Four of the newest Pals aren't in any accessible datamine yet;
// they keep a cleaned descriptive name (see UNVERIFIED below) rather than a
// guessed Paldeck name. Re-run any time: it reads the code name from each
// marker's icon, so it's idempotent.

import fs from 'node:fs';

const NAMES = {
  AmaterasuWolf: 'Kitsun',
  AmaterasuWolf_Dark: 'Kitsun Noct',
  Anubis: 'Anubis',
  BadCatgirl: 'Nyafia',
  BerryGoat_Dark: 'Caprity Noct',
  BlackMetalDragon: 'Astegon',
  BlackPuppy: 'Smokie',
  BlueberryFairy: 'Prunelia',
  BlueDragon: 'Azurobe',
  BlueThunderHorse: 'Azurmane',
  CactusDoll: 'Needoll',
  CaptainPenguin: 'Penking',
  CubeTurtle: 'Tetroise',
  CubeTurtle_Neutral: 'Tetroise Primo',
  DarkScorpion: 'Menasting',
  DarkScorpion_Ground: 'Menasting Terra',
  DomeArmorDragon: 'Aegidron',
  ElecLizard: 'Slowatt',
  ElecPanda: 'Grizzbolt',
  ElecSnail: 'Snock',
  FairyDragon: 'Elphidran',
  FengyunDeeper: 'Fenglope',
  FengyunDeeper_Electric: 'Fenglope Lux',
  FlameBuffalo: 'Arsox',
  FlowerDinosaur_Electric: 'Dinossom Lux',
  FoxExorcist: 'Flaracle',
  FoxMage: 'Wixen',
  GhostDragon: 'Eidrolon',
  GhostRabbit: 'Nitemary',
  GoldenHorse: 'Gildane',
  GrassGolem: 'Dualith',
  GrassGolem_Dark: 'Dualith Noct',
  GrassMammoth: 'Mammorest',
  GrassPanda_Electric: 'Mossanda Lux',
  GrassRabbitMan: 'Verdash',
  GrimGirl: 'Splatterina',
  HawkBird: 'Nitewing',
  HerculesBeetle_Ground: 'Warsect Terra',
  Horus_Water: 'Faleris Aqua',
  IceFox: 'Foxcicle',
  IceHorse: 'Frostallion',
  IceHorse_Dark: 'Frostallion Noct',
  IceNarwhal: 'Whalaska',
  IceNarwhal_Fire: 'Whalaska Ignis',
  JetDragon: 'Jetragon',
  KabukiMan: 'Renjishi',
  KingAlpaca: 'Kingpaca',
  KingAlpaca_Ice: 'Kingpaca Cryst',
  KingBahamut: 'Blazamut',
  Kirin: 'Univolt',
  Kitsunebi_Ice: 'Foxparks Cryst',
  LazyCatfish: 'Dumud',
  LilyQueen: 'Lyleen',
  LilyQueen_Dark: 'Lyleen Noct',
  LotusDragon: 'Ophydia',
  Manticore: 'Blazehowl',
  MoonChild: 'Wistella',
  MopKing: 'Sweepa',
  MushroomLady: 'Mycora',
  Mutant: 'Lunaris',
  MysteryMask: 'Omascul',
  NaughtyCat: 'Grintale',
  NightBlueHorse: 'Starryon',
  PlantSlime: 'Gumoss',
  PurpleSpider: 'Tarantriss',
  QueenBee: 'Elizabee',
  Ronin: 'Bushi',
  SaintCentaur: 'Paladius',
  SakuraSaurus: 'Broncherry',
  Suzaku: 'Suzaku',
  ThunderBird: 'Beakon',
  Umihebi: 'Jormuntide',
  VioletFairy: 'Vaelet',
  VolcanicMonster: 'Reptyro',
  VolcanoDragon: 'Moldron',
  WeaselDragon: 'Chillet',
  Werewolf_Ice: 'Loupmoon Cryst',
  WhiteMoth: 'Sibelyx',
  WhiteShieldDragon: 'Silvegis',
  WingGolem: 'Knocklem',
  Yeti_Grass: 'Wumpo Botan',

  // Confirmed base species, but the specific elemental variant's Paldeck name
  // isn't in the datamine used, so these show the base species name.
  RaijinDaughter_Water: 'Dazzi',
  ScorpionMan_Electric: 'Prixter',
  VolcanoDragon_Ice: 'Moldron',
  WhiteTiger_Ground: 'Cryolinx',

  // UNVERIFIED — not present in any accessible datamine (newest Pals). Cleaned
  // descriptive names, not Paldeck names. Update when a source lists them.
  PoseidonOrca: 'Poseidon Orca',
  RockBeast: 'Rock Beast',
  ThunderFluffyBird: 'Thunder Fluffy Bird',
  WhiteDeer: 'White Deer',
  WhiteDeer_Dark: 'White Deer (Dark)',
};

const path = 'app/data/markers.json';
const m = JSON.parse(fs.readFileSync(path, 'utf8'));

const codeOf = icon =>
  icon ? icon.replace(/^T_/, '').replace(/_icon_normal\.png$/, '') : null;

let renamed = 0;
const unmapped = new Set();
for (const x of m.markers) {
  if (x.category !== 'alphaPal' && x.category !== 'cagedBoss') continue;
  const code = codeOf(x.icon);
  const name = NAMES[code];
  if (!name) { if (code) unmapped.add(code); continue; }
  const lv = (x.label.match(/\(Lv\s*\d+\)/) || [''])[0];
  x.label = lv ? `${name} ${lv}` : name;
  renamed++;
}

fs.writeFileSync(path, JSON.stringify(m, null, 2));
console.log(`renamed ${renamed} boss markers`);
console.log('unmapped code names:', unmapped.size ? [...unmapped].join(', ') : 'none');
