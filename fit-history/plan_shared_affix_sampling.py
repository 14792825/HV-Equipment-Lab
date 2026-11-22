"""Recalculate sampling needs with shared affix coefficients at fixed k3."""

from collections import defaultdict
import json

import numpy as np

import fit_frozen_k3 as frozen


ROOT = frozen.ROOT
SLOTS = dict(Head=1., Body=1.2, Hands=.9, Legs=1.1, Feet=.8)
EXPLICIT = ('Weapon elemental prefix', 'Armor elemental mitigation', 'Phase elemental suffix')
PRIMARY = {'ox', 'raccoon', 'cheetah', 'fox', 'owl', 'turtle'}
PROFICIENCY = {'elementalist', 'heaven-sent', 'demon-fiend', 'earth-walker', 'curse-weaver'}
OPTIONAL_STATS = {
    ('prefix', 'charged', 'Casting Speed'), ('prefix', 'frugal', 'Mana Conservation'),
    ('prefix', 'mystic', 'Magic Crit Damage'), ('prefix', 'savage', 'Attack Crit Damage'),
    ('prefix', 'reinforced', 'Crushing'), ('prefix', 'reinforced', 'Piercing'),
    ('prefix', 'reinforced', 'Slashing'), ('suffix', 'balance', 'Attack Accuracy'),
    ('suffix', 'balance', 'Attack Crit Damage'), ('suffix', 'destruction', 'Magic Damage'),
    ('suffix', 'focus', 'Magic Accuracy'), ('suffix', 'focus', 'Magic Crit Damage'),
    ('suffix', 'focus', 'Mana Conservation'), ('suffix', 'fleet', 'Evade'),
    ('suffix', 'negation', 'Resist'), ('suffix', 'protection', 'Physical Mitigation'),
    ('suffix', 'warding', 'Magical Mitigation'), ('suffix', 'swiftness', 'Attack Speed'),
    ('suffix', 'arcanist', 'Magic Accuracy'), ('suffix', 'arcanist', 'Intelligence'),
    ('suffix', 'arcanist', 'Wisdom'),
}


def rule(key, component):
    category, subtype, slot, _, group, stat, _ = key
    kind, name = component
    armor = category in frozen.fit.ARMOR_CATEGORIES
    multiplier = SLOTS[slot] if armor else 1.
    if kind == 'native':
        return None, 1.
    if stat in frozen.fit.ELEMENTS:
        if group == 'Spell Damage' and kind == 'prefix' and category in frozen.fit.WEAPON_CATEGORIES:
            return EXPLICIT[0], 1.
        if group == 'Damage Mitigation' and armor:
            return EXPLICIT[1], multiplier
        if group == 'Spell Damage' and kind == 'suffix' and armor and subtype == 'Phase':
            return EXPLICIT[2], multiplier
        if group == 'Spell Damage' and kind == 'suffix' and category == 'Staff':
            return 'Staff elemental suffix', 1.
    if kind == 'suffix' and name in PRIMARY and group == 'Primary Attributes':
        return 'Single primary attribute suffix', multiplier
    if kind == 'suffix' and name in PROFICIENCY and group == 'Proficiency':
        return 'Proficiency suffix', multiplier
    if (kind, name, stat) in OPTIONAL_STATS:
        if name == 'reinforced':
            return ('reinforced physical mitigation', multiplier) if armor else (None, 1.)
        if name == 'arcanist' and group == 'Primary Attributes':
            return 'arcanist Intelligence and Wisdom', multiplier
        return f'{name} {stat}', multiplier
    return None, 1.


def parameter(key, component, sharing):
    name, multiplier = rule(key, component)
    return ((name,), multiplier) if name in sharing else ((key, component), 1.)


