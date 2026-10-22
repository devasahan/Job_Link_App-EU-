import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/env.js";
import "../extension/scrapers/util.js";
import { countryCode } from "../extension/scrapers/countries.js";

const openTo = (job, where, opts) =>
  globalThis.jbOpenTo({ title: "Backend Developer", company: "Acme", description: "", ...job }, where, {
    ticked: ["DE", "FR", "SE", "PL"],
    abroad: ["US"],
    ...opts,
  });
const reason = (...args) => openTo(...args).reason || "open";

test("rule 1: hybrid or on-site is not remote, from the source or the posting", () => {
  assert.equal(reason({}, { workplace: "hybrid", listedIn: "DE" }), "notRemote");
  assert.equal(reason({}, { workplace: "onsite", open: [], emptyOpen: "world" }), "notRemote");
  // The source says remote: its word stands
  assert.equal(reason({ title: "Developer (Hybrid)" }, { workplace: "remote", listedIn: "DE" }), "open");
  // The source doesn't say: title, location, then strong description phrases
  assert.equal(reason({ title: "Backend Developer (Hybrid)" }, { listedIn: "DE" }), "notRemote");
  assert.equal(reason({ location: "On-site, Berlin" }, { listedIn: "DE" }), "notRemote");
  assert.equal(reason({ description: "This role is hybrid: 2 days a week in our Berlin office." }, { listedIn: "DE" }), "notRemote");
  assert.equal(reason({ description: "This is not a remote position." }, { listedIn: "DE" }), "notRemote");
  // A board's own "Remote (…)" label: the description may still say the job is hybrid or on-site…
  const remoteNl = { open: ["Netherlands"] };
  const onBoard = (description) => reason({ location: "Remote (Netherlands)", description }, remoteNl, { ticked: ["NL"] });
  assert.equal(onBoard("This is a hybrid role: three days a week in our Amsterdam office."), "notRemote");
  assert.equal(onBoard("This role is hybrid, 3 days a week in our Amsterdam office."), "notRemote");
  assert.equal(onBoard("This position is fully on-site in Amsterdam."), "notRemote");
  // …but office days, "no remote work from…" or "hybrid or remote" don't overrule it
  assert.equal(onBoard("Fully remote, with an optional 2 days a week in our Lisbon office."), "open");
  assert.equal(onBoard("No remote work from outside the Netherlands."), "open");
  assert.equal(onBoard("This role is hybrid or remote, as you prefer."), "open");
  // A location that says hybrid or "Remote or Hybrid" settles it either way
  assert.equal(reason({ location: "Remote or Hybrid (Berlin)", description: "This role is hybrid." }, { listedIn: "DE" }), "open");
  assert.equal(reason({ location: "Hybrid (Berlin)", description: "Fully remote." }, { listedIn: "DE" }), "notRemote");
  // Company policy and technology are no workplace
  assert.equal(reason({ description: "We offer a hybrid working model." }, { listedIn: "DE" }), "open");
  assert.equal(reason({ title: "Hybrid Cloud Engineer" }, { listedIn: "DE" }), "open");
  assert.equal(reason({ title: "Backend Developer (Remote or Hybrid)" }, { listedIn: "DE" }), "open");
});

test("jbWorkplaceFromText reads tags, either-or and EU words", () => {
  const w = (title, extra = {}) => globalThis.jbWorkplaceFromText({ title, ...extra });
  assert.equal(w("Senior Developer - Hybrid in Berlin"), "hybrid");
  assert.equal(w("Software Engineer | Hybrid | Berlin"), "hybrid");
  assert.equal(w("Développeur Java (Hybride)"), "hybrid");
  assert.equal(w("Entwickler (m/w/d) – vor Ort in München"), "onsite");
  assert.equal(w("Remote/Hybrid Backend Developer"), "remote");
  assert.equal(w("Backend Developer", { location: "Remote, Europe" }), "remote");
  assert.equal(w("Site Reliability Engineer"), null);
  assert.equal(w("Hybrid Mobile App Developer"), null);
  // cheap: title and location only
  assert.equal(w("Dev", { description: "This role is hybrid." }), "hybrid");
  assert.equal(globalThis.jbWorkplaceFromText({ title: "Dev", description: "This role is hybrid." }, { cheap: true }), null);
  assert.equal(w("Dev", { location: "Remote (Germany)", description: "This role is hybrid." }), "hybrid");
  assert.equal(globalThis.jbWorkplaceFromText({ title: "Dev", location: "Remote (Germany)", description: "This role is hybrid." }, { cheap: true }), "remote");
});

