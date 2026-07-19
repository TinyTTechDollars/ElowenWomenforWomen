"use client";

import { useEffect, useState } from "react";
import { CheckInEntry } from "./checkin-utils";
import { buildScreeningInsights, ScreeningInput } from "./screening-utils";

const STORAGE_KEY = "elowen.daily-checkins.v1";

function Checklist({ items, matched }: { items: string[]; matched: boolean[] }) {
  return <ul>{items.map((item, index) => <li className={matched[index] ? "matched" : ""} key={item}><i aria-hidden="true" />{item}</li>)}</ul>;
}

export default function ScreeningInsights({ input }: { input: ScreeningInput }) {
  const [entries, setEntries] = useState<CheckInEntry[]>([]);
  useEffect(() => {
    const load = () => { try { setEntries(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")); } catch { setEntries([]); } };
    const timer = window.setTimeout(load, 0); window.addEventListener("elowen-checkins-updated", load);
    return () => { window.clearTimeout(timer); window.removeEventListener("elowen-checkins-updated", load); };
  }, []);
  const result = buildScreeningInsights(input, entries);
  const count = (values: boolean[]) => values.filter(Boolean).length;
  return <section className="screening-section"><div className="section-title"><p className="eyebrow">Screening insights</p><h2>Separate checks, with separate rules</h2><p><strong>Screening flags based on published clinical criteria, not the trained model.</strong> These checks do not change your Elowen probability and cannot diagnose a condition.</p></div><div className="screening-grid">
    <article><header><h3>PCOS patterns</h3><span>{count(result.pcos.matched)} of 2 observable checks</span></header><Checklist matched={result.pcos.matched} items={["Irregular or absent recent cycles reported", "Hair-growth or notable skin-change signs reported"]} /><p>{result.pcos.flag ? "Both observable pattern domains are present. Clinical evaluation is needed to confirm hyperandrogenism, exclude other causes, and assess full diagnostic criteria." : "The available responses do not match both observable pattern domains."}</p><strong className="next-step">Next step: discuss persistent cycle and androgen-related signs with an OB-GYN or endocrinologist.</strong><a href="https://www.monash.edu/__data/assets/pdf_file/0003/3379521/Evidence-Based-Guidelines-2023.pdf" target="_blank" rel="noreferrer">2023 International PCOS Guideline</a></article>
    <article><header><h3>Endometriosis-related pain</h3><span>{count(result.endometriosis.matched)} of 2 tracker checks</span></header><Checklist matched={result.endometriosis.matched} items={["At least 14 check-ins spanning 2 reported period starts", "Repeated average pain of 4/5 or higher around period starts"]} /><p>{!result.endometriosis.enoughData ? "Not enough longitudinal history yet. This flag cannot activate from a one-time answer." : result.endometriosis.flag ? "A sustained period-related severe-pain pattern is present in the tracker. This is worth clinical discussion." : "Enough history is available, but the defined sustained severe-pain pattern was not observed."}</p><strong className="next-step">Next step: bring the symptom report to an OB-GYN, especially if pain affects daily life.</strong><a href="https://www.nice.org.uk/guidance/ng73/chapter/Recommendations" target="_blank" rel="noreferrer">NICE endometriosis guidance</a></article>
    <article><header><h3>Bone-health screening</h3><span>{count(result.osteoporosis.matched)} of 5 review factors</span></header><Checklist matched={result.osteoporosis.matched} items={["Age 65 or older", "Model label is closer to self-reported natural menopause", "BMI below 21", "Current smoking reported", "Parental hip fracture reported"]} /><p>{result.osteoporosis.flag ? "One or more factors support discussing formal fracture-risk assessment or bone-density screening. The model label is not a clinical menopause diagnosis." : "The available profile does not trigger this lightweight review rule."}</p><strong className="next-step">Next step: ask whether a validated risk tool and DXA screening are appropriate.</strong><a href="https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/osteoporosis-screening" target="_blank" rel="noreferrer">USPSTF osteoporosis screening</a></article>
    <article><header><h3>Depression first-pass screen</h3><span>{result.depression.answered ? `${count(result.depression.matched)} of 2 symptoms present` : "Not completed"}</span></header><Checklist matched={result.depression.matched} items={["Reduced interest or pleasure reported", "Feeling down, depressed, or hopeless reported"]} /><p>{!result.depression.answered ? "Complete both optional PHQ-2 questions to use this check." : result.depression.flag ? "The standard PHQ-2 follow-up threshold is met. This does not diagnose depression, but it is worth bringing to a doctor or counselor." : "The standard PHQ-2 follow-up threshold is not met from these answers."}</p><strong className="next-step">Next step: share how you have been feeling with a qualified healthcare professional if you want support.</strong><a href="https://pubmed.ncbi.nlm.nih.gov/32515813/" target="_blank" rel="noreferrer">PHQ-2 diagnostic meta-analysis</a></article>
  </div></section>;
}
