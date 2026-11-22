"""Fit native k1/k2 with frozen k3 and explicit per-observation tolerances.

All archive exports are merged by (world, equipmentId), keeping the latest
capture. Reference panels are constraints, not exact cross-equipment ratios.
The normalized minimax problem certifies whether *every* supplied panel can
meet max(relative tolerance, one display increment) at the frozen k3.
"""

import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.optimize import linprog

import analyze_peerless_affixes as affixes
import calibrate_peerless as cal
import fit_hv_equipment as fit


ROOT = Path(__file__).resolve().parent
DATA = fit.DATA
RELATIVE_TOLERANCE = 5e-4
AVG_NATIVE_ATTRIBUTES = {'Burden', 'Interference'}
OUT_OF_SCOPE_ATTRIBUTES = {'HP Bonus', 'MP Bonus'}


def tolerance(panel, step):
    return max(RELATIVE_TOLERANCE * abs(panel), step)


def read_scales(path):
    """Freeze numeric estimates even if the former half-step audit failed."""
    _, rows = cal.read_table(path)
    result = {}
    for row in rows:
        value = fit.numeric(row['k3'])
        if value is not None:
            if value < 0:
                raise ValueError(f"Negative frozen k3: {row['k3_family']}")
            result[row['k3_family']] = value
    return result


def archive_paths():
    return [*sorted(DATA.glob('hv-equipment-2026-*.csv')),
            *sorted(DATA.glob('Ponly*.csv')), DATA / 'PL2.csv', *sorted(DATA.glob('v3.csv'))]


def load_archives(paths):
    items, provenance = {}, {}
    for path in paths:
        for item, rows in fit.load_equipment(path).items():
            version = rows[0]['savedAt'], rows[0]['sampleId']
            if item not in items or version >= (items[item][0]['savedAt'], items[item][0]['sampleId']):
                items[item], provenance[item] = rows, path.name
    return items, provenance


def observation(key, source, source_id, base, level, panel, step, **extra):
    return dict(zip(fit.KEY_COLUMNS, key)) | dict(
        source=source, source_id=source_id, base=base, level=level,
        panel=panel, display_step=step, tolerance=tolerance(panel, step), **extra)


def native_references():
    result = defaultdict(list)
    for table, labels in (
        ('melees', fit.REFERENCE_MELEE), ('shields', fit.REFERENCE_SHIELD),
        ('staffs', fit.REFERENCE_STAFF),
    ):
        path = DATA / f'hv-reference-{table}.tsv'
        _, rows = cal.read_table(path)
        for row in rows:
            if table == 'shields':
                row.update(dict.fromkeys(('Str', 'Dex', 'Agi', 'End'), row['Random Attribute Value']))
            for label, stat in (fit.REFERENCE_COMMON | labels).items():
                text = (row.get(label) or '').removesuffix('%')
                if not text:
                    continue
                panel = float(text)
                step = 10. ** -len(text.partition('.')[2])
                key = cal.reference_key(table, row['Equipment'], stat)
                result[key].append(observation(key, path.name, f"{row['Equipment']}:{label}",
                                               200., 500., panel, step, base_source='reference'))
    path = DATA / 'hv-reference-peerless.tsv'
    _, rows = cal.read_table(path)
    for row in rows:
        key = tuple(row[c] for c in fit.KEY_COLUMNS)
        result[key].append(observation(key, path.name, row['equipment_ids'], float(row['base']),
                                      float(row['level']), float(row['value']), float(row['step']),
                                      base_source='reference'))
    return result


def solve(design, target, tolerances):
    """Tolerance-weighted LS, replaced by minimax only when LS misses a panel.

    Return both the chosen parameters and the optimal worst tolerance ratio.
    LP uses free parameters: negative k1/k2 must not be silently clipped.
    """
    matrix = design / tolerances[:, None]
    rhs = target / tolerances
    solution = np.linalg.lstsq(matrix, rhs, rcond=None)[0]
    least_squares_ratio = float(np.max(np.abs(matrix @ solution - rhs)))
    problem = linprog(np.r_[np.zeros(design.shape[1]), 1.],
                      A_ub=np.vstack((np.column_stack((matrix, -np.ones(len(rhs)))),
                                      np.column_stack((-matrix, -np.ones(len(rhs)))))),
                      b_ub=np.r_[rhs, -rhs],
                      bounds=[(None, None)] * design.shape[1] + [(0., None)], method='highs')
    if not problem.success:
        raise RuntimeError(problem.message)
    if least_squares_ratio > 1. + 1e-8:
        solution = problem.x[:-1]
        method = 'minimax'
    else:
        method = 'tolerance_weighted_least_squares'
    return solution, float(problem.x[-1]), method, least_squares_ratio


