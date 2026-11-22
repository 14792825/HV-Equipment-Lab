"""Calibrate level scaling and audit Base-200, level-500 references from Peerless.

Run: python calibrate_peerless.py Ponly.csv --update-references
Only stats unaffected by the item's prefix and suffix enter either calculation.
Each equipment type/stat has its own amplitude; reference TSVs are never used
to estimate k3. Constant Base identifies k1 + 200*k2, not k1 and k2 separately.
"""

import argparse
from collections import Counter, defaultdict
import csv
from pathlib import Path

import numpy as np

import fit_hv_equipment as fit


MODEL_EQUIPMENT = fit.ZERO_SCALE_STATS | set(fit.SHARED_EQUIPMENT_SCALES) | {
    fit.PHYSICAL_DAMAGE, "Magic Damage", "Casting Speed", "Counter-resist",
}
MODEL_GROUPS = {"Primary Attributes", "Spell Damage", "Proficiency", "Damage Mitigation"}
SCALE_FIELDS = (
    "k3_family", "k3_status", "k3", "rounding_k3_min", "rounding_k3_max",
    "eligible_count", "equipment_stat_count", "informative_stat_count",
    "level_min", "level_max", "rounding_status",
)
REFERENCE_FIELDS = (*fit.KEY_COLUMNS, "base", "level", "value", "step",
                    "value_min", "value_max", "value_min_at_k3", "value_max_at_k3",
                    "eligible_count", "equipment_ids")
AUDIT_FIELDS = ("table", "equipment", "column", "status", "old_value", "new_value",
                "value_min", "value_max", "eligible_count", "equipment_ids")


def collect_peerless(path):
    equipment = fit.load_equipment(path)
    families = set()
    for rows in equipment.values():
        for row in rows:
            if row["quality"] != "Peerless":
                raise ValueError(f"Non-Peerless item: {row['equipmentId']}")
            base = fit.numeric(row["base"])
            if row["base"] and base != fit.REFERENCE_BASE:
                raise ValueError(f"Non-200 Base: {row['equipmentId']}, {row['attribute']}")
            key = fit.group_key(row)
            if key[-3] in MODEL_GROUPS or (key[-3] == "Equipment" and key[-2] in MODEL_EQUIPMENT):
                families.add(fit.scale_family(key))
                # These two intrinsic constants have no Base field in the export.
                if not row["base"] and key[-3] == "Equipment" and key[-2] in {"Burden", "Interference"}:
                    row["base"] = str(fit.REFERENCE_BASE)
    coverage, observations, exclusions, count = fit.collect(equipment, 0)
    observations = {
        key: np.asarray(rows, dtype=float) for key, rows in observations.items()
        if key[-3] in MODEL_GROUPS or (key[-3] == "Equipment" and key[-2] in MODEL_EQUIPMENT)
    }
    return equipment, families, observations, exclusions, count


def rounding_bounds(groups):
    """Exact nonnegative k3 interval admitting one amplitude per stat group.

    (value_i-step_i/2)/(1+level_i*k3) <=
    (value_j+step_j/2)/(1+level_j*k3) for every i,j is linear in k3.
    """
    low, high = 0.0, np.inf
    for data in groups:
        for a in data:
            for b in data:
                left, right = a[2] - a[3] / 2, b[2] + b[3] / 2
                constant = left - right
                slope = left * b[1] - right * a[1]
                if slope > 0:
                    high = min(high, -constant / slope)
                elif slope < 0:
                    low = max(low, -constant / slope)
                elif constant > 1e-9:
                    return np.inf, -np.inf
    return low, high


