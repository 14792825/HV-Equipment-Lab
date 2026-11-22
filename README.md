# HV Equipment Lab

Compare two HentaiVerse items at the level you plan to use them. Preview Soulbind, Forging, Item World (IW), and Charms directly on the equipment page, then switch back to the original panel whenever you like.

The script can also estimate details the page may not show directly, including the level behind a Tier panel, the combined Forging + IW level on some older items, some affix Base values, and installed Charms. These estimates are based on equipment observations and the fitted model described in the [method notes](docs/method.md).

## Install

Open the [userscript](hv-equipment-lab.user.js) on GitHub and select **Raw** to install it with your userscript manager. If your manager does not open an install prompt, paste the raw source into a new script and save it. Reload any equipment page that was already open.

The script runs on standalone equipment pages in Persistent and Isekai, on both `hentaiverse.org` and `alt.hentaiverse.org`. The archive userscript is a separate tool for collecting samples. It is optional for anyone using the preview.

## Compare and preview

1. Open an equipment page. Paste the second item's full equipment URL, including its equipment key, into **Equipment link** and click **Compare**. The second panel opens next to the first when there is room.
2. Under **Simulation**, set **Player Lv.** on each item. **Use my level** reads your character level for the world that item belongs to. You can enter a level manually if the lookup fails.
3. Set **Forging** and **IW**, then open **Preview Charms** to choose **None**, **Lesser**, or **Greater** for the Charms offered for that equipment type. For a Tier item, the preview starts at its current Forging and IW values and lets you raise them up to its displayed cap. **Reset Charms** returns the controls to the detected setup.
4. Click **Preview Soulbind** or **Preview upgrades** on each panel. **Restore original** returns to the game panel. Use **S** for the original item and **Shift+S** for the comparison item.
5. On Legendary equipment, click **Preview Peerless** to preview Base 200. On Peerless equipment, click **Preview Peerless+** to start at Base 210. Keep clicking the same button to step through Peerless+ (Base 210–240) and Ultimate (Base 250). The preview updates the equipment name and any displayed Affix Base or Inferred Base. Forging and IW caps are 30 for Peerless and Peerless+, and 33 for Ultimate. If **Player Lv.** is blank, the preview uses level 500. Click once more after Ultimate to return to the regular preview.

For example, if you are choosing between two weapons for level 400, set **Player Lv.** to 400 on both panels. Match the planned Forging and IW tiers where the controls allow it, and choose the Charms you intend to use on each weapon. Turn on both previews to compare the resulting damage and other stats under those settings.

## Read the results

- `@ Lv.` estimates the level behind an equipment panel that displays Tier. `Forging + IW ≈` gives a combined estimate where the page format and available observations support one.
- `Affix Base` shows the rounded equipment AVG for the affixes on recognized current equipment. `Inferred Base` estimates a Base for each supported prefix or suffix on older panels, including contributions to native stats. If an affix's stats imply different rolls, it lists their estimates separately. `Charms` lists effects the script could identify from the panel. `No charm identified` means the script found no match it could report.
- A preview changes the display in your browser. Compare and Use my level read pages from the current HentaiVerse host.
- Old equipment formats, unfamiliar affixes, sparse fit data, and overlapping Charm effects can leave an estimate unknown. If the preview reports that some stats could not be estimated, those rows can still show their original values. Some older panels have no simulation controls.

# HV Equipment coefficient fit

Run from the repository root with Python 3.11:

```sh
python -m pip install -r requirements.txt
python fit-results/fit_final.py --extra-csv hv-equipment-2026-11-20.csv
```

The fit uses the November 20 archive at the repository root and the other
archived equipment observations and reference tables in
`fit-data/` and the frozen k3 scale table in `fit-history/hv-k3-frozen.tsv`.
It writes `fit-results/coefficients.json`. Use `--output PATH` to write
elsewhere, or `--extra-csv PATH` to add observations from another archive.

## Report a mismatch

Post in the release thread or open a GitHub issue. Include the script version, the world, and a shareable equipment link or screenshot. For a preview mismatch, include the target level, Forging, IW, and Charm settings, plus the in-game value if you have it. For a missing or incorrect inference, include the original Tier or Level line and the stat or Charm you expected to see.
