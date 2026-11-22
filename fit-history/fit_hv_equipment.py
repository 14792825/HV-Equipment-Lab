"""Fit f = (k1 + Base*k2) * (1 + level*k3) to an HV archive CSV.

Requires NumPy. Run with --help for input and output options.
Affix rules are transcribed from the local Detailed Equip Characteristics
snapshot. Fits are weighted by displayed panel precision.
The reference tables compare unmodified equipment at Base 200 and level 500.
"""

import argparse
from collections import Counter, defaultdict
import csv
from pathlib import Path
import re

import numpy as np


ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / 'fit-data' if ROOT.name == 'fit-history' else ROOT
ELEMENTS = ("Fire", "Cold", "Elec", "Wind", "Holy", "Dark")
WEAPON_CATEGORIES = {"One-handed Weapon", "Two-handed Weapon", "Staff"}
ARMOR_CATEGORIES = {"Cloth Armor", "Light Armor", "Heavy Armor"}
PHYSICAL_DAMAGE = "Physical Damage"
ZERO_SCALE_STATS = {
    "Burden", "Interference", "Mana Conservation", "Attack Speed",
    "Attack Crit Damage", "Magic Crit Damage",
}
SHARED_EQUIPMENT_SCALES = {
    "Block": "Block/Evade/Parry/Resist",
    "Evade": "Block/Evade/Parry/Resist",
    "Parry": "Block/Evade/Parry/Resist",
    "Resist": "Block/Evade/Parry/Resist",
    "Attack Accuracy": "Attack/Magic Accuracy",
    "Magic Accuracy": "Attack/Magic Accuracy",
    "Physical Mitigation": "Physical and Magical Mitigation",
    "Magical Mitigation": "Physical and Magical Mitigation",
}
WEAPON_DAMAGE_LABELS = {
    "Attack Damage", PHYSICAL_DAMAGE, "Slashing Damage", "Crushing Damage",
    "Piercing Damage", "Void Damage",
}
SLOTS = {
    "Cap": "Head", "Helmet": "Head", "Robe": "Body", "Cuirass": "Body",
    "Armor": "Body", "Breastplate": "Body", "Gloves": "Hands", "Gauntlets": "Hands",
    "Pants": "Legs", "Leggings": "Legs", "Greaves": "Legs", "Shoes": "Feet",
    "Boots": "Feet", "Sabatons": "Feet",
}


def equipment_stats(*names):
    return {("Equipment", name) for name in names}


PREFIX_EFFECTS = {
    "ethereal": set(),  # Void replaces the physical damage label; handle it below.
    "charged": equipment_stats("Casting Speed"),
    "frugal": equipment_stats("Mana Conservation"),
    "radiant": equipment_stats("Magic Damage"),
    "mystic": equipment_stats("Magic Crit Damage"),
    "agile": equipment_stats("Attack Speed"),
    "savage": equipment_stats("Attack Crit Damage"),
    "shielding": equipment_stats("Block"),
    "mithril": equipment_stats("Burden"),
    "reinforced": {("Damage Mitigation", attr) for attr in ("Crushing", "Piercing", "Slashing")},
}
for prefix, element in zip(
    ("fiery", "arctic", "shocking", "tempestuous", "hallowed", "demonic"), ELEMENTS
):
    PREFIX_EFFECTS[prefix] = {("Spell Damage", element), ("Equipment", f"{element} Strike")}
for prefix, element in zip(("ruby", "cobalt", "amber", "jade", "zircon", "onyx"), ELEMENTS):
    PREFIX_EFFECTS[prefix] = {("Damage Mitigation", element)}

