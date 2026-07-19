# Model training

Research/awareness use only — **not a diagnosis** and not suitable for clinical
decision-making.

`train_multicycle.py` fits the expanded `XGBClassifier` using library defaults
except for fixed random seed `42`. It uses a stratified 70/15/15 split with no
resampling. `train.py` preserves the original single-cycle baseline.
The validation partition is preserved for reproducible evaluation but is not
used for tuning in this baseline phase.

Inputs are age (`RIDAGEYR`), BMI (`BMXBMI`), total testosterone (`LBXTST`), and
SHBG (`LBXSHBG`). Estradiol (`LBXEST`) is explicitly prohibited as a classifier
feature.

Run from the repository root:

```bash
python model/train.py
python model/train_multicycle.py
```

The script writes the model checkpoint, test metrics, split assignments, and
test predictions to `model/artifacts/` and its `multicycle/` subdirectory. The
expanded evaluation also reports cycle and survey-mode subgroups. Each
prediction row carries the required non-diagnostic disclaimer.
