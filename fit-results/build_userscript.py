"""Embed the fitted coefficients so the userscript can be installed as one file."""

import argparse
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'fit-history'))

from fit_hv_equipment import PREFIX_EFFECTS, SUFFIX_EFFECTS
from affix_rules import LOAD_MULTIPLIERS, SLOTS as AFFIX_SLOT_MULTIPLIERS, UNMEASURED_SHIELD_RULES, rule, wiki_affixes


SLOTS = ('Head', 'Body', 'Hands', 'Legs', 'Feet')
BEGIN = '  // BEGIN GENERATED EQUIPMENT DATA'
END = '  // END GENERATED EQUIPMENT DATA'


def equipment_types():
    # Equipment Basics, Detailed Equip Characteristics and Obsolete Items.
    types = {}
    for category, names in (
        ('One-handed Weapon', 'Axe|Club|Dagger|Rapier|Shortsword|Wakizashi'),
        ('Two-handed Weapon', 'Estoc|Great Mace|Katana|Longsword|Mace|Scythe|Swordchucks'),
        ('Staff', 'Ebony Staff|Katalox Staff|Oak Staff|Redwood Staff|Willow Staff'),
        ('Shield', 'Buckler|Force Shield|Kite Shield|Tower Shield'),
    ):
        for name in names.split('|'):
            types[name] = [category, 'Shield' if category == 'Shield' else '']
    for category, materials, pieces in (
        ('Cloth Armor', 'Cotton Gossamer Ironsilk Phase', 'Cap Robe Gloves Pants Shoes'),
        ('Light Armor', 'Leather Drakehide Kevlar Shade', 'Helmet Breastplate Gauntlets Leggings Boots'),
        ('Heavy Armor', 'Plate Chain Reactive', 'Helmet Cuirass Gauntlets Greaves Sabatons'),
        ('Heavy Armor', 'Power', 'Helmet Armor Gauntlets Leggings Boots'),
    ):
        for material in materials.split():
            for slot, piece in zip(SLOTS, pieces.split()):
                types[f'{material} {piece}'] = [category, slot]
    types['Mace'].append('Great Mace')
    types['Sword Chucks'] = [*types['Swordchucks'], 'Swordchucks']
    for slot, piece, canonical in zip(SLOTS, ('Coif', 'Hauberk', 'Mitons', 'Chausses', 'Boots'),
                                       ('Helmet', 'Cuirass', 'Gauntlets', 'Greaves', 'Sabatons')):
        types[f'Chainmail {piece}'] = ['Heavy Armor', slot, f'Chain {canonical}']
    return types


def affix_scope(equipment, category):
    return equipment.split()[0] if category.endswith('Armor') else equipment


def shared_selectors(types, groups, shared_fits):
    selectors = {}
    observed = {}
    for group in groups:
        equipment = group['equipment_type']
        category, _, *alias = types[equipment]
        scope = affix_scope(alias[0] if alias else equipment, category)
        for component in group['components']:
            kind, name = component['component']
            if kind != 'native':
                observed.setdefault((scope, kind), set()).add(name)
    for equipment, (category, slot, *alias) in types.items():
        if alias:
            continue
        subtype = equipment.split()[0]
        scope = affix_scope(equipment, category)
        if scope in selectors:
            continue
        selectors[scope] = entries = {}
        for names, (kind, effects) in zip(wiki_affixes(equipment, category),
                                         (('prefix', PREFIX_EFFECTS), ('suffix', SUFFIX_EFFECTS))):
            for affix in set(names) | observed.get((scope, kind), set()):
                for group, stat in effects.get(affix, ()):
                    key = (category, subtype, slot, equipment, group, stat, '')
                    family, _ = rule(key, (kind, affix))
                    family = UNMEASURED_SHIELD_RULES.get(family, family)
                    if family in shared_fits:
                        entries[f'{kind[0]}:{affix}/{group}/{stat}'] = family
                    elif (affix in names and family and 'Siphon' not in stat and not stat.endswith(' Strike')):
                        raise ValueError(f'Missing shared coefficient: {equipment}, {family}')
    return selectors