SUFFIX_EFFECTS = {
    "slaughter": equipment_stats(PHYSICAL_DAMAGE),
    "balance": equipment_stats("Attack Accuracy", "Attack Crit Damage"),
    "nimble": equipment_stats("Parry"),
    "battlecaster": equipment_stats("Magic Accuracy", "Mana Conservation", "Interference"),
    "swiftness": equipment_stats("Attack Speed"),
    "focus": equipment_stats("Magic Accuracy", "Magic Crit Damage", "Mana Conservation"),
    "vampire": equipment_stats("Siphon Health"),
    "illithid": equipment_stats("Siphon Magic", "Siphon Mana"),
    "banshee": equipment_stats("Siphon Spirit"),
    "destruction": equipment_stats("Magic Damage"),
    "barrier": equipment_stats("Block"),
    "fleet": equipment_stats("Evade"),
    "protection": equipment_stats("Physical Mitigation"),
    "warding": equipment_stats("Magical Mitigation"),
    "dampening": {("Damage Mitigation", "Crushing")},
    "deflection": {("Damage Mitigation", "Piercing")},
    "stoneskin": {("Damage Mitigation", "Slashing")},
    "shadowdancer": equipment_stats("Evade", "Attack Crit Damage"),
    "arcanist": equipment_stats("Magic Accuracy") | {
        ("Primary Attributes", "Intelligence"), ("Primary Attributes", "Wisdom"),
    },
    "negation": equipment_stats("Resist"),
}
for suffix, attr in zip(
    ("ox", "raccoon", "cheetah", "fox", "owl", "turtle"),
    ("Strength", "Dexterity", "Agility", "Intelligence", "Wisdom", "Endurance"),
):
    SUFFIX_EFFECTS[suffix] = {("Primary Attributes", attr)}
for suffix, attr in zip(
    ("elementalist", "heaven-sent", "demon-fiend", "earth-walker", "curse-weaver"),
    ("Elemental", "Divine", "Forbidden", "Supportive", "Deprecating"),
):
    SUFFIX_EFFECTS[suffix] = {("Proficiency", attr)}
for suffix, element in zip(("surtr", "niflheim", "mjolnir", "freyr", "heimdall", "fenrir"), ELEMENTS):
    SUFFIX_EFFECTS[suffix] = {("Spell Damage", element)}
for suffix, element in zip(
    ("fire-eater", "frost-born", "thunder-child", "wind-waker", "thrice-blessed", "spirit-ward"),
    ELEMENTS,
):
    SUFFIX_EFFECTS[suffix] = {("Damage Mitigation", element)}


def group_key(row):
    category, equipment_type = row["category"], row["type"]
    subtype, part = equipment_type, ""
    if category in ARMOR_CATEGORIES:
        subtype, part = equipment_type.rsplit(" ", 1)
    attribute = row["attribute"]
    if row["attributeGroup"] == "Equipment" and attribute in WEAPON_DAMAGE_LABELS:
        attribute = PHYSICAL_DAMAGE
    return (
        category, subtype, SLOTS.get(part, part), equipment_type,
        row["attributeGroup"], attribute, row["unit"].replace("\u00d7", "x"),
    )


def affix_reasons(row, stat):
    prefix = row["prefix"].strip().casefold()
    suffix = re.sub(r"^the\s+", "", row["suffix"].strip().casefold())
    suffix = {"bansheee": "banshee"}.get(suffix, suffix)
    reasons = []
    for kind, affix, effects in (
        ("prefix", prefix, PREFIX_EFFECTS), ("suffix", suffix, SUFFIX_EFFECTS),
    ):
        if affix and affix not in effects:
            reasons.append(f"unknown_{kind}:{affix}")
        elif affix and stat in effects[affix]:
            reasons.append(f"{kind}:{affix}")
    if row["category"] in WEAPON_CATEGORIES and prefix == "ethereal":
        if stat in equipment_stats("Burden", "Interference", "Void Strike"):
            reasons.append("prefix:ethereal")
    return reasons


def load_equipment(path):
    """Keep the latest captured state per world and equipment ID."""
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        required = set(KEY_SOURCE_COLUMNS) | {
            "world", "equipmentId", "savedAt", "sampleId", "nameStatus",
            "prefix", "suffix", "level", "base", "value", "display",
        }
        if missing := required - set(reader.fieldnames or []):
            raise ValueError(f"Missing input columns: {', '.join(sorted(missing))}")
        samples = defaultdict(list)
        for row in reader:
            key = (row["world"], row["equipmentId"])
            version = (row["savedAt"], row["sampleId"])
            samples[key, version].append(row)
    latest = {}
    for (key, version), rows in sorted(samples.items()):
        latest[key] = rows
    return latest


def numeric(text):
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if np.isfinite(value) else None


