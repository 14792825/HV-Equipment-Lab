"""Rebuild the final equipment coefficients from the archived observations."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import sys

import numpy as np


RESULTS = Path(__file__).resolve().parent
sys.path.insert(0, str(RESULTS.parent / 'fit-history'))

from fit_power_exponents import Profile, frozen, load_profiles, metrics, optimize, pooled_loss
from affix_rules import rule as affix_rule
from build_userscript import equipment_types
from native_pooling import candidates, pooled_coefficients, validate


K3_OVERRIDES = {
    'Attack/Magic Accuracy': 0.02000,
    'Block/Evade/Parry/Resist': 0.00500,
    'Physical and Magical Mitigation': 0.00050,
    'Proficiency': 0.02820,
    'Primary Attributes': 0.02824,
    'Spell Damage': 0.00502,
    'Physical Damage': 0.06024,
    'Magic Damage': 0.04400,
}
LINEAR_ATTRIBUTES = {'Burden', 'Interference'}


def fit_shared_affixes(profiles, local_fits, exponent):
    """Fit slot-normalized affix increments after removing identified local terms."""
    observations = defaultdict(list)
    scales = defaultdict(set)
    equipment = defaultdict(set)
    for key, (profile, k3) in profiles.items():
        coefficients = local_fits[key]
        for record, terms in profile.rows:
            shared_terms = [(rule, multiplier, factor, base)
                            for component, factor, base in terms
                            for rule, multiplier in [affix_rule(key, component)]
                            if rule]
            rules = {rule for rule, _, _, _ in shared_terms}
            if len(rules) != 1:
                continue
            rule, = rules
            adjusted = record['panel']
            for component, factor, base in terms:
                if affix_rule(key, component)[0] == rule:
                    continue
                fit = coefficients[component]
                if fit['k1'] is None:
                    break
                adjusted -= factor * (fit['k1'] + fit['k2'] * base ** exponent)
            else:
                observations[rule].append((record | {'panel': adjusted}, [
                    ((rule,), multiplier * factor, base) for _, multiplier, factor, base in shared_terms
                ]))
                scales[rule].add(k3)
                equipment[rule].add(key[3])

    result = {}
    for rule, rows in sorted(observations.items()):
        if len(scales[rule]) != 1:
            continue
        profile = Profile(rows)
        fit, = profile.coefficients(exponent)
        if fit['k1'] is None or fit['k2'] <= 0:
            continue
        result[rule] = dict(k1=fit['k1'], k2=fit['k2'], k3=next(iter(scales[rule])),
                            equipment_types=len(equipment[rule]), diagnostics=metrics(profile.fit(exponent)[1]))
    return result


def fit_baseline(profiles):
    nonlinear = [profile for key, (profile, _) in profiles.items() if key[-2] not in LINEAR_ATTRIBUTES]
    exponent = optimize(pooled_loss(nonlinear))['p']
    local_fits = {}
    for key, (profile, _) in profiles.items():
        p = 1.0 if key[-2] in LINEAR_ATTRIBUTES else exponent
        local_fits[key] = {fit['component']: fit for fit in profile.coefficients(p)}
    return exponent, local_fits, fit_shared_affixes(profiles, local_fits, exponent)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extra-csv', type=Path, action='append', default=[],
                        help='Include an equipment CSV outside the archive. Repeat for additional files.')
    parser.add_argument('--output', type=Path, default=RESULTS / 'coefficients.json')
    args = parser.parse_args()
    scales = frozen.read_scales(frozen.ROOT / 'hv-k3-frozen.tsv') | K3_OVERRIDES
    profiles, _, excluded, skipped = load_profiles(scales, args.extra_csv)
    selected, pooling_audit = validate(profiles, candidates(profiles, equipment_types()), fit_baseline)
    exponent, local_fits, shared_affixes = fit_baseline(profiles)
    # Use the same shared affix coefficients in both models. Pooling targets the
    # native curves; local affix terms are fitted jointly as in the baseline.
    pooled_residuals = {}
    for keys in selected.values():
        pooled = pooled_coefficients(profiles, keys, exponent, pooled_residuals)
        if not pooled:
            raise ValueError(f'Selected native curve could not be fitted for {keys}')
        local_fits.update(pooled)
    groups = []
    residuals = []
    source_residuals = {}
    unidentified = 0
    for key, (profile, k3) in profiles.items():
        p = 1.0 if key[-2] in LINEAR_ATTRIBUTES else exponent
        residual = pooled_residuals[key] if key in pooled_residuals else profile.fit(p)[1]
        residuals.extend(residual)
        components = list(local_fits[key].values())
        unidentified += sum(component['k1'] is None for component in components)
        for (record, _), error in zip(profile.rows, residual):
            source_residuals.setdefault(record['source'], []).append(error)
        groups.append(dict(zip(frozen.fit.KEY_COLUMNS, key)) | dict(
            k3_family=frozen.fit.scale_family(key)[0], k3=k3, p=p,
            diagnostics=metrics(residual), components=components))
    result = dict(
        formula='sum(k1 + k2 * a**p) * (1 + level * k3)',
        objective='sum((prediction - panel)**2 / tolerance**2)',
        avg_rounding='floor(AVG + 0.5)',
        coefficient_scope='equipment attribute and component, with validated native sharing',
        shared_p=exponent, linear_attributes=sorted(LINEAR_ATTRIBUTES), k3_by_family=scales,
        diagnostics=metrics(np.asarray(residuals)),
        by_source={source: metrics(np.asarray(errors)) for source, errors in sorted(source_residuals.items())},
        excluded=dict(excluded), skipped=dict(skipped), unidentified_components=unidentified,
        native_pooling=pooling_audit, shared_affixes=shared_affixes, groups=groups)
    target = args.output
    temporary = target.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + '\n',
                         encoding='utf-8')
    temporary.replace(target)
    print(target)


if __name__ == '__main__':
    main()