def fit_shared(groups, scales, sharing, bounds=None, coefficients=None, predictions=None,
               mitigation_lookup=False):
    """Solve each set of equipment/stat groups linked by shared parameters."""
    parents = {key: key for key in groups}

    def root(key):
        while parents[key] != key:
            key = parents[key]
        return key

    owner, equations = {}, defaultdict(list)
    for key, records in groups.items():
        for record in records:
            terms = [(param, multiplier, base) for component, base in record['_terms']
                     for param, multiplier in [parameter(key, component, sharing)]]
            equations[key].append((record, terms))
            for param, _, _ in terms:
                parents[root(key)] = root(owner.setdefault(param, key))
    blocks = defaultdict(list)
    for key in groups:
        blocks[root(key)].append(key)

    found, scores, connected = {}, {}, {}
    lookup_param = ('Armor elemental mitigation',)
    if mitigation_lookup and coefficients is not None:
        raise ValueError('Lookup values cannot be exported as k1 and k2')
    for keys in blocks.values():
        rows = [(key, record, terms) for key in keys for record, terms in equations[key]]
        lookup_bases = sorted({base for _, _, terms in rows for param, _, base in terms
                               if mitigation_lookup and param == lookup_param})
        lookup_offsets = {base: i for i, base in enumerate(lookup_bases)}
        columns = {}
        width = 0
        for _, _, terms in rows:
            for param, _, _ in terms:
                if param not in columns:
                    columns[param] = width
                    width += len(lookup_bases) if lookup_bases and param == lookup_param else 2
        design = np.zeros((len(rows), width))
        for i, (key, record, terms) in enumerate(rows):
            k3 = scales[frozen.fit.scale_family(key)[0]]
            factor = (1 + record['level'] * k3) / (1 + 500 * k3)
            for param, multiplier, base in terms:
                j = columns[param]
                if lookup_bases and param == lookup_param:
                    design[i, j + lookup_offsets[base]] += factor * multiplier
                else:
                    design[i, j:j+2] += factor * multiplier * np.array([1., (base-200.)/200.])
        panel = np.array([record['panel'] for _, record, _ in rows])
        tol = np.array([record['tolerance'] for _, record, _ in rows])
        if bounds is not None:
            tol *= [bounds[key, record['base_source'] == 'reference'] for key, record, _ in rows]
        solution, optimum, _, _ = frozen.solve(design, panel, tol)
        raw = [i for i, (_, record, _) in enumerate(rows) if record['base_source'] != 'reference']
        raw_optimum = frozen.solve(design[raw], panel[raw], tol[raw])[1] if raw else 0.
        _, singular, vectors = np.linalg.svd(design, full_matrices=len(rows) < design.shape[1])
        rank = np.count_nonzero(singular > singular[0] * max(design.shape) * np.finfo(float).eps)
        identifiable = np.linalg.norm(vectors[rank:], axis=0) < 1e-9
        for param, j in columns.items():
            count = len(lookup_bases) if lookup_bases and param == lookup_param else 2
            found[param] = bool(np.all(identifiable[j:j+count]))
            connected[param] = (optimum, raw_optimum)
        fitted = design @ solution
        ratios = np.abs(fitted - panel) / tol
        if predictions is not None:
            for (key, _, _), value in zip(rows, fitted):
                predictions.setdefault(key, []).append(float(value))
        if coefficients is not None:
            parameter_ratios = defaultdict(float)
            for (_, _, terms), ratio in zip(rows, ratios):
                for param, _, _ in terms:
                    parameter_ratios[param] = max(parameter_ratios[param], float(ratio))
            for key in keys:
                family = frozen.fit.scale_family(key)[0]
                k3 = scales[family]
                scale500 = 1 + 500 * k3
                components = sorted({c for record in groups[key] for c, _ in record['_terms']})
                for component in components:
                    param, multiplier = parameter(key, component, sharing)
                    j = columns[param]
                    known = found[param]
                    ratio = parameter_ratios[param]
                    status = ('pass' if ratio <= 1 + 1e-7 else 'fail') if known else 'unidentifiable_k1_k2'
                    coefficients.append(dict(zip(frozen.fit.KEY_COLUMNS, key)) | dict(
                        component_kind=component[0], affix=component[1], status=status,
                        k1=multiplier * (solution[j] - solution[j+1]) / scale500 if known else '',
                        k2=multiplier * solution[j+1] / (200 * scale500) if known else '',
                        k3=k3, k3_family=family, shared_rule=param[0] if len(param) == 1 else '',
                        multiplier=multiplier, max_tolerance_ratio=ratio))
        for (key, record, _), ratio in zip(rows, ratios):
            scores.setdefault(key, [0., 0.])
            index = int(record['base_source'] == 'reference')
            scores[key][index] = max(scores[key][index], ratio)
    return found, scores, connected


def reference_screen(groups):
    references = defaultdict(list)
    for key, records in groups.items():
        for row in records:
            if row['source'] != 'hv-reference-affixes-peerless.tsv':
                continue
            component, base = row['_terms'][0]
            name, multiplier = rule(key, component)
            if name and base == 200:
                references[name].append((key, component, (row['panel']-row['tolerance'])/multiplier,
                                         (row['panel']+row['tolerance'])/multiplier))
    return {name: (len(rows), len({r[0][:4] for r in rows}),
                   max(r[2] for r in rows), min(r[3] for r in rows))
            for name, rows in references.items()}


