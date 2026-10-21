import { test } from "node:test";
import assert from "node:assert/strict";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/eligibility.js";

const NAMES = ["Germany", "Deutschland", "Poland", "Polska"];
const open = (description, extra = {}) =>
  globalThis.jbOpenToEurope({ title: "Senior Backend Engineer", location: "Remote", description, ...extra }, NAMES);

test("open to Europe, the EU, EMEA, worldwide or a ticked country", () => {
  const cases = [
    ["Remote (EMEA)", "EMEA"],
    ["Remote - Europe. Overlap with EST until noon.", "Europe"],
    ["We hire remotely across Europe and the US.", "Europe"],
    ["Fully remote, work from anywhere.", "Worldwide"],
    ["Why you will love working for us: remote worldwide", "Worldwide"],
    ["Contact us only via the form. Remote in EU.", "EU"],
    ["UTC+1 to UTC+3 time zones preferred", "European time zones"],
    ["Open to candidates based in Germany or Poland.", "Germany"],
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
});
