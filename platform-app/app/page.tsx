"use client";

import { FormEvent, useMemo, useState } from "react";
import LongitudinalTracker from "./LongitudinalTracker";
import ScreeningInsights from "./ScreeningInsights";

type Units = "metric" | "imperial";
type Factor = { feature: string; label: string; contribution: number };
type Inputs = {
  age: number;
  bmi: number;
  testosterone: number | null;
  shbg: number | null;
  symptoms: Record<string, FormDataEntryValue | null>;
  symptomDataConsent: boolean;
  additionalLabs: Record<string, number | null>;
};
type Prediction = {
  predictedClass: "recent_menstruation" | "self_reported_natural_menopause";
  probabilityNaturalMenopause: number;
  probabilityRecentMenstruation: number;
  bmi: number;
  inputBasis: "age_bmi_hormones" | "age_bmi_only" | "age_bmi_partial_hormones";
  modelVersion: string;
  explanation: { baseValue: number; margin: number; contributions: Factor[]; topFactors: Factor[]; additivityDifference: number };
  populationContext: { ageBand: string; referenceRows: number; percentiles: Record<string, number | null> };
  honestComparison: { fullModelAccuracy: number; hormonesOnlyAccuracy: number; majorityBaselineAccuracy: number; ageGlobalShare: number };
  missingDataAdvisor: { missingInputs: string[]; recommendation: string; simulations: Array<{ input: string; expectedProbabilityChange: number; simulatedProbabilityRange: [number, number]; simulations: number; currentClassConfidence: number; averageSimulatedClassConfidence: number }> };
  symptomContext: string;
  referralGuidance: { category: "reproductive" | "systemic" | "mixed" | "sparse"; guidance: string; why: string };
};
type Research = { status: "loading" | "ready" | "unavailable"; message: string; citations: Array<{ title: string; url: string }>; cached?: boolean };
type Provider = { npi: string; name: string; specialty: string; practice: string; address: string; phone: string | null; demo?: boolean };

const symptomOptions = {
  fatigue: ["Not noticeable", "Mild", "Moderate", "Strong"],
  weightChange: ["No recent change", "Lost weight", "Gained weight", "Unsure"],
  periodPattern: ["Regular", "Sometimes irregular", "Very irregular", "No recent periods"],
  periodPain: ["None", "Mild", "Moderate", "Severe"],
  pain: ["None", "Occasional", "Frequent", "Daily"],
  skinChanges: ["No change", "Mild", "Noticeable", "Strong"],
  hairChanges: ["No change", "Thinning", "Increased growth in new areas", "Both thinning and increased growth"],
  sleepQuality: ["Very good", "Good", "Fair", "Poor", "Very poor"],
};

const featureUnits: Record<string, string> = {
  age_years: "years",
  bmi: "",
  testosterone_ng_dl: "ng/dL",
  shbg_nmol_l: "nmol/L",
};
const additionalLabFields = [
  { key: "fsh", label: "FSH", unit: "IU/L", note: "Can add ovarian-function context, but fluctuates and is not a stand-alone menopause diagnosis." },
  { key: "lh", label: "LH", unit: "IU/L", note: "Usually interpreted with cycle timing and other findings; the LH:FSH ratio alone does not diagnose PCOS." },
  { key: "estradiol", label: "Estradiol", unit: "pg/mL", note: "Varies substantially across the menstrual cycle and with hormone therapy." },
  { key: "progesterone", label: "Progesterone", unit: "ng/mL", note: "Timing matters; clinicians may use it as context for recent ovulation." },
  { key: "prolactin", label: "Prolactin", unit: "ng/mL", note: "Often checked when evaluating absent or irregular periods." },
  { key: "dheas", label: "DHEA-S", unit: "µg/dL", note: "An adrenal androgen interpreted with symptoms, age, and laboratory ranges." },
  { key: "tsh", label: "TSH", unit: "mIU/L", note: "Thyroid dysfunction can overlap with menstrual and menopause-like symptoms." },
  { key: "freeT4", label: "Free T4", unit: "ng/dL", note: "Interpreted with TSH and the laboratory’s own reference interval." },
  { key: "freeT3", label: "Free T3", unit: "pg/mL", note: "Additional thyroid context; not routinely necessary in every evaluation." },
  { key: "tpoAntibodies", label: "TPO antibodies", unit: "IU/mL", note: "May provide autoimmune-thyroid context when clinically indicated." },
  { key: "cortisol", label: "Cortisol", unit: "µg/dL", note: "Strongly depends on collection time, medication, stress, and test method." },
] as const;