def display_step(row):
    match = re.search(r"\d[\d,]*(?:\.(\d+))?", row["display"] or row["value"])
    return 10.0 ** -len(match[1] or "") if match else 1.0


def collect(equipment, min_level):
    observations = defaultdict(list)
    exclusions = defaultdict(Counter)
    coverage = defaultdict(set)
    in_scope = 0
    for item_number, (item, rows) in enumerate(equipment.items()):
        level = numeric(rows[0]["level"])
        if level is None or level < min_level:
            continue
        in_scope += 1
        if rows[0]["nameStatus"] != "parsed" or not rows[0]["type"]:
            continue
        by_stat = defaultdict(list)
        for row in rows:
            by_stat[group_key(row)].append(row)
        for key, stat_rows in by_stat.items():
            coverage[key].add(item)
            reasons = affix_reasons(stat_rows[0], key[-3:-1])
            if reasons:
                exclusions[key].update(reasons)
                continue
            usable = {
                (base, value, display_step(row))
                for row in stat_rows
                if (base := numeric(row["base"])) is not None
                and (value := numeric(row["value"])) is not None
            }
            if len(usable) == 1:
                base, value, step = usable.pop()
                observations[key].append((base, level, value, step, item_number))
            else:
                exclusions[key]["missing_base_or_value" if not usable else "conflicting_stat"] += 1
    return coverage, observations, exclusions, in_scope


def scale_family(key):
    group, attribute, _ = key[-3:]
    if group == "Damage Mitigation":
        return group, True
    if group == "Equipment":
        return SHARED_EQUIPMENT_SCALES.get(attribute, attribute), attribute in ZERO_SCALE_STATS
    if group in {"Primary Attributes", "Spell Damage", "Proficiency"}:
        return group, False
    return attribute, False


def local_fit_status(data):
    if len(data) < 2:
        return "insufficient_samples"
    if np.ptp(data[:, 0]) == 0:
        return "no_base_variation"
    return "fitted"


def fit_local(data, k3):
    if local_fit_status(data) != "fitted":
        return None
    base, level, panel, step, _ = data.T
    center = base.mean()
    factor = (1 + level * k3) / step
    design = np.column_stack((factor, (base - center) * factor))
    offset, slope = np.linalg.lstsq(design, panel / step, rcond=None)[0]
    return offset - slope * center, slope, k3


REFERENCE_BASE = 200
REFERENCE_COMMON = {
    "Block": ("Equipment", "Block", ""),
    **{short: ("Primary Attributes", name, "") for short, name in (
        ("Str", "Strength"), ("Dex", "Dexterity"), ("Agi", "Agility"),
        ("End", "Endurance"), ("Int", "Intelligence"), ("Wis", "Wisdom"),
    )},
}
REFERENCE_MELEE = {
    "ADB": ("Equipment", PHYSICAL_DAMAGE, ""),
    "PAcc": ("Equipment", "Attack Accuracy", ""),
    "AS": ("Equipment", "Attack Speed", "%"),
    "Crit Dmg": ("Equipment", "Attack Crit Damage", "x"),
    "Parry": ("Equipment", "Parry", ""),
}
REFERENCE_SHIELD = {
    "Pmit": ("Equipment", "Physical Mitigation", "%"),
    "Mmit": ("Equipment", "Magical Mitigation", "%"),
}
REFERENCE_STAFF = {
    "MDB": ("Equipment", "Magic Damage", ""),
    "Macc": ("Equipment", "Magic Accuracy", ""),
    "M.Crit Dmg": ("Equipment", "Magic Crit Damage", "x"),
    "CR": ("Equipment", "Counter-resist", "%"),
    **{name: ("Spell Damage", name, "") for name in ELEMENTS if name != "Cold"},
    "Ice": ("Spell Damage", "Cold", ""),
    **{short: ("Proficiency", name, "") for short, name in (
        ("Elem Prof", "Elemental"), ("Holy Prof", "Divine"), ("Dark Prof", "Forbidden"),
        ("Supp Prof", "Supportive"), ("Depr Prof", "Deprecating"),
    )},
}
ONE_HANDED = {"Shortsword", "Club", "Rapier", "Dagger", "Wakizashi", "Axe"}


