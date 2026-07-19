import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);
const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const context = { waitUntil() {}, passThroughOnException() {} };

test("server-renders the complete Elowen intake", async () => {
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, context);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Elowen/);
  assert.ok(html.indexOf("Step 1 of 2") < html.indexOf("Blood-test values"));
  assert.match(html, /Research bias check/);
  assert.match(html, /Period pain/);
  assert.match(html, /Skin changes/);
  assert.match(html, /Hair changes/);
  assert.match(html, /Sleep quality/);
  assert.match(html, /Include my symptom answers/);
  assert.match(html, /name="symptomDataConsent"/);
  assert.doesNotMatch(html, /name="symptomDataConsent"[^>]*checked/);
  assert.match(html, /not a diagnosis/i);
  assert.doesNotMatch(html, /A pattern, not a verdict/i);
});

test("returns real prediction, missing-data simulation, and rule-based guidance", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/predict", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      age: 47,
      bmi: 26.2,
      testosterone: null,
      shbg: null,
      symptoms: { periodPattern: "Very irregular", periodPain: "Severe" },
    }),
  }), env, context);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.modelVersion, "xgboost-multicycle-dc0b590");
  assert.deepEqual(result.missingDataAdvisor.missingInputs, ["Testosterone", "SHBG"]);
  assert.match(result.missingDataAdvisor.recommendation, /Adding your (Testosterone|SHBG) value/);
  assert.equal(result.referralGuidance.category, "reproductive");
  assert.match(result.referralGuidance.guidance, /gynecologist or OB-GYN/);
  assert.match(result.symptomContext, /does not use them to calculate your probability/);
});

test("replaces missing-data advice when every model input is present", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/predict", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ age: 47, bmi: 26.2, testosterone: 22, shbg: 61 }),
  }), env, context);
  const result = await response.json();
  assert.deepEqual(result.missingDataAdvisor.missingInputs, []);
  assert.equal(result.missingDataAdvisor.recommendation, "You've provided everything this tool currently uses.");
});

test("uses a citation-free fallback when live research is unavailable", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/research", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ predictedClass: "recent_menstruation", topFactors: [] }),
  }), env, context);
  const result = await response.json();
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.citations, []);
  assert.match(result.message, /couldn't find directly relevant studies/i);
});

test("provider finder keeps real OB-GYN and endocrinology results inside Elowen", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /OB-GYN/);
  assert.match(source, /endocrinologist/);
  assert.match(source, /\/api\/providers/);
  assert.match(source, /National Provider Identifier registry/);
  assert.doesNotMatch(source, /Zocdoc|primary care/i);
  assert.match(source, /Elowen sends only the ZIP code and specialty/);
});
