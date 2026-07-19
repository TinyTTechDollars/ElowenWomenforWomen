import { a as require_react, s as __toESM, t as require_jsx_runtime } from "../index.js";
//#region app/checkin-utils.ts
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
var CORE_METRICS = [
	"mood",
	"energy",
	"bloating",
	"pain",
	"sleep"
];
function utcDay(date) {
	return Date.parse(`${date}T00:00:00Z`) / 864e5;
}
function calculateCycleDay(entries, targetDate, periodStartsToday = false) {
	if (periodStartsToday) return 0;
	const target = utcDay(targetDate);
	const anchors = entries.filter((entry) => entry.periodStart && utcDay(entry.date) <= target).sort((a, b) => b.date.localeCompare(a.date));
	return anchors.length ? Math.max(0, Math.round(target - utcDay(anchors[0].date))) : null;
}
function consecutiveCheckInDays(entries, targetDate) {
	const recorded = new Set(entries.map((entry) => utcDay(entry.date)));
	let day = utcDay(targetDate);
	if (!recorded.has(day)) day -= 1;
	let streak = 0;
	while (recorded.has(day)) {
		streak += 1;
		day -= 1;
	}
	return streak;
}
function assessCheckInConsistency(previousEntries, candidate) {
	const flags = [];
	if (candidate.periodStart && candidate.bleeding === "none") flags.push("period_start_with_no_bleeding");
	if (candidate.periodStart && candidate.onPeriod === false) flags.push("period_start_while_not_on_period");
	const priorPeriodStarts = previousEntries.filter((entry) => entry.periodStart && entry.date < candidate.date).sort((a, b) => b.date.localeCompare(a.date));
	if (candidate.periodStart && priorPeriodStarts.length) {
		const gap = utcDay(candidate.date) - utcDay(priorPeriodStarts[0].date);
		if (gap >= 0 && gap < 20) flags.push("period_starts_under_20_days_apart");
	}
	const extremeFive = (entry) => CORE_METRICS.every((metric) => entry[metric] === 5);
	if (extremeFive(candidate)) {
		const priorDates = new Set(previousEntries.filter(extremeFive).map((entry) => utcDay(entry.date)));
		let consecutiveExtremeDays = 1;
		let day = utcDay(candidate.date) - 1;
		while (priorDates.has(day)) {
			consecutiveExtremeDays += 1;
			day -= 1;
		}
		if (consecutiveExtremeDays >= 14) flags.push("identical_all_5_extremes_for_14_consecutive_days");
	}
	return {
		dataConfidence: flags.length ? "flagged_for_review" : "typical_variation",
		qualityFlags: flags
	};
}
function average(values) {
	return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
var labels = {
	mood: "mood",
	energy: "energy",
	bloating: "bloating or tenderness",
	pain: "pain",
	sleep: "sleep"
};
function buildTrendCandidates(entries) {
	const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
	if (sorted.length < 7) return {
		sufficient: false,
		candidates: [],
		summary: "Not enough data yet for a reliable trend. Check in a few more days for a fuller picture."
	};
	const periodDates = sorted.filter((entry) => entry.periodStart).map((entry) => utcDay(entry.date));
	const prePeriod = sorted.filter((entry) => periodDates.some((period) => {
		const difference = period - utcDay(entry.date);
		return difference >= 1 && difference <= 7;
	}));
	const preIds = new Set(prePeriod.map((entry) => entry.id));
	const other = sorted.filter((entry) => !preIds.has(entry.id));
	const candidates = [];
	if (prePeriod.length >= 2 && other.length >= 2) for (const metric of CORE_METRICS) {
		const before = average(prePeriod.map((entry) => entry[metric]));
		const elsewhere = average(other.map((entry) => entry[metric]));
		const worseDifference = metric === "mood" || metric === "energy" || metric === "sleep" ? elsewhere - before : before - elsewhere;
		if (Math.abs(worseDifference) >= .5) {
			const direction = worseDifference > 0 ? metric === "mood" || metric === "energy" || metric === "sleep" ? "lower" : "higher" : metric === "mood" || metric === "energy" || metric === "sleep" ? "higher" : "lower";
			candidates.push({
				id: `pre_${metric}`,
				strength: Math.abs(worseDifference),
				text: `${labels[metric][0].toUpperCase()}${labels[metric].slice(1)} scores averaged ${before.toFixed(1)}/5 in the seven days before a reported period start, compared with ${elsewhere.toFixed(1)}/5 on other recorded days (${direction} before the period start).`
			});
		}
	}
	const pain = CORE_METRICS.map((metric) => ({
		metric,
		value: average(sorted.map((entry) => entry[metric]))
	})).find((item) => item.metric === "pain");
	candidates.push({
		id: "overall_pain",
		strength: .1,
		text: `Across ${sorted.length} check-ins, pain averaged ${pain.value.toFixed(1)}/5.`
	});
	candidates.sort((a, b) => b.strength - a.strength);
	const safeCandidates = candidates.map(({ id, text }) => ({
		id,
		text
	}));
	return {
		sufficient: true,
		candidates: safeCandidates,
		summary: safeCandidates.slice(0, 2).map((item) => item.text).join(" ")
	};
}
function selectWindow(entries, days, today) {
	const earliest = utcDay(today) - days + 1;
	return entries.filter((entry) => utcDay(entry.date) >= earliest && utcDay(entry.date) <= utcDay(today)).sort((a, b) => a.date.localeCompare(b.date));
}
//#endregion
//#region app/LongitudinalTracker.tsx
var import_jsx_runtime = require_jsx_runtime();
var STORAGE_KEY$1 = "elowen.daily-checkins.v1";
var PARTICIPANT_KEY = "elowen.anonymous-participant.v1";
var metricLabels = {
	mood: "Mood today",
	energy: "Energy",
	bloating: "Bloating or tenderness",
	pain: "Pain",
	sleep: "Sleep quality"
};
var lowLabels = {
	mood: "Low",
	energy: "Low",
	bloating: "None",
	pain: "None",
	sleep: "Poor"
};
var highLabels = {
	mood: "Good",
	energy: "High",
	bloating: "Severe",
	pain: "Severe",
	sleep: "Good"
};
var symptomSigns = [
	"Hot flashes or night sweats",
	"Headache or migraine",
	"Brain fog or trouble concentrating",
	"Anxiety or irritability",
	"Vaginal dryness or discomfort",
	"Urinary changes",
	"Change in sexual desire",
	"Palpitations"
];
function todayKey() {
	const date = /* @__PURE__ */ new Date();
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function emptyDraft(existing) {
	return existing || {
		id: crypto.randomUUID(),
		date: todayKey(),
		createdAt: Date.now(),
		cycleDay: null,
		mood: 0,
		energy: 0,
		bloating: 0,
		pain: 0,
		sleep: 0,
		onPeriod: false,
		periodStart: false,
		bleeding: "none",
		symptomSigns: [],
		hormoneMedication: void 0,
		hotFlashes: null,
		skinChanges: null,
		hairChanges: null
	};
}
function participantId() {
	const existing = localStorage.getItem(PARTICIPANT_KEY);
	if (existing) return existing;
	const created = crypto.randomUUID();
	localStorage.setItem(PARTICIPANT_KEY, created);
	return created;
}
function LongitudinalTracker(props) {
	const [entries, setEntries] = (0, import_react.useState)([]);
	const [open, setOpen] = (0, import_react.useState)(false);
	const [draft, setDraft] = (0, import_react.useState)(() => emptyDraft());
	const [windowDays, setWindowDays] = (0, import_react.useState)(14);
	const [saving, setSaving] = (0, import_react.useState)(false);
	const [message, setMessage] = (0, import_react.useState)("");
	const [voiceListening, setVoiceListening] = (0, import_react.useState)(false);
	const [voiceNote, setVoiceNote] = (0, import_react.useState)("");
	const today = todayKey();
	(0, import_react.useEffect)(() => {
		const timer = window.setTimeout(() => {
			try {
				const saved = JSON.parse(localStorage.getItem(STORAGE_KEY$1) || "[]");
				setEntries(saved);
				const existing = saved.find((entry) => entry.date === today);
				if (existing) setDraft(existing);
			} catch {
				setEntries([]);
			}
		}, 0);
		return () => window.clearTimeout(timer);
	}, [today]);
	const showWeekly = (0, import_react.useMemo)(() => !entries.some((entry) => {
		const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${entry.date}T00:00:00Z`)) / 864e5;
		return age >= 0 && age < 7 && (entry.skinChanges || entry.hairChanges);
	}), [entries, today]);
	function setScore(metric, value) {
		setDraft((current) => ({
			...current,
			[metric]: value
		}));
	}
	function toggleSign(sign) {
		setDraft((current) => ({
			...current,
			symptomSigns: current.symptomSigns?.includes(sign) ? current.symptomSigns.filter((item) => item !== sign) : [...current.symptomSigns || [], sign]
		}));
	}
	function applyVoiceNote(text) {
		const words = text.toLowerCase();
		setDraft((current) => {
			const next = { ...current };
			if (/no bleeding/.test(words)) next.bleeding = "none";
			else if (/spotting/.test(words)) next.bleeding = "spotting";
			else if (/heavy (bleeding|flow)|bleeding.*heavy/.test(words)) next.bleeding = "heavy";
			else if (/moderate (bleeding|flow)/.test(words)) next.bleeding = "moderate";
			else if (/light (bleeding|flow)/.test(words)) next.bleeding = "light";
			if (/on my period|menstruating|period today/.test(words)) next.onPeriod = true;
			if (/period started|first day of my period/.test(words)) {
				next.onPeriod = true;
				next.periodStart = true;
			}
			if (/severe pain|pain.*severe/.test(words)) next.pain = 5;
			else if (/moderate pain/.test(words)) next.pain = 3;
			else if (/mild pain/.test(words)) next.pain = 2;
			if (/poor sleep|slept poorly/.test(words)) next.sleep = 1;
			else if (/slept well|good sleep/.test(words)) next.sleep = 5;
			if (/low energy|exhausted/.test(words)) next.energy = 1;
			else if (/high energy|energetic/.test(words)) next.energy = 5;
			const detected = symptomSigns.filter((sign) => {
				const key = sign.toLowerCase();
				return key.includes("hot flashes") && /hot flash|night sweat/.test(words) || key.includes("headache") && /headache|migraine/.test(words) || key.includes("brain fog") && /brain fog|concentrat/.test(words) || key.includes("anxiety") && /anxious|anxiety|irritable/.test(words) || key.includes("vaginal") && /vaginal dry|vaginal discomfort/.test(words) || key.includes("urinary") && /urinary|urination/.test(words) || key.includes("sexual") && /libido|sexual desire/.test(words) || key.includes("palpitations") && /palpitation|heart racing/.test(words);
			});
			next.symptomSigns = [...new Set([...next.symptomSigns || [], ...detected])];
			return next;
		});
		setVoiceNote("I filled the details I could detect. Please review every answer before saving. Your spoken words are not stored.");
	}
	function startVoiceNote() {
		const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SpeechRecognition) {
			setVoiceNote("Voice notes are not supported in this browser. You can still tap each answer.");
			return;
		}
		const recognition = new SpeechRecognition();
		recognition.lang = "en-US";
		recognition.interimResults = false;
		recognition.continuous = false;
		recognition.onresult = (event) => applyVoiceNote(Array.from(event.results).map((result) => result[0].transcript).join(" "));
		recognition.onerror = () => setVoiceNote("I could not hear that clearly. Try again or tap your answers.");
		recognition.onend = () => setVoiceListening(false);
		setVoiceListening(true);
		setVoiceNote("Listening now. Describe how you feel, any bleeding, and whether your period started.");
		recognition.start();
	}
	async function saveCheckIn(event) {
		event.preventDefault();
		if (CORE_METRICS.some((metric) => !draft[metric]) || !draft.hormoneMedication) {
			setMessage("Choose one response for each daily item, including medication use.");
			return;
		}
		const withoutToday = entries.filter((entry) => entry.date !== today);
		const base = {
			...draft,
			date: today,
			createdAt: Date.now(),
			cycleDay: calculateCycleDay(withoutToday, today, draft.periodStart)
		};
		const saved = {
			...base,
			...assessCheckInConsistency(withoutToday, base)
		};
		const updated = [...withoutToday, saved].sort((a, b) => a.date.localeCompare(b.date));
		localStorage.setItem(STORAGE_KEY$1, JSON.stringify(updated));
		window.dispatchEvent(new Event("elowen-checkins-updated"));
		setEntries(updated);
		setDraft(saved);
		setOpen(false);
		setMessage("Today’s check-in is saved on this device.");
		if (props.consent) fetch("/api/checkins", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				entry: saved,
				participantId: participantId(),
				researchConsent: true
			})
		}).catch(() => void 0);
	}
	async function createReport(share = false) {
		const selected = selectWindow(entries, windowDays, today);
		if (!selected.length) {
			setMessage("Complete at least one daily check-in before creating a report.");
			return;
		}
		setSaving(true);
		try {
			let summary = buildTrendCandidates(selected).summary;
			if (props.consent) summary = (await (await fetch("/api/trend-summary", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ entries: selected })
			})).json()).summary || summary;
			const { jsPDF } = await import("./jspdf.es.min-gU8D_NDR.js");
			const pdf = new jsPDF({
				unit: "pt",
				format: "letter"
			});
			const left = 44, width = 524;
			pdf.setTextColor(73, 63, 59);
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(20);
			pdf.text("Elowen longitudinal doctor report", left, 45);
			pdf.setFont("helvetica", "normal");
			pdf.setFontSize(9);
			pdf.text(`${selected[0].date} to ${selected.at(-1)?.date} • ${selected.length} daily check-in${selected.length === 1 ? "" : "s"}`, left, 63);
			pdf.setTextColor(145, 55, 86);
			pdf.text("Not a diagnosis. For use in conversation with a healthcare provider.", left, 79);
			const chartTop = 108, chartHeight = 190, chartLeft = 78, chartWidth = 470;
			pdf.setDrawColor(226, 210, 204);
			pdf.setLineWidth(.5);
			for (let score = 1; score <= 5; score += 1) {
				const y = chartTop + chartHeight - (score - 1) / 4 * chartHeight;
				pdf.line(chartLeft, y, chartLeft + chartWidth, y);
				pdf.setFontSize(7);
				pdf.text(String(score), chartLeft - 12, y + 2);
			}
			selected.forEach((entry, index) => {
				if (entry.periodStart) {
					const x = chartLeft + index / Math.max(1, selected.length - 1) * chartWidth;
					pdf.setDrawColor(217, 75, 122);
					pdf.setLineDashPattern([3, 3], 0);
					pdf.line(x, chartTop, x, chartTop + chartHeight);
					pdf.setLineDashPattern([], 0);
				}
			});
			const colors = [
				[
					217,
					75,
					122
				],
				[
					73,
					63,
					59
				],
				[
					235,
					185,
					70
				],
				[
					183,
					92,
					118
				],
				[
					120,
					107,
					102
				]
			];
			CORE_METRICS.forEach((metric, metricIndex) => {
				pdf.setDrawColor(...colors[metricIndex]);
				pdf.setLineWidth(1.7);
				selected.slice(1).forEach((entry, index) => {
					const previous = selected[index];
					const x1 = chartLeft + index / Math.max(1, selected.length - 1) * chartWidth;
					const x2 = chartLeft + (index + 1) / Math.max(1, selected.length - 1) * chartWidth;
					const y1 = chartTop + chartHeight - (previous[metric] - 1) / 4 * chartHeight;
					const y2 = chartTop + chartHeight - (entry[metric] - 1) / 4 * chartHeight;
					pdf.line(x1, y1, x2, y2);
				});
			});
			pdf.setFontSize(7);
			pdf.setTextColor(73, 63, 59);
			pdf.text("1–5 daily scores. Pink dashed lines mark reported period starts.", chartLeft, chartTop + chartHeight + 14);
			pdf.text("Mood", 78, 323);
			pdf.text("Energy", 125, 323);
			pdf.text("Bloating", 180, 323);
			pdf.text("Pain", 240, 323);
			pdf.text("Sleep", 280, 323);
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(11);
			pdf.text("Observed pattern summary", left, 354);
			pdf.setFont("helvetica", "normal");
			pdf.setFontSize(9);
			const summaryLines = pdf.splitTextToSize(summary, width);
			pdf.text(summaryLines, left, 370);
			const bleedingDays = selected.filter((entry) => entry.bleeding && entry.bleeding !== "none");
			const heavyDays = selected.filter((entry) => entry.bleeding === "heavy");
			const signCounts = /* @__PURE__ */ new Map();
			selected.flatMap((entry) => entry.symptomSigns || []).forEach((sign) => signCounts.set(sign, (signCounts.get(sign) || 0) + 1));
			const frequentSigns = [...signCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([sign, count]) => `${sign} (${count} day${count === 1 ? "" : "s"})`);
			const medicationLabels = {
				none: "No hormonal medication reported",
				combined_contraceptive: "Combined hormonal contraceptive",
				progestin_or_iud: "Progestin-only contraception or hormonal IUD",
				hrt: "Hormone replacement therapy",
				fertility_medication: "Fertility medication",
				prefer_not_to_say: "Medication status not disclosed"
			};
			const latestMedication = [...selected].reverse().find((entry) => entry.hormoneMedication)?.hormoneMedication;
			const observationText = `Bleeding was recorded on ${bleedingDays.length} day${bleedingDays.length === 1 ? "" : "s"}${heavyDays.length ? `, including ${heavyDays.length} heavy-flow day${heavyDays.length === 1 ? "" : "s"}` : ""}. ${frequentSigns.length ? `Other reported signs: ${frequentSigns.join(", ")}.` : "No optional symptom signs were selected."} Most recent medication response: ${latestMedication ? medicationLabels[latestMedication] : "not recorded"}.`;
			const observationLines = pdf.splitTextToSize(observationText, width);
			pdf.text(observationLines, left, 370 + summaryLines.length * 11 + 7);
			let y = 370 + (summaryLines.length + observationLines.length) * 11 + 25;
			pdf.setFont("helvetica", "bold");
			pdf.setFontSize(11);
			pdf.text("Original Elowen context", left, y);
			y += 16;
			pdf.setFont("helvetica", "normal");
			pdf.setFontSize(9);
			pdf.text(pdf.splitTextToSize(`${props.predictionLabel} (${(props.confidence * 100).toFixed(1)}% confidence in this survey label). ${props.referralGuidance} Why: ${props.referralWhy}`, width), left, y);
			pdf.setFontSize(8);
			pdf.setTextColor(120, 107, 102);
			pdf.text(pdf.splitTextToSize("Research and awareness only. This report does not diagnose a condition, determine urgency, or recommend treatment. Discuss health questions with a healthcare provider.", width), left, 730);
			const blob = pdf.output("blob");
			const file = new File([blob], `elowen-${windowDays}-day-doctor-report.pdf`, { type: "application/pdf" });
			if (share && navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({
				files: [file],
				title: "Elowen doctor report",
				text: "My Elowen symptom-trend report for our conversation."
			});
			else pdf.save(file.name);
			setMessage(share ? "Your report is ready to share." : "Your PDF report has been downloaded.");
		} catch {
			setMessage("The report could not be created right now.");
		} finally {
			setSaving(false);
		}
	}
	const todayEntry = entries.find((entry) => entry.date === today);
	const streak = consecutiveCheckInDays(entries, today);
	const todayNumber = Number(today.slice(-2));
	const monthPrefix = today.slice(0, 8);
	const monthEntries = new Set(entries.filter((entry) => entry.date.startsWith(monthPrefix)).map((entry) => Number(entry.date.slice(-2))));
	const mostRecent = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0];
	const missedDays = mostRecent ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${mostRecent.date}T00:00:00Z`)) / 864e5) : 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "tracker-section",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "tracker-heading",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "eyebrow",
						children: "Daily pattern tracking"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "A clearer story over time" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "A 15–30 second daily check-in can create a more useful report for a healthcare conversation. Entries stay on this device unless you opted into anonymous research sharing." })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "secondary-button",
					onClick: () => {
						setDraft(emptyDraft(todayEntry));
						setOpen(true);
					},
					children: todayEntry ? "View or edit today’s check-in" : "Check in today"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "report-actions",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Report window" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						value: windowDays,
						onChange: (event) => setWindowDays(Number(event.target.value)),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "14",
							children: "Past 2 weeks"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "30",
							children: "Past month"
						})]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "primary-button",
						disabled: saving,
						onClick: () => createReport(false),
						children: "Download report PDF"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "secondary-button",
						disabled: saving,
						onClick: () => createReport(true),
						children: "Share report with my doctor"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: entries.length ? `${entries.length} check-in${entries.length === 1 ? "" : "s"} saved on this device.` : "No check-ins yet. Your report will use whatever history is available." })
				]
			}),
			message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "tracker-message",
				role: "status",
				children: message
			}),
			open && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "checkin-overlay",
				role: "dialog",
				"aria-modal": "true",
				"aria-labelledby": "checkin-title",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "checkin-card",
					onSubmit: saveCheckIn,
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "checkin-top",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "eyebrow",
								children: "Today"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								id: "checkin-title",
								children: "Daily check-in"
							})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "close-button",
								onClick: () => setOpen(false),
								"aria-label": "Close check-in",
								children: "Close"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "bloom-progress",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
								src: "/flower-checkin-journey.png",
								alt: "Seven stages of the Elowen flower"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
								"Bloom stage ",
								Math.min(7, Math.max(1, streak + (todayEntry ? 0 : 1))),
								" of 7"
							] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Each check-in grows your record. Missing a day does not reset what you have learned." })] })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "adherence-strip",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [streak, "-day streak"] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: missedDays > 1 ? "Welcome back. Pick up whenever works for you." : "Small check-ins can make patterns easier to see." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "month-dots",
								"aria-label": `${monthEntries.size} check-ins this month`,
								children: Array.from({ length: todayNumber }, (_, index) => index + 1).map((day) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: monthEntries.has(day) ? "filled" : "",
									title: `${monthPrefix}${String(day).padStart(2, "0")}: ${monthEntries.has(day) ? "checked in" : "no check-in"}`
								}, day))
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
							className: "voice-note",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Talk through today’s check-in" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Say how you feel, whether you are bleeding, and any symptoms. Elowen will fill matching answers for you to review." })] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "secondary-button",
									onClick: startVoiceNote,
									disabled: voiceListening,
									children: voiceListening ? "Listening" : "Start voice note"
								}),
								voiceNote && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", {
									role: "status",
									children: voiceNote
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "scale-list",
							children: CORE_METRICS.map((metric) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: metricLabels[metric] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "scale-buttons",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: lowLabels[metric] }),
									[
										1,
										2,
										3,
										4,
										5
									].map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: draft[metric] === value ? "selected" : "",
										onClick: () => setScore(metric, value),
										"aria-pressed": draft[metric] === value,
										children: value
									}, value)),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: highLabels[metric] })
								]
							})] }, metric))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", {
							className: "medication-question",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "Are you currently using hormonal birth control, hormone therapy, or fertility medication?" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
								value: draft.hormoneMedication || "",
								onChange: (event) => setDraft((current) => ({
									...current,
									hormoneMedication: event.target.value
								})),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "",
										children: "Choose one"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "none",
										children: "No"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "combined_contraceptive",
										children: "Yes: combined hormonal contraceptive (pill, patch, ring)"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "progestin_or_iud",
										children: "Yes: progestin-only or hormonal IUD"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "hrt",
										children: "Yes: hormone replacement therapy (HRT)"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "fertility_medication",
										children: "Yes: fertility medication"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "prefer_not_to_say",
										children: "Prefer not to say"
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", {
							className: "period-question",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "Are you on your period today?" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: !draft.onPeriod ? "selected" : "",
								onClick: () => setDraft((current) => ({
									...current,
									onPeriod: false,
									periodStart: false
								})),
								children: "No"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: draft.onPeriod ? "selected" : "",
								onClick: () => setDraft((current) => ({
									...current,
									onPeriod: true
								})),
								children: "Yes"
							})] })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", {
							className: "bleeding-question",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "Bleeding today" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: [
								"none",
								"spotting",
								"light",
								"moderate",
								"heavy"
							].map((flow) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: draft.bleeding === flow ? "selected" : "",
								onClick: () => setDraft((current) => ({
									...current,
									bleeding: flow
								})),
								children: flow[0].toUpperCase() + flow.slice(1)
							}, flow)) })]
						}),
						draft.onPeriod && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "period-details",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "About your period today" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", {
									className: "period-question",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "Did your period start today?" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: !draft.periodStart ? "selected" : "",
										onClick: () => setDraft((current) => ({
											...current,
											periodStart: false
										})),
										children: "No"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: draft.periodStart ? "selected" : "",
										onClick: () => setDraft((current) => ({
											...current,
											periodStart: true
										})),
										children: "Yes"
									})] })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "Cramp severity" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "scale-buttons",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "None" }),
										[
											1,
											2,
											3,
											4,
											5
										].map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: draft.periodCramps === value ? "selected" : "",
											onClick: () => setDraft((current) => ({
												...current,
												periodCramps: value
											})),
											children: value
										}, value)),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "Severe" })
									]
								})] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Clots today" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
									value: draft.periodClots || "",
									onChange: (event) => setDraft((current) => ({
										...current,
										periodClots: event.target.value
									})),
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "",
											children: "Choose one"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "none",
											children: "None"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "small",
											children: "Small"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "large",
											children: "Large"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "prefer_not_to_say",
											children: "Prefer not to say"
										})
									]
								})] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Impact on daily activities" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
									value: draft.periodImpact || "",
									onChange: (event) => setDraft((current) => ({
										...current,
										periodImpact: event.target.value
									})),
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "",
											children: "Choose one"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "none",
											children: "None"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "some",
											children: "Some"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "a_lot",
											children: "A lot"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "unable",
											children: "Unable to do usual activities"
										})
									]
								})] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Digestive changes" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
									value: draft.periodGi || "",
									onChange: (event) => setDraft((current) => ({
										...current,
										periodGi: event.target.value
									})),
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "",
											children: "Choose one"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "none",
											children: "None"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "nausea",
											children: "Nausea"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "diarrhea",
											children: "Diarrhea"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "constipation",
											children: "Constipation"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "painful_bowel_movements",
											children: "Painful bowel movements"
										})
									]
								})] })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", {
							className: "signs-question",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("legend", { children: ["Other signs today ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "Optional" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: symptomSigns.map((sign) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: draft.symptomSigns?.includes(sign) ? "selected" : "",
								onClick: () => toggleSign(sign),
								"aria-pressed": draft.symptomSigns?.includes(sign),
								children: sign
							}, sign)) })]
						}),
						props.showHotFlashes && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "Hot flashes or night sweats severity" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "scale-buttons",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "None" }),
								[
									1,
									2,
									3,
									4,
									5
								].map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: draft.hotFlashes === value ? "selected" : "",
									onClick: () => setScore("hotFlashes", value),
									children: value
								}, value)),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "Severe" })
							]
						})] }),
						showWeekly && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "weekly-row",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Skin/acne changes this week" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
								value: draft.skinChanges || "",
								onChange: (event) => setDraft((current) => ({
									...current,
									skinChanges: Number(event.target.value) || null
								})),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "",
										children: "Skip"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "1",
										children: "None"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "3",
										children: "Noticeable"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "5",
										children: "Strong"
									})
								]
							})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Hair changes this week" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
								value: draft.hairChanges || "",
								onChange: (event) => setDraft((current) => ({
									...current,
									hairChanges: Number(event.target.value) || null
								})),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "",
										children: "Skip"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "1",
										children: "None"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "3",
										children: "Noticeable"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "5",
										children: "Strong"
									})
								]
							})] })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "checkin-submit",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "primary-button",
								type: "submit",
								children: "Save today’s check-in"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: props.consent ? "Your opt-in is on, so an anonymous copy also contributes to research." : "Saved locally only. Research sharing is off." })]
						}),
						message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "error-message",
							children: message
						})
					]
				})
			})
		]
	});
}
//#endregion
//#region app/screening-utils.ts
function day(value) {
	return Date.parse(`${value}T00:00:00Z`) / 864e5;
}
function buildScreeningInsights(input, entries) {
	const irregular = [
		"Sometimes irregular",
		"Very irregular",
		"No recent periods"
	].includes(input.periodPattern || "");
	const androgenSigns = ["Increased growth in new areas", "Both thinning and increased growth"].includes(input.hairChanges || "") || ["Noticeable", "Strong"].includes(input.skinChanges || "");
	const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
	const periodDays = sorted.filter((entry) => entry.periodStart).map((entry) => day(entry.date));
	const perimenstrual = sorted.filter((entry) => periodDays.some((anchor) => Math.abs(day(entry.date) - anchor) <= 2));
	const enoughLongitudinal = sorted.length >= 14 && periodDays.length >= 2;
	const repeatedSeverePeriodPain = enoughLongitudinal && perimenstrual.length >= 4 && perimenstrual.reduce((sum, entry) => sum + entry.pain, 0) / perimenstrual.length >= 4;
	const phqAnswered = Number.isInteger(input.phqInterest) && Number.isInteger(input.phqMood);
	const phqThreshold = phqAnswered && Number(input.phqInterest) + Number(input.phqMood) >= 3;
	return {
		pcos: {
			matched: [irregular, androgenSigns],
			flag: irregular && androgenSigns
		},
		endometriosis: {
			matched: [enoughLongitudinal, repeatedSeverePeriodPain],
			flag: repeatedSeverePeriodPain,
			enoughData: enoughLongitudinal
		},
		osteoporosis: {
			matched: [
				input.age >= 65,
				input.naturalLabel,
				input.bmi < 21,
				input.smoking === "Current smoker",
				input.parentalHipFracture === "Yes"
			],
			flag: input.age >= 65 || input.naturalLabel && (input.bmi < 21 || input.smoking === "Current smoker" || input.parentalHipFracture === "Yes")
		},
		depression: {
			matched: [Number(input.phqInterest) > 0, Number(input.phqMood) > 0],
			flag: Boolean(phqThreshold),
			answered: phqAnswered
		}
	};
}
//#endregion
//#region app/ScreeningInsights.tsx
var STORAGE_KEY = "elowen.daily-checkins.v1";
function Checklist({ items, matched }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: items.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: matched[index] ? "matched" : "",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { "aria-hidden": "true" }), item]
	}, item)) });
}
function ScreeningInsights({ input }) {
	const [entries, setEntries] = (0, import_react.useState)([]);
	(0, import_react.useEffect)(() => {
		const load = () => {
			try {
				setEntries(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
			} catch {
				setEntries([]);
			}
		};
		const timer = window.setTimeout(load, 0);
		window.addEventListener("elowen-checkins-updated", load);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("elowen-checkins-updated", load);
		};
	}, []);
	const result = buildScreeningInsights(input, entries);
	const count = (values) => values.filter(Boolean).length;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "screening-section",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "section-title",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "eyebrow",
					children: "Screening insights"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Separate checks, with separate rules" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Screening flags based on published clinical criteria, not the trained model." }), " These checks do not change your Elowen probability and cannot diagnose a condition."] })
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "screening-grid",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "PCOS patterns" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [count(result.pcos.matched), " of 2 observable checks"] })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checklist, {
						matched: result.pcos.matched,
						items: ["Irregular or absent recent cycles reported", "Hair-growth or notable skin-change signs reported"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: result.pcos.flag ? "Both observable pattern domains are present. Clinical evaluation is needed to confirm hyperandrogenism, exclude other causes, and assess full diagnostic criteria." : "The available responses do not match both observable pattern domains." }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
						className: "next-step",
						children: "Next step: discuss persistent cycle and androgen-related signs with an OB-GYN or endocrinologist."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						href: "https://www.monash.edu/__data/assets/pdf_file/0003/3379521/Evidence-Based-Guidelines-2023.pdf",
						target: "_blank",
						rel: "noreferrer",
						children: "2023 International PCOS Guideline"
					})
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Endometriosis-related pain" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [count(result.endometriosis.matched), " of 2 tracker checks"] })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checklist, {
						matched: result.endometriosis.matched,
						items: ["At least 14 check-ins spanning 2 reported period starts", "Repeated average pain of 4/5 or higher around period starts"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: !result.endometriosis.enoughData ? "Not enough longitudinal history yet. This flag cannot activate from a one-time answer." : result.endometriosis.flag ? "A sustained period-related severe-pain pattern is present in the tracker. This is worth clinical discussion." : "Enough history is available, but the defined sustained severe-pain pattern was not observed." }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
						className: "next-step",
						children: "Next step: bring the symptom report to an OB-GYN, especially if pain affects daily life."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						href: "https://www.nice.org.uk/guidance/ng73/chapter/Recommendations",
						target: "_blank",
						rel: "noreferrer",
						children: "NICE endometriosis guidance"
					})
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Bone-health screening" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [count(result.osteoporosis.matched), " of 5 review factors"] })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checklist, {
						matched: result.osteoporosis.matched,
						items: [
							"Age 65 or older",
							"Model label is closer to self-reported natural menopause",
							"BMI below 21",
							"Current smoking reported",
							"Parental hip fracture reported"
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: result.osteoporosis.flag ? "One or more factors support discussing formal fracture-risk assessment or bone-density screening. The model label is not a clinical menopause diagnosis." : "The available profile does not trigger this lightweight review rule." }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
						className: "next-step",
						children: "Next step: ask whether a validated risk tool and DXA screening are appropriate."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						href: "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/osteoporosis-screening",
						target: "_blank",
						rel: "noreferrer",
						children: "USPSTF osteoporosis screening"
					})
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Depression first-pass screen" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: result.depression.answered ? `${count(result.depression.matched)} of 2 symptoms present` : "Not completed" })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checklist, {
						matched: result.depression.matched,
						items: ["Reduced interest or pleasure reported", "Feeling down, depressed, or hopeless reported"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: !result.depression.answered ? "Complete both optional PHQ-2 questions to use this check." : result.depression.flag ? "The standard PHQ-2 follow-up threshold is met. This does not diagnose depression, but it is worth bringing to a doctor or counselor." : "The standard PHQ-2 follow-up threshold is not met from these answers." }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
						className: "next-step",
						children: "Next step: share how you have been feeling with a qualified healthcare professional if you want support."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						href: "https://pubmed.ncbi.nlm.nih.gov/32515813/",
						target: "_blank",
						rel: "noreferrer",
						children: "PHQ-2 diagnostic meta-analysis"
					})
				] })
			]
		})]
	});
}
//#endregion
//#region app/page.tsx
var symptomOptions = {
	fatigue: [
		"Not noticeable",
		"Mild",
		"Moderate",
		"Strong"
	],
	weightChange: [
		"No recent change",
		"Lost weight",
		"Gained weight",
		"Unsure"
	],
	periodPattern: [
		"Regular",
		"Sometimes irregular",
		"Very irregular",
		"No recent periods"
	],
	periodPain: [
		"None",
		"Mild",
		"Moderate",
		"Severe"
	],
	pain: [
		"None",
		"Occasional",
		"Frequent",
		"Daily"
	],
	skinChanges: [
		"No change",
		"Mild",
		"Noticeable",
		"Strong"
	],
	hairChanges: [
		"No change",
		"Thinning",
		"Increased growth in new areas",
		"Both thinning and increased growth"
	],
	sleepQuality: [
		"Very good",
		"Good",
		"Fair",
		"Poor",
		"Very poor"
	]
};
var featureUnits = {
	age_years: "years",
	bmi: "",
	testosterone_ng_dl: "ng/dL",
	shbg_nmol_l: "nmol/L"
};
var additionalLabFields = [
	{
		key: "fsh",
		label: "FSH",
		unit: "IU/L",
		note: "Can add ovarian-function context, but fluctuates and is not a stand-alone menopause diagnosis."
	},
	{
		key: "lh",
		label: "LH",
		unit: "IU/L",
		note: "Usually interpreted with cycle timing and other findings; the LH:FSH ratio alone does not diagnose PCOS."
	},
	{
		key: "estradiol",
		label: "Estradiol",
		unit: "pg/mL",
		note: "Varies substantially across the menstrual cycle and with hormone therapy."
	},
	{
		key: "progesterone",
		label: "Progesterone",
		unit: "ng/mL",
		note: "Timing matters; clinicians may use it as context for recent ovulation."
	},
	{
		key: "prolactin",
		label: "Prolactin",
		unit: "ng/mL",
		note: "Often checked when evaluating absent or irregular periods."
	},
	{
		key: "dheas",
		label: "DHEA-S",
		unit: "µg/dL",
		note: "An adrenal androgen interpreted with symptoms, age, and laboratory ranges."
	},
	{
		key: "tsh",
		label: "TSH",
		unit: "mIU/L",
		note: "Thyroid dysfunction can overlap with menstrual and menopause-like symptoms."
	},
	{
		key: "freeT4",
		label: "Free T4",
		unit: "ng/dL",
		note: "Interpreted with TSH and the laboratory’s own reference interval."
	},
	{
		key: "freeT3",
		label: "Free T3",
		unit: "pg/mL",
		note: "Additional thyroid context; not routinely necessary in every evaluation."
	},
	{
		key: "tpoAntibodies",
		label: "TPO antibodies",
		unit: "IU/mL",
		note: "May provide autoimmune-thyroid context when clinically indicated."
	},
	{
		key: "cortisol",
		label: "Cortisol",
		unit: "µg/dL",
		note: "Strongly depends on collection time, medication, stress, and test method."
	}
];
function FieldNote({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "field-note",
		children
	});
}
function formatPercent(value) {
	return `${(value * 100).toFixed(1)}%`;
}
var biasQuestions = [
	"Does the study include the population it makes claims about?",
	"Does it measure women’s health outcomes directly, not only use sex as a checkbox?",
	"Are menstrual stage, cycle timing, pregnancy, contraception, and hormone therapy handled when relevant?",
	"Are results reported separately enough to detect differences by age, race or ethnicity, and other important groups?",
	"Does the analysis account for sampling, missing data, and loss to follow-up?",
	"Does it distinguish association from causation?",
	"Are limitations and potential harms for underrepresented groups stated clearly?"
];
function BiasChecklist() {
	const [checked, setChecked] = (0, import_react.useState)([]);
	const score = checked.length;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "landing-bias",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "eyebrow",
				children: "Research bias check"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Does this study actually support women’s health?" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Use this quick checklist when reading a study, health claim, or AI result. A lower score does not prove misconduct. It signals questions worth asking before trusting the conclusion." })
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "bias-checklist",
			children: [biasQuestions.map((question, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				type: "checkbox",
				checked: checked.includes(index),
				onChange: () => setChecked((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: question })] }, question)), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "bias-score",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
					score,
					" of ",
					biasQuestions.length,
					" safeguards visible"
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: score >= 6 ? "Strong transparency signals. Still check whether the methods match the claim." : score >= 3 ? "Mixed support. Read the missing safeguards and limitations carefully." : "Important information is missing. Treat broad or clinical claims cautiously." })]
			})]
		})]
	});
}
var providerSpecialties = {
	obgyn: { label: "OB-GYN" },
	endocrine: { label: "endocrinologist" }
};
function Donut({ probability, label }) {
	const radius = 82;
	const circumference = 2 * Math.PI * radius;
	const natural = probability * circumference;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "donut-wrap",
		role: "img",
		"aria-label": `${label}. ${Math.round(probability * 100)} percent natural-menopause survey likelihood.`,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
			viewBox: "0 0 210 210",
			"aria-hidden": "true",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
					className: "donut-bg",
					cx: "105",
					cy: "105",
					r: radius
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
					className: "donut-recent",
					cx: "105",
					cy: "105",
					r: radius,
					strokeDasharray: `${circumference - natural} ${circumference}`
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
					className: "donut-natural",
					cx: "105",
					cy: "105",
					r: radius,
					strokeDasharray: `${natural} ${circumference}`,
					strokeDashoffset: -(circumference - natural)
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "donut-center",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [Math.max(probability, 1 - probability) * 100 < 99.95 ? (Math.max(probability, 1 - probability) * 100).toFixed(1) : ">99.9", "%"] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label })]
		})]
	});
}
function PercentileRow({ label, value, percentile, unit }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "percentile-row",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: label }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: value === null ? "Not provided" : `${value.toFixed(label === "Age" ? 0 : 1)}${unit ? ` ${unit}` : ""}` })] }), percentile === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Not available without this value" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "percentile-track",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${Math.max(3, percentile)}%` } })
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [percentile, "th percentile in this age band"] })] })]
	});
}
function Results({ prediction, inputs, research, onReset }) {
	const [zip, setZip] = (0, import_react.useState)("");
	const [providers, setProviders] = (0, import_react.useState)([]);
	const [providerLoading, setProviderLoading] = (0, import_react.useState)(false);
	const [providerMessage, setProviderMessage] = (0, import_react.useState)("");
	const [selectedProvider, setSelectedProvider] = (0, import_react.useState)(null);
	const [shareConsent, setShareConsent] = (0, import_react.useState)(false);
	const [requestType, setRequestType] = (0, import_react.useState)(null);
	const natural = prediction.predictedClass === "self_reported_natural_menopause";
	const resultLabel = natural ? "Closer to natural menopause" : "Closer to recent menstruation";
	const confidenceClass = prediction.inputBasis === "age_bmi_hormones" ? "Full information" : prediction.inputBasis === "age_bmi_only" ? "Limited information" : "Partial information";
	const factors = prediction.explanation.topFactors.filter((item) => {
		if (item.feature === "testosterone_ng_dl") return inputs.testosterone !== null;
		if (item.feature === "shbg_nmol_l") return inputs.shbg !== null;
		return true;
	});
	const maxContribution = Math.max(...factors.map((item) => Math.abs(item.contribution)), .01);
	const providerKinds = prediction.referralGuidance.category === "reproductive" ? ["obgyn"] : prediction.referralGuidance.category === "systemic" ? ["endocrine"] : ["obgyn", "endocrine"];
	async function findProviders(kind) {
		if (!/^\d{5}$/.test(zip)) {
			setProviderMessage("Enter a five-digit ZIP code to search the national provider registry.");
			return;
		}
		setProviderLoading(true);
		setProviderMessage("");
		setProviders([]);
		try {
			const body = await (await fetch(`/api/providers?specialty=${kind}&zip=${zip}`)).json();
			setProviders(body.providers || []);
			if (!body.providers?.length) setProviderMessage("No matching registry records were found for this ZIP code. Try a nearby ZIP code.");
		} catch {
			setProviderMessage("Provider records are temporarily unavailable. Try again later.");
		} finally {
			setProviderLoading(false);
		}
	}
	async function downloadPrep() {
		const printWindow = window.open("", "elowen-visit-preparation", "width=820,height=900");
		const response = await fetch("/api/doctor-prep", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...inputs,
				predictedClass: prediction.predictedClass,
				probabilityNaturalMenopause: prediction.probabilityNaturalMenopause,
				topFactors: factors
			})
		});
		if (!response.ok) {
			printWindow?.close();
			return;
		}
		const escaped = (await response.json()).text.replace(/[&<>]/g, (character) => ({
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;"
		})[character] || character);
		if (printWindow) {
			printWindow.document.write(`<!doctype html><html><head><title>Elowen visit preparation</title><style>@page{size:letter;margin:.6in}body{font:14px/1.45 Arial;color:#493f3b;max-width:7.3in;margin:auto}pre{white-space:pre-wrap;font:inherit}button{position:fixed;right:18px;top:18px;padding:10px 16px;border:0;border-radius:8px;background:#d94b7a;color:white;font-weight:700}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print or save PDF</button><pre>${escaped}</pre></body></html>`);
			printWindow.document.close();
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "results-page",
		id: "results",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "always-disclaimer",
				children: "Not a diagnosis. Use this result to start a conversation with a healthcare provider."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "results-hero",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "result-copy",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "eyebrow",
							children: "Your Elowen result"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", { children: [
							"Your result,",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: "with honest context." })
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "lede",
							children: [
								"Your information looks more like the survey pattern labeled ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: natural ? "self-reported natural menopause" : "recent menstruation" }),
								". This is not a clinical reproductive stage."
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: `information-badge ${prediction.inputBasis !== "age_bmi_hormones" ? "limited" : ""}`,
							children: confidenceClass
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "basis-copy",
							children: prediction.inputBasis === "age_bmi_only" ? "This result used age and BMI only. Missing blood-test values make the context less complete." : prediction.inputBasis === "age_bmi_partial_hormones" ? "This result used age, BMI, and one blood-test value. Missing information adds uncertainty." : "This result used age, BMI, testosterone, and SHBG."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "text-button",
							onClick: onReset,
							children: "Start over"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "chart-card",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Donut, {
						probability: prediction.probabilityNaturalMenopause,
						label: resultLabel
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "legend",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "recent-dot" }),
							"Recent menstruation ",
							formatPercent(prediction.probabilityRecentMenstruation)
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "natural-dot" }),
							"Natural menopause ",
							formatPercent(prediction.probabilityNaturalMenopause)
						] })]
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "context-section",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "section-title",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "eyebrow",
							children: "Population context"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "How your values compare" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
							"Compared with ",
							prediction.populationContext.referenceRows.toLocaleString(),
							" people in the model’s training data who were age ",
							prediction.populationContext.ageBand,
							"."
						] })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "percentile-card",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PercentileRow, {
							label: "Age",
							value: inputs.age,
							percentile: prediction.populationContext.percentiles.age_years,
							unit: featureUnits.age_years
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PercentileRow, {
							label: "BMI",
							value: inputs.bmi,
							percentile: prediction.populationContext.percentiles.bmi,
							unit: ""
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PercentileRow, {
							label: "Testosterone",
							value: inputs.testosterone,
							percentile: prediction.populationContext.percentiles.testosterone_ng_dl,
							unit: featureUnits.testosterone_ng_dl
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PercentileRow, {
							label: "SHBG",
							value: inputs.shbg,
							percentile: prediction.populationContext.percentiles.shbg_nmol_l,
							unit: featureUnits.shbg_nmol_l
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "honesty-section",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "elm-light",
						"aria-hidden": "true",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "honesty-copy",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "eyebrow",
								children: "Honesty as a feature"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "What shaped this result" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Longer bars had more influence on this particular result. Direction shows whether a value moved the result toward the natural-menopause label or toward recent menstruation." })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "factor-card",
						children: factors.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "factor-row",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.label }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {
									className: item.contribution >= 0 ? "toward-natural" : "toward-recent",
									style: { width: `${Math.max(6, Math.abs(item.contribution) / maxContribution * 100)}%` }
								}) }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: item.contribution >= 0 ? "Toward natural menopause" : "Toward recent menstruation" })
							]
						}, item.feature))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
						className: "truth-card",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "The wider finding" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
								"Across the held-out data, age accounted for ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: formatPercent(prediction.honestComparison.ageGlobalShare) }),
								" of overall influence."
							] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Full information" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: formatPercent(prediction.honestComparison.fullModelAccuracy) })] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Without age" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: formatPercent(prediction.honestComparison.hormonesOnlyAccuracy) })] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Simple baseline" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: formatPercent(prediction.honestComparison.majorityBaselineAccuracy) })] })
							] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "small-copy",
								children: "In this dataset, BMI and the two hormone measurements added little predictive value beyond age. That limitation is part of the result."
							})
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "bias-section",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "section-title",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "eyebrow",
								children: "Research bias check"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Useful evidence designed with important limits" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "NHANES is a high-quality public-health survey. But a rigorous study can still be a poor fit for an individual diagnostic question. This audit separates strengths from limitations and explains who could be underserved." })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "bias-grid",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
								className: "bias-strength",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "What the design does well" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Standardized examinations, laboratory measurements, and a probability sample make NHANES valuable for population research when survey design and weights are handled correctly." })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Cross-sectional, not causal" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "One-time measurements cannot establish what caused a symptom, hormone level, or menopause. Elowen therefore reports associations and survey-label similarity only." })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Coverage is incomplete" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "NHANES represents the civilian, non-institutionalized U.S. population. People in institutions, active-duty military populations, and people outside that frame are not represented." })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Unequal subgroup precision" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "The 2021–2023 design stopped oversampling by race, Hispanic origin, and income. NCHS warns that some subgroup estimates have lower precision and that combining this cycle with earlier data requires caution." })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "The label rewards age" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "The target is recent menstruation versus self-reported natural menopause, not a complete clinical stage. Because these labels are intrinsically age-linked, the model’s 96.8% age share can look impressive while adding little biological insight." })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Women’s-health detail is missing" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Cycle timing, longitudinal hormone change, medications, hysterectomy context, and many clinically used tests are absent or incomplete. That can flatten diverse experiences into an overly simple binary label." })] })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "bias-conclusion",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Bottom line" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "This design is appropriate for an explainable research demonstration, but not sufficient for diagnosis, causal claims, or equitable clinical decision-making. The limitation is not that participants’ experiences are unreliable; it is that the study was not built to capture the full biological and social complexity of women’s hormonal health." }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "source-list",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Primary sources" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
										href: "https://wwwn.cdc.gov/nchs/nhanes/tutorials/sampledesign.aspx",
										target: "_blank",
										rel: "noreferrer",
										children: "CDC/NCHS: NHANES sample design and exclusions"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
										href: "https://wwwn.cdc.gov/nchs/nhanes/continuousnhanes/overviewbrief.aspx?Cycle=2021-2023",
										target: "_blank",
										rel: "noreferrer",
										children: "CDC/NCHS: 2021–2023 design and nonresponse guidance"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
										href: "https://www.nationalacademies.org/publications/27757",
										target: "_blank",
										rel: "noreferrer",
										children: "National Academies: gaps in research on chronic conditions in women"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
										href: "https://www.nice.org.uk/guidance/QS143/chapter/Quality-statement-1-Diagnosing-perimenopause-and-menopause",
										target: "_blank",
										rel: "noreferrer",
										children: "NICE: menopause diagnosis and limits of hormone testing"
									})
								]
							})
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScreeningInsights, { input: {
				age: inputs.age,
				bmi: inputs.bmi,
				naturalLabel: natural,
				periodPattern: String(inputs.symptoms.periodPattern || ""),
				hairChanges: String(inputs.symptoms.hairChanges || ""),
				skinChanges: String(inputs.symptoms.skinChanges || ""),
				smoking: String(inputs.symptoms.smoking || ""),
				parentalHipFracture: String(inputs.symptoms.parentalHipFracture || ""),
				phqInterest: inputs.symptoms.phqInterest === null ? null : Number(inputs.symptoms.phqInterest),
				phqMood: inputs.symptoms.phqMood === null ? null : Number(inputs.symptoms.phqMood)
			} }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "advisor-section",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "section-title",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "eyebrow",
							children: "We need more data"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "What another value could add" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "These estimates use real values from people in the same training-data age band and rerun the saved model. They show possible movement, not a promised improvement." })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "advisor-grid",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "advisor-card",
						children: prediction.missingDataAdvisor.missingInputs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "You’ve provided everything this tool currently uses" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "You provided age, height and weight, testosterone, and SHBG." })] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: prediction.missingDataAdvisor.recommendation }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "missing-list",
								children: ["Missing: ", prediction.missingDataAdvisor.missingInputs.join(" and ")]
							}),
							prediction.missingDataAdvisor.simulations.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "simulation-row",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.input }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
									"Across ",
									item.simulations,
									" simulations, adding this value changed the predicted probability by ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: formatPercent(item.expectedProbabilityChange) }),
									" on average. The simulated result ranged from ",
									formatPercent(item.simulatedProbabilityRange[0]),
									" to ",
									formatPercent(item.simulatedProbabilityRange[1]),
									" natural-menopause likelihood."
								] })]
							}, item.input))
						] })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "symptom-card",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Your symptom context" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: prediction.symptomContext })]
					})]
				})]
			}),
			Object.values(inputs.additionalLabs).some((value) => value !== null) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "additional-context-section",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "section-title",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "eyebrow",
							children: "Additional clinical context"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Values to bring to your clinician" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "These values were not inputs to Elowen’s trained model and did not change the probability above. They are included because a clinician may find them useful alongside symptoms, cycle timing, medications, and the reporting laboratory’s ranges." })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "additional-lab-grid",
					children: additionalLabFields.filter((field) => inputs.additionalLabs[field.key] !== null).map((field) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: field.label }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
							inputs.additionalLabs[field.key],
							" ",
							field.unit
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: field.note })
					] }, field.key))
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "referral-section",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "line-icon clinician-icon",
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "eyebrow",
						children: "What kind of doctor should I talk to?"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "A reasonable place to start" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "referral-guidance",
						children: prediction.referralGuidance.guidance
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Why:" }),
						" ",
						prediction.referralGuidance.why
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "provider-finder",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "ZIP code" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: zip,
								onChange: (event) => setZip(event.target.value.replace(/\D/g, "").slice(0, 5)),
								inputMode: "numeric",
								autoComplete: "postal-code",
								placeholder: "e.g. 60601",
								"aria-describedby": "provider-finder-note"
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "provider-links",
								children: providerKinds.map((kind) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "primary-button provider-link",
									disabled: providerLoading,
									onClick: () => findProviders(kind),
									children: [
										"Find an ",
										providerSpecialties[kind].label,
										" near me"
									]
								}, kind))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								id: "provider-finder-note",
								children: "Results appear here from the public U.S. National Provider Identifier registry. Elowen sends only the ZIP code and specialty, not your result or symptom answers. Registry listing does not confirm appointment availability or acceptance of new patients."
							}),
							providerMessage && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "provider-message",
								role: "status",
								children: providerMessage
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "provider-results",
								children: [providers.map((provider) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: provider.name }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: provider.specialty })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: provider.practice }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: provider.address }),
									provider.phone && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
										href: `tel:${provider.phone}`,
										children: provider.phone
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
										"NPI ",
										provider.npi,
										" · Verify insurance and availability directly"
									] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "secondary-button",
										onClick: () => {
											setSelectedProvider(provider);
											setShareConsent(false);
											setRequestType(null);
										},
										children: "Select this provider"
									})
								] }, provider.npi)), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
									className: "demo-provider",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: ["Dr. Sara P. ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "Demo clinician" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "OB-GYN" })] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Fictional demonstration profile. This is not a real provider or bookable listing." }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: "secondary-button",
											onClick: () => {
												setSelectedProvider({
													npi: "demo",
													name: "Dr. Sara P.",
													specialty: "OB-GYN",
													practice: "Fictional demonstration profile",
													address: "No real practice address",
													phone: null,
													demo: true
												});
												setShareConsent(false);
												setRequestType(null);
											},
											children: "Try the consent flow"
										})
									]
								})]
							}),
							selectedProvider && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "provider-selection",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "eyebrow",
										children: ["Selected ", selectedProvider.demo ? "demo" : "provider"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: selectedProvider.name }),
									selectedProvider.demo && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "demo-warning",
										children: "Demonstration only. Nothing will be sent to a clinic."
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "request-choice",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: requestType === "follow_up" ? "selected" : "",
											onClick: () => setRequestType("follow_up"),
											children: "Request follow-up"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: requestType === "appointment" ? "selected" : "",
											onClick: () => setRequestType("appointment"),
											children: "Request appointment"
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "share-consent",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: shareConsent,
											onChange: (event) => setShareConsent(event.target.checked)
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
											"I consent to include my daily check-ins in a report I choose to share with ",
											selectedProvider.name,
											"."
										] })]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "primary-button",
										disabled: !requestType || !shareConsent,
										onClick: () => document.querySelector(".tracker-section")?.scrollIntoView({ behavior: "smooth" }),
										children: "Continue to my shareable report"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "Elowen does not transmit an appointment request or grant portal access. For real providers, contact the practice directly; you control whether the PDF is shared." })
								]
							})
						]
					})
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "General guidance only" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "This is not a diagnosis or a clinical triage recommendation. Elowen does not assess urgency." })] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "research-section",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "section-title",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "eyebrow",
							children: "Related research"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Recent context, with sources" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "This is general research context, not personalized medical advice." })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "research-card",
					"aria-live": "polite",
					children: research.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "research-loading",
						children: "Looking for directly relevant, reputable sources…"
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [research.message.split(/\n+/).filter(Boolean).map((paragraph, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: paragraph }, index)), research.citations.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "source-list",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Sources" }), research.citations.map((source, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							href: source.url,
							target: "_blank",
							rel: "noreferrer",
							children: [
								index + 1,
								". ",
								source.title
							]
						}, source.url))]
					})] })
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "prep-section",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "line-icon page-icon",
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "eyebrow",
						children: "A better conversation"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Prepare for your visit" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Open a one-page summary of your inputs, this research result, the main factors, and safe questions to print or save as a PDF." })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "primary-button",
					onClick: downloadPrep,
					children: "Prepare for my doctor visit"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LongitudinalTracker, {
				consent: inputs.symptomDataConsent,
				showHotFlashes: natural,
				predictionLabel: `Pattern closer to ${natural ? "the self-reported natural-menopause" : "the recent-menstruation"} survey label`,
				confidence: Math.max(prediction.probabilityNaturalMenopause, prediction.probabilityRecentMenstruation),
				referralGuidance: prediction.referralGuidance.guidance,
				referralWhy: prediction.referralGuidance.why
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "wordmark",
					children: "Elowen"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Research and awareness only. Not a diagnosis." }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Built from public NHANES data with transparent limitations." })
			] })
		]
	});
}
function Home() {
	const [units, setUnits] = (0, import_react.useState)("metric");
	const [heightCm, setHeightCm] = (0, import_react.useState)("");
	const [heightFt, setHeightFt] = (0, import_react.useState)("");
	const [heightIn, setHeightIn] = (0, import_react.useState)("");
	const [weight, setWeight] = (0, import_react.useState)("");
	const [loading, setLoading] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	const [prediction, setPrediction] = (0, import_react.useState)(null);
	const [lastInputs, setLastInputs] = (0, import_react.useState)(null);
	const [research, setResearch] = (0, import_react.useState)({
		status: "loading",
		message: "",
		citations: []
	});
	const [landingTab, setLandingTab] = (0, import_react.useState)("start");
	const bmi = (0, import_react.useMemo)(() => {
		const w = Number(weight);
		if (!w || w <= 0) return null;
		if (units === "metric") {
			const meters = Number(heightCm) / 100;
			return meters > 0 ? w / (meters * meters) : null;
		}
		const inches = Number(heightFt) * 12 + Number(heightIn);
		return inches > 0 ? w / (inches * inches) * 703 : null;
	}, [
		units,
		heightCm,
		heightFt,
		heightIn,
		weight
	]);
	async function submit(event) {
		event.preventDefault();
		setError("");
		if (!bmi || !Number.isFinite(bmi)) {
			setError("Please enter a valid height and weight.");
			return;
		}
		const data = new FormData(event.currentTarget);
		const inputs = {
			age: Number(data.get("age")),
			bmi,
			testosterone: data.get("testosterone") ? Number(data.get("testosterone")) : null,
			shbg: data.get("shbg") ? Number(data.get("shbg")) : null,
			symptoms: {
				fatigue: data.get("fatigue"),
				weightChange: data.get("weightChange"),
				periodPattern: data.get("periodPattern"),
				periodPain: data.get("periodPain"),
				pain: data.get("pain"),
				skinChanges: data.get("skinChanges"),
				hairChanges: data.get("hairChanges"),
				sleepQuality: data.get("sleepQuality"),
				smoking: data.get("smoking"),
				parentalHipFracture: data.get("parentalHipFracture"),
				phqInterest: data.get("phqInterest") || null,
				phqMood: data.get("phqMood") || null
			},
			symptomDataConsent: data.get("symptomDataConsent") === "on",
			additionalLabs: Object.fromEntries(additionalLabFields.map((field) => [field.key, data.get(field.key) ? Number(data.get(field.key)) : null]))
		};
		setLoading(true);
		try {
			const response = await fetch("/api/predict", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(inputs)
			});
			if (!response.ok) throw new Error("The result could not be calculated.");
			const result = await response.json();
			setPrediction(result);
			setLastInputs(inputs);
			setResearch({
				status: "loading",
				message: "",
				citations: []
			});
			window.setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 50);
			fetch("/api/research", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					predictedClass: result.predictedClass,
					topFactors: result.explanation.topFactors
				})
			}).then((response) => response.json()).then((value) => setResearch(value)).catch(() => setResearch({
				status: "unavailable",
				message: "We couldn't find directly relevant studies right now. No summary or citation has been generated.",
				citations: []
			}));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "The result could not be calculated.");
		} finally {
			setLoading(false);
		}
	}
	if (prediction && lastInputs) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Results, {
		prediction,
		inputs: lastInputs,
		research,
		onReset: () => {
			setPrediction(null);
			setLastInputs(null);
			window.scrollTo({
				top: 0,
				behavior: "smooth"
			});
		}
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "site-header",
		id: "top",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
			className: "wordmark",
			href: "#top",
			"aria-label": "Elowen home",
			children: "Elowen"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
			className: "landing-tabs",
			role: "tablist",
			"aria-label": "Elowen landing sections",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				role: "tab",
				"aria-selected": landingTab === "start",
				className: landingTab === "start" ? "active" : "",
				onClick: () => setLandingTab("start"),
				children: "Get started"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				role: "tab",
				"aria-selected": landingTab === "research",
				className: landingTab === "research" ? "active" : "",
				onClick: () => setLandingTab("research"),
				children: "Research bias check"
			})]
		})]
	}), landingTab === "research" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BiasChecklist, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "flower-landing-hero",
		"aria-labelledby": "flower-hero-title",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
			src: "/flower-checkin-journey.png",
			alt: "A pink flower growing through seven daily check-in stages"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flower-hero-action",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "eyebrow",
					children: "Your daily pattern journey"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					id: "flower-hero-title",
					children: "Every check-in helps your story bloom."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Build a clearer record for yourself and for conversations with your doctor. Missing a day never erases your progress." })
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "primary-button",
				onClick: () => document.getElementById("intake-start")?.scrollIntoView({ behavior: "smooth" }),
				children: "Start with the basics"
			})]
		})]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "intake",
		id: "intake-start",
		onSubmit: submit,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "form-heading",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "step-label",
					children: "Step 1 of 2"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Start with the basics" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "unit-toggle",
					role: "group",
					"aria-label": "Measurement units",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: units === "metric" ? "active" : "",
						onClick: () => setUnits("metric"),
						children: "cm / kg"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: units === "imperial" ? "active" : "",
						onClick: () => setUnits("imperial"),
						children: "ft-in / lb"
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "field-grid basics-grid",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Age" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							name: "age",
							type: "number",
							min: "12",
							max: "150",
							required: true,
							placeholder: "e.g. 42"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FieldNote, { children: "Age in years" })
					] }),
					units === "metric" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Height" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "input-suffix",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: heightCm,
							onChange: (e) => setHeightCm(e.target.value),
							type: "number",
							min: "100",
							max: "250",
							step: "0.1",
							required: true,
							placeholder: "165"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "cm" })]
					})] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Height" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "height-pair",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "input-suffix",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: heightFt,
								onChange: (e) => setHeightFt(e.target.value),
								type: "number",
								min: "3",
								max: "8",
								required: true,
								placeholder: "5"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "ft" })]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "input-suffix",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: heightIn,
								onChange: (e) => setHeightIn(e.target.value),
								type: "number",
								min: "0",
								max: "11.9",
								step: "0.1",
								required: true,
								placeholder: "5"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "in" })]
						})]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Weight" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "input-suffix",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: weight,
							onChange: (e) => setWeight(e.target.value),
							type: "number",
							min: "25",
							max: units === "metric" ? 350 : 770,
							step: "0.1",
							required: true,
							placeholder: units === "metric" ? "68" : "150"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: units === "metric" ? "kg" : "lb" })]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "bmi-card",
						"aria-live": "polite",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Calculated BMI" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: bmi ? bmi.toFixed(1) : "." }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "Calculated from height and weight" })
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "section-divider" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "subheading-row",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Blood-test values" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Optional. You can continue without these." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "optional-pill",
					children: "Optional"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "field-grid hormone-grid",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Total testosterone" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "input-suffix",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							name: "testosterone",
							type: "number",
							min: "0",
							step: "0.01",
							placeholder: "Leave blank if unknown"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "ng/dL" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FieldNote, { children: "Found on a standard hormone blood panel." })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "SHBG" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "input-suffix",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							name: "shbg",
							type: "number",
							min: "0",
							step: "0.01",
							placeholder: "Leave blank if unknown"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "nmol/L" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FieldNote, { children: "Sex hormone-binding globulin, from a blood panel." })
				] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "missing-note",
				children: "If one or both values are unavailable, Elowen will use the information you do have and clearly mark the result as more uncertain."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
				className: "expanded-panel",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "Have more lab results? Add optional clinical context" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "These values will appear in your doctor-preparation summary, but the current model was never trained on them and will not use them in its score." }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "field-grid expanded-lab-grid",
						children: additionalLabFields.map((field) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: field.label }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "input-suffix",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									name: field.key,
									type: "number",
									min: "0",
									step: "any",
									placeholder: "Leave blank"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: field.unit })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FieldNote, { children: field.note })
						] }, field.key))
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "section-divider" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "subheading-row",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "What have you noticed lately?" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Optional structured answers add context and referral guidance. They are never used to calculate the probability." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "optional-pill",
					children: "Optional"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "field-grid symptoms-grid",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Fatigue" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						name: "fatigue",
						defaultValue: "",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "Choose one"
						}), symptomOptions.fatigue.map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: x }, x))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Recent weight change" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						name: "weightChange",
						defaultValue: "",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "Choose one"
						}), symptomOptions.weightChange.map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: x }, x))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Period regularity" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						name: "periodPattern",
						defaultValue: "",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "Choose one"
						}), symptomOptions.periodPattern.map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: x }, x))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Period pain" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						name: "periodPain",
						defaultValue: "",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "Choose one"
						}), symptomOptions.periodPain.map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: x }, x))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Muscle or joint pain" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						name: "pain",
						defaultValue: "",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "Choose one"
						}), symptomOptions.pain.map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: x }, x))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Skin changes" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						name: "skinChanges",
						defaultValue: "",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "Choose one"
						}), symptomOptions.skinChanges.map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: x }, x))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Hair changes" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						name: "hairChanges",
						defaultValue: "",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "Choose one"
						}), symptomOptions.hairChanges.map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: x }, x))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Sleep quality" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						name: "sleepQuality",
						defaultValue: "",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "Choose one"
						}), symptomOptions.sleepQuality.map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: x }, x))]
					})] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "screening-profile",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "eyebrow",
						children: "Optional screening context"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Two profile questions" })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "field-grid hormone-grid",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Smoking status" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
							name: "smoking",
							defaultValue: "",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "",
									children: "Prefer not to answer"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "Never smoked" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "Former smoker" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "Current smoker" })
							]
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Has a parent had a hip fracture?" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
							name: "parentalHipFracture",
							defaultValue: "",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "",
									children: "Prefer not to answer"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "Yes" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "No" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "Unsure" })
							]
						})] })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "phq-block",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Over the last 2 weeks, how often have you been bothered by:" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "field-grid hormone-grid",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Little interest or pleasure in doing things" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
									name: "phqInterest",
									defaultValue: "",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "",
											children: "Prefer not to answer"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "0",
											children: "Not at all"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "1",
											children: "Several days"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "2",
											children: "More than half the days"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "3",
											children: "Nearly every day"
										})
									]
								})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Feeling down, depressed, or hopeless" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
									name: "phqMood",
									defaultValue: "",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "",
											children: "Prefer not to answer"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "0",
											children: "Not at all"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "1",
											children: "Several days"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "2",
											children: "More than half the days"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "3",
											children: "Nearly every day"
										})
									]
								})] })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "This is the PHQ-2 first-pass screener, not a diagnosis. Elowen intentionally does not ask the PHQ-9 self-harm question because this prototype is not equipped for crisis response." })
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "consent-card",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					type: "checkbox",
					name: "symptomDataConsent"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Include my symptom answers in Elowen’s open research dataset" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "This is optional and off by default. If you opt in, Elowen stores only your structured symptom choices with broad age and BMI bands. Never your name, raw measurements, hormone values, or result. The data may support future research. Leaving this off will not change or prevent your result." })] })]
			}),
			error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "error-message",
				role: "alert",
				children: error
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "submit-row",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "primary-button",
					type: "submit",
					disabled: loading,
					children: loading ? "Checking…" : "Check Me"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "By continuing, you understand that Elowen is a research and awareness tool, not a diagnosis." })]
			})
		]
	})] })] });
}
//#endregion
export { Home as default };