function FieldNote({ children }: { children: React.ReactNode }) { return <p className="field-note">{children}</p>; }
function formatPercent(value: number) { return `${(value * 100).toFixed(1)}%`; }

const biasQuestions = [
  "Does the study include the population it makes claims about?",
  "Does it measure women’s health outcomes directly, not only use sex as a checkbox?",
  "Are menstrual stage, cycle timing, pregnancy, contraception, and hormone therapy handled when relevant?",
  "Are results reported separately enough to detect differences by age, race or ethnicity, and other important groups?",
  "Does the analysis account for sampling, missing data, and loss to follow-up?",
  "Does it distinguish association from causation?",
  "Are limitations and potential harms for underrepresented groups stated clearly?",
];

function BiasChecklist() {
  const [checked, setChecked] = useState<number[]>([]);
  const score = checked.length;
  return <section className="landing-bias"><div><p className="eyebrow">Research bias check</p><h2>Does this study actually support women’s health?</h2><p>Use this quick checklist when reading a study, health claim, or AI result. A lower score does not prove misconduct. It signals questions worth asking before trusting the conclusion.</p></div><div className="bias-checklist">{biasQuestions.map((question, index) => <label key={question}><input type="checkbox" checked={checked.includes(index)} onChange={() => setChecked(current => current.includes(index) ? current.filter(item => item !== index) : [...current, index])} /><span>{question}</span></label>)}<div className="bias-score"><strong>{score} of {biasQuestions.length} safeguards visible</strong><p>{score >= 6 ? "Strong transparency signals. Still check whether the methods match the claim." : score >= 3 ? "Mixed support. Read the missing safeguards and limitations carefully." : "Important information is missing. Treat broad or clinical claims cautiously."}</p></div></div></section>;
}

const providerSpecialties = {
  obgyn: { label: "OB-GYN" },
  endocrine: { label: "endocrinologist" },
} as const;

function Donut({ probability, label }: { probability: number; label: string }) {
  const radius = 82;
  const circumference = 2 * Math.PI * radius;
  const natural = probability * circumference;
  return (
    <div className="donut-wrap" role="img" aria-label={`${label}. ${Math.round(probability * 100)} percent natural-menopause survey likelihood.`}>
      <svg viewBox="0 0 210 210" aria-hidden="true">
        <circle className="donut-bg" cx="105" cy="105" r={radius} />
        <circle className="donut-recent" cx="105" cy="105" r={radius} strokeDasharray={`${circumference - natural} ${circumference}`} />
        <circle className="donut-natural" cx="105" cy="105" r={radius} strokeDasharray={`${natural} ${circumference}`} strokeDashoffset={-(circumference - natural)} />
      </svg>
      <div className="donut-center"><strong>{Math.max(probability, 1 - probability) * 100 < 99.95 ? (Math.max(probability, 1 - probability) * 100).toFixed(1) : ">99.9"}%</strong><span>{label}</span></div>
    </div>
  );
}

function PercentileRow({ label, value, percentile, unit }: { label: string; value: number | null; percentile: number | null; unit: string }) {
  return (
    <div className="percentile-row">
      <div><strong>{label}</strong><span>{value === null ? "Not provided" : `${value.toFixed(label === "Age" ? 0 : 1)}${unit ? ` ${unit}` : ""}`}</span></div>
      {percentile === null ? <p>Not available without this value</p> : <><div className="percentile-track"><i style={{ width: `${Math.max(3, percentile)}%` }} /></div><p>{percentile}th percentile in this age band</p></>}
    </div>
  );
}

