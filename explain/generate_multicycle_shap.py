"""Generate TreeSHAP and ablation artifacts for the multi-cycle model."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", str(Path("work/matplotlib").resolve()))
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score
from xgboost import XGBClassifier


SEED = 42
FEATURES = ["age_years", "bmi", "testosterone_ng_dl", "shbg_nmol_l"]
DISPLAY = {
    "age_years": "Age (years)",
    "bmi": "BMI",
    "testosterone_ng_dl": "Total testosterone",
    "shbg_nmol_l": "SHBG",
}
TARGET = "target"
POSITIVE = "self_reported_natural_menopause"
DISCLAIMER = "Not a diagnosis — discuss health questions with a healthcare provider."


def sigmoid(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def global_plot(mean_abs: pd.Series, output: Path) -> None:
    values = mean_abs.sort_values()
    fig, ax = plt.subplots(figsize=(8, 4.8))
    ax.barh([DISPLAY[x] for x in values.index], values.values, color="#31688e")
    ax.set_xlabel("Mean |TreeSHAP value| (log-odds)")
    ax.set_title("Multi-cycle global importance on the held-out test set")
    ax.grid(axis="x", alpha=0.2)
    fig.text(0.01, 0.01, "Research use only — not a diagnosis.", fontsize=8)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output, dpi=180)
    plt.close(fig)


def cycle_plot(cycle_mean: pd.DataFrame, output: Path) -> None:
    shares = cycle_mean.div(cycle_mean.sum(axis=1), axis=0) * 100
    fig, ax = plt.subplots(figsize=(9, 5.2))
    bottom = np.zeros(len(shares))
    colors = ["#440154", "#31688e", "#35b779", "#fde725"]
    for feature, color in zip(FEATURES, colors):
        ax.bar(
            shares.index,
            shares[feature],
            bottom=bottom,
            label=DISPLAY[feature],
            color=color,
        )
        bottom += shares[feature].to_numpy()
    ax.set_ylabel("Share of mean absolute TreeSHAP magnitude (%)")
    ax.set_title("Feature contribution composition by source cycle")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=2)
    ax.grid(axis="y", alpha=0.2)
    fig.text(0.01, 0.01, "Research use only — not a diagnosis.", fontsize=8)
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    fig.savefig(output, dpi=180)
    plt.close(fig)


def waterfall(values, row, base, margin, output: Path) -> None:
    ordered = values.reindex(values.abs().sort_values(ascending=False).index)
    labels = [f"{DISPLAY[x]} = {row[x]:.3g}" for x in ordered.index]
    starts, current = [], float(base)
    for value in ordered:
        starts.append(min(current, current + value))
        current += value
    positions = np.arange(len(ordered))
    colors = ["#d73027" if value > 0 else "#4575b4" for value in ordered]
    fig, ax = plt.subplots(figsize=(10, 5.8))
    ax.bar(positions, ordered.abs(), bottom=starts, color=colors, width=0.72)
    for i, value in enumerate(ordered):
        endpoint = starts[i] + (abs(value) if value > 0 else 0)
        ax.text(i, endpoint + (0.15 if value > 0 else -0.15), f"{value:+.3f}", ha="center")
        if i < len(ordered) - 1:
            cumulative = base + ordered.iloc[: i + 1].sum()
            ax.plot([i + 0.36, i + 0.64], [cumulative, cumulative], color="#666", lw=0.8)
    ax.axhline(base, color="#666", linestyle=":", label="Base value")
    ax.axhline(margin, color="black", linestyle="--", label="Model output")
    ax.set_xticks(positions, labels, rotation=15, ha="right")
    ax.set_ylabel("Natural-menopause model output (log-odds)")
    ax.set_title(
        f"Multi-cycle TreeSHAP waterfall ({row['respondent_key']})\n"
        f"cycle={row['source_cycle']}, probability={sigmoid(float(margin)):.3f}"
    )
    ax.legend(loc="best")
    ax.grid(axis="y", alpha=0.2)
    fig.text(0.01, 0.01, "Research use only — not a diagnosis.", fontsize=8)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output, dpi=180)
    plt.close(fig)


def run(dataset: Path, assignments: Path, checkpoint: Path, output_dir: Path) -> dict:
    data = pd.read_csv(dataset)
    assigned = pd.read_csv(assignments)
    merged = data.merge(assigned, on="respondent_key", validate="one_to_one")
    train = merged.loc[merged["split"] == "train"].copy()
    test = merged.loc[merged["split"] == "test"].copy()
    model = XGBClassifier()
    model.load_model(checkpoint)
    booster = model.get_booster()
    if booster.feature_names != FEATURES:
        raise ValueError("Checkpoint feature mismatch")
    matrix = xgb.DMatrix(test[FEATURES], feature_names=FEATURES)
    contributions = booster.predict(matrix, pred_contribs=True)
    shap_values = pd.DataFrame(contributions[:, :-1], columns=FEATURES, index=test.index)
    base = contributions[:, -1]
    margins = booster.predict(matrix, output_margin=True)
    if not np.allclose(shap_values.sum(axis=1) + base, margins, atol=1e-5):
        raise AssertionError("TreeSHAP additivity check failed")

    mean_abs = shap_values.abs().mean().sort_values(ascending=False)
    overall_share = mean_abs / mean_abs.sum()
    cycle_means = {}
    for cycle in sorted(test["source_cycle"].unique()):
        mask = test["source_cycle"].eq(cycle)
        cycle_means[cycle] = shap_values.loc[mask].abs().mean()
    cycle_frame = pd.DataFrame(cycle_means).T[FEATURES]

    output_dir.mkdir(parents=True, exist_ok=True)
    global_plot(mean_abs, output_dir / "multicycle_global_importance.png")
    cycle_plot(cycle_frame, output_dir / "multicycle_shap_by_cycle.png")
    probabilities = model.predict_proba(test[FEATURES])[:, 1]
    position = int(np.argmax(probabilities))
    index = test.index[position]
    waterfall(
        shap_values.loc[index],
        test.loc[index],
        float(base[position]),
        float(margins[position]),
        output_dir / "multicycle_example_waterfall.png",
    )

    ablation_features = [x for x in FEATURES if x != "age_years"]
    ablation = XGBClassifier(random_state=SEED)
    ablation.fit(train[ablation_features], train[TARGET].eq(POSITIVE).astype(int))
    actual = test[TARGET].eq(POSITIVE).astype(int)
    prediction = ablation.predict(test[ablation_features])
    ablation_accuracy = float(accuracy_score(actual, prediction))
    majority_accuracy = float(test[TARGET].value_counts(normalize=True).max())
    ablation.save_model(output_dir / "xgboost_multicycle_no_age.json")

    cycle_shap = {}
    for cycle, values in cycle_frame.iterrows():
        shares = values / values.sum()
        cycle_shap[str(cycle)] = {
            "n": int(test["source_cycle"].eq(cycle).sum()),
            "mean_absolute_shap_log_odds": {k: float(v) for k, v in values.items()},
            "relative_contribution": {k: float(v) for k, v in shares.items()},
        }
    report = {
        "disclaimer": DISCLAIMER,
        "method": "Native XGBoost TreeSHAP on all held-out test rows in log-odds space.",
        "test_rows": int(len(test)),
        "mean_absolute_shap_log_odds": {k: float(v) for k, v in mean_abs.items()},
        "relative_contribution": {k: float(v) for k, v in overall_share.items()},
        "age_share": float(overall_share["age_years"]),
        "non_age_combined_share": float(1 - overall_share["age_years"]),
        "source_cycle_shap": cycle_shap,
        "example": {
            "respondent_key": str(test.loc[index, "respondent_key"]),
            "source_cycle": str(test.loc[index, "source_cycle"]),
            "actual_target": str(test.loc[index, TARGET]),
            "predicted_probability": float(probabilities[position]),
        },
        "no_age_ablation": {
            "features": ablation_features,
            "test_accuracy": ablation_accuracy,
            "majority_class_baseline_accuracy": majority_accuracy,
            "gain_over_majority_baseline": ablation_accuracy - majority_accuracy,
            "same_saved_split": True,
        },
        "single_cycle_comparison": {
            "single_cycle_age_share": 0.8036710023880005,
            "multicycle_age_share": float(overall_share["age_years"]),
            "change_percentage_points": float(
                100 * (overall_share["age_years"] - 0.8036710023880005)
            ),
        },
    }
    (output_dir / "multicycle_shap_report.json").write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=Path("data/processed/multicycle_dataset.csv"))
    parser.add_argument(
        "--assignments",
        type=Path,
        default=Path("model/artifacts/multicycle/multicycle_split_assignments.csv"),
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path("model/artifacts/multicycle/xgboost_multicycle_classifier.json"),
    )
    parser.add_argument("--output-dir", type=Path, default=Path("explain/artifacts/multicycle"))
    args = parser.parse_args()
    print(json.dumps(run(args.dataset, args.assignments, args.checkpoint, args.output_dir), indent=2))


if __name__ == "__main__":
    main()
