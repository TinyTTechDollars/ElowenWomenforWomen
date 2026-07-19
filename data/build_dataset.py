"""Construct the approved binary NHANES menstrual-status research dataset.

The target is a survey-derived research proxy, not a clinical life-stage
diagnosis. Every downstream use must preserve that distinction.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from explore_data import HORMONES, download_sources, load_and_join


DISCLAIMER = "Not a diagnosis — discuss health questions with a healthcare provider."
FEATURES = ["RIDAGEYR", "BMXBMI", "LBXTST", "LBXSHBG"]
OUTPUT_COLUMNS = [
    "SEQN",
    "RIDAGEYR",
    "BMXBMI",
    "LBXTST",
    "LBXSHBG",
    # Retained only for dataset auditing and possible later regression work.
    # It is explicitly not an input feature for the binary classifier.
    "LBXEST",
    "WTPH2YR",
    "SDMVSTRA",
    "SDMVPSU",
    "target",
]


def construct_dataset(joined: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    female_rows = len(joined)
    complete_hormones = joined[HORMONES].notna().all(axis=1)
    hormone_complete = joined.loc[complete_hormones].copy()
    complete_bmi = hormone_complete["BMXBMI"].notna()
    eligible_features = hormone_complete.loc[complete_bmi].copy()

    recent_candidate = eligible_features["RHQ031"].eq(1)
    menopause_candidate = eligible_features["RHQ031"].eq(2) & eligible_features[
        "RHD043"
    ].eq(7)

    # Known surgical or temporary explanations are excluded. Missing values in
    # these fields are not treated as "yes": CDC suppresses selected variables
    # for some ages, and interpreting structural missingness as a condition
    # would introduce avoidable selection bias.
    hysterectomy = eligible_features["RHD280"].eq(1)
    ovaries_removed = eligible_features["RHQ305"].eq(1)
    pregnant = eligible_features["RHD143"].eq(1)
    breastfeeding = eligible_features["RHQ200"].eq(1)
    known_exclusion = hysterectomy | ovaries_removed | pregnant | breastfeeding

    recent_final = recent_candidate & ~known_exclusion
    menopause_final = menopause_candidate & ~known_exclusion

    labeled = eligible_features.loc[recent_final | menopause_final].copy()
    labeled["target"] = "recent_menstruation"
    labeled.loc[menopause_final, "target"] = "self_reported_natural_menopause"
    labeled = labeled[OUTPUT_COLUMNS].sort_values("SEQN").reset_index(drop=True)

    class_counts = {
        str(label): int(total)
        for label, total in labeled["target"].value_counts().sort_index().items()
    }
    report = {
        "disclaimer": DISCLAIMER,
        "cycle": "NHANES August 2021-August 2023",
        "target_interpretation": (
            "Binary survey-derived menstrual-status proxy; not a diagnosis or "
            "a four-stage reproductive life-stage model."
        ),
        "label_rule": {
            "recent_menstruation": "RHQ031 == 1",
            "self_reported_natural_menopause": (
                "RHQ031 == 2 AND RHD043 == 7"
            ),
            "known_conditions_excluded_from_both_classes": (
                "RHD280 == 1 OR RHQ305 == 1 OR RHD143 == 1 OR RHQ200 == 1"
            ),
            "missing_condition_fields": (
                "Not interpreted as yes; some missingness is structural because "
                "of public-file disclosure restrictions."
            ),
        },
        "row_flow": {
            "female_demographic_rows": int(female_rows),
            "excluded_missing_one_or_more_required_hormones": int(
                female_rows - complete_hormones.sum()
            ),
            "complete_estradiol_testosterone_shbg": int(complete_hormones.sum()),
            "excluded_missing_bmi": int((~complete_bmi).sum()),
            "complete_required_hormones_and_bmi": int(len(eligible_features)),
            "excluded_not_matching_either_candidate_label": int(
                (~(recent_candidate | menopause_candidate)).sum()
            ),
            "recent_candidate_before_condition_exclusions": int(
                recent_candidate.sum()
            ),
            "menopause_candidate_before_condition_exclusions": int(
                menopause_candidate.sum()
            ),
            "recent_candidate_excluded_known_condition": int(
                (recent_candidate & known_exclusion).sum()
            ),
            "menopause_candidate_excluded_known_condition": int(
                (menopause_candidate & known_exclusion).sum()
            ),
            "final_labeled_rows": int(len(labeled)),
        },
        "known_condition_counts_with_overlap": {
            "hysterectomy_among_candidates": int(
                ((recent_candidate | menopause_candidate) & hysterectomy).sum()
            ),
            "both_ovaries_removed_among_candidates": int(
                ((recent_candidate | menopause_candidate) & ovaries_removed).sum()
            ),
            "pregnant_among_candidates": int(
                ((recent_candidate | menopause_candidate) & pregnant).sum()
            ),
            "breastfeeding_among_candidates": int(
                ((recent_candidate | menopause_candidate) & breastfeeding).sum()
            ),
        },
        "final_class_counts": class_counts,
        "final_class_percentages": {
            label: round(100 * total / len(labeled), 2)
            for label, total in class_counts.items()
        },
        "model_features_frozen_for_next_phase": FEATURES,
        "estradiol_policy": (
            "Required non-missing for cohort consistency and retained for audit, "
            "but prohibited as a classification feature."
        ),
    }
    return labeled, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw"))
    parser.add_argument(
        "--output", type=Path, default=Path("data/processed/analytic_dataset.csv")
    )
    parser.add_argument(
        "--report", type=Path, default=Path("data/processed/label_report.json")
    )
    args = parser.parse_args()

    download_sources(args.raw_dir)
    dataset, report = construct_dataset(load_and_join(args.raw_dir))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_csv(args.output, index=False)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
