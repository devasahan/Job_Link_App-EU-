import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/marketing.js";

const REAL = JSON.parse(readFileSync(new URL("./fixtures/indeed-titles.json", import.meta.url), "utf8"));

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
  // Press and PR
  "Attaché(e) de presse",
  "Leitung Pressestelle (m/w/d)",
  "Ufficio stampa",
  "Woordvoerder",
  "Rzecznik prasowy",
  "Assessor de imprensa",
  "Tiedottaja",
  "Υπεύθυνος Δημοσίων Σχέσεων",
  // Roles named after developers or engineers, or about engineering audiences
  "Developer Marketing Manager",
  "Product Marketing Manager, Developer Tools",
  "B2B Marketing Manager – Engineering & Construction",
  "Technical Marketing Engineer",
  // Newer and tool-named roles
  "Freelance Meta Ads specialist (coaching, remote)",
  "SEO / GEO-Texter (m/w/d)",
  "Senior CRO Strategist",
  "Creative Strategist",
  "Programmatic Trader",
  "Market Research Analyst",
  "Recruitment Marketing Manager",
  "Senior Marketing Designer",
  "Consultant SEA",
  "Spezialist SEA (m/w/d)",
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
  // Call centres, sales, teaching, recruiting, design, gigs
  "Kundenberater Dialogmarketing (m/w/d)",
  "Teleoperador/a de marketing telefónico",
  "SDR B2B - Marketing & Acquisition",
  "Account Executive – Marketing SaaS",
  "Comercial B2B – Captación y Ventas | Marketing Digital e IA",
  "Dozent Medien- und Kommunikationsmanagement (m/w/d)",
  "AI for Content Creation Teaching Expert",
  "Marketing Recruiter",
  "Kommunikationsdesigner (m/w/d)",
  "Graphic Designer",
  "Marketing Expert - AI Training",
  "Social Media Moderator",
  // Look-alike communication, traffic, growth, PR
  "Wechselprozessmanager Marktkommunikation (m/w/d)",
  "Mitarbeiter Kundenkommunikation (m/w/d)",
  "Teknisk kommunikatör",
  "Transport & Traffic Manager",
  "Account Growth Manager",
  "Hostess e PR eventi",
  "Community Manager - Apartment Homes",
];

test("marketing roles in EU languages", () => {
  const missed = MARKETING.filter((t) => !isMarketing(t));
  assert.deepEqual(missed, []);
});

test("other jobs that share marketing words", () => {
  const wrong = NOT_MARKETING.filter((t) => isMarketing(t));
  assert.deepEqual(wrong, []);
});

test("real Indeed remote titles", () => {
  assert.deepEqual(REAL.marketing.filter((t) => !isMarketing(t)), []);
  assert.deepEqual(REAL.notMarketing.filter((t) => isMarketing(t)), []);
});
