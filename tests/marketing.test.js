import { test } from "node:test";
import assert from "node:assert/strict";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/marketing.js";

const isMarketing = (t) => globalThis.jbIsMarketingTitle(t);

const MARKETING = [
  // English
  "Marketing Manager",
  "Product Marketing Manager",
  "Performance Marketing Lead",
  "Growth Marketing Manager",
  "Marketing Automation Specialist",
  "Lifecycle Marketing Manager",
  "SEO Specialist",
  "Head of Growth",
  "CRM Manager",
  "Content Manager",
  "Copywriter",
  "Brand Manager",
  "Communications Manager",
  "PR Manager",
  "Community Manager",
  "Affiliate Manager",
  "Paid Social Specialist",
  "E-Mail Marketing Manager",
  // German
  "Online-Marketing-Manager (m/w/d)",
  "Marketingmanager*in",
  "SEA Manager (m/w/d)",
  "Social-Media-Manager:in",
  "Referent Unternehmenskommunikation",
  "Pressesprecher (w/m/d)",
  "Werbekauffrau",
  "Kampagnenmanager",
  "Mediaplaner (m/w/d)",
  // French, Spanish, Polish, Dutch
  "Chargé de communication (H/F)",
  "Responsable Marketing Digital",
  "Chargé de référencement SEO",
  "Responsable acquisition",
  "Técnico de comunicación",
  "Specjalista ds. marketingu",
  "Marketeer",
  // Nordic, Finnish, Greek
  "Marknadsförare",
  "Marknadschef",
  "Markedssjef",
  "Markkinointipäällikkö",
  "Υπεύθυνος Μάρκετινγκ",
];

const NOT_MARKETING = [
  "Telemarketing Agent",
  "Telemarketer",
  "Network Marketing Consultant",
  "Sales and Marketing Representative",
  "Content Moderator",
  "Growth Engineer",
  "CRM Developer",
  "Salesforce CRM Administrator",
  "Communications Engineer",
  "Kommunikationselektroniker",
  "IT- und Kommunikationstechniker",
  "Unified Communications Specialist",
  "Brand Ambassador",
  "Sea Freight Coordinator",
  "Talent Acquisition Partner",
  "Growth Equity Associate",
  "Product Lifecycle Manager",
  "Marketing Data Engineer",
  "Software Engineer",
  "Sales Manager",
  "Vertriebsmitarbeiter Außendienst",
  "Kundenberater",
  "Accountant",
  "",
];

test("marketing roles in EU languages", () => {
  const missed = MARKETING.filter((t) => !isMarketing(t));
  assert.deepEqual(missed, []);
});

test("other jobs that share marketing words", () => {
  const wrong = NOT_MARKETING.filter((t) => isMarketing(t));
  assert.deepEqual(wrong, []);
});
