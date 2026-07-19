"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { assessCheckInConsistency, buildTrendCandidates, calculateCycleDay, CheckInEntry, consecutiveCheckInDays, CORE_METRICS, selectWindow } from "./checkin-utils";

type TrackerProps = {
  consent: boolean;
  showHotFlashes: boolean;
  predictionLabel: string;
  confidence: number;
  referralGuidance: string;
  referralWhy: string;
};

const STORAGE_KEY = "elowen.daily-checkins.v1";
const PARTICIPANT_KEY = "elowen.anonymous-participant.v1";
const metricLabels = { mood: "Mood today", energy: "Energy", bloating: "Bloating or tenderness", pain: "Pain", sleep: "Sleep quality" } as const;
const lowLabels = { mood: "Low", energy: "Low", bloating: "None", pain: "None", sleep: "Poor" } as const;
const highLabels = { mood: "Good", energy: "High", bloating: "Severe", pain: "Severe", sleep: "Good" } as const;
const symptomSigns = ["Hot flashes or night sweats", "Headache or migraine", "Brain fog or trouble concentrating", "Anxiety or irritability", "Vaginal dryness or discomfort", "Urinary changes", "Change in sexual desire", "Palpitations"];

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function emptyDraft(existing?: CheckInEntry) {
  return existing || { id: crypto.randomUUID(), date: todayKey(), createdAt: Date.now(), cycleDay: null, mood: 0, energy: 0, bloating: 0, pain: 0, sleep: 0, onPeriod: false, periodStart: false, bleeding: "none", symptomSigns: [], hormoneMedication: undefined, hotFlashes: null, skinChanges: null, hairChanges: null };
}
function participantId() {
  const existing = localStorage.getItem(PARTICIPANT_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(PARTICIPANT_KEY, created);
  return created;
}

export default function LongitudinalTracker(props: TrackerProps) {
  const [entries, setEntries] = useState<CheckInEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CheckInEntry>(() => emptyDraft());
  const [windowDays, setWindowDays] = useState<14 | 30>(14);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState("");
  const today = todayKey();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as CheckInEntry[];
        setEntries(saved);
        const existing = saved.find(entry => entry.date === today);
        if (existing) setDraft(existing);
      } catch { setEntries([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [today]);

  const showWeekly = useMemo(() => !entries.some(entry => {
    const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${entry.date}T00:00:00Z`)) / 86_400_000;
    return age >= 0 && age < 7 && (entry.skinChanges || entry.hairChanges);
  }), [entries, today]);

  function setScore(metric: keyof Pick<CheckInEntry, "mood" | "energy" | "bloating" | "pain" | "sleep" | "hotFlashes" | "skinChanges" | "hairChanges">, value: number) {
    setDraft(current => ({ ...current, [metric]: value }));
  }

  function toggleSign(sign: string) {
    setDraft(current => ({ ...current, symptomSigns: current.symptomSigns?.includes(sign) ? current.symptomSigns.filter(item => item !== sign) : [...(current.symptomSigns || []), sign] }));
  }

  function applyVoiceNote(text: string) {
    const words = text.toLowerCase();
    setDraft(current => {
      const next = { ...current };
      if (/no bleeding/.test(words)) next.bleeding = "none";
      else if (/spotting/.test(words)) next.bleeding = "spotting";
      else if (/heavy (bleeding|flow)|bleeding.*heavy/.test(words)) next.bleeding = "heavy";
      else if (/moderate (bleeding|flow)/.test(words)) next.bleeding = "moderate";
      else if (/light (bleeding|flow)/.test(words)) next.bleeding = "light";
      if (/on my period|menstruating|period today/.test(words)) next.onPeriod = true;
      if (/period started|first day of my period/.test(words)) { next.onPeriod = true; next.periodStart = true; }
      if (/severe pain|pain.*severe/.test(words)) next.pain = 5; else if (/moderate pain/.test(words)) next.pain = 3; else if (/mild pain/.test(words)) next.pain = 2;
      if (/poor sleep|slept poorly/.test(words)) next.sleep = 1; else if (/slept well|good sleep/.test(words)) next.sleep = 5;
      if (/low energy|exhausted/.test(words)) next.energy = 1; else if (/high energy|energetic/.test(words)) next.energy = 5;
      const detected = symptomSigns.filter(sign => {
        const key = sign.toLowerCase();
        return (key.includes("hot flashes") && /hot flash|night sweat/.test(words)) || (key.includes("headache") && /headache|migraine/.test(words)) || (key.includes("brain fog") && /brain fog|concentrat/.test(words)) || (key.includes("anxiety") && /anxious|anxiety|irritable/.test(words)) || (key.includes("vaginal") && /vaginal dry|vaginal discomfort/.test(words)) || (key.includes("urinary") && /urinary|urination/.test(words)) || (key.includes("sexual") && /libido|sexual desire/.test(words)) || (key.includes("palpitations") && /palpitation|heart racing/.test(words));
      });
      next.symptomSigns = [...new Set([...(next.symptomSigns || []), ...detected])];
      return next;
    });
    setVoiceNote("I filled the details I could detect. Please review every answer before saving. Your spoken words are not stored.");
  }

  function startVoiceNote() {
    type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onerror: () => void; onend: () => void };
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceNote("Voice notes are not supported in this browser. You can still tap each answer."); return; }
    const recognition = new SpeechRecognition(); recognition.lang = "en-US"; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = event => applyVoiceNote(Array.from(event.results).map(result => result[0].transcript).join(" "));
    recognition.onerror = () => setVoiceNote("I could not hear that clearly. Try again or tap your answers.");
    recognition.onend = () => setVoiceListening(false);
    setVoiceListening(true); setVoiceNote("Listening now. Describe how you feel, any bleeding, and whether your period started."); recognition.start();
  }

  async function saveCheckIn(event: FormEvent) {
    event.preventDefault();
    if (CORE_METRICS.some(metric => !draft[metric]) || !draft.hormoneMedication) { setMessage("Choose one response for each daily item, including medication use."); return; }
    const withoutToday = entries.filter(entry => entry.date !== today);
    const base = { ...draft, date: today, createdAt: Date.now(), cycleDay: calculateCycleDay(withoutToday, today, draft.periodStart) };
    const saved = { ...base, ...assessCheckInConsistency(withoutToday, base) };
    const updated = [...withoutToday, saved].sort((a, b) => a.date.localeCompare(b.date));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event("elowen-checkins-updated"));
    setEntries(updated); setDraft(saved); setOpen(false); setMessage("Today’s check-in is saved on this device.");
    if (props.consent) fetch("/api/checkins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: saved, participantId: participantId(), researchConsent: true }) }).catch(() => undefined);
  }

  async function createReport(share = false) {
    const selected = selectWindow(entries, windowDays, today);
    if (!selected.length) { setMessage("Complete at least one daily check-in before creating a report."); return; }
    setSaving(true);
    try {
      let summary = buildTrendCandidates(selected).summary;
      if (props.consent) {
        const response = await fetch("/api/trend-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries: selected }) });
        const responseBody = await response.json() as { summary?: string };
        summary = responseBody.summary || summary;
      }
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const left = 44, width = 524;
      pdf.setTextColor(73, 63, 59); pdf.setFont("helvetica", "bold"); pdf.setFontSize(20); pdf.text("Elowen longitudinal doctor report", left, 45);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.text(`${selected[0].date} to ${selected.at(-1)?.date} • ${selected.length} daily check-in${selected.length === 1 ? "" : "s"}`, left, 63);
      pdf.setTextColor(145, 55, 86); pdf.text("Not a diagnosis. For use in conversation with a healthcare provider.", left, 79);

      const chartTop = 108, chartHeight = 190, chartLeft = 78, chartWidth = 470;
      pdf.setDrawColor(226, 210, 204); pdf.setLineWidth(.5);
      for (let score = 1; score <= 5; score += 1) { const y = chartTop + chartHeight - ((score - 1) / 4) * chartHeight; pdf.line(chartLeft, y, chartLeft + chartWidth, y); pdf.setFontSize(7); pdf.text(String(score), chartLeft - 12, y + 2); }
      selected.forEach((entry, index) => { if (entry.periodStart) { const x = chartLeft + (index / Math.max(1, selected.length - 1)) * chartWidth; pdf.setDrawColor(217, 75, 122); pdf.setLineDashPattern([3, 3], 0); pdf.line(x, chartTop, x, chartTop + chartHeight); pdf.setLineDashPattern([], 0); } });
      const colors = [[217,75,122],[73,63,59],[235,185,70],[183,92,118],[120,107,102]];
      CORE_METRICS.forEach((metric, metricIndex) => {
        pdf.setDrawColor(...colors[metricIndex] as [number, number, number]); pdf.setLineWidth(1.7);
        selected.slice(1).forEach((entry, index) => {
          const previous = selected[index]; const x1 = chartLeft + (index / Math.max(1, selected.length - 1)) * chartWidth; const x2 = chartLeft + ((index + 1) / Math.max(1, selected.length - 1)) * chartWidth;
          const y1 = chartTop + chartHeight - ((previous[metric] - 1) / 4) * chartHeight; const y2 = chartTop + chartHeight - ((entry[metric] - 1) / 4) * chartHeight; pdf.line(x1, y1, x2, y2);
        });
      });
      pdf.setFontSize(7); pdf.setTextColor(73,63,59); pdf.text("1–5 daily scores. Pink dashed lines mark reported period starts.", chartLeft, chartTop + chartHeight + 14);
      pdf.text("Mood", 78, 323); pdf.text("Energy", 125, 323); pdf.text("Bloating", 180, 323); pdf.text("Pain", 240, 323); pdf.text("Sleep", 280, 323);

      pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.text("Observed pattern summary", left, 354);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); const summaryLines = pdf.splitTextToSize(summary, width); pdf.text(summaryLines, left, 370);
      const bleedingDays = selected.filter(entry => entry.bleeding && entry.bleeding !== "none");
      const heavyDays = selected.filter(entry => entry.bleeding === "heavy");
      const signCounts = new Map<string, number>(); selected.flatMap(entry => entry.symptomSigns || []).forEach(sign => signCounts.set(sign, (signCounts.get(sign) || 0) + 1));
      const frequentSigns = [...signCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([sign, count]) => `${sign} (${count} day${count === 1 ? "" : "s"})`);
      const medicationLabels: Record<string, string> = { none: "No hormonal medication reported", combined_contraceptive: "Combined hormonal contraceptive", progestin_or_iud: "Progestin-only contraception or hormonal IUD", hrt: "Hormone replacement therapy", fertility_medication: "Fertility medication", prefer_not_to_say: "Medication status not disclosed" };
      const latestMedication = [...selected].reverse().find(entry => entry.hormoneMedication)?.hormoneMedication;
      const observationText = `Bleeding was recorded on ${bleedingDays.length} day${bleedingDays.length === 1 ? "" : "s"}${heavyDays.length ? `, including ${heavyDays.length} heavy-flow day${heavyDays.length === 1 ? "" : "s"}` : ""}. ${frequentSigns.length ? `Other reported signs: ${frequentSigns.join(", ")}.` : "No optional symptom signs were selected."} Most recent medication response: ${latestMedication ? medicationLabels[latestMedication] : "not recorded"}.`;
      const observationLines = pdf.splitTextToSize(observationText, width); pdf.text(observationLines, left, 370 + summaryLines.length * 11 + 7);
      let y = 370 + (summaryLines.length + observationLines.length) * 11 + 25;
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.text("Original Elowen context", left, y); y += 16;
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.text(pdf.splitTextToSize(`${props.predictionLabel} (${(props.confidence * 100).toFixed(1)}% confidence in this survey label). ${props.referralGuidance} Why: ${props.referralWhy}`, width), left, y);
      pdf.setFontSize(8); pdf.setTextColor(120,107,102); pdf.text(pdf.splitTextToSize("Research and awareness only. This report does not diagnose a condition, determine urgency, or recommend treatment. Discuss health questions with a healthcare provider.", width), left, 730);
      const blob = pdf.output("blob"); const file = new File([blob], `elowen-${windowDays}-day-doctor-report.pdf`, { type: "application/pdf" });
      if (share && navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Elowen doctor report", text: "My Elowen symptom-trend report for our conversation." });
      else pdf.save(file.name);
      setMessage(share ? "Your report is ready to share." : "Your PDF report has been downloaded.");
    } catch { setMessage("The report could not be created right now."); }
    finally { setSaving(false); }
  }

  const todayEntry = entries.find(entry => entry.date === today);
  const streak = consecutiveCheckInDays(entries, today);
  const todayNumber = Number(today.slice(-2));
  const monthPrefix = today.slice(0, 8);
  const monthEntries = new Set(entries.filter(entry => entry.date.startsWith(monthPrefix)).map(entry => Number(entry.date.slice(-2))));
  const mostRecent = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0];
  const missedDays = mostRecent ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${mostRecent.date}T00:00:00Z`)) / 86_400_000) : 0;
  return <section className="tracker-section">
    <div className="tracker-heading"><div><p className="eyebrow">Daily pattern tracking</p><h2>A clearer story over time</h2><p>A 15–30 second daily check-in can create a more useful report for a healthcare conversation. Entries stay on this device unless you opted into anonymous research sharing.</p></div><button className="secondary-button" onClick={() => { setDraft(emptyDraft(todayEntry)); setOpen(true); }}>{todayEntry ? "View or edit today’s check-in" : "Check in today"}</button></div>
    <div className="report-actions"><label><span>Report window</span><select value={windowDays} onChange={event => setWindowDays(Number(event.target.value) as 14 | 30)}><option value="14">Past 2 weeks</option><option value="30">Past month</option></select></label><button className="primary-button" disabled={saving} onClick={() => createReport(false)}>Download report PDF</button><button className="secondary-button" disabled={saving} onClick={() => createReport(true)}>Share report with my doctor</button><small>{entries.length ? `${entries.length} check-in${entries.length === 1 ? "" : "s"} saved on this device.` : "No check-ins yet. Your report will use whatever history is available."}</small></div>
    {message && <p className="tracker-message" role="status">{message}</p>}
    {open && <div className="checkin-overlay" role="dialog" aria-modal="true" aria-labelledby="checkin-title"><form className="checkin-card" onSubmit={saveCheckIn}><div className="checkin-top"><div><p className="eyebrow">Today</p><h2 id="checkin-title">Daily check-in</h2></div><button type="button" className="close-button" onClick={() => setOpen(false)} aria-label="Close check-in">Close</button></div>
      <div className="bloom-progress"><img src="/flower-checkin-journey.png" alt="Seven stages of the Elowen flower" /><div><strong>Bloom stage {Math.min(7, Math.max(1, streak + (todayEntry ? 0 : 1)))} of 7</strong><span>Each check-in grows your record. Missing a day does not reset what you have learned.</span></div></div>
      <div className="adherence-strip"><div><strong>{streak}-day streak</strong><span>{missedDays > 1 ? "Welcome back. Pick up whenever works for you." : "Small check-ins can make patterns easier to see."}</span></div><div className="month-dots" aria-label={`${monthEntries.size} check-ins this month`}>{Array.from({ length: todayNumber }, (_, index) => index + 1).map(day => <span key={day} className={monthEntries.has(day) ? "filled" : ""} title={`${monthPrefix}${String(day).padStart(2, "0")}: ${monthEntries.has(day) ? "checked in" : "no check-in"}`} />)}</div></div>
      <section className="voice-note"><div><strong>Talk through today’s check-in</strong><p>Say how you feel, whether you are bleeding, and any symptoms. Elowen will fill matching answers for you to review.</p></div><button type="button" className="secondary-button" onClick={startVoiceNote} disabled={voiceListening}>{voiceListening ? "Listening" : "Start voice note"}</button>{voiceNote && <small role="status">{voiceNote}</small>}</section>
      <div className="scale-list">{CORE_METRICS.map(metric => <fieldset key={metric}><legend>{metricLabels[metric]}</legend><div className="scale-buttons"><small>{lowLabels[metric]}</small>{[1,2,3,4,5].map(value => <button type="button" key={value} className={draft[metric] === value ? "selected" : ""} onClick={() => setScore(metric, value)} aria-pressed={draft[metric] === value}>{value}</button>)}<small>{highLabels[metric]}</small></div></fieldset>)}</div>
      <fieldset className="medication-question"><legend>Are you currently using hormonal birth control, hormone therapy, or fertility medication?</legend><select value={draft.hormoneMedication || ""} onChange={event => setDraft(current => ({ ...current, hormoneMedication: event.target.value as CheckInEntry["hormoneMedication"] }))}><option value="">Choose one</option><option value="none">No</option><option value="combined_contraceptive">Yes: combined hormonal contraceptive (pill, patch, ring)</option><option value="progestin_or_iud">Yes: progestin-only or hormonal IUD</option><option value="hrt">Yes: hormone replacement therapy (HRT)</option><option value="fertility_medication">Yes: fertility medication</option><option value="prefer_not_to_say">Prefer not to say</option></select></fieldset>
      <fieldset className="period-question"><legend>Are you on your period today?</legend><div><button type="button" className={!draft.onPeriod ? "selected" : ""} onClick={() => setDraft(current => ({ ...current, onPeriod: false, periodStart: false }))}>No</button><button type="button" className={draft.onPeriod ? "selected" : ""} onClick={() => setDraft(current => ({ ...current, onPeriod: true }))}>Yes</button></div></fieldset>
      <fieldset className="bleeding-question"><legend>Bleeding today</legend><div>{(["none", "spotting", "light", "moderate", "heavy"] as const).map(flow => <button type="button" key={flow} className={draft.bleeding === flow ? "selected" : ""} onClick={() => setDraft(current => ({ ...current, bleeding: flow }))}>{flow[0].toUpperCase() + flow.slice(1)}</button>)}</div></fieldset>
      {draft.onPeriod && <div className="period-details"><h3>About your period today</h3><fieldset className="period-question"><legend>Did your period start today?</legend><div><button type="button" className={!draft.periodStart ? "selected" : ""} onClick={() => setDraft(current => ({ ...current, periodStart: false }))}>No</button><button type="button" className={draft.periodStart ? "selected" : ""} onClick={() => setDraft(current => ({ ...current, periodStart: true }))}>Yes</button></div></fieldset><fieldset><legend>Cramp severity</legend><div className="scale-buttons"><small>None</small>{[1,2,3,4,5].map(value => <button type="button" key={value} className={draft.periodCramps === value ? "selected" : ""} onClick={() => setDraft(current => ({ ...current, periodCramps: value }))}>{value}</button>)}<small>Severe</small></div></fieldset><label><span>Clots today</span><select value={draft.periodClots || ""} onChange={event => setDraft(current => ({ ...current, periodClots: event.target.value as CheckInEntry["periodClots"] }))}><option value="">Choose one</option><option value="none">None</option><option value="small">Small</option><option value="large">Large</option><option value="prefer_not_to_say">Prefer not to say</option></select></label><label><span>Impact on daily activities</span><select value={draft.periodImpact || ""} onChange={event => setDraft(current => ({ ...current, periodImpact: event.target.value as CheckInEntry["periodImpact"] }))}><option value="">Choose one</option><option value="none">None</option><option value="some">Some</option><option value="a_lot">A lot</option><option value="unable">Unable to do usual activities</option></select></label><label><span>Digestive changes</span><select value={draft.periodGi || ""} onChange={event => setDraft(current => ({ ...current, periodGi: event.target.value as CheckInEntry["periodGi"] }))}><option value="">Choose one</option><option value="none">None</option><option value="nausea">Nausea</option><option value="diarrhea">Diarrhea</option><option value="constipation">Constipation</option><option value="painful_bowel_movements">Painful bowel movements</option></select></label></div>}
      <fieldset className="signs-question"><legend>Other signs today <small>Optional</small></legend><div>{symptomSigns.map(sign => <button type="button" key={sign} className={draft.symptomSigns?.includes(sign) ? "selected" : ""} onClick={() => toggleSign(sign)} aria-pressed={draft.symptomSigns?.includes(sign)}>{sign}</button>)}</div></fieldset>{props.showHotFlashes && <fieldset><legend>Hot flashes or night sweats severity</legend><div className="scale-buttons"><small>None</small>{[1,2,3,4,5].map(value => <button type="button" key={value} className={draft.hotFlashes === value ? "selected" : ""} onClick={() => setScore("hotFlashes", value)}>{value}</button>)}<small>Severe</small></div></fieldset>}{showWeekly && <div className="weekly-row"><label><span>Skin/acne changes this week</span><select value={draft.skinChanges || ""} onChange={event => setDraft(current => ({ ...current, skinChanges: Number(event.target.value) || null }))}><option value="">Skip</option><option value="1">None</option><option value="3">Noticeable</option><option value="5">Strong</option></select></label><label><span>Hair changes this week</span><select value={draft.hairChanges || ""} onChange={event => setDraft(current => ({ ...current, hairChanges: Number(event.target.value) || null }))}><option value="">Skip</option><option value="1">None</option><option value="3">Noticeable</option><option value="5">Strong</option></select></label></div>}<div className="checkin-submit"><button className="primary-button" type="submit">Save today’s check-in</button><small>{props.consent ? "Your opt-in is on, so an anonymous copy also contributes to research." : "Saved locally only. Research sharing is off."}</small></div>{message && <p className="error-message">{message}</p>}</form></div>}
  </section>;
}
