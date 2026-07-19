/** Elowen Cloudflare Worker entry point. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import modelCheckpoint from "../../model/artifacts/multicycle/xgboost_multicycle_classifier.json";
import modelMetrics from "../../model/artifacts/multicycle/multicycle_metrics.json";
import shapReport from "../../explain/artifacts/multicycle/multicycle_shap_report.json";
import trainingDistributions from "../data/training-distributions.json";
import { assessCheckInConsistency, buildTrendCandidates, CheckInEntry } from "../app/checkin-utils";

type Tree = {
  default_left: number[];
  left_children: number[];
  right_children: number[];
  split_conditions: number[];
  split_indices: number[];
  sum_hessian: number[];
};

type Symptoms = {
  fatigue?: string | null;
  weightChange?: string | null;
  periodPattern?: string | null;
  periodPain?: string | null;
  pain?: string | null;
  skinChanges?: string | null;
  hairChanges?: string | null;
  sleepQuality?: string | null;
  smoking?: string | null;
  parentalHipFracture?: string | null;
  phqInterest?: string | number | null;
  phqMood?: string | number | null;
};

type PredictBody = {
  age?: number;
  bmi?: number;
  testosterone?: number | null;
  shbg?: number | null;
  symptoms?: Symptoms;
  symptomDataConsent?: boolean;
};

type ResultContext = PredictBody & {
  predictedClass?: string;
  probabilityNaturalMenopause?: number;
  topFactors?: Array<{ feature: string; label: string; contribution: number }>;
  additionalLabs?: Record<string, number | null>;
};

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const FEATURE_NAMES = ["age_years", "bmi", "testosterone_ng_dl", "shbg_nmol_l"] as const;
const FEATURE_LABELS: Record<string, string> = {
  age_years: "Age",
  bmi: "BMI",
  testosterone_ng_dl: "Testosterone",
  shbg_nmol_l: "SHBG",
};
const MODEL_VERSION = "xgboost-multicycle-dc0b590";
const DISCLAIMER = "Not a diagnosis . discuss health questions with a healthcare provider.";
const RESEARCH_FALLBACK = "We couldn't find directly relevant studies right now. No summary or citation has been generated.";

type ReferralGuidance = { category: "reproductive" | "systemic" | "mixed" | "sparse"; guidance: string; why: string };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function baseMargin(): number {
  const value = Number(JSON.parse(modelCheckpoint.learner.learner_model_param.base_score)[0]);
  return Math.log(value / (1 - value));
}

function treeValue(tree: Tree, values: Array<number | null>, known: Set<number>, node = 0): number {
  const left = tree.left_children[node];
  if (left === -1) return tree.split_conditions[node];
  const feature = tree.split_indices[node];
  const right = tree.right_children[node];
  if (known.has(feature)) {
    const value = values[feature];
    const missing = value === null || !Number.isFinite(value);
    const next = missing
      ? (tree.default_left[node] ? left : right)
      : (value < tree.split_conditions[node] ? left : right);
    return treeValue(tree, values, known, next);
  }
  const nodeCover = tree.sum_hessian[node];
  if (!nodeCover) return 0;
  return (tree.sum_hessian[left] / nodeCover) * treeValue(tree, values, known, left) +
    (tree.sum_hessian[right] / nodeCover) * treeValue(tree, values, known, right);
}

function expectedMargin(values: Array<number | null>, mask: number): number {
  const known = new Set<number>();
  for (let index = 0; index < FEATURE_NAMES.length; index += 1) {
    if (mask & (1 << index)) known.add(index);
  }
  let margin = baseMargin();
  const trees = modelCheckpoint.learner.gradient_booster.model.trees as Tree[];
  for (const tree of trees) margin += treeValue(tree, values, known);
  return margin;
}

function liveExplanation(values: Array<number | null>) {
  const featureCount = FEATURE_NAMES.length;
  const subsetValues = Array.from({ length: 1 << featureCount }, (_, mask) => expectedMargin(values, mask));
  const factorial = [1, 1, 2, 6, 24];
  const contributions = FEATURE_NAMES.map((feature, featureIndex) => {
    let contribution = 0;
    for (let mask = 0; mask < 1 << featureCount; mask += 1) {
      if (mask & (1 << featureIndex)) continue;
      const size = mask.toString(2).split("1").length - 1;
      const weight = factorial[size] * factorial[featureCount - size - 1] / factorial[featureCount];
      contribution += weight * (subsetValues[mask | (1 << featureIndex)] - subsetValues[mask]);
    }
    return { feature, label: FEATURE_LABELS[feature], contribution };
  });
  const margin = subsetValues[(1 << featureCount) - 1];
  return {
    baseValue: subsetValues[0],
    margin,
    contributions,
    topFactors: [...contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
    additivityDifference: Math.abs(subsetValues[0] + contributions.reduce((sum, item) => sum + item.contribution, 0) - margin),
  };
}

function percentile(sortedValues: number[], value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || !sortedValues.length) return null;
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedValues[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return Math.round((low / sortedValues.length) * 100);
}

function ageBand(age: number): "12–39" | "40–59" | "60+" {
  return age < 40 ? "12–39" : age < 60 ? "40–59" : "60+";
}

function bmiBand(bmi: number): string {
  if (bmi < 18.5) return "under_18_5";
  if (bmi < 25) return "18_5_to_24_9";
  if (bmi < 30) return "25_to_29_9";
  return "30_or_more";
}

function meaningful(value: string | null | undefined, quiet: string[]): boolean {
  return Boolean(value && !quiet.includes(value));
}

function symptomContext(symptoms?: Symptoms): string {
  if (!symptoms || !Object.values(symptoms).some(Boolean)) {
    return "You did not add symptom details. Symptoms do not change this probability score.";
  }
  const reported: string[] = [];
  if (meaningful(symptoms.fatigue, ["Not noticeable"])) reported.push(`${symptoms.fatigue?.toLowerCase()} fatigue`);
  if (meaningful(symptoms.periodPattern, ["Regular"])) reported.push(`${symptoms.periodPattern?.toLowerCase()} periods`);
  if (meaningful(symptoms.periodPain, ["None", "Mild"])) reported.push(`${symptoms.periodPain?.toLowerCase()} period pain`);
  if (meaningful(symptoms.weightChange, ["No recent change", "Unsure"])) reported.push(symptoms.weightChange?.toLowerCase() || "weight change");
  if (meaningful(symptoms.pain, ["None", "Occasional"])) reported.push(`${symptoms.pain?.toLowerCase()} muscle or joint pain`);
  if (meaningful(symptoms.skinChanges, ["No change", "Mild"])) reported.push(`${symptoms.skinChanges?.toLowerCase()} skin changes`);
  if (meaningful(symptoms.hairChanges, ["No change"])) reported.push(symptoms.hairChanges?.toLowerCase() || "hair changes");
  if (meaningful(symptoms.sleepQuality, ["Good", "Very good"])) reported.push(`${symptoms.sleepQuality?.toLowerCase()} sleep`);
  if (!reported.length) return "You did not report notable symptoms in these selections. Symptoms do not change this probability score.";
  return `You also reported ${reported.slice(0, -1).join(", ")}${reported.length > 1 ? " and " : ""}${reported.at(-1)}. These details add context and inform the guidance below, but the trained model does not use them to calculate your probability.`;
}

function referralGuidance(symptoms?: Symptoms): ReferralGuidance {
  const reproductive: string[] = [];
  const systemic: string[] = [];
  if (meaningful(symptoms?.periodPattern, ["Regular"])) reproductive.push("period regularity");
  if (meaningful(symptoms?.periodPain, ["None", "Mild"])) reproductive.push("period pain");
  if (meaningful(symptoms?.fatigue, ["Not noticeable", "Mild"])) systemic.push("fatigue");
  if (meaningful(symptoms?.weightChange, ["No recent change", "Unsure"])) systemic.push("weight change");
  if (meaningful(symptoms?.skinChanges, ["No change", "Mild"])) systemic.push("skin changes");
  if (meaningful(symptoms?.hairChanges, ["No change"])) systemic.push("hair changes");
  if (meaningful(symptoms?.sleepQuality, ["Good", "Very good"])) systemic.push("sleep quality");
  if (meaningful(symptoms?.pain, ["None", "Occasional"])) systemic.push("muscle or joint pain");
  if (!reproductive.length && !systemic.length) return {
    category: "sparse",
    guidance: "An OB-GYN or endocrinologist is a reasonable place to start for hormonal-health questions when symptom information is limited.",
    why: "There is not enough symptom information here to point toward one type of clinician.",
  };
  if (reproductive.length && systemic.length) return {
    category: "mixed",
    guidance: "Either an OB-GYN or an endocrinologist would be a reasonable first conversation. Some clinicians work across both areas and may be described as reproductive endocrinologists.",
    why: `You reported both cycle-focused concerns (${reproductive.join(" and ")}) and broader concerns (${systemic.join(" and ")}).`,
  };
  if (reproductive.length) return {
    category: "reproductive",
    guidance: "A good first conversation would likely be with a gynecologist or OB-GYN.",
    why: `This suggestion is based on the cycle-focused concerns you reported: ${reproductive.join(" and ")}.`,
  };
  return {
    category: "systemic",
    guidance: "An endocrinologist would likely be a relevant first conversation for these broader hormonal concerns.",
    why: `This suggestion is based on the broader concerns you reported: ${systemic.join(" and ")}.`,
  };
}

function modelProbability(values: Array<number | null>): number {
  return 1 / (1 + Math.exp(-expectedMargin(values, (1 << FEATURE_NAMES.length) - 1)));
}

function simulationSummary(values: Array<number | null>, featureIndex: 2 | 3, samples: number[]) {
  const current = modelProbability(values);
  const step = Math.max(1, Math.floor(samples.length / 80));
  const probabilities = samples.filter((_, index) => index % step === 0).slice(0, 80).map(sample => {
    const simulated = [...values]; simulated[featureIndex] = sample; return modelProbability(simulated);
  });
  const shifts = probabilities.map(value => Math.abs(value - current));
  const currentNatural = current >= 0.5;
  const currentClassConfidences = probabilities.map(value => currentNatural ? value : 1 - value);
  return {
    input: featureIndex === 2 ? "Testosterone" : "SHBG",
    expectedProbabilityChange: shifts.reduce((sum, value) => sum + value, 0) / Math.max(1, shifts.length),
    simulatedProbabilityRange: [Math.min(...probabilities), Math.max(...probabilities)],
    currentClassConfidence: Math.max(current, 1 - current),
    averageSimulatedClassConfidence: currentClassConfidences.reduce((sum, value) => sum + value, 0) / Math.max(1, currentClassConfidences.length),
    simulations: probabilities.length,
  };
}

function missingDataAdvisor(values: Array<number | null>, group: typeof trainingDistributions.groups["12–39"]) {
  const simulations = [];
  if (values[2] === null) simulations.push(simulationSummary(values, 2, group.testosterone_ng_dl));
  if (values[3] === null) simulations.push(simulationSummary(values, 3, group.shbg_nmol_l));
  const best = [...simulations].sort((a, b) =>
    (b.averageSimulatedClassConfidence - b.currentClassConfidence) -
    (a.averageSimulatedClassConfidence - a.currentClassConfidence))[0];
  const improvement = best ? best.averageSimulatedClassConfidence - best.currentClassConfidence : 0;
  return {
    missingInputs: simulations.map(item => item.input),
    simulations,
    recommendation: best ? (improvement > 0
      ? `Adding your ${best.input} value would sharpen this result the most. In same-age-band simulations, confidence in the current label moved from ${(best.currentClassConfidence * 100).toFixed(1)}% toward ${(best.averageSimulatedClassConfidence * 100).toFixed(1)}% on average.`
      : `Adding your ${best.input} value would add the most useful context, although the simulations did not predict a confidence increase. Confidence in the current label moved from ${(best.currentClassConfidence * 100).toFixed(1)}% toward ${(best.averageSimulatedClassConfidence * 100).toFixed(1)}% on average.`) : "You've provided everything this tool currently uses.",
  };
}

async function initializeDb(db?: D1Database): Promise<void> {
  if (!db) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS symptom_observations (
      id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, age_band TEXT NOT NULL,
      bmi_band TEXT NOT NULL, fatigue TEXT, weight_change TEXT, period_pattern TEXT,
      pain TEXT, skin_hair TEXT, model_version TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS research_cache (
      cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_checkins (
      id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, entry_date TEXT NOT NULL, created_at INTEGER NOT NULL,
      cycle_day INTEGER, mood INTEGER NOT NULL, energy INTEGER NOT NULL,
      bloating INTEGER NOT NULL, pain INTEGER NOT NULL, sleep INTEGER NOT NULL,
      period_start INTEGER NOT NULL, bleeding TEXT NOT NULL DEFAULT 'none', symptom_signs TEXT NOT NULL DEFAULT '[]', hormone_medication TEXT NOT NULL DEFAULT 'prefer_not_to_say', hot_flashes INTEGER, skin_changes INTEGER,
      hair_changes INTEGER, data_confidence TEXT NOT NULL DEFAULT 'typical_variation',
      quality_flags TEXT NOT NULL DEFAULT '[]', model_version TEXT NOT NULL
    )`),
  ]);
  for (const column of ["period_pain TEXT", "skin_changes TEXT", "hair_changes TEXT", "sleep_quality TEXT"]) {
    try { await db.prepare(`ALTER TABLE symptom_observations ADD COLUMN ${column}`).run(); } catch { /* already present */ }
  }
  for (const column of ["participant_id TEXT NOT NULL DEFAULT 'legacy_unknown'", "bleeding TEXT NOT NULL DEFAULT 'none'", "symptom_signs TEXT NOT NULL DEFAULT '[]'", "hormone_medication TEXT NOT NULL DEFAULT 'prefer_not_to_say'", "data_confidence TEXT NOT NULL DEFAULT 'typical_variation'", "quality_flags TEXT NOT NULL DEFAULT '[]'"]) {
    try { await db.prepare(`ALTER TABLE daily_checkins ADD COLUMN ${column}`).run(); } catch { /* already present */ }
  }
}

