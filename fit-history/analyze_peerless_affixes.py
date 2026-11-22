"""Separate prefix/suffix references at mean Base 200 and level 500.

Uses NumPy and SciPy. Run: python analyze_peerless_affixes.py Ponly.csv
An affix reference is an increment over the native stat, never the total panel.
Native scaling stays at the independent, previously calibrated k3 point.
Linear programming propagates native and panel rounding uncertainty. Prefixes
and suffixes, named affixes, equipment types, slots and stats remain separate.
"""

import argparse
from collections import Counter, defaultdict
import csv
from pathlib import Path
import re

import numpy as np
from scipy.optimize import linprog

import calibrate_peerless as calibration
import fit_hv_equipment as fit


ROOT = Path(__file__).resolve().parent
COMPONENT_COLUMNS = ("affix_kind", "affix", *fit.KEY_COLUMNS)
REFERENCE_COLUMNS = (*COMPONENT_COLUMNS, "mean_base", "level", "effect_model",
    "native_reference", "native_min", "native_max", "native_source", "rule_source",
    "affix_increment", "increment_min", "increment_max", "native_multiplier",
    "multiplier_min", "multiplier_max", "reference_k3", "reference_status",
    "sample_count", "level_min", "level_max", "equipment_ids")
CHECK_COLUMNS = (*COMPONENT_COLUMNS, "k3_family", "current_k3", "current_family_status",
    "native_k3", "free_k3_estimate", "affix_k3_min", "affix_k3_max", "scale_status",
    "current_point_check", "current_interval_check", "current_min_rounding_ratio", "native_status",
    "sample_count", "distinct_level_count", "level_min", "level_max", "equipment_ids")
SUMMARY_COLUMNS = ("affix_kind", "k3_family", "current_k3", "current_family_status",
    "component_count", "scale_informative_count", "independent_k3_estimate",
    "interval_intersection_min", "interval_intersection_max", "interval_status",
    "joint_current_point_check", "sample_count")
DETAIL_COLUMNS = (*COMPONENT_COLUMNS, "equipment_id", "level", "mean_base", "panel",
    "display_step", "native_at_level", "increment_at_level", "reasons")
SPECIAL_ZERO = {("prefix", "ethereal", "Burden"), ("prefix", "ethereal", "Interference"),
                ("suffix", "battlecaster", "Interference")}
SPECIAL_RATIO = {("prefix", "mithril", "Burden"), ("suffix", "arcanist", "Interference")}


def affixes(row, key):
    reasons = fit.affix_reasons(row, key[-3:-1])
    suffix = re.sub(r"^the\s+", "", row["suffix"].strip().casefold())
    # Candidate discovered in this dataset. Kept local to this research script.
    if suffix == "arcanist" and key[-3:-1] == ("Equipment", "Interference"):
        reasons.append("suffix:arcanist")
    return reasons


def is_model_stat(key):
    return key[-3] in calibration.MODEL_GROUPS or (
        key[-3] == "Equipment" and key[-2] in calibration.MODEL_EQUIPMENT)


def load_native_references():
    values = {}
    for table, labels in (("melees", fit.REFERENCE_MELEE), ("staffs", fit.REFERENCE_STAFF),
                          ("shields", fit.REFERENCE_SHIELD)):
        _, rows = calibration.read_table(calibration.fit.DATA / f"hv-reference-{table}.tsv")
        for row in rows:
            if table == "shields":
                for label in ("Str", "Dex", "Agi", "End"):
                    row[label] = row["Random Attribute Value"]
            for label, stat in (fit.REFERENCE_COMMON | labels).items():
                text = row.get(label)
                if not text:
                    continue
                text = text.removesuffix("%")
                value = float(text)
                step = 10.0 ** -len(text.partition(".")[2])
                key = calibration.reference_key(table, row["Equipment"], stat)
                values[key] = (max(0., value-step/2), value+step/2, f"reference_{table}")
    path = calibration.fit.DATA / "hv-reference-peerless.tsv"
    if path.exists():
        _, rows = calibration.read_table(path)
        for row in rows:
            key = tuple(row[c] for c in fit.KEY_COLUMNS)
            values.setdefault(key, (max(0., float(row["value_min"])), float(row["value_max"]),
                                    "reference_peerless"))
    return values


