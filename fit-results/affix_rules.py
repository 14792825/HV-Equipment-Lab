"""Equipment affix availability from EHWiki, Detailed Equip Characteristics.

https://ehwiki.org/wiki/Detailed_Equip_Characteristics#Prefixes
https://ehwiki.org/wiki/Detailed_Equip_Characteristics#Suffixes
"""

from plan_shared_affix_sampling import SLOTS, rule as historical_rule


ELEMENT_PREFIXES = 'fiery arctic shocking tempestuous hallowed demonic ethereal'
WARD_PREFIXES = 'ruby cobalt amber jade zircon onyx'
WARD_SUFFIXES = 'fire-eater frost-born thunder-child wind-waker thrice-blessed spirit-ward'
SPELL_SUFFIXES = 'surtr niflheim mjolnir freyr heimdall fenrir'
PROFICIENCIES = 'elementalist heaven-sent demon-fiend earth-walker curse-weaver'
SIPHONS = 'vampire illithid banshee'
MITIGATION = 'protection warding dampening deflection stoneskin'
MELEE = 'slaughter balance battlecaster'

SUFFIXES = {
    'Shortsword': f'{MELEE} swiftness focus {SIPHONS} ox raccoon',
    'Dagger': f'{MELEE} nimble swiftness focus raccoon cheetah',
    'Axe': f'{MELEE} {SIPHONS} ox raccoon',
    'Wakizashi': f'{MELEE} nimble swiftness raccoon cheetah',
    'Rapier': f'{MELEE} nimble swiftness {SIPHONS} raccoon cheetah',
    'Club': f'{MELEE} nimble swiftness {SIPHONS} raccoon cheetah',
    **dict.fromkeys(('Longsword', 'Estoc', 'Mace', 'Great Mace'), f'{MELEE} {SIPHONS} ox'),
    **dict.fromkeys(('Katana', 'Scythe'), f'{MELEE} ox'),
    'Swordchucks': 'slaughter ox raccoon',
    'Ebony': f'destruction focus {SPELL_SUFFIXES} elementalist heaven-sent demon-fiend fox owl',
    'Redwood': 'destruction focus surtr niflheim mjolnir freyr elementalist fox owl',
    'Oak': 'destruction focus heimdall earth-walker fox owl',
    'Katalox': 'destruction focus heimdall fenrir heaven-sent demon-fiend fox owl',
    'Willow': 'destruction focus fenrir curse-weaver fox owl',
    'Buckler': 'barrier nimble battlecaster fleet protection warding turtle',
    'Kite Shield': f'barrier battlecaster {MITIGATION} turtle',
    'Tower Shield': f'barrier {MITIGATION} turtle',
    'Force Shield': f'{MITIGATION} turtle',
    'Cotton': f'protection warding {PROFICIENCIES} {WARD_SUFFIXES}',
    'Gossamer': f'{PROFICIENCIES} fox owl',
    'Ironsilk': 'protection warding fleet raccoon cheetah',
    'Phase': f'{PROFICIENCIES} raccoon cheetah fox owl {SPELL_SUFFIXES}',
    'Leather': f'{MITIGATION} negation {WARD_SUFFIXES}',
    **dict.fromkeys(('Drakehide', 'Kevlar'), f'battlecaster {MITIGATION} negation {WARD_SUFFIXES}'),
    'Shade': 'shadowdancer arcanist fleet negation',
    **dict.fromkeys(('Plate', 'Chain'), f'{MITIGATION} {WARD_SUFFIXES}'),
    'Reactive': f'barrier {MITIGATION} {WARD_SUFFIXES}',
    'Power': 'slaughter balance protection warding',
}
ARMOR_PREFIXES = {
    'Cotton': 'charged frugal',
    'Phase': 'charged frugal radiant mystic',
    'Ironsilk': 'reinforced',
    'Leather': 'reinforced agile',
    'Kevlar': 'reinforced',
    'Shade': 'savage agile',
    'Plate': 'mithril shielding',
    'Chain': 'mithril reinforced',
    'Reactive': 'mithril',
    'Power': 'mithril savage',
}
SHIELD_PREFIXES = {
    'Buckler': 'reinforced agile mithril',
    'Kite Shield': 'reinforced agile mithril',
    'Tower Shield': 'reinforced mithril',
    'Force Shield': WARD_PREFIXES,
}

# Multipliers are applied to the native load, before any Featherweight charm.
LOAD_MULTIPLIERS = {
    'p:ethereal/Equipment/Burden': 0,
    'p:ethereal/Equipment/Interference': 0,
    'p:mithril/Equipment/Burden': .75,
    's:battlecaster/Equipment/Interference': 0,
    's:arcanist/Equipment/Interference': .25,
}


def wiki_affixes(equipment, category):
    if category.endswith('Armor'):
        subtype = equipment.split()[0]
        prefixes = WARD_PREFIXES + ' ' + ARMOR_PREFIXES.get(subtype, '')
    elif category == 'Shield':
        subtype = equipment
        prefixes = SHIELD_PREFIXES[subtype]
    else:
        subtype = equipment.removesuffix(' Staff')
        prefixes = ELEMENT_PREFIXES
    return prefixes.split(), SUFFIXES[subtype].split()


def rule(key, component):
    category, _, slot, _, group, stat, _ = key
    kind, name = component
    multiplier = SLOTS[slot] if category.endswith('Armor') else 1.
    if kind == 'native' or (name, stat) in {
        ('mithril', 'Burden'), ('battlecaster', 'Interference'), ('arcanist', 'Interference'),
    }:
        return None, 1.
    family, _ = historical_rule(key, component)
    if family in {'Phase elemental suffix', 'Staff elemental suffix'}:
        family = 'Elemental spell damage suffix'
    elif group == 'Damage Mitigation' and category == 'Shield' and name in WARD_PREFIXES.split():
        family = 'Armor elemental mitigation'
    elif name == 'reinforced':
        family = 'reinforced physical mitigation'
    elif name in {'dampening', 'deflection', 'stoneskin'}:
        family = 'Physical mitigation suffix by damage type'
    elif name in {'fleet', 'shadowdancer'} and stat == 'Evade' and category.endswith('Armor'):
        family = 'Armor Evade suffix'
    elif name in {'slaughter', 'barrier', 'fleet'} or (name == 'battlecaster' and stat == 'Mana Conservation'):
        # Archival observations have different increments even after slot normalization.
        scope = 'armor' if category.endswith('Armor') else 'shield' if category == 'Shield' else 'weapon'
        family = f'{name} {stat} ({scope})'
    return family or f'{name} {stat}', multiplier


# Wiki lists both shield suffixes, but the archive has no numeric examples.
# Use the corresponding non-armor/slot-normalized fit until shields can be measured.
UNMEASURED_SHIELD_RULES = {
    'battlecaster Mana Conservation (shield)': 'battlecaster Mana Conservation (weapon)',
    'fleet Evade (shield)': 'Armor Evade suffix',
}