test("rule 2: listed where the user lives", () => {
  assert.equal(reason({}, { listedIn: "SE" }, { home: "SE" }), "inHome");
});

test("rule 3: listed in a European country that isn't ticked", () => {
  assert.equal(reason({}, { listedIn: "ES" }), "elsewhere");
  // …even when the board's list would open it
  assert.equal(reason({}, { listedIn: "ES", open: ["Europe"] }), "elsewhere");
});

test("rule 4: listed in the UK, Canada or US not ticked under Employers abroad", () => {
  assert.equal(reason({ description: "Remote (Europe)." }, { listedIn: "GB" }), "abroadOff");
  // Ticked: the posting decides (rule 7)
  assert.equal(openTo({ description: "Remote (Europe). Candidates based in the EU." }, { listedIn: "US" }).to, "Europe");
});

test("rule 5: the board's who-may-apply list, narrowed by time zones", () => {
  assert.deepEqual(openTo({}, { open: ["Germany", "France", "Spain"] }), { open: true, to: "Germany, France" });
  assert.equal(openTo({}, { open: ["DE", "SE"] }, { home: "SE" }).to, "Sweden");
  assert.equal(reason({}, { open: [{ alpha2: "US", name: "United States" }] }), "restricted");
  assert.equal(reason({}, { open: ["Germany"] }, { home: "SE" }), "restricted");
  // An empty list means what the board says it means
  assert.equal(openTo({}, { open: [], emptyOpen: "world" }).to, "Worldwide");
  assert.equal(openTo({}, { open: [], emptyOpen: "europe" }).to, "Europe");
  assert.equal(openTo({ description: "" }, { open: [], emptyOpen: null }).reason, "notOpen");
  // The window: US hours leave Europe out; UTC+0–1 keeps the CET countries only
  assert.equal(reason({}, { open: [], emptyOpen: "world", utc: [-8, -5] }), "restricted");
  assert.equal(
    openTo({}, { open: [], emptyOpen: "world", utc: [0, 1] }, { ticked: ["DE", "FI"] }).to,
    "Europe (UTC+0 to UTC+1)"
  );
  assert.equal(reason({}, { open: ["Finland"], utc: [-1, 1] }, { ticked: ["FI"] }), "restricted");
  // A window that cuts the region names it, whoever T is; one that cuts nothing doesn't
  const zoned = { open: [], emptyOpen: "world", utc: [1, 2] };
  assert.equal(openTo({}, zoned).to, "Europe (UTC+1 to UTC+2)");
  assert.equal(openTo({}, zoned, { home: "SE" }).to, "Europe (UTC+1 to UTC+2)");
  assert.equal(openTo({}, zoned, { ticked: ["DE"] }).to, "Europe (UTC+1 to UTC+2)");
  assert.equal(openTo({}, { open: [], emptyOpen: "world", utc: [-1, 3] }, { home: "SE" }).to, "Worldwide");
  assert.equal(reason({}, zoned, { home: "PT" }), "restricted");
  // A long list names a few countries, then counts the rest
  const many = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE"];
  assert.equal(openTo({}, { open: many }, { ticked: many }).to, "Austria, Belgium, Bulgaria, Croatia, Cyprus +3");
  // With home set, a posting that says you must live elsewhere
  const mustDe = { description: "You must be based in Germany." };
  assert.equal(reason(mustDe, { open: [], emptyOpen: "world" }, { home: "SE" }), "residentsOnly");
  // With home unset it narrows the list, as rule 7 reads the same words
  assert.deepEqual(openTo(mustDe, { open: [], emptyOpen: "world" }), { open: true, to: "Germany" });
  assert.deepEqual(openTo(mustDe, { open: [], emptyOpen: "europe" }, { ticked: ["NL", "PL"] }), {
    open: false,
    reason: "restricted",
    why: "must be based in germany",
    to: "",
  });
  assert.equal(openTo(mustDe, { open: ["Germany", "France"] }).to, "Germany");
  // A region-wide one leaves every European country in
  assert.equal(openTo({ description: "You must be based in the EU." }, { open: [], emptyOpen: "world" }).to, "Worldwide");
  // The cheap pass leaves it to the full check
  assert.equal(openTo(mustDe, { open: [], emptyOpen: "europe" }, { ticked: ["NL"], cheap: true }).open, true);
});