def main():
    items, provenance = frozen.load_archives(frozen.archive_paths())
    groups, _, _ = frozen.collect_joint(items, provenance, frozen.native_references())
    scales = frozen.read_scales(ROOT/'hv-k3-frozen.tsv')
    groups = {key: records for key, records in groups.items() if frozen.fit.scale_family(key)[0] in scales}
    inventory = frozen.cal.read_table(ROOT/'hv-k1-k2-frozen.tsv')[1]
    explicit_fit = fit_shared(groups, scales, EXPLICIT)
    baseline = {(key, ref): max(1., scores[int(ref)]) + 1e-7
                for key, scores in explicit_fit[1].items() for ref in (False, True)}
    sharing = set(EXPLICIT)
    audit = []
    for name, (count, variants, low, high) in sorted(reference_screen(groups).items()):
        if name in EXPLICIT:
            audit.append((name, count, low, high, '指定', *explicit_fit[2].get((name,), (0., 0.))))
        elif variants >= 2:
            # A candidate must retain the attained per-stat panel bounds of the explicit model.
            trial = fit_shared(groups, scales, sharing | {name}, baseline)
            ratio = trial[2][(name,)][0]
            accepted = low <= high and ratio <= 1 + 1e-7
            if accepted:
                sharing.add(name)
            audit.append((name, count, low, high, '采用' if accepted else '候选',
                          trial[2][(name,)][0], trial[2][(name,)][1]))
        else:
            audit.append((name, count, low, high, '缺跨装备对照', None, None))
    coefficients = []
    identifiable, _, _ = fit_shared(groups, scales, sharing, coefficients=coefficients)
    coefficients.sort(key=lambda row: tuple(row[c] for c in (*frozen.fit.KEY_COLUMNS, 'component_kind', 'affix')))
    frozen.write_table(ROOT/'hv-k1-k2-frozen-shared.tsv', coefficients, frozen.fit.KEY_COLUMNS)
    write_plan(inventory, identifiable, sharing, audit)


