"""Fit power exponents with frozen level scaling and the existing panel equations."""

from collections import Counter, defaultdict
from functools import lru_cache
import json
from math import floor

import numpy as np
from scipy.optimize import brentq, minimize_scalar

import plan_shared_affix_sampling as shared


frozen = shared.frozen
POWER_GRID = np.linspace(0.05, 5.0, 41)
ARMOR_RULE = 'Armor elemental mitigation'


class Profile:
    def __init__(self, rows):
        self.rows = rows
        self.panel = np.array([r[0]['panel'] for r in rows])
        self.tolerance = np.array([r[0]['tolerance'] for r in rows])
        self.columns = {param: i * 2 for i, param in enumerate(
            dict.fromkeys(param for _, terms in rows for param, _, _ in terms))}
        self.bases = sorted({base for _, terms in rows for _, _, base in terms})
        self.indices = tuple(np.array(values) for values in zip(*[
            (i, self.columns[param], factor, self.bases.index(base))
            for i, (_, terms) in enumerate(rows) for param, factor, base in terms]))

    def design(self, p):
        row, col, factor, base_index = self.indices
        basis = (np.asarray(self.bases) / 200) ** p - 1
        design = np.zeros((len(self.rows), 2 * len(self.columns)))
        np.add.at(design, (row, col), factor)
        np.add.at(design, (row, col + 1), factor * basis[base_index])
        return design

    def fit(self, p):
        design = self.design(p)
        solution, _, rank, _ = np.linalg.lstsq(
            design / self.tolerance[:, None], self.panel / self.tolerance, rcond=None)
        residual = (design @ solution - self.panel) / self.tolerance
        return solution, residual, int(rank)

    @lru_cache(maxsize=4096)
    def loss(self, p):
        return float(np.sum(self.fit(p)[1] ** 2))

    def coefficients(self, p):
        solution, _, _ = self.fit(p)
        design = self.design(p) / self.tolerance[:, None]
        _, singular, vectors = np.linalg.svd(design, full_matrices=len(design) < design.shape[1])
        rank = np.count_nonzero(singular > singular[0] * max(design.shape) * np.finfo(float).eps)
        known = np.linalg.norm(vectors[rank:], axis=0) < 1e-8
        return [
            dict(component=param, k1=float(solution[j] - solution[j + 1]),
                 k2=float(solution[j + 1] / 200 ** p))
            if known[j:j + 2].all() else dict(component=param, k1=None, k2=None)
            for param, j in self.columns.items()
        ]


def optimize(loss):
    scores = [loss(p) for p in POWER_GRID]
    best = int(np.argmin(scores))
    candidates = [(scores[best], float(POWER_GRID[best])), (loss(1.0), 1.0)]
    # Refine each sampled local minimum, including a possible boundary minimum.
    for i, score in enumerate(scores):
        if (i and score >= scores[i - 1]) or (i + 1 < len(scores) and score >= scores[i + 1]):
            continue
        result = minimize_scalar(loss, method='bounded',
                                 bounds=(POWER_GRID[max(0, i - 1)], POWER_GRID[min(i + 1, len(scores) - 1)]),
                                 options={'xatol': 1e-5})
        candidates.append((float(result.fun), float(result.x)))
    value, p = min(candidates, key=lambda pair: pair[0])
    if loss(1.0) - value < 1e-8:
        p, value = 1.0, loss(1.0)
    # A descriptive range, not a statistical confidence interval.
    limit = value + max(1.0, 0.01 * value)
    def edge(points):
        inside = p
        for outside in points:
            if loss(outside) > limit:
                return float(brentq(lambda x: loss(x) - limit, min(inside, outside), max(inside, outside)))
            inside = outside
        return float(inside)

    return dict(p=p, near_low=edge(POWER_GRID[POWER_GRID < p][::-1]),
                near_high=edge(POWER_GRID[POWER_GRID > p]))


def metrics(residual):
    return dict(count=len(residual), passed=int(np.sum(np.abs(residual) <= 1 + 1e-7)),
                rms_tolerance=float(np.sqrt(np.mean(residual ** 2))),
                max_tolerance=float(np.max(np.abs(residual))))


def pooled_loss(profiles):
    return lambda p: sum(profile.loss(p) for profile in profiles)


def comparison(profiles, independent, common):
    return {name: metrics(np.concatenate([profile.fit(p)[1]
                                          for profile, p in zip(profiles, powers)]))
            for name, powers in [('linear', [1.0] * len(profiles)),
                                 ('independent', independent),
                                 ('shared', [common] * len(profiles))]}


def source_validation(profile, source):
    train = [row for row in profile.rows if row[0]['source'] != source]
    test = [row for row in profile.rows if row[0]['source'] == source]
    if not train or not test:
        return None
    train, test = Profile(train), Profile(test)
    p = optimize(train.loss)['p']
    result = {'p': p, 'train_base_range': [min(train.bases), max(train.bases)],
              'test_base_range': [min(test.bases), max(test.bases)]}
    for name, exponent in [('linear', 1.0), ('power', p)]:
        solution, _, rank = train.fit(exponent)
        if rank != len(solution) or not test.columns.keys() <= train.columns.keys():
            return None
        ordered = [train.columns[param] + offset for param in test.columns for offset in (0, 1)]
        result[name] = metrics((test.design(exponent) @ solution[ordered] - test.panel) / test.tolerance)
    return result