async function storeSymptoms(db: D1Database | undefined, age: number, bmi: number, symptoms?: Symptoms): Promise<boolean> {
  if (!db || !symptoms || !Object.values(symptoms).some(Boolean)) return false;
  await initializeDb(db);
  await db.prepare(`INSERT INTO symptom_observations
    (id, created_at, age_band, bmi_band, fatigue, weight_change, period_pattern, period_pain, pain, skin_changes, hair_changes, sleep_quality, model_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), Date.now(), ageBand(age), bmiBand(bmi), symptoms.fatigue || null,
      symptoms.weightChange || null, symptoms.periodPattern || null, symptoms.periodPain || null,
      symptoms.pain || null, symptoms.skinChanges || null, symptoms.hairChanges || null,
      symptoms.sleepQuality || null, MODEL_VERSION).run();
  return true;
}

function validScore(value: unknown, optional = false): boolean {
  return (optional && (value === null || value === undefined)) || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5);
}

function validCheckIn(entry: CheckInEntry): boolean {
  return typeof entry.id === "string" && entry.id.length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.createdAt) &&
    [entry.mood, entry.energy, entry.bloating, entry.pain, entry.sleep].every(value => validScore(value)) &&
    validScore(entry.hotFlashes, true) && validScore(entry.skinChanges, true) && validScore(entry.hairChanges, true) &&
    (entry.bleeding === undefined || ["none", "spotting", "light", "moderate", "heavy"].includes(entry.bleeding)) &&
    (entry.symptomSigns === undefined || Array.isArray(entry.symptomSigns) && entry.symptomSigns.length <= 12 && entry.symptomSigns.every(item => typeof item === "string" && item.length <= 80)) &&
    (entry.hormoneMedication === undefined || ["none", "combined_contraceptive", "progestin_or_iud", "hrt", "fertility_medication", "prefer_not_to_say"].includes(entry.hormoneMedication)) &&
    (entry.cycleDay === null || Number.isInteger(entry.cycleDay) && entry.cycleDay >= 0 && entry.cycleDay <= 500);
}

async function checkInResponse(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { entry?: CheckInEntry; participantId?: string; researchConsent?: boolean };
    if (body.researchConsent !== true) return json({ error: "Research consent is required for remote storage." }, 403);
    if (typeof body.participantId !== "string" || body.participantId.length < 20 || body.participantId.length > 80) return json({ error: "The anonymous participant identifier was not valid." }, 400);
    const entry = body.entry as CheckInEntry;
    if (!validCheckIn(entry)) return json({ error: "The daily check-in was not valid." }, 400);
    if (!env.DB) return json({ stored: false, reason: "Research storage is unavailable." });
    await initializeDb(env.DB);
    const priorRows = await env.DB.prepare(`SELECT id, entry_date, created_at, cycle_day, mood, energy, bloating, pain, sleep, period_start, bleeding, symptom_signs, hormone_medication, hot_flashes, skin_changes, hair_changes
      FROM daily_checkins WHERE participant_id = ? AND entry_date < ? ORDER BY entry_date DESC LIMIT 40`).bind(body.participantId, entry.date).all<Record<string, unknown>>();
    const previous = (priorRows.results || []).map(row => ({
      id: String(row.id), date: String(row.entry_date), createdAt: Number(row.created_at), cycleDay: row.cycle_day === null ? null : Number(row.cycle_day),
      mood: Number(row.mood), energy: Number(row.energy), bloating: Number(row.bloating), pain: Number(row.pain), sleep: Number(row.sleep),
      periodStart: Boolean(row.period_start), hotFlashes: row.hot_flashes === null ? null : Number(row.hot_flashes),
      bleeding: String(row.bleeding || "none") as CheckInEntry["bleeding"], symptomSigns: JSON.parse(String(row.symptom_signs || "[]")) as string[],
      hormoneMedication: String(row.hormone_medication || "prefer_not_to_say") as CheckInEntry["hormoneMedication"],
      skinChanges: row.skin_changes === null ? null : Number(row.skin_changes), hairChanges: row.hair_changes === null ? null : Number(row.hair_changes),
    } satisfies CheckInEntry));
    const consistency = assessCheckInConsistency(previous, entry);
    await env.DB.prepare(`INSERT OR REPLACE INTO daily_checkins
      (id, participant_id, entry_date, created_at, cycle_day, mood, energy, bloating, pain, sleep, period_start, bleeding, symptom_signs, hormone_medication, hot_flashes, skin_changes, hair_changes, data_confidence, quality_flags, model_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(entry.id, body.participantId, entry.date, entry.createdAt, entry.cycleDay, entry.mood, entry.energy, entry.bloating, entry.pain, entry.sleep,
        entry.periodStart ? 1 : 0, entry.bleeding || "none", JSON.stringify(entry.symptomSigns || []), entry.hormoneMedication || "prefer_not_to_say", entry.hotFlashes ?? null, entry.skinChanges ?? null, entry.hairChanges ?? null,
        consistency.dataConfidence, JSON.stringify(consistency.qualityFlags), MODEL_VERSION).run();
    return json({ stored: true, dataConfidence: consistency.dataConfidence });
  } catch { return json({ error: "The daily check-in was not valid." }, 400); }
}

async function predictionResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json() as PredictBody;
    const age = Number(body.age);
    const bmi = Number(body.bmi);
    const testosterone = body.testosterone === null || body.testosterone === undefined ? null : Number(body.testosterone);
    const shbg = body.shbg === null || body.shbg === undefined ? null : Number(body.shbg);
    if (!Number.isFinite(age) || age < 12 || age > 150 || !Number.isFinite(bmi) || bmi <= 0 || bmi > 150) {
      return json({ error: "Valid age, height, and weight are required." }, 400);
    }
    if ((testosterone !== null && (!Number.isFinite(testosterone) || testosterone < 0)) ||
        (shbg !== null && (!Number.isFinite(shbg) || shbg < 0))) {
      return json({ error: "Hormone values must be positive numbers when provided." }, 400);
    }

    const values = [age, bmi, testosterone, shbg];
    const explanation = liveExplanation(values);
    const probabilityNaturalMenopause = 1 / (1 + Math.exp(-explanation.margin));
    const suppliedHormones = Number(testosterone !== null) + Number(shbg !== null);
    const band = ageBand(age);
    const group = trainingDistributions.groups[band];
    if (body.symptomDataConsent === true) {
      const storagePromise = storeSymptoms(env.DB, age, bmi, body.symptoms).catch(() => false);
      ctx.waitUntil(storagePromise);
    }

    return json({
      predictedClass: probabilityNaturalMenopause >= 0.5 ? "self_reported_natural_menopause" : "recent_menstruation",
      probabilityNaturalMenopause,
      probabilityRecentMenstruation: 1 - probabilityNaturalMenopause,
      bmi,
      inputBasis: suppliedHormones === 2 ? "age_bmi_hormones" : suppliedHormones === 0 ? "age_bmi_only" : "age_bmi_partial_hormones",
      modelVersion: MODEL_VERSION,
      disclaimer: DISCLAIMER,
      explanation,
      populationContext: {
        ageBand: band,
        referenceRows: group.age_years.length,
        percentiles: {
          age_years: percentile(group.age_years, age),
          bmi: percentile(group.bmi, bmi),
          testosterone_ng_dl: percentile(group.testosterone_ng_dl, testosterone),
          shbg_nmol_l: percentile(group.shbg_nmol_l, shbg),
        },
      },
      missingDataAdvisor: missingDataAdvisor(values, group),
      symptomContext: symptomContext(body.symptoms),
      referralGuidance: referralGuidance(body.symptoms),
      honestComparison: {
        fullModelAccuracy: modelMetrics.test_metrics.accuracy,
        hormonesOnlyAccuracy: shapReport.no_age_ablation.test_accuracy,
        majorityBaselineAccuracy: shapReport.no_age_ablation.majority_class_baseline_accuracy,
        ageGlobalShare: shapReport.age_share,
      },
    });
  } catch {
    return json({ error: "The prediction request was not valid." }, 400);
  }
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

