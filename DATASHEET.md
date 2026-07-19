# Datasheet: Multi-Cycle NHANES Binary Menstrual-Status Dataset

## Motivation and scope

This constructed dataset supports transparent study of a binary menstrual-status
survey proxy using public NHANES data. It is a classifier training set, not a
population estimate or clinical dataset. **The label is not a diagnosis.**

## Sources and retained cycles

The pipeline combines Demographics (DEMO), Reproductive Health (RHQ), Sex
Steroid Hormone Panel (TST), and Body Measures (BMX) from:

- NHANES 2013–2014 (`_H`)
- NHANES 2015–2016 (`_I`)
- NHANES August 2021–August 2023 (`_L`)

2017–2018 is excluded because the public steroid file does not provide the
required testosterone field and estradiol methods changed. The 2019–2020
standalone cycle is excluded because the complete required public panel is not
available as a representative standalone cycle; the public combined-cycle file
also lacks the required testosterone measure. Estradiol remains audit-only.

## Laboratory-method harmonization

NCHS documentation supports combining testosterone and SHBG for this predictive
analysis, with cycle retained for checks:

- Testosterone in 2013–2014 and 2015–2016 used the same CDC simultaneous
  isotope-dilution LC-MS/MS method, stable-isotope standards, and AB/Sciex API
  5500 platform. Released 2013–2014 values already incorporate the documented
  within-cycle bridge adjustment from its earlier testosterone-only method.
- In 2021–2023 testosterone remained isotope-dilution LC-MS/MS in the same units,
  using a SCIEX API 6500 expanded panel. The detection limit changed from about
  0.75 to 0.57 ng/dL. This is a documented platform/protocol update, not an
  undocumented change; NCHS provides no incompatibility or bridge warning for
  combining these retained cycles.
- SHBG used the Roche/Hitachi cobas e 411 Elecsys assay in all retained cycles,
  in nmol/L. Its detection limit changed from 0.800 to 0.350 nmol/L, with no
  documented bridge or incompatibility warning.

No custom calibration is applied. `source_cycle` permits descriptive checks.

## Construction and composition

Files are joined one-to-one within cycle on `SEQN`; `respondent_key` combines
cycle and `SEQN` to ensure cross-cycle uniqueness.

| Step | Retained | Excluded at step |
|---|---:|---:|
| Female demographic records | 16,609 | — |
| Complete estradiol, testosterone, and SHBG | 10,563 | 6,046 |
| Also complete BMI | 10,453 | 110 |
| Matches either candidate label | 6,562 | 3,891 |
| Final after known-condition exclusions | 6,177 | 385 |

| Cycle | Recent menstruation | Natural menopause | Total |
|---|---:|---:|---:|
| 2013–2014 | 1,358 | 598 | 1,956 |
| 2015–2016 | 1,430 | 645 | 2,075 |
| 2021–2023 | 1,244 | 902 | 2,146 |
| **Combined** | **4,032** | **2,145** | **6,177** |

The reported percentages and ratios describe only this filtered analytic
sample; they are not estimates about women in the U.S. population.

## Harmonized fields

| Output field | Source/use |
|---|---|
| `respondent_key`, `SEQN` | Cycle-qualified audit key and source identifier |
| `source_cycle` | Descriptive subgroup metadata; prohibited model input |
| `survey_mode` | Descriptive mode metadata; prohibited model input |
| `age_years` | `RIDAGEYR`; model input |
| `bmi` | `BMXBMI`; model input |
| `testosterone_ng_dl` | `LBXTST`; model input |
| `shbg_nmol_l` | `LBXSHBG`; model input |
| `estradiol_pg_ml_audit` | `LBXEST`; completeness/audit only |
| `source_wtmec2yr` | Source `WTMEC2YR`, provenance only |
| `survey_stratum`, `survey_psu` | Source design fields, provenance only |
| `target` | Constructed binary label |

The source questionnaire mappings use the cycle-specific RHQ files while
preserving the same response-code rules.

## Label and exclusion rules

1. `recent_menstruation` when `RHQ031 == 1`.
2. `self_reported_natural_menopause` when `RHQ031 == 2` and `RHD043 == 7`.
3. Exclude known hysterectomy (`RHD280 == 1`), bilateral ovary removal
   (`RHQ305 == 1`), current pregnancy (`RHD143 == 1`), or breastfeeding
   (`RHQ200 == 1`).
4. Missing condition fields are not treated as affirmative. Exclude other
   amenorrhea reasons, refusals, unknowns, and nonmatching records.

The public questionnaire cannot support a defensible four-stage or direct
perimenopause label.

## Survey administration and weights

The older cycles used interviewer-led CAPI, with proxy respondents and
interpreters permitted. The 2021–2023 cycle used English/Spanish ACASI without
proxy respondents. Privacy, language, literacy, interviewer presence, and proxy
use may shift reporting. `survey_mode` is retained only for descriptive checks;
because mode aligns with cycle, their effects cannot be separated.

This project makes no population-level or “X% of women” claims. It is an
unweighted predictive analysis. `source_wtmec2yr` is retained only for
provenance, is not concatenated and interpreted as a valid combined weight, and
is not a model input. No combined survey weight is constructed. Population
inference would require a weight formed according to NCHS multi-cycle guidance,
along with strata/PSU-aware analysis.

## Known gaps and appropriate use

Self-report, questionnaire routing, public-file disclosure restrictions,
complete-case selection, laboratory detection limits, collection timing,
physiology, medication, and unmeasured confounding can affect results. The
cohort omits perimenopause, surgical menopause, nuanced cycle patterns,
symptoms, hormone therapy detail, and clinical adjudication.

