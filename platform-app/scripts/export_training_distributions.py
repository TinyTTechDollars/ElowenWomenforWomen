"""Export de-identified feature arrays for Elowen percentile context.

The source cohort is rebuilt by the existing project pipeline and joined to the
saved, frozen split assignments. Only feature values grouped by broad age band
are emitted; respondent identifiers and labels are excluded.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


FEATURES = ["age_years", "bmi", "testosterone_ng_dl", "shbg_nmol_l"]


def age_band(age: float) -> str:
    if age < 40:
        return "12–39"
    if age < 60:
        return "40–59"
    return "60+"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--assignments", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    cohort = pd.read_csv(args.cohort)
    assignments = pd.read_csv(args.assignments, usecols=["respondent_key", "split"])
    training = cohort.merge(assignments, on="respondent_key", validate="one_to_one")
    training = training.loc[training["split"].eq("train")].copy()
    training["age_band"] = training["age_years"].map(age_band)

    payload = {
        "source": "Frozen multi-cycle classifier training partition",
        "random_seed": 42,
        "training_rows": int(len(training)),
        "groups": {},
    }
    for band, frame in training.groupby("age_band", sort=False):
        payload["groups"][band] = {
            feature: sorted(round(float(value), 6) for value in frame[feature].dropna())
            for feature in FEATURES
        }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
