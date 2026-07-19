"""Train the approved three-cycle XGBoost research classifier."""

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
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier


SEED = 42
FEATURES = ["age_years", "bmi", "testosterone_ng_dl", "shbg_nmol_l"]
TARGET = "target"
NEGATIVE_LABEL = "recent_menstruation"
POSITIVE_LABEL = "self_reported_natural_menopause"
DISCLAIMER = "Not a diagnosis — discuss health questions with a healthcare provider."


def encode_target(values: pd.Series) -> pd.Series:
    mapping = {NEGATIVE_LABEL: 0, POSITIVE_LABEL: 1}
    result = values.map(mapping)
    if result.isna().any():
        raise ValueError("Unexpected target label")
    return result.astype(int)


def split_data(data: pd.DataFrame) -> dict[str, pd.DataFrame]:
    train, remainder = train_test_split(
        data, test_size=0.30, stratify=data[TARGET], random_state=SEED
    )
    validation, test = train_test_split(
        remainder,
        test_size=0.50,
        stratify=remainder[TARGET],
        random_state=SEED,
    )
    return {"train": train, "validation": validation, "test": test}


def evaluate(actual, predicted) -> dict:
    precision, recall, f1, _ = precision_recall_fscore_support(
        actual, predicted, average="binary", pos_label=1, zero_division=0
    )
    return {
        "n": int(len(actual)),
        "actual_recent_menstruation": int((actual == 0).sum()),
        "actual_self_reported_natural_menopause": int((actual == 1).sum()),
        "accuracy": float(accuracy_score(actual, predicted)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "confusion_matrix": confusion_matrix(actual, predicted, labels=[0, 1])
        .astype(int)
        .tolist(),
        "single_class_warning": bool(pd.Series(actual).nunique() < 2),
    }


def subgroup_metrics(test: pd.DataFrame, actual: pd.Series, predicted) -> dict:
    actual = pd.Series(actual.to_numpy(), index=test.index)
    predicted = pd.Series(predicted, index=test.index)
    results = {}
    for field in ["source_cycle", "survey_mode"]:
        results[field] = {}
        for value in sorted(test[field].unique()):
            mask = test[field].eq(value)
            results[field][str(value)] = evaluate(actual.loc[mask], predicted.loc[mask])
    return results


def json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return value


def train(dataset_path: Path, artifacts_dir: Path) -> dict:
    data = pd.read_csv(dataset_path)
    required = ["respondent_key", "source_cycle", "survey_mode", *FEATURES, TARGET]
    if set(required) - set(data.columns):
        raise ValueError("Dataset is missing required harmonized columns")
    if data[required].isna().any().any() or not data["respondent_key"].is_unique:
        raise ValueError("Dataset has missing model fields or duplicate respondent keys")
    prohibited = {"estradiol_pg_ml_audit", "source_cycle", "survey_mode", "source_wtmec2yr"}
    if prohibited.intersection(FEATURES):
        raise AssertionError("Metadata, weights, or estradiol leaked into model inputs")

    splits = split_data(data)
    model = XGBClassifier(random_state=SEED)
    model.fit(splits["train"][FEATURES], encode_target(splits["train"][TARGET]))
    test = splits["test"]
    actual = encode_target(test[TARGET])
    predicted = model.predict(test[FEATURES]).astype(int)
    probability = model.predict_proba(test[FEATURES])[:, 1]

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    model.save_model(artifacts_dir / "xgboost_multicycle_classifier.json")
    assignments = pd.concat(
        [
            frame[["respondent_key"]].assign(split=name)
            for name, frame in splits.items()
        ]
    ).sort_values("respondent_key")
    assignments.to_csv(artifacts_dir / "multicycle_split_assignments.csv", index=False)

    predictions = test[["respondent_key", "source_cycle", "survey_mode", TARGET]].copy()
    predictions["predicted_target"] = pd.Series(predicted, index=test.index).map(
        {0: NEGATIVE_LABEL, 1: POSITIVE_LABEL}
    )
    predictions["probability_self_reported_natural_menopause"] = probability
    predictions["disclaimer"] = DISCLAIMER
    predictions.sort_values("respondent_key").to_csv(
        artifacts_dir / "multicycle_test_predictions.csv", index=False
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
            "split": "70% train / 15% validation / 15% test, stratified by class",
            "resampling": "None; 1.88:1 class ratio treated as mild imbalance",
            "python": platform.python_version(),
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "xgboost": xgboost.__version__,
        },
        "features": FEATURES,
        "prohibited_inputs": sorted(prohibited),
        "weight_policy": (
            "No survey weight is used as a model input. This is an unweighted "
            "classifier and makes no population-prevalence claims."
        ),
        "split_sizes": {name: int(len(frame)) for name, frame in splits.items()},
        "split_class_counts": {
            name: {
                str(k): int(v)
                for k, v in frame[TARGET].value_counts().sort_index().items()
            }
            for name, frame in splits.items()
        },
        "test_metrics": evaluate(actual, predicted),
        "test_metrics_by_subgroup": subgroup_metrics(test, actual, predicted),
    }
    (artifacts_dir / "multicycle_metrics.json").write_text(
        json.dumps(metrics, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset", type=Path, default=Path("data/processed/multicycle_dataset.csv")
    )
    parser.add_argument(
        "--artifacts-dir", type=Path, default=Path("model/artifacts/multicycle")
    )
    args = parser.parse_args()
    print(json.dumps(train(args.dataset, args.artifacts_dir), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