def factor(level, k3):
    return (1 + np.asarray(level) * k3) / (1 + 500 * k3)


def finite_text(value):
    return float(value) if value is not None and np.isfinite(value) else ""


class Component:
    def __init__(self, component, rows, native, native_source, native_status, native_k3,
                 scale, model, rule_source):
        self.component, self.rows = component, rows
        self.native = native
        self.native_source, self.native_status = native_source, native_status
        self.native_k3, self.scale = native_k3, scale
        self.model, self.rule_source = model, rule_source
        self.data = np.asarray([(r["level"], r["panel"], r["step"]) for r in rows])
        self.informative = len(set(self.data[:, 0])) > 1

    def design(self, k3):
        level, panel, step = self.data.T
        return np.column_stack((factor(level, self.native_k3), factor(level, k3)))

    def constraints(self, k3):
        matrix = self.design(k3)
        _, panel, step = self.data.T
        return np.vstack((matrix, -matrix)), np.r_[panel+step/2, -panel+step/2]

    def fixed(self, k3):
        """Exact feasible increment interval with a shared native amplitude."""
        if self.native is None:
            return None
        matrix, target = self.constraints(k3)
        increment_bounds = (None, None) if self.model != "additive" else (0, None)
        bounds = [self.native, increment_bounds]
        low = linprog([0., 1.], A_ub=matrix, b_ub=target, bounds=bounds, method="highs")
        high = linprog([0., -1.], A_ub=matrix, b_ub=target, bounds=bounds, method="highs")
        if not low.success or not high.success:
            return None
        return low.fun, -high.fun

    def profile_loss(self, k3):
        if self.native is None:
            return 0.
        design = self.design(k3)
        _, panel, step = self.data.T
        low, high = self.native
        if high-low < 1e-12:
            target = panel-design[:, 0]*low
            coeff = np.linalg.lstsq(design[:, 1:]/step[:, None], target/step, rcond=None)[0]
            residual = (design[:, 1:]@coeff-target)/step
        else:
            # The native interval is shared by all panels of this component.
            augmented = np.vstack((design/step[:, None], [1/(high-low), 0]))
            target = np.r_[panel/step, (low+high)/2/(high-low)]
            coeff = np.linalg.lstsq(augmented, target, rcond=None)[0]
            residual = augmented@coeff-target
        return float(residual@residual)

    def rounding_ratio(self, k3):
        if self.native is None or self.model != "additive":
            return None
        design = self.design(k3)
        _, panel, step = self.data.T
        matrix = np.vstack((np.column_stack((design, -step/2)),
                            np.column_stack((-design, -step/2))))
        result = linprog([0, 0, 1], A_ub=matrix, b_ub=np.r_[panel, -panel],
                         bounds=[self.native, (0, None), (0, None)], method="highs")
        return float(result.fun) if result.success else None

    def free_scale(self):
        """Exact k3 bounds via a linear-fractional transformation, k3 = v/u.

        panel = native*F_native(level) + u + level*v. Substitute
        b=native/u, t=1/u, k=v/u. Every rounded panel and native bound
        becomes a linear inequality in (b, k, t).
        """
        if self.native is None or self.model != "additive":
            return dict(status="not_applicable" if self.model != "additive" else "unknown_native")
        if not self.informative:
            return dict(status="insufficient_level_variation")
        level, panel, step = self.data.T
        native_factor = factor(level, self.native_k3)
        low, high = self.native
        matrix, target = [], []
        for g, lev, y, s in zip(native_factor, level, panel, step):
            matrix.extend(([g, lev, -(y+s/2)], [-g, -lev, y-s/2]))
            target.extend((-1., 1.))
        matrix.extend(([1, 0, -high], [-1, 0, low]))
        target.extend((0., 0.))
        minimum = linprog([0, 1, 0], A_ub=matrix, b_ub=target,
                          bounds=[(None, None), (0, None), (0, None)], method="highs")
        maximum = linprog([0, -1, 0], A_ub=matrix, b_ub=target,
                          bounds=[(None, None), (0, None), (0, None)], method="highs")
        if not minimum.success:
            return dict(status="no_nonnegative_linear_scale")
        kmin, kmax = max(0., minimum.fun), -maximum.fun if maximum.success else np.inf
        if maximum.status not in (0, 3):
            return dict(status="scale_solver_failure")
        estimate = estimate_scale([self])
        if estimate is not None:
            estimate = min(max(estimate, kmin), kmax)
        return dict(status="identified_interval" if np.isfinite(kmax) else "unbounded_interval",
                    low=kmin, high=kmax, estimate=estimate)


