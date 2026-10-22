import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/residence.js";

const required = (job, country, home = "SE") =>
  globalThis.jbResidenceRequired({ title: "Senior Backend Developer", location: "", company: "", ...job }, { country, home })
    .required;

const { records: RECORDS } = JSON.parse(readFileSync(new URL("./fixtures/residence.json", import.meta.url), "utf8"));

// A title-only reading can't decide these; each with why
const KNOWN_MISSES = {
  // The only signal is the city in the title; the researcher called it borderline
  "real-hu-meltwater-ai": "an office address and '(Budapest)' in the title",
  // "team members who live in…" usually describes the company's own staff, so it's skipped
  "real-pt-imaginarycloud": "'team members who live in Portugal or are willing … to live and work in the country'",
};

test("labelled postings: residence required or not, for each home named", () => {
  const wrong = [];
  for (const r of RECORDS) {
    const job = { title: r.title, location: r.location, description: r.text };
    for (const [home, label] of [[r.home, r.label], ...Object.entries(r.also || {})]) {
      if (required(job, r.country, home) !== (label === "required")) wrong.push(`${r.id} (${r.country}, home ${home})`);
    }
  }
  const unexpected = wrong.filter((w) => !Object.keys(KNOWN_MISSES).some((id) => w.startsWith(`${id} `)));
  assert.deepEqual(unexpected, []);
  // A fixed miss leaves the list
  for (const id of Object.keys(KNOWN_MISSES)) assert.ok(wrong.some((w) => w.startsWith(`${id} `)), `${id} is fixed`);
  assert.ok(Object.keys(KNOWN_MISSES).length < RECORDS.length * 0.05);
});

test("living in, or working from within, another country", () => {
  for (const [text, country] of [
    ["100% Homeoffice innerhalb Deutschlands.", "DE"],
    ["Du hast deinen Wohnsitz in Deutschland.", "DE"],
    ["Remote werken vanuit Nederland is mogelijk.", "NL"],
    ["Télétravail complet depuis la France.", "FR"],
    ["Trabajo 100% remoto desde España.", "ES"],
    ["Praca zdalna z terenu Polski.", "PL"],
    ["You must be based in Ireland.", "IE"],
  ]) {
    assert.equal(required({ description: text }, country), true, text);
  }
  assert.equal(required({ title: "Softwareentwickler (m/w/d) - Remote (Deutschland)" }, "DE"), true);
});

test("silent, open or including home: not required", () => {
  for (const [text, country] of [
    ["Wir sind ein Unternehmen mit Sitz in Berlin. Fließend Deutsch.", "DE"],
    ["Remote aus ganz Europa möglich.", "DE"],
    ["Remote from anywhere in the EU.", "NL"],
    ["Remote in Deutschland oder Schweden.", "DE"],
    ["Arbeitserlaubnis für Deutschland erforderlich.", "DE"],
  ]) {
    assert.equal(required({ description: text }, country), false, text);
  }
  // Indeed's own location field isn't the employer's words
  assert.equal(required({ location: "Remote in Deutschland", description: "Spannende Projekte." }, "DE"), false);
});

test("long descriptions are read quickly", () => {
  const blurb =
    "Wir sind ein Unternehmen mit Sitz in München und Kunden in ganz Deutschland, Österreich und der Schweiz. " +
    "Du arbeitest 100% remote innerhalb Deutschlands, mit Workation bis zu 20 Tage aus dem EU-Ausland. ";
  for (const text of [blurb.repeat(160), "deutschland, ".repeat(2500), "wohnsitz in ".repeat(2700), "x".repeat(30000)]) {
    const start = performance.now();
    required({ description: text }, "DE");
    assert.ok(performance.now() - start < 2000, `${text.length} characters took too long`);
  }
});