def load_reference_tables():
    values = defaultdict(dict)
    for table, labels in (
        ("melees", REFERENCE_MELEE), ("shields", REFERENCE_SHIELD), ("staffs", REFERENCE_STAFF),
    ):
        with (DATA / f"hv-reference-{table}.tsv").open(encoding="utf-8-sig", newline="") as file:
            for row in csv.DictReader(file, delimiter="\t"):
                name = row["Equipment"]
                if table == "shields":
                    category = "Shield"
                    if name != "Buckler":
                        name += " Shield"
                    for attr in ("Str", "Dex", "Agi", "End"):
                        row[attr] = row["Random Attribute Value"]
                elif table == "staffs":
                    category, name = "Staff", f"{name} Staff"
                else:
                    category = "One-handed Weapon" if name in ONE_HANDED else "Two-handed Weapon"
                for label, stat in (REFERENCE_COMMON | labels).items():
                    if text := row.get(label):
                        value = float(text.removesuffix("%"))
                        if not np.isfinite(value) or value <= 0:
                            raise ValueError(f"Invalid reference value: {name}, {label}: {text}")
                        values[stat][(category, name, "", name, *stat)] = value
    extra_path = DATA / "hv-reference-peerless.tsv"
    if extra_path.exists():
        with extra_path.open(encoding="utf-8-sig", newline="") as file:
            for row in csv.DictReader(file, delimiter="\t"):
                if float(row["base"]) != REFERENCE_BASE or float(row["level"]) != 500:
                    raise ValueError(f"Unexpected reference Base/level: {extra_path}")
                key = tuple(row[column] for column in KEY_COLUMNS)
                value = float(row["value"])
                if not np.isfinite(value) or value < 0:
                    raise ValueError(f"Invalid reference value: {key}: {value}")
                # Zero panels cannot define a reference ratio. They remain in the TSV.
                if value > 0:
                    values[key[-3:]].setdefault(key, value)
    return [group for group in values.values() if len(group) >= 2]


def load_k3_table(path):
    """External Peerless calibration is independent of the fitted archive's Base rolls."""
    if path is None:
        return {}
    scales = {}
    with path.open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file, delimiter="\t"):
            if row["k3"] == "" or row["rounding_status"] != "within_rounding":
                continue
            k3 = float(row["k3"])
            if not np.isfinite(k3) or k3 < 0:
                raise ValueError(f"Invalid k3 calibration: {row['k3_family']}")
            scales[row["k3_family"]] = (f"peerless_{row['k3_status']}", k3)
    return scales


class ReferenceFit:
    """Fit one reference attribute with a common Base-200 factor and one slope per value."""

    def __init__(self, ratios, samples):
        self.ratios = ratios
        self.samples = samples
        self.slope_column = {ratio: i for i, ratio in enumerate(sorted(set(ratios.values())), 1)}
        self.data = np.concatenate(list(samples.values()))
        design = np.zeros((len(self.data), 1 + len(self.slope_column)))
        start = 0
        for key, data in samples.items():
            ratio = ratios[key]
            rows = slice(start, start + len(data))
            design[rows, 0] = ratio
            design[rows, self.slope_column[ratio]] = (data[:, 0] - REFERENCE_BASE) / REFERENCE_BASE
            start += len(data)
        # Work in the identifiable row space, even if a chart class has no archive data.
        _, singular, vectors = np.linalg.svd(design, full_matrices=len(design) < design.shape[1])
        tolerance = singular[0] * max(design.shape) * np.finfo(float).eps if singular.size else 0
        rank = np.count_nonzero(singular > tolerance)
        self.basis = vectors[:rank].T
        self.identifiable = np.linalg.norm(vectors[rank:], axis=0) < 1e-10
        self.design = design @ self.basis

    def without(self, item):
        if not np.any(self.data[:, 4] == item):
            return self
        return ReferenceFit(self.ratios, {
            key: data[data[:, 4] != item] for key, data in self.samples.items()
        })

    def informative(self):
        return len(self.data) > self.design.shape[1] and np.ptp(self.data[:, 1]) > 0

    def loss(self, level_scale, fractions):
        _, level, panel, step, _ = self.data.T
        factor = (1 + fractions[:, None] * (level / level_scale - 1)) / step
        design = factor[:, :, None] * self.design
        target = panel / step
        # A batch QR fit avoids normal equations when slopes are poorly determined.
        q, _ = np.linalg.qr(design)
        projected = np.einsum("fij,i->fj", q, target)
        residual = target - np.einsum("fij,fj->fi", q, projected)
        return (residual ** 2).sum(axis=1)

    def coefficients(self, k3):
        if k3 is None or not self.identifiable[0]:
            return {}
        _, level, panel, step, _ = self.data.T
        factor = (1 + level * k3) / step
        reduced = np.linalg.lstsq(factor[:, None] * self.design, panel / step, rcond=None)[0]
        solution = self.basis @ reduced
        results = {}
        for key, ratio in self.ratios.items():
            column = self.slope_column[ratio]
            if self.identifiable[column]:
                k2 = solution[column] / REFERENCE_BASE
                results[key] = (ratio * solution[0] - REFERENCE_BASE * k2, k2, k3)
        return results