def estimate_scale(components):
    informative = [c for c in components if c.informative and c.native is not None and c.model == "additive"]
    if not informative:
        return None
    max_level = max(c.data[:, 0].max() for c in informative)
    endpoint = 1-1e-9
    grid = np.linspace(0, endpoint, 65)

    def loss(fraction):
        k3 = fraction/(max_level*(1-fraction))
        return sum(c.profile_loss(k3) for c in informative)

    losses = [loss(float(x)) for x in grid]
    if np.ptp(losses) < 1e-9 * max(1., min(losses)):
        return None
    candidates = [(losses[0], 0.), (losses[-1], endpoint)]
    for i in range(len(grid)-1):
        if losses[i] <= min(losses[max(0, i-1)], losses[i+1]) or (
            i == len(grid)-2 and losses[i+1] <= losses[i]
        ):
            a, b = grid[max(0, i-1)], grid[min(len(grid)-1, i+1)]
            candidates.append(fit.refine_minimum(loss, a, b))
    _, fraction = min(candidates)
    return fraction/(max_level*(1-fraction)) if fraction < 1-1e-7 else None


def build_components(path):
    equipment = fit.load_equipment(path)
    scales = {r["k3_family"]: r for r in calibration.read_table(ROOT / "hv-k3-peerless.tsv")[1]}
    references = load_native_references()
    native_rows, affected, items_by_type = defaultdict(list), defaultdict(list), defaultdict(list)
    details, procedural = [], []
    for identity, rows in equipment.items():
        bases = [fit.numeric(r["base"]) for r in rows if r["base"]]
        if rows[0]["quality"] != "Peerless" or not bases or any(b != 200 for b in bases):
            raise ValueError(f"Expected Peerless with all rolled Bases 200: {identity}")
        mean_base = float(np.mean(bases))
        item = dict(identity=":".join(identity), keys=set(), effects={})
        items_by_type[(rows[0]["category"], rows[0]["type"])].append(item)
        seen = set()
        for row in rows:
            key = fit.group_key(row)
            if key in seen:
                raise ValueError(f"Duplicate stat requires explicit decomposition: {identity}, {key}")
            seen.add(key)
            reasons = affixes(row, key)
            item["keys"].add(key)
            item["effects"][key] = reasons
            level, panel = fit.numeric(row["level"]), fit.numeric(row["value"])
            if level is None or panel is None:
                continue
            record = dict(identity=item["identity"], key=key, level=level, panel=panel,
                          step=0. if row["display"] == "None" and panel == 0 else fit.display_step(row),
                          base=row["base"], mean_base=mean_base,
                          name=row["name"], prefix=row["prefix"], suffix=row["suffix"])
            if any(r.startswith("unknown_") for r in reasons):
                raise ValueError(f"Unknown affix: {row['name']}: {reasons}")
            if len(reasons) > 1:
                raise ValueError(f"Overlapping effects need a joint decomposition: {row['name']}, {key}")
            if reasons:
                kind, affix = reasons[0].split(":", 1)
                component = (kind, affix, *key)
                if is_model_stat(key):
                    affected[component].append(record)
                else:
                    procedural.append((component, record))
            elif is_model_stat(key):
                native_rows[key].append(record)
    components = []
    for component, rows in sorted(affected.items()):
        kind, affix, *key_list = component
        key = tuple(key_list)
        family, _ = fit.scale_family(key)
        scale = scales[family]
        native_k3 = float(scale["k3"]) if scale["k3"] else 0.
        native, source, status = None, "unavailable", "unidentified"
        anchors = native_rows[key]
        if anchors:
            lower = max((r["panel"]-r["step"]/2)/factor(r["level"], native_k3) for r in anchors)
            upper = min((r["panel"]+r["step"]/2)/factor(r["level"], native_k3) for r in anchors)
            if lower <= upper+1e-9:
                native = (max(0., lower), max(max(0., lower), upper))
                source, status = "unaffected_peerless", "identified"
            else:
                source, status = "unaffected_peerless", "inconsistent_native_at_current_k3"
        else:
            # Absence of the stat on an unaffected item of the same exact type is
            # a direct zero baseline; do not equate every missing Base to zero.
            absent = []
            for item in items_by_type[(key[0], key[3])]:
                if key in item["keys"]:
                    continue
                # All items here are complete exports. If the stat is absent, an
                # affix cannot be contributing a positive displayed amount to it.
                absent.append(item["identity"])
            # A displayed rolled Base proves a native rolled stat exists, even
            # when another item happens to omit that randomly selected stat.
            if absent and all(not r["base"] for r in rows):
                native, source, status = (0., 0.), "absent_in_same_type_peerless", "identified_zero"
            elif key in references:
                lo, hi, source = references[key]
                native, status = (lo, hi), "reference_anchor"
            elif all(not r["base"] for r in rows) and key[-2] not in {"Burden", "Interference"}:
                native, source, status = (0., 0.), "no_base_added_stat_assumption", "conditional_zero"
        special = (kind, affix, key[-2])
        model = "override_zero" if special in SPECIAL_ZERO else (
            "multiply_native" if special in SPECIAL_RATIO else "additive")
        rule_source = "candidate_from_peerless" if special == ("suffix", "arcanist", "Interference") else "existing_affix_rules"
        components.append(Component(component, rows, native, source, status, native_k3,
                                    scale, model, rule_source))
    return equipment, components, procedural


