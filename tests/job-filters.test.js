import { test } from "node:test";
import assert from "node:assert/strict";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/job-filters.js";

const years = (t) => globalThis.jbRequiredYearsFromText(t);
const kinds = (t, opts) => globalThis.jbEmploymentKinds(t, opts).sort();
const matches = (job, type) => globalThis.jbMatchesEmployment(job, type);

const checkYears = (cases) => {
  for (const [text, want] of cases) assert.equal(years(text), want, text);
};

test("English years (the US version's rules)", () => {
  checkYears([
    ["5+ years of experience", 5],
    ["3-5 years experience", 3],
    ["4 years' experience", 4],
    ["5 or more years of experience", 5],
    ["Experience: 5+ years", 5],
    ["We have 15 years of experience", null],
    ["12 years of combined experience across our leadership", null],
    ["25 years of industry experience", null],
    ["Great communicator, fluent in German.", null],
  ]);
});

test("years in other EU languages", () => {
  checkYears([
    ["Mindestens 3 Jahre Berufserfahrung im SEO.", 3],
    ["Du bringst 3+ Jahre relevante Berufserfahrung mit", 3],
    ["Berufserfahrung von mindestens 2 Jahren", 2],
    ["3-5 Jahre Berufserfahrung im Online-Marketing", 3],
    ["2,5 Jahre Erfahrung", 2.5],
    ["Vous avez 3 ans d'expérience minimum", 3],
    ["Expérience de 4 ans minimum en marketing digital", 4],
    ["Al menos 3 años de experiencia en SEO", 3],
    ["Experiencia mínima de 2 años", 2],
    ["Almeno 3 anni di esperienza nel marketing", 3],
    ["Esperienza di almeno 5 anni", 5],
    ["Minimaal 3 jaar werkervaring", 3],
    ["Min. 3 lata doświadczenia w marketingu", 3],
    ["Co najmniej 3-letnie doświadczenie", 3],
    ["Doświadczenie min. 2 lata", 2],
    ["3 anos de experiência", 3],
    ["Minst 3 års erfarenhet av marknadsföring", 3],
    ["3 års erfaring med SEO", 3],
    ["Vähintään 3 vuoden kokemus", 3],
    ["Praxe min. 3 roky", 3],
    ["Legalább 3 év tapasztalat", 3],
    ["Minim 3 ani de experiență", 3],
    ["Τουλάχιστον 3 χρόνια εμπειρία", 3],
    // The highest requirement wins
    ["2 Jahre Berufserfahrung im SEO, idealerweise 4 Jahre Erfahrung im SEA", 4],
  ]);
});

test("company history in other languages is not a requirement", () => {
  checkYears([
    ["Wir blicken auf 12 Jahre Erfahrung zurück.", null],
    ["Seit über 10 Jahren Erfahrung im Marketing.", null],
    ["Notre agence a 10 ans d'expérience.", null],
    ["Con más de 20 años de experiencia, somos líderes.", null],
    ["Wir suchen jemanden mit mindestens 3 Jahren Berufserfahrung.", 3],
  ]);
});

test("Indeed experience labels in other languages", () => {
  const labels = (list) => globalThis.jbYearsFromExperienceLabels(list);
  assert.equal(labels(["5 years"]), 5);
  assert.equal(labels(["Homeoffice", "3 Jahre"]), 3);
  assert.equal(labels(["2 ans", "4 años"]), 4);
  assert.equal(labels(["Vollzeit"]), null);
});

test("employment types in EU languages", () => {
  const cases = [
    ["Vollzeit", ["fulltime"]],
    ["Teilzeit", ["other"]],
    ["Voll- oder Teilzeit", ["fulltime", "other"]],
    ["Vollzeit/Teilzeit", ["fulltime", "other"]],
    ["Temps plein", ["fulltime"]],
    ["Jornada completa", ["fulltime"]],
    ["Pełny etat", ["fulltime"]],
    ["Werkstudent Marketing (m/w/d)", ["other"]],
    ["Praktikum Online Marketing", ["other"]],
    ["Stage - Chargé de marketing (H/F)", ["other"]],
    ["Alternance Chargé de communication", ["other"]],
    ["Becario marketing", ["other"]],
    ["Tirocinio marketing", ["other"]],
    ["Stagiair marketing", ["other"]],
    ["Specjalista ds. marketingu (staż)", ["other"]],
    ["Apprenticeship", ["other"]],
    ["Freelance SEO", ["contract"]],
    ["Freiberuflicher Texter", ["contract"]],
    ["Interim Marketing Manager", ["contract"]],
    ["Umowa B2B", ["contract"]],
    ["Contract-to-hire", ["contract"]],
    // Jobs about these words, not of these types
    ["Marketing Lead (Early-Stage Startup)", []],
    ["Stage Manager", []],
    ["Ausbildungsleiter Marketing", []],
    ["B2B Marketing Manager", []],
    ["Contract Manager", []],
    ["CDI", []],
    ["Permanent", []],
  ];
  for (const [text, want] of cases) assert.deepEqual(kinds(text), want, text);
});

test("descriptions only count explicit type phrases", () => {
  const desc = { bareContract: false, other: false };
  assert.deepEqual(kinds("Teilzeit ist möglich. Praktikanten betreuen.", desc), []);
  assert.deepEqual(kinds("Anstellung in Vollzeit", desc), ["fulltime"]);
  assert.deepEqual(kinds("Zusammenarbeit auf freiberuflicher Basis", desc), ["contract"]);
  assert.deepEqual(kinds("Du verantwortest unser B2B-Marketing", desc), []);
});

test("picking a type keeps jobs that never state one", () => {
  const job = (fields) => ({ title: "", listing_type: "", description: "", ...fields });
  assert.ok(matches(job({ title: "Online Marketing Manager (m/w/d)" }), "fulltime"));
  assert.ok(!matches(job({ title: "Werkstudent Online Marketing" }), "fulltime"));
  assert.ok(!matches(job({ title: "Werkstudent Online Marketing" }), "both"));
  assert.ok(matches(job({ title: "Marketing Manager (Voll- oder Teilzeit)" }), "fulltime"));
  assert.ok(matches(job({ listing_type: "Freelance" }), "contract"));
  assert.ok(!matches(job({ listing_type: "Full-time" }), "contract"));
});