def profile_loss(data, level_scale, fractions):
    base, level, panel, step, _ = data.T
    # fraction = level_scale*k3/(1 + level_scale*k3); 1 denotes the infinite limit.
    factor = 1 + fractions[:, None] * (level / level_scale - 1)
    level_adjusted = panel / factor
    weight = (factor / step) ** 2
    total_weight = weight.sum(axis=1, keepdims=True)
    x = base - (weight @ base)[:, None] / total_weight
    y = level_adjusted - (weight * level_adjusted).sum(axis=1, keepdims=True) / total_weight
    slope = (weight * x * y).sum(axis=1) / (weight * x * x).sum(axis=1)
    return (weight * (y - slope[:, None] * x) ** 2).sum(axis=1)


def refine_minimum(loss, low, high):
    ratio = (np.sqrt(5) - 1) / 2
    left, right = high - ratio * (high - low), low + ratio * (high - low)
    f_left, f_right = loss(left), loss(right)
    for _ in range(32):
        if f_left <= f_right:
            high, right, f_right = right, left, f_left
            left = high - ratio * (high - low)
            f_left = loss(left)
        else:
            low, left, f_left = left, right, f_right
            right = low + ratio * (high - low)
            f_right = loss(right)
    return min((f_left, left), (f_right, right))


def fit_scale(groups, fixed_zero, references=()):
    if fixed_zero:
        return "fixed_zero", 0.0
    informative = [
        data for data in groups
        if len(data) >= 3 and np.ptp(data[:, 0]) > 0 and np.ptp(data[:, 1]) > 0
    ]
    reference_fits = [reference for reference in references if reference.informative()]
    level_data = informative + [reference.data for reference in reference_fits]
    if not level_data:
        return "insufficient_scale_samples", None
    level_scale = max(data[:, 1].max() for data in level_data)
    # Level 0 is allowed with --min-level 0. Avoid a zero factor in the infinite limit.
    endpoint = 1.0 if all(data[:, 1].min() > 0 for data in level_data) else 1 - 1e-9
    grid = np.linspace(0, endpoint, 65)

    def losses(fractions):
        return (sum(profile_loss(data, level_scale, fractions) for data in informative)
                + sum(reference.loss(level_scale, fractions) for reference in reference_fits))

    sampled = losses(grid)
    if np.ptp(sampled) <= 1e-9 * max(1, sampled.min()):
        return "unidentifiable_scale", None
    candidates = [(sampled[0], 0.0), (sampled[-1], endpoint)]
    for i in range(1, len(grid) - 1):
        if sampled[i] <= min(sampled[i - 1], sampled[i + 1]):
            candidates.append(refine_minimum(
                lambda point: losses(np.array([point]))[0], grid[i - 1], grid[i + 1]
            ))
    # An interior minimum can be between an endpoint and its first grid neighbor.
    for i, end, neighbor in ((0, grid[0], grid[1]), (-1, grid[-1], grid[-2])):
        if sampled[i] <= sampled[1 if i == 0 else -2]:
            value, point = refine_minimum(
                lambda pos: losses(np.array([pos]))[0], min(end, neighbor), max(end, neighbor)
            )
            if abs(point - end) > 1e-7:
                candidates.append((value, point))
    best_loss, fraction = min(candidates)
    if any(
        abs(other - fraction) > 1e-7 and abs(loss - best_loss) < 1e-9 * max(1, best_loss)
        for loss, other in candidates
    ):
        return "multiple_scale_solutions", None
    if fraction >= 1 - 1e-7:
        return "no_finite_scale", None
    if fraction == 0:
        return "estimated_zero", 0.0
    return "estimated", fraction / (level_scale * (1 - fraction))