def write_table(path, rows, initial=()):
    fields = list(dict.fromkeys([*initial, *(field for row in rows for field in row)]))
    with path.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fields, delimiter='\t')
        writer.writeheader()
        writer.writerows(rows)


def collect_joint(items, provenance, references):
    """Build native + prefix + suffix equations, retaining unresolved rows."""
    grouped, excluded = defaultdict(list), []
    keys_by_type = defaultdict(list)
    all_rows = defaultdict(list)
    for item, rows in items.items():
        keys_by_type[(rows[0]['category'], rows[0]['type'])].append({fit.group_key(r) for r in rows})
        for row in rows:
            all_rows[fit.group_key(row)].append(row)
    zero_native = set()
    for key, rows in all_rows.items():
        if (not any(fit.numeric(r['base']) is not None for r in rows)
                and not any(r['panel'] > 0 for r in references.get(key, []))
                and key[-2] not in AVG_NATIVE_ATTRIBUTES
                and any(key not in ks for ks in keys_by_type[key[0], key[3]])):
            zero_native.add(key)
    for item, rows in sorted(items.items()):
        bases = [b for row in rows if row['attribute'] not in AVG_NATIVE_ATTRIBUTES | OUT_OF_SCOPE_ATTRIBUTES
                 and (b := fit.numeric(row['base'])) is not None]
        mean_base = float(np.mean(bases)) if bases else None
        seen = Counter(fit.group_key(r) for r in rows)
        for row in rows:
            key = fit.group_key(row)
            panel, level = fit.numeric(row['value']), fit.numeric(row['level'])
            uses_avg = key[-2] in AVG_NATIVE_ATTRIBUTES
            base = mean_base if uses_avg else fit.numeric(row['base'])
            rec = observation(key, provenance[item], ':'.join(item), base, level,
                              panel if panel is not None else 0., fit.display_step(row),
                              base_source='equipment_avg' if uses_avg else 'rolled',
                              quality=row['quality'], mean_base=mean_base,
                              prefix=row['prefix'], suffix=row['suffix'], saved_at=row['savedAt'],
                              raw_display=row['display'], raw_value=row['value'], raw_base=row['base'])
            if key[-2] in OUT_OF_SCOPE_ATTRIBUTES:
                excluded.append(rec | dict(status='outside_current_stage'))
                continue
            effects = affixes.affixes(row, key)
            components = [tuple(effect.split(':', 1)) for effect in effects]
            reason = ''
            if row['nameStatus'] != 'parsed' or not row['type']:
                reason = 'unparsed_equipment'
            elif seen[key] > 1:
                reason = 'duplicate_stat_in_capture'
            elif panel is None or level is None:
                reason = 'missing_panel_or_level'
            elif not affixes.is_model_stat(key):
                reason = 'outside_numeric_model'
            elif any(effect.startswith('unknown_') for effect in effects):
                reason = 'unknown_affix'
            elif any((*c, key[-2]) in affixes.SPECIAL_ZERO for c in components):
                rec.update(status='override_zero', prediction=0., error=-panel,
                           tolerance_ratio=abs(panel) / rec['tolerance'],
                           passed=abs(panel) <= rec['tolerance'],
                           components=json.dumps(components))
                excluded.append(rec)
                continue
            elif any((*c, key[-2]) in affixes.SPECIAL_RATIO for c in components):
                reason = 'multiplicative_effect_requires_separate_model'
            if base is None and not uses_avg and key not in zero_native and row['quality'] == 'Peerless':
                base = 200.
                rec.update(base=base, base_source='peerless_200')
            terms = []
            if key not in zero_native:
                if base is None:
                    reason = reason or ('missing_mean_base' if uses_avg else 'missing_native_base')
                else:
                    terms.append((('native', ''), base))
            else:
                rec['native_baseline'] = 'zero_absent_in_same_equipment_type'
            if components and mean_base is None:
                reason = reason or 'missing_mean_base'
            terms.extend((c, mean_base) for c in components)
            rec['components'] = json.dumps(components, ensure_ascii=False)
            if reason:
                excluded.append(rec | dict(status=reason))
            else:
                rec['_terms'] = terms
                grouped[key].append(rec)
    for key, records in references.items():
        grouped[key].extend(r | dict(_terms=[(('native', ''), r['base'])]) for r in records)
    _, rows = cal.read_table(DATA / 'hv-reference-affixes-peerless.tsv')
    for row in rows:
        increment = fit.numeric(row['affix_increment'])
        if row['effect_model'] != 'additive' or increment is None:
            continue
        key = tuple(row[c] for c in fit.KEY_COLUMNS)
        uncertainty = max(abs(increment - float(row['increment_min'])),
                          abs(float(row['increment_max']) - increment))
        # The interval describes a derived estimate, not the decimal length of
        # the stored floating point number. Use its full uncertainty as a floor.
        rec = observation(key, 'hv-reference-affixes-peerless.tsv', row['equipment_ids'],
                          float(row['mean_base']), float(row['level']), increment, .01,
                          base_source='reference', reference_status=row['reference_status'],
                          reference_k3=row['reference_k3'],
                          _terms=[((row['affix_kind'], row['affix']), float(row['mean_base']))])
        rec['reference_uncertainty'] = uncertainty
        rec['tolerance'] = max(rec['tolerance'], uncertainty)
        grouped[key].append(rec)
    return grouped, excluded, zero_native


