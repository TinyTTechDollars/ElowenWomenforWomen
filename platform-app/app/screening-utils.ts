import { CheckInEntry } from "./checkin-utils";

function day(value: string) { return Date.parse(`${value}T00:00:00Z`) / 86_400_000; }

export type ScreeningInput = {
  age: number; bmi: number; naturalLabel: boolean;
  periodPattern?: string | null; hairChanges?: string | null; skinChanges?: string | null;
  smoking?: string | null; parentalHipFracture?: string | null;
  phqInterest?: number | null; phqMood?: number | null;
};

export function buildScreeningInsights(input: ScreeningInput, entries: CheckInEntry[]) {
  const irregular = ["Sometimes irregular", "Very irregular", "No recent periods"].includes(input.periodPattern || "");
  const androgenSigns = ["Increased growth in new areas", "Both thinning and increased growth"].includes(input.hairChanges || "") || ["Noticeable", "Strong"].includes(input.skinChanges || "");

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const periodDays = sorted.filter(entry => entry.periodStart).map(entry => day(entry.date));
  const perimenstrual = sorted.filter(entry => periodDays.some(anchor => Math.abs(day(entry.date) - anchor) <= 2));
  const enoughLongitudinal = sorted.length >= 14 && periodDays.length >= 2;
  const repeatedSeverePeriodPain = enoughLongitudinal && perimenstrual.length >= 4 && perimenstrual.reduce((sum, entry) => sum + entry.pain, 0) / perimenstrual.length >= 4;

  const phqAnswered = Number.isInteger(input.phqInterest) && Number.isInteger(input.phqMood);
  const phqThreshold = phqAnswered && Number(input.phqInterest) + Number(input.phqMood) >= 3;

  return {
    pcos: { matched: [irregular, androgenSigns], flag: irregular && androgenSigns },
    endometriosis: { matched: [enoughLongitudinal, repeatedSeverePeriodPain], flag: repeatedSeverePeriodPain, enoughData: enoughLongitudinal },
    osteoporosis: {
      matched: [input.age >= 65, input.naturalLabel, input.bmi < 21, input.smoking === "Current smoker", input.parentalHipFracture === "Yes"],
      flag: input.age >= 65 || input.naturalLabel && (input.bmi < 21 || input.smoking === "Current smoker" || input.parentalHipFracture === "Yes"),
    },
    depression: { matched: [Number(input.phqInterest) > 0, Number(input.phqMood) > 0], flag: Boolean(phqThreshold), answered: phqAnswered },
  };
}