Appropriate uses include methods research, reproducibility, education, and
critical study of public-data limitations. Do not use it for diagnosis,
screening, treatment, individual risk scoring, insurance, employment, access,
causal claims, or population prevalence claims.

## Longitudinal daily check-ins

The Elowen application also offers a separate, prospective daily check-in. It
is not part of the NHANES training dataset and does not change the classifier.
The deliberately short design is grounded in the Daily Record of Severity of
Problems (DRSP) approach while reducing burden for daily adherence. It records
1–5 structured ratings for mood, energy, bloating or breast tenderness, pain,
and sleep; a period-start yes/no anchor; conditionally relevant hot flashes or
night sweats; and weekly rather than daily skin and hair observations.

Entries are dated and assigned a cycle-day offset representing days since the
most recently reported period start. They remain in the person's browser for
personal tracking. An anonymous copy is written to the research store only when
the existing symptom-data contribution checkbox has been actively enabled.
Names, contact information, exact model inputs, predictions, and report files
are not included in that research copy.

This feature addresses the challenge brief's “Dynamic Biology, Static Care”
gap by making repeated self-report visible across time rather than treating one
survey or laboratory measurement as a complete account. It remains
observational and non-diagnostic. The hackathon implementation has no push
notification or reminder system; a real deployment would need an explicitly
consented reminder mechanism to support adherence and would need to evaluate
missing-not-at-random check-ins and reporting bias.

### Daily signs and bleeding

The device-local record distinguishes bleeding intensity (`none`, `spotting`,
`light`, `moderate`, `heavy`) from the separate `period_start` marker. Optional
daily signs include hot flashes/night sweats, headache/migraine, brain fog,
anxiety/irritability, vaginal dryness/discomfort, urinary changes, change in
sexual desire, and palpitations. These fields provide context and are not
inputs to the fixed NHANES classifier.

`hormone_medication` records one of: no current use, combined hormonal
contraceptive, progestin-only contraception or hormonal IUD, hormone
replacement therapy, fertility medication, or prefer not to say. It is
longitudinal context only and is included in the user-controlled clinician
report; it is not a model input.

### Data-quality methodology for self-report

Self-reported longitudinal data are not assumed to have the same reliability
profile as standardized laboratory measurements. At storage time, Elowen
attaches `data_confidence` (`typical_variation` or `flagged_for_review`) and a
machine-readable JSON `quality_flags` list. Current conservative rules flag,
but never reject:

- two reported period starts fewer than 20 days apart;
- a reported period start paired with `bleeding=none`;
- all five core scales recorded as exactly 5/5 for 14 consecutive days.

A short bleeding interval is not declared physiologically impossible. It can
reflect genuine frequent or irregular bleeding, spotting interpreted as a
period, or an entry error. The tag allows a future analyst to make that choice
explicitly. Flagged records remain available, and the UI does not accuse or
question the participant.

There is no seeded production demo cohort from which a meaningful flag
prevalence can be estimated. In the synthetic consistency test set, one
ordinary-variation case remains unflagged and three deliberately constructed
boundary cases trigger their intended rules (3 of 4 scenarios). That 75%
fixture rate validates rule activation and must not be interpreted as expected
real-world prevalence.

This applies the same transparency standard used for the lab-based NHANES
model: preserve provenance, state limitations, and keep a review flag distinct
from any claim that a participant is dishonest.

### Additional context and provider registry

Optional FSH, LH, estradiol, progesterone, prolactin, DHEA-S, TSH, free T4,
free T3, TPO antibodies, and cortisol are user-visible context and doctor-sheet
fields only. They are not model inputs and do not alter probabilities. Values
require method-specific laboratory ranges plus relevant timing and medication
context.

Inline OB-GYN and endocrinology results come from the public CMS NPPES NPI
Registry by ZIP code. Registry inclusion does not establish clinical quality,
suitability, insurance status, appointment availability, or acceptance of new
patients.

The interface includes a fictional, prominently labeled Dr. Sara P. demo card
solely to exercise provider selection, appointment-interest, and explicit
report-sharing consent. It has no NPI, address, availability, or booking claim.
The prototype does not transmit appointment requests and does not give a
clinician direct access to check-ins.

### Screening Insights provenance

Screening Insights is a deterministic, rule-based interface layer, not a
second machine-learning model. Its outputs are not stored as diagnoses, are not
fed into the classifier, and do not change the reported probability.

The PCOS card maps irregular-cycle self-report and hair/skin signs to two
observable pattern domains from the 2023 International Evidence-based PCOS
Guideline. Acne or hair responses alone are not treated as confirmed clinical
or biochemical hyperandrogenism. The endometriosis card requires 14 recorded
days, two period-start anchors, at least four observations within two days of a
period start, and mean pain of at least 4/5 in that window. This threshold is a
declared project rule informed by NICE symptom guidance and is not represented
as a validated endometriosis screening instrument.

The osteoporosis card uses age 65+, the nonclinical natural-menopause survey
label, BMI below 21, current smoking, and parental hip fracture as transparent
review factors. It does not reproduce or approximate a validated FRAX score.
The depression card uses the two PHQ-2 items and a follow-up threshold of 3;
the full PHQ-9 is intentionally out of scope because responsible handling of a
self-harm response would require crisis-response infrastructure.

One-time smoking, parental-fracture, and PHQ-2 answers are used for the current
result and doctor-preparation flow but are not written into the anonymous
symptom-research table in this version.