type OpenAIResponse = { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; url?: string; title?: string; url_citation?: { url?: string; title?: string } }> }> }> };

function collectOpenAIText(response: OpenAIResponse): { text: string; citations: Array<{ title: string; url: string }> } {
  const textParts: string[] = [];
  const citations = new Map<string, { title: string; url: string }>();
  for (const item of response?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type !== "output_text" || typeof content.text !== "string") continue;
      textParts.push(content.text.trim());
      for (const annotation of content.annotations || []) {
        const citation = annotation.type === "url_citation" ? annotation : annotation.url_citation;
        if (citation?.url && /^https:\/\//.test(citation.url)) {
          citations.set(citation.url, { title: citation.title || new URL(citation.url).hostname, url: citation.url });
        }
      }
    }
  }
  return { text: textParts.filter(Boolean).join("\n\n"), citations: [...citations.values()] };
}

async function callOpenAI(env: Env, input: string, webSearch: boolean, instructions?: string): Promise<OpenAIResponse> {
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI API key is not configured");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5-mini",
      ...(instructions ? { instructions } : {}),
      input,
      ...(webSearch ? { tools: [{ type: "web_search" }], tool_choice: "auto" } : {}),
      max_output_tokens: 900,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
  return response.json() as Promise<OpenAIResponse>;
}