test("rule 6: listed in a ticked European country (Indeed's rule)", () => {
  assert.deepEqual(openTo({}, { listedIn: "DE" }), { open: true, to: "Germany" });
  const inGermany = { description: "100% Homeoffice innerhalb Deutschlands." };
  assert.equal(reason(inGermany, { listedIn: "DE" }, { home: "SE" }), "residentsOnly");
  assert.equal(reason(inGermany, { listedIn: "DE" }), "open");
});

test("rule 7: anything else needs a posting that hires in Europe; no signal is closed", () => {
  assert.equal(openTo({ description: "Remote (Europe). We hire across the EU." }, {}).to, "Europe");
  assert.equal(openTo({ description: "Open to candidates based in Germany or Sweden." }, {}, { home: "SE" }).to, "Sweden");
  assert.equal(reason({ description: "This role is US only." }, {}), "notOpen");
  assert.equal(reason({ description: "Fully remote." }, {}), "notOpen");
  // A list with nothing we know in it is no list
  assert.equal(reason({ description: "Remote (Europe)." }, { open: ["Narnia"] }), "open");
});

test("cheap mode decides only what needs no description", () => {
  const cheap = (job, where, opts) => openTo(job, where, { cheap: true, ...opts });
  assert.equal(cheap({}, { listedIn: "ES" }).reason, "elsewhere");
  assert.equal(cheap({ title: "Developer (Hybrid)" }, {}).reason, "notRemote");
  assert.equal(cheap({}, { open: ["United States"] }).reason, "restricted");
  assert.deepEqual(cheap({}, {}), { open: true, to: "", pending: true });
  assert.deepEqual(cheap({}, { listedIn: "DE" }, { home: "SE" }), { open: true, to: "", pending: true });
  assert.equal(cheap({ description: "This role is hybrid." }, { listedIn: "DE" }).open, true);
});

test("jbReadPlaces: codes, names, regions, parts and places outside Europe", () => {
  const read = globalThis.jbReadPlaces;
  assert.deepEqual(read(["Germany", "fr"]).codes, ["FR", "DE"]);
  assert.deepEqual(read(["Germany", "fr"]).names.map((n) => n.code), ["DE", "FR"]);
  assert.equal(read(["Deutschland"]).codes[0], "DE");
  assert.equal(read("Remote - Europe").wide, "Europe");
  assert.equal(read(["EMEA"]).codes.length, 29);
  assert.equal(read(["Europe", "Anywhere in the world"]).wide, "Worldwide");
  assert.deepEqual(read(["DACH"]).codes, ["AT", "DE", "CH"]);
  assert.deepEqual(read(["DACH"]).parts, ["DACH"]);
  assert.deepEqual(read(["US", "UK", "India"]).codes, []);
  assert.deepEqual(read(["US", "UK", "India"]).outside, ["United States", "United Kingdom", "india"]);
  assert.deepEqual(read(["EL"]).codes, ["GR"]);
  assert.deepEqual(read([{ alpha2: "PL", name: "Poland" }]).codes, ["PL"]);
});

test("jbCountriesInUtc and countryCode", () => {
  assert.deepEqual(globalThis.jbCountriesInUtc(0, 0), ["IE", "PT"]);
  assert.equal(globalThis.jbCountriesInUtc(1, -1).length, 21);
  assert.deepEqual(globalThis.jbCountriesInUtc(-8, -5), []);
  assert.equal(countryCode("de"), "DE");
  assert.equal(countryCode("Deutschland"), "DE");
  assert.equal(countryCode("The Netherlands"), "NL");
  assert.equal(countryCode("Česko"), "CZ");
  assert.equal(countryCode("UK"), "GB");
  assert.equal(countryCode("U.S."), "US");
  assert.equal(countryCode("United States of America"), "US");
  assert.equal(countryCode("EL"), "GR");
  assert.equal(countryCode("India"), "");
  assert.equal(countryCode(""), "");
});
