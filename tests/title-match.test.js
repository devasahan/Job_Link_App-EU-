import { test } from "node:test";
import assert from "node:assert/strict";
import "../extension/scrapers/title-match.js";

const matches = (title, query) => globalThis.jbTitleMatches(title, query);
const skills = (job, query) => globalThis.jbSkillsMatch(job, query);

test("fold drops case and accents in EU languages", () => {
  const fold = globalThis.jbFold;
  assert.equal(fold("Référent Marketing"), "referent marketing");
  assert.equal(fold("Straße"), "strasse");
  assert.equal(fold("Łódź"), "lodz");
  assert.equal(fold("Specjalista ds. komunikacji"), "specjalista ds. komunikacji");
  assert.equal(fold("Marknadsförare"), "marknadsforare");
  assert.equal(fold("København"), "kobenhavn");
  assert.equal(fold("Ελλάδα"), "ελλαδα");
  assert.equal(fold("ΜΆΡΚΕΤΙΝΓΚ ΔΙΕΥΘΥΝΤΗΣ"), "μαρκετινγκ διευθυντησ");
});

test("titles in other languages match whole words", () => {
  assert.ok(matches("Chargé(e) de Communication", "charge communication"));
  assert.ok(matches("Chargé de communication digitale (H/F)", "Chargé communication"));
  assert.ok(matches("Référent Marketing (m/w/d)", "Referent Marketing"));
  assert.ok(matches("Specjalista ds. marketingu", "marketing"));
  assert.ok(matches("Técnico de Marketing Digital", "tecnico marketing"));
});

test("German compounds and hyphenations", () => {
  assert.ok(matches("Online-Marketing-Manager (m/w/d)", "Online Marketing Manager"));
  assert.ok(matches("Marketingmanager*in", "marketing"));
  assert.ok(matches("Onlinemarketing Manager", "marketing manager"));
  assert.ok(matches("Produktmarketingmanagerin", "marketing"));
  assert.ok(matches("Kommunikationsmanagerin", "kommunikation"));
  // Short words stay whole words: "sales" is not inside "wholesales" etc.
  assert.equal(matches("Wholesale Manager", "sales"), false);
});

test("marketing synonyms", () => {
  assert.ok(matches("Search Engine Optimisation Specialist", "SEO"));
  assert.ok(matches("SEO Specialist", "search engine optimization specialist"));
  assert.ok(matches("Pay-per-click Manager", "PPC Manager"));
  assert.ok(matches("Sr. Comms Manager", "Senior Communications Manager"));
  assert.ok(matches("Public Relations Lead", "PR Lead"));
  assert.ok(matches("E-Mail Marketing Manager", "email marketing"));
  assert.ok(matches("Go-to-Market Lead", "GTM"));
});

test("commas mean any of the titles", () => {
  assert.ok(matches("Content Marketing Manager", "SEO Manager, Content Marketing"));
  assert.ok(matches("SEO Manager", "SEO Manager, Content Marketing"));
  assert.equal(matches("Brand Manager", "SEO Manager, Content Marketing"), false);
  assert.ok(matches("Anything", " , ;"));
});

test("skills are whole words in title or description", () => {
  const job = {
    title: "Performance Marketing Manager",
    description: "You run Google AdWords and Meta campaigns, report in GA4, and own E-Mail flows in HubSpot.",
  };
  assert.ok(skills(job, "Google Ads"));
  assert.ok(skills(job, "hubspot email"));
  assert.ok(skills(job, "GA"));
  assert.equal(skills(job, "Salesforce"), false);
  assert.equal(skills({ title: "Hub Manager", description: "" }, "hubspot"), false);
});