async function researchResponse(request: Request, env: Env): Promise<Response> {
  try {
    const context = await request.json() as ResultContext;
    const prediction = context.predictedClass === "self_reported_natural_menopause"
      ? "self-reported natural menopause survey pattern" : "recent-menstruation survey pattern";
    const allowed = new Set(Object.keys(FEATURE_LABELS));
    const factors = (context.topFactors || []).filter(item => allowed.has(item.feature)).slice(0, 2).map(item => FEATURE_LABELS[item.feature]);
    const query = `${prediction}; research context for ${factors.join(" and ") || "age and hormone measurements"}`;
    const cacheKey = await sha256(query);
    await initializeDb(env.DB);
    if (env.DB) {
      const cached = await env.DB.prepare("SELECT payload FROM research_cache WHERE cache_key = ? AND expires_at > ?")
        .bind(cacheKey, Date.now()).first<{ payload: string }>();
      if (cached?.payload) return json({ ...JSON.parse(cached.payload), cached: true });
    }

    const prompt = `You are Elowen's research-context writer. Search for recent peer-reviewed studies or reputable public-health sources relevant to: ${query}. Write 2–4 short plain-language sentences. Every factual sentence must be supported by the web-search citations returned with your response. Never diagnose, recommend treatment, or imply the model result is medically confirmed. Use general association language, explicitly say evidence may not apply to an individual, and end by encouraging discussion with a healthcare provider. If directly relevant credible sources are not found, return exactly: ${RESEARCH_FALLBACK}`;
    const parsed = collectOpenAIText(await callOpenAI(env, prompt, true));
    if (!parsed.text || parsed.text === RESEARCH_FALLBACK || parsed.citations.length === 0) {
      return json({ status: "unavailable", message: RESEARCH_FALLBACK, citations: [] });
    }
    const payload = { status: "ready", message: parsed.text, citations: parsed.citations, query };
    if (env.DB) {
      await env.DB.prepare("INSERT OR REPLACE INTO research_cache (cache_key, payload, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind(cacheKey, JSON.stringify(payload), Date.now(), Date.now() + 24 * 60 * 60 * 1000).run();
    }
    return json(payload);
  } catch {
    return json({ status: "unavailable", message: RESEARCH_FALLBACK, citations: [] });
  }
}

function safeDoctorTemplate(context: ResultContext): string {
  const label = context.predictedClass === "self_reported_natural_menopause"
    ? "Pattern closer to the self-reported natural-menopause survey label"
    : "Pattern closer to the recent-menstruation survey label";
  const top = (context.topFactors || []).slice(0, 2).map(item => item.label).join(", ") || "Age and BMI";
  const referral = referralGuidance(context.symptoms);
  const confidence = typeof context.probabilityNaturalMenopause === "number"
    ? `${(Math.max(context.probabilityNaturalMenopause, 1 - context.probabilityNaturalMenopause) * 100).toFixed(1)}%`
    : "Not provided";
  const labLabels: Record<string, string> = { fsh: "FSH", lh: "LH", estradiol: "Estradiol", progesterone: "Progesterone", prolactin: "Prolactin", dheas: "DHEA-S", tsh: "TSH", freeT4: "Free T4", freeT3: "Free T3", tpoAntibodies: "TPO antibodies", cortisol: "Cortisol" };
  const additional = Object.entries(context.additionalLabs || {}).filter(([, value]) => value !== null && Number.isFinite(value)).map(([key, value]) => `${labLabels[key] || key}: ${value}`).join("\n") || "None provided";
  const phqAnswered = context.symptoms?.phqInterest !== null && context.symptoms?.phqInterest !== undefined && context.symptoms?.phqMood !== null && context.symptoms?.phqMood !== undefined;
  const phqFollowUp = phqAnswered && Number(context.symptoms?.phqInterest) + Number(context.symptoms?.phqMood) >= 3;
  const screeningContext = `Smoking: ${context.symptoms?.smoking || "Not provided"}\nParental hip fracture: ${context.symptoms?.parentalHipFracture || "Not provided"}\nPHQ-2 follow-up threshold: ${phqAnswered ? (phqFollowUp ? "Met . worth discussing" : "Not met") : "Not completed"}`;
  return `ELOWEN . VISIT PREPARATION\n\nResearch result\n${label}\nConfidence in that survey label: ${confidence}\n\nInformation entered\nAge: ${context.age ?? "Not provided"}\nBMI: ${typeof context.bmi === "number" ? context.bmi.toFixed(1) : "Not provided"}\nTestosterone: ${context.testosterone ?? "Not provided"}\nSHBG: ${context.shbg ?? "Not provided"}\n\nAdditional lab context . not used by the model\n${additional}\nInterpret with collection timing, medications, symptoms, and the reporting laboratory's ranges.\n\nRule-based screening context . separate from the model\n${screeningContext}\nThese are conversation prompts, not diagnoses.\n\nSymptom context\n${symptomContext(context.symptoms)}\n\nA reasonable place to start\n${referral.guidance}\nWhy: ${referral.why}\nThis is general guidance, not diagnosis or triage.\n\nMain factors in this result\n${top}\n\nQuestions you might ask\n1. Could we review my symptoms and menstrual history together?\n2. Are there other measurements or history that would help put these results in context?\n3. What changes should prompt me to schedule follow-up care?\n4. How should I keep track of symptoms before my next visit?\n\n${DISCLAIMER}\nThis research result does not identify a condition or recommend treatment.`;
}

async function doctorPrepResponse(request: Request, env: Env): Promise<Response> {
  try {
    const context = await request.json() as ResultContext;
    const base = safeDoctorTemplate(context);
    if (!env.OPENAI_API_KEY) return json({ text: base, generatedBy: "reviewed_safe_template" });
    const instructions = `You write one-page doctor-visit preparation summaries for Elowen. Never diagnose, triage, recommend treatment, name a likely condition, or overstate a research model. Preserve all supplied values and referral language exactly. Include only 3–4 generic questions for a healthcare provider. End with the exact disclaimer: ${DISCLAIMER}`;
    const parsed = collectOpenAIText(await callOpenAI(env, `Rewrite this reviewed structured draft in calm plain language while keeping it to one printed page:\n\n${base}`, false, instructions));
    return json({ text: parsed.text || base, generatedBy: parsed.text ? "openai" : "reviewed_safe_template" });
  } catch {
    return json({ error: "The visit summary could not be prepared right now." }, 503);
  }
}

async function trendSummaryResponse(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { entries?: CheckInEntry[] };
    const entries = Array.isArray(body.entries) ? body.entries.filter(validCheckIn).slice(-31) : [];
    const evidence = buildTrendCandidates(entries);
    if (!evidence.sufficient || !env.OPENAI_API_KEY || evidence.candidates.length === 1) return json({ summary: evidence.summary, evidenceIds: evidence.candidates.slice(0, 2).map(item => item.id), generatedFromEntries: entries.length });
    const allowed = evidence.candidates.map(item => `${item.id}: ${item.text}`).join("\n");
    const instructions = "Select up to two evidence statements that best summarize the supplied daily check-in data. Return only their exact IDs separated by commas. Do not add medical interpretation, causes, diagnoses, or any other text.";
    const parsed = collectOpenAIText(await callOpenAI(env, `Allowed evidence statements:\n${allowed}`, false, instructions));
    const selectedIds = parsed.text.split(/[,\s]+/).filter(id => evidence.candidates.some(item => item.id === id)).slice(0, 2);
    const selected = selectedIds.map(id => evidence.candidates.find(item => item.id === id)!.text);
    return json({ summary: selected.length ? selected.join(" ") : evidence.summary, evidenceIds: selectedIds, generatedFromEntries: entries.length });
  } catch { return json({ summary: "Not enough data yet for a reliable trend . check in a few more days for a fuller picture.", evidenceIds: [], generatedFromEntries: 0 }); }
}