def joint_feasible(components, k3):
    usable = [c for c in components if c.native is not None and c.model == "additive"]
    if not usable:
        return None
    native_keys = {c.component[2:]: i for i, c in enumerate(usable)}
    native_keys = {key: i for i, key in enumerate(native_keys)}
    n_native, n_total = len(native_keys), len(native_keys)+len(usable)
    matrix, target, bounds = [], [], [(None, None)]*n_native + [(0, None)]*len(usable)
    for i, component in enumerate(usable):
        column = native_keys[component.component[2:]]
        if bounds[column] == (None, None):
            bounds[column] = component.native
        else:
            lo, hi = bounds[column]
            bounds[column] = (max(lo, component.native[0]), min(hi, component.native[1]))
        for level, panel, step in component.data:
            row = np.zeros(n_total)
            row[column] = factor(level, component.native_k3)
            row[n_native+i] = factor(level, k3)
            matrix.extend((row, -row))
            target.extend((panel+step/2, -panel+step/2))
    if any(lo is not None and hi is not None and lo > hi for lo, hi in bounds):
        return False
    result = linprog(np.zeros(n_total), A_ub=matrix, b_ub=target, bounds=bounds, method="highs")
    return bool(result.success)


def make_summary(components, free):
    grouped = defaultdict(list)
    for c in components:
        if c.model == "additive":
            grouped[(c.component[0], c.scale["k3_family"])].append(c)
    summaries, suggested = [], {}
    for (kind, family), group in sorted(grouped.items()):
        scale = group[0].scale
        informative = [c for c in group if free[c.component].get("low") is not None]
        low = max((free[c.component]["low"] for c in informative), default=0.)
        high = min((free[c.component]["high"] for c in informative), default=np.inf)
        estimate = estimate_scale(informative)
        if estimate is not None and low <= high:
            estimate = min(max(estimate, low), high)
        if low > high:
            estimated_status = "inconsistent_intervals"
        elif estimate is not None and joint_feasible(group, estimate) is False:
            # Do not present an estimate as validated if shared native amplitudes
            # make it impossible, even when per-component intervals overlap.
            estimated_status = "joint_estimate_inconsistent"
        else:
            estimated_status = "compatible_interval" if informative else "insufficient_level_variation"
        current = float(scale["k3"]) if scale["k3"] else None
        feasible = joint_feasible(group, current) if current is not None else None
        current_check = "compatible" if feasible else "incompatible" if feasible is False else "no_current_k3"
        if feasible and not informative:
            current_check = "single_level_compatible"
        if scale["rounding_status"] == "inconsistent_panels":
            current_check = "provisional_"+current_check
        summaries.append(dict(affix_kind=kind, k3_family=family, current_k3=current,
            current_family_status=scale["rounding_status"], component_count=len(group),
            scale_informative_count=len(informative), independent_k3_estimate=finite_text(estimate),
            interval_intersection_min=finite_text(low) if informative else "",
            interval_intersection_max=finite_text(high) if informative else "",
            interval_status=estimated_status, joint_current_point_check=current_check,
            sample_count=sum(len(c.rows) for c in group)))
        if estimate is not None and estimated_status == "compatible_interval":
            suggested[(kind, family)] = estimate
    return summaries, suggested


