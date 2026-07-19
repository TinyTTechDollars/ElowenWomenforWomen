"""Train the approved XGBoost menstrual-status research classifier.

This model is for research and awareness only. It is not a diagnosis and must
not be used for clinical decisions.
"""

from __future__ import annotations

import argparse
import json
import math
import platform
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import sklearn
import xgboost
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier


SEED = 42
FEATURES = ["RIDAGEYR", "BMXBMI", "LBXTST", "LBXSHBG"]
TARGET = "target"
NEGATIVE_LABEL = "recent_menstruation"
POSITIVE_LABEL = "self_reported_natural_menopause"
DISCLAIMER = "Not a diagnosis — discuss health questions with a healthcare provider."


def split_data(data: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Create exact stratified 70/15/15 partitions with a fixed seed."""
    train, remainder = train_test_split(
        data,
        test_size=0.30,
        stratify=data[TARGET],
        random_state=SEED,
    )
    validation, test = train_test_split(
        remainder,
        test_size=0.50,
        stratify=remainder[TARGET],
        random_state=SEED,
    )
    return {"train": train, "validation": validation, "test": test}


def encode_target(values: pd.Series) -> pd.Series:
    mapping = {NEGATIVE_LABEL: 0, POSITIVE_LABEL: 1}
    encoded = values.map(mapping)
    if encoded.isna().any():
        unknown = sorted(values.loc[encoded.isna()].astype(str).unique())
        raise ValueError(f"Unexpected target labels: {unknown}")
    return encoded.astype(int)


def class_counts(frame: pd.DataFrame) -> dict[str, int]:
    return {
        str(label): int(total)
        for label, total in frame[TARGET].value_counts().sort_index().items()
    }


def json_safe(value):
    """Convert non-finite library parameter values to strict JSON nulls."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def age_subgroup_metrics(test: pd.DataFrame, y_true, y_pred) -> dict:
    """Report prespecified age bands; flag bands containing only one class."""
    bands = {"12-39": (12, 39), "40-59": (40, 59), "60+": (60, float("inf"))}
    results = {}
    y_true_series = pd.Series(y_true.to_numpy(), index=test.index)
    y_pred_series = pd.Series(y_pred, index=test.index)
    for name, (lower, upper) in bands.items():
        mask = test["RIDAGEYR"].between(lower, upper)
        actual = y_true_series.loc[mask]
        predicted = y_pred_series.loc[mask]
        precision, recall, f1, _ = precision_recall_fscore_support(
            actual, predicted, average="binary", pos_label=1, zero_division=0
        )
        results[name] = {
            "n": int(mask.sum()),
            "actual_recent_menstruation": int((actual == 0).sum()),
            "actual_self_reported_natural_menopause": int((actual == 1).sum()),
            "accuracy": float(accuracy_score(actual, predicted)),
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "confusion_matrix": confusion_matrix(
                actual, predicted, labels=[0, 1]
            ).astype(int).tolist(),
            "single_class_warning": bool(actual.nunique() < 2),
        }
    return results


def train(dataset_path: Path, artifacts_dir: Path) -> dict:
    data = pd.read_csv(dataset_path)
    required = ["SEQN", *FEATURES, TARGET]
    missing_columns = sorted(set(required) - set(data.columns))
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {missing_columns}")
    if data[required].isna().any().any():
        raise ValueError("Training columns contain missing values")
    if "LBXEST" in FEATURES:
        raise AssertionError("Estradiol leakage: LBXEST must not be a classifier feature")
    if not data["SEQN"].is_unique:
        raise ValueError("SEQN must be unique before splitting")

    splits = split_data(data)
    model = XGBClassifier(random_state=SEED)
    model.fit(splits["train"][FEATURES], encode_target(splits["train"][TARGET]))

    test = splits["test"]
    y_true = encode_target(test[TARGET])
    y_pred = model.predict(test[FEATURES]).astype(int)
    y_probability = model.predict_proba(test[FEATURES])[:, 1]
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="binary", pos_label=1, zero_division=0
    )
    matrix = confusion_matrix(y_true, y_pred, labels=[0, 1])

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    model.save_model(artifacts_dir / "xgboost_classifier.json")

    split_rows = []
    for split_name, frame in splits.items():
        split_rows.extend(
            {"SEQN": int(seqn), "split": split_name}
            for seqn in frame["SEQN"].tolist()
        )
    pd.DataFrame(split_rows).sort_values("SEQN").to_csv(
        artifacts_dir / "split_assignments.csv", index=False
    )

    predictions = test[["SEQN", TARGET]].copy()
    predictions["predicted_target"] = pd.Series(y_pred, index=test.index).map(
        {0: NEGATIVE_LABEL, 1: POSITIVE_LABEL}
    )
    predictions["probability_self_reported_natural_menopause"] = y_probability
    predictions["disclaimer"] = DISCLAIMER
    predictions.sort_values("SEQN").to_csv(
        artifacts_dir / "test_predictions.csv", index=False
    )

    metrics = {
        "disclaimer": DISCLAIMER,
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        "model": {
            "class": "xgboost.XGBClassifier",
            "hyperparameters": "Library defaults except random_state=42",
            "resolved_parameters": json_safe(model.get_params()),
        },
        "reproducibility": {
            "random_seed": SEED,
            "split": "70% train / 15% validation / 15% test, stratified by target",
            "python": platform.python_version(),
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "xgboost": xgboost.__version__,
        },
        "features": FEATURES,
        "explicitly_excluded_feature": "LBXEST (estradiol)",
        "positive_class_for_precision_recall_f1": POSITIVE_LABEL,
        "split_sizes": {name: int(len(frame)) for name, frame in splits.items()},
        "split_class_counts": {
            name: class_counts(frame) for name, frame in splits.items()
        },
        "test_metrics": {
            "accuracy": float(accuracy_score(y_true, y_pred)),
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "confusion_matrix": {
                "label_order": [NEGATIVE_LABEL, POSITIVE_LABEL],
                "matrix": matrix.astype(int).tolist(),
                "interpretation": "Rows are actual labels; columns are predicted labels.",
            },
        },
        "test_metrics_by_age_subgroup": age_subgroup_metrics(test, y_true, y_pred),
    }
    (artifacts_dir / "metrics.json").write_text(
        json.dumps(metrics, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset", type=Path, default=Path("data/processed/analytic_dataset.csv")
    )
    parser.add_argument(
        "--artifacts-dir", type=Path, default=Path("model/artifacts")
    )
    args = parser.parse_args()
    print(json.dumps(train(args.dataset, args.artifacts_dir), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
