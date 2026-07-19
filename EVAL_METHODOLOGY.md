# Evaluation Methodology

## Scope

This evaluation concerns a constructed binary survey label, not diagnostic
validity, clinical utility, or population prevalence. Every prediction is **not
a diagnosis** and must not guide healthcare decisions.

## Cohort, features, and class balance

`data/build_multicycle_dataset.py` creates 6,177 rows: 4,032
`recent_menstruation` and 2,145 `self_reported_natural_menopause`. The combined
class ratio is approximately **1.88:1**, compared with **1.38:1** in the
2021–2023 single-cycle model. This remains mild imbalance: class-stratified
splitting applies, and no over-sampling, under-sampling, synthetic sampling, or
class weighting is used.

Inputs are age, BMI, total testosterone, and SHBG. Estradiol, source cycle,
survey mode, source survey weight, strata, and PSU are excluded from the model.

## Split and training

Random seed 42 is used throughout. Two class-stratified splits create the exact
70/15/15 allocation:

| Partition | Rows | Recent menstruation | Natural menopause |
|---|---:|---:|---:|
| Train | 4,323 | 2,822 | 1,501 |
| Validation | 927 | 605 | 322 |
| Test | 927 | 605 | 322 |

The validation set is retained but not used for tuning. XGBoost library defaults
are used except `random_state=42`. Saved assignments prevent resplitting and are
reused for SHAP and ablation.

## Overall test metrics

Self-reported natural menopause is the positive class.

| Metric | Result |
|---|---:|
| Accuracy | 95.04% |
| Precision | 93.67% |
| Recall | 91.93% |
| F1 | 92.79% |

Confusion matrix, rows actual and columns predicted, ordered
`[recent_menstruation, self_reported_natural_menopause]`:

```text
[[585, 20],
 [ 26, 296]]
```

No confidence intervals or hypothesis tests are claimed. This is one random
partition and the outcome is not clinically adjudicated.

## Cycle and administration-mode checks

| Test subgroup | N | Accuracy | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|
| 2013–2014 | 285 | 94.04% | 91.89% | 86.08% | 88.89% |
| 2015–2016 | 303 | 94.72% | 93.94% | 90.29% | 92.08% |
| 2021–2023 | 339 | 96.17% | 94.41% | 96.43% | 95.41% |
| CAPI, proxy permitted | 588 | 94.39% | 93.06% | 88.46% | 90.70% |
| ACASI, no proxy | 339 | 96.17% | 94.41% | 96.43% | 95.41% |

These are descriptive checks, not independent causal tests. Administration mode
is perfectly aligned with old versus current cycles, so mode, calendar period,
cohort composition, and laboratory context are confounded.

## Explainability

Native XGBoost TreeSHAP (`pred_contribs`) is computed for all 927 test rows in
raw log-odds space, with numerical additivity verification. Global importance is
mean absolute SHAP magnitude.

| Feature | Mean absolute SHAP | Share |
|---|---:|---:|
| Age | 7.1229 | 81.03% |
| Testosterone | 0.5674 | 6.46% |
| SHBG | 0.5612 | 6.38% |
| BMI | 0.5384 | 6.13% |

The three non-age features contribute 18.97% combined. Age's share is stable
across 2013–2014 (80.94%), 2015–2016 (80.41%), and 2021–2023 (81.65%). The
example waterfall explains one held-out row and carries the non-diagnostic
disclaimer.

## No-age sanity check and original comparison

Because age exceeds the prespecified 75% dominance threshold, an untuned model
using only BMI, testosterone, and SHBG is trained on the same training rows and
evaluated on the same test rows.

| Analysis | Full accuracy | No-age accuracy | Majority baseline |
|---|---:|---:|---:|
| Original 2021–2023 | 98.14% | 59.94% | 58.07% |
| Three-cycle expansion | 95.04% | 65.05% | 65.26% |

The expanded no-age model is 0.22 percentage points below its majority baseline.
Together with the 81.03% age SHAP share, this supports only the limited finding
that the measured non-age variables add little predictive value beyond age in
this setup. It does not establish biological causality or clinical utility.

## Survey-weight policy

No downstream document or output makes a population-level “X% of women” claim;
all class shares describe the filtered training sample. Accordingly, no combined
multi-cycle survey weight is constructed. Source `WTMEC2YR` is retained for
provenance only, and no weight is a model input. Any future population inference
must first construct the appropriate combined weight under NCHS guidance and use
the survey strata and PSU variables in design-aware estimation.

## Reproducibility artifacts

- `model/artifacts/multicycle/multicycle_metrics.json`
- `model/artifacts/multicycle/multicycle_split_assignments.csv`
- `model/artifacts/multicycle/multicycle_test_predictions.csv`
- `explain/artifacts/multicycle/multicycle_shap_report.json`
- `explain/artifacts/multicycle/multicycle_global_importance.png`
- `explain/artifacts/multicycle/multicycle_shap_by_cycle.png`
- `explain/artifacts/multicycle/multicycle_example_waterfall.png`