def analyze(components):
    free = {c.component: c.free_scale() for c in components}
    summaries, suggested = make_summary(components, free)
    references, checks, observations = [], [], []
    for c in components:
        identity = dict(zip(COMPONENT_COLUMNS, c.component))
        level, panel, step = c.data.T
        current = float(c.scale["k3"]) if c.scale["k3"] else None
        k3 = current
        scale_source = "current_k3"
        if k3 is None:
            k3 = suggested.get((c.component[0], c.scale["k3_family"]))
            scale_source = "estimated_affix_k3"
        if c.model != "additive":
            k3 = c.native_k3
        interval = c.fixed(k3) if k3 is not None else None
        if interval is None and current is not None:
            own_scale = free[c.component].get("estimate")
            if own_scale is not None:
                alternative = c.fixed(own_scale)
                if alternative is not None:
                    k3, interval, scale_source = own_scale, alternative, "separate_affix_k3"
        native_point = np.mean(c.native) if c.native is not None else None
        increment, ratio, ratio_low, ratio_high = "", "", "", ""
        if c.model == "override_zero":
            ratio = ratio_low = ratio_high = 0.
            if native_point is not None:
                increment = -native_point
                interval = (-c.native[1], -c.native[0])
        elif interval is not None:
            delta = panel-native_point*factor(level, c.native_k3)
            g = factor(level, k3)
            estimate = np.sum(g*delta/step**2)/np.sum((g/step)**2)
            increment = float(np.clip(estimate, *interval))
            # An increment endpoint may require a native value away from its
            # midpoint. Save a jointly feasible pair, not two unrelated estimates.
            native_g = factor(level, c.native_k3)
            feasible_low = max(c.native[0], max((panel-step/2-increment*g)/native_g))
            feasible_high = min(c.native[1], min((panel+step/2-increment*g)/native_g))
            native_point = float(np.clip(native_point, feasible_low, max(feasible_low, feasible_high)))
            if c.model == "multiply_native" and native_point > 0:
                # Solve for multiplier directly, avoiding subtraction error.
                norm = panel/factor(level, c.native_k3)
                rlo = max((panel-step/2)/factor(level, c.native_k3))/c.native[1]
                rhi = min((panel+step/2)/factor(level, c.native_k3))/c.native[0] if c.native[0] > 0 else np.inf
                ratio = float(np.mean(norm)/native_point)
                ratio_low, ratio_high = finite_text(rlo), finite_text(rhi)
        status = "identified" if interval is not None else "unidentified_or_inconsistent"
        if interval is not None and c.native_status == "conditional_zero":
            status = "conditional_native_zero"
        if interval is not None and c.scale["rounding_status"] == "inconsistent_panels":
            status += "_provisional_native_k3"
        if interval is not None and scale_source != "current_k3":
            status += "_"+scale_source
        ids = " | ".join(r["identity"] for r in c.rows)
        metadata = dict(sample_count=len(c.rows), level_min=min(level), level_max=max(level), equipment_ids=ids)
        references.append(identity | dict(mean_base=200, level=500, effect_model=c.model,
            native_reference=finite_text(native_point), native_min=c.native[0] if c.native else "",
            native_max=c.native[1] if c.native else "", native_source=c.native_source,
            rule_source=c.rule_source, affix_increment=increment,
            increment_min=interval[0] if interval else "", increment_max=interval[1] if interval else "",
            native_multiplier=ratio, multiplier_min=ratio_low, multiplier_max=ratio_high,
            reference_k3=k3, reference_status=status) | metadata)
        own = free[c.component]
        at_current = c.fixed(current) if current is not None else None
        check = "compatible" if at_current else "incompatible"
        if current is None:
            check = "no_current_k3"
        elif c.model == "override_zero":
            check = "not_applicable_override"
        elif c.native is None:
            check = "unknown_native"
        elif not c.informative:
            check = "single_level_compatible" if at_current else "single_level_incompatible"
        if c.scale["rounding_status"] == "inconsistent_panels":
            check = "provisional_"+check
        prior_low = fit.numeric(c.scale["rounding_k3_min"])
        prior_high = fit.numeric(c.scale["rounding_k3_max"])
        range_check = "not_testable"
        if own.get("low") is not None and prior_low is not None and prior_high is not None:
            range_check = "overlap" if max(prior_low, own["low"]) <= min(prior_high, own["high"])+1e-12 else "disjoint"
            if c.scale["rounding_status"] == "inconsistent_panels":
                range_check = "invalid_current_family_interval"
        checks.append(identity | dict(k3_family=c.scale["k3_family"], current_k3=current,
            current_family_status=c.scale["rounding_status"], native_k3=c.native_k3,
            free_k3_estimate=finite_text(own.get("estimate")), affix_k3_min=finite_text(own.get("low")),
            affix_k3_max=finite_text(own.get("high")), scale_status=own["status"],
            current_point_check=check, current_interval_check=range_check, native_status=c.native_status,
            current_min_rounding_ratio=finite_text(c.rounding_ratio(current)) if current is not None else "",
            distinct_level_count=len(set(level))) | metadata)
        for r in c.rows:
            native_value = native_point*factor(r["level"], c.native_k3) if native_point is not None else None
            observations.append(identity | dict(equipment_id=r["identity"], level=r["level"], mean_base=r["mean_base"],
                panel=r["panel"], display_step=r["step"], native_at_level=finite_text(native_value),
                increment_at_level=r["panel"]-native_value if native_value is not None else "",
                reasons=f"{c.rule_source}; {c.native_source}"))
    return references, checks, summaries, observations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    equipment, components, procedural = build_components(args.input)
    references, checks, summaries, observations = analyze(components)
    calibration.write_table(calibration.fit.DATA / "hv-reference-affixes-peerless.tsv", REFERENCE_COLUMNS, references)
    calibration.write_table(ROOT / "hv-affix-k3-checks.tsv", CHECK_COLUMNS, checks)
    calibration.write_table(ROOT / "hv-affix-k3-summary.tsv", SUMMARY_COLUMNS, summaries)
    calibration.write_table(ROOT / "hv-affix-observations.tsv", DETAIL_COLUMNS, observations)
    proc_rows = []
    for component, r in procedural:
        proc_rows.append(dict(zip(COMPONENT_COLUMNS, component)) | dict(
            equipment_id=r["identity"], level=r["level"], mean_base=r["mean_base"],
            panel=r["panel"], display_step=r["step"], native_at_level="", increment_at_level="",
            reasons="proc_chance_not_numeric_stat_scaling"))
    calibration.write_table(ROOT / "hv-affix-procs.tsv", DETAIL_COLUMNS, proc_rows)
    print(f"{len(equipment)} Peerless items; {len(components)} numeric affix components; {len(proc_rows)} proc rows.")
    print("References:", dict(Counter(r["reference_status"] for r in references)))
    print("Checks:", dict(Counter(r["current_point_check"] for r in checks)))
    for row in summaries:
        print(row)


if __name__ == "__main__":
    main()
