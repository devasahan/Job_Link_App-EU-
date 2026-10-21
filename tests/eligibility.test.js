import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./helpers/env.js";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/eligibility.js";
import { ALL_COUNTRIES, countryNames } from "../extension/scrapers/countries.js";
import { stripHtml } from "../extension/scrapers/util.js";

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
    // Headcount, "we have", experience, awards
    { description: "We're a team of 120 people across the US, Canada and Europe." },
    { description: "We have engineers across Europe and North America." },
    { description: "Experience working across Europe, the Middle East and Africa is a plus." },
    { description: "We were named one of the best places to work in America and in Europe." },
    // The employer's own team across time zones; an offset that spells out UK hours
    { description: "We're an async-first team spread from PST to CET." },
    { description: "You'll need to work UK hours (9am-5:30pm, UTC+0 in winter and UTC+1 in summer)." },
  ]) {
    assert.equal(check(job, EVERY).open, false, JSON.stringify(job));
  }
});

test("a home option beside another one still closes when the other is home too", () => {
  assert.equal(open("This role can be done from anywhere in the United States, or from Canada.").open, false);
  const both = "You must be based in, and legally allowed to work in, the United States. Remote (Europe) for our EU team.";
  assert.equal(open(both).open, false);
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
    // Things outside the US, not people
    { description: "Up to 10% travel, including occasional trips outside the U.S. Must be authorized to work in the US." },
    { description: "Over 40% of our revenue comes from customers outside the US." },
    // A third person or a thing lives there, not the hire
    { description: "You'll report to our VP of Engineering, who is based in Germany. Must be authorized to work in the US." },
    { description: "Our clients include banks and insurers based in the UK and across Europe. Must be authorized to work in the US." },
    { description: "Our infrastructure runs on AWS data centers located in the US and the EU. Must be authorized to work in the US." },
    // Praise, a mission, a product, a perk
    { description: "Our mission is to make care accessible to everyone in the world. Must be authorized to work in the US." },
    { description: "We want to hire the best engineers in the world. Must be authorized to work in the US." },
    { description: "Acme is the leading employer of record (EOR) platform. Must be authorized to work in the US." },
    { description: "Perks: up to four weeks a year to work from anywhere in the world. Must be authorized to work in the US." },
    // Clearance and citizenship close it whatever else it says
    { description: "Must be a U.S. Person (ITAR). CET overlap required." },
    { description: "TS/SCI clearance required." },
    { description: "Must be SC cleared. Remote (Europe)." },
    { description: "Government of Canada Reliability Status is required." },
    { description: "Must be able to obtain a Public Trust. Remote (Europe)." },
    { description: "This position is subject to U.S. export control laws. Remote (Europe)." },
  ]) {
    assert.equal(check(job, EVERY).open, false, JSON.stringify(job));
  }
});

