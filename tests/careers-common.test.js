import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/env.js";
import { EU_CODES } from "../extension/scrapers/countries.js";
import { atsWhere } from "../extension/scrapers/careers/common.js";

const where = (location, extra = {}) => atsWhere({ locations: [location], ...extra });
const pick = (w) => [w.workplace, w.listedIn, w.open];

/** jbOpenTo on a job at that location (a posting that says nothing about where you live). */
function verdict(location, opts, { description = "Build our APIs in Go.", ...extra } = {}) {
  const job = { title: "Backend Engineer", company: "Acme", location, description };
  return globalThis.jbOpenTo(job, atsWhere({ locations: [location], title: job.title, description, ...extra }), { ticked: [...EU_CODES], abroad: ["GB", "CA", "US"], ...opts });
}
const outcome = (v) => (v.open ? `open: ${v.to}` : v.reason);

test("atsWhere: a remote word with places opens the job to them; one European country is where it is listed", () => {
  assert.deepEqual(pick(where("Remote - EMEA")), ["remote", null, ["Remote - EMEA"]]);
  assert.deepEqual(pick(where("Remote (Europe)")), ["remote", null, ["Remote (Europe)"]]);
  assert.deepEqual(pick(where("Home based - Europe")), ["remote", null, ["Home based - Europe"]]);
  assert.deepEqual(pick(where("Remote - Spain, Portugal")), ["remote", null, ["Remote - Spain, Portugal"]]);
  assert.deepEqual(pick(where("Remote - DACH")), ["remote", null, ["Remote - DACH"]]);
  // Indeed's rules for one European country: no "who may apply" list
  assert.deepEqual(pick(where("Spain (Remote)")), ["remote", "ES", null]);
  assert.deepEqual(pick(where("Remote, Germany")), ["remote", "DE", null]);
  // One country outside Europe: listed there and limited to it
  assert.deepEqual(pick(where("Remote - US only")), ["remote", "US", ["Remote - US only"]]);
  assert.deepEqual(pick(where("Remote, United Kingdom")), ["remote", "GB", ["Remote, United Kingdom"]]);
  assert.deepEqual(pick(where("Remote - California")), ["remote", null, ["Remote - California"]]);
});

test("atsWhere: plain Remote is for the posting's text; places without a remote word are offices, regions aren't", () => {
  assert.deepEqual(pick(where("Remote")), ["remote", null, null]);
  // "Anywhere" is read as the world
  assert.deepEqual(pick(where("Remote - Anywhere")), ["remote", null, ["Remote - Worldwide"]]);
  assert.deepEqual(pick(where("Berlin, Germany")), ["onsite", null, null]);
  assert.deepEqual(pick(where("Germany")), ["onsite", null, null]);
  assert.deepEqual(pick(where("Amsterdam, Netherlands (Hybrid)")), ["hybrid", null, null]);
  assert.deepEqual(pick(where("Remote or Hybrid - Berlin")), ["remote", null, null]);
  assert.deepEqual(pick(where("EMEA")), [null, null, ["EMEA"]]);
  assert.deepEqual(pick(where("Anywhere in the world")), [null, null, ["Worldwide"]]);
  assert.deepEqual(pick(where("")), [null, null, null]);
});

test("atsWhere: \"Anywhere\" is the world only when the location names no other place", () => {
  assert.deepEqual(pick(where("Remote - Anywhere in the US")), ["remote", "US", ["Remote - Anywhere in the US"]]);
  assert.deepEqual(pick(where("Remote, Anywhere in USA")), ["remote", "US", ["Remote, Anywhere in USA"]]);
  assert.deepEqual(pick(where("Remote (anywhere in EMEA)")), ["remote", null, ["Remote (anywhere in EMEA)"]]);
  assert.deepEqual(pick(where("Anywhere in Europe")), [null, null, ["Anywhere in Europe"]]);
  assert.deepEqual(pick(where("Remote - Anywhere")), ["remote", null, ["Remote - Worldwide"]]);
  for (const home of ["ES", "FI", "SE"]) {
    assert.equal(outcome(verdict("Remote - Anywhere in the US", { home, abroad: [] })), "abroadOff");
    assert.equal(outcome(verdict("Remote - Anywhere in the US", { home })), "restricted");
    assert.equal(outcome(verdict("Remote (anywhere in EMEA)", { home })), "open: EMEA");
    assert.equal(outcome(verdict("Anywhere in Europe", { home })), "open: Europe");
  }
});

test("atsWhere: when only the location's words say remote, the title and the posting may still say hybrid or on-site", () => {
  const said = (location, description, extra = {}) => atsWhere({ locations: [location], title: "Software Engineer", description, ...extra }).workplace;
  assert.equal(said("Remote - Germany", "This role is hybrid, with two days a week in our Berlin office."), "hybrid");
  assert.equal(said("Remote - EMEA", "The position is fully on-site in Amsterdam."), "onsite");
  assert.equal(said("Spain (Remote)", "Please note: this is not a remote position."), "onsite");
  assert.equal(said("Remote (Europe)", "This is not a remote role."), "onsite");
  assert.equal(atsWhere({ locations: ["Remote - EMEA"], title: "Backend Engineer (Hybrid)" }).workplace, "hybrid");
  // A company blurb or optional office days don't overrule it; the ATS's own field is trusted
  assert.equal(said("Remote - Germany", "We offer a hybrid model in Berlin. Optional: two days a week in our Berlin office."), "remote");
  assert.equal(said("Remote - Germany", "This role is hybrid.", { workplace: "remote" }), "remote");
  for (const home of ["ES", "FI", "SE"]) {
    assert.equal(outcome(verdict("Remote - Germany", { home }, { description: "This role is hybrid, with two days a week in our Berlin office." })), "notRemote");
    assert.equal(outcome(verdict("Remote - EMEA", { home }, { description: "The position is fully on-site in Amsterdam." })), "notRemote");
  }
});

