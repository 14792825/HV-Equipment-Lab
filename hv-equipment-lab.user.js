// ==UserScript==
// @name         HV Equipment Lab
// @namespace    hv-equipment-lab
// @version      1.0.0
// @description  Compare equipment and preview Peerless, Soulbind, Forging, Item World, and Charms.
// @match        https://hentaiverse.org/equip/*
// @match        https://hentaiverse.org/isekai/equip/*
// @match        https://alt.hentaiverse.org/equip/*
// @match        https://alt.hentaiverse.org/isekai/equip/*
// @run-at       document-end
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const tierPattern = /\bTier\s*:?\s*(\d+)(?:\+\d+)?\s*\/\s*(\d+)(?:\+\d+)?\s*\/\s*(\d+)/i;
  const currentVersionMarkers = /^(?:Dropped by\b|Rewarded as a Clear Bonus\b|Rewarded from Snowflake's Shrine\b|Transferred from Isekai\b|掉落于|作为竞技场通关奖励给予|作为雪花祭坛献祭奖励给予|从异世界中转移获得)/i;
  const qualities = /^(Flimsy|Crude|Fair|Average|Fine|Superior|Exquisite|Magnificent|Legendary|Peerless\+?|Ultimate)\s+/i;
  const elements = ['Fire', 'Cold', 'Elec', 'Wind', 'Holy', 'Dark'];
  const nativeStrikes = {
    fiery: 'Fire', arctic: 'Cold', shocking: 'Elec', tempestuous: 'Wind',
    hallowed: 'Holy', demonic: 'Dark', ethereal: 'Void', astral: 'Soul',
  };
  const damageStats = new Set(['Physical Damage', 'Magic Damage']);
  const avgNative = new Set(['Burden', 'Interference']);
  const elementalMitigation = /^Damage Mitigation\/(?:Fire|Cold|Elec|Wind|Holy|Dark)$/;
  const physicalDamageRow = /^([+-]?\s*[\d,.]+)(%|\s*\+\s*[\d,.]+)?\s+(?:Slashing|Crushing|Piercing|Void|Physical|Attack) Damage\b/i;
  const statKey = (group, name) => `${group}/${name}`;
  const equipKey = name => statKey('Equipment', name);
  const rate = key => damageStats.has(key.split('/')[1]) ? 0.02 : 0.01;
  const clean = value => (value ?? '').replace(/\s+/g, ' ').trim();
  const number = /^[+-]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/;
  const upgradeCaps = { exquisite: 15, magnificent: 20, legendary: 25, peerless: 30, ultimate: 33 };
  const peerlessBase = 200;
  // EHWiki, Detailed Equip Characteristics: minimum rolls by quality.
  const minimumLegacyAffixBase = {
    crude: 0, fair: 30, average: 60, superior: 90,
    exquisite: 120, magnificent: 150, legendary: 170, peerless: peerlessBase,
    'peerless+': 201, ultimate: 250,
  };
  // The Ultimate reference panel fits Base 225.2 in the curves calibrated through Base 200.
  const abovePeerlessScale = (225.2 - peerlessBase) / (250 - peerlessBase);
  const effectiveBase = base => base <= peerlessBase ? base : peerlessBase + (base - peerlessBase) * abovePeerlessScale;
  const displayedBase = base => base <= peerlessBase ? base : peerlessBase + (base - peerlessBase) / abovePeerlessScale;
  const qualityPreviews = [
    { quality: 'Peerless', base: peerlessBase, cap: upgradeCaps.peerless },
    ...[210, 220, 230, 240].map(base => ({
      quality: 'Peerless+', equipmentQuality: 'Peerless', base, cap: upgradeCaps.peerless,
    })),
    { quality: 'Ultimate', base: 250, cap: upgradeCaps.ultimate },
  ];
  const vitalAliases = [
    /^(?:(?:max(?:imum)? )?hp(?: bonus)?|health(?: bonus)?|hit points)$/i,
    /^(?:(?:max(?:imum)? )?mp(?: bonus)?|mana(?: bonus)?|magic points)$/i,
  ];
  const elementLabel = element => element === 'Elec' ? 'Lightning' : element;
  const strikeCharms = Object.fromEntries(elements.map(element => [`${elementLabel(element)} Strike`, element]));
  const meleeCharms = ['Hollowforged', 'Voidseeker', 'Butcher', 'Swiftness', 'Fatality', 'Overpower', ...Object.keys(strikeCharms)];
  const magicCharms = ['Archmage', 'Economizer', 'Spellweaver', 'Annihilator', 'Penetrator', 'Aether'];
  const defenseCharms = ['Juggernaut', 'Capacitor', ...elements.map(element => `${elementLabel(element)}-proof`)];
  const charmLabel = (name, quality) => `${name} (${quality === 2 ? 'Greater' : 'Lesser'})`;
  const accuracyMultiplier = quality => quality === 2 ? 1.30 : 1.20;

  // BEGIN GENERATED EQUIPMENT DATA
  // Run python fit-results/build_userscript.py after updating coefficients.json.
  const exponent = 1.5261079567468716;
  const equipmentTypes = {
    "Axe": ["One-handed Weapon",""],
    "Buckler": ["Shield","Shield"],
    "Chain Cuirass": ["Heavy Armor","Body"],
    "Chain Gauntlets": ["Heavy Armor","Hands"],
    "Chain Greaves": ["Heavy Armor","Legs"],
    "Chain Helmet": ["Heavy Armor","Head"],
    "Chain Sabatons": ["Heavy Armor","Feet"],
    "Chainmail Boots": ["Heavy Armor","Feet","Chain Sabatons"],
    "Chainmail Chausses": ["Heavy Armor","Legs","Chain Greaves"],
    "Chainmail Coif": ["Heavy Armor","Head","Chain Helmet"],
    "Chainmail Hauberk": ["Heavy Armor","Body","Chain Cuirass"],
    "Chainmail Mitons": ["Heavy Armor","Hands","Chain Gauntlets"],
    "Club": ["One-handed Weapon",""],
    "Cotton Cap": ["Cloth Armor","Head"],
    "Cotton Gloves": ["Cloth Armor","Hands"],
    "Cotton Pants": ["Cloth Armor","Legs"],
    "Cotton Robe": ["Cloth Armor","Body"],
    "Cotton Shoes": ["Cloth Armor","Feet"],
    "Dagger": ["One-handed Weapon",""],
    "Drakehide Boots": ["Light Armor","Feet"],
    "Drakehide Breastplate": ["Light Armor","Body"],
    "Drakehide Gauntlets": ["Light Armor","Hands"],
    "Drakehide Helmet": ["Light Armor","Head"],
    "Drakehide Leggings": ["Light Armor","Legs"],
    "Ebony Staff": ["Staff",""],
    "Estoc": ["Two-handed Weapon",""],
    "Force Shield": ["Shield","Shield"],
    "Gossamer Cap": ["Cloth Armor","Head"],
    "Gossamer Gloves": ["Cloth Armor","Hands"],
    "Gossamer Pants": ["Cloth Armor","Legs"],
    "Gossamer Robe": ["Cloth Armor","Body"],
    "Gossamer Shoes": ["Cloth Armor","Feet"],
    "Great Mace": ["Two-handed Weapon",""],
    "Ironsilk Cap": ["Cloth Armor","Head"],
    "Ironsilk Gloves": ["Cloth Armor","Hands"],
    "Ironsilk Pants": ["Cloth Armor","Legs"],
    "Ironsilk Robe": ["Cloth Armor","Body"],
    "Ironsilk Shoes": ["Cloth Armor","Feet"],
    "Katalox Staff": ["Staff",""],
    "Katana": ["Two-handed Weapon",""],
    "Kevlar Boots": ["Light Armor","Feet"],
    "Kevlar Breastplate": ["Light Armor","Body"],
    "Kevlar Gauntlets": ["Light Armor","Hands"],
    "Kevlar Helmet": ["Light Armor","Head"],
    "Kevlar Leggings": ["Light Armor","Legs"],
    "Kite Shield": ["Shield","Shield"],
    "Leather Boots": ["Light Armor","Feet"],
    "Leather Breastplate": ["Light Armor","Body"],
    "Leather Gauntlets": ["Light Armor","Hands"],
    "Leather Helmet": ["Light Armor","Head"],
    "Leather Leggings": ["Light Armor","Legs"],
    "Longsword": ["Two-handed Weapon",""],
    "Mace": ["Two-handed Weapon","","Great Mace"],
    "Oak Staff": ["Staff",""],
    "Phase Cap": ["Cloth Armor","Head"],
    "Phase Gloves": ["Cloth Armor","Hands"],
    "Phase Pants": ["Cloth Armor","Legs"],
    "Phase Robe": ["Cloth Armor","Body"],
    "Phase Shoes": ["Cloth Armor","Feet"],
    "Plate Cuirass": ["Heavy Armor","Body"],
    "Plate Gauntlets": ["Heavy Armor","Hands"],
    "Plate Greaves": ["Heavy Armor","Legs"],
    "Plate Helmet": ["Heavy Armor","Head"],
    "Plate Sabatons": ["Heavy Armor","Feet"],
    "Power Armor": ["Heavy Armor","Body"],
    "Power Boots": ["Heavy Armor","Feet"],
    "Power Gauntlets": ["Heavy Armor","Hands"],
    "Power Helmet": ["Heavy Armor","Head"],
    "Power Leggings": ["Heavy Armor","Legs"],
    "Rapier": ["One-handed Weapon",""],
    "Reactive Cuirass": ["Heavy Armor","Body"],
    "Reactive Gauntlets": ["Heavy Armor","Hands"],
    "Reactive Greaves": ["Heavy Armor","Legs"],
    "Reactive Helmet": ["Heavy Armor","Head"],
    "Reactive Sabatons": ["Heavy Armor","Feet"],
    "Redwood Staff": ["Staff",""],
    "Scythe": ["Two-handed Weapon",""],
    "Shade Boots": ["Light Armor","Feet"],
    "Shade Breastplate": ["Light Armor","Body"],
    "Shade Gauntlets": ["Light Armor","Hands"],
    "Shade Helmet": ["Light Armor","Head"],
    "Shade Leggings": ["Light Armor","Legs"],
    "Shortsword": ["One-handed Weapon",""],
    "Sword Chucks": ["Two-handed Weapon","","Swordchucks"],
    "Swordchucks": ["Two-handed Weapon",""],
    "Tower Shield": ["Shield","Shield"],
    "Wakizashi": ["One-handed Weapon",""],
    "Willow Staff": ["Staff",""],
  };
  const prefixEffects = {
    "agile": ["Equipment/Attack Speed"],
    "amber": ["Damage Mitigation/Elec"],
    "arctic": ["Equipment/Cold Strike","Spell Damage/Cold"],
    "astral": [],
    "charged": ["Equipment/Casting Speed"],
    "cobalt": ["Damage Mitigation/Cold"],
    "demonic": ["Equipment/Dark Strike","Spell Damage/Dark"],
    "ethereal": ["Equipment/Burden","Equipment/Interference"],
    "fiery": ["Equipment/Fire Strike","Spell Damage/Fire"],
    "frugal": ["Equipment/Mana Conservation"],
    "hallowed": ["Equipment/Holy Strike","Spell Damage/Holy"],
    "jade": ["Damage Mitigation/Wind"],
    "mithril": ["Equipment/Burden"],
    "mystic": ["Equipment/Magic Crit Damage"],
    "onyx": ["Damage Mitigation/Dark"],
    "quintessential": [],
    "radiant": ["Equipment/Magic Damage"],
    "reinforced": ["Damage Mitigation/Crushing","Damage Mitigation/Piercing","Damage Mitigation/Slashing"],
    "ruby": ["Damage Mitigation/Fire"],
    "savage": ["Equipment/Attack Crit Damage"],
    "shielding": ["Equipment/Block"],
    "shocking": ["Equipment/Elec Strike","Spell Damage/Elec"],
    "tempestuous": ["Equipment/Wind Strike","Spell Damage/Wind"],
    "zircon": ["Damage Mitigation/Holy"],
  };
  const suffixEffects = {
    "arcanist": ["Equipment/Magic Accuracy","Primary Attributes/Intelligence","Primary Attributes/Wisdom","Equipment/Interference"],
    "balance": ["Equipment/Attack Accuracy","Equipment/Attack Crit Damage"],
    "banshee": ["Equipment/Siphon Spirit"],
    "barrier": ["Equipment/Block"],
    "battlecaster": ["Equipment/Interference","Equipment/Magic Accuracy","Equipment/Mana Conservation"],
    "cheetah": ["Primary Attributes/Agility"],
    "curse-weaver": ["Proficiency/Deprecating"],
    "dampening": ["Damage Mitigation/Crushing"],
    "deflection": ["Damage Mitigation/Piercing"],
    "demon-fiend": ["Proficiency/Forbidden"],
    "destruction": ["Equipment/Magic Damage"],
    "earth-walker": ["Proficiency/Supportive"],
    "elementalist": ["Proficiency/Elemental"],
    "fenrir": ["Spell Damage/Dark"],
    "fire-eater": ["Damage Mitigation/Fire"],
    "fleet": ["Equipment/Evade"],
    "focus": ["Equipment/Magic Accuracy","Equipment/Magic Crit Damage","Equipment/Mana Conservation"],
    "fox": ["Primary Attributes/Intelligence"],
    "freyr": ["Spell Damage/Wind"],
    "frost-born": ["Damage Mitigation/Cold"],
    "heaven-sent": ["Proficiency/Divine"],
    "heimdall": ["Spell Damage/Holy"],
    "illithid": ["Equipment/Siphon Magic","Equipment/Siphon Mana"],
    "mjolnir": ["Spell Damage/Elec"],
    "negation": ["Equipment/Resist"],
    "niflheim": ["Spell Damage/Cold"],
    "nimble": ["Equipment/Parry"],
    "owl": ["Primary Attributes/Wisdom"],
    "ox": ["Primary Attributes/Strength"],
    "protection": ["Equipment/Physical Mitigation"],
    "raccoon": ["Primary Attributes/Dexterity"],
    "shadowdancer": ["Equipment/Attack Crit Damage","Equipment/Evade"],
    "slaughter": ["Equipment/Physical Damage"],
    "spirit-ward": ["Damage Mitigation/Dark"],
    "stoneskin": ["Damage Mitigation/Slashing"],
    "surtr": ["Spell Damage/Fire"],
    "swiftness": ["Equipment/Attack Speed"],
    "thrice-blessed": ["Damage Mitigation/Holy"],
    "thunder-child": ["Damage Mitigation/Elec"],
    "turtle": ["Primary Attributes/Endurance"],
    "vampire": ["Equipment/Siphon Health"],
    "warding": ["Equipment/Magical Mitigation"],
    "wind-waker": ["Damage Mitigation/Wind"],
  };
  const affixEffects = [prefixEffects, suffixEffects];
  const loadMultipliers = {
    "p:ethereal/Equipment/Burden": 0,
    "p:ethereal/Equipment/Interference": 0,
    "p:mithril/Equipment/Burden": 0.75,
    "s:arcanist/Equipment/Interference": 0.25,
    "s:battlecaster/Equipment/Interference": 0,
  };
  const slotMultiplier = {
    "Body": 1.2,
    "Feet": 0.8,
    "Hands": 0.9,
    "Head": 1.0,
    "Legs": 1.1,
    "Shield": 1,
  };
  const sharedAffixCoefficients = {
    "Armor Evade suffix": [4.921584545718686,0.0012855197009907899,0.005],
    "Armor elemental mitigation": [9.958981221957398,0.004660779589902906,0.0],
    "Elemental spell damage suffix": [8.574714509368727,0.00268188306848483,0.00502],
    "Physical mitigation suffix by damage type": [2.2249667603758656,0.0013978979099233766,0.0],
    "Proficiency suffix": [4.0146709582641105,0.0012550148795762426,0.0282],
    "Single primary attribute suffix": [1.5471930502408537,0.00048778021962512,0.02824],
    "Weapon elemental prefix": [6.013632169991573,0.0016170179257197206,0.00502],
    "agile Attack Speed": [0.745764507391605,0.0007865033701811923,0.0],
    "arcanist Intelligence and Wisdom": [1.5488440813547597,0.00048714741900083387,0.02824],
    "arcanist Magic Accuracy": [3.42729177685533,0.0009209925666323676,0.02],
    "balance Attack Accuracy": [4.555098837588191,0.0023722235790159005,0.02],
    "balance Attack Crit Damage": [0.0767003503477136,3.5184006544814035e-05,0.0],
    "barrier Block (armor)": [4.04671960338186,0.0013364145460800776,0.005],
    "barrier Block (shield)": [9.965753249290547,0.005041927054393794,0.005],
    "battlecaster Magic Accuracy": [6.10363323435925,0.0019075258902158435,0.02],
    "battlecaster Mana Conservation (armor)": [2.508681634076736,0.000798587967990047,0.0],
    "battlecaster Mana Conservation (weapon)": [12.452479431945699,0.0038936031229917013,0.0],
    "charged Casting Speed": [1.0096625228910154,0.0006279234986698437,0.0],
    "destruction Magic Damage": [4.183080879677366,0.003972273144873374,0.044],
    "focus Magic Accuracy": [3.6449733162457436,0.0019102436403921825,0.02],
    "focus Magic Crit Damage": [0.042291278507603836,3.661383576121563e-05,0.0],
    "focus Mana Conservation": [9.890169403043178,0.006837221996629936,0.0],
    "frugal Mana Conservation": [1.531267715097715,0.00048312069531115557,0.0],
    "mystic Magic Crit Damage": [0.10775593003315918,2.5200961432991433e-05,0.0],
    "negation Resist": [19.749510968331386,0.004987496005553518,0.005],
    "nimble Parry": [19.889154964526846,0.004997190660396338,0.005],
    "protection Physical Mitigation": [0.8251341062716526,0.0007874315626327557,0.0005],
    "radiant Magic Damage": [1.2885628407066805,0.0006762553398375206,0.044],
    "reinforced physical mitigation": [1.1373992956439083,0.000577096152612281,0.0],
    "savage Attack Crit Damage": [0.08309817184200108,2.072715069602001e-05,0.0],
    "shadowdancer Attack Crit Damage": [0.0635915541407203,1.90689058009426e-05,0.0],
    "shielding Block": [6.042137708600141,0.004404254821280085,0.005],
    "slaughter Physical Damage (armor)": [2.1375146528878206,0.0006766182611467146,0.06024],
    "slaughter Physical Damage (weapon)": [4.195101974309253,0.0052754869272813145,0.06024],
    "swiftness Attack Speed": [2.500741133341901,0.0011695828134474725,0.0],
    "warding Magical Mitigation": [1.380826672290441,0.001305253577081317,0.0005],
  };
  const sharedAffixRules = {
    "Axe": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:ox/Primary Attributes/Strength": "Single primary attribute suffix",
      "s:raccoon/Primary Attributes/Dexterity": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
    },
    "Buckler": {
      "p:agile/Equipment/Attack Speed": "agile Attack Speed",
      "p:reinforced/Damage Mitigation/Crushing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Piercing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Slashing": "reinforced physical mitigation",
      "s:barrier/Equipment/Block": "barrier Block (shield)",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:fleet/Equipment/Evade": "Armor Evade suffix",
      "s:nimble/Equipment/Parry": "nimble Parry",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:turtle/Primary Attributes/Endurance": "Single primary attribute suffix",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
    },
    "Chain": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:reinforced/Damage Mitigation/Crushing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Piercing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Slashing": "reinforced physical mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:dampening/Damage Mitigation/Crushing": "Physical mitigation suffix by damage type",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:fire-eater/Damage Mitigation/Fire": "Armor elemental mitigation",
      "s:frost-born/Damage Mitigation/Cold": "Armor elemental mitigation",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:spirit-ward/Damage Mitigation/Dark": "Armor elemental mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:thrice-blessed/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:thunder-child/Damage Mitigation/Elec": "Armor elemental mitigation",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
      "s:wind-waker/Damage Mitigation/Wind": "Armor elemental mitigation",
    },
    "Club": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:cheetah/Primary Attributes/Agility": "Single primary attribute suffix",
      "s:nimble/Equipment/Parry": "nimble Parry",
      "s:raccoon/Primary Attributes/Dexterity": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
      "s:swiftness/Equipment/Attack Speed": "swiftness Attack Speed",
    },
    "Cotton": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:charged/Equipment/Casting Speed": "charged Casting Speed",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:frugal/Equipment/Mana Conservation": "frugal Mana Conservation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:curse-weaver/Proficiency/Deprecating": "Proficiency suffix",
      "s:demon-fiend/Proficiency/Forbidden": "Proficiency suffix",
      "s:earth-walker/Proficiency/Supportive": "Proficiency suffix",
      "s:elementalist/Proficiency/Elemental": "Proficiency suffix",
      "s:fire-eater/Damage Mitigation/Fire": "Armor elemental mitigation",
      "s:frost-born/Damage Mitigation/Cold": "Armor elemental mitigation",
      "s:heaven-sent/Proficiency/Divine": "Proficiency suffix",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:spirit-ward/Damage Mitigation/Dark": "Armor elemental mitigation",
      "s:thrice-blessed/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:thunder-child/Damage Mitigation/Elec": "Armor elemental mitigation",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
      "s:wind-waker/Damage Mitigation/Wind": "Armor elemental mitigation",
    },
    "Dagger": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:cheetah/Primary Attributes/Agility": "Single primary attribute suffix",
      "s:focus/Equipment/Magic Accuracy": "focus Magic Accuracy",
      "s:focus/Equipment/Magic Crit Damage": "focus Magic Crit Damage",
      "s:focus/Equipment/Mana Conservation": "focus Mana Conservation",
      "s:nimble/Equipment/Parry": "nimble Parry",
      "s:raccoon/Primary Attributes/Dexterity": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
      "s:swiftness/Equipment/Attack Speed": "swiftness Attack Speed",
    },
    "Drakehide": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (armor)",
      "s:dampening/Damage Mitigation/Crushing": "Physical mitigation suffix by damage type",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:fire-eater/Damage Mitigation/Fire": "Armor elemental mitigation",
      "s:frost-born/Damage Mitigation/Cold": "Armor elemental mitigation",
      "s:negation/Equipment/Resist": "negation Resist",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:spirit-ward/Damage Mitigation/Dark": "Armor elemental mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:thrice-blessed/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:thunder-child/Damage Mitigation/Elec": "Armor elemental mitigation",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
      "s:wind-waker/Damage Mitigation/Wind": "Armor elemental mitigation",
    },
    "Ebony Staff": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:demon-fiend/Proficiency/Forbidden": "Proficiency suffix",
      "s:destruction/Equipment/Magic Damage": "destruction Magic Damage",
      "s:elementalist/Proficiency/Elemental": "Proficiency suffix",
      "s:fenrir/Spell Damage/Dark": "Elemental spell damage suffix",
      "s:focus/Equipment/Magic Accuracy": "focus Magic Accuracy",
      "s:focus/Equipment/Magic Crit Damage": "focus Magic Crit Damage",
      "s:focus/Equipment/Mana Conservation": "focus Mana Conservation",
      "s:fox/Primary Attributes/Intelligence": "Single primary attribute suffix",
      "s:freyr/Spell Damage/Wind": "Elemental spell damage suffix",
      "s:heaven-sent/Proficiency/Divine": "Proficiency suffix",
      "s:heimdall/Spell Damage/Holy": "Elemental spell damage suffix",
      "s:mjolnir/Spell Damage/Elec": "Elemental spell damage suffix",
      "s:niflheim/Spell Damage/Cold": "Elemental spell damage suffix",
      "s:owl/Primary Attributes/Wisdom": "Single primary attribute suffix",
      "s:surtr/Spell Damage/Fire": "Elemental spell damage suffix",
    },
    "Estoc": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:ox/Primary Attributes/Strength": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
    },
    "Force Shield": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:dampening/Damage Mitigation/Crushing": "Physical mitigation suffix by damage type",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:turtle/Primary Attributes/Endurance": "Single primary attribute suffix",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
    },
    "Gossamer": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:curse-weaver/Proficiency/Deprecating": "Proficiency suffix",
      "s:demon-fiend/Proficiency/Forbidden": "Proficiency suffix",
      "s:earth-walker/Proficiency/Supportive": "Proficiency suffix",
      "s:elementalist/Proficiency/Elemental": "Proficiency suffix",
      "s:fox/Primary Attributes/Intelligence": "Single primary attribute suffix",
      "s:heaven-sent/Proficiency/Divine": "Proficiency suffix",
      "s:owl/Primary Attributes/Wisdom": "Single primary attribute suffix",
    },
    "Great Mace": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:ox/Primary Attributes/Strength": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
    },
    "Ironsilk": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:reinforced/Damage Mitigation/Crushing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Piercing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Slashing": "reinforced physical mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:cheetah/Primary Attributes/Agility": "Single primary attribute suffix",
      "s:fleet/Equipment/Evade": "Armor Evade suffix",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:raccoon/Primary Attributes/Dexterity": "Single primary attribute suffix",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
    },
    "Katalox Staff": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:demon-fiend/Proficiency/Forbidden": "Proficiency suffix",
      "s:destruction/Equipment/Magic Damage": "destruction Magic Damage",
      "s:fenrir/Spell Damage/Dark": "Elemental spell damage suffix",
      "s:focus/Equipment/Magic Accuracy": "focus Magic Accuracy",
      "s:focus/Equipment/Magic Crit Damage": "focus Magic Crit Damage",
      "s:focus/Equipment/Mana Conservation": "focus Mana Conservation",
      "s:fox/Primary Attributes/Intelligence": "Single primary attribute suffix",
      "s:heaven-sent/Proficiency/Divine": "Proficiency suffix",
      "s:heimdall/Spell Damage/Holy": "Elemental spell damage suffix",
      "s:owl/Primary Attributes/Wisdom": "Single primary attribute suffix",
    },
    "Katana": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:ox/Primary Attributes/Strength": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
    },
    "Kevlar": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:reinforced/Damage Mitigation/Crushing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Piercing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Slashing": "reinforced physical mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (armor)",
      "s:dampening/Damage Mitigation/Crushing": "Physical mitigation suffix by damage type",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:fire-eater/Damage Mitigation/Fire": "Armor elemental mitigation",
      "s:frost-born/Damage Mitigation/Cold": "Armor elemental mitigation",
      "s:negation/Equipment/Resist": "negation Resist",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:spirit-ward/Damage Mitigation/Dark": "Armor elemental mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:thrice-blessed/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:thunder-child/Damage Mitigation/Elec": "Armor elemental mitigation",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
      "s:wind-waker/Damage Mitigation/Wind": "Armor elemental mitigation",
    },
    "Kite Shield": {
      "p:agile/Equipment/Attack Speed": "agile Attack Speed",
      "p:reinforced/Damage Mitigation/Crushing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Piercing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Slashing": "reinforced physical mitigation",
      "s:barrier/Equipment/Block": "barrier Block (shield)",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:dampening/Damage Mitigation/Crushing": "Physical mitigation suffix by damage type",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:turtle/Primary Attributes/Endurance": "Single primary attribute suffix",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
    },
    "Leather": {
      "p:agile/Equipment/Attack Speed": "agile Attack Speed",
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:reinforced/Damage Mitigation/Crushing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Piercing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Slashing": "reinforced physical mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:dampening/Damage Mitigation/Crushing": "Physical mitigation suffix by damage type",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:fire-eater/Damage Mitigation/Fire": "Armor elemental mitigation",
      "s:frost-born/Damage Mitigation/Cold": "Armor elemental mitigation",
      "s:negation/Equipment/Resist": "negation Resist",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:spirit-ward/Damage Mitigation/Dark": "Armor elemental mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:thrice-blessed/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:thunder-child/Damage Mitigation/Elec": "Armor elemental mitigation",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
      "s:wind-waker/Damage Mitigation/Wind": "Armor elemental mitigation",
    },
    "Longsword": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:ox/Primary Attributes/Strength": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
    },
    "Oak Staff": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:destruction/Equipment/Magic Damage": "destruction Magic Damage",
      "s:earth-walker/Proficiency/Supportive": "Proficiency suffix",
      "s:focus/Equipment/Magic Accuracy": "focus Magic Accuracy",
      "s:focus/Equipment/Magic Crit Damage": "focus Magic Crit Damage",
      "s:focus/Equipment/Mana Conservation": "focus Mana Conservation",
      "s:fox/Primary Attributes/Intelligence": "Single primary attribute suffix",
      "s:heimdall/Spell Damage/Holy": "Elemental spell damage suffix",
      "s:owl/Primary Attributes/Wisdom": "Single primary attribute suffix",
    },
    "Phase": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:charged/Equipment/Casting Speed": "charged Casting Speed",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:frugal/Equipment/Mana Conservation": "frugal Mana Conservation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:mystic/Equipment/Magic Crit Damage": "mystic Magic Crit Damage",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:radiant/Equipment/Magic Damage": "radiant Magic Damage",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:cheetah/Primary Attributes/Agility": "Single primary attribute suffix",
      "s:curse-weaver/Proficiency/Deprecating": "Proficiency suffix",
      "s:demon-fiend/Proficiency/Forbidden": "Proficiency suffix",
      "s:earth-walker/Proficiency/Supportive": "Proficiency suffix",
      "s:elementalist/Proficiency/Elemental": "Proficiency suffix",
      "s:fenrir/Spell Damage/Dark": "Elemental spell damage suffix",
      "s:fox/Primary Attributes/Intelligence": "Single primary attribute suffix",
      "s:freyr/Spell Damage/Wind": "Elemental spell damage suffix",
      "s:heaven-sent/Proficiency/Divine": "Proficiency suffix",
      "s:heimdall/Spell Damage/Holy": "Elemental spell damage suffix",
      "s:mjolnir/Spell Damage/Elec": "Elemental spell damage suffix",
      "s:niflheim/Spell Damage/Cold": "Elemental spell damage suffix",
      "s:owl/Primary Attributes/Wisdom": "Single primary attribute suffix",
      "s:raccoon/Primary Attributes/Dexterity": "Single primary attribute suffix",
      "s:surtr/Spell Damage/Fire": "Elemental spell damage suffix",
    },
    "Plate": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:shielding/Equipment/Block": "shielding Block",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:dampening/Damage Mitigation/Crushing": "Physical mitigation suffix by damage type",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:fire-eater/Damage Mitigation/Fire": "Armor elemental mitigation",
      "s:frost-born/Damage Mitigation/Cold": "Armor elemental mitigation",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:spirit-ward/Damage Mitigation/Dark": "Armor elemental mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:thrice-blessed/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:thunder-child/Damage Mitigation/Elec": "Armor elemental mitigation",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
      "s:wind-waker/Damage Mitigation/Wind": "Armor elemental mitigation",
    },
    "Power": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:savage/Equipment/Attack Crit Damage": "savage Attack Crit Damage",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (armor)",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
    },
    "Rapier": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:cheetah/Primary Attributes/Agility": "Single primary attribute suffix",
      "s:nimble/Equipment/Parry": "nimble Parry",
      "s:raccoon/Primary Attributes/Dexterity": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
      "s:swiftness/Equipment/Attack Speed": "swiftness Attack Speed",
    },
    "Reactive": {
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:barrier/Equipment/Block": "barrier Block (armor)",
      "s:dampening/Damage Mitigation/Crushing": "Physical mitigation suffix by damage type",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:fire-eater/Damage Mitigation/Fire": "Armor elemental mitigation",
      "s:frost-born/Damage Mitigation/Cold": "Armor elemental mitigation",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:spirit-ward/Damage Mitigation/Dark": "Armor elemental mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:thrice-blessed/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:thunder-child/Damage Mitigation/Elec": "Armor elemental mitigation",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
      "s:wind-waker/Damage Mitigation/Wind": "Armor elemental mitigation",
    },
    "Redwood Staff": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:destruction/Equipment/Magic Damage": "destruction Magic Damage",
      "s:elementalist/Proficiency/Elemental": "Proficiency suffix",
      "s:focus/Equipment/Magic Accuracy": "focus Magic Accuracy",
      "s:focus/Equipment/Magic Crit Damage": "focus Magic Crit Damage",
      "s:focus/Equipment/Mana Conservation": "focus Mana Conservation",
      "s:fox/Primary Attributes/Intelligence": "Single primary attribute suffix",
      "s:freyr/Spell Damage/Wind": "Elemental spell damage suffix",
      "s:mjolnir/Spell Damage/Elec": "Elemental spell damage suffix",
      "s:niflheim/Spell Damage/Cold": "Elemental spell damage suffix",
      "s:owl/Primary Attributes/Wisdom": "Single primary attribute suffix",
      "s:surtr/Spell Damage/Fire": "Elemental spell damage suffix",
    },
    "Scythe": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:ox/Primary Attributes/Strength": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
    },
    "Shade": {
      "p:agile/Equipment/Attack Speed": "agile Attack Speed",
      "p:amber/Damage Mitigation/Elec": "Armor elemental mitigation",
      "p:cobalt/Damage Mitigation/Cold": "Armor elemental mitigation",
      "p:jade/Damage Mitigation/Wind": "Armor elemental mitigation",
      "p:onyx/Damage Mitigation/Dark": "Armor elemental mitigation",
      "p:ruby/Damage Mitigation/Fire": "Armor elemental mitigation",
      "p:savage/Equipment/Attack Crit Damage": "savage Attack Crit Damage",
      "p:zircon/Damage Mitigation/Holy": "Armor elemental mitigation",
      "s:arcanist/Equipment/Magic Accuracy": "arcanist Magic Accuracy",
      "s:arcanist/Primary Attributes/Intelligence": "arcanist Intelligence and Wisdom",
      "s:arcanist/Primary Attributes/Wisdom": "arcanist Intelligence and Wisdom",
      "s:fleet/Equipment/Evade": "Armor Evade suffix",
      "s:negation/Equipment/Resist": "negation Resist",
      "s:shadowdancer/Equipment/Attack Crit Damage": "shadowdancer Attack Crit Damage",
      "s:shadowdancer/Equipment/Evade": "Armor Evade suffix",
    },
    "Shortsword": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:focus/Equipment/Magic Accuracy": "focus Magic Accuracy",
      "s:focus/Equipment/Magic Crit Damage": "focus Magic Crit Damage",
      "s:focus/Equipment/Mana Conservation": "focus Mana Conservation",
      "s:ox/Primary Attributes/Strength": "Single primary attribute suffix",
      "s:raccoon/Primary Attributes/Dexterity": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
      "s:swiftness/Equipment/Attack Speed": "swiftness Attack Speed",
    },
    "Swordchucks": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:ox/Primary Attributes/Strength": "Single primary attribute suffix",
      "s:raccoon/Primary Attributes/Dexterity": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
    },
    "Tower Shield": {
      "p:reinforced/Damage Mitigation/Crushing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Piercing": "reinforced physical mitigation",
      "p:reinforced/Damage Mitigation/Slashing": "reinforced physical mitigation",
      "s:barrier/Equipment/Block": "barrier Block (shield)",
      "s:dampening/Damage Mitigation/Crushing": "Physical mitigation suffix by damage type",
      "s:deflection/Damage Mitigation/Piercing": "Physical mitigation suffix by damage type",
      "s:protection/Equipment/Physical Mitigation": "protection Physical Mitigation",
      "s:stoneskin/Damage Mitigation/Slashing": "Physical mitigation suffix by damage type",
      "s:turtle/Primary Attributes/Endurance": "Single primary attribute suffix",
      "s:warding/Equipment/Magical Mitigation": "warding Magical Mitigation",
    },
    "Wakizashi": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:balance/Equipment/Attack Accuracy": "balance Attack Accuracy",
      "s:balance/Equipment/Attack Crit Damage": "balance Attack Crit Damage",
      "s:battlecaster/Equipment/Magic Accuracy": "battlecaster Magic Accuracy",
      "s:battlecaster/Equipment/Mana Conservation": "battlecaster Mana Conservation (weapon)",
      "s:cheetah/Primary Attributes/Agility": "Single primary attribute suffix",
      "s:nimble/Equipment/Parry": "nimble Parry",
      "s:raccoon/Primary Attributes/Dexterity": "Single primary attribute suffix",
      "s:slaughter/Equipment/Physical Damage": "slaughter Physical Damage (weapon)",
      "s:swiftness/Equipment/Attack Speed": "swiftness Attack Speed",
    },
    "Willow Staff": {
      "p:arctic/Spell Damage/Cold": "Weapon elemental prefix",
      "p:demonic/Spell Damage/Dark": "Weapon elemental prefix",
      "p:fiery/Spell Damage/Fire": "Weapon elemental prefix",
      "p:hallowed/Spell Damage/Holy": "Weapon elemental prefix",
      "p:shocking/Spell Damage/Elec": "Weapon elemental prefix",
      "p:tempestuous/Spell Damage/Wind": "Weapon elemental prefix",
      "s:curse-weaver/Proficiency/Deprecating": "Proficiency suffix",
      "s:destruction/Equipment/Magic Damage": "destruction Magic Damage",
      "s:fenrir/Spell Damage/Dark": "Elemental spell damage suffix",
      "s:focus/Equipment/Magic Accuracy": "focus Magic Accuracy",
      "s:focus/Equipment/Magic Crit Damage": "focus Magic Crit Damage",
      "s:focus/Equipment/Mana Conservation": "focus Mana Conservation",
      "s:fox/Primary Attributes/Intelligence": "Single primary attribute suffix",
      "s:owl/Primary Attributes/Wisdom": "Single primary attribute suffix",
    },
  };
  const coefficients = {
    "Axe": {
      "Equipment/Attack Accuracy": [0.02,{"n":[4.554225575030606,0.0023724484504226025]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.07048738690664944,5.520728525779299e-05]}],
      "Equipment/Burden": [0.0,{"n":[13.797929498099855,-0.033988992268378974]}],
      "Equipment/Interference": [0.0,{"n":[7.182439880148415,-0.018415537236272178]}],
      "Equipment/Parry": [0.005,{"n":[19.782972481287153,0.012362420872080747]}],
      "Equipment/Physical Damage": [0.06024,{"n":[29.61660973182588,0.008964444885077418]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.3980590776944182,0.0005334241819770549]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.8629420543526343,0.0006289228369341814]}],
      "Primary Attributes/Strength": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
    },
    "Buckler": {
      "Equipment/Block": [0.005,{"n":[59.737444308772055,0.018578104155658973]}],
      "Equipment/Burden": [0.0,{"n":[6.073436532507738,-0.015371517027863768]}],
      "Equipment/Interference": [0.0,{"n":[6.185422068568132,-0.021045808124459785]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.0146967556402895,0.00030872996649664676]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.0606871646217717,0.0003257631369698124]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.5417586511439403,0.0014432256086818504]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.541553451996938,0.0014432490773145503]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.5342059824644467,0.001445811993089402]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.5331090750597403,0.001446192809672004]}],
    },
    "Chain Gauntlets": {
      "Damage Mitigation/Crushing": [0.0,{"n":[null,null]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[null,null]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[null,null]}],
      "Equipment/Burden": [0.0,{"n":[null,null]}],
      "Equipment/Interference": [0.0,{"n":[null,null]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[null,null]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[null,null]}],
      "Primary Attributes/Strength": [0.02824,{"n":[null,null]}],
    },
    "Chain Sabatons": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.3966686039626834,0.0007430437637629458]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[1.7957770770942634,0.0005584484252425424]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.585369477010517,0.001115741525991025]}],
      "Equipment/Burden": [0.0,{"n":[6.036483550193001,-0.009324113602085944]}],
      "Equipment/Interference": [0.0,{"n":[5.182282266929114,-0.004787315626677577]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.38321257102179,0.0007498420575822653]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[5.0468548784585545,0.0005196910514226946]}],
      "Primary Attributes/Agility": [0.02824,{"n":[0.5095114240804526,0.0006136275430591483]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[0.9832107735125661,0.0008504499265727487]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[0.978992187100383,0.0008513286405560024]}],
      "Primary Attributes/Strength": [0.02824,{"n":[0.9914726102963702,0.000847277768003666]}],
    },
    "Club": {
      "Equipment/Attack Accuracy": [0.02,{"n":[4.8566848856097575,0.0022797281518209516]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.07048738690664944,5.520728525779299e-05]}],
      "Equipment/Burden": [0.0,{"n":[14.892634776006076,-0.03447228549734245]}],
      "Equipment/Interference": [0.0,{"n":[6.962445730824892,-0.017316389290882767]}],
      "Equipment/Parry": [0.005,{"n":[19.818965267869515,0.012353191009237329]}],
      "Equipment/Physical Damage": [0.06024,{"n":[21.077880857598032,0.00950005107181836]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.5494645592168688,0.0007253626018315563]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.5489252073838462,0.0007256416615733192]}],
      "Primary Attributes/Strength": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
    },
    "Cotton Cap": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.510592129602643,0.0004617067437818259]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[0.9127881548265981,0.0009582550391822688]}],
      "Equipment/Evade": [0.005,{"n":[4.989129446184835,0.003112310440804827]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[1.2299091232620327,0.0007676037457091429]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.9851903369598451,0.0006268489841643176]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[2.085283579209323,0.0006579122714189235]}],
      "Equipment/Resist": [0.005,{"n":[9.92163867947507,0.004969394443994365]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.2345539849820701,0.0010608648785899084]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.5367341283887201,0.0014448842746431617]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.5277150285072718,0.0014480778655931816]}],
    },
    "Cotton Gloves": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.353204347425431,0.0004179311266566732]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[0.8337460937248191,0.0008585695406749845]}],
      "Equipment/Evade": [0.005,{"n":[4.488766198755133,0.0028018531172030103]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[1.1097641062194565,0.0006901365204979975]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.7832958302446758,0.000565539023479879]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.873685857036157,0.0005926724590852247]}],
      "Equipment/Resist": [0.005,{"n":[8.964716397758012,0.0044630748603402826]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.1118193101573324,0.0009544381831321288]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.3873045265857025,0.0012991524543323823]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.3802956144715175,0.0013014711507520302]}],
    },
    "Cotton Pants": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.6423315811041357,0.0005150497127171933]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.0294467296077165,0.0010455909972793289]}],
      "Equipment/Evade": [0.005,{"n":[5.503465699282618,0.003417471113725115]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[1.3587709479318466,0.0008422539385854557]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.222211821251918,0.0006757010177252136]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[2.30762836562862,0.000719057596782547]}],
      "Equipment/Resist": [0.005,{"n":[11.033479859299398,0.005426507528026699]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.3671067113724709,0.0011637107704563863]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.7042612372705896,0.0015846700318624598]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.6982915744217086,0.001586629621869315]}],
    },
    "Cotton Robe": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.786483534639639,0.0005643127863524133]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.109251218148004,0.001145615536352284]}],
      "Equipment/Evade": [0.005,{"n":[5.989514214578795,0.0037335711150918026]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[1.4712860677919428,0.0009226858254556259]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.39566000873746,0.0007472830685491842]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[2.5251595707926433,0.0007820348637809562]}],
      "Equipment/Resist": [0.005,{"n":[11.830724766651382,0.005989244588086781]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.4769351861103992,0.0012744977387824515]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.8382530025876287,0.0017361896299560632]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.8451768939541306,0.0017337579383345813]}],
    },
    "Cotton Shoes": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.197101512568952,0.0003737230312344032]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[0.7426847283923617,0.0007625529334016396]}],
      "Equipment/Evade": [0.005,{"n":[3.990254858330129,0.00249026751190671]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[0.9827811572666487,0.0006144954926542192]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.5980033293137041,0.0004980641458348934]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.6819190373492061,0.0005216213431968277]}],
      "Equipment/Resist": [0.005,{"n":[7.954551564358587,0.003970645462351047]}],
      "Primary Attributes/Agility": [0.02824,{"n":[0.9872616020418508,0.000848877018584581]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.2317557516382633,0.0011553093476957372]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.2246263793240186,0.001157605143682336]}],
    },
    "Dagger": {
      "Equipment/Attack Accuracy": [0.02,{"n":[18.243628901190025,0.003791912772657138]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.10224012292868512,6.099501123152263e-05]}],
      "Equipment/Burden": [0.0,{"n":[5.964043831275992,-0.014852465509274533]}],
      "Equipment/Interference": [0.0,{"n":[5.9641316054615565,-0.014852517110794551]}],
      "Equipment/Parry": [0.005,{"n":[39.538177566001615,0.018506191329998534]}],
      "Equipment/Physical Damage": [0.06024,{"n":[12.606826101335663,0.007920759134005344]}],
      "Primary Attributes/Agility": [0.02824,{"n":[3.086095032054387,0.001445321169596969]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[3.08308557877295,0.0014464191855955194]}],
    },
    "Drakehide Boots": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.9922747949055672,0.0009295400402534618]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[1.4949405117926593,0.00046660442145927803]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[2.9970417988277123,0.000927612725516157]}],
      "Equipment/Burden": [0.0,{"n":[3.6130642361111107,-0.009127604166666666]}],
      "Equipment/Evade": [0.005,{"n":[2.396095995059768,0.002241446498531216]}],
      "Equipment/Interference": [0.0,{"n":[2.086197390185627,-0.00527476566807572]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.1900915004692454,0.0009930706727789929]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[2.9341683775561553,0.0009115020433517316]}],
      "Equipment/Resist": [0.005,{"n":[9.476606560431982,0.00884373987119986]}],
      "Primary Attributes/Agility": [0.02824,{"n":[0.9907855330911817,0.0006565261774919343]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.2308558309025899,0.0007741886273519398]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[0.9870725662729911,0.0006579928558348314]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.2347807917744613,0.0007724790432589445]}],
    },
    "Drakehide Breastplate": {
      "Damage Mitigation/Crushing": [0.0,{"n":[4.494084757148517,0.0013929231515335603]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[2.248248723297693,0.0006987200096136829]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.480616174740839,0.0013968595145810584]}],
      "Equipment/Burden": [0.0,{"n":[8.96503902130352,-0.022319482528299225]}],
      "Equipment/Evade": [0.005,{"n":[3.581410601829557,0.0033669216196612253]}],
      "Equipment/Interference": [0.0,{"n":[7.064156286161591,-0.01778095432577768]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[4.791909951239501,0.0014868381754301239]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[4.3957911431380525,0.0013691036795857358]}],
      "Equipment/Resist": [0.005,{"n":[14.266438297102368,0.013257446995964154]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.4766298393291208,0.000988285110854179]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.8556586050351318,0.001157709774523694]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.4865672131803072,0.0009848769455389078]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.8553583538809328,0.0011577522541848834]}],
    },
    "Drakehide Gauntlets": {
      "Damage Mitigation/Crushing": [0.0,{"n":[3.3958619345587167,0.00103550346285309]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[1.6786118104239587,0.0005271322158824495]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.3700248370825294,0.0010434115250178863]}],
      "Equipment/Burden": [0.0,{"n":[1.3,0.0]}],
      "Equipment/Evade": [0.005,{"n":[2.738360797795888,0.0025071635137181936]}],
      "Equipment/Interference": [0.0,{"n":[8.492156862745103,-0.021568627450980416]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.594052486960369,0.0011150058347037604]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[3.29863174457327,0.0010264338403606188]}],
      "Equipment/Resist": [0.005,{"n":[10.754856630133702,0.009924720202051813]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.1242443347152755,0.0007356796835447945]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.4108779294510296,0.0008616302314489566]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.1290714134485986,0.0007339853726307019]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.4075256809474692,0.0008628928380784659]}],
    },
    "Drakehide Helmet": {
      "Damage Mitigation/Crushing": [0.0,{"n":[3.7563880232392375,0.0011560514149420754]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[1.8843059788112753,0.0005784804112476298]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.747220779227333,0.0011589991492314262]}],
      "Equipment/Burden": [0.0,{"n":[2.791537132987907,-0.006433506044904995]}],
      "Equipment/Evade": [0.005,{"n":[2.9897380429686837,0.0028043904534091994]}],
      "Equipment/Interference": [0.0,{"n":[14.248877374784083,-0.036312607944732164]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[4.010019048134957,0.0012339841470377696]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[3.677263681169462,0.001136228693854285]}],
      "Equipment/Resist": [0.005,{"n":[11.812286010698884,0.011078942110746504]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.2375719590267247,0.0008213701942028155]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.5493556555808885,0.0009639577138748088]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.2353568254201384,0.0008220575606113407]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.5436573308598582,0.0009656011190507276]}],
    },
    "Drakehide Leggings": {
      "Damage Mitigation/Crushing": [0.0,{"n":[4.112040840125731,0.00127817291903311]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[2.050716188312012,0.0006450306921576524]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.110111722225627,0.0012800080390719753]}],
      "Equipment/Burden": [0.0,{"n":[12.134727738629087,-0.030816784112748245]}],
      "Equipment/Evade": [0.005,{"n":[3.284333470014859,0.0030868257194832443]}],
      "Equipment/Interference": [0.0,{"n":[3.6067507722079535,-0.009348368129209916]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[4.377232250082014,0.0013676327125414479]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[4.037226978641332,0.001252491874249941]}],
      "Equipment/Resist": [0.005,{"n":[13.031939500971724,0.012166444694753057]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.3640006602432067,0.000902459091718773]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.6976516354551192,0.001062267920413115]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.3624915091385295,0.0009031816637134175]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.7061573785059743,0.0010596493584924926]}],
    },
    "Ebony Staff": {
      "Equipment/Burden": [0.0,{"n":[10.188667292351008,-0.025973721257625523]}],
      "Equipment/Interference": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[7.306668217821581,0.003422526863436219]}],
      "Equipment/Magic Crit Damage": [0.0,{"n":[0.06585060900205508,5.6708039718473085e-05]}],
      "Equipment/Magic Damage": [0.044,{"n":[12.684696237945605,0.005933491143265696]}],
      "Equipment/Physical Damage": [0.06024,{"n":[8.414572996864255,0.00790272860544326]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
      "Proficiency/Divine": [0.0282,{"n":[3.098545126734982,0.00096415624253238]}],
      "Proficiency/Elemental": [0.0282,{"n":[3.0969151411405047,0.0009647412431514666]}],
      "Proficiency/Forbidden": [0.0282,{"n":[3.097104764556682,0.000964592903413898]}],
      "Spell Damage/Cold": [0.00502,{"n":[2.156009250568241,0.002009844855905727]}],
      "Spell Damage/Dark": [0.00502,{"n":[2.156009250568241,0.002009844855905727]}],
      "Spell Damage/Elec": [0.00502,{"n":[2.156009250568241,0.002009844855905727]}],
      "Spell Damage/Fire": [0.00502,{"n":[2.156009250568241,0.002009844855905727]}],
      "Spell Damage/Holy": [0.00502,{"n":[2.156009250568241,0.002009844855905727]}],
      "Spell Damage/Wind": [0.00502,{"n":[2.156009250568241,0.002009844855905727]}],
    },
    "Estoc": {
      "Equipment/Attack Accuracy": [0.02,{"n":[4.595943679477067,0.001419663034760927]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.17303258324970605,6.30573234101602e-05]}],
      "Equipment/Block": [0.005,{"n":[39.937661432917935,0.012391189962749228]}],
      "Equipment/Burden": [0.0,{"n":[27.558271673879645,-0.06776490297361433]}],
      "Equipment/Interference": [0.0,{"n":[13.841298467087451,-0.0340847610459873]}],
      "Equipment/Parry": [0.005,{"n":[15.860335865017419,0.009904452128463397]}],
      "Equipment/Physical Damage": [0.06024,{"n":[31.683319810116103,0.009899219020546326]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.2460949503540633,0.0007708493724635417]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[2.3209128005927293,0.0011080308616712017]}],
      "Primary Attributes/Strength": [0.02824,{"n":[5.884486829240773,0.001776144207373867]}],
    },
    "Force Shield": {
      "Equipment/Block": [0.005,{"n":[99.58904815762173,0.018596575882239195]}],
      "Equipment/Burden": [0.0,{"n":[6.796738041002282,-0.014004555808656055]}],
      "Equipment/Interference": [0.0,{"n":[41.60633257403194,-0.06806378132118472]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.2961416647406514,0.000530324153363411]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.3715391458166368,0.0005535995068995199]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.5425814212618603,0.0014430760663155893]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.5387615743363705,0.0014443069075253815]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.538182450052072,0.001444700346159681]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.538615057304746,0.0014445469995105187]}],
    },
    "Gossamer Cap": {
      "Equipment/Evade": [0.005,{"n":[null,null]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[null,null]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[null,null]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[null,null]}],
      "Equipment/Resist": [0.005,{"n":[null,null]}],
      "Primary Attributes/Agility": [0.02824,{"n":[null,null]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[null,null]}],
    },
    "Gossamer Gloves": {
      "Equipment/Evade": [0.005,{"n":[4.470640858494054,0.004191731072575076]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[1.1100833101679308,0.0006896558719571282]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.8011269989581877,0.0005589385955370332]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.8792459506944705,0.0005912958221889135]}],
      "Equipment/Resist": [0.005,{"n":[10.695539659116967,0.0066663096806300155]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.3846340297461035,0.0012998575580268398]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.3863911117761862,0.0012992507236763648]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.3798840440830293,0.0013015029420196283]}],
    },
    "Gossamer Pants": {
      "Equipment/Evade": [0.005,{"n":[null,null]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[null,null]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[null,null]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[null,null]}],
      "Equipment/Resist": [0.005,{"n":[null,null]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[null,null]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[null,null]}],
    },
    "Gossamer Robe": {
      "Equipment/Evade": [0.005,{"n":[5.936226290491092,0.005598236251197279]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[1.477294651226435,0.0009205998126181183]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.397048201830457,0.0007468548806679026]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[2.512519993670189,0.0007858371413663035]}],
      "Equipment/Resist": [0.005,{"n":[14.216977700719632,0.008899399770586354]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.8492275448224298,0.0017322256838252221]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.841628493161469,0.001734801586463849]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.8518190592361936,0.001731482029627253]}],
    },
    "Gossamer Shoes": {
      "Equipment/Evade": [0.005,{"n":[3.951657573868948,0.003733634197236136]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[0.985549140952733,0.000613561692767826]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.597233845667834,0.000498398807498386]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.67711664002576,0.0005233453661511666]}],
      "Equipment/Resist": [0.005,{"n":[9.47101994192166,0.005937626627923395]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.2273204776128446,0.001156754619151885]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.2248038406223807,0.0011575203287929256]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.23261340423953,0.0011550450499125998]}],
    },
    "Great Mace": {
      "Equipment/Attack Accuracy": [0.02,{"n":[4.865620558753,0.0020886882445085163]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.17303258324970605,6.30573234101602e-05]}],
      "Equipment/Block": [0.005,{"n":[39.82311851309355,0.012428265565481534]}],
      "Equipment/Burden": [0.0,{"n":[28.13004566210045,-0.0707305936073059]}],
      "Equipment/Interference": [0.0,{"n":[13.888401826484023,-0.03442922374429225]}],
      "Equipment/Parry": [0.005,{"n":[15.860335865017419,0.009904452128463397]}],
      "Equipment/Physical Damage": [0.06024,{"n":[31.603473295463843,0.00992373313394038]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.859092680724971,0.0006301968493639263]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[3.861161873054215,0.0012066486173940712]}],
      "Primary Attributes/Strength": [0.02824,{"n":[5.86421185766347,0.0018309162221223597]}],
    },
    "Ironsilk Cap": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.5175528707380859,0.00045978674618412556]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[0.7599982793793731,0.00023159841300708398]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[1.5203068081772055,0.0004592161605946701]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[0.9258216318322212,0.0009538594782811274]}],
      "Equipment/Burden": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Evade": [0.005,{"n":[5.0175092583272125,0.003102007424050423]}],
      "Equipment/Interference": [0.0,{"n":[8.135309278350519,-0.02087628865979384]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.0140670976893453,0.0006170156846843301]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[2.097221960991728,0.0006529602713766578]}],
      "Equipment/Resist": [0.005,{"n":[9.9895873282555,0.004945868777625918]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.2324936834843876,0.0010614562916108688]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.537798545788415,0.0014445822553333608]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.535582551463813,0.0014453019046874618]}],
    },
    "Ironsilk Gloves": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.3627513520553853,0.0004148832686719377]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[0.6809451277650551,0.00020933578392834772]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[1.3696231871205606,0.00041271759115627026]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[0.8377873167163998,0.0008574559620819695]}],
      "Equipment/Burden": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Evade": [0.005,{"n":[4.491742960668743,0.002800380461754163]}],
      "Equipment/Interference": [0.0,{"n":[4.723660539694959,-0.011615174032068853]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.7899993261800393,0.0005628185659738564]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.873433310012445,0.0005928841049296687]}],
      "Equipment/Resist": [0.005,{"n":[8.926535931856629,0.004474041929887666]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.1145946928836579,0.0009537670187096204]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.3842013216449303,0.0013002701143315963]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.38007073161332,0.0013014801350151475]}],
    },
    "Ironsilk Robe": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.799593433328567,0.0005602507807887909]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[0.8965465359801137,0.00028481426509787447]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[1.8040808757858997,0.0005580958076915287]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.1115218515139675,0.001144624834159077]}],
      "Equipment/Burden": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Evade": [0.005,{"n":[5.9757370148809485,0.003737866975156278]}],
      "Equipment/Interference": [0.0,{"n":[4.148144827929675,-0.011021465212410965]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.408134582297338,0.000742758138956497]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[2.5168268304187364,0.0007848511962809189]}],
      "Equipment/Resist": [0.005,{"n":[11.964983010086119,0.005946625183104155]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.4681230068906608,0.0012772704781997735]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.85395920228674,0.001730675843322101]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.8504050483973398,0.001731626505098054]}],
    },
    "Katalox Staff": {
      "Equipment/Burden": [0.0,{"n":[14.097964368028805,-0.035525983748591054]}],
      "Equipment/Interference": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[7.302101005449975,0.003499516149539133]}],
      "Equipment/Magic Crit Damage": [0.0,{"n":[0.11297432227565474,6.331189637572358e-05]}],
      "Equipment/Magic Damage": [0.044,{"n":[12.685371696325472,0.006063749147965725]}],
      "Equipment/Physical Damage": [0.06024,{"n":[8.380337947431578,0.007912971686089303]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[2.0012358496978564,0.0015881875667196346]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.5486261209439371,0.0009640422966520388]}],
      "Proficiency/Deprecating": [0.0282,{"n":[2.0095660412852174,0.0012038090188518798]}],
      "Proficiency/Divine": [0.0282,{"n":[2.7757153355911948,0.001635973665672189]}],
      "Proficiency/Forbidden": [0.0282,{"n":[2.7756573435646565,0.001636176272859472]}],
      "Spell Damage/Dark": [0.00502,{"n":[2.150743888110588,0.002805063916010067]}],
      "Spell Damage/Holy": [0.00502,{"n":[2.150743888110588,0.002805063916010067]}],
    },
    "Katana": {
      "Equipment/Attack Accuracy": [0.02,{"n":[12.139866760943432,0.004731405047718974]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.19446976124890739,6.335333529124162e-05]}],
      "Equipment/Block": [0.005,{"n":[12.12719400786791,0.00743963932067659]}],
      "Equipment/Burden": [0.0,{"n":[27.249851632047474,-0.06624629080118695]}],
      "Equipment/Interference": [0.0,{"n":[13.873887240356076,-0.03434718100890205]}],
      "Equipment/Parry": [0.005,{"n":[15.860335865017419,0.009904452128463397]}],
      "Equipment/Physical Damage": [0.06024,{"n":[29.49409943502924,0.010572586985611265]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.5550721808393257,0.0009620040878937914]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[4.6365962405755115,0.0014451426181997273]}],
      "Primary Attributes/Strength": [0.02824,{"n":[6.171958973348564,0.0019270411396844767]}],
    },
    "Kevlar Boots": {
      "Damage Mitigation/Crushing": [0.0,{"n":[3.003611540314571,0.0009250605364562258]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[2.3831559462476832,0.0007485264608182651]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[2.989395576945666,0.0009294713045877073]}],
      "Equipment/Burden": [0.0,{"n":[4.185207584177829,-0.010346518470088228]}],
      "Equipment/Evade": [0.005,{"n":[2.3972782705996343,0.0022413515184113346]}],
      "Equipment/Interference": [0.0,{"n":[3.9940041519111076,-0.004786909268530991]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.3895333041082574,0.0007466735916837809]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[3.758810684158281,0.0011762268068895784]}],
      "Equipment/Resist": [0.005,{"n":[7.8970236550169375,0.0073921672073967454]}],
      "Primary Attributes/Agility": [0.02824,{"n":[0.9933899178791998,0.0006556959182407112]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.238206820110173,0.0007713202686381742]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[0.9898880147026037,0.0006570869377533499]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.2360005526390063,0.0007722195635475133]}],
    },
    "Kevlar Gauntlets": {
      "Damage Mitigation/Crushing": [0.0,{"n":[3.3770890834040026,0.0010417596445627514]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[2.680581423220584,0.0008417955624111621]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.374344509854526,0.0010425665933152895]}],
      "Equipment/Burden": [0.0,{"n":[3.1740538904026625,-0.009022101120193755]}],
      "Equipment/Evade": [0.005,{"n":[2.6940459455595818,0.0025217736459879412]}],
      "Equipment/Interference": [0.0,{"n":[17.12493681550123,-0.025779275484414322]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.70569219002766,0.0008339308444145545]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[4.23214711021965,0.0013213669364368853]}],
      "Equipment/Resist": [0.005,{"n":[8.90836240708163,0.008307021690745457]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.117242900244948,0.0007378181681401609]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.394412277221408,0.0008671795572095968]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.1183298233671963,0.0007376207168565162]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.391744165906034,0.0008681719070605962]}],
    },
    "Kevlar Helmet": {
      "Damage Mitigation/Crushing": [0.0,{"n":[null,null]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[null,null]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[null,null]}],
      "Equipment/Burden": [0.0,{"n":[null,null]}],
      "Equipment/Evade": [0.005,{"n":[null,null]}],
      "Equipment/Interference": [0.0,{"n":[null,null]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[null,null]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[null,null]}],
      "Equipment/Resist": [0.005,{"n":[null,null]}],
      "Primary Attributes/Agility": [0.02824,{"n":[null,null]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[null,null]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[null,null]}],
      "Primary Attributes/Strength": [0.02824,{"n":[null,null]}],
    },
    "Kevlar Leggings": {
      "Damage Mitigation/Crushing": [0.0,{"n":[4.108199072905272,0.0012802738878042402]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[3.2901538935358734,0.001023661975292936]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.113615845730624,0.0012781933220321776]}],
      "Equipment/Burden": [0.0,{"n":[14.027113645847827,-0.03514327444707192]}],
      "Equipment/Evade": [0.005,{"n":[3.307718082295805,0.0030773661540237614]}],
      "Equipment/Interference": [0.0,{"n":[7.013801641396579,-0.010129364306579498]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.299365472695082,0.0010221390019499394]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[5.192167688329614,0.0016080673925708802]}],
      "Equipment/Resist": [0.005,{"n":[10.936946992945636,0.010136825748800335]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.3695495693968414,0.0009005253861459205]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.7048308240161805,0.001060054868115598]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.363098792202753,0.0009025836496655268]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.7060468698105744,0.001059380511562909]}],
    },
    "Kite Shield": {
      "Equipment/Block": [0.005,{"n":[79.65703013931343,0.01858890157081083]}],
      "Equipment/Burden": [0.0,{"n":[17.602779276848338,-0.03561791689152718]}],
      "Equipment/Interference": [0.0,{"n":[17.584875092752895,-0.03553054662379411]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.4998364416478356,0.00046757698052742096]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.5810139286963363,0.0004892549654914205]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.5397161323528676,0.0014441229025159673]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.5401274919658778,0.001443750294394253]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.5379406773139062,0.0014443609965790831]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.5406466104927867,0.0014435939006078567]}],
    },
    "Leather Boots": {
      "Damage Mitigation/Crushing": [0.0,{"n":[3.0018204545810443,0.0009262405122815524]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[1.488607075317111,0.00046884843642494426]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[2.994169339629706,0.000929435571575792]}],
      "Equipment/Burden": [0.0,{"n":[4.291517857142855,-0.010937499999999996]}],
      "Equipment/Evade": [0.005,{"n":[1.9925638626190159,0.0016273528225954378]}],
      "Equipment/Interference": [0.0,{"n":[3.1738392857142834,-0.005312499999999993]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.3830319562923776,0.0008476646720796435]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[4.207758313883092,0.0006483493959368378]}],
      "Equipment/Resist": [0.005,{"n":[12.413992888184893,0.00795275545639001]}],
      "Primary Attributes/Agility": [0.02824,{"n":[0.9844634228535991,0.0006588467150767321]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.2402784188527312,0.0007707832201043919]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[0.989620013452297,0.0006573949449223308]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.236613479763093,0.0007719183832474255]}],
    },
    "Leather Gauntlets": {
      "Damage Mitigation/Crushing": [0.0,{"n":[3.344479325676722,0.0010544010022170774]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[1.703805171732773,0.0005171935741764431]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.2921007198103247,0.001073348546268149]}],
      "Equipment/Burden": [0.0,{"n":[2.839855072463769,-0.007246376811594205]}],
      "Equipment/Evade": [0.005,{"n":[2.2528295278909116,0.0018265636201372053]}],
      "Equipment/Interference": [0.0,{"n":[12.347101449275362,-0.019927536231884046]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.7019056779830946,0.0009467283692485198]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[4.739080412141235,0.0007286835839608656]}],
      "Equipment/Resist": [0.005,{"n":[14.290568089095377,0.008836548684962637]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.114971972428581,0.0007386463803131079]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.3931267124553388,0.0008676116078452286]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.1116778020126166,0.0007401333629914044]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.3909312157840934,0.0008682153494075188]}],
    },
    "Leather Helmet": {
      "Damage Mitigation/Crushing": [0.0,{"n":[3.7432923060281382,0.0011602616681241193]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[1.8711878211667257,0.000581808508137501]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.7371858351268976,0.0011619962663267454]}],
      "Equipment/Burden": [0.0,{"n":[3.4911106135244063,-0.008587102552619793]}],
      "Equipment/Evade": [0.005,{"n":[2.5258332517807203,0.0020226946713013073]}],
      "Equipment/Interference": [0.0,{"n":[19.885260859829827,-0.02946148678907299]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.9972739703056317,0.0010529510845470216]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[5.234541501285313,0.000819434146273868]}],
      "Equipment/Resist": [0.005,{"n":[15.7235268334464,0.009874181434064398]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.2416622151464454,0.0008200893345232027]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.5520087499076385,0.0009629070150638711]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.238755707313171,0.0008210154024305607]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.5529210777295712,0.0009625856234980215]}],
    },
    "Leather Leggings": {
      "Damage Mitigation/Crushing": [0.0,{"n":[4.147953511943379,0.001265802811456397]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[2.0244140555794754,0.0006545588768766873]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.136476183176298,0.001270218939215035]}],
      "Equipment/Burden": [0.0,{"n":[13.628494041170088,-0.033044420368364025]}],
      "Equipment/Evade": [0.005,{"n":[2.77768062322838,0.002225196046505824]}],
      "Equipment/Interference": [0.0,{"n":[4.61755146262189,-0.0055254604550379624]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.2760641709172424,0.0011654993929291321]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[5.789845956119873,0.0008901544948429699]}],
      "Equipment/Resist": [0.005,{"n":[17.422185418301353,0.010817685061162121]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.3753962088971603,0.0008985812767920724]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.7032584995062225,0.0010603550174297812]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.3702349236685767,0.0009002425799936692]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.7067778966299558,0.001059234982556074]}],
    },
    "Longsword": {
      "Equipment/Attack Accuracy": [0.02,{"n":[4.554017502474512,0.002373176750048791]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.19446976124890739,6.335333529124162e-05]}],
      "Equipment/Block": [0.005,{"n":[39.76332783500451,0.0124483154171699]}],
      "Equipment/Burden": [0.0,{"n":[34.8737181554337,-0.08690744920993212]}],
      "Equipment/Interference": [0.0,{"n":[20.91668940540271,-0.05212710540024304]}],
      "Equipment/Parry": [0.005,{"n":[15.860335865017419,0.009904452128463397]}],
      "Equipment/Physical Damage": [0.06024,{"n":[33.748847400726646,0.013450922103332248]}],
      "Primary Attributes/Agility": [0.02824,{"n":[2.3241870672404366,0.0007253939335568683]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[4.6365962405755115,0.0014451426181997273]}],
      "Primary Attributes/Strength": [0.02824,{"n":[6.171958973348564,0.0019270411396844767]}],
    },
    "Oak Staff": {
      "Equipment/Burden": [0.0,{"n":[9.918316576437226,-0.024523072956947667]}],
      "Equipment/Counter-resist": [0.0,{"n":[2.4855196398529618,0.0031132758650596892]}],
      "Equipment/Interference": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[7.306668217821581,0.003422526863436219]}],
      "Equipment/Magic Crit Damage": [0.0,{"n":[0.06585060900205508,5.6708039718473085e-05]}],
      "Equipment/Magic Damage": [0.044,{"n":[12.682818534564301,0.005933568405667958]}],
      "Equipment/Physical Damage": [0.06024,{"n":[8.4373184134048,0.00789343123005483]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.5489389928900827,0.0009639121395906685]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[2.0012358496978564,0.0015881875667196346]}],
      "Proficiency/Divine": [0.0282,{"n":[2.3197126137106334,0.0012037322693169044]}],
      "Proficiency/Elemental": [0.0282,{"n":[2.3187548171190144,0.0012040761826847934]}],
      "Proficiency/Supportive": [0.0282,{"n":[5.871655115512105,0.0017804921341651044]}],
      "Spell Damage/Cold": [0.00502,{"n":[2.1652165326930986,0.0017418956600945398]}],
      "Spell Damage/Fire": [0.00502,{"n":[2.1652165326930986,0.0017418956600945398]}],
      "Spell Damage/Holy": [0.00502,{"n":[3.419149982393531,0.004003101439298213]}],
    },
    "Phase Cap": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.1278097893033205,0.00034964450617284027]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[0.925890856057602,0.0009539667049206794]}],
      "Equipment/Evade": [0.005,{"n":[9.986855735813155,0.0031125983259031754]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[1.9679878372476662,0.0009174939916861175]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.9943315921648934,0.0006234822849991692]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.5767045531953396,0.0004903963079796295]}],
      "Equipment/Resist": [0.005,{"n":[9.960838087444511,0.005564739211930562]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.5415908601239634,0.0013479169747035722]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.9977991272333515,0.001541558096446616]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[2.001698340953773,0.001540295789274904]}],
    },
    "Phase Gloves": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.0061442852519353,0.00031811783733340945]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[0.8293324786836638,0.0008600162349067309]}],
      "Equipment/Evade": [0.005,{"n":[8.973731593329894,0.0028059986139512493]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[1.7695138245426478,0.0008261684942517711]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.8004045244550955,0.000559153020895192]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.4135700288443003,0.00044372781543735435]}],
      "Equipment/Resist": [0.005,{"n":[8.944019644966776,0.005014932700175799]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.384884294531087,0.0012140651420794004]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.79963062009314,0.0013869525909539]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.7993640467898873,0.0013869941796775965]}],
    },
    "Phase Pants": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.2425337748041976,0.00038384506520107664]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.0225722358373353,0.0010483975147258721]}],
      "Equipment/Evade": [0.005,{"n":[10.990532060062447,0.003422331099965693]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[2.1676401889852506,0.0010082872043496497]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.185311125067595,0.000688843108107419]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.731444646269767,0.0005403767622850668]}],
      "Equipment/Resist": [0.005,{"n":[10.942566920088812,0.006127889088488086]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.6933384142831853,0.001483554410066251]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[2.197293341634566,0.001696142738153256]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[2.202264376875074,0.0016944416094725016]}],
    },
    "Phase Robe": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.3519928753773205,0.0004204244417752441]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.1130262204794015,0.0011440086198073907]}],
      "Equipment/Evade": [0.005,{"n":[11.987602957675646,0.0037339994890836234]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[2.36409468640679,0.0011000063266536231]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.3966914417950416,0.0007470334169492927]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.8908414335458539,0.0005891030665057972]}],
      "Equipment/Resist": [0.005,{"n":[11.965741562935463,0.006673460359370581]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.8491202430770173,0.0016177596296727103]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[2.4032118655701566,0.0018480644592010166]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[2.3990423647076726,0.0018494557641433693]}],
    },
    "Phase Shoes": {
      "Damage Mitigation/Crushing": [0.0,{"n":[0.8987887308486386,0.00028062385926326045]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[0.737460419538615,0.000764307662752412]}],
      "Equipment/Evade": [0.005,{"n":[7.9869262804566095,0.002490939328278579]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[1.569489135431291,0.000735463637604499]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.5922565295182785,0.0005001462660290514]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.2582088636210855,0.000393582236695876]}],
      "Equipment/Resist": [0.005,{"n":[7.926656008153149,0.004466395994928813]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.232452836204497,0.0010785972206223506]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.59824618165983,0.001233301680511812]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[1.6006321466501978,0.0012325565235504895]}],
    },
    "Plate Cuirass": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.2374645298114757,0.0013947052870301566]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[6.7411109050826825,0.0013940880719168192]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[6.732895768111626,0.0013961304023051803]}],
      "Equipment/Burden": [0.0,{"n":[31.450670980110225,-0.05250419362568895]}],
      "Equipment/Interference": [0.0,{"n":[20.888016284043168,-0.03436783386153403]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[4.5237027737692035,0.0013852015303629686]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[9.431825663276953,0.0009830382639280891]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.4860548202496089,0.0012717327742786861]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.8464223256165013,0.0017337168918183747]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.4793731388545757,0.0012738158563861705]}],
    },
    "Plate Gauntlets": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.6801608553901586,0.0010457565644201405]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[5.0548251157496225,0.0010449490331064704]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[5.050612534558097,0.0010465383091536476]}],
      "Equipment/Burden": [0.0,{"n":[8.410584168414518,-0.014056552474170784]}],
      "Equipment/Interference": [0.0,{"n":[25.1438974844501,-0.041695629247012894]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.41356315282046,0.0010325873736853114]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[7.067911208836057,0.0007400547110155097]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.103854304297982,0.0009572128293486178]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.3767167453359992,0.0013025656452013974]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.1081503644512236,0.0009556957944790627]}],
    },
    "Plate Greaves": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.0577486926188664,0.001275904514565744]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[6.1663223688953614,0.0012819081604224542]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[6.176054598354355,0.0012780402494257628]}],
      "Equipment/Burden": [0.0,{"n":[41.97229324235446,-0.06996670503123963]}],
      "Equipment/Interference": [0.0,{"n":[10.446730105228538,-0.01719212430121668]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[4.178608428378453,0.0012604280149599214]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[8.656802619032494,0.0008986276600093625]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.2301505185008943,0.0012064721147696878]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.6997920434264389,0.0015861863591390838]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.3585747544675297,0.001166866189308828]}],
    },
    "Plate Helmet": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.8652656630666944,0.0011619468331230745]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[5.613693060997274,0.0011624512935232566]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[5.615644646054467,0.0011617095106620243]}],
      "Equipment/Burden": [0.0,{"n":[10.291425546930117,-0.016354975299929346]}],
      "Equipment/Interference": [0.0,{"n":[41.77352744310571,-0.06897590361445768]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.8237733378751697,0.0011351070782118148]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[7.877796076408618,0.0008131101377145949]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.236322795688971,0.0010602422046111569]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.5309451598935508,0.0014470601958157055]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.234251520417812,0.0010609044009307154]}],
    },
    "Plate Sabatons": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.4941434159982276,0.0009282074626212587]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[4.494662181247502,0.0009293058723399713]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.493767369513467,0.0009283965401062388]}],
      "Equipment/Burden": [0.0,{"n":[12.580888007115004,-0.02110829855647535]}],
      "Equipment/Interference": [0.0,{"n":[6.320508996374086,-0.010589040158719308]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.0597800698176894,0.0009072492000206353]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[6.309060435279509,0.0006480569423157811]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[0.991234617999512,0.0008472070105576786]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.2348011951502968,0.001153929218027766]}],
      "Primary Attributes/Strength": [0.02824,{"n":[0.9896783172348274,0.0008476822358655276]}],
    },
    "Power Armor": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.684912379656732,0.0008414167796034291]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[4.479993546919491,0.0013971730195235872]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.478514569166045,0.0013975452072798446]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[2.208484883858521,0.0013698950047855989]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.048166009393936254,7.960536633701966e-06]}],
      "Equipment/Burden": [0.0,{"n":[25.790730424017337,-0.050069637883008354]}],
      "Equipment/Interference": [0.0,{"n":[24.3879814590001,-0.034477430747158117]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.581312854600232,0.0011213523089860413]}],
      "Equipment/Physical Damage": [0.06024,{"n":[5.058881728688121,0.004753552742859589]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[6.309662628577106,0.0009738338641951155]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.843933167169995,0.0017342812965368724]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.484256086131733,0.0012720368374076895]}],
      "Primary Attributes/Strength": [0.02824,{"n":[2.399871865943928,0.0018490065538545341]}],
    },
    "Power Boots": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.8001413704451568,0.0005570749530211124]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[2.9950036955689083,0.0009284750390861025]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[2.988382060503528,0.0009302982893004755]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.468323703559042,0.0009147247440528343]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.018011000746641782,1.032050973201129e-05]}],
      "Equipment/Burden": [0.0,{"n":[10.404925469863894,-0.020551595016922275]}],
      "Equipment/Interference": [0.0,{"n":[7.072988505747123,-0.008908045977011487]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.4108003656570043,0.0007392938015917351]}],
      "Equipment/Physical Damage": [0.06024,{"n":[3.3547394266641675,0.0031746824483634083]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[4.181405315956118,0.0006582635018230589]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.2281309054526797,0.0011563600680896205]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[0.9838941624917714,0.0008498206551005494]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.5998235641190002,0.0012328841128670129]}],
    },
    "Power Gauntlets": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.0241692787136567,0.0006270907606753987]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[3.367666636714358,0.001044936957064189]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.3702389435750595,0.001043987884508724]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.6598090281868578,0.001026675762797994]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.0023484938598131097,1.7443263860238562e-05]}],
      "Equipment/Burden": [0.0,{"n":[7.224060349391218,-0.015206458443620993]}],
      "Equipment/Interference": [0.0,{"n":[29.137937145557643,-0.04069234404536856]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.6881440604551763,0.0008411280379683858]}],
      "Equipment/Physical Damage": [0.06024,{"n":[3.7946262044995986,0.0035650543820706163]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[4.72428262045903,0.0007331522953536446]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.3861087737670648,0.0012993902403145123]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.111744917449065,0.0009545388965483363]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.800902752615384,0.0013864524313832874]}],
    },
    "Power Helmet": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.245128604351799,0.0006977503189609203]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[3.7373985959052356,0.0011621158713173432]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.7445186659125804,0.0011597391416081266]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.8370108071886695,0.0011431926671584016]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.043764981364819086,5.28110552257822e-06]}],
      "Equipment/Burden": [0.0,{"n":[8.707095596623326,-0.017134382842801773]}],
      "Equipment/Interference": [0.0,{"n":[48.93499278499278,-0.06971992653810828]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.9991203427614748,0.0009292748015032351]}],
      "Equipment/Physical Damage": [0.06024,{"n":[4.206779031585782,0.003964183353973541]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[5.238138465314481,0.0008180895321490378]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.5421376251746102,0.001443130318417619]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.23096152434531,0.0010619266442651464]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.9960400686720465,0.001542030453742619]}],
    },
    "Power Leggings": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.4576461238341474,0.0007728727343988082]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[4.111253208816494,0.0012790692350781825]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.10722913634748,0.0012807968180373066]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[2.0172294519623284,0.001258677257842867]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.02789562751033474,1.2871935043516918e-05]}],
      "Equipment/Burden": [0.0,{"n":[34.90019856230837,-0.06956844116020718]}],
      "Equipment/Interference": [0.0,{"n":[12.272794126112444,-0.017537330616286182]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.290488206577099,0.0010252840753905697]}],
      "Equipment/Physical Damage": [0.06024,{"n":[4.6333001530186095,0.004359041433740233]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[5.756330075258754,0.000902154372487838]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.6960370604676704,0.0015875116743268387]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.3604788960936234,0.0011661114322751357]}],
      "Primary Attributes/Strength": [0.02824,{"n":[2.202492351352574,0.0016941779588423936]}],
    },
    "Rapier": {
      "Equipment/Attack Accuracy": [0.02,{"n":[9.096108593114693,0.003790845784317576]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.07048738690664944,5.520728525779299e-05]}],
      "Equipment/Burden": [0.0,{"n":[11.892424667789626,-0.029491858506457018]}],
      "Equipment/Interference": [0.0,{"n":[7.144200355605461,-0.01825519371139807]}],
      "Equipment/Parry": [0.005,{"n":[29.6740878818716,0.015431174457608892]}],
      "Equipment/Physical Damage": [0.06024,{"n":[12.655161022150466,0.007905582511900967]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.5492617606415688,0.0007254828019650947]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.5463297947047532,0.0007263374844227565]}],
    },
    "Reactive Cuirass": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.6736240322587737,0.0008453493432087094]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[7.156146188695676,0.0022357834192194975]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[5.3661830636846215,0.0016791283180506923]}],
      "Equipment/Block": [0.005,{"n":[9.775774924978553,0.005975076504150065]}],
      "Equipment/Burden": [0.0,{"n":[32.47576716229047,-0.0580828851629234]}],
      "Equipment/Interference": [0.0,{"n":[24.288168301170543,-0.03410313192027854]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[4.558847482596125,0.001373683844703263]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[9.450967917035152,0.0009768152705813275]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.4860740363041813,0.0012712829542566272]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.8475533464948795,0.0017328096511670858]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.4762842109026568,0.0012745011537532126]}],
    },
    "Reactive Gauntlets": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.021246546959802,0.0006282699978325645]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[5.379994925252158,0.0016720416145670535]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.030551857827671,0.0012571178559394156]}],
      "Equipment/Block": [0.005,{"n":[7.24646131791469,0.004508632348477787]}],
      "Equipment/Burden": [0.0,{"n":[8.364908000406622,-0.013805699569651976]}],
      "Equipment/Interference": [0.0,{"n":[28.684950313807523,-0.03836297071129701]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.407221092992649,0.0010343619832847287]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[7.0876210643573785,0.0007323662540706162]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.11071569581514,0.0009545393783863374]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.381425807886398,0.0013007525655376224]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.1077683544592065,0.0009556482734009535]}],
    },
    "Reactive Greaves": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.4636766609091336,0.0007709698022928584]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[6.58621982452262,0.002040045909115037]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.929674980547986,0.0015351735497625852]}],
      "Equipment/Block": [0.005,{"n":[9.08967457719434,0.005432692483433841]}],
      "Equipment/Burden": [0.0,{"n":[41.890968400748804,-0.06954860914127922]}],
      "Equipment/Interference": [0.0,{"n":[11.934072729335682,-0.015928216183506375]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[4.159723126413503,0.001265976726794725]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[8.668701561727577,0.0008931068719945072]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.372041117908592,0.0011619896854047063]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.703861990095728,0.001584754409275908]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.3636759984690512,0.0011649344527409828]}],
    },
    "Reactive Helmet": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.267842923887593,0.0006910904238623788]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[5.999093712032544,0.0018508334476024539]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[4.4944489367869735,0.0013910116649752619]}],
      "Equipment/Block": [0.005,{"n":[8.170433838516008,0.004973698027519469]}],
      "Equipment/Burden": [0.0,{"n":[10.90065627563579,-0.019524200164069024]}],
      "Equipment/Interference": [0.0,{"n":[47.693984962406084,-0.06343984962406043]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.7832694027019653,0.001150150127561558]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[7.882010053896552,0.0008110550056842297]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.2417242513644529,0.0010583840721769867]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.5475016283790204,0.001441357436219727]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.2452499683655942,0.001057216963598546]}],
    },
    "Reactive Sabatons": {
      "Damage Mitigation/Crushing": [0.0,{"n":[1.7996632811649198,0.0005570344466631214]}],
      "Damage Mitigation/Piercing": [0.0,{"n":[4.780176264252183,0.0014870445412855776]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.5901212899759787,0.0011138625507838705]}],
      "Equipment/Block": [0.005,{"n":[6.429956848064641,0.00401435251664054]}],
      "Equipment/Burden": [0.0,{"n":[12.638355572889115,-0.021189096581887158]}],
      "Equipment/Interference": [0.0,{"n":[7.132594645792135,-0.009303702259241766]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[3.0266474389331712,0.0009202242514384683]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[6.295622654640398,0.0006526108374396988]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[0.9871548955848599,0.0008485964502895303]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.2271722110212644,0.0011565150182543987]}],
      "Primary Attributes/Strength": [0.02824,{"n":[0.9866154163009901,0.0008487643778176458]}],
    },
    "Redwood Staff": {
      "Equipment/Burden": [0.0,{"n":[9.980795194153721,-0.02486530005573792]}],
      "Equipment/Interference": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[7.306668217821581,0.003422526863436219]}],
      "Equipment/Magic Crit Damage": [0.0,{"n":[0.06585060900205508,5.6708039718473085e-05]}],
      "Equipment/Magic Damage": [0.044,{"n":[12.688888164865318,0.0059318897791396895]}],
      "Equipment/Physical Damage": [0.06024,{"n":[8.400784770835305,0.007906006159743921]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
      "Proficiency/Deprecating": [0.0282,{"n":[1.5562335800653546,0.0007706725401344487]}],
      "Proficiency/Elemental": [0.0282,{"n":[3.0908431929352567,0.0015389441575958975]}],
      "Proficiency/Supportive": [0.0282,{"n":[1.5562335800653546,0.0007706725401344487]}],
      "Spell Damage/Cold": [0.00502,{"n":[2.150743888110588,0.002805063916010067]}],
      "Spell Damage/Elec": [0.00502,{"n":[2.150743888110588,0.002805063916010067]}],
      "Spell Damage/Fire": [0.00502,{"n":[2.150743888110588,0.002805063916010067]}],
      "Spell Damage/Wind": [0.00502,{"n":[2.150743888110588,0.002805063916010067]}],
    },
    "Scythe": {
      "Equipment/Attack Accuracy": [0.02,{"n":[3.0711443693294775,0.0009507023555070255]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.19446976124890739,6.335333529124162e-05]}],
      "Equipment/Block": [0.005,{"n":[20.159097774241097,0.006195165737884047]}],
      "Equipment/Burden": [0.0,{"n":[28.36976241900664,-0.0721382289416855]}],
      "Equipment/Interference": [0.0,{"n":[28.10238907849833,-0.0706484641638227]}],
      "Equipment/Parry": [0.005,{"n":[11.98179652251277,0.007428311624402474]}],
      "Equipment/Physical Damage": [0.06024,{"n":[42.222003990827695,0.013194523070313147]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[4.6365962405755115,0.0014451426181997273]}],
      "Primary Attributes/Strength": [0.02824,{"n":[6.171958973348564,0.0019270411396844767]}],
    },
    "Shade Boots": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.276596570957859,0.000687914482257028]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[2.2801905084507887,0.0006869844440152788]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.2309682116006808,0.001138046679515964]}],
      "Equipment/Burden": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Evade": [0.005,{"n":[3.9857807143032744,0.002860979583617667]}],
      "Equipment/Interference": [0.0,{"n":[3.027881040892205,-0.0022304832713755203]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.000716891664468,0.0006203240088528939]}],
      "Equipment/Physical Damage": [0.06024,{"n":[1.6879991877494307,0.0020130384126508033]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[2.5324873058281607,0.0008800192125009717]}],
      "Equipment/Resist": [0.005,{"n":[15.700095368842973,0.011314131559835253]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.2423496100466878,0.0007702142087295921]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.2413903344302253,0.000770456838170618]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[0.9923515053864187,0.0006564733240518953]}],
      "Primary Attributes/Strength": [0.02824,{"n":[0.9963118801492516,0.0006550933680414683]}],
    },
    "Shade Breastplate": {
      "Damage Mitigation/Crushing": [0.0,{"n":[3.3968139721951944,0.001038448410936467]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.402526188648905,0.0010362287428579003]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.8347701894342316,0.0017106480598078563]}],
      "Equipment/Burden": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Evade": [0.005,{"n":[5.983151387820207,0.004290211438822433]}],
      "Equipment/Interference": [0.0,{"n":[9.923352435530058,-0.007115568290353238]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.9864531705651776,0.0009349746301276232]}],
      "Equipment/Physical Damage": [0.06024,{"n":[2.550295105888276,0.0030139428607853617]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[3.7722906383098618,0.0013287899949905413]}],
      "Equipment/Resist": [0.005,{"n":[23.62333250144267,0.016948207601987682]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.8597457827310913,0.0011564325670256257]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.8601052053090594,0.0011563800400550997]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.489159845498873,0.0009843830770761008]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.488950264986737,0.0009844039382800862]}],
    },
    "Shade Gauntlets": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.5599642404386667,0.0007748445282818772]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[2.5276960813191005,0.0007853692221763389]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.3786350701279568,0.001281971864362343]}],
      "Equipment/Burden": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Evade": [0.005,{"n":[4.526308187793022,0.003203383816697781]}],
      "Equipment/Interference": [0.0,{"n":[11.845192307692317,-0.008241758241758306]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.2317238127189003,0.0007038350352192306]}],
      "Equipment/Physical Damage": [0.06024,{"n":[1.9159278506487123,0.0022596474064755134]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[2.8423874093075097,0.0009921228018411757]}],
      "Equipment/Resist": [0.005,{"n":[17.73148349831034,0.012705223010105406]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.393310269327782,0.0008679023436173819]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.3936116401095924,0.0008678091806850496]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.124295404117324,0.0007357042510686896]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.121365533102324,0.0007367904603431076]}],
    },
    "Shade Helmet": {
      "Damage Mitigation/Crushing": [0.0,{"n":[2.8336339836706266,0.0008640522433548208]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[2.8285243318305406,0.0008656625741105327]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.5364770547441484,0.0014234033691243083]}],
      "Equipment/Burden": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Evade": [0.005,{"n":[4.9768559502876535,0.003578705540666224]}],
      "Equipment/Interference": [0.0,{"n":[19.654313380281607,-0.013248239436619277]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.5051677926063145,0.0007735341833491466]}],
      "Equipment/Physical Damage": [0.06024,{"n":[2.109290500938158,0.002516827872325788]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[3.1234551590662574,0.0011137376817960977]}],
      "Equipment/Resist": [0.005,{"n":[19.755024339664104,0.014102950180310355]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.5482249768695002,0.000964278196347649]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.5535549199093857,0.0009626058013925483]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.2440778569014954,0.0008192938535089497]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.2436087212289957,0.0008194624769345876]}],
    },
    "Shade Leggings": {
      "Damage Mitigation/Crushing": [0.0,{"n":[3.126974981133468,0.0009472156028398192]}],
      "Damage Mitigation/Slashing": [0.0,{"n":[3.1284739571595654,0.0009459439007212011]}],
      "Equipment/Attack Accuracy": [0.02,{"n":[1.6920120436608395,0.0015647332188606635]}],
      "Equipment/Burden": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Evade": [0.005,{"n":[5.490297453327891,0.003930190926246519]}],
      "Equipment/Interference": [0.0,{"n":[5.042877407387209,-0.003930929128703187]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[2.7482457172103327,0.0008535904477644263]}],
      "Equipment/Physical Damage": [0.06024,{"n":[2.3329220416221137,0.002764332020470746]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[3.4531362656672147,0.0012197900768407567]}],
      "Equipment/Resist": [0.005,{"n":[21.71680859551641,0.015514204859664874]}],
      "Primary Attributes/Agility": [0.02824,{"n":[1.7056191309875626,0.0010598411930774685]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.7047961621263448,0.001060149691052765]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.3656674265911217,0.0009020015515396264]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.3687055788194824,0.0009009832159784185]}],
    },
    "Shortsword": {
      "Equipment/Attack Accuracy": [0.02,{"n":[12.139866760943432,0.004731405047718974]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.07048738690664944,5.520728525779299e-05]}],
      "Equipment/Burden": [0.0,{"n":[10.18958382226394,-0.025913322381287608]}],
      "Equipment/Interference": [0.0,{"n":[7.059863841113836,-0.017746723996723966]}],
      "Equipment/Parry": [0.005,{"n":[29.615040004638153,0.015446380150729607]}],
      "Equipment/Physical Damage": [0.06024,{"n":[16.862335868764525,0.00922393366416878]}],
      "Primary Attributes/Agility": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
      "Primary Attributes/Strength": [0.02824,{"n":[2.3168199320258034,0.0012048584558840088]}],
    },
    "Tower Shield": {
      "Equipment/Block": [0.005,{"n":[99.60856724511585,0.01858622460857065]}],
      "Equipment/Burden": [0.0,{"n":[49.641472830807835,-0.07310105202200569]}],
      "Equipment/Interference": [0.0,{"n":[24.325308877156708,-0.03412616339193391]}],
      "Equipment/Magical Mitigation": [0.0005,{"n":[1.7926894051976356,0.0005627227380347536]}],
      "Equipment/Physical Mitigation": [0.0005,{"n":[1.8937119612845918,0.0005867788573795054]}],
      "Primary Attributes/Agility": [0.02824,{"n":[null,null]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[1.5416828000224037,0.0014432152309590762]}],
      "Primary Attributes/Endurance": [0.02824,{"n":[1.540185926421934,0.0014437472743808342]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.5407399687355525,0.001443558479137162]}],
    },
    "Wakizashi": {
      "Equipment/Attack Accuracy": [0.02,{"n":[15.212307960126248,0.0028479164055265744]}],
      "Equipment/Attack Crit Damage": [0.0,{"n":[0.07048738690664944,5.520728525779299e-05]}],
      "Equipment/Attack Speed": [0.0,{"n":[3.717101112090198,0.002719195869607929]}],
      "Equipment/Burden": [0.0,{"n":[5.731102941176474,-0.013676470588235312]}],
      "Equipment/Interference": [0.0,{"n":[5.736349206349209,-0.013703703703703734]}],
      "Equipment/Parry": [0.005,{"n":[47.49437785398284,0.014833801255896227]}],
      "Equipment/Physical Damage": [0.06024,{"n":[13.48657501817976,0.0063432630054266305]}],
      "Primary Attributes/Agility": [0.02824,{"n":[3.0784505148037526,0.0014478808469064772]}],
      "Primary Attributes/Dexterity": [0.02824,{"n":[3.0841310941945244,0.0014460357440705266]}],
      "Primary Attributes/Strength": [0.02824,{"n":[1.3980590776944182,0.0005334241819770549]}],
    },
    "Willow Staff": {
      "Equipment/Burden": [0.0,{"n":[10.17351203629378,-0.025886374500554674]}],
      "Equipment/Counter-resist": [0.0,{"n":[2.4855196398529618,0.0031132758650596892]}],
      "Equipment/Interference": [0.0,{"n":[0.0,0.0]}],
      "Equipment/Magic Accuracy": [0.02,{"n":[7.306668217821581,0.003422526863436219]}],
      "Equipment/Magic Crit Damage": [0.0,{"n":[0.06585060900205508,5.6708039718473085e-05]}],
      "Equipment/Magic Damage": [0.044,{"n":[12.686448348255563,0.005932437712197631]}],
      "Equipment/Physical Damage": [0.06024,{"n":[8.405936518598523,0.007905079657105742]}],
      "Primary Attributes/Intelligence": [0.02824,{"n":[1.5488398486831354,0.0009639262473747871]}],
      "Primary Attributes/Wisdom": [0.02824,{"n":[2.0012358496978564,0.0015881875667196346]}],
      "Proficiency/Deprecating": [0.0282,{"n":[5.871655115512105,0.0017804921341651044]}],
      "Proficiency/Elemental": [0.0282,{"n":[2.3181649492650886,0.0012044172487836841]}],
      "Proficiency/Forbidden": [0.0282,{"n":[2.317206523328219,0.0012046661492418288]}],
      "Spell Damage/Dark": [0.00502,{"n":[3.419149982393531,0.004003101439298213]}],
      "Spell Damage/Elec": [0.00502,{"n":[2.1652165326930986,0.0017418956600945398]}],
      "Spell Damage/Wind": [0.00502,{"n":[2.1652165326930986,0.0017418956600945398]}],
    },
  };
  // END GENERATED EQUIPMENT DATA

  const typesByLength = Object.keys(equipmentTypes).sort((a, b) => b.length - a.length);

  function parseName(name) {
    const normalized = clean(name);
    const quality = qualities.exec(normalized)?.[1].toLowerCase();
    const [, core, suffixText = ''] = /^(.*?)(?: of (.+))?$/i.exec(normalized.replace(qualities, ''));
    const lower = core.toLowerCase();
    const type = typesByLength.find(candidate =>
      lower === candidate.toLowerCase() || lower.endsWith(` ${candidate.toLowerCase()}`));
    if (!type) return null;
    const prefix = clean(core.slice(0, -type.length)).toLowerCase();
    const suffix = suffixText.toLowerCase().replace(/^the /, '')
      .replace(/^bansheee$/, 'banshee').replace(/^stone-skin$/, 'stoneskin');
    const [category, slot, canonical = type] = equipmentTypes[type];
    return { type: canonical ?? type, category, slot, prefix, suffix, quality };
  }

  function equipmentName(panel) {
    const title = panel.firstElementChild;
    const original = /^\((.+)\)$/.exec(clean(title?.lastElementChild?.textContent))?.[1];
    return original ?? clean((title?.querySelector('a') ?? title)?.textContent);
  }

  function statSectionHeading(section) {
    const heading = section.firstElementChild;
    // The translation wrapper adds a child to the heading. Stat rows still
    // have at least two children: the label and the value.
    return section.matches('.ep') && heading?.childElementCount < 2 ? heading : null;
  }

  function readStats(eq) {
    const stats = new Map();
    const strikes = new Map();
    function record(key, node, text, tooltip = null, normalized = false) {
      const base = /^Base:\s*(\d+(?:\.\d+)?)$/i.exec(tooltip?.title ?? '');
      const match = number.exec(clean(text));
      const value = normalized ? null
        : match ? Number(match[0].replace(/[\s,]/g, '')) : /^None$/i.test(clean(text)) ? 0 : null;
      stats.set(key, {
        base: base ? Number(base[1]) : null,
        value, node, tooltip: base ? tooltip : null,
        step: 10 ** -(match?.[1]?.length ?? 0),
      });
    }
    for (const section of eq.children) {
      if (section.matches('.ex, .ep')) {
        const rows = [...section.children];
        const heading = statSectionHeading(section);
        const group = heading ? clean(rows.shift().textContent) : 'Equipment';
        for (const row of rows) {
          let name = clean(row.children[0]?.textContent);
          if (!name || !row.children[1]) continue;
          if (group === 'Equipment' && /^(?:Attack|Physical|Slashing|Crushing|Piercing|Void) Damage$/i.test(name)) {
            name = 'Physical Damage';
          }
          if (name === 'Lightning') name = 'Elec';
          name = name.replace(/^counter-(parry|resist)$/i, (_, end) => `Counter-${end.toLowerCase()}`);
          const value = clean(row.children[1].textContent);
          const normalized = row.title.startsWith('Base:') && !value.startsWith('+') && value.endsWith('%');
          record(statKey(group, name), row.children[1], value, row, normalized);
        }
      } else if (section.matches('.eqc')) {
        for (const [, name, value] of clean(section.textContent).matchAll(/(Burden|Interference):\s*(\S+)/g)) {
          record(equipKey(name), section, value);
        }
      } else if (section.matches('div') && !section.matches('.eqt, .eqr')) {
        const text = clean(section.textContent);
        const physical = physicalDamageRow.exec(text);
        if (physical) {
          record(equipKey('Physical Damage'), section, physical[1], section, physical[2] === '%');
        } else {
          const amountFirst = /^(\+?\s*[\d.]+%?)\s+(Max(?:imum)? [HM]P|[HM]P Bonus|Health Bonus|Mana Bonus|Hit Points|Magic Points|[HM]P|Counter-Parry|Counter-Resist)$/i.exec(text);
          const labelFirst = /^(Max(?:imum)? [HM]P|[HM]P Bonus|Health Bonus|Mana Bonus|Hit Points|Magic Points|[HM]P|Counter-Parry|Counter-Resist)\s*:?\s*(\+?\s*[\d.]+%?)$/i.exec(text);
          const [name, value] = amountFirst ? [amountFirst[2], amountFirst[1]] : labelFirst?.slice(1) ?? [];
          if (name) record(equipKey(name.replace(/^counter-(parry|resist)$/i,
            (_, end) => `Counter-${end.toLowerCase()}`)), section, value, section);
        }
        for (const [, label, percent] of text.matchAll(/\b(Fire|Cold|Elec|Lightning|Wind|Holy|Dark|Void|Soul) Strike\s*\(([\d.]+)%\)/gi)) {
          const element = /^lightning$/i.test(label) ? 'Elec' : label[0].toUpperCase() + label.slice(1).toLowerCase();
          strikes.set(element, Number(percent));
        }
      }
    }
    return { stats, strikes };
  }

  function modelFor(item, stats) {
    const rows = coefficients[item.type];
    const scope = item.category.endsWith('Armor') ? item.type.split(' ')[0] : item.type;
    const rules = sharedAffixRules[scope] ?? {};
    const multiplier = slotMultiplier[item.slot] ?? 1;
    const bases = [...stats.values()].flatMap(stat => stat.base === null ? [] : [stat.base]);
    const average = bases.length ? Math.round(bases.reduce((a, b) => a + b, 0) / bases.length) : null;
    const knownAffixes = [item.prefix, item.suffix].every((name, i) => !name || affixEffects[i][name]);
    const effects = [affixEffects[0][item.prefix] ?? [], affixEffects[1][item.suffix] ?? []];

    function terms(key, baseOverride = null) {
      if (!knownAffixes) return null;
      const definition = rows?.[key];
      const name = key.split('/')[1];
      const active = effects.map((effect, i) => effect.includes(key) ? `${i ? 's' : 'p'}:${i ? item.suffix : item.prefix}/${key}` : null)
        .filter(Boolean);
      if (!definition && !active.length) return null;
      let [scale, components = {}] = definition ?? [];
      const stat = stats.get(key);
      const native = components.n;
      const loadMultiplier = active.reduce((product, selector) => product * (loadMultipliers[selector] ?? 1), 1);
      if (loadMultiplier === 0) return { scale: 0, parts: [[0, 0, 0]], p: 1 };
      if (!native && stat?.base != null) return null;
      const meanBase = baseOverride ?? average;
      const base = baseOverride ?? (avgNative.has(name) ? average : stat?.base);
      // An optional primary attribute can be absent from the item and supplied
      // entirely by an affix. In that case the panel has no native Base tooltip.
      const affixOnlyAttribute = stat && stat.base == null && key.startsWith('Primary Attributes/') && active.length;
      const parts = [];
      if (native && !affixOnlyAttribute) {
        if (native[0] === null || base == null) return null;
        parts.push([base, ...native.map(coefficient => coefficient * loadMultiplier)]);
      }
      for (const selector of active) {
        if (selector in loadMultipliers) continue;
        const rule = rules[selector];
        if (rule) {
          const [k1, k2, k3] = sharedAffixCoefficients[rule];
          scale ??= k3;
          parts.push([meanBase, k1 * multiplier, k2 * multiplier, selector]);
          continue;
        }
        const fit = components[selector.split('/', 1)[0]];
        if (fit?.[0] == null) return null;
        parts.push([meanBase, ...fit, selector]);
      }
      if (!parts.length || !Number.isFinite(scale)) return null;
      return { scale, parts, p: avgNative.has(name) ? 1 : exponent };
    }

    function scaleFor(key) {
      if (rows?.[key]) return rows[key][0];
      for (const [i, affix] of [item.prefix, item.suffix].entries()) {
        const rule = rules[`${i ? 's' : 'p'}:${affix}/${key}`];
        if (rule) return sharedAffixCoefficients[rule][2];
      }
      return null;
    }

    function isCharmOnly(key) {
      return Boolean(rows && knownAffixes && stats.get(key)?.base == null &&
        !rows[key]?.[1]?.n && !effects.some(effect => effect.includes(key)));
    }

    return { terms, scaleFor, isCharmOnly, average, effects, knownAffixes };
  }

  function unscaled(model, average) {
    if (!model || model.parts.some(([base]) => (base ?? average) == null)) return null;
    return model.parts.reduce((sum, [base, k1, k2]) => sum + k1 + k2 * effectiveBase(base ?? average) ** model.p, 0);
  }

  const weapon = item => item && ['One-handed Weapon', 'Two-handed Weapon', 'Staff'].includes(item.category);
  const weaponCharmStats = new Set([
    'Physical Damage', 'Magic Damage', 'Attack Accuracy', 'Magic Accuracy',
    'Attack Speed', 'Casting Speed', 'Mana Conservation', 'Attack Crit Damage',
    'Magic Crit Damage', 'Counter-parry', 'Counter-resist',
  ].map(equipKey));
  const tolerance = stat => Math.max(stat.step, Math.abs(stat.value) * 0.0005);

  const proofBonuses = item => [0, 12, 20].map(value => value * (slotMultiplier[item.slot] ?? 1));

  function estimateInteger(observations, min, max, required) {
    if (observations.length < required) return null;
    let numerator = 0;
    let denominator = 0;
    for (const { value, error, intercept, slope } of observations) {
      numerator += (value - intercept) * slope / error ** 2;
      denominator += (slope / error) ** 2;
    }
    if (!denominator) return null;
    const estimate = Math.round(numerator / denominator);
    if (!Number.isFinite(estimate) || estimate < min || estimate > max) return null;
    const loss = observations.reduce((sum, { value, error, intercept, slope }) =>
      sum + ((value - intercept - slope * estimate) / error) ** 2, 0);
    return loss / observations.length <= 4 && 1 / Math.sqrt(denominator) <= 1.5 ? Math.max(min, estimate) : null;
  }

  function reconstruct(item, stats, model, header, current, unbound) {
    const tier = tierPattern.exec(header);
    const shownLevel = /\bLevel\s*:?\s*(\d+)/i.exec(header);
    let level = shownLevel ? Number(shownLevel[1]) : null;
    let upgrades = tier ? Number(tier[1]) + Number(tier[2]) : unbound ? 0 : null;
    const inferred = [];
    if (!item || !model || (!tier && !shownLevel)) return { tier, level, upgrades, inferred };
    const observations = [];
    const affixObservations = [];
    for (const [key, stat] of stats) {
      if (stat.value == null || elementalMitigation.test(key) ||
          avgNative.has(key.split('/')[1]) || (weapon(item) && weaponCharmStats.has(key))) continue;
      const definition = model.terms(key);
      const raw = unscaled(definition);
      if (raw === null || raw <= 0 || (tier && !definition.scale)) continue;
      const intercept = tier ? raw * (1 + upgrades * rate(key)) : raw * (1 + level * definition.scale);
      const slope = intercept * (tier ? definition.scale : rate(key));
      const observation = { value: stat.value, error: tolerance(stat), intercept, slope };
      if (stat.base != null && definition.parts.length === 1) observations.push(observation);
      else affixObservations.push(observation);
    }
    const required = 2;
    const all = [...observations, ...affixObservations];
    if (tier) {
      level = estimateInteger(observations, 1, Infinity, required) ??
        estimateInteger(all, 1, Infinity, required);
    } else if (!unbound) {
      upgrades = estimateInteger(observations, 0, Infinity, required) ??
        estimateInteger(all, 0, Infinity, required) ?? (current ? 0 : null);
    }
    if (current) {
      const hasRolledAffix = model.effects.some(effect => effect.some(key =>
        stats.has(key) && !avgNative.has(key.split('/')[1])));
      const affixBase = model.knownAffixes && hasRolledAffix ? model.average : null;
      return { tier, level, upgrades, inferred, affixBase };
    }
    return { tier, level, upgrades, inferred };
  }


  function inferLegacyAffixBases(item, stats, model, level, upgrades, sourceCharms) {
    const rows = [];
    const baselines = new Map();
    const charmCandidates = new Map();
    const minimum = minimumLegacyAffixBase[item.quality] ?? 0;
    for (const [key, stat] of stats) {
      if (stat.value == null || avgNative.has(key.split('/')[1])) continue;
      const definition = model.terms(key);
      if (!definition) {
        if (model.isCharmOnly(key)) baselines.set(key, 0);
        continue;
      }
      const scale = (1 + level * definition.scale) * (1 + upgrades * rate(key));
      const parts = definition.parts.filter(part => part[3]);
      if (!parts.length) {
        const raw = unscaled(definition);
        if (raw != null) baselines.set(key, raw * scale);
      }
      // An isolated roll can be inverted after subtracting the native contribution.
      if (parts.length !== 1) continue;
      const [, k1, k2, selector] = parts[0];
      const native = unscaled({ ...definition, parts: definition.parts.filter(part => !part[3]) });
      if (!(k2 > 0) || native == null) continue;
      rows.push({ key, stat, selector, scale, k1, k2, native, p: definition.p });
    }
    const possibleCharms = weapon(item) ? [...meleeCharms, ...magicCharms] : defenseCharms;
    const known = charmEffects(sourceCharms, item, stats, level).modifiers;
    const unresolvedVoid = sourceCharms.get('Hollowforged or Voidseeker');
    const uncertain = upgrades === 0 ? [] : possibleCharms.flatMap(name => {
      if (sourceCharms.has(name)) return [];
      if (name === 'Voidseeker' && !unresolvedVoid && nativeStrikes[item.prefix] !== 'Void') return [];
      const { modifiers } = charmEffects(new Map([[name, 1]]), item, stats, level);
      if (!modifiers.size) return [];
      return [{ name, keys: [...modifiers.keys()], strengths: unresolvedVoid && name === 'Voidseeker'
        ? [0, unresolvedVoid] : [0, 1, 2] }];
    });

    function estimate(row, modifier, widen = false) {
      const { stat, scale, k1, k2, native, p } = row;
      const { add = 0, factor = 1 } = modifier ?? {};
      if (add == null) return null;
      const powerAt = value => ((value - add) / (scale * factor) - native - k1) / k2;
      const power = powerAt(stat.value);
      if (!Number.isFinite(power) || power < 0) return null;
      const baseAt = value => Math.round(displayedBase(Math.max(0, powerAt(value)) ** (1 / p)));
      const margin = widen ? Math.max(tolerance(stat), Math.abs(stat.value - add) * 0.003) : stat.step / 2;
      const min = Math.max(minimum, baseAt(stat.value - margin));
      const max = Math.min(peerlessBase, baseAt(stat.value + margin));
      if (min > max) return null;
      return { key: row.key, base: Math.min(max, Math.max(min, baseAt(stat.value))), min, max };
    }

    const inferred = [item.prefix, item.suffix].flatMap((affix, i) => {
      const affixRows = rows.filter(row => row.selector.startsWith(i ? 's:' : 'p:'));
      if (!affixRows.length) return [];
      const title = affix.replace(/\b[a-z]/g, letter => letter.toUpperCase());
      const relevant = uncertain.filter(({ keys }) => affixRows.some(row => keys.includes(row.key)));
      const companionKeys = new Set(relevant.flatMap(({ keys }) => keys.filter(key => baselines.has(key))));
      const selections = relevant.reduce((options, { name, strengths }) => options.flatMap(option =>
        strengths.map(quality => quality ? new Map([...option, [name, quality]]) : option)),
      [new Map(sourceCharms)]);

      function commonBase(selection, widen) {
        const { modifiers } = charmEffects(selection, item, stats, level);
        for (const key of companionKeys) {
          const stat = stats.get(key);
          const baseline = baselines.get(key);
          const { add = 0, factor = 1 } = modifiers.get(key) ?? {};
          if (add == null || Math.abs(stat.value - (baseline * factor + add)) >
              Math.max(tolerance(stat), Math.abs(baseline) * 0.003)) return null;
        }
        const entries = affixRows.map(row => estimate(row, modifiers.get(row.key), widen));
        if (entries.some(entry => !entry)) return null;
        const min = Math.max(...entries.map(entry => entry.min));
        const max = Math.min(...entries.map(entry => entry.max));
        if (min > max) return null;
        const best = entries.reduce((a, b) => a.max - a.min <= b.max - b.min ? a : b);
        return { base: Math.min(max, Math.max(min, best.base)), selection };
      }

      let matches = selections.map(selection => commonBase(selection, false)).filter(Boolean);
      if (!matches.length && relevant.length && affixRows.length > 1) {
        matches = selections.map(selection => commonBase(selection, true)).filter(Boolean);
      }
      if (matches.length) {
        for (const { name } of relevant) {
          const candidates = charmCandidates.get(name) ?? new Set();
          for (const { selection } of matches) candidates.add(selection.get(name) ?? 0);
          charmCandidates.set(name, candidates);
        }
        const bases = new Set(matches.map(match => match.base));
        if (bases.size === 1) return [`${title} \u2248 ${matches[0].base}`];
        const varying = relevant.filter(({ name }) => new Set(matches.map(({ selection }) => selection.get(name) ?? 0)).size > 1);
        const descriptions = matches.map(({ base, selection }) => {
          const assumptions = varying.map(({ name }) => selection.has(name)
            ? `${selection.get(name) === 2 ? 'Greater' : 'Lesser'} ${name}` : `no ${name}`);
          return `\u2248 ${base} (${assumptions.join(', ')})`;
        });
        return [`${title} ${[...new Set(descriptions)].join(' or ')}`];
      }

      // Legacy items can have different rolls for different stats.
      const details = affixRows.filter(row => !relevant.some(({ keys }) => keys.includes(row.key)))
        .map(row => estimate(row, known.get(row.key))).filter(Boolean).map(({ key, base }) => {
          const [group, name] = key.split('/');
          const label = ['Spell Damage', 'Proficiency', 'Damage Mitigation'].includes(group) ? `${name} ${group}` : name;
          return `${label} \u2248 ${base}`;
        });
      return details.length ? [`${title} (${details.join(', ')})`] : [];
    });
    return { inferred, charmCandidates, uncertain };
  }

  function addedArchmageDamage(level, hands, greater) {
    if (level == null) return null;
    if (hands === 1 && !greater) return Math.ceil(level / 5) + 6;
    return Math.ceil(level / (greater ? 3 : 5)) * hands * (greater ? 1.10 : 1.06);
  }

  function inferCharms(item, stats, strikes, model, { level, upgrades }, current, tier) {
    const charms = [];
    const offsets = new Map();
    const label = charmLabel;
    const strength = [0, 1, 2];
    const select = (stat, options) => {
      if (stat?.value == null) return null;
      const matches = options.filter(option => Math.abs(stat.value - option.value) <= Math.max(tolerance(stat), option.error ?? 0));
      return matches.length === 1 ? matches[0] : null;
    };
    function baseline(key) {
      if (!model?.knownAffixes) return null;
      const definition = model.terms(key);
      if (!definition) return model.isCharmOnly(key) ? 0 : null;
      const raw = unscaled(definition);
      if (raw == null || (definition.scale && level == null) || upgrades == null) return null;
      return raw * (1 + (level ?? 0) * definition.scale) * (1 + upgrades * rate(key));
    }
    function check(name, key, base, lesser, greater, multiply = false) {
      if (!multiply) offsets.set(key, null);
      if (base == null) return;
      const values = [0, lesser, greater];
      const match = select(stats.get(key), strength.map(quality => ({
        quality,
        value: multiply ? base * (1 + values[quality]) : base + values[quality],
        error: Math.abs(base) * 0.003,
      })));
      if (!multiply && match) offsets.set(key, values[match.quality]);
      if (match?.quality) charms.push(label(name, match.quality));
    }
    if (!item) return { charms, reason: 'Unknown equipment type' };
    if ((current && !tier && upgrades == null) || upgrades === 0) return { charms, reason: 'None' };

    if (weapon(item)) {
      const natural = nativeStrikes[item.prefix];
      for (const [element, percent] of strikes) {
        if (element === natural || !elements.includes(element)) continue;
        if (percent === 30 || percent === 50) charms.push(label(`${element === 'Elec' ? 'Lightning' : element} Strike`, percent === 50 ? 2 : 1));
      }
      const voidStrike = natural === 'Void' ? null : strikes.get('Void');
      if (voidStrike === 30 || voidStrike === 50) {
        const quality = voidStrike === 50 ? 2 : 1;
        const key = equipKey('Attack Accuracy');
        const stat = stats.get(key);
        const base = baseline(key);
        let offset = null;
        if (!stat) {
          // Voidseeker adds at least 10 Attack Accuracy, even if the item has none.
          offset = 0;
        } else if (base != null) {
          const error = Math.abs(base) * 0.003;
          const match = select(stat, [
            { value: base, add: 0, error },
            { value: base * accuracyMultiplier(quality) + 10, add: 10, error },
          ]);
          offset = match?.add ?? null;
        }
        const name = offset === null ? 'Hollowforged or Voidseeker' : offset ? 'Voidseeker' : 'Hollowforged';
        offsets.set(key, offset);
        charms.push(label(name, quality));
      }
      for (const [name, stat, lesser, greater, multiply] of [
        ['Butcher', 'Physical Damage', 0.06, 0.10, true],
        ['Swiftness', 'Attack Speed', 5, 7.5],
        ['Fatality', 'Attack Crit Damage', 0.06, 0.10],
        ['Overpower', 'Counter-parry', 12, 20],
        ['Spellweaver', 'Casting Speed', 5, 7.5],
        ['Annihilator', 'Magic Crit Damage', 0.06, 0.10],
        ['Penetrator', 'Counter-resist', 12, 20],
      ]) {
        const key = equipKey(stat);
        check(name, key, baseline(key), lesser, greater, multiply);
      }
      const damageKey = equipKey('Magic Damage');
      const magicDamage = baseline(damageKey);
      if (magicDamage > 0) check('Archmage', damageKey, magicDamage, 0.06, 0.10, true);
      else if (magicDamage === 0 && level != null) {
        const hands = item.category === 'One-handed Weapon' ? 1 : 2;
        const match = select(stats.get(damageKey), [
          { quality: 1, value: addedArchmageDamage(level, hands, false) },
          { quality: 2, value: addedArchmageDamage(level, hands, true) },
        ]);
        if (match) charms.push(label('Archmage', match.quality));
      }

      // Economizer and Aether can both contribute to the same Mana Conservation row.
      const manaKey = equipKey('Mana Conservation');
      const accuracyKey = equipKey('Magic Accuracy');
      const mana = baseline(manaKey);
      const accuracy = baseline(accuracyKey);
      const manaStat = stats.get(manaKey);
      const accuracyStat = stats.get(accuracyKey);
      const accuracyMatch = accuracy == null ? null : select(accuracyStat, strength.map(a => ({
        a, value: a ? accuracy * (a === 2 ? 1.3 : 1.2) + 10 : accuracy, error: accuracy * 0.003,
      })));
      if (accuracyStat) offsets.set(accuracyKey, accuracyMatch ? (accuracyMatch.a ? 10 : 0) : null);
      if (manaStat) offsets.set(manaKey, null);
      let aetherQuality = accuracyMatch?.a;
      if (mana != null && manaStat?.value != null) {
        const twoHanded = item.category !== 'One-handed Weapon' && !['focus', 'battlecaster'].includes(item.suffix);
        const economizer = twoHanded ? [0, 15, 25] : [0, 10, 15];
        const aether = item.category === 'Staff' ? [0, 6, 10] : [0, 3, 5];
        const options = strength.flatMap(e => strength.map(a => ({
          e, a, value: mana + economizer[e] + aether[a], error: mana * 0.003,
        }))).filter(({ a }) => accuracy == null || accuracyStat?.value == null ||
          Math.abs(accuracyStat.value - (a ? accuracy * (a === 2 ? 1.3 : 1.2) + 10 : accuracy)) <=
          Math.max(tolerance(accuracyStat), accuracy * 0.003));
        const match = select(manaStat, options);
        if (match) offsets.set(manaKey, economizer[match.e] + aether[match.a]);
        if (match?.e) charms.push(label('Economizer', match.e));
        aetherQuality ??= match?.a;
      }
      if (aetherQuality) charms.push(label('Aether', aetherQuality));
    } else {
      const multiplier = slotMultiplier[item.slot];
      const [, lesserProof, greaterProof] = proofBonuses(item);
      for (const element of elements) {
        const key = statKey('Damage Mitigation', element);
        check(`${element === 'Elec' ? 'Lightning' : element}-proof`, key,
          baseline(key), lesserProof, greaterProof);
      }
      for (const [index, name] of ['Juggernaut', 'Capacitor'].entries()) {
        const pattern = vitalAliases[index];
        const key = [...stats.keys()].find(key => pattern.test(key.split('/')[1]));
        if (key) check(name, key, 0, 6 * multiplier, 10 * multiplier);
      }
    }

    const load = ['Burden', 'Interference'].flatMap(name => {
      const key = equipKey(name);
      const value = stats.get(key)?.value;
      const base = unscaled(model?.terms(key), model?.average);
      return base > 0 && value != null ? [{ base, value }] : [];
    });
    const featherweight = strength.filter(quality => load.length && load.every(({ base, value }) =>
      Math.abs(value - Math.max(0, base - featherReduction(base, quality))) <= 0.15));
    // When both strengths give the same readings, simulate the smallest sufficient Charm.
    if (featherweight[0]) charms.push(label('Featherweight', featherweight[0]));
    const featherweightAmbiguous = featherweight[0] === 1 && featherweight.includes(2);
    return { charms, offsets, featherweightAmbiguous, reason: upgrades == null ? 'Forging + IW unknown' : 'No charm identified' };
  }

  function analyze(panel) {
    const eq = panel.querySelector('.eq');
    const header = clean(eq.querySelector('.eqt').textContent);
    const name = equipmentName(panel);
    const item = parseName(name);
    const { stats, strikes } = readStats(eq);
    const model = item && modelFor(item, stats);
    const current = [...panel.querySelectorAll('p')].some(node => currentVersionMarkers.test(clean(node.textContent)));
    const bound = tierPattern.test(header) || /\bSoul(?:bound|fused)\b/i.test(panel.textContent);
    const unbound = current && !bound;
    const result = reconstruct(item, stats, model, header, current, unbound);
    const charm = unbound ? null : inferCharms(item, stats, strikes, model, result, current, result.tier);
    const sourceCharms = new Map();
    for (const label of charm?.charms ?? []) {
      const [, type, size] = /^(.*) \((Lesser|Greater)\)$/.exec(label);
      sourceCharms.set(type, size === 'Greater' ? 2 : 1);
    }
    if (!current && item && result.level != null && result.upgrades != null) {
      const { inferred, charmCandidates, uncertain } = inferLegacyAffixBases(
        item, stats, model, result.level, result.upgrades, sourceCharms);
      result.inferred = inferred;
      // Reuse Charm strengths agreed on by the viable affix fits in the preview.
      for (const [name, candidates] of charmCandidates) {
        if (candidates.size !== 1) continue;
        const [quality] = candidates;
        if (!quality) continue;
        if (name === 'Voidseeker') {
          sourceCharms.delete('Hollowforged or Voidseeker');
          charm.charms = charm.charms.filter(label => !label.startsWith('Hollowforged or Voidseeker '));
        }
        sourceCharms.set(name, quality);
        charm.charms.push(charmLabel(name, quality));
      }
      const { modifiers } = charmEffects(sourceCharms, item, stats, result.level);
      for (const [key, offset] of charm.offsets ?? []) {
        const candidates = uncertain.filter(candidate => candidate.keys.includes(key));
        if (offset === null && candidates.length &&
            candidates.every(({ name }) => charmCandidates.get(name)?.size === 1)) {
          charm.offsets.set(key, modifiers.get(key)?.add ?? 0);
        }
      }
    }
    return { result, charm, sourceCharms, item, model, eq: eq.cloneNode(true), header, name, bound };
  }

  function replacePanelNumber(node, value, step) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const digits = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/;
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const match = digits.exec(text.data);
      if (!match) continue;
      const parts = value.toFixed(Math.round(-Math.log10(step))).split('.');
      if (match[0].includes(',')) parts[0] = parts[0].replace(/\B(?=(\d{3})+$)/g, ',');
      const formatted = parts.join('.');
      text.replaceData(match.index, match[0].length, formatted);
      break;
    }
  }

  function charmEffects(selection, item, stats, level) {
    const modifiers = new Map();
    const strikes = new Map();
    const hands = item.category === 'One-handed Weapon' ? 1 : 2;
    const staff = item.category === 'Staff';
    const slot = slotMultiplier[item.slot] ?? 1;
    const effect = (key, add, factor = 1) => {
      const old = modifiers.get(key) ?? { add: 0, factor: 1 };
      modifiers.set(key, { add: old.add + add, factor: old.factor * factor });
    };
    const equipment = (name, add, factor) => effect(equipKey(name), add, factor);
    const strike = (element, percent) => strikes.set(element, (strikes.get(element) ?? 0) + percent);
    const flat = {
      Swiftness: ['Attack Speed', 5, 7.5],
      Fatality: ['Attack Crit Damage', 0.06, 0.10],
      Overpower: ['Counter-parry', 12, 20],
      Spellweaver: ['Casting Speed', 5, 7.5],
      Annihilator: ['Magic Crit Damage', 0.06, 0.10],
      Penetrator: ['Counter-resist', 12, 20],
    };
    let voidDamage = false;
    for (const [type, size] of selection) {
      const greater = size === 2;
      const damageFactor = greater ? 1.10 : 1.06;
      const accuracyFactor = accuracyMultiplier(size);
      const strikePercent = greater ? 50 : 30;
      if (Object.hasOwn(flat, type)) {
        const [name, lesser, higher] = flat[type];
        equipment(name, greater ? higher : lesser);
      } else if (Object.hasOwn(strikeCharms, type)) {
        strike(strikeCharms[type], strikePercent);
      } else if (['Hollowforged', 'Voidseeker', 'Hollowforged or Voidseeker'].includes(type)) {
        voidDamage = true;
        strike('Void', strikePercent);
        if (type === 'Voidseeker') equipment('Attack Accuracy', 10, accuracyFactor);
      } else if (type === 'Butcher') {
        equipment('Physical Damage', 0, damageFactor);
      } else if (type === 'Archmage') {
        const native = staff || stats.get(equipKey('Magic Damage'))?.base != null;
        const add = native ? 0 : addedArchmageDamage(level, hands, greater);
        if (add == null) modifiers.set(equipKey('Magic Damage'), { add: null, factor: damageFactor });
        else equipment('Magic Damage', add, damageFactor);
      } else if (type === 'Economizer') {
        const twoHanded = hands === 2 && !['focus', 'battlecaster'].includes(item.suffix);
        equipment('Mana Conservation', twoHanded ? (greater ? 25 : 15) : (greater ? 15 : 10));
      } else if (type === 'Aether') {
        equipment('Magic Accuracy', 10, accuracyFactor);
        equipment('Mana Conservation', (staff ? 2 : 1) * (greater ? 5 : 3));
      } else if (type === 'Juggernaut' || type === 'Capacitor') {
        const index = Number(type === 'Capacitor');
        const key = [...stats.keys()].find(key => vitalAliases[index].test(key.split('/')[1]));
        effect(key ?? equipKey(index ? 'MP Bonus' : 'HP Bonus'), (greater ? 10 : 6) * slot);
      } else if (type.endsWith('-proof')) {
        const element = elements.find(element => type === `${elementLabel(element)}-proof`);
        effect(statKey('Damage Mitigation', element), (greater ? 20 : 12) * slot);
      }
    }
    return { modifiers, strikes, voidDamage, featherweight: selection.get('Featherweight') ?? 0 };
  }

  function addPreviewStat(copy, key, value) {
    const [group, name] = key.split('/');
    let section = [...copy.children].find(node => group === 'Equipment'
      ? node.matches('.ex') : clean(statSectionHeading(node)?.textContent) === group);
    if (!section) {
      section = document.createElement('div');
      section.className = group === 'Equipment' ? 'ex' : 'ep';
      if (group !== 'Equipment') {
        const heading = document.createElement('div');
        heading.textContent = group;
        section.append(heading);
      }
      copy.append(section);
    }
    const row = document.createElement('div');
    const label = document.createElement('div');
    const amount = document.createElement('div');
    label.textContent = name;
    amount.textContent = `+${value.toFixed(2)}`;
    row.append(label, amount);
    if (name !== 'Magic Damage' && name !== 'Magic Accuracy') {
      const unit = document.createElement('div');
      unit.textContent = name.endsWith('Crit Damage') ? ' x' : ' %';
      row.append(unit);
    }
    section.append(row);
  }

  const featherReduction = (value, quality) => quality
    ? Math.max(quality === 2 ? 10 : 5, value * (quality === 2 ? 0.5 : 0.3)) : 0;

  function previewLoad(stats, model, actual, selected, baseOverride) {
    if (baseOverride == null && actual === selected) return 0;
    let unavailable = 0;
    const node = stats.get(equipKey('Burden'))?.node ?? stats.get(equipKey('Interference'))?.node;
    if (!node) return 0;
    for (const name of ['Burden', 'Interference']) {
      const key = equipKey(name);
      const value = stats.get(key)?.value;
      if (value == null) continue;
      let base = value;
      if (baseOverride != null) {
        base = unscaled(model.terms(key, baseOverride)) ?? (value === 0 && !actual ? 0 : null);
      } else if (actual) {
        if (value > 0) base = Math.max(value + featherReduction(0, actual), value / (actual === 2 ? 0.5 : 0.7));
        else base = unscaled(model.terms(key), model.average);
      }
      if (base == null) {
        unavailable++;
        continue;
      }
      const result = Math.max(0, base - featherReduction(base, selected));
      node.textContent = node.textContent.replace(new RegExp(`(${name}:\\s*)(None|[\\d.]+)`), (_, label) =>
        label + (result >= 0.05 ? result.toFixed(1) : 'None'));
    }
    return unavailable;
  }

  function previewStrikes(copy, physical, original, actual, selected, item) {
    for (const element of new Set([...actual.strikes.keys(), ...selected.strikes.keys()])) {
      const delta = (selected.strikes.get(element) ?? 0) - (actual.strikes.get(element) ?? 0);
      if (!delta) continue;
      const row = [...copy.children].find(node =>
        new RegExp(`^(?:${element}|${elementLabel(element)}) Strike \\(\\d+(?:\\.\\d+)?%\\)$`, 'i').test(clean(node.textContent)));
      const percent = (original.get(element) ?? 0) + delta;
      if (percent <= 0) {
        row?.remove();
      } else if (row) {
        replacePanelNumber(row, percent, 1);
      } else {
        const strikeRow = document.createElement('div');
        strikeRow.textContent = `${elementLabel(element)} Strike (${percent}%)`;
        const next = physical?.nextElementSibling;
        if (next) next.before(strikeRow);
        else copy.append(strikeRow);
      }
    }
    if (!physical || actual.voidDamage === selected.voidDamage || item.prefix === 'ethereal') return;
    const type = selected.voidDamage ? 'Void'
      : item.category === 'Staff' || /^(Club|Great Mace)$/.test(item.type) ? 'Crushing'
      : /^(Dagger|Rapier|Estoc)$/.test(item.type) ? 'Piercing' : 'Slashing';
    const walker = document.createTreeWalker(physical, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      text.data = text.data.replace(/\b(?:Slashing|Crushing|Piercing|Void)(?=\s+Damage\b)/i, type);
    }
  }

  function previewPanel({ eq, item, model, result, charm, sourceCharms, bound }, level, forge, iw, cap, selection, preset) {
    const copy = eq.cloneNode(true);
    copy.classList.add('hv-equipment-preview');
    const levelLabel = level == null ? '' : `Lv. ${level} \u00b7 `;
    const previewType = preset ? `${preset.quality} Preview (Base ${preset.base})` : bound ? 'Upgrade preview' : 'Soulbind preview';
    copy.querySelector('.eqt').textContent = `${previewType} \u00b7 ${levelLabel}Tier ${forge} / ${iw} / ${cap}`;
    const { stats, strikes } = readStats(copy);
    const actual = charmEffects(sourceCharms, item, stats, result.level);
    const selected = charmEffects(selection, item, stats, level);
    const sourceUpgrades = result.upgrades ?? 0;
    const targetUpgrades = forge + iw;
    const neutral = { add: 0, factor: 1 };
    let unavailable = previewLoad(stats, model, actual.featherweight, selected.featherweight, preset?.base);
    for (const key of new Set([...stats.keys(), ...selected.modifiers.keys()])) {
      if (avgNative.has(key.split('/')[1])) continue;
      const stat = stats.get(key);
      const fixed = vitalAliases.some(pattern => pattern.test(key.split('/')[1]));
      const inferred = charm?.offsets?.get(key);
      let before = actual.modifiers.get(key) ?? neutral;
      let after = selected.modifiers.get(key) ?? neutral;
      if (preset && stat && !fixed) {
        const definition = model.terms(key, preset.base);
        const raw = unscaled(definition);
        if (raw != null && stat.value != null && after.add != null) {
          const projected = raw * (1 + level * definition.scale) * (1 + targetUpgrades * rate(key)) * after.factor + after.add;
          replacePanelNumber(stat.node, projected, stat.step);
          if (stat.tooltip) stat.tooltip.title = `Base: ${preset.base}`;
          continue;
        }
        // Rows added by a Charm have no equipment roll to replace.
        if (stat.base != null || !(before.add > 0) || stat.value == null ||
            Math.abs(stat.value - before.add) > stat.step / 2) {
          unavailable++;
          continue;
        }
      }
      const changed = before.add !== after.add || before.factor !== after.factor;
      const scale = model.scaleFor(key);
      const rescale = !fixed && (targetUpgrades !== sourceUpgrades ||
        (scale !== 0 && level !== result.level));
      // Unchanged rows do not depend on the source Charm inference.
      if (!rescale && !changed) continue;
      if (before === neutral && after === neutral && inferred != null) {
        before = after = { add: inferred, factor: 1 };
      }
      if ((stat && stat.value == null) || before.add == null || after.add == null ||
          (stat && before === neutral && inferred === null)) {
        unavailable++;
        continue;
      }
      let base = stat ? Math.max(0, (stat.value - before.add) / before.factor) : 0;
      if (stat && before !== neutral && base <= stat.step / 2) base = 0;
      if (base && rescale) {
        if (scale == null && (level !== result.level || !stat.base)) {
          unavailable++;
          continue;
        }
        const targetFactor = (1 + (level ?? 0) * (scale ?? 0)) * (1 + targetUpgrades * rate(key));
        if (result.level == null && level != null && scale) {
          const raw = unscaled(model.terms(key), model.average);
          base = raw == null ? NaN : raw * targetFactor;
        } else {
          const sourceFactor = (1 + (result.level ?? 0) * (scale ?? 0)) * (1 + sourceUpgrades * rate(key));
          base *= targetFactor / sourceFactor;
        }
      }
      const projected = base * after.factor + after.add;
      if (!Number.isFinite(projected)) {
        unavailable++;
        continue;
      }
      if (!stat) {
        if (projected > 0) addPreviewStat(copy, key, projected);
      } else if (!projected && before.add > 0 && stat.base == null) {
        const row = stat.node.parentElement === copy ? stat.node : stat.node.parentElement;
        row.remove();
      } else {
        replacePanelNumber(stat.node, projected, stat.step);
      }
    }
    previewStrikes(copy, stats.get(equipKey('Physical Damage'))?.node, strikes, actual, selected, item);
    return { copy, unavailable };
  }

  function mountPreview(panel, analysis, settings, world, shortcut, readPlayerLevel) {
    const { item, model, result, header, name, bound } = analysis;
    if (!item || !model || (bound && !result.tier) ||
        (!bound && result.level == null && !/\bLevel\s*:?\s*Unassigned\b/i.test(header))) return;
    const original = panel.querySelector('.eq');
    const quality = name.split(/\s/, 1)[0].toLowerCase();
    const [sourceForge, sourceIW, cap] = result.tier?.slice(1).map(Number) ??
      [0, 0, upgradeCaps[quality.replace(/\+$/, '')] ?? 10];
    const controls = document.createElement('div');
    controls.className = 'hv-preview-controls';
    controls.style.cssText = 'display:grid;gap:5px;margin:5px 0';
    const fields = document.createElement('div');
    fields.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px 8px';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:4px';
    controls.append(fields, actions);

    function actionButton(text) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.style.cssText = 'box-sizing:border-box;min-width:0;min-height:3em;padding:2px 4px;line-height:1.2;white-space:normal;overflow-wrap:anywhere';
      actions.append(button);
      return button;
    }

    function input(labelText, min, max, initial) {
      const label = document.createElement('label');
      const field = document.createElement('input');
      field.type = 'number';
      field.min = min;
      field.max = max;
      field.step = 1;
      field.required = true;
      field.value = initial;
      field.style.width = '4em';
      label.append(`${labelText} `, field);
      fields.append(label);
      return field;
    }

    const level = input('Player Lv.', 1, 500, result.level || '');
    if (bound && result.level == null) level.required = false;
    const forge = input('Forging', sourceForge, cap, sourceForge);
    const iw = input('IW', sourceIW, cap, sourceIW);
    const toggle = actionButton(bound ? 'Preview upgrades' : 'Preview Soulbind');
    toggle.title = `Toggle preview (${shortcut})`;
    toggle.setAttribute('aria-keyshortcuts', shortcut);
    toggle.setAttribute('aria-pressed', 'false');
    const qualityButton = quality === 'legendary' ? actionButton('Preview Peerless') : null;
    const titleChanges = [];
    const qualityPrefix = /(^|\()(\s*)Legendary(?=\s|$)/gi;
    if (qualityButton) {
      const walker = document.createTreeWalker(panel.firstElementChild, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const legendary = node.data;
        if (legendary.search(qualityPrefix) !== -1) titleChanges.push({ node, legendary });
      }
    }
    const useLevel = actionButton('Use my level');
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    controls.append(status);

    const editor = document.createElement('details');
    editor.className = 'hv-preview-charms';
    editor.style.cssText = 'margin:4px 0';
    const summary = document.createElement('summary');
    summary.textContent = 'Preview Charms';
    editor.append(summary);
    const choices = document.createElement('div');
    choices.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:4px 10px;text-align:left;margin:4px 0';
    editor.append(choices);
    const available = ['Featherweight'];
    if (weapon(item)) {
      if (item.category !== 'Staff') available.push(...meleeCharms);
      available.push(...magicCharms);
    } else {
      available.push(...defenseCharms);
    }
    for (const type of analysis.sourceCharms.keys()) {
      if (!available.includes(type)) available.push(type);
    }
    const charmFields = new Map();
    for (const type of available) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:4px';
      const field = document.createElement('select');
      for (const [value, text] of ['None', 'Lesser', 'Greater'].entries()) {
        field.add(new Option(text, value));
      }
      field.value = analysis.sourceCharms.get(type) ?? 0;
      label.append(type, field);
      choices.append(label);
      charmFields.set(type, field);
    }
    const resetCharms = document.createElement('button');
    resetCharms.type = 'button';
    resetCharms.textContent = 'Reset Charms';
    editor.append(resetCharms);
    settings.append(controls, editor);

    let preview = null;
    let presetIndex = -1;
    const originalDisplay = original.style.display;
    const originalCharms = panel.querySelector('.hv-equip-lab-charms');
    const originalCharmText = originalCharms?.textContent;
    const charmDetails = originalCharms ?? document.createElement('div');
    charmDetails.className = 'hv-equip-lab-charms';
    const baseDetails = panel.querySelector('.hv-equip-lab-bases');
    const originalBaseText = baseDetails?.textContent;
    const capFor = index => Math.max(cap, qualityPreviews[index]?.cap ?? cap);

    function setQualityPreview(index) {
      const preset = qualityPreviews[index];
      const limit = capFor(index);
      for (const field of [forge, iw]) {
        field.max = limit;
        if (field.valueAsNumber > limit) field.value = limit;
      }
      const equipmentQuality = preset?.equipmentQuality ?? preset?.quality;
      for (const { node, legendary } of titleChanges) {
        node.data = equipmentQuality ? legendary.replace(qualityPrefix, `$1$2${equipmentQuality}`) : legendary;
      }
      if (baseDetails) {
        baseDetails.textContent = preset
          ? originalBaseText.split(' / ').map(text => text.includes(' or \u2248 ')
            ? text.replace(/\u2248 .+$/, `\u2248 ${preset.base}`)
            : text.replace(/(Affix Base: |\u2248 )\d+/g, (_, label) => label + preset.base)).join(' / ')
          : originalBaseText;
      }
      presetIndex = index;
      const next = qualityPreviews[index + 1];
      qualityButton.textContent = index < 0 ? 'Preview Peerless'
        : next ? `Base ${next.base}` : 'Regular preview';
      qualityButton.title = next ? `Preview ${next.quality} (Base ${next.base})` : 'Return to regular preview';
    }

    function restore() {
      preview?.remove();
      preview = null;
      if (presetIndex >= 0) setQualityPreview(-1);
      original.style.display = originalDisplay;
      if (originalCharms) charmDetails.textContent = originalCharmText;
      else charmDetails.remove();
      toggle.textContent = bound ? 'Preview upgrades' : 'Preview Soulbind';
      toggle.setAttribute('aria-pressed', 'false');
      status.textContent = '';
    }

    function update(focusInvalid = false, nextIndex = presetIndex) {
      forge.max = iw.max = Math.max(capFor(presetIndex), capFor(nextIndex));
      const invalid = [level, forge, iw].find(field => !field.validity.valid);
      if (invalid) {
        status.textContent = `Enter a whole number from ${invalid.min} to ${invalid.max}.`;
        forge.max = iw.max = capFor(presetIndex);
        if (focusInvalid) invalid.focus();
        return;
      }
      if (presetIndex !== nextIndex) setQualityPreview(nextIndex);
      if (forge.valueAsNumber > iw.valueAsNumber) iw.value = forge.value;
      const selection = new Map([...charmFields].flatMap(([type, field]) =>
        field.value === '0' ? [] : [[type, Number(field.value)]]));
      const preset = qualityPreviews[presetIndex];
      const playerLevel = level.value === '' ? (preset ? 500 : null) : level.valueAsNumber;
      const next = previewPanel(analysis, playerLevel, forge.valueAsNumber, iw.valueAsNumber, capFor(presetIndex), selection, preset);
      if (preview) preview.replaceWith(next.copy);
      else original.after(next.copy);
      preview = next.copy;
      original.style.display = 'none';
      const charmLabels = [...selection].map(([type, quality]) => charmLabel(type, quality));
      charmDetails.textContent = `Charms: ${charmLabels.join(' / ') || 'None'}`;
      if (!charmDetails.parentElement) original.parentElement.after(charmDetails);
      toggle.textContent = 'Restore original';
      toggle.setAttribute('aria-pressed', 'true');
      status.textContent = next.unavailable ? `${next.unavailable} stats could not be estimated.` : '';
    }

    toggle.addEventListener('click', () => preview ? restore() : update(true));
    qualityButton?.addEventListener('click', () => {
      const nextIndex = presetIndex + 1 < qualityPreviews.length ? presetIndex + 1 : -1;
      if (presetIndex < 0 && level.value === '' && !level.validity.badInput) level.value = '500';
      update(true, nextIndex);
    });
    controls.addEventListener('input', event => {
      if (event.target === iw && iw.validity.valid && forge.validity.valid && iw.valueAsNumber < forge.valueAsNumber) {
        forge.value = iw.value;
      } else if (event.target === forge && forge.validity.valid && iw.validity.valid && forge.valueAsNumber > iw.valueAsNumber) {
        iw.value = forge.value;
      }
      update();
    });
    editor.addEventListener('change', () => update());
    resetCharms.addEventListener('click', () => {
      for (const [type, field] of charmFields) field.value = analysis.sourceCharms.get(type) ?? 0;
      update();
    });
    useLevel.addEventListener('click', async () => {
      useLevel.disabled = true;
      const existing = level.value;
      try {
        const playerLevel = await readPlayerLevel(world);
        if (settings.isConnected && level.value === existing) {
          level.value = playerLevel;
          update();
        }
      } catch {
        status.textContent = 'Could not read your character level. Enter it manually.';
      } finally {
        useLevel.disabled = false;
      }
    });
    return () => toggle.click();
  }

  function render(panel, { result, charm }) {
    panel.dataset.hvEquipLab = 'done';
    const header = panel.querySelector('.eqt');
    const insertDetails = (className, text) => {
      const details = document.createElement('div');
      details.className = className;
      details.textContent = text;
      header.closest('.eq').parentElement.after(details);
    };
    const { tier, level, upgrades, inferred, affixBase } = result;
    if (tier || (charm && upgrades != null)) {
      const label = document.createElement('span');
      label.className = 'hv-equip-lab';
      label.style.marginLeft = '0.6em';
      label.textContent = tier
        ? level == null ? 'Lv. unknown' : `@ Lv. ${level}`
        : `Forging + IW \u2248 ${upgrades}`;
      function ensureLabel() {
        // A page rewrite can replace the original label with an identical copy.
        const [existing, ...duplicates] = header.querySelectorAll('.hv-equip-lab');
        if (!existing) header.append(label);
        for (const duplicate of duplicates) duplicate.remove();
      }
      ensureLabel();
      if (tier) new MutationObserver(ensureLabel).observe(header, { childList: true });
    }
    if (affixBase != null) insertDetails('hv-equip-lab-bases', `Affix Base: ${affixBase}`);
    else if (inferred.length) insertDetails('hv-equip-lab-bases', `Inferred Base: ${inferred.join(' / ')}`);
    if (charm) {
      const labels = charm.charms.map(label => charm.featherweightAmbiguous && label === 'Featherweight (Lesser)'
        ? 'Featherweight (Lesser or Greater)' : label);
      insertDetails('hv-equip-lab-charms', `Charms: ${labels.join(' / ') || charm.reason}`);
    }
  }

  const equipmentPath = /^\/(isekai\/)?equip\/\d+\/[a-z0-9]+\/?$/i;

  function equipmentLink(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Enter a complete HentaiVerse equipment link.');
    }
    const match = equipmentPath.exec(url.pathname);
    if (url.protocol !== 'https:' || !['hentaiverse.org', 'alt.hentaiverse.org'].includes(url.host) ||
        url.username || url.password || !match) {
      throw new Error('Enter a valid HentaiVerse equipment link with its equipment key.');
    }
    return { path: url.pathname, world: match[1] ? 'isekai' : 'persistent' };
  }

  async function fetchPage(path) {
    const response = await fetch(new URL(path, location.origin).href, {
      mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HentaiVerse returned HTTP ${response.status}.`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  async function fetchEquipment(path) {
    const page = await fetchPage(path);
    const panel = page.querySelector('.showequip');
    if (!panel?.querySelector('.eq .eqt') || !readStats(panel.querySelector('.eq')).stats.size) {
      throw new Error('No equipment data was returned. Check the link and your HentaiVerse login.');
    }
    return panel;
  }

  function readPlayerLevel(world) {
    const path = world === 'isekai' ? '/isekai/' : '/';
    return fetchPage(`${path}?s=Character&ss=ch`).then(page => {
      const readout = page.querySelector('#level_readout .fc4') ?? page.querySelector('#level_readout');
      const level = Number(/\bLv\.\s*(\d+)\b/i.exec(readout?.textContent ?? '')?.[1]);
      if (!Number.isInteger(level) || level < 1 || level > 500) throw new Error('Character level unavailable.');
      return level;
    });
  }

  function importedPanel(source, analysis, path) {
    // Copy only equipment readout content. Keep the fetched page and its handlers detached.
    const classes = new Set(['eq', 'eqt', 'eqr', 'eqc', 'eqs', 'ex', 'ep', 'ep1', 'ep2', 'ep3']);
    function copyReadout(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.data);
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      if (!['div', 'span'].includes(node.localName)) return null;
      const copy = document.createElement(node.localName);
      copy.className = [...node.classList].filter(name => classes.has(name)).join(' ');
      if (/^Base:\s*\d+(?:\.\d+)?$/i.test(node.title)) copy.title = node.title;
      for (const child of node.childNodes) {
        const content = copyReadout(child);
        if (content) copy.append(content);
      }
      return copy;
    }
    const panel = document.createElement('div');
    panel.className = 'showequip';
    const title = document.createElement('div');
    const link = document.createElement('a');
    link.href = new URL(path, location.origin).href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = clean(source.firstElementChild.textContent) || analysis.name;
    title.append(link);
    const readout = document.createElement('div');
    analysis.eq = copyReadout(analysis.eq);
    readout.append(analysis.eq.cloneNode(true));
    panel.append(title, readout);
    return panel;
  }

  function comparisonWorkspace(panel, analysis) {
    const workspace = document.createElement('div');
    workspace.className = 'hv-equipment-comparison';
    workspace.style.cssText = 'max-width:880px;margin:10px auto;padding:0 6px';
    const form = document.createElement('form');
    form.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;margin:8px 0';
    const label = document.createElement('label');
    const link = document.createElement('input');
    link.type = 'url';
    link.required = true;
    link.placeholder = 'https://hentaiverse.org/equip/…';
    link.style.cssText = 'width:min(320px,65vw);margin-left:6px';
    label.append('Equipment link', link);
    const load = document.createElement('button');
    load.type = 'submit';
    load.textContent = 'Compare';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Remove comparison';
    clear.hidden = true;
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    form.append(label, load, clear, status);
    const columns = document.createElement('div');
    columns.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:12px;align-items:start';
    workspace.append(form, columns);
    panel.before(workspace);

    function addColumn(equipment, data, title, world, shortcut) {
      const column = document.createElement('section');
      column.className = 'hv-equipment-column';
      column.style.minWidth = '0';
      const heading = document.createElement('h2');
      heading.textContent = title;
      heading.style.cssText = 'font-size:inherit;text-align:center;margin:6px 0';
      const settings = document.createElement('fieldset');
      settings.className = 'hv-equipment-settings';
      settings.style.cssText = 'box-sizing:border-box;max-width:420px;min-width:0;margin:8px auto;padding:4px 8px;border:1px solid #A47C78';
      const legend = document.createElement('legend');
      legend.textContent = 'Simulation';
      settings.append(legend);
      const toggle = mountPreview(equipment, data, settings, world, shortcut, readPlayerLevel);
      if (!toggle) settings.append('Simulation is unavailable for this equipment.');
      column.append(heading, settings, equipment);
      columns.append(column);
      return { column, toggle };
    }

    const currentWorld = equipmentPath.exec(location.pathname)?.[1] ? 'isekai' : 'persistent';
    const original = addColumn(panel, analysis, 'Original equipment', currentWorld, 'S');
    let imported;
    clear.addEventListener('click', () => {
      imported?.column.remove();
      imported = null;
      clear.hidden = true;
      status.textContent = '';
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (load.disabled) return;
      load.disabled = clear.disabled = true;
      status.textContent = 'Loading equipment…';
      try {
        const { path, world } = equipmentLink(link.value.trim());
        const source = await fetchEquipment(path);
        const data = analyze(source);
        const equipment = importedPanel(source, data, path);
        render(equipment, data);
        const next = addColumn(equipment, data, 'Comparison equipment', world, 'Shift+S');
        imported?.column.remove();
        imported = next;
        clear.hidden = false;
        status.textContent = '';
      } catch (error) {
        status.textContent = error instanceof TypeError
          ? 'Could not reach the equipment page. Check your HentaiVerse login and try again.'
          : error.name === 'TimeoutError' ? 'The equipment request timed out.' : error.message;
      } finally {
        load.disabled = clear.disabled = false;
      }
    });
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
          event.key.toLowerCase() !== 's' || event.target?.isContentEditable ||
          event.target?.closest?.('input, textarea, select, [role="textbox"]')) return;
      const toggle = event.shiftKey ? imported?.toggle : original.toggle;
      if (!toggle) return;
      event.preventDefault();
      toggle();
    });
  }

  async function mount() {
    const panel = document.querySelector('.showequip');
    if (!panel?.querySelector('.eqt') || panel.dataset.hvEquipLab) return;
    let analysis = analyze(panel);
    if ((!analysis.item || panel.querySelector('.hv-lpr-avg')) && location.protocol === 'https:') {
      try {
        analysis = analyze(await fetchEquipment(location.pathname));
      } catch (error) {
        console.warn('[HV Equipment Lab]', error);
      }
    }
    if (!panel.dataset.hvEquipLab) {
      render(panel, analysis);
      comparisonWorkspace(panel, analysis);
    }
  }

  void mount();
})();