def calibrate(families, observations):
    result = {}
    for family in sorted(families):
        groups = {key: data for key, data in observations.items() if fit.scale_family(key) == family}
        blocks = [fit.ReferenceFit({key: 1.0}, {key: data}) for key, data in groups.items()]
        status, k3 = fit.fit_scale([], family[1], blocks)
        low, high = rounding_bounds(groups.values())
        if k3 is not None and low <= high and not family[1]:
            # An unconstrained least-squares minimum need not fit every rounded panel.
            k3 = min(max(k3, low), high)
        levels = [level for data in groups.values() for level in data[:, 1]]
        compatible = bool(levels) and k3 is not None and low - 1e-12 <= k3 <= high + 1e-12
        result[family] = dict(
            k3_family=family[0], k3_status=status, k3=k3,
            rounding_k3_min=low if np.isfinite(low) else "",
            rounding_k3_max=high if np.isfinite(high) else "",
            eligible_count=sum(map(len, groups.values())), equipment_stat_count=len(groups),
            informative_stat_count=sum(block.informative() for block in blocks),
            level_min=min(levels, default=""), level_max=max(levels, default=""),
            rounding_status="within_rounding" if compatible else (
                "inconsistent_panels" if low > high else "no_unaffected_samples" if not levels else "unidentified"),
        )
    return result


def project(observations, scales, equipment):
    item_ids = [f"{world}:{eid}" for world, eid in equipment]
    projected = {}
    for key, data in sorted(observations.items()):
        scale = scales[fit.scale_family(key)]
        k3 = scale["k3"]
        direct_only = k3 is None or (
            scale["rounding_status"] != "within_rounding" and scale["k3_status"] != "fixed_zero"
        )
        if direct_only:
            # Level-500 panels need no level model, even when the family conflicts.
            data = data[data[:, 1] == 500]
            if not len(data):
                continue
            k3 = 0.0
        _, level, panel, step, items = data.T
        factor = (1 + level * k3) / (1 + 500 * k3)
        low = max((panel - step / 2) / factor)
        high = min((panel + step / 2) / factor)
        if low > high + 1e-9:
            continue
        value = np.sum(factor * panel / step ** 2) / np.sum((factor / step) ** 2)
        value = np.clip(value, low, high)
        decimals = max(0, int(round(-np.log10(min(step)))))
        text = f"{value:.{decimals}f}"
        # Propagate k3 uncertainty before using these samples to correct an old cell.
        bounds = (0.0, 0.0) if direct_only or fit.scale_family(key)[1] else (
            scale["rounding_k3_min"], scale["rounding_k3_max"],
        )
        endpoint_factors = []
        for bound in bounds:
            endpoint_factors.append((1 + 500 * bound) / (1 + level * bound)
                                    if bound != "" else 500 / level)
        interval_low = max((panel - step / 2) * np.minimum(*endpoint_factors))
        interval_high = min((panel + step / 2) * np.maximum(*endpoint_factors))
        projected[key] = dict(zip(fit.KEY_COLUMNS, key)) | dict(
            base=200, level=500, value=text, step=10.0 ** -decimals,
            value_min=interval_low, value_max=interval_high,
            value_min_at_k3=low, value_max_at_k3=high, eligible_count=len(data),
            equipment_ids=" | ".join(item_ids[int(item)] for item in items),
        )
    return projected


def read_table(path):
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file, delimiter="\t")
        return reader.fieldnames, list(reader)


def write_table(path, fields, rows):
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fields, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def reference_key(table, name, stat):
    if table == "melees":
        category = "One-handed Weapon" if name in fit.ONE_HANDED else "Two-handed Weapon"
    elif table == "staffs":
        category, name = "Staff", f"{name} Staff"
    else:
        category = "Shield"
        if name != "Buckler":
            name += " Shield"
    return (category, name, "", name, *stat)