def fit_joint(groups, scales):
    fits, scored, unsupported = [], [], []
    for key, records in sorted(groups.items()):
        family = fit.scale_family(key)[0]
        k3 = scales.get(family)
        components = sorted({c for r in records for c, _ in r['_terms']})
        meta = dict(zip(fit.KEY_COLUMNS, key)) | dict(k3_family=family, k3=k3)
        if k3 is None:
            unsupported.extend({k: v for k, v in r.items() if k != '_terms'} |
                               dict(status='missing_frozen_k3') for r in records)
            fits.extend(meta | dict(component_kind=c[0], affix=c[1], status='missing_frozen_k3')
                        for c in components)
            continue
        columns = {c: i * 2 for i, c in enumerate(components)}
        design = np.zeros((len(records), 2 * len(components)))
        for i, r in enumerate(records):
            factor = (1 + r['level'] * k3) / (1 + 500 * k3)
            for c, base in r['_terms']:
                j = columns[c]
                design[i, j:j+2] += factor * np.array([1., (base - 200.) / 200.])
        panel = np.array([r['panel'] for r in records])
        tol = np.array([r['tolerance'] for r in records])
        solution, optimum, method, ls_ratio = solve(design, panel, tol)
        raw_indices = [i for i, r in enumerate(records) if r['base_source'] != 'reference']
        raw_optimum = solve(design[raw_indices], panel[raw_indices], tol[raw_indices])[1] if raw_indices else ''
        # Null-space checks identify each component independently, even when
        # unrelated sparsely observed affixes leave the joint system deficient.
        _, singular, vectors = np.linalg.svd(design, full_matrices=True)
        rank = int(np.count_nonzero(singular > singular[0] * max(design.shape) * np.finfo(float).eps))
        nullspace = vectors[rank:]
        identifiable = np.linalg.norm(nullspace, axis=0) < 1e-9
        prediction = design @ solution
        errors = prediction - panel
        ratios = np.abs(errors) / tol
        passes = ratios <= 1 + 1e-7
        for c in components:
            j = columns[c]
            indices = [i for i, r in enumerate(records) if any(term == c for term, _ in r['_terms'])]
            coeff_ok = bool(identifiable[j] and identifiable[j+1])
            relevant_bases = [b for r in records for term, b in r['_terms'] if term == c]
            good = bool(np.all(passes[indices]))
            status = ('pass' if good else 'fail') if coeff_ok else 'unidentifiable_k1_k2'
            scale500 = 1 + 500 * k3
            fits.append(meta | dict(component_kind=c[0], affix=c[1], status=status,
                panel_status='pass' if good else 'fail',
                k1=(solution[j] - solution[j+1]) / scale500 if coeff_ok else '',
                k2=solution[j+1] / (200 * scale500) if coeff_ok else '',
                base200_level500=float(solution[j]) if identifiable[j] else '',
                joint_rank=rank, joint_parameter_count=design.shape[1],
                method=method, count=len(indices),
                sample_count=sum(records[i]['base_source'] != 'reference' for i in indices),
                reference_count=sum(records[i]['base_source'] == 'reference' for i in indices),
                distinct_base_count=len(set(relevant_bases)), base_min=min(relevant_bases),
                base_max=max(relevant_bases), passed_count=int(sum(passes[indices])),
                max_tolerance_ratio=float(max(ratios[indices])),
                joint_minimax_tolerance_ratio=optimum,
                raw_only_joint_minimax_tolerance_ratio=raw_optimum,
                least_squares_max_tolerance_ratio=ls_ratio,
                rmse=float(np.sqrt(np.mean(errors[indices] ** 2)))))
        for r, p, e, ratio, ok in zip(records, prediction, errors, ratios, passes):
            terms = r['_terms']
            scored.append({k: v for k, v in r.items() if k != '_terms'} | dict(
                status='pass' if ok else 'fail', k3=k3, prediction=float(p), error=float(e),
                relative_error=abs(float(e)) / abs(r['panel']) if r['panel'] else '',
                tolerance_ratio=float(ratio),
                model_terms=json.dumps([dict(kind=c[0], affix=c[1], base=b) for c, b in terms]),
                all_components_identifiable=all(all(identifiable[columns[c]:columns[c]+2]) for c, _ in terms)))
    return fits, scored, unsupported


