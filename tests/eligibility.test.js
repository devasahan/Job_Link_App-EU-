import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/eligibility.js";
import { ALL_COUNTRIES, countryNames } from "../extension/scrapers/countries.js";

const NAMES = ["Germany", "Deutschland", "Poland", "Polska"];
const EVERY = ALL_COUNTRIES.flatMap((c) => countryNames(c.code));
const check = (job, names = NAMES) =>
  globalThis.jbOpenToEurope({ title: "Senior Backend Engineer", location: "Remote", ...job }, names);
const open = (description, extra = {}) => check({ description, ...extra });

test("open to Europe, the EU, EMEA, worldwide or a ticked country", () => {
  const cases = [
    ["Remote (EMEA)", "EMEA"],
    ["Remote - Europe. Overlap with EST until noon.", "Europe"],
    ["We hire remotely across Europe and the US.", "Europe"],
    ["Fully remote, work from anywhere in the world.", "Worldwide"],
    ["Why you will love working for us: remote worldwide", "Worldwide"],
    ["Contact us only via the form. Remote in EU.", "EU"],
    ["UTC+1 to UTC+3 time zones preferred", "European time zones"],
    // Every ticked country the list names
    ["Open to candidates based in Germany or Poland.", "Germany, Poland"],
    ["Remote (Polska)", "Polska"],
  ];
  for (const [text, to] of cases) {
    const r = open(text);
    assert.equal(r.open, true, text);
    assert.equal(r.to, to, text);
  }
  assert.equal(open("", { location: "Remote, Europe" }).to, "Europe");
});

test("a restriction to the employer's country closes the job", () => {
  for (const text of [
    "This role is US only.",
    "Candidates must reside in the United States.",
    "You must be authorized to work in the U.S.",
    "Must have the right to work in the UK",
    "Canada-based only.",
    "Security clearance required. Remote anywhere in the world.",
  ]) {
    assert.equal(open(text).open, false, text);
  }
});

test("a job that doesn't say where it hires is closed", () => {
  assert.equal(open("We are a global company with offices in London and Berlin.").open, false);
  assert.equal(open("Remote role. Great benefits.").open, false);
  // A ticked country named in passing is not where it hires
  assert.equal(open("Our customers are in Germany.").open, false);
  // "Anywhere" alone often means anywhere in the employer's country
  assert.equal(open("Fully remote, work from anywhere.").open, false);
});

// Real UK, Canada and US postings, labelled by hand: the deciding sentences
// stand in for the description
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const RECORDS = JSON.parse(fixture("eligibility.json"));
const TRAPS = fixture("eligibility-traps.jsonl")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const asJob = (r) => ({ title: r.title, location: r.location, company: r.company || "", description: r.quotes.join(" ") });
// Indeed's sites in Europe: a record open to all of them is open region-wide
const SITES = [...new Set(RECORDS.flatMap((r) => r.to))];
const codeOf = (name) => ALL_COUNTRIES.find((c) => countryNames(c.code).includes(name))?.code;

const KNOWN_MISSES = {
  // The location "Europe; UK" came from a search summary, not Indeed's field; a
  // location field that names Europe is read as open
  "websearch:25": "location field 'Europe; UK' reads as open; the labeller saw no office list",
};

test("labelled postings: open or not, with every country ticked", () => {
  assert.ok(Object.keys(KNOWN_MISSES).length < RECORDS.length / 10);
  for (const r of RECORDS) {
    const got = globalThis.jbOpenToEurope(asJob(r), EVERY);
    // Unclear postings are left out like closed ones
    const want = r.label === "open";
    if (KNOWN_MISSES[r.id]) assert.notEqual(got.open, want, `${r.id} now passes: drop it from KNOWN_MISSES`);
    else assert.equal(got.open, want, `${r.id} ${r.quotes.join(" | ")} → ${got.reason}`);
  }
});

test("labelled postings: a country list or time-zone window opens the job only for the countries in it", () => {
  const scoped = RECORDS.filter((r) => r.label === "open" && r.to.length < SITES.length);
  assert.ok(scoped.length >= 10);
  for (const r of scoped) {
    for (const code of SITES) {
      const got = globalThis.jbOpenToEurope(asJob(r), countryNames(code));
      assert.equal(got.open, r.to.includes(code), `${r.id} with only ${code} ticked → ${got.reason}`);
    }
    // "Open to" names the listed countries ("Germany, Sweden, Spain")
    const to = globalThis.jbOpenToEurope(asJob(r), EVERY).to;
    if (!to.startsWith("European time zones")) {
      assert.deepEqual(to.split(", ").map(codeOf).sort(), [...r.to].sort(), `${r.id} → ${to}`);
    }
  }
});

test("made-up traps", () => {
  for (const t of TRAPS) {
    assert.equal(globalThis.jbOpenToEurope(asJob(t), EVERY).open, t.label === "open", t.quotes.join(" "));
  }
});