def audit_references(projected, update):
    audit, mapped = [], set()
    for table, labels in (("melees", fit.REFERENCE_MELEE), ("staffs", fit.REFERENCE_STAFF),
                          ("shields", fit.REFERENCE_SHIELD)):
        path = fit.DATA / f"hv-reference-{table}.tsv"
        fields, rows = read_table(path)
        original_rows = [dict(row) for row in rows]
        for row in rows:
            mapping = {label: [stat] for label, stat in (fit.REFERENCE_COMMON | labels).items()
                       if label in fields}
            if table == "shields":
                mapping["Random Attribute Value"] = [fit.REFERENCE_COMMON[a] for a in ("Str", "Dex", "Agi", "End")]
            for label, stats in mapping.items():
                keys = [reference_key(table, row["Equipment"], stat) for stat in stats]
                mapped.update(keys)
                evidence = [projected[key] for key in keys if key in projected]
                old = row.get(label, "") or ""
                record = dict(table=path.name, equipment=row["Equipment"], column=label,
                              status="no_unaffected_sample", old_value=old, new_value=old,
                              value_min="", value_max="", eligible_count=0, equipment_ids="")
                if evidence:
                    low = max(p["value_min"] for p in evidence)
                    high = min(p["value_max"] for p in evidence)
                    record.update(value_min=low, value_max=high,
                                  eligible_count=sum(p["eligible_count"] for p in evidence),
                                  equipment_ids=" | ".join(sorted({i for p in evidence for i in p["equipment_ids"].split(" | ")})))
                    if low > high + 1e-9:
                        record["status"] = "conflicting_samples"
                    else:
                        # Existing reference numbers are displayed, rounded values too.
                        old_value = fit.numeric(old.removesuffix("%"))
                        old_step = 10 ** -len(old.removesuffix("%").partition(".")[2])
                        if old_value is not None and old_value + old_step / 2 >= low - 1e-9 and old_value - old_step / 2 <= high + 1e-9:
                            record["status"] = "confirmed"
                        else:
                            point = np.clip(np.mean([float(p["value"]) for p in evidence]), low, high)
                            decimals = max(0, int(round(-np.log10(min(p["step"] for p in evidence)))))
                            new = f"{point:.{decimals}f}" + ("%" if stats[0][-1] == "%" else "")
                            record.update(status="corrected" if old else "added", new_value=new)
                            row[label] = new
                # Keep the audit record for every mapped cell, including empty cells.
                audit.append(record)
            if table == "shields" and row["Equipment"] == "Tower" and all(
                row.get(label) for label in ("Pmit", "Mmit", "Random Attribute Value")
            ):
                row["Notes"] = "Random 3 of Str / Dex / Agi / End"
        if update and rows != original_rows:
            write_table(path, fields, rows)
    extra = [value for key, value in projected.items() if key not in mapped]
    return audit, extra


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--update-references", action="store_true")
    args = parser.parse_args()
    equipment, families, observations, exclusions, count = collect_peerless(args.input)
    scales = calibrate(families, observations)
    projected = project(observations, scales, equipment)
    audit, extra = audit_references(projected, args.update_references)
    write_table(fit.ROOT / "hv-k3-peerless.tsv", SCALE_FIELDS, scales.values())
    write_table(fit.ROOT / "hv-reference-peerless-audit.tsv", AUDIT_FIELDS, audit)
    write_table(fit.DATA / "hv-reference-peerless.tsv", REFERENCE_FIELDS, extra)
    diagnostic_rows = []
    for key in sorted(set(observations) | set(exclusions)):
        if key[-3] not in MODEL_GROUPS and not (key[-3] == "Equipment" and key[-2] in MODEL_EQUIPMENT):
            continue
        data = observations.get(key, ())
        status = "no_unaffected_sample"
        if key in projected:
            status = "reference_available"
        elif len(data):
            low, high = rounding_bounds([data])
            status = "conflicting_panels" if low > high else "inconsistent_k3_family"
        diagnostic_rows.append(dict(zip(fit.KEY_COLUMNS, key)) | dict(
            status=status,
            eligible_count=len(observations.get(key, ())),
            excluded_reasons=" | ".join(f"{reason}={n}" for reason, n in sorted(exclusions[key].items())),
        ))
    write_table(fit.ROOT / "hv-peerless-diagnostics.tsv",
                (*fit.KEY_COLUMNS, "status", "eligible_count", "excluded_reasons"), diagnostic_rows)
    print(f"{count} Peerless items; {sum(map(len, observations.values()))} unaffected observations; "
          f"{len(extra)} additional reference stats.")
    print(dict(Counter(row["status"] for row in audit)))
    print("Affix exclusions:", dict(Counter({reason: sum(c[reason] for c in exclusions.values())
                                           for c in exclusions.values() for reason in c
                                           if reason.startswith(('prefix:', 'suffix:', 'unknown_'))})))
    for row in scales.values():
        print(f"{row['k3_family']}: {row['k3']} ({row['k3_status']}; {row['rounding_status']})")


if __name__ == "__main__":
    main()
