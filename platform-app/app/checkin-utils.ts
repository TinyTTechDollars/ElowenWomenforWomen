export type CheckInEntry = {
  id: string;
  date: string;
  createdAt: number;
  cycleDay: number | null;
  mood: number;
  energy: number;
  bloating: number;
  pain: number;
  sleep: number;
  periodStart: boolean;
  onPeriod?: boolean;
  periodCramps?: number | null;
  periodClots?: "none" | "small" | "large" | "prefer_not_to_say" | null;
  periodImpact?: "none" | "some" | "a_lot" | "unable" | null;
  periodGi?: "none" | "nausea" | "diarrhea" | "constipation" | "painful_bowel_movements" | null;
  bleeding?: "none" | "spotting" | "light" | "moderate" | "heavy";
  symptomSigns?: string[];
  hormoneMedication?: "none" | "combined_contraceptive" | "progestin_or_iud" | "hrt" | "fertility_medication" | "prefer_not_to_say";
  hotFlashes?: number | null;
  skinChanges?: number | null;
  hairChanges?: number | null;
  dataConfidence?: "typical_variation" | "flagged_for_review";
  qualityFlags?: string[];
};

export const CORE_METRICS = ["mood", "energy", "bloating", "pain", "sleep"] as const;
export type CoreMetric = typeof CORE_METRICS[number];

function utcDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

export function calculateCycleDay(entries: CheckInEntry[], targetDate: string, periodStartsToday = false): number | null {
  if (periodStartsToday) return 0;
  const target = utcDay(targetDate);
  const anchors = entries.filter(entry => entry.periodStart && utcDay(entry.date) <= target).sort((a, b) => b.date.localeCompare(a.date));
  return anchors.length ? Math.max(0, Math.round(target - utcDay(anchors[0].date))) : null;
}

export function consecutiveCheckInDays(entries: CheckInEntry[], targetDate: string): number {
  const recorded = new Set(entries.map(entry => utcDay(entry.date)));
  let day = utcDay(targetDate);
  if (!recorded.has(day)) day -= 1;
  let streak = 0;
  while (recorded.has(day)) { streak += 1; day -= 1; }
  return streak;
}

export function assessCheckInConsistency(previousEntries: CheckInEntry[], candidate: CheckInEntry) {
  const flags: string[] = [];
  if (candidate.periodStart && candidate.bleeding === "none") flags.push("period_start_with_no_bleeding");
  if (candidate.periodStart && candidate.onPeriod === false) flags.push("period_start_while_not_on_period");
  const priorPeriodStarts = previousEntries.filter(entry => entry.periodStart && entry.date < candidate.date).sort((a, b) => b.date.localeCompare(a.date));
  if (candidate.periodStart && priorPeriodStarts.length) {
    const gap = utcDay(candidate.date) - utcDay(priorPeriodStarts[0].date);
    if (gap >= 0 && gap < 20) flags.push("period_starts_under_20_days_apart");
  }

  const extremeFive = (entry: CheckInEntry) => CORE_METRICS.every(metric => entry[metric] === 5);
  if (extremeFive(candidate)) {
    const priorDates = new Set(previousEntries.filter(extremeFive).map(entry => utcDay(entry.date)));
    let consecutiveExtremeDays = 1;
    let day = utcDay(candidate.date) - 1;
    while (priorDates.has(day)) { consecutiveExtremeDays += 1; day -= 1; }
    if (consecutiveExtremeDays >= 14) flags.push("identical_all_5_extremes_for_14_consecutive_days");
  }

  return {
    dataConfidence: flags.length ? "flagged_for_review" as const : "typical_variation" as const,
    qualityFlags: flags,
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

const labels: Record<CoreMetric, string> = { mood: "mood", energy: "energy", bloating: "bloating or tenderness", pain: "pain", sleep: "sleep" };

export function buildTrendCandidates(entries: CheckInEntry[]) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 7) return {
    sufficient: false,
    candidates: [] as Array<{ id: string; text: string }>,
    summary: "Not enough data yet for a reliable trend. Check in a few more days for a fuller picture.",
  };

  const periodDates = sorted.filter(entry => entry.periodStart).map(entry => utcDay(entry.date));
  const prePeriod = sorted.filter(entry => periodDates.some(period => {
    const difference = period - utcDay(entry.date);
    return difference >= 1 && difference <= 7;
  }));
  const preIds = new Set(prePeriod.map(entry => entry.id));
  const other = sorted.filter(entry => !preIds.has(entry.id));
  const candidates: Array<{ id: string; text: string; strength: number }> = [];

  if (prePeriod.length >= 2 && other.length >= 2) {
    for (const metric of CORE_METRICS) {
      const before = average(prePeriod.map(entry => entry[metric]));
      const elsewhere = average(other.map(entry => entry[metric]));
      const worseDifference = metric === "mood" || metric === "energy" || metric === "sleep" ? elsewhere - before : before - elsewhere;
      if (Math.abs(worseDifference) >= 0.5) {
        const direction = worseDifference > 0 ? (metric === "mood" || metric === "energy" || metric === "sleep" ? "lower" : "higher") : (metric === "mood" || metric === "energy" || metric === "sleep" ? "higher" : "lower");
        candidates.push({ id: `pre_${metric}`, strength: Math.abs(worseDifference), text: `${labels[metric][0].toUpperCase()}${labels[metric].slice(1)} scores averaged ${before.toFixed(1)}/5 in the seven days before a reported period start, compared with ${elsewhere.toFixed(1)}/5 on other recorded days (${direction} before the period start).` });
      }
    }
  }

  const averages = CORE_METRICS.map(metric => ({ metric, value: average(sorted.map(entry => entry[metric])) }));
  const pain = averages.find(item => item.metric === "pain")!;
  candidates.push({ id: "overall_pain", strength: 0.1, text: `Across ${sorted.length} check-ins, pain averaged ${pain.value.toFixed(1)}/5.` });
  candidates.sort((a, b) => b.strength - a.strength);
  const safeCandidates = candidates.map(({ id, text }) => ({ id, text }));
  return { sufficient: true, candidates: safeCandidates, summary: safeCandidates.slice(0, 2).map(item => item.text).join(" ") };
}

export function selectWindow(entries: CheckInEntry[], days: 14 | 30, today: string): CheckInEntry[] {
  const earliest = utcDay(today) - days + 1;
  return entries.filter(entry => utcDay(entry.date) >= earliest && utcDay(entry.date) <= utcDay(today)).sort((a, b) => a.date.localeCompare(b.date));
}
