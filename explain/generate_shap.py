"""Generate native XGBoost TreeSHAP explanations and a no-age ablation.

Research/awareness use only — not a diagnosis.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

# Keep Matplotlib's cache inside the project's ignored working directory.
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
FEATURES = ["RIDAGEYR", "BMXBMI", "LBXTST", "LBXSHBG"]
DISPLAY_NAMES = {
    "RIDAGEYR": "Age (years)",
    "BMXBMI": "BMI",
    "LBXTST": "Total testosterone",
    "LBXSHBG": "SHBG",
}
TARGET = "target"
POSITIVE_LABEL = "self_reported_natural_menopause"
DISCLAIMER = "Not a diagnosis — discuss health questions with a healthcare provider."
AGE_DOMINANCE_THRESHOLD = 0.75


def encode_target(values: pd.Series) -> pd.Series:
    return values.eq(POSITIVE_LABEL).astype(int)


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


def load_splits(dataset_path: Path, assignments_path: Path) -> dict[str, pd.DataFrame]:
    data = pd.read_csv(dataset_path)
    assignments = pd.read_csv(assignments_path)
    merged = data.merge(assignments, on="SEQN", how="inner", validate="one_to_one")
    if len(merged) != len(data):
        raise ValueError("Saved split assignments do not cover the analytic dataset")
    return {
        name: merged.loc[merged["split"] == name].copy()
        for name in ["train", "validation", "test"]
    }


def plot_global(mean_abs: pd.Series, output: Path) -> None:
    ordered = mean_abs.sort_values()
    fig, ax = plt.subplots(figsize=(8, 4.8))
    ax.barh(
        [DISPLAY_NAMES[name] for name in ordered.index],
        ordered.values,
        color="#31688e",
    )
    ax.set_xlabel("Mean |TreeSHAP value| (log-odds)")
    ax.set_title("Global feature importance on the held-out test set")
    ax.grid(axis="x", alpha=0.2)
    fig.text(0.01, 0.01, "Research use only — not a diagnosis.", fontsize=8)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output, dpi=180)
    plt.close(fig)


def plot_example(
    values: pd.Series,
    feature_values: pd.Series,
    base_value: float,
    output_margin: float,
    seqn: int,
    output: Path,
) -> None:
    ordered = values.reindex(values.abs().sort_values(ascending=False).index)
    labels = [
        f"{DISPLAY_NAMES[name]} = {feature_values[name]:.3g}" for name in ordered.index
    ]
    colors = ["#d73027" if value > 0 else "#4575b4" for value in ordered]
    starts = []
    current = base_value
    for value in ordered:
        starts.append(min(current, current + value))
        current += value
    heights = ordered.abs().to_numpy()
    positions = np.arange(len(ordered))
    fig, ax = plt.subplots(figsize=(10, 5.8))
    ax.bar(positions, heights, bottom=starts, color=colors, width=0.72)
    for position, (start, value) in enumerate(zip(starts, ordered)):
        endpoint = start + (abs(value) if value > 0 else 0)
        ax.text(
            position,
            endpoint + (0.18 if value > 0 else -0.18),
            f"{value:+.3f}",
            ha="center",
            va="bottom" if value > 0 else "top",
            fontsize=9,
        )
        if position < len(ordered) - 1:
            ax.plot(
                [position + 0.36, position + 0.64],
                [base_value + ordered.iloc[: position + 1].sum()] * 2,
                color="#666666",
                linewidth=0.8,
            )
    ax.axhline(base_value, color="#666666", linestyle=":", label="Base value")
    ax.axhline(output_margin, color="black", linestyle="--", label="Model output")
    ax.set_xticks(positions, labels, rotation=15, ha="right")
    ax.set_ylabel("Natural-menopause model output (log-odds)")
    ax.set_title(
        f"Example TreeSHAP waterfall (public respondent ID {seqn})\n"
        f"base={base_value:.3f}, output={output_margin:.3f}, "
        f"probability={sigmoid(output_margin):.3f}"
    )
    ax.legend(loc="upper right")
    ax.grid(axis="y", alpha=0.2)
    fig.text(
        0.01,
        0.01,
        "Red increases and blue decreases the model output. Not a diagnosis.",
        fontsize=8,
    )
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output, dpi=180)
    plt.close(fig)


def run(
    dataset_path: Path,
    assignments_path: Path,
    checkpoint_path: Path,
    output_dir: Path,
) -> dict:
    splits = load_splits(dataset_path, assignments_path)
    test = splits["test"]
    model = XGBClassifier()
    model.load_model(checkpoint_path)
    booster = model.get_booster()
    if booster.feature_names != FEATURES:
        raise ValueError(f"Checkpoint features differ from frozen features: {booster.feature_names}")

    # XGBoost's pred_contribs invokes exact native TreeSHAP for tree models.
    contributions = booster.predict(
        xgb.DMatrix(test[FEATURES], feature_names=FEATURES), pred_contribs=True
    )
    if contributions.shape != (len(test), len(FEATURES) + 1):
        raise ValueError(f"Unexpected TreeSHAP shape: {contributions.shape}")
    shap_values = pd.DataFrame(contributions[:, :-1], columns=FEATURES, index=test.index)
    base_values = contributions[:, -1]
    margins = booster.predict(
        xgb.DMatrix(test[FEATURES], feature_names=FEATURES), output_margin=True
    )
    # XGBoost returns float32 contributions, so allow only small accumulation
    # differences while still enforcing the TreeSHAP additivity invariant.
    if not np.allclose(
        shap_values.sum(axis=1).to_numpy() + base_values, margins, atol=1e-5
    ):
        raise AssertionError("TreeSHAP additivity check failed")

    mean_abs = shap_values.abs().mean().sort_values(ascending=False)
    total = float(mean_abs.sum())
    age_share = float(mean_abs["RIDAGEYR"] / total)
    non_age_share = 1.0 - age_share
    age_dominant = age_share >= AGE_DOMINANCE_THRESHOLD

    output_dir.mkdir(parents=True, exist_ok=True)
    plot_global(mean_abs, output_dir / "global_importance.png")

    # Explain the most confidently predicted positive-class test example.
    probabilities = model.predict_proba(test[FEATURES])[:, 1]
    example_position = int(np.argmax(probabilities))
    example_index = test.index[example_position]
    plot_example(
        shap_values.loc[example_index],
        test.loc[example_index, FEATURES],
        float(base_values[example_position]),
        float(margins[example_position]),
        int(test.loc[example_index, "SEQN"]),
        output_dir / "example_waterfall.png",
    )

    ablation = {"triggered": False}
    if age_dominant:
        ablation_features = [name for name in FEATURES if name != "RIDAGEYR"]
        ablation_model = XGBClassifier(random_state=SEED)
        ablation_model.fit(
            splits["train"][ablation_features], encode_target(splits["train"][TARGET])
        )
        ablation_predictions = ablation_model.predict(test[ablation_features])
        ablation_accuracy = float(
            accuracy_score(encode_target(test[TARGET]), ablation_predictions)
        )
        majority_accuracy = float(test[TARGET].value_counts(normalize=True).max())
        ablation_model.save_model(output_dir / "xgboost_no_age_ablation.json")
        ablation = {
            "triggered": True,
            "reason": (
                f"Age share {age_share:.4f} met the predeclared "
                f"dominance threshold {AGE_DOMINANCE_THRESHOLD:.2f}."
            ),
            "features": ablation_features,
            "model": "XGBClassifier defaults except random_state=42",
            "same_saved_train_and_test_split": True,
            "test_accuracy": ablation_accuracy,
            "test_majority_class_baseline_accuracy": majority_accuracy,
            "accuracy_gain_over_majority_baseline": (
                ablation_accuracy - majority_accuracy
            ),
        }

    report = {
        "disclaimer": DISCLAIMER,
        "method": (
            "Native XGBoost TreeSHAP via pred_contribs on the held-out test set; "
            "contributions are in raw log-odds space."
        ),
        "test_rows_explained": int(len(test)),
        "mean_absolute_shap_log_odds": {
            name: float(value) for name, value in mean_abs.items()
        },
        "relative_contribution": {
            "age": age_share,
            "bmi_testosterone_shbg_combined": non_age_share,
            "note": "BMI is an anthropometric feature, not a hormone.",
        },
        "age_dominance_rule": {
            "threshold": AGE_DOMINANCE_THRESHOLD,
            "is_overwhelmingly_dominant": age_dominant,
        },
        "example": {
            "SEQN": int(test.loc[example_index, "SEQN"]),
            "actual_target": str(test.loc[example_index, TARGET]),
            "predicted_probability_natural_menopause": float(
                probabilities[example_position]
            ),
        },
        "no_age_ablation": ablation,
    }
    (output_dir / "shap_report.json").write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset", type=Path, default=Path("data/processed/analytic_dataset.csv")
    )
    parser.add_argument(
        "--assignments",
        type=Path,
        default=Path("model/artifacts/split_assignments.csv"),
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path("model/artifacts/xgboost_classifier.json"),
    )
    parser.add_argument("--output-dir", type=Path, default=Path("explain/artifacts"))
    args = parser.parse_args()
    print(
        json.dumps(
            run(args.dataset, args.assignments, args.checkpoint, args.output_dir),
            indent=2,
            allow_nan=False,
        )
    )


if __name__ == "__main__":
    main()
