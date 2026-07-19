"""Download, join, and profile NHANES 2021-2023 source data.

This script performs exploration only. It intentionally does not commit the
project to a final hormonal life-stage label.

Research/awareness use only — not a diagnosis.
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

import pandas as pd


BASE_URL = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles"
FILES = {
    "TST_L": f"{BASE_URL}/TST_L.xpt",
    "RHQ_L": f"{BASE_URL}/RHQ_L.xpt",
    "DEMO_L": f"{BASE_URL}/DEMO_L.xpt",
    # BMI is measured during the examination; it is not in DEMO_L.
    "BMX_L": f"{BASE_URL}/BMX_L.xpt",
}

HORMONES = ["LBXEST", "LBXTST", "LBXSHBG"]


def download_sources(raw_dir: Path) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    for stem, url in FILES.items():
        destination = raw_dir / f"{stem}.xpt"
        if destination.exists():
            continue
        print(f"Downloading public NHANES file: {stem}")
        urllib.request.urlretrieve(url, destination)


def load_and_join(raw_dir: Path) -> pd.DataFrame:
    frames = {
        stem: pd.read_sas(raw_dir / f"{stem}.xpt", format="xport")
        for stem in FILES
    }
    female = frames["DEMO_L"].loc[frames["DEMO_L"]["RIAGENDR"] == 2].copy()
    return (
        female.merge(frames["TST_L"], on="SEQN", how="left", validate="one_to_one")
        .merge(frames["RHQ_L"], on="SEQN", how="left", validate="one_to_one")
        .merge(
            frames["BMX_L"][["SEQN", "BMXBMI"]],
            on="SEQN",
            how="left",
            validate="one_to_one",
        )
    )


def count(mask: pd.Series) -> int:
    return int(mask.fillna(False).sum())


def build_report(joined: pd.DataFrame) -> dict:
    complete_hormones = joined[HORMONES].notna().all(axis=1)
    analytic = joined.loc[complete_hormones].copy()

    # pandas may decode SAS numeric zero from this XPT as a tiny positive
    # floating-point value, so values below 1 represent code 0 (not started).
    not_started = analytic["RHQ010"].notna() & (analytic["RHQ010"] < 1)
    period_in_past_year = analytic["RHQ031"] == 1
    natural_menopause = (analytic["RHQ031"] == 2) & (analytic["RHD043"] == 7)
    both_ovaries_removed = analytic["RHQ305"] == 1

    return {
        "disclaimer": "Research/awareness use only — not a diagnosis.",
        "cycle": "NHANES August 2021-August 2023",
        "source_rows": {
            "female_demographics": int(len(joined)),
            "complete_estradiol": int(joined["LBXEST"].notna().sum()),
            "complete_testosterone": int(joined["LBXTST"].notna().sum()),
            "complete_shbg": int(joined["LBXSHBG"].notna().sum()),
            "complete_all_three_hormones": int(complete_hormones.sum()),
            "complete_all_three_hormones_and_bmi": int(
                (complete_hormones & joined["BMXBMI"].notna()).sum()
            ),
        },
        "questionnaire_availability_among_complete_hormone_rows": {
            column: int(analytic[column].notna().sum())
            for column in [
                "RHQ010",
                "RHQ031",
                "RHD043",
                "RHQ060",
                "RHD143",
                "RHQ200",
                "RHD280",
                "RHQ305",
            ]
        },
        "candidate_rule_counts_before_final_label_decision": {
            "not_started_menstruating": count(not_started),
            "period_in_past_12_months": count(period_in_past_year),
            "self_reported_natural_menopause": count(natural_menopause),
            "both_ovaries_removed": count(both_ovaries_removed),
        },
        "amenorrhea_reason_counts": {
            str(int(code)): int(total)
            for code, total in analytic.loc[
                analytic["RHQ031"] == 2, "RHD043"
            ].value_counts().sort_index().items()
        },
        "important_limitation": (
            "RHQ031 asks whether at least one period occurred in the past 12 "
            "months. The public 2021-2023 RHQ file does not contain a cycle "
            "irregularity variable, so perimenopause is not directly observable."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw"))
    parser.add_argument(
        "--report", type=Path, default=Path("data/processed/exploration_report.json")
    )
    args = parser.parse_args()

    download_sources(args.raw_dir)
    report = build_report(load_and_join(args.raw_dir))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
