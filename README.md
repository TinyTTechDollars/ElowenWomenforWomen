# Explainable NHANES Menstrual-Status Research Baseline

An open, reproducible classifier using three compatible public NHANES cycles:
2013–2014, 2015–2016, and August 2021–August 2023. It joins demographics,
reproductive-health responses, serum hormones, and body measures; constructs a
transparent binary survey label; trains XGBoost; and explains predictions with
TreeSHAP.

> **Research and awareness use only — not a diagnosis.** This project does not
> determine clinical reproductive stage and must not guide treatment or other
> healthcare decisions.

## Main finding

| Analysis | Rows | Full accuracy | Age SHAP share | No-age accuracy | Majority baseline |
|---|---:|---:|---:|---:|---:|
| 2021–2023 baseline | 2,146 | 98.14% | 80.37% | 59.94% | 58.07% |
| Three-cycle expansion | 6,177 | 95.04% | 81.03% | 65.05% | 65.26% |

In this classifier training set, testosterone, SHBG, and BMI show limited
predictive value beyond age for the binary label. In the expansion, removing
age makes performance slightly worse than simply predicting the majority
class. This is a useful finding about what the current public NHANES variables
can and cannot support; it is not evidence that these measures lack biological
or clinical relevance in other study designs.

## Target and cohort

- `recent_menstruation`: at least one period in the past 12 months
  (`RHQ031 == 1`).
- `self_reported_natural_menopause`: no period in the past 12 months and the
  reported reason is menopause/change of life (`RHQ031 == 2`, `RHD043 == 7`).

Known pregnancy, breastfeeding, hysterectomy, and bilateral ovary removal are
excluded. The combined sample has 4,032 and 2,145 rows respectively, a 1.88:1
class ratio. This is a survey-derived proxy, not a diagnosis or complete
hormonal life-stage label.

## Reproduce

Python 3.11 or newer is recommended.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python data/build_multicycle_dataset.py
python model/train_multicycle.py
python explain/generate_multicycle_shap.py
```

The original single-cycle pipeline remains available as `data/build_dataset.py`,
`model/train.py`, and `explain/generate_shap.py`. Raw and processed NHANES files
are excluded from version control and recreated from CDC public files.

## Outputs

- `model/artifacts/multicycle/xgboost_multicycle_classifier.json`
- `model/artifacts/multicycle/multicycle_metrics.json`
- `model/artifacts/multicycle/multicycle_split_assignments.csv`
- `model/artifacts/multicycle/multicycle_test_predictions.csv`
- `explain/artifacts/multicycle/multicycle_shap_report.json`
- `explain/artifacts/multicycle/multicycle_global_importance.png`
- `explain/artifacts/multicycle/multicycle_shap_by_cycle.png`
- `explain/artifacts/multicycle/multicycle_example_waterfall.png`

## Survey weights and interpretation

This repository makes no population-level prevalence or “X% of women” claims.
It evaluates an unweighted predictive training set. Source `WTMEC2YR` values are
retained only for provenance; no combined multi-cycle weight was constructed,
and weights, cycle, survey mode, and estradiol are not model inputs. A properly
combined weight following NCHS guidance would be required before making
population estimates.

See [MODEL_CARD.md](MODEL_CARD.md), [DATASHEET.md](DATASHEET.md), and
[EVAL_METHODOLOGY.md](EVAL_METHODOLOGY.md) before interpreting results.

## Elowen longitudinal tracking

The companion application adds a minimal daily check-in and a downloadable
two-week or one-month clinician-conversation report. Daily entries are stored
locally for the person's own use; anonymous research contribution occurs only
after explicit opt-in. Reports plot the five core ratings, mark reported period
starts, and include only trend statements supported by the selected entries.
Fewer than seven entries produces an explicit insufficient-data message.

This prototype does not provide push notifications. Sustained real-world daily
use would require a separately consented reminder system and adherence study.

The check-in distinguishes no bleeding, spotting, light, moderate, and heavy
flow from the separate period-start marker. Optional daily signs cover hot
flashes, headache, brain fog, anxiety or irritability, vaginal or urinary
symptoms, libido change, and palpitations. A restrained streak and calendar-dot
view support adherence without a game aesthetic; missed days receive neutral
“welcome back” language. A production version would benefit from opt-in push
notifications or a similar reminder mechanism, which remains out of scope.

The daily form also asks whether the person currently uses no hormonal
medication, combined hormonal contraception, progestin-only contraception or a
hormonal IUD, hormone replacement therapy, fertility medication, or prefers
not to say. This is report context and never changes the classifier.

Self-report is useful but is not treated as equivalent to standardized lab
measurement. Every research-shared daily entry receives a rule-based data
confidence tag; flagged records remain in the dataset and are never silently
removed. The methodology and thresholds are documented in `DATASHEET.md`.

Provider search remains inside Elowen and returns real OB-GYN or endocrinology
registry records from the public CMS NPPES NPI Registry. NPPES does not report
appointment availability, insurance participation, or acceptance of new
patients, so Elowen makes none of those claims.

Selecting a provider opens an appointment-interest and sharing-consent step.
The prototype does not send appointment requests or grant clinicians portal
access. Consent enables the user-controlled report-sharing path. A clearly
labeled fictional “Dr. Sara P.” profile demonstrates this interaction without
presenting an invented doctor as real or available.

Optional FSH, LH, estradiol, progesterone, prolactin, DHEA-S, thyroid, TPO
antibody, and cortisol values are context only. They do not change the model
probability; they can be carried into the doctor-preparation summary for
interpretation with timing, medications, symptoms, and laboratory ranges.

The results page also includes a research-bias audit of sampling coverage,
cross-sectional design, subgroup precision, label construction, age dominance,
and missing longitudinal and clinically relevant detail.

## Rule-based Screening Insights

Screening Insights is visually and computationally separate from the trained
classifier. It never changes the menopause-label probability. Each card shows
matched checks rather than a risk percentage, links to its published source,
states that it is not a diagnosis, and offers a concrete conversation step.

- PCOS uses only observable irregular-cycle and hair/skin pattern domains from
  the 2023 International Evidence-based PCOS Guideline; it does not claim that
  self-report confirms hyperandrogenism or the complete diagnostic criteria.
- The endometriosis-related pain flag requires at least 14 check-ins spanning
  two reported period starts plus repeated average pain of 4/5 or higher in a
  defined period window. This is a transparent project rule informed by NICE
  symptom guidance, not a validated endometriosis screener.
- Bone-health review follows the USPSTF age/risk-assessment pathway using age,
  the model's explicitly nonclinical survey label, BMI, smoking, and parental
  hip-fracture history. It does not calculate FRAX or diagnose osteoporosis.
- Depression uses the two PHQ-2 questions and the conventional follow-up
  threshold of 3. Elowen does not administer the PHQ-9 or ask its self-harm
  item because the prototype has no crisis-response infrastructure.

Code and original documentation use the MIT License; NHANES data remain subject
to CDC/NCHS terms.