def add_unavailable_components(fits, excluded, scales):
    """Include every observed type/stat/component in the parameter inventory."""
    present = {(tuple(r[c] for c in fit.KEY_COLUMNS), r['component_kind'], r['affix']) for r in fits}
    missing = defaultdict(list)
    for row in excluded:
        if row['status'] == 'outside_current_stage':
            continue
        key = tuple(row[c] for c in fit.KEY_COLUMNS)
        components = json.loads(row.get('components') or '[]') or [('native', '')]
        for kind, name in components:
            identity = key, kind, name
            if identity not in present:
                missing[identity].append(row)
    for (key, kind, name), records in sorted(missing.items()):
        family = fit.scale_family(key)[0]
        reasons = Counter(r['status'] for r in records)
        fits.append(dict(zip(fit.KEY_COLUMNS, key)) | dict(component_kind=kind, affix=name,
            k1='', k2='', k3=scales.get(family), k3_family=family,
            status='unavailable', panel_status='', count=0, sample_count=0, reference_count=0,
            excluded_count=len(records), unavailable_reasons=json.dumps(reasons, ensure_ascii=False)))
    fits.sort(key=lambda r: (*(str(r[c]) for c in fit.KEY_COLUMNS), r['component_kind'], r['affix']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--k3-table', type=Path, default=ROOT / 'hv-k3-pl2.tsv')
    args = parser.parse_args()
    paths = archive_paths()
    items, provenance = load_archives(paths)
    scales = read_scales(args.k3_table)
    references = native_references()
    supplemental_scales = {}
    _, scale_rows = cal.read_table(ROOT / 'hv-affix-k3-summary.tsv')
    for row in scale_rows:
        value = fit.numeric(row['independent_k3_estimate'])
        if row['k3_family'] not in scales and value is not None and row['interval_status'] == 'compatible_interval':
            supplemental_scales[row['k3_family']] = value
    scales.update(supplemental_scales)
    groups, excluded, zero_native = collect_joint(items, provenance, references)
    fits, scored, unsupported = fit_joint(groups, scales)
    excluded.extend(unsupported)
    add_unavailable_components(fits, excluded, scales)
    write_table(ROOT / 'hv-k1-k2-frozen.tsv', fits, fit.KEY_COLUMNS)
    write_table(ROOT / 'hv-k1-k2-frozen-accepted.tsv',
                [row for row in fits if row['status'] == 'pass'], fit.KEY_COLUMNS)
    write_table(ROOT / 'hv-k1-k2-frozen-observations.tsv', scored, fit.KEY_COLUMNS)
    write_table(ROOT / 'hv-k1-k2-frozen-excluded.tsv', excluded, fit.KEY_COLUMNS)
    write_table(ROOT / 'hv-k1-k2-frozen-failures.tsv',
                sorted((r for r in scored if r['status'] == 'fail'),
                       key=lambda r: r['tolerance_ratio'], reverse=True), fit.KEY_COLUMNS)
    write_table(ROOT / 'hv-k3-frozen.tsv', [dict(k3_family=family, k3=value,
                source='hv-affix-k3-summary.tsv' if family in supplemental_scales else args.k3_table.name)
                for family, value in sorted(scales.items())])
    source_paths = [*paths, args.k3_table, *(DATA / f'hv-reference-{name}.tsv'
                    for name in ('melees', 'shields', 'staffs', 'peerless', 'affixes-peerless')),
                    ROOT / 'hv-affix-k3-summary.tsv']
    blocks = {tuple(row[c] for c in fit.KEY_COLUMNS): row for row in fits
              if 'joint_minimax_tolerance_ratio' in row}
    summary = dict(equipment_count=len(items), raw_panel_count=sum(map(len, items.values())),
                   quality_counts=dict(Counter(r[0]['quality'] for r in items.values())),
                   relative_tolerance=RELATIVE_TOLERANCE, display_increment_multiplier=1,
                   k3_source=args.k3_table.name, frozen_scales=scales,
                   supplemental_scales=supplemental_scales,
                   zero_native_stat_count=len(zero_native),
                   joint_stat_count=len(blocks),
                   infeasible_joint_stat_count=sum(r['joint_minimax_tolerance_ratio'] > 1 + 1e-7
                                                   for r in blocks.values()),
                   raw_only_infeasible_joint_stat_count=sum(r['raw_only_joint_minimax_tolerance_ratio'] > 1 + 1e-7
                       for r in blocks.values() if r['raw_only_joint_minimax_tolerance_ratio'] != ''),
                   group_status_counts=dict(Counter(r['status'] for r in fits)),
                   component_status_counts={kind: dict(Counter(r['status'] for r in fits if r['component_kind'] == kind))
                                            for kind in ('native', 'prefix', 'suffix')},
                   scored_panel_count=len(scored),
                   scored_pass_count=sum(r['status'] == 'pass' for r in scored),
                   raw_scored_count=sum(r['base_source'] != 'reference' for r in scored),
                   raw_scored_pass_count=sum(r['status'] == 'pass' and r['base_source'] != 'reference' for r in scored),
                   equipment_avg_counts={attribute: dict(Counter(
                       r['status'] for r in scored if r['attribute'] == attribute
                       and r['base_source'] == 'equipment_avg'))
                       for attribute in sorted(AVG_NATIVE_ATTRIBUTES)},
                   reference_constraint_count=sum(r['base_source'] == 'reference' for r in scored),
                   override_zero_pass_count=sum(r['status'] == 'override_zero' and r['passed'] for r in excluded),
                   excluded_status_counts=dict(Counter(r['status'] for r in excluded)),
                   sources=[dict(path=p.name, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
                            for p in source_paths])
    (ROOT / 'hv-k1-k2-frozen-summary.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    counts = summary['component_status_counts']
    exclusions = summary['excluded_status_counts']
    report = [
        '# 固定 k3 的 k1、k2 全量拟合', '',
        '采用 `hv-k3-pl2.tsv` 中的 16 个数值点估计；Casting Speed 使用已有词缀分析的独立估计 0。'
        '冻结值及来源保存在 `hv-k3-frozen.tsv`，本次全部拟合与可行性检验均保持这些值固定。', '',
        f"合并 {len(paths)} 个原始导出，按 world + equipmentId 保留最新状态：{len(items)} 件装备、"
        f"{summary['raw_panel_count']} 条属性记录。等级范围不设下限。"
        'HP Bonus、MP Bonus 在本阶段只保留于排除记录。', '',
        '本体、前缀、后缀按装备类型/部位/属性分别设独立 k1、k2。加法词缀使用装备所有已导出 rolled Base 的算术平均值，'
        'Burden、Interference 本体也使用同件装备的平均值 AVG；其余本体使用该属性的 rolled Base。'
        '重复导出不会重复增加权重。', '',
        '```text',
        'native = (k1_native + native_input*k2_native) * (1 + level*k3)',
        'native_input = mean_Base for Burden/Interference, Base_stat otherwise',
        'affix  = (k1_affix + mean_Base*k2_affix) * (1 + level*k3)',
        'panel  = native + prefix_increment + suffix_increment',
        'tolerance = max(5e-4 * abs(panel), display_step)',
        'pass iff abs(prediction-panel) <= tolerance', '```', '',
        'display_step 是显示值末位的一个单位：例如 94.21 对应 0.01、5.0 对应 0.1。'
        '允许恰好等于容差；数值边界比较保留 1e-7 的容差比计算余量。', '',
        '| 参数分量 | 已通过 | 未通过 | k1/k2 无法分离 | 无可用模型或输入 |',
        '| --- | ---: | ---: | ---: | ---: |',
    ]
    for kind, label in [('native', '装备本体'), ('prefix', '前缀增量'), ('suffix', '后缀增量')]:
        c = counts[kind]
        report.append(f"| {label} | {c.get('pass', 0)} | {c.get('fail', 0)} | "
                      f"{c.get('unidentifiable_k1_k2', 0)} | {c.get('unavailable', 0)} |")
    report.extend([
        '', '已通过要求参数可独立确定，且涉及该分量的全部拟合约束均通过。只有一档 Base 或本体/词缀贡献无法分开时，'
        'k1、k2 留空；如果 Base 200 的总幅度仍可确定，则保留 `base200_level500`。', '',
        f"原始记录中 {summary['raw_scored_count']} 条进入数值联合拟合，"
        f"其中 {summary['raw_scored_pass_count']} 条达到面板容差。"
        f"清零观测单独通过 {summary['override_zero_pass_count']}/{exclusions.get('override_zero', 0)} 条。"
        '其余排除原因及计数为 ' + '、'.join(
            f'`{reason}` {count} 条' for reason, count in sorted(exclusions.items())
            if reason != 'override_zero') + '。', '',
        '采用 AVG 的原始观测达标情况为 ' + '、'.join(
            f"{attribute} {states.get('pass', 0)}/{sum(states.values())} 条"
            for attribute, states in summary['equipment_avg_counts'].items()) + '。', '',
        '清零与倍率不是独立的普通加法增量。它们保留在记录和参数清单中，并注明效果模型。'
        '有独立 Base 的 Peerless 属性缺失本体 Base 时采用 200；其他品质保留未知。无法计算 AVG 时保留未知。'
        '新增词缀属性只有在同类型完整样本的缺失属性对照支持时才使用本体为 0，证据标签保存在逐条结果中。', '',
        f"另外纳入 {summary['reference_constraint_count']} 条参考约束：三张原生宽表、Peerless 扩展表和"
        '169 条可用的加法词缀增量。派生词缀参考采用 max(相对容差, 0.01, 已有传播区间半宽) 作为约束容差，'
        '该传播不确定性只用于派生参考；原始面板始终使用上式验收。参考表与原始样本有共同来源，'
        '这里的通过率是全量数据拟合相容性，不能当作独立留出验证。', '',
        '优先采用按容差加权的最小二乘；若最小二乘未满足所有约束，则使用线性规划最小化最大容差比。'
        '`joint_minimax_tolerance_ratio > 1` 表示在既定模型、Base 和 k3 下不存在全部达标的参数。'
        '`raw_only_joint_minimax_tolerance_ratio` 单独排除参考约束求解，可区分原始面板冲突和参考约束冲突。', '',
        f"共 {summary['joint_stat_count']} 个联合属性组，其中 {summary['infeasible_joint_stat_count']} 个在全部约束下不可行，"
        f"{summary['raw_only_infeasible_joint_stat_count']} 个仅使用原始面板就已不可行。最差项目如下：", '',
        '| 装备 | 属性 | 全量最小最大容差比 | 仅原始面板 |',
        '| --- | --- | ---: | ---: |',
    ])
    for row in sorted(blocks.values(), key=lambda r: r['joint_minimax_tolerance_ratio'], reverse=True)[:8]:
        report.append(f"| {row['equipment_type']} | {row['attribute']} | "
                      f"{row['joint_minimax_tolerance_ratio']:.6f} | "
                      f"{row['raw_only_joint_minimax_tolerance_ratio']:.6f} |")
    report.extend([
        '', '所有导出的数值 Base 均为整数，本次以导出值为精确输入验收。若这些值本身经过取整，'
        '需要另外指定 Base 的测量误差模型，才能检验该不确定性是否解释冲突。', '',
        '输出文件：', '',
        '- `hv-k1-k2-frozen.tsv`：全部本体/词缀参数及状态。',
        '- `hv-k1-k2-frozen-accepted.tsv`：仅已通过的可确定参数。',
        '- `hv-k1-k2-frozen-observations.tsv`：每条原始或参考约束的预测、误差、容差比及模型分量。',
        '- `hv-k1-k2-frozen-failures.tsv`：未通过的数值观测，按容差比降序。',
        '- `hv-k1-k2-frozen-excluded.tsv`：清零检查及无法进入普通加法模型的逐条原因。',
        '- `hv-k1-k2-frozen-summary.json`：统计、冻结值和全部输入文件 SHA-256。', '',
        '复现：', '', '```powershell', 'python fit_frozen_k3.py',
        'python -m unittest -v test_frozen_k3 test_peerless_calibration test_peerless_affixes', '```', '',
    ])
    (ROOT / 'k1-k2-frozen-fit.md').write_text('\n'.join(report), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