def predict(coefficients, base, level):
    k1, k2, k3 = coefficients
    return (k1 + base * k2) * (1 + level * k3)


def score(data, coefficients, holdout_fit, min_holdout=3):
    base, level, panel, step, items = data.T
    error = predict(coefficients, base, level) - panel
    in_rounding = np.abs(error) <= step / 2 + 1e-9
    holdout_error, holdout_step = [], []
    if len(data) >= min_holdout:
        for i, item in enumerate(items):
            subset_fit = holdout_fit(item)
            if subset_fit is not None:
                holdout_error.append(predict(subset_fit, base[i], level[i]) - panel[i])
                holdout_step.append(step[i])
    held = np.asarray(holdout_error)
    held_within = np.abs(held) <= np.asarray(holdout_step) / 2 + 1e-9
    if not np.all(in_rounding):
        status = "training_outside_rounding"
    elif not len(held):
        status = "no_holdout"
    elif not np.all(held_within):
        status = "holdout_outside_rounding"
    elif len(held) < len(data):
        status = "holdout_incomplete"
    else:
        status = "within_rounding"
    return {
        "fit_status": status,
        "rmse": np.sqrt(np.mean(error ** 2)),
        "max_abs_error": np.max(np.abs(error)),
        "within_rounding_count": np.count_nonzero(in_rounding),
        "max_rounding_ratio": np.max(2 * np.abs(error) / step),
        "holdout_count": len(held),
        "holdout_within_rounding_count": np.count_nonzero(held_within),
        "holdout_rmse": np.sqrt(np.mean(held ** 2)) if held.size else "",
        "holdout_max_abs_error": np.max(np.abs(held)) if held.size else "",
        "holdout_max_rounding_ratio": np.max(2 * np.abs(held) / holdout_step) if held.size else "",
    }


KEY_SOURCE_COLUMNS = ("category", "type", "attributeGroup", "attribute", "unit")
KEY_COLUMNS = (
    "category", "subtype", "slot", "equipment_type", "attribute_group", "attribute", "unit",
)
SAMPLE_COLUMNS = (
    "eligible_count", "distinct_base_count", "distinct_level_count",
    "base_min", "base_max", "level_min", "level_max",
)
SCALE_COLUMNS = ("k3_family", "k3_status")
FIT_COLUMNS = (*KEY_COLUMNS, "k1", "k2", "k3", *SCALE_COLUMNS, *SAMPLE_COLUMNS,
               "fit_status", "rmse", "max_abs_error", "within_rounding_count", "max_rounding_ratio",
               "holdout_count", "holdout_within_rounding_count", "holdout_rmse",
               "holdout_max_abs_error", "holdout_max_rounding_ratio")
DIAGNOSTIC_COLUMNS = (*KEY_COLUMNS, "status", "k3", *SCALE_COLUMNS, "recorded_count",
                      *SAMPLE_COLUMNS, "excluded_reasons")


