# Explainability

Research/awareness use only — **not a diagnosis**.

`generate_shap.py` uses XGBoost's native exact TreeSHAP implementation to
explain the held-out test predictions. It creates a global mean-absolute-SHAP
plot, an example-level explanation, and a machine-readable report. SHAP values
are expressed in the classifier's raw log-odds space.

Age dominance is defined before inspection as at least 75% of total mean
absolute SHAP magnitude. When that threshold is met, the script trains a quick
no-age XGBoost baseline on the same saved train/test split; this is a sanity
check, not hyperparameter tuning.

`generate_multicycle_shap.py` applies the same methodology to the combined
cohort, adds per-cycle contribution checks, and writes its report and plots to
`explain/artifacts/multicycle/`.