test("more ways postings say they hire in Europe", () => {
  const cases = [
    // From a blind check: a heading before a list, a clause inside, and a home option beside European ones
    [
      { description: "Where you can work: Canada, United Kingdom, Ireland, Germany, the Netherlands and Poland." },
      EVERY,
      "Ireland, Germany, The Netherlands, Poland",
    ],
    [{ description: "You must be based in, and have the right to work in, an EU member state." }, EVERY, "EU"],
    [
      {
        description:
          "This position can be filled remotely from anywhere in the United States, or from one of the following " +
          "European countries where we have an entity: Germany, the Netherlands, Spain and Portugal.",
      },
      EVERY,
      "Germany, The Netherlands, Spain, Portugal",
    ],
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
    [{ description: "We are open to hiring talent from all over Europe and Latin America." }, EVERY, "Europe"],
    [{ description: "We welcome applications from across the UK and Europe." }, EVERY, "Europe"],
    [{ description: "We hire wherever you are, as long as you overlap four hours with Eastern Time." }, EVERY, "Worldwide"],
    [{ description: "Anyone in Europe can apply." }, EVERY, "Europe"],
    // A home tag next to a European one is the other half of the hire
    [{ description: "Location: Remote (US/Canada) or Remote (Europe)." }, EVERY, "Europe"],
    // The place, not the employer of record, says who
    [{ description: "Remote across the EU. We use Remote.com as our employer of record." }, EVERY, "EU"],
    // "UK or an EU country": one list
    [{ description: "You must be based in the UK or an EU country." }, EVERY, "EU"],
    [{ description: "Candidates must live in the UK or another EU country." }, EVERY, "EU"],
    [{ description: "Must be based in the UK or within the EU." }, EVERY, "EU"],
    [{ description: "Open to applicants residing in the UK, Ireland or elsewhere in the EU." }, EVERY, "EU"],
    [{ description: "We can employ you in Canada, Ireland, Portugal or Spain." }, countryNames("IE"), "Ireland"],
    // US boilerplate, collaboration and product words don't cancel a European tag
    [{ description: "Remote (Europe or US). Notice to applicants residing in California: please review our CCPA notice." }, EVERY, "Europe"],
    [{ description: "This role can be based anywhere in the US or Europe. For candidates located in California, Colorado or New York, the base salary range is $160,000 - $200,000." }, EVERY, "Europe"],
    [{ description: "Remote (Europe). This position requires close collaboration with engineers in the US." }, EVERY, "Europe"],
    [{ description: "Remote (Europe). You must be comfortable working with a team that is mostly in the US, and US candidates must be authorized to work in the United States." }, EVERY, "Europe"],
    [{ description: "Remote (Europe or US). Our mission is to strengthen public trust in elections." }, EVERY, "Europe"],
    [{ description: "Remote (Europe or US). We offer green card sponsorship for US employees." }, EVERY, "Europe"],
    [{ description: "Remote (Europe or US). You'll build our export controls screening service." }, EVERY, "Europe"],
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
  assert.equal(check({ description: "We can employ you in Canada, Ireland, Portugal or Spain." }, countryNames("FR")).open, false);
});

test("a bullet that runs into the next one still says where candidates live", () => {
  // stripHtml joins list items with a space, as indeed.js reads them
  const cases = [
    ["<h3>Requirements</h3><ul><li>Based in the EU</li><li>5+ years of experience with Go</li></ul>", "EU"],
    ["<ul><li>Candidates based in Germany or Poland</li><li>Experience with React</li></ul>", "Germany, Poland"],
    ["<ul><li>Located in the EU or UK</li><li>Strong in Kotlin</li></ul>", "EU"],
    ["<ul><li>Living in Europe</li><li>Fluent English</li></ul>", "Europe"],
  ];
  for (const [html, to] of cases) {
    const r = open(stripHtml(html));
    assert.equal(r.open, true, html);
    assert.equal(r.to, to, html);
  }
  // Still no place: a thing located there, a compound
  assert.equal(open("Universities located in the EU and US benchmark our models.").open, false);
  assert.equal(open("Experience with EU-funded research.").open, false);
});

test("not and outside: who the employer can't hire, and where it can", () => {
  for (const text of [
    "We don't currently hire outside the US.",
    "We aren't able to employ people outside the United States.",
    "Candidates outside the United States will not be considered.",
    "This role is not open to candidates in the EU or UK.",
    "We do not hire in Europe.",
    "Unfortunately, we are not able to hire candidates located in Europe at this time.",
  ]) {
    assert.equal(check({ description: text }, EVERY).open, false, text);
  }
  for (const [text, to] of [
    ["Remote (Europe). We are unable to hire candidates outside the EU.", "Europe"],
    ["Remote (Europe). We cannot hire outside of Europe.", "Europe"],
    ["You can work from anywhere in the UK or Europe (we're unable to consider applicants outside of these regions).", "Europe"],
    ["We are unable to hire outside the UK and EU.", "EU"],
    ["Candidates based outside the US are welcome.", "Worldwide"],
  ]) {
    const r = check({ description: text }, EVERY);
    assert.equal(r.open, true, text);
    assert.equal(r.to, to, text);
  }
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