def write_csv(path, fields, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Equipment archive export")
    parser.add_argument("--output", type=Path, default=ROOT / "hv-equipment-fit-constrained.csv")
    parser.add_argument("--diagnostics", type=Path,
                        default=ROOT / "hv-equipment-fit-constrained-diagnostics.csv")
    parser.add_argument("--min-level", type=int, default=300, help="Inclusive threshold (default: 300)")
    parser.add_argument("--k3-table", type=Path,
                        help="Independent k3 calibration TSV, e.g. hv-k3-peerless.tsv")
    args = parser.parse_args()
    if len({path.resolve() for path in (args.input, args.output, args.diagnostics)}) != 3:
        parser.error("input, output, and diagnostics must be different paths")
    equipment = load_equipment(args.input)
    coverage, observations, exclusions, in_scope = collect(equipment, args.min_level)
    reference_groups = load_reference_tables()
    reference_keys = {key for group in reference_groups for key in group}
    data_by_key = {
        key: np.asarray(observations[key], dtype=float).reshape(-1, 5)
        for key in sorted(set(coverage) | reference_keys)
    }
    families = defaultdict(list)
    references = defaultdict(list)
    reference_by_key = {}
    for group in reference_groups:
        anchor = max(group.values())
        reference = ReferenceFit(
            {key: value / anchor for key, value in group.items()},
            {key: data_by_key[key] for key in group},
        )
        family = scale_family(next(iter(group)))
        references[family].append(reference)
        reference_by_key.update(dict.fromkeys(group, reference))
    for key, data in data_by_key.items():
        family = scale_family(key)
        if key not in reference_by_key:
            families[family].append(data)
    scales = {
        family: fit_scale(families[family], family[1], references[family])
        for family in sorted(set(families) | set(references))
    }
    calibrated_scales = load_k3_table(args.k3_table)
    for family in scales:
        if family[0] in calibrated_scales:
            scales[family] = calibrated_scales[family[0]]
    reference_coefficients = {
        key: coefficients
        for family, blocks in references.items()
        for block in blocks
        for key, coefficients in block.coefficients(scales[family][1]).items()
    }
    holdout_scales = {}

    def holdout_fit(key, item):
        family = scale_family(key)
        reference = reference_by_key.get(key)
        remaining_reference = reference.without(item) if reference is not None else None
        k3 = 0.0
        if family[0] in calibrated_scales:
            # Hold out archive observations while retaining independent calibration.
            k3 = calibrated_scales[family[0]][1]
        elif not family[1]:
            cache_key = family, item
            if cache_key not in holdout_scales:
                groups = [data[data[:, 4] != item] for data in families[family]]
                blocks = [
                    remaining_reference if block is reference else block.without(item)
                    for block in references[family]
                ]
                holdout_scales[cache_key] = fit_scale(groups, False, blocks)[1]
            k3 = holdout_scales[cache_key]
        if remaining_reference is not None:
            return remaining_reference.coefficients(k3).get(key)
        if k3 is not None:
            data = data_by_key[key]
            return fit_local(data[data[:, 4] != item], k3)
        return None

    fits, diagnostics = [], []
    for key, data in data_by_key.items():
        base, level, _, _, _ = data.T
        family = scale_family(key)
        scale_status, k3 = scales[family]
        metadata = dict(zip(KEY_COLUMNS, key))
        metadata.update(
            k3_family=family[0], k3_status=scale_status, k3=k3,
            eligible_count=len(data), distinct_base_count=len(set(base)),
            distinct_level_count=len(set(level)),
            base_min=min(base, default=""), base_max=max(base, default=""),
            level_min=min(level, default=""), level_max=max(level, default=""),
        )
        coefficients = None
        if key in reference_by_key:
            coefficients = reference_coefficients.get(key)
            status = scale_status if k3 is None else "unidentifiable_reference_coefficients"
        else:
            status = local_fit_status(data)
        if status == "fitted":
            if k3 is None:
                status = scale_status
            else:
                coefficients = fit_local(data, k3)
        if coefficients is not None:
            if len(data):
                metrics = score(data, coefficients, lambda item: holdout_fit(key, item),
                                min_holdout=1 if key in reference_by_key else 3)
                status = metrics["fit_status"]
            else:
                status = "inferred_from_reference"
                metrics = {"fit_status": status}
            fits.append({**metadata, "k1": coefficients[0], "k2": coefficients[1], **metrics})
        diagnostics.append({
            **metadata, "status": status, "recorded_count": len(coverage[key]),
            "excluded_reasons": " | ".join(
                f"{reason}={count}" for reason, count in sorted(exclusions[key].items())
            ),
        })
    write_csv(args.output, FIT_COLUMNS, fits)
    write_csv(args.diagnostics, DIAGNOSTIC_COLUMNS, diagnostics)
    print(f"{len(equipment)} items; {in_scope} with level >= {args.min_level}; "
          f"{len(fits)}/{len(diagnostics)} attribute groups fitted.")
    print(dict(sorted(Counter(row["status"] for row in diagnostics).items())))
    for (family, _), (status, k3) in sorted(scales.items()):
        if k3 is not None:
            print(f"{family}: k3={k3:.9g} ({status})")


if __name__ == "__main__":
    main()
