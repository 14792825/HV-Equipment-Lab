# How HV Equipment Lab estimates equipment stats

The project started with a question about the equipment panel itself. Given the visible Base tooltips, the displayed stats, and the equipment's name, how much of the panel can we recover? The same model can be used in the other direction. Once we have an estimate of where a panel's numbers came from, we can preview the item at a different level or with a different upgrade setup.

## From equipment pages to a model

1. **Collect observations.** The [archive userscript](../hv-equipment-archive.user.js) records the item, its displayed level or tier, its panel values, and any Base tooltips it can read. The fitting code deduplicates archived snapshots by world and equipment ID. Peerless reference tables and calibration samples provide additional constraints. The [historical fit and audit scripts](../fit-history/) preserve experiments on level scaling, affix terms, and rounding.
2. **Separate the sources of a stat.** A row can contain a native equipment contribution and contributions from the prefix, the suffix, or both. Native terms usually use that row's own Base. The model uses the average of the item's visible Base values, rounded to the nearest integer, for current affixes. Some legacy affixes deviate from that average. For example, the legacy Shocking Redwood Staff of Destruction sample has AVG 192, with effective Bases of about 192 for Shocking and 200 for Destruction under the fitted curves. Burden and Interference also use the average for their native terms and use a linear curve. The scripts model certain load modifiers separately.
3. **Fit the panel.** For the regular level-scaled part of the panel, the model sums the applicable component curves and then applies the stat family's level factor. The current fit uses a common exponent of about `1.5261` for nonlinear terms and `1` for the two linear stats. The level coefficient `k3` is set by stat family. The fit weights each residual by a tolerance of one displayed step or 0.05% of the panel value, whichever is larger.

   ```text
   panel ≈ Σ(k1 + k2 × a^p) × (1 + level × k3)
   ```

   Here `a` is the Base input for each component. This is the fitted part of the model. Upgrade factors and applicable Charm effects enter separately when the userscript reads or previews a panel.

4. **Check which curves can be shared.** Some affix contributions can be fitted together after applying the equipment slot multiplier. Native curves are treated separately. Matching Peerless reference values on melee weapons and staffs suggest possible groups, and archived observations determine which groups share coefficients. The current fit selects groups using four folds and evaluates those selections on a fifth held-out fold. All observations for an item stay in the same fold, keyed by world and equipment ID.

For the selected native groups, 353 of 372 held-out panel predictions fell within the model tolerance with shared curves, compared with 349 of the same 372 using separate curves. Both results are recorded in the [coefficient snapshot](../fit-results/coefficients.json).

## From the model to the equipment page

When a panel shows Tier, the script uses the displayed Forging and IW values and looks for an integer level that explains several eligible stats. When an older panel shows the level, the script can use the same idea to estimate combined Forging and IW. It tries rows with a visible native Base first and uses eligible affix rows if needed. For equipment identified as current by its provenance text, it shows the rounded AVG as `Affix Base`. For older panels, it subtracts the modeled native contribution and estimates the Base of the remaining affix. It reports one estimate per affix when the rows agree within panel rounding. In the legacy Tempestuous Willow Staff of Focus sample, a Focus Base of about 196 explains Magic Accuracy, Mana Conservation, and the rounded Magic Crit Damage. The script also checks which Charm effects are consistent with the remaining values. Ambiguous matches and weak fits can leave fields unknown.

The preview starts from a copy of the original panel. For supported rows it separates identifiable Charm effects, applies the requested change in level and upgrades, and adds the selected simulated effects. Working from the observed panel value where possible keeps the starting panel as the reference for the projection. The script keeps the original display available for comparison.

## Update the model

The [final fit script](../fit-results/fit_final.py) writes `fit-results/coefficients.json`. The [build script](../fit-results/build_userscript.py) embeds the resulting tables in the installable userscript. To verify that the userscript matches the checked-in coefficient snapshot, run this from the repository root.

```sh
python fit-results/build_userscript.py --check
```

To regenerate the coefficients, use Python with NumPy and SciPy and the original archive inputs. The CSV archives are ignored in this workspace, so a checkout with only tracked files can verify the embedded tables but cannot reproduce the same fit. The loader expects the archive files under `fit-data/`, including `PL2.csv`, `isekai.csv`, and `isekai2.csv`. See [archive discovery](../fit-history/fit_frozen_k3.py) and [profile loading](../fit-history/fit_power_exponents.py) for the full input rules. Pass `--extra-csv PATH` once per additional archive outside that directory.

```sh
python fit-results/fit_final.py
python fit-results/build_userscript.py
python fit-results/build_userscript.py --check
```