test("atsWhere: several locations, the workplace field, the address country", () => {
  // The office isn't where the remote job is
  assert.deepEqual(pick(where("Berlin, Germany; Remote, Spain")), ["remote", "ES", null]);
  assert.deepEqual(pick(where("San Francisco, CA; Remote")), ["remote", null, null]);
  assert.deepEqual(pick(where("Hybrid - London | Remote - UK")), ["remote", "GB", ["Remote - UK"]]);
  assert.deepEqual(pick(atsWhere({ locations: ["Remote - US", "Remote - Canada", "Remote - EMEA"] })), ["remote", null, ["Remote - US", "Remote - Canada", "Remote - EMEA"]]);
  // The field wins over the words, and its locations are where the remote job is
  assert.deepEqual(pick(where("Remote - Europe", { workplace: "hybrid" })), ["hybrid", null, ["Remote - Europe"]]);
  assert.deepEqual(pick(where("Helsinki, Finland", { workplace: "remote" })), ["remote", "FI", null]);
  // A remote job's address country places it when it is European; one outside Europe is often the head office
  assert.deepEqual(pick(where("Remote", { workplace: "remote", country: "Finland" })), ["remote", "FI", null]);
  assert.deepEqual(pick(where("Helsinki", { workplace: "remote", country: "FI" })), ["remote", "FI", null]);
  assert.deepEqual(pick(where("Remote", { country: "Germany" })), ["remote", "DE", null]);
  assert.deepEqual(pick(where("Remote", { workplace: "remote", country: "USA" })), ["remote", null, null]);
  assert.deepEqual(pick(where("Remote - EMEA", { workplace: "remote", country: "United States" })), ["remote", null, ["Remote - EMEA"]]);
  assert.deepEqual(pick(where("Berlin", { country: "Germany" })), ["onsite", null, null]);
});


test("who can take it, living in Spain, Finland or Sweden", () => {
  // Spain: a job placed in Spain is in your country; one open to Spain and Portugal stays
  assert.equal(outcome(verdict("Spain (Remote)", { home: "ES" })), "inHome");
  assert.equal(outcome(verdict("Remote - Spain", { home: "ES" })), "inHome");
  assert.equal(outcome(verdict("Remote - Spain, Portugal", { home: "ES" })), "open: Spain");
  assert.equal(outcome(verdict("Berlin, Germany; Remote, Spain", { home: "ES" })), "inHome");
  // Finland: listed in another ticked country stays, unless the posting says you must live there
  assert.equal(outcome(verdict("Remote, Germany", { home: "FI" })), "open: Germany");
  assert.equal(outcome(verdict("Remote, Germany", { home: "FI" }, { description: "You must be based in Germany." })), "residentsOnly");
  assert.equal(outcome(verdict("Helsinki", { home: "FI" }, { workplace: "remote", country: "Finland" })), "inHome");
  assert.equal(outcome(verdict("Remote - Nordics", { home: "FI" })), "open: Finland");
  // Sweden: Europe-wide stays; an unticked country is elsewhere; outside Europe is limited to it
  assert.equal(outcome(verdict("Remote - EMEA", { home: "SE" })), "open: EMEA");
  assert.equal(outcome(verdict("Home based - Europe", { home: "SE" })), "open: Europe");
  assert.equal(outcome(verdict("Remote, Germany", { home: "SE", ticked: ["SE", "FR"] })), "elsewhere");
  assert.equal(outcome(verdict("Remote - Sweden", { home: "SE" })), "inHome");
  assert.equal(outcome(verdict("Remote - US only", { home: "SE" })), "restricted");
  assert.equal(outcome(verdict("Remote - US only", { home: "SE", abroad: [] })), "abroadOff");
  assert.equal(outcome(verdict("Remote - DACH", { home: "SE" })), "restricted");
  assert.equal(outcome(verdict("Remote - Anywhere", { home: "SE" })), "open: Worldwide");
  // Everywhere: an office is not remote; plain Remote needs the posting to say Europe
  for (const home of ["ES", "FI", "SE"]) {
    assert.equal(outcome(verdict("Berlin, Germany", { home })), "notRemote");
    assert.equal(outcome(verdict("Remote", { home })), "notOpen");
    assert.equal(outcome(verdict("Remote", { home }, { description: "We hire engineers anywhere in Europe." })), "open: Europe");
    assert.equal(outcome(verdict("EMEA", { home }, { description: "This role is hybrid, two days a week in our Paris office." })), "notRemote");
  }
});