function Results({ prediction, inputs, research, onReset }: { prediction: Prediction; inputs: Inputs; research: Research; onReset: () => void }) {
  const [zip, setZip] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [shareConsent, setShareConsent] = useState(false);
  const [requestType, setRequestType] = useState<"follow_up" | "appointment" | null>(null);
  const natural = prediction.predictedClass === "self_reported_natural_menopause";
  const resultLabel = natural ? "Closer to natural menopause" : "Closer to recent menstruation";
  const confidenceClass = prediction.inputBasis === "age_bmi_hormones" ? "Full information" : prediction.inputBasis === "age_bmi_only" ? "Limited information" : "Partial information";
  const factors = prediction.explanation.topFactors.filter(item => {
    if (item.feature === "testosterone_ng_dl") return inputs.testosterone !== null;
    if (item.feature === "shbg_nmol_l") return inputs.shbg !== null;
    return true;
  });
  const maxContribution = Math.max(...factors.map(item => Math.abs(item.contribution)), .01);
  const providerKinds: Array<keyof typeof providerSpecialties> = prediction.referralGuidance.category === "reproductive"
    ? ["obgyn"] : prediction.referralGuidance.category === "systemic" ? ["endocrine"] : ["obgyn", "endocrine"];

  async function findProviders(kind: keyof typeof providerSpecialties) {
    if (!/^\d{5}$/.test(zip)) { setProviderMessage("Enter a five-digit ZIP code to search the national provider registry."); return; }
    setProviderLoading(true); setProviderMessage(""); setProviders([]);
    try {
      const response = await fetch(`/api/providers?specialty=${kind}&zip=${zip}`);
      const body = await response.json() as { providers?: Provider[] };
      setProviders(body.providers || []);
      if (!body.providers?.length) setProviderMessage("No matching registry records were found for this ZIP code. Try a nearby ZIP code.");
    } catch { setProviderMessage("Provider records are temporarily unavailable. Try again later."); }
    finally { setProviderLoading(false); }
  }

  async function downloadPrep() {
    const printWindow = window.open("", "elowen-visit-preparation", "width=820,height=900");
    const response = await fetch("/api/doctor-prep", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...inputs, predictedClass: prediction.predictedClass, probabilityNaturalMenopause: prediction.probabilityNaturalMenopause, topFactors: factors }),
    });
    if (!response.ok) { printWindow?.close(); return; }
    const data = await response.json() as { text: string };
    const escaped = data.text.replace(/[&<>]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] || character);
    if (printWindow) {
      printWindow.document.write(`<!doctype html><html><head><title>Elowen visit preparation</title><style>@page{size:letter;margin:.6in}body{font:14px/1.45 Arial;color:#493f3b;max-width:7.3in;margin:auto}pre{white-space:pre-wrap;font:inherit}button{position:fixed;right:18px;top:18px;padding:10px 16px;border:0;border-radius:8px;background:#d94b7a;color:white;font-weight:700}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print or save PDF</button><pre>${escaped}</pre></body></html>`);
      printWindow.document.close();
    }
  }

  return (
    <div className="results-page" id="results">
      <div className="always-disclaimer">Not a diagnosis. Use this result to start a conversation with a healthcare provider.</div>
      <section className="results-hero">
        <div className="result-copy">
          <p className="eyebrow">Your Elowen result</p>
          <h1>Your result,<br /><em>with honest context.</em></h1>
          <p className="lede">Your information looks more like the survey pattern labeled <strong>{natural ? "self-reported natural menopause" : "recent menstruation"}</strong>. This is not a clinical reproductive stage.</p>
          <span className={`information-badge ${prediction.inputBasis !== "age_bmi_hormones" ? "limited" : ""}`}>{confidenceClass}</span>
          <p className="basis-copy">{prediction.inputBasis === "age_bmi_only" ? "This result used age and BMI only. Missing blood-test values make the context less complete." : prediction.inputBasis === "age_bmi_partial_hormones" ? "This result used age, BMI, and one blood-test value. Missing information adds uncertainty." : "This result used age, BMI, testosterone, and SHBG."}</p>
          <button className="text-button" onClick={onReset}>Start over</button>
        </div>
        <div className="chart-card">
          <Donut probability={prediction.probabilityNaturalMenopause} label={resultLabel} />
          <div className="legend"><span><i className="recent-dot" />Recent menstruation {formatPercent(prediction.probabilityRecentMenstruation)}</span><span><i className="natural-dot" />Natural menopause {formatPercent(prediction.probabilityNaturalMenopause)}</span></div>
        </div>
      </section>

      <section className="context-section">
        <div className="section-title"><p className="eyebrow">Population context</p><h2>How your values compare</h2><p>Compared with {prediction.populationContext.referenceRows.toLocaleString()} people in the model’s training data who were age {prediction.populationContext.ageBand}.</p></div>
        <div className="percentile-card">
          <PercentileRow label="Age" value={inputs.age} percentile={prediction.populationContext.percentiles.age_years} unit={featureUnits.age_years} />
          <PercentileRow label="BMI" value={inputs.bmi} percentile={prediction.populationContext.percentiles.bmi} unit="" />
          <PercentileRow label="Testosterone" value={inputs.testosterone} percentile={prediction.populationContext.percentiles.testosterone_ng_dl} unit={featureUnits.testosterone_ng_dl} />
          <PercentileRow label="SHBG" value={inputs.shbg} percentile={prediction.populationContext.percentiles.shbg_nmol_l} unit={featureUnits.shbg_nmol_l} />
        </div>
      </section>

      <section className="honesty-section">
        <div className="elm-light" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="honesty-copy"><p className="eyebrow">Honesty as a feature</p><h2>What shaped this result</h2><p>Longer bars had more influence on this particular result. Direction shows whether a value moved the result toward the natural-menopause label or toward recent menstruation.</p></div>
        <div className="factor-card">
          {factors.map(item => <div className="factor-row" key={item.feature}><span>{item.label}</span><div><i className={item.contribution >= 0 ? "toward-natural" : "toward-recent"} style={{ width: `${Math.max(6, Math.abs(item.contribution) / maxContribution * 100)}%` }} /></div><small>{item.contribution >= 0 ? "Toward natural menopause" : "Toward recent menstruation"}</small></div>)}
        </div>
        <aside className="truth-card"><h3>The wider finding</h3><p>Across the held-out data, age accounted for <strong>{formatPercent(prediction.honestComparison.ageGlobalShare)}</strong> of overall influence.</p><dl><div><dt>Full information</dt><dd>{formatPercent(prediction.honestComparison.fullModelAccuracy)}</dd></div><div><dt>Without age</dt><dd>{formatPercent(prediction.honestComparison.hormonesOnlyAccuracy)}</dd></div><div><dt>Simple baseline</dt><dd>{formatPercent(prediction.honestComparison.majorityBaselineAccuracy)}</dd></div></dl><p className="small-copy">In this dataset, BMI and the two hormone measurements added little predictive value beyond age. That limitation is part of the result.</p></aside>
      </section>

      <section className="bias-section">
        <div className="section-title"><p className="eyebrow">Research bias check</p><h2>Useful evidence designed with important limits</h2><p>NHANES is a high-quality public-health survey. But a rigorous study can still be a poor fit for an individual diagnostic question. This audit separates strengths from limitations and explains who could be underserved.</p></div>
        <div className="bias-grid"><article className="bias-strength"><strong>What the design does well</strong><p>Standardized examinations, laboratory measurements, and a probability sample make NHANES valuable for population research when survey design and weights are handled correctly.</p></article><article><strong>Cross-sectional, not causal</strong><p>One-time measurements cannot establish what caused a symptom, hormone level, or menopause. Elowen therefore reports associations and survey-label similarity only.</p></article><article><strong>Coverage is incomplete</strong><p>NHANES represents the civilian, non-institutionalized U.S. population. People in institutions, active-duty military populations, and people outside that frame are not represented.</p></article><article><strong>Unequal subgroup precision</strong><p>The 2021–2023 design stopped oversampling by race, Hispanic origin, and income. NCHS warns that some subgroup estimates have lower precision and that combining this cycle with earlier data requires caution.</p></article><article><strong>The label rewards age</strong><p>The target is recent menstruation versus self-reported natural menopause, not a complete clinical stage. Because these labels are intrinsically age-linked, the model’s 96.8% age share can look impressive while adding little biological insight.</p></article><article><strong>Women’s-health detail is missing</strong><p>Cycle timing, longitudinal hormone change, medications, hysterectomy context, and many clinically used tests are absent or incomplete. That can flatten diverse experiences into an overly simple binary label.</p></article></div>
        <div className="bias-conclusion"><strong>Bottom line</strong><p>This design is appropriate for an explainable research demonstration, but not sufficient for diagnosis, causal claims, or equitable clinical decision-making. The limitation is not that participants’ experiences are unreliable; it is that the study was not built to capture the full biological and social complexity of women’s hormonal health.</p><div className="source-list"><strong>Primary sources</strong><a href="https://wwwn.cdc.gov/nchs/nhanes/tutorials/sampledesign.aspx" target="_blank" rel="noreferrer">CDC/NCHS: NHANES sample design and exclusions</a><a href="https://wwwn.cdc.gov/nchs/nhanes/continuousnhanes/overviewbrief.aspx?Cycle=2021-2023" target="_blank" rel="noreferrer">CDC/NCHS: 2021–2023 design and nonresponse guidance</a><a href="https://www.nationalacademies.org/publications/27757" target="_blank" rel="noreferrer">National Academies: gaps in research on chronic conditions in women</a><a href="https://www.nice.org.uk/guidance/QS143/chapter/Quality-statement-1-Diagnosing-perimenopause-and-menopause" target="_blank" rel="noreferrer">NICE: menopause diagnosis and limits of hormone testing</a></div></div>
      </section>

      <ScreeningInsights input={{ age: inputs.age, bmi: inputs.bmi, naturalLabel: natural, periodPattern: String(inputs.symptoms.periodPattern || ""), hairChanges: String(inputs.symptoms.hairChanges || ""), skinChanges: String(inputs.symptoms.skinChanges || ""), smoking: String(inputs.symptoms.smoking || ""), parentalHipFracture: String(inputs.symptoms.parentalHipFracture || ""), phqInterest: inputs.symptoms.phqInterest === null ? null : Number(inputs.symptoms.phqInterest), phqMood: inputs.symptoms.phqMood === null ? null : Number(inputs.symptoms.phqMood) }} />

      <section className="advisor-section">
        <div className="section-title"><p className="eyebrow">We need more data</p><h2>What another value could add</h2><p>These estimates use real values from people in the same training-data age band and rerun the saved model. They show possible movement, not a promised improvement.</p></div>
        <div className="advisor-grid">
          <div className="advisor-card">
            {prediction.missingDataAdvisor.missingInputs.length === 0 ? <><h3>You’ve provided everything this tool currently uses</h3><p>You provided age, height and weight, testosterone, and SHBG.</p></> : <>
              <h3>{prediction.missingDataAdvisor.recommendation}</h3>
              <p className="missing-list">Missing: {prediction.missingDataAdvisor.missingInputs.join(" and ")}</p>
              {prediction.missingDataAdvisor.simulations.map(item => <div className="simulation-row" key={item.input}><strong>{item.input}</strong><p>Across {item.simulations} simulations, adding this value changed the predicted probability by <b>{formatPercent(item.expectedProbabilityChange)}</b> on average. The simulated result ranged from {formatPercent(item.simulatedProbabilityRange[0])} to {formatPercent(item.simulatedProbabilityRange[1])} natural-menopause likelihood.</p></div>)}
            </>}
          </div>
          <div className="symptom-card"><h3>Your symptom context</h3><p>{prediction.symptomContext}</p></div>
        </div>
      </section>

      {Object.values(inputs.additionalLabs).some(value => value !== null) && <section className="additional-context-section"><div className="section-title"><p className="eyebrow">Additional clinical context</p><h2>Values to bring to your clinician</h2><p>These values were not inputs to Elowen’s trained model and did not change the probability above. They are included because a clinician may find them useful alongside symptoms, cycle timing, medications, and the reporting laboratory’s ranges.</p></div><div className="additional-lab-grid">{additionalLabFields.filter(field => inputs.additionalLabs[field.key] !== null).map(field => <article key={field.key}><strong>{field.label}</strong><b>{inputs.additionalLabs[field.key]} {field.unit}</b><p>{field.note}</p></article>)}</div></section>}

      <section className="referral-section">
        <div><span className="line-icon clinician-icon" aria-hidden="true" /><p className="eyebrow">What kind of doctor should I talk to?</p><h2>A reasonable place to start</h2><p className="referral-guidance">{prediction.referralGuidance.guidance}</p><p><strong>Why:</strong> {prediction.referralGuidance.why}</p>
          <div className="provider-finder"><label><span>ZIP code</span><input value={zip} onChange={event => setZip(event.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" autoComplete="postal-code" placeholder="e.g. 60601" aria-describedby="provider-finder-note" /></label><div className="provider-links">{providerKinds.map(kind => <button type="button" className="primary-button provider-link" key={kind} disabled={providerLoading} onClick={() => findProviders(kind)}>Find an {providerSpecialties[kind].label} near me</button>)}</div><p id="provider-finder-note">Results appear here from the public U.S. National Provider Identifier registry. Elowen sends only the ZIP code and specialty, not your result or symptom answers. Registry listing does not confirm appointment availability or acceptance of new patients.</p>{providerMessage && <p className="provider-message" role="status">{providerMessage}</p>}<div className="provider-results">{providers.map(provider => <article key={provider.npi}><div><strong>{provider.name}</strong><span>{provider.specialty}</span></div><p>{provider.practice}</p><p>{provider.address}</p>{provider.phone && <a href={`tel:${provider.phone}`}>{provider.phone}</a>}<small>NPI {provider.npi} · Verify insurance and availability directly</small><button type="button" className="secondary-button" onClick={() => { setSelectedProvider(provider); setShareConsent(false); setRequestType(null); }}>Select this provider</button></article>)}<article className="demo-provider"><div><strong>Dr. Sara P. <i>Demo clinician</i></strong><span>OB-GYN</span></div><p>Fictional demonstration profile. This is not a real provider or bookable listing.</p><button type="button" className="secondary-button" onClick={() => { setSelectedProvider({ npi: "demo", name: "Dr. Sara P.", specialty: "OB-GYN", practice: "Fictional demonstration profile", address: "No real practice address", phone: null, demo: true }); setShareConsent(false); setRequestType(null); }}>Try the consent flow</button></article></div>{selectedProvider && <div className="provider-selection"><p className="eyebrow">Selected {selectedProvider.demo ? "demo" : "provider"}</p><h3>{selectedProvider.name}</h3>{selectedProvider.demo && <p className="demo-warning">Demonstration only. Nothing will be sent to a clinic.</p>}<div className="request-choice"><button type="button" className={requestType === "follow_up" ? "selected" : ""} onClick={() => setRequestType("follow_up")}>Request follow-up</button><button type="button" className={requestType === "appointment" ? "selected" : ""} onClick={() => setRequestType("appointment")}>Request appointment</button></div><label className="share-consent"><input type="checkbox" checked={shareConsent} onChange={event => setShareConsent(event.target.checked)} /><span>I consent to include my daily check-ins in a report I choose to share with {selectedProvider.name}.</span></label><button type="button" className="primary-button" disabled={!requestType || !shareConsent} onClick={() => document.querySelector(".tracker-section")?.scrollIntoView({ behavior: "smooth" })}>Continue to my shareable report</button><small>Elowen does not transmit an appointment request or grant portal access. For real providers, contact the practice directly; you control whether the PDF is shared.</small></div>}</div>
        </div>
        <aside><strong>General guidance only</strong><p>This is not a diagnosis or a clinical triage recommendation. Elowen does not assess urgency.</p></aside>
      </section>

      <section className="research-section">
        <div className="section-title"><p className="eyebrow">Related research</p><h2>Recent context, with sources</h2><p>This is general research context, not personalized medical advice.</p></div>
        <div className="research-card" aria-live="polite">
          {research.status === "loading" ? <p className="research-loading">Looking for directly relevant, reputable sources…</p> : <>
            {research.message.split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            {research.citations.length > 0 && <div className="source-list"><strong>Sources</strong>{research.citations.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{index + 1}. {source.title}</a>)}</div>}
          </>}
        </div>
      </section>

      <section className="prep-section">
        <div><span className="line-icon page-icon" aria-hidden="true" /><p className="eyebrow">A better conversation</p><h2>Prepare for your visit</h2><p>Open a one-page summary of your inputs, this research result, the main factors, and safe questions to print or save as a PDF.</p></div>
        <button className="primary-button" onClick={downloadPrep}>Prepare for my doctor visit</button>
      </section>

      <LongitudinalTracker consent={inputs.symptomDataConsent} showHotFlashes={natural} predictionLabel={`Pattern closer to ${natural ? "the self-reported natural-menopause" : "the recent-menstruation"} survey label`} confidence={Math.max(prediction.probabilityNaturalMenopause, prediction.probabilityRecentMenstruation)} referralGuidance={prediction.referralGuidance.guidance} referralWhy={prediction.referralGuidance.why} />

      <footer><div className="wordmark">Elowen</div><p>{"Research and awareness only. Not a diagnosis."}</p><p>Built from public NHANES data with transparent limitations.</p></footer>
    </div>
  );
}

export default function Home() {
  const [units, setUnits] = useState<Units>("metric");
  const [heightCm, setHeightCm] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [weight, setWeight] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [lastInputs, setLastInputs] = useState<Inputs | null>(null);
  const [research, setResearch] = useState<Research>({ status: "loading", message: "", citations: [] });
  const [landingTab, setLandingTab] = useState<"start" | "research">("start");

  const bmi = useMemo(() => {
    const w = Number(weight);
    if (!w || w <= 0) return null;
    if (units === "metric") { const meters = Number(heightCm) / 100; return meters > 0 ? w / (meters * meters) : null; }
    const inches = Number(heightFt) * 12 + Number(heightIn);
    return inches > 0 ? (w / (inches * inches)) * 703 : null;
  }, [units, heightCm, heightFt, heightIn, weight]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!bmi || !Number.isFinite(bmi)) { setError("Please enter a valid height and weight."); return; }
    const data = new FormData(event.currentTarget);
    const inputs: Inputs = {
      age: Number(data.get("age")), bmi,
      testosterone: data.get("testosterone") ? Number(data.get("testosterone")) : null,
      shbg: data.get("shbg") ? Number(data.get("shbg")) : null,
      symptoms: { fatigue: data.get("fatigue"), weightChange: data.get("weightChange"), periodPattern: data.get("periodPattern"), periodPain: data.get("periodPain"), pain: data.get("pain"), skinChanges: data.get("skinChanges"), hairChanges: data.get("hairChanges"), sleepQuality: data.get("sleepQuality"), smoking: data.get("smoking"), parentalHipFracture: data.get("parentalHipFracture"), phqInterest: data.get("phqInterest") || null, phqMood: data.get("phqMood") || null },
      symptomDataConsent: data.get("symptomDataConsent") === "on",
      additionalLabs: Object.fromEntries(additionalLabFields.map(field => [field.key, data.get(field.key) ? Number(data.get(field.key)) : null])),
    };
    setLoading(true);
    try {
      const response = await fetch("/api/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inputs) });
      if (!response.ok) throw new Error("The result could not be calculated.");
      const result = await response.json() as Prediction;
      setPrediction(result); setLastInputs(inputs); setResearch({ status: "loading", message: "", citations: [] });
      window.setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 50);
      fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ predictedClass: result.predictedClass, topFactors: result.explanation.topFactors }) })
        .then(response => response.json()).then(value => setResearch(value)).catch(() => setResearch({ status: "unavailable", message: "We couldn't find directly relevant studies right now. No summary or citation has been generated.", citations: [] }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The result could not be calculated."); }
    finally { setLoading(false); }
  }

  if (prediction && lastInputs) return <Results prediction={prediction} inputs={lastInputs} research={research} onReset={() => { setPrediction(null); setLastInputs(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} />;

  return (
    <main>
      <header className="site-header" id="top"><a className="wordmark" href="#top" aria-label="Elowen home">Elowen</a><nav className="landing-tabs" role="tablist" aria-label="Elowen landing sections"><button type="button" role="tab" aria-selected={landingTab === "start"} className={landingTab === "start" ? "active" : ""} onClick={() => setLandingTab("start")}>Get started</button><button type="button" role="tab" aria-selected={landingTab === "research"} className={landingTab === "research" ? "active" : ""} onClick={() => setLandingTab("research")}>Research bias check</button></nav></header>
      {landingTab === "research" ? <BiasChecklist /> : <>
      <section className="flower-landing-hero" aria-labelledby="flower-hero-title">
        <img src="/flower-checkin-journey.png" alt="A pink flower growing through seven daily check-in stages" />
        <div className="flower-hero-action"><div><p className="eyebrow">Your daily pattern journey</p><h1 id="flower-hero-title">Every check-in helps your story bloom.</h1><p>Build a clearer record for yourself and for conversations with your doctor. Missing a day never erases your progress.</p></div><button type="button" className="primary-button" onClick={() => document.getElementById("intake-start")?.scrollIntoView({ behavior: "smooth" })}>Start with the basics</button></div>
      </section>
      <form className="intake" id="intake-start" onSubmit={submit}>
        <div className="form-heading"><div><p className="step-label">Step 1 of 2</p><h2>Start with the basics</h2></div><div className="unit-toggle" role="group" aria-label="Measurement units"><button type="button" className={units === "metric" ? "active" : ""} onClick={() => setUnits("metric")}>cm / kg</button><button type="button" className={units === "imperial" ? "active" : ""} onClick={() => setUnits("imperial")}>ft-in / lb</button></div></div>
        <div className="field-grid basics-grid"><label><span>Age</span><input name="age" type="number" min="12" max="150" required placeholder="e.g. 42" /><FieldNote>Age in years</FieldNote></label>{units === "metric" ? <label><span>Height</span><div className="input-suffix"><input value={heightCm} onChange={e => setHeightCm(e.target.value)} type="number" min="100" max="250" step="0.1" required placeholder="165" /><b>cm</b></div></label> : <label><span>Height</span><div className="height-pair"><div className="input-suffix"><input value={heightFt} onChange={e => setHeightFt(e.target.value)} type="number" min="3" max="8" required placeholder="5" /><b>ft</b></div><div className="input-suffix"><input value={heightIn} onChange={e => setHeightIn(e.target.value)} type="number" min="0" max="11.9" step="0.1" required placeholder="5" /><b>in</b></div></div></label>}<label><span>Weight</span><div className="input-suffix"><input value={weight} onChange={e => setWeight(e.target.value)} type="number" min="25" max={units === "metric" ? 350 : 770} step="0.1" required placeholder={units === "metric" ? "68" : "150"} /><b>{units === "metric" ? "kg" : "lb"}</b></div></label><div className="bmi-card" aria-live="polite"><span>Calculated BMI</span><strong>{bmi ? bmi.toFixed(1) : "."}</strong><small>Calculated from height and weight</small></div></div>
        <div className="section-divider" /><div className="subheading-row"><div><h2>Blood-test values</h2><p>Optional. You can continue without these.</p></div><span className="optional-pill">Optional</span></div><div className="field-grid hormone-grid"><label><span>Total testosterone</span><div className="input-suffix"><input name="testosterone" type="number" min="0" step="0.01" placeholder="Leave blank if unknown" /><b>ng/dL</b></div><FieldNote>Found on a standard hormone blood panel.</FieldNote></label><label><span>SHBG</span><div className="input-suffix"><input name="shbg" type="number" min="0" step="0.01" placeholder="Leave blank if unknown" /><b>nmol/L</b></div><FieldNote>Sex hormone-binding globulin, from a blood panel.</FieldNote></label></div><p className="missing-note">If one or both values are unavailable, Elowen will use the information you do have and clearly mark the result as more uncertain.</p>
        <details className="expanded-panel"><summary>Have more lab results? Add optional clinical context</summary><p>These values will appear in your doctor-preparation summary, but the current model was never trained on them and will not use them in its score.</p><div className="field-grid expanded-lab-grid">{additionalLabFields.map(field => <label key={field.key}><span>{field.label}</span><div className="input-suffix"><input name={field.key} type="number" min="0" step="any" placeholder="Leave blank" /><b>{field.unit}</b></div><FieldNote>{field.note}</FieldNote></label>)}</div></details>
        <div className="section-divider" /><div className="subheading-row"><div><h2>What have you noticed lately?</h2><p>Optional structured answers add context and referral guidance. They are never used to calculate the probability.</p></div><span className="optional-pill">Optional</span></div><div className="field-grid symptoms-grid"><label><span>Fatigue</span><select name="fatigue" defaultValue=""><option value="">Choose one</option>{symptomOptions.fatigue.map(x => <option key={x}>{x}</option>)}</select></label><label><span>Recent weight change</span><select name="weightChange" defaultValue=""><option value="">Choose one</option>{symptomOptions.weightChange.map(x => <option key={x}>{x}</option>)}</select></label><label><span>Period regularity</span><select name="periodPattern" defaultValue=""><option value="">Choose one</option>{symptomOptions.periodPattern.map(x => <option key={x}>{x}</option>)}</select></label><label><span>Period pain</span><select name="periodPain" defaultValue=""><option value="">Choose one</option>{symptomOptions.periodPain.map(x => <option key={x}>{x}</option>)}</select></label><label><span>Muscle or joint pain</span><select name="pain" defaultValue=""><option value="">Choose one</option>{symptomOptions.pain.map(x => <option key={x}>{x}</option>)}</select></label><label><span>Skin changes</span><select name="skinChanges" defaultValue=""><option value="">Choose one</option>{symptomOptions.skinChanges.map(x => <option key={x}>{x}</option>)}</select></label><label><span>Hair changes</span><select name="hairChanges" defaultValue=""><option value="">Choose one</option>{symptomOptions.hairChanges.map(x => <option key={x}>{x}</option>)}</select></label><label><span>Sleep quality</span><select name="sleepQuality" defaultValue=""><option value="">Choose one</option>{symptomOptions.sleepQuality.map(x => <option key={x}>{x}</option>)}</select></label></div>
        <div className="screening-profile"><div><p className="eyebrow">Optional screening context</p><h3>Two profile questions</h3></div><div className="field-grid hormone-grid"><label><span>Smoking status</span><select name="smoking" defaultValue=""><option value="">Prefer not to answer</option><option>Never smoked</option><option>Former smoker</option><option>Current smoker</option></select></label><label><span>Has a parent had a hip fracture?</span><select name="parentalHipFracture" defaultValue=""><option value="">Prefer not to answer</option><option>Yes</option><option>No</option><option>Unsure</option></select></label></div><div className="phq-block"><h3>Over the last 2 weeks, how often have you been bothered by:</h3><div className="field-grid hormone-grid"><label><span>Little interest or pleasure in doing things</span><select name="phqInterest" defaultValue=""><option value="">Prefer not to answer</option><option value="0">Not at all</option><option value="1">Several days</option><option value="2">More than half the days</option><option value="3">Nearly every day</option></select></label><label><span>Feeling down, depressed, or hopeless</span><select name="phqMood" defaultValue=""><option value="">Prefer not to answer</option><option value="0">Not at all</option><option value="1">Several days</option><option value="2">More than half the days</option><option value="3">Nearly every day</option></select></label></div><p>This is the PHQ-2 first-pass screener, not a diagnosis. Elowen intentionally does not ask the PHQ-9 self-harm question because this prototype is not equipped for crisis response.</p></div></div>
        <label className="consent-card"><input type="checkbox" name="symptomDataConsent" /><span><strong>Include my symptom answers in Elowen’s open research dataset</strong><small>This is optional and off by default. If you opt in, Elowen stores only your structured symptom choices with broad age and BMI bands. Never your name, raw measurements, hormone values, or result. The data may support future research. Leaving this off will not change or prevent your result.</small></span></label>
        {error && <p className="error-message" role="alert">{error}</p>}<div className="submit-row"><button className="primary-button" type="submit" disabled={loading}>{loading ? "Checking…" : "Check Me"}</button><p>By continuing, you understand that Elowen is a research and awareness tool, not a diagnosis.</p></div>
      </form>
      </>}
    </main>
  );
}