def load_profiles(scales=None, extra_csv=()):
    root = frozen.ROOT
    isekai_paths = (frozen.DATA / name for name in ('isekai.csv', 'isekai2.csv'))
    paths = [*frozen.archive_paths(), *extra_csv, *(path for path in isekai_paths if path.is_file())]
    if scales is None:
        scales = frozen.read_scales(root / 'hv-k3-frozen.tsv')
    items, provenance = frozen.load_archives(paths)
    for item, rows in items.items():
        if provenance[item].startswith('isekai'):
            for row in rows:
                if not row['level'] and scales.get(frozen.fit.scale_family(frozen.fit.group_key(row))[0]) == 0:
                    row['level'] = '0'
    groups, excluded, _ = frozen.collect_joint(items, provenance, frozen.native_references())
    profiles, armor, skipped = {}, [], Counter()
    for key, records in sorted(groups.items()):
        k3 = scales.get(frozen.fit.scale_family(key)[0])
        rows = []
        for record in records:
            if k3 is None or not record['_terms']:
                skipped['missing_k3' if k3 is None else 'no_terms'] += 1
                continue
            scale = 1 + record['level'] * k3
            terms = [(component, scale, floor(base + .5)
                      if component[0] != 'native' or key[-2] in frozen.AVG_NATIVE_ATTRIBUTES else base)
                     for component, base in record['_terms']]
            if any(base < 0 for _, _, base in terms):
                skipped['negative_base'] += 1
                continue
            rows.append((record, terms))
            rules = [shared.rule(key, component) for component, _, _ in terms]
            if all(rule == ARMOR_RULE for rule, _ in rules):
                armor.append((record, [((ARMOR_RULE,), factor * multiplier, base)
                                       for (_, factor, base), (_, multiplier) in zip(terms, rules)]))
        if rows:
            profiles[key] = (Profile(rows), k3)
    return profiles, Profile(armor), Counter(r['status'] for r in excluded), skipped


def main():
    profiles, armor, excluded, skipped = load_profiles()
    details, groups = [], defaultdict(list)
    for key, (profile, k3) in profiles.items():
        fit = optimize(profile.loss)
        p = fit['p']
        details.append(dict(zip(frozen.fit.KEY_COLUMNS, key)) | fit | dict(
            k3=k3,
            distinct_bases=len(profile.bases), base_range=[min(profile.bases), max(profile.bases)],
            coefficients=profile.coefficients(p), linear=metrics(profile.fit(1.0)[1]),
            power=metrics(profile.fit(p)[1])))
        groups[key[-3:]].append((profile, fit))
    attributes = []
    for key, entries in sorted(groups.items()):
        selected, fits = zip(*entries)
        common = optimize(pooled_loss(selected))
        attributes.append(dict(zip(frozen.fit.KEY_COLUMNS[-3:], key)) | common | dict(
            equipment_groups=len(selected), **comparison(selected, [fit['p'] for fit in fits], common['p'])))
    selected = [profile for profile, _ in profiles.values()]
    common = optimize(pooled_loss(selected))
    linear_attributes = frozen.AVG_NATIVE_ATTRIBUTES
    power_profiles = [profile for key, (profile, _) in profiles.items()
                      if key[-2] not in linear_attributes]
    hybrid = optimize(pooled_loss(power_profiles))
    hybrid_residuals = np.concatenate([
        profile.fit(1.0 if key[-2] in linear_attributes else hybrid['p'])[1]
        for key, (profile, _) in profiles.items()])
    for entry, profile in zip(details, selected):
        entry['global_coefficients'] = profile.coefficients(common['p'])
    armor_fit = optimize(armor.loss)
    armor_p = armor_fit['p']
    result = dict(
        sources=Counter(record['source'] for profile in selected for record, _ in profile.rows),
        excluded=excluded, skipped=skipped,
        global_exponent=common | comparison(selected, [entry['p'] for entry in details], common['p']),
        shared_with_linear_burden_interference=hybrid | metrics(hybrid_residuals),
        armor_elemental=armor_fit | dict(base_range=[min(armor.bases), max(armor.bases)],
            coefficients=armor.coefficients(armor_p),
            linear=metrics(armor.fit(1.0)[1]), power=metrics(armor.fit(armor_p)[1]),
            global_p=metrics(armor.fit(common['p'])[1]),
            isekai2_holdout=source_validation(armor, 'isekai2.csv')),
        attributes=attributes, equipment_attributes=details)
    path = frozen.ROOT / 'hv-power-exponent-audit.json'
    path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(path)


if __name__ == '__main__':
    main()