def pack_fits(groups, types, shared_fits):
    fits = {}
    for group in groups:
        equipment = group['equipment_type']
        if equipment not in types:
            raise ValueError(f'Unregistered equipment type: {equipment}')
        if len(types[equipment]) > 2:
            continue
        key = f'{group["attribute_group"]}/{group["attribute"]}'
        rows = fits.setdefault(equipment, {})
        row = rows.setdefault(key, [group['k3'], {}])
        if row[0] != group['k3']:
            raise ValueError(f'Conflicting scales: {equipment}, {key}')
        group_key = tuple(group[column] for column in (
            'category', 'subtype', 'slot', 'equipment_type', 'attribute_group', 'attribute', 'unit'))
        for component in group['components']:
            kind, name = component['component']
            family, _ = rule(group_key, (kind, name))
            if family in shared_fits:
                continue
            component_key = kind[0] + (f':{name}' if name else '')
            pair = [component['k1'], component['k2']]
            if row[1].setdefault(component_key, pair) != pair:
                raise ValueError(f'Conflicting component: {equipment}, {key}, {component_key}')
    return {equipment: {key: row for key, row in rows.items() if row[1]} for equipment, rows in fits.items()}


def encode(value):
    return json.dumps(value, separators=(',', ':'))


def javascript_table(name, table, format_value=encode):
    entries = [f'    {encode(key)}: {format_value(value)},' for key, value in sorted(table.items())]
    return f'  const {name} = {{\n' + '\n'.join(entries) + '\n  };'


def generated_data(source):
    types = equipment_types()
    shared_fits = source['shared_affixes']
    fits = pack_fits(source['groups'], types, shared_fits)
    selectors = shared_selectors(types, source['groups'], shared_fits)
    effects = [{name: sorted(f'{group}/{stat}' for group, stat in stats)
                for name, stats in mapping.items()} for mapping in (PREFIX_EFFECTS, SUFFIX_EFFECTS)]
    effects[0].update({'astral': [], 'quintessential': []})
    for selector in LOAD_MULTIPLIERS:
        affix, key = selector[2:].split('/', 1)
        keys = effects[selector[0] == 's'][affix]
        if key not in keys:
            keys.append(key)
    coeff_table = javascript_table('coefficients', fits, lambda rows: '{\n' + '\n'.join(
        f'      {encode(key)}: {encode(row)},' for key, row in sorted(rows.items())) + '\n    }')
    return '\n'.join((
        '  // Run python fit-results/build_userscript.py after updating coefficients.json.',
        f'  const exponent = {source["shared_p"]};',
        javascript_table('equipmentTypes', types),
        javascript_table('prefixEffects', effects[0]),
        javascript_table('suffixEffects', effects[1]),
        '  const affixEffects = [prefixEffects, suffixEffects];',
        javascript_table('loadMultipliers', LOAD_MULTIPLIERS),
        javascript_table('slotMultiplier', AFFIX_SLOT_MULTIPLIERS | {'Shield': 1}),
        javascript_table('sharedAffixCoefficients', {name: [fit['k1'], fit['k2'], fit['k3']]
                                                    for name, fit in shared_fits.items()}),
        javascript_table('sharedAffixRules', selectors, lambda entries: '{\n' + '\n'.join(
            f'      {encode(key)}: {encode(rule_name)},' for key, rule_name in sorted(entries.items())) + '\n    }'),
        coeff_table,
    ))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if the embedded data is stale.')
    args = parser.parse_args()
    target = ROOT / 'hv-equipment-lab.user.js'
    source = json.loads((ROOT / 'fit-results' / 'coefficients.json').read_text(encoding='utf-8'))
    script = target.read_text(encoding='utf-8')
    before, remainder = script.split(BEGIN + '\n')
    _, after = remainder.split(END)
    result = before + BEGIN + '\n' + generated_data(source) + '\n' + END + after
    if args.check:
        if result != script:
            parser.exit(1, 'Embedded equipment data is stale.\n')
    elif result != script:
        target.write_text(result, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
