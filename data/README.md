# Data pipeline

Research/awareness use only. Outputs are **not diagnoses** and must not be used
for clinical decisions.

`build_multicycle_dataset.py` creates the approved harmonized 2013–2014,
2015–2016, and 2021–2023 cohort. It retains `source_cycle`, `survey_mode`, and
source survey-design fields as descriptive/provenance metadata only. The source
weight is not treated as a combined weight. The original single-cycle scripts
remain available for comparison.

Run from the repository root:

```bash
python data/explore_data.py
python data/build_dataset.py
python data/build_multicycle_dataset.py
```

The raw and processed data directories are ignored by git because all artifacts
can be recreated from the CDC source files.

## Frozen label definition

- `recent_menstruation`: `RHQ031 == 1` (at least one period in the past year).
- `self_reported_natural_menopause`: `RHQ031 == 2` and `RHD043 == 7`.
- Known pregnancy, breastfeeding, hysterectomy, or removal of both ovaries is
  excluded from either class.
- Missing condition fields are not interpreted as affirmative responses because
  the public RHQ file has age-related disclosure restrictions.

This is deliberately not a perimenopause model. Estradiol is audit-only, and
cycle, survey mode, and weights are prohibited model inputs.
