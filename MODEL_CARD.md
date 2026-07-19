# Model Card: NHANES Menstrual-Status Research Classifier

## Companion longitudinal tracker limitation

The Elowen interface includes an optional daily self-report tracker and doctor
conversation report. Those entries are not model features and do not modify the
classifier output. The prototype has no push-notification or reminder system;
sustained daily adherence in a real deployment would require separately
consented reminders and evaluation of missing and selectively reported days.

## Model details and intended use

- **Model:** XGBoost binary classifier, library defaults except seed 42
- **Inputs:** age, BMI, total testosterone, and SHBG
- **Output:** `recent_menstruation` or
  `self_reported_natural_menopause`, with probability
- **Excluded inputs:** estradiol, source cycle, survey mode, and survey weights

This is a reproducible research and education baseline. **It is not a diagnosis
and must not be used for screening, treatment, or other clinical decisions.**
It does not estimate population prevalence.

## Training data

The expanded cohort combines public NHANES 2013–2014, 2015–2016, and August
2021–August 2023 DEMO, RHQ, TST, and BMX components. One-to-one joins use a
cycle-qualified respondent key. After complete-case and known-condition
exclusions, it contains 6,177 rows:

| Target | Rows | Sample share |
|---|---:|---:|
| `recent_menstruation` | 4,032 | 65.27% |
| `self_reported_natural_menopause` | 2,145 | 34.73% |

The target is constructed from `RHQ031` and `RHD043`. Known pregnancy,
breastfeeding, hysterectomy, and bilateral ovary removal are excluded.

## Evaluation

Seed 42 produced a class-stratified 70/15/15 train/validation/test split
(4,323/927/927). No tuning or resampling was performed.

| Metric | Expanded test result |
|---|---:|
| Accuracy | 95.04% |
| Precision | 93.67% |
| Recall | 91.93% |
| F1 | 92.79% |

The positive class is self-reported natural menopause. The confusion matrix,
rows actual and columns predicted in `[recent, menopause]` order, is
`[[585, 20], [26, 296]]`.

| Held-out subgroup | N | Accuracy | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|
| 2013–2014 | 285 | 94.04% | 91.89% | 86.08% | 88.89% |
| 2015–2016 | 303 | 94.72% | 93.94% | 90.29% | 92.08% |
| 2021–2023 | 339 | 96.17% | 94.41% | 96.43% | 95.41% |

Survey-mode results are descriptive and confounded with cycle: CAPI with proxy
permitted (the two older cycles) achieved 94.39% accuracy; ACASI without proxy
(2021–2023) achieved 96.17%.

## Explainability and comparison

Native TreeSHAP was computed on all 927 test rows in log-odds space.

| Feature | Mean absolute SHAP | Relative share |
|---|---:|---:|
| Age | 7.1229 | 81.03% |
| Testosterone | 0.5674 | 6.46% |
| SHBG | 0.5612 | 6.38% |
| BMI | 0.5384 | 6.13% |

The three non-age features contribute 18.97% combined. Age shares were stable
by cycle (80.94%, 80.41%, and 81.65%).

| Analysis | Full model | No-age ablation | Majority baseline |
|---|---:|---:|---:|
| 2021–2023 baseline | 98.14% | 59.94% | 58.07% |
| Three-cycle expansion | 95.04% | 65.05% | 65.26% |

## Limitations

- **The result is primarily age-driven.** Testosterone, SHBG, and BMI show
  limited predictive value beyond age for this binary label. In the expanded
  cohort, the quick no-age model is 0.22 percentage points below the majority
  baseline. This is an informative constraint on what public NHANES data can
  currently support, not proof that biomarkers lack value elsewhere.
- The binary last-12-months proxy omits perimenopause, hormone therapy, nuanced
  cycle patterns, symptoms, and clinical assessment.
- Questionnaire administration changed: 2013–2016 used CAPI with proxy and
  interpreters permitted; 2021–2023 used English/Spanish ACASI without proxy.
  Mode and cycle cannot be disentangled in this dataset.
- Testosterone is comparable in analyte, units, and isotope-dilution LC-MS/MS
  principle across retained cycles, but the 2021–2023 panel used newer SCIEX
  hardware and a lower detection limit. SHBG retained the Roche cobas e 411
  Elecsys method, with a lower current-cycle detection limit. NCHS documents no
  bridge or incompatibility warning for these retained cycles. Cycle checks are
  therefore reported; no custom calibration was applied.
- Estradiol is completeness/audit-only and never a model input.
- Complete-case filtering and self-report can introduce selection, recall,
  routing, language, and reporting-mode bias.
- This unweighted classifier makes no population-level claims. Source weights
  are provenance only and are not model inputs; population inference would
  require a correctly combined multi-cycle weight and survey-design analysis.
- The no-age model is an untuned sanity check, not an independently validated
  biomarker model. Neither SHAP nor predictive association establishes cause.

## Ethical considerations

Reproductive information is sensitive. Avoid individual profiling,
stigmatizing language, unsupported causal claims, and use in employment,
insurance, access, or treatment decisions. Retain the non-diagnostic disclaimer
in derived outputs.
