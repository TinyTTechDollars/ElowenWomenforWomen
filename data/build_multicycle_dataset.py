"""Build the approved three-cycle NHANES classifier cohort.

This is an unweighted predictive research dataset, not a population-prevalence
dataset and not a diagnostic dataset. No combined survey weight is constructed.
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

import pandas as pd


DISCLAIMER = "Not a diagnosis — discuss health questions with a healthcare provider."
BASE_URL = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public"
REQUIRED_COMPLETE = ["LBXTST", "LBXEST", "LBXSHBG", "BMXBMI"]

CYCLES = {
    "2013-2014": {
        "year": "2013",
        "suffix": "H",
        "survey_mode": "CAPI_proxy_permitted",
    },
    "2015-2016": {
        "year": "2015",
        "suffix": "I",
        "survey_mode": "CAPI_proxy_permitted",
    },
    "2021-2023": {
        "year": "2021",
        "suffix": "L",
        "survey_mode": "ACASI_no_proxy",
    },
}


def source_specs(cycle: str, config: dict) -> dict[str, str]:
    year, suffix = config["year"], config["suffix"]
    return {
        component: f"{BASE_URL}/{year}/DataFiles/{component}_{suffix}.xpt"
        for component in ["DEMO", "TST", "RHQ", "BMX"]
    }


def download_cycle(cycle: str, config: dict, raw_dir: Path) -> dict[str, Path]:
    cycle_dir = raw_dir / cycle
    cycle_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    for component, url in source_specs(cycle, config).items():
        destination = cycle_dir / Path(url).name
        if not destination.exists():
            print(f"Downloading {cycle} {component} from CDC")
            urllib.request.urlretrieve(url, destination)
        paths[component] = destination
    return paths


def read_xpt(path: Path) -> pd.DataFrame:
    return pd.read_sas(path, format="xport")


def construct_cycle(cycle: str, config: dict, paths: dict[str, Path]) -> tuple[pd.DataFrame, dict]:
    demo, tst, rhq, bmx = (read_xpt(paths[name]) for name in ["DEMO", "TST", "RHQ", "BMX"])
    female = demo.loc[demo["RIAGENDR"] == 2].copy()
    joined = (
        female.merge(tst, on="SEQN", how="left", validate="one_to_one")
        .merge(rhq, on="SEQN", how="left", validate="one_to_one")
        .merge(bmx[["SEQN", "BMXBMI"]], on="SEQN", how="left", validate="one_to_one")
    )

    complete_hormones = joined[["LBXTST", "LBXEST", "LBXSHBG"]].notna().all(axis=1)
    complete_all = joined[REQUIRED_COMPLETE].notna().all(axis=1)
    eligible = joined.loc[complete_all].copy()
    recent_candidate = eligible["RHQ031"].eq(1)
    menopause_candidate = eligible["RHQ031"].eq(2) & eligible["RHD043"].eq(7)
    known_exclusion = (
        eligible["RHD143"].eq(1)
        | eligible["RHQ200"].eq(1)
        | eligible["RHD280"].eq(1)
        | eligible["RHQ305"].eq(1)
    )
    recent_final = recent_candidate & ~known_exclusion
    menopause_final = menopause_candidate & ~known_exclusion
    final = eligible.loc[recent_final | menopause_final].copy()
    final["target"] = "recent_menstruation"
    final.loc[menopause_final, "target"] = "self_reported_natural_menopause"
    final["source_cycle"] = cycle
    final["survey_mode"] = config["survey_mode"]
    final["respondent_key"] = cycle + ":" + final["SEQN"].astype(int).astype(str)
    final["source_wtmec2yr"] = final["WTMEC2YR"]

    harmonized = final.rename(
        columns={
            "RIDAGEYR": "age_years",
            "BMXBMI": "bmi",
            "LBXTST": "testosterone_ng_dl",
            "LBXEST": "estradiol_pg_ml_audit",
            "LBXSHBG": "shbg_nmol_l",
            "LBDTSTLC": "testosterone_comment",
            "LBDESTLC": "estradiol_comment",
            "LBDSHGLC": "shbg_comment",
        }
    )
    columns = [
        "respondent_key",
        "SEQN",
        "source_cycle",
        "survey_mode",
        "age_years",
        "bmi",
        "testosterone_ng_dl",
        "shbg_nmol_l",
        "estradiol_pg_ml_audit",
        "testosterone_comment",
        "estradiol_comment",
        "shbg_comment",
        "source_wtmec2yr",
        "SDMVSTRA",
        "SDMVPSU",
        "target",
    ]
    harmonized = harmonized[columns].sort_values("respondent_key").reset_index(drop=True)
    report = {
        "female_demographic_rows": int(len(joined)),
        "complete_testosterone_estradiol_shbg": int(complete_hormones.sum()),
        "complete_hormones_and_bmi": int(complete_all.sum()),
        "recent_candidate": int(recent_candidate.sum()),
        "menopause_candidate": int(menopause_candidate.sum()),
        "recent_excluded_known_condition": int((recent_candidate & known_exclusion).sum()),
        "menopause_excluded_known_condition": int(
            (menopause_candidate & known_exclusion).sum()
        ),
        "final_recent_menstruation": int(recent_final.sum()),
        "final_self_reported_natural_menopause": int(menopause_final.sum()),
        "final_rows": int(len(harmonized)),
    }
    return harmonized, report


def build(raw_dir: Path) -> tuple[pd.DataFrame, dict]:
    frames, cycle_reports = [], {}
    for cycle, config in CYCLES.items():
        frame, report = construct_cycle(
            cycle, config, download_cycle(cycle, config, raw_dir)
        )
        frames.append(frame)
        cycle_reports[cycle] = report
    combined = pd.concat(frames, ignore_index=True).sort_values("respondent_key")
    if not combined["respondent_key"].is_unique:
        raise ValueError("respondent_key is not unique across cycles")
    model_fields = ["age_years", "bmi", "testosterone_ng_dl", "shbg_nmol_l", "target"]
    if combined[model_fields].isna().any().any():
        raise ValueError("Final model fields contain missing values")

    counts = combined["target"].value_counts().sort_index()
    report = {
        "disclaimer": DISCLAIMER,
        "cycles": list(CYCLES),
        "cycle_reports": cycle_reports,
        "final_rows": int(len(combined)),
        "final_class_counts": {str(k): int(v) for k, v in counts.items()},
        "final_class_percentages": {
            str(k): round(100 * int(v) / len(combined), 2) for k, v in counts.items()
        },
        "survey_mode_counts": {
            str(k): int(v) for k, v in combined["survey_mode"].value_counts().items()
        },
        "weight_policy": (
            "Unweighted predictive classifier only. source_wtmec2yr is retained as "
            "provenance, is not a model input, and is not concatenated into a combined "
            "population weight. No population-prevalence claims are made."
        ),
        "estradiol_policy": "Completeness and audit only; prohibited as a model input.",
    }
    return combined.reset_index(drop=True), report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw/multicycle"))
    parser.add_argument(
        "--output", type=Path, default=Path("data/processed/multicycle_dataset.csv")
    )
    parser.add_argument(
        "--report", type=Path, default=Path("data/processed/multicycle_report.json")
    )
    args = parser.parse_args()
    dataset, report = build(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_csv(args.output, index=False)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
