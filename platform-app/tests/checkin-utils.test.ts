import assert from "node:assert/strict";
import test from "node:test";
import { assessCheckInConsistency, buildTrendCandidates, calculateCycleDay, CheckInEntry, consecutiveCheckInDays, selectWindow } from "../app/checkin-utils";
import { buildScreeningInsights } from "../app/screening-utils";

function entry(date: string, values: Partial<CheckInEntry> = {}): CheckInEntry {
  return { id: `entry-${date}`, date, createdAt: Date.parse(date), cycleDay: null, mood: 4, energy: 4, bloating: 2, pain: 2, sleep: 4, periodStart: false, ...values };
}

test("cycle day is days since the most recent reported period start", () => {
  const entries = [entry("2026-07-01", { periodStart: true }), entry("2026-07-29", { periodStart: true })];
  assert.equal(calculateCycleDay([], "2026-07-01", true), 0);
  assert.equal(calculateCycleDay(entries, "2026-07-04"), 3);
  assert.equal(calculateCycleDay(entries, "2026-07-30"), 1);
  assert.equal(calculateCycleDay([], "2026-07-04"), null);
});

test("trend summary is insufficient below seven actual check-ins", () => {
  const result = buildTrendCandidates([entry("2026-07-01"), entry("2026-07-02")]);
  assert.equal(result.sufficient, false);
  assert.match(result.summary, /Not enough data yet/);
  assert.deepEqual(result.candidates, []);
});

test("trend evidence contains only values computed from supplied entries", () => {
  const entries = [
    entry("2026-07-01", { mood: 2, pain: 4 }), entry("2026-07-02", { mood: 2, pain: 4 }),
    entry("2026-07-03", { mood: 2, pain: 4 }), entry("2026-07-04", { mood: 2, pain: 4 }),
    entry("2026-07-05", { mood: 2, pain: 4 }), entry("2026-07-06", { mood: 2, pain: 4 }),
    entry("2026-07-07", { mood: 2, pain: 4 }), entry("2026-07-08", { periodStart: true, mood: 4, pain: 1 }),
    entry("2026-07-09", { mood: 4, pain: 1 }), entry("2026-07-10", { mood: 4, pain: 1 }),
  ];
  const result = buildTrendCandidates(entries);
  assert.equal(result.sufficient, true);
  assert.ok(result.candidates.some(candidate => candidate.id === "pre_mood" && candidate.text.includes("2.0/5")));
  assert.ok(result.candidates.some(candidate => candidate.id === "pre_pain" && candidate.text.includes("4.0/5")));
  assert.doesNotMatch(result.summary, /diagnos|cause|menopause/i);
});

test("report window uses only actual dates in the requested range", () => {
  const entries = [entry("2026-06-01"), entry("2026-07-05"), entry("2026-07-18")];
  assert.deepEqual(selectWindow(entries, 14, "2026-07-18").map(item => item.date), ["2026-07-05", "2026-07-18"]);
});

test("streak counts consecutive check-ins without penalizing today before entry", () => {
  assert.equal(consecutiveCheckInDays([entry("2026-07-15"), entry("2026-07-16"), entry("2026-07-17")], "2026-07-18"), 3);
  assert.equal(consecutiveCheckInDays([entry("2026-07-15"), entry("2026-07-17")], "2026-07-18"), 1);
});

test("ordinary day-to-day variation remains typical", () => {
  const prior = [entry("2026-07-01", { periodStart: true }), entry("2026-07-02", { mood: 3, pain: 1 }), entry("2026-07-03", { mood: 5, pain: 3 })];
  const result = assessCheckInConsistency(prior, entry("2026-07-04", { mood: 2, energy: 3, bloating: 4, pain: 2, sleep: 3 }));
  assert.deepEqual(result, { dataConfidence: "typical_variation", qualityFlags: [] });
});

test("period starts fewer than 20 days apart are retained and flagged", () => {
  const result = assessCheckInConsistency([entry("2026-07-01", { periodStart: true, bleeding: "moderate" })], entry("2026-07-15", { periodStart: true, bleeding: "light" }));
  assert.equal(result.dataConfidence, "flagged_for_review");
  assert.deepEqual(result.qualityFlags, ["period_starts_under_20_days_apart"]);
});

test("period start with no bleeding is retained and flagged", () => {
  const result = assessCheckInConsistency([], entry("2026-07-15", { periodStart: true, bleeding: "none" }));
  assert.deepEqual(result.qualityFlags, ["period_start_with_no_bleeding"]);
});

test("fourteen consecutive all-5 entries are retained and flagged", () => {
  const extreme = { mood: 5, energy: 5, bloating: 5, pain: 5, sleep: 5 };
  const prior = Array.from({ length: 13 }, (_, index) => entry(`2026-07-${String(index + 1).padStart(2, "0")}`, extreme));
  const result = assessCheckInConsistency(prior, entry("2026-07-14", extreme));
  assert.equal(result.dataConfidence, "flagged_for_review");
  assert.deepEqual(result.qualityFlags, ["identical_all_5_extremes_for_14_consecutive_days"]);
});

test("PCOS insight requires both irregular cycles and observable androgen-related signs", () => {
  const result = buildScreeningInsights({ age: 31, bmi: 25, naturalLabel: false, periodPattern: "Very irregular", hairChanges: "Increased growth in new areas" }, []);
  assert.equal(result.pcos.flag, true);
  assert.deepEqual(result.pcos.matched, [true, true]);
});

test("endometriosis pain insight cannot activate without longitudinal history", () => {
  const sparse = buildScreeningInsights({ age: 31, bmi: 25, naturalLabel: false }, [entry("2026-07-01", { pain: 5, periodStart: true })]);
  assert.equal(sparse.endometriosis.enoughData, false);
  assert.equal(sparse.endometriosis.flag, false);
  const history = Array.from({ length: 14 }, (_, index) => entry(`2026-07-${String(index + 1).padStart(2, "0")}`, { pain: 4, periodStart: index === 0 || index === 13 }));
  const sustained = buildScreeningInsights({ age: 31, bmi: 25, naturalLabel: false }, history);
  assert.equal(sustained.endometriosis.flag, true);
});

test("osteoporosis and PHQ-2 rules use explicit published review thresholds", () => {
  const result = buildScreeningInsights({ age: 66, bmi: 20, naturalLabel: true, smoking: "Current smoker", parentalHipFracture: "Yes", phqInterest: 1, phqMood: 2 }, []);
  assert.equal(result.osteoporosis.flag, true);
  assert.equal(result.depression.flag, true);
});
