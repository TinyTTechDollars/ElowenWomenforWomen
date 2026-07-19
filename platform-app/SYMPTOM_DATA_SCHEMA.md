# Elowen Anonymous Symptom Data Schema

Elowen stores optional structured symptom selections separately from prediction
inputs and results only when a person actively enables the research-data consent
checkbox, which is off by default. Declining does not affect the result. The table
is intended as a seed dataset for methods research, not clinical records or diagnosis.

| Field | Type | Description |
|---|---|---|
| `id` | random UUID | Record identifier generated at submission time |
| `created_at` | timestamp | Submission time |
| `age_band` | category | `12–39`, `40–59`, or `60+`; raw age is not stored |
| `bmi_band` | category | Broad BMI interval; raw height, weight, and BMI are not stored |
| `fatigue` | optional category | User-selected fatigue level |
| `weight_change` | optional category | User-selected recent weight-change category |
| `period_pattern` | optional category | User-selected period pattern |
| `period_pain` | optional category | User-selected menstrual-pain severity |
| `pain` | optional category | User-selected muscle/joint-pain frequency |
| `skin_changes` | optional category | User-selected acne or skin-texture change level |
| `hair_changes` | optional category | User-selected hair thinning or increased-growth category |
| `sleep_quality` | optional category | User-selected sleep-quality category |
| `skin_hair` | legacy optional category | Preserved for older submissions; new forms use the separate skin and hair fields |
| `model_version` | string | Elowen model version active at submission |

Not stored: name, email, address, IP address, free text, exact birth date, raw
age, height, weight, BMI, hormone values, prediction, or probability. Empty
symptom forms are not saved. The records remain observational self-report and
must not be treated as diagnoses, causal evidence, or a population-representative
sample.

## Daily check-in research table

Daily check-ins are stored locally for personal tracking regardless of research
consent. Only active opt-in sends an anonymous copy to `daily_checkins`, with a
random local entry ID, date, calculated cycle-day offset, five core 1–5 ratings,
bleeding intensity, period-start marker, optional daily sign tags, optional
hot-flash rating, current hormonal medication category, weekly skin/hair ratings, `data_confidence`, and a JSON list
of triggered `quality_flags`. A random device-local participant identifier
groups consented longitudinal entries without storing a name or contact detail.
It does not contain contact information, model inputs, a prediction, or a report.