def write_plan(inventory, identifiable, sharing, audit):
    local = defaultdict(lambda: defaultdict(list))
    pending = defaultdict(list)
    conflicts = defaultdict(set)
    unfrozen = defaultdict(set)
    for row in inventory:
        key = tuple(row[c] for c in frozen.fit.KEY_COLUMNS)
        component = row['component_kind'], row['affix']
        equip = row['equipment_type']
        state = row['status']
        if float(row['raw_only_joint_minimax_tolerance_ratio'] or 0) > 1 + 1e-7:
            conflicts[equip].add(key[-3:])
        missing = state == 'unavailable' and bool(
            set(json.loads(row['unavailable_reasons'])) &
            {'missing_native_base', 'missing_mean_base', 'missing_panel_or_level'})
        param, _ = parameter(key, component, sharing)
        if identifiable.get(param):
            continue
        if not (missing or state == 'unidentifiable_k1_k2' or param in identifiable):
            continue
        if state not in {'unidentifiable_k1_k2', 'pass', 'fail'} and not missing:
            continue
        if not frozen.affixes.is_model_stat(key):
            unfrozen[equip].add(row['attribute'])
        elif len(param) == 1:
            pending[param[0]].append((equip, component, row['attribute']))
        else:
            lo, hi = row['base_min'], row['base_max']
            input_name = ('AVG' if component[0] != 'native'
                          or row['attribute'] in frozen.AVG_NATIVE_ATTRIBUTES else 'Base')
            base = f'两档 {input_name}' if missing else f'已有 {input_name} {float(lo):g}' + (
                f'–{float(hi):g}' if hi != lo else '')
            local[equip][component].append((2 if missing else 1, f'{row["attribute"]}（{base}）'))

    totals = []
    for equip, components in local.items():
        native = max((n for n, _ in components.get(('native', ''), [])), default=0)
        affixes = sum(max(n for n, _ in targets) for (kind, _), targets in components.items() if kind != 'native')
        totals.append((equip, native, affixes))
    totals.sort(key=lambda row: (-row[1]-row[2], row[0]))
    native = sum(row[1] for row in totals)
    affixes = sum(row[2] for row in totals)
    lines = [
        '# 共享词缀规则后的装备补采清单', '',
        f'首轮补采 {native + affixes} 件，覆盖 {len(totals)} 种装备。其中本体对照 {native} 件，'
        f'指定词缀 {affixes} 件。另有 {len(pending)} 个共享族待补，见下表。', '',
        '仍使用冻结的 k3 和原有面板容差。本体保留各装备原生系数。共享的是词缀增量的 k1、k2，'
        '适用的防具增量按头 1.0、身 1.2、手 0.9、腿 1.1、脚 0.8 乘算。'
        '防具按有部位的布甲、轻甲、重甲处理。盾牌没有指定部位倍率。武器包含法杖。'
        '现有七条带本体项的防具元素减伤方程全都带同元素词缀，缺少独立原生对照，清单保留这些本体目标。', '',
        '已有约束的缺口补一件能够增加独立信息的样本，无可用约束的缺口补两档。'
        'Burden、Interference 的本体与加法词缀均以同件装备的 AVG 拟合。'
        '补这两项本体时选不同 AVG，避开对应的清零或倍率词缀：Burden 避开 Ethereal、Mithril；'
        'Interference 避开 Ethereal、Battlecaster、Arcanist。'
        '同装备的本体属性可共用样本。目标随机属性无法同时出现时要拆单。'
        '词缀按每件一个目标计算，另一侧避开同属性加成。', '',
        '| 装备类型 | 本体 | 词缀 | 合计 | 目标属性及词缀 |',
        '| --- | ---: | ---: | ---: | --- |',
    ]
    for equip, n, a in totals:
        detail = []
        for (kind, name), targets in sorted(local[equip].items()):
            count = max(amount for amount, _ in targets)
            label = {'native': '本体', 'prefix': f'前缀 {name}', 'suffix': f'后缀 {name}'}[kind]
            detail.append(f'{label} ×{count}：' + '、'.join(target for _, target in sorted(set(targets))))
        lines.append(f'| {equip} | {n} | {a} | {n+a} | ' + '<br>'.join(detail) + ' |')
    lines.append(f'| **合计** | **{native}** | **{affixes}** | **{native + affixes}** | |')
    cleared = {row['equipment_type'] for row in inventory} - set(local)
    lines.extend(['', '本轮无需新增拟合样本的类型有 ' + '、'.join(sorted(cleared)) + '。'])
    lines.extend(['', '## 共享族需要的对照', ''])
    for name, options in sorted(pending.items()):
        labels = sorted({f'{equip} {component[1]} ({stat})' for equip, component, stat in options})
        lines.append(f'- {name}：先补 1 件不同平均 Base 的样本，可从 {"、".join(labels)} 中选。')
    if not pending:
        lines.append('已采用的共享族均可从现有方程分离系数。')
    lines.extend(['', '## 参考表与原始面板检查', '',
                  '参考区间为 Base 200、等级 500 的词缀增量除以部位倍率后的容差区间交集。'
                  '区间下界超过上界表示参考表已有冲突。'
                  '额外规则需要至少两种装备的参考、参考区间有交集，'
                  '且联合求解可维持指定规则模型达到的逐属性误差上限。', '',
                  '| 规则 | 参考数 | 区间下界 | 区间上界 | 结果 | 全量误差比 | 原始误差比 |',
                  '| --- | ---: | ---: | ---: | --- | ---: | ---: |'])
    for name, count, low, high, result, ratio, raw in audit:
        scores = '— | —' if ratio is None else f'{ratio:.3f} | {raw:.3f}'
        lines.append(f'| {name} | {count} | {low:.4f} | {high:.4f} | {result} | {scores} |')
    lines.extend(['', '指定规则的误差比使用原始容差，并包含与共享词缀联立的本体方程。'
                  '候选规则的误差比以指定模型的逐属性误差上限为 1。', '',
                  '## 需另外复核', '',
                  f'逐类型拟合中有 {sum(map(len, conflicts.values()))} 个属性组仅使用原始面板就超差。'
                  '增加样本可帮助定位冲突。', '',
                  '| 装备 | 原始面板超差组 |',
                  '| --- | ---: |'])
    for equip, groups in sorted(conflicts.items()):
        lines.append(f'| {equip} | {len(groups)} |')
    for equip, attributes in sorted(unfrozen.items()):
        lines.extend(['', f'{equip} 的 {"、".join(sorted(attributes))} 缺少有效观测和冻结 k3，'
                      '需要先确认属性来源与公式，现阶段单列。'])
    (ROOT/'hv-equipment-sampling-plan-shared.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')
    print(f'{native + affixes} equipment, {len(totals)} types, {native} native, {affixes} affix, '
          f'{len(pending)} shared pools; {len(sharing)-len(EXPLICIT)} additional rules')
    print('Accepted:', ', '.join(sorted(sharing)))


if __name__ == '__main__':
    main()
