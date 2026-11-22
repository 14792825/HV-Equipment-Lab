"""Validate native coefficient pooling suggested by equal Peerless panels."""

from collections import defaultdict
from hashlib import sha256

import numpy as np

from affix_rules import rule as affix_rule
from fit_power_exponents import Profile, frozen, metrics


REFERENCE_TABLES = {'hv-reference-melees.tsv', 'hv-reference-staffs.tsv'}
NATIVE = ('native', '')
FOLDS = 5
MIN_GAIN = .005
MIN_ROWS = 20


def candidates(profiles, equipment_types):
    groups = defaultdict(list)
    for key, records in frozen.native_references().items():
        # The runtime uses Great Mace for legacy Mace.
        if key not in profiles or len(equipment_types[key[3]]) > 2:
            continue
        for record in records:
            if record['source'] in REFERENCE_TABLES:
                family = frozen.fit.scale_family(key)[0]
                groups[family, key[-1], profiles[key][1], record['panel']].append(key)
    return {signature: sorted(keys) for signature, keys in sorted(groups.items()) if len(keys) > 1}


def pooled_coefficients(profiles, keys, p, residuals=None):
    rows = [(record, [(NATIVE if component == NATIVE else (key, component), factor, base)
                      for component, factor, base in terms])
            for key in keys for record, terms in profiles[key][0].rows]
    profile = Profile(rows)
    fits = {fit['component']: fit for fit in profile.coefficients(p)}
    native = fits[NATIVE]
    if native['k1'] is None or native['k2'] <= 0:
        return {}
    if residuals is not None:
        errors = profile.fit(p)[1]
        boundaries = np.cumsum([len(profiles[key][0].rows) for key in keys[:-1]])
        residuals.update(zip(keys, np.split(errors, boundaries)))
    return {key: {component: fits[NATIVE if component == NATIVE else (key, component)]
                  | {'component': component}
                  for component in profiles[key][0].columns}
            for key in keys}


def fold_of(record):
    # Keep all attributes of a capture, including duplicates across exports, together.
    return int.from_bytes(sha256(record['source_id'].encode()).digest()[:8], 'big') % FOLDS


def split_profiles(profiles, train_folds, test_fold):
    train, test = {}, {}
    for key, (profile, k3) in profiles.items():
        train_rows, test_rows = [], []
        for row in profile.rows:
            record = row[0]
            if record['base_source'] == 'reference':
                # Projected references and affix estimates come from archived items.
                if record['source'] in REFERENCE_TABLES:
                    train_rows.append(row)
                continue
            fold = fold_of(record)
            if fold in train_folds:
                train_rows.append(row)
            elif fold == test_fold:
                test_rows.append(row)
        if train_rows:
            train[key] = Profile(train_rows), k3
        if test_rows:
            test[key] = test_rows
    return train, test


def residual(key, row, coefficients, shared_affixes, p):
    record, terms = row
    prediction = 0.
    for component, factor, base in terms:
        rule, multiplier = affix_rule(key, component)
        if rule in shared_affixes:
            fit = shared_affixes[rule]
            factor = multiplier * (1 + record['level'] * fit['k3'])
        else:
            fit = coefficients.get(component)
        if fit is None or fit['k1'] is None:
            return None
        prediction += factor * (fit['k1'] + fit['k2'] * base ** p)
    return (prediction - record['panel']) / record['tolerance']


def compare(keys, test, baseline, pooled, shared_affixes, p):
    pairs, extra, lost = [], 0, 0
    for key in keys:
        for row in test.get(key, ()):
            before = residual(key, row, baseline.get(key, {}), shared_affixes, p)
            after = residual(key, row, pooled.get(key, {}), shared_affixes, p)
            if before is not None and after is not None:
                pairs.append((before, after))
            elif before is None and after is not None:
                extra += 1
            elif before is not None:
                lost += 1
    return pairs, extra, lost


def summarize(pairs):
    return dict(zip(('independent', 'pooled'), map(metrics, np.asarray(pairs).T))) if pairs else None


def validate(profiles, groups, fit_baseline):
    # Select on cross-validation within folds 0–3. Fold 4 is reserved for evaluation.
    selection = set(range(FOLDS - 1))
    audits = {signature: dict(selection=[], holdout=[], lost_selection=0, extra_holdout=0, lost_holdout=0)
              for signature in groups}
    for fold in range(FOLDS):
        train, test = split_profiles(profiles, selection - {fold}, fold)
        p, baseline, affixes = fit_baseline(train)
        stage = 'selection' if fold in selection else 'holdout'
        for signature, keys in groups.items():
            available = [key for key in keys if key in train]
            pooled = pooled_coefficients(train, available, p) if available else {}
            pairs, extra, lost = compare(keys, test, baseline, pooled, affixes, p)
            audit = audits[signature]
            audit[stage].extend(pairs)
            if stage == 'holdout':
                audit.update(extra_holdout=extra, lost_holdout=lost)
            else:
                audit['lost_selection'] += lost

    selected, rows, selected_holdout, candidate_holdout = {}, [], [], []
    for signature, keys in groups.items():
        family, unit, k3, value = signature
        audit = audits[signature]
        selection_metrics = summarize(audit['selection'])
        use_pool = len(audit['selection']) >= MIN_ROWS and not audit['lost_selection'] and (
            selection_metrics['pooled']['rms_tolerance']
            < (1 - MIN_GAIN) * selection_metrics['independent']['rms_tolerance'])
        if use_pool:
            selected[signature] = keys
            selected_holdout.extend(audit['holdout'])
        candidate_holdout.extend(audit['holdout'])
        rows.append(dict(family=family, unit=unit, k3=k3, peerless=value,
                         members=[f'{key[3]}/{key[-2]}' for key in keys], selected=use_pool,
                         selection=selection_metrics, holdout=summarize(audit['holdout']),
                         lost_selection_predictions=audit['lost_selection'],
                         additional_holdout_predictions=audit['extra_holdout'],
                         lost_holdout_predictions=audit['lost_holdout']))
    return selected, dict(reference_tables=sorted(REFERENCE_TABLES), fold_unit='world and equipment ID',
                          selection_folds=sorted(selection), holdout_fold=FOLDS - 1,
                          minimum_selection_count=MIN_ROWS, minimum_relative_rms_gain=MIN_GAIN,
                          selected_holdout=summarize(selected_holdout),
                          all_candidates_holdout=summarize(candidate_holdout), groups=rows)