test("company blurbs, travel and passing mentions are not where the job hires", () => {
  for (const job of [
    // Fields are read one at a time: "Remote" + "Europe is…" is no tag
    { description: "Europe is our biggest market." },
    { description: "We serve customers in 120 countries." },
    { description: "Our 900 team members work across North America and Europe." },
    { description: "Our engineering teams are based in the US, the UK and Germany." },
    { description: "You'll collaborate with engineers in Europe and India. Must be authorized to work in the US." },
    { description: "We build open source tools used in Europe." },
    { description: "Experience working in the EU regulatory environment." },
    { description: "Experience in a wet lab is a plus." },
    { description: "Our servers are located in the EU." },
    { description: "We are a Europe-based team." },
    { description: "Work from anywhere in Europe for up to 4 weeks a year." },
    { description: "Travel to customer sites across the US, Canada and Europe." },
    { description: "We welcome experience with European markets." },
    // The company's own name
    { company: "Acme Europe", description: "Acme Europe (remote-first) builds payment software." },
    // French "cet" is not CET
    { description: "Cet emploi est à temps plein." },
  ]) {
    assert.equal(check(job, EVERY).open, false, JSON.stringify(job));
  }
});

test("home-country wording closes the job, also against a loose open signal", () => {
  for (const job of [
    { description: "This is a UK based role. You'll work with engineers across Europe." },
    { description: "Remote role, must be US-based." },
    { description: "This role requires you to live in the UK." },
    { description: "Open to US residents. Engineers across Europe join our calls." },
    { description: "We are unable to hire candidates located outside the US." },
    { location: "Remote - Canada-wide" },
    { location: "Remote UK" },
    { title: "Software Engineer (Remote - US)", description: "Remote (Europe)" },
    // Northern Ireland is in the UK
    { location: "Belfast, Northern Ireland (Remote)" },
    { title: "Software Engineer - Northern Ireland (Remote)" },
    // Clearance and citizenship close it whatever else it says
    { description: "Must be a U.S. Person (ITAR). CET overlap required." },
    { description: "TS/SCI clearance required." },
    { description: "Must be SC cleared. Remote (Europe)." },
    { description: "Government of Canada Reliability Status is required." },
  ]) {
    assert.equal(check(job, EVERY).open, false, JSON.stringify(job));
  }
});

test("more ways postings say they hire in Europe", () => {
  const cases = [
    [{ description: "We are hiring in the UK & ROI." }, countryNames("IE"), "Ireland"],
    [{ description: "Candidates must live in the Republic of Ireland." }, countryNames("IE"), "Ireland"],
    [{ description: "Remote (Holland)" }, countryNames("NL"), "Holland"],
    [{ location: "Remote - Global" }, EVERY, "Worldwide"],
    [{ description: "We hire globally." }, EVERY, "Worldwide"],
    [{ description: "You will be employed through Oyster." }, EVERY, "Worldwide"],
    [{ location: "US + Europe" }, EVERY, "Europe"],
    [{ title: "Backend Engineer (NA/EMEA)" }, EVERY, "EMEA"],
    [{ title: "Senior Backend Engineer (EU/UK)" }, EVERY, "EU"],
    [{ description: "Open to residents of the EU." }, EVERY, "EU"],
    [{ description: "You need a valid EU work permit." }, EVERY, "EU"],
    [{ description: "We welcome European candidates." }, EVERY, "Europe"],
    [{ description: "Location: Europe" }, EVERY, "Europe"],
    [{ description: "This role is EMEA-based." }, EVERY, "EMEA"],
    [{ description: "Remote, DACH" }, countryNames("DE"), "DACH"],
    // Weak closed wording for the US half of a mixed hire doesn't cancel it
    [{ description: "Remote - Europe or US. US candidates must be authorized to work in the United States. W2." }, EVERY, "Europe"],
    [{ title: "Software Engineer (EU - Remote)", description: "Must reside in the United States." }, EVERY, "EU"],
  ];
  for (const [job, names, to] of cases) {
    const r = check(job, names);
    assert.equal(r.open, true, JSON.stringify(job));
    assert.equal(r.to, to, JSON.stringify(job));
  }
  // A part of Europe or a time-zone window leaves the other countries out
  assert.equal(check({ description: "Remote, DACH" }, countryNames("FR")).open, false);
  assert.equal(check({ description: "Remote within 3 hours of GMT." }, countryNames("FI")).open, true);
  assert.equal(check({ description: "Remote within 1 hour of GMT." }, countryNames("FI")).open, false);
  assert.equal(check({ description: "Remote (Europe). Must be within UTC-1 to UTC+1." }, countryNames("RO")).open, false);
});

test("every country's names, English and its own, are read", () => {
  for (const { code } of ALL_COUNTRIES) {
    for (const name of countryNames(code)) {
      const r = check({ description: `Remote (${name})` }, [name]);
      assert.equal(r.open, true, name);
      assert.equal(r.to, name, name);
    }
  }
});

test("long descriptions are read quickly", () => {
  const blurb =
    "About us: we have offices in San Francisco, London and Berlin, and our team members work across North America and Europe. " +
    "We serve customers in 120 countries. Work from anywhere for up to 4 weeks a year, CET or PST. " +
    "Candidates based in the United States, Canada, the UK, Germany, Spain or Sweden. UTC-3 to UTC+3. ";
  for (const text of [blurb.repeat(60), "uk, ".repeat(10000) + "germany", "remote ".repeat(8000), "utc+1 to utc-8 ".repeat(5000)]) {
    const start = performance.now();
    globalThis.jbOpenToEurope({ title: "Engineer", location: "Remote", description: text }, EVERY);
    assert.ok(performance.now() - start < 2000, `${text.length} characters took too long`);
  }
});