type NpiResult = { number?: number; basic?: Record<string, string>; addresses?: Array<Record<string, string>>; taxonomies?: Array<{ desc?: string; primary?: boolean }> };

async function providerSearchResponse(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const zip = url.searchParams.get("zip") || "";
  const specialty = url.searchParams.get("specialty");
  if (!/^\d{5}$/.test(zip) || !["obgyn", "endocrine"].includes(specialty || "")) return json({ error: "A valid ZIP code and specialty are required." }, 400);
  const taxonomy = specialty === "obgyn" ? "Obstetrics & Gynecology" : "Endocrinology, Diabetes & Metabolism";
  try {
    async function search(postalCode: string, limit: string) {
      const params = new URLSearchParams({ version: "2.1", enumeration_type: "NPI-1", taxonomy_description: taxonomy, postal_code: postalCode, country_code: "US", limit });
      const response = await fetch(`https://npiregistry.cms.hhs.gov/api/?${params.toString()}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("registry unavailable");
      return response.json() as Promise<{ results?: NpiResult[] }>;
    }
    let payload = await search(zip, "50");
    let matchPrefix = zip;
    let matching = (payload.results || []).filter(result => result.addresses?.some(item => item.address_purpose === "LOCATION" && item.postal_code?.startsWith(matchPrefix)));
    if (!matching.length) {
      matchPrefix = zip.slice(0, 3);
      payload = await search(`${matchPrefix}*`, "100");
      matching = (payload.results || []).filter(result => result.addresses?.some(item => item.address_purpose === "LOCATION" && item.postal_code?.startsWith(matchPrefix)));
    }
    const providers = matching.slice(0, 5).map(result => {
      const basic = result.basic || {};
      const address = result.addresses?.find(item => item.address_purpose === "LOCATION" && item.postal_code?.startsWith(matchPrefix)) || {};
      const name = [basic.first_name, basic.middle_name, basic.last_name, basic.credential].filter(Boolean).join(" ");
      return {
        npi: String(result.number || ""), name: name || "Provider name unavailable",
        specialty: result.taxonomies?.find(item => item.primary)?.desc || result.taxonomies?.[0]?.desc || taxonomy,
        practice: basic.organization_name || "Independent or practice name not listed",
        address: [address.address_1, address.address_2, address.city, address.state, address.postal_code?.slice(0, 5)].filter(Boolean).join(", "),
        phone: address.telephone_number || null,
      };
    });
    return json({ providers, source: "CMS NPPES NPI Registry", availabilityKnown: false, searchRadius: matchPrefix === zip ? "exact_zip" : "nearby_zip_prefix" });
  } catch { return json({ providers: [], source: "CMS NPPES NPI Registry", availabilityKnown: false }, 503); }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/predict" && request.method === "POST") return predictionResponse(request, env, ctx);
    if (url.pathname === "/api/research" && request.method === "POST") return researchResponse(request, env);
    if (url.pathname === "/api/doctor-prep" && request.method === "POST") return doctorPrepResponse(request, env);
    if (url.pathname === "/api/checkins" && request.method === "POST") return checkInResponse(request, env);
    if (url.pathname === "/api/trend-summary" && request.method === "POST") return trendSummaryResponse(request, env);
    if (url.pathname === "/api/providers" && request.method === "GET") return providerSearchResponse(request);
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
