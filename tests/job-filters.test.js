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
    ["Minst 2 års arbetslivserfarenhet inom SEO", 2],
    ["Mindst 2 års relevant erhvervserfaring", 2],
    ["Vähintään 3 vuoden kokemus", 3],
    ["Praxe min. 3 roky", 3],
    ["Legalább 3 év tapasztalat", 3],
    ["Minim 3 ani de experiență", 3],
    ["Τουλάχιστον 3 χρόνια εμπειρία", 3],
    // The highest requirement wins
    ["2 Jahre Berufserfahrung im SEO, idealerweise 4 Jahre Erfahrung im SEA", 4],
    // Slash ranges use the minimum; brackets
    ["2/3 anni di esperienza", 2],
    ["3/5 ans d'expérience", 3],
    ["Berufserfahrung (mind. 3 Jahre)", 3],
    ["Erfahrung (3+ Jahre) im Performance Marketing", 3],
    // Indeed's footer
    ["Experience: total work: 2 years (Preferred), SEO: 3 years (Required)", 3],
    ["Berufserfahrung: Online-Marketing: 2 Jahre (Erforderlich)", 2],
    // Another clause between the years and the experience
    ["Elternzeitvertretung für 2 Jahre mit Erfahrung im Marketing", null],
    ["Das Unternehmen ist 10 Jahre alt und sucht Erfahrung", null],
    // Number words and year adjectives; "between" ranges use the minimum
    ["two years of experience with HubSpot", 2],
    ["drei Jahre Erfahrung im Performance Marketing", 3],
    ["eine mindestens 3-jährige Berufserfahrung", 3],
    ["dreijährige Berufserfahrung im CRM", 3],
    ["Trois ans d'expérience minimum", 3],
    ["Esperienza almeno triennale nel ruolo", 3],
    ["Dwuletnie doświadczenie w e-mail marketingu", 2],
    ["Kolmen vuoden kokemus markkinoinnista", 3],
    ["Työkokemusta vähintään 3 vuotta", 3],
    ["Διετής εμπειρία στο SEO", 2],
    ["zwischen 2 und 4 Jahren Berufserfahrung", 2],
    ["Entre 2 y 4 años de experiencia en paid media", 2],
    ["Da 2 a 4 anni di esperienza nel digital marketing", 2],
    ["three to five years of experience", 3],
    ["3,5 Jahre Erfahrung", 3.5],
    // Degrees and courses aren't experience
    ["Laurea triennale in informatica", null],
    ["Laurea triennale; almeno 2 anni di esperienza", 2],
    // The years come first, the experience word later in the sentence
    ["Wir erwarten 3 Jahre Berufserfahrung in einer Agentur", 3],
    ["Experience: Python: 5 years (Required)", 5],
  ]);
});

test("company history in other languages is not a requirement", () => {
  checkYears([
    ["Wir blicken auf 12 Jahre Erfahrung zurück.", null],
    ["Seit über 10 Jahren Erfahrung im Marketing.", null],
    ["Notre agence a 10 ans d'expérience.", null],
    ["Con más de 20 años de experiencia, somos líderes.", null],
    ["Wir suchen jemanden mit mindestens 3 Jahren Berufserfahrung.", 3],
    ["Als Agentur mit über 12 Jahren Erfahrung suchen wir dich.", null],
    ["Forte de 12 ans d'expérience, notre agence accompagne les marques.", null],
    ["Firma z ponad 12-letnim doświadczeniem na rynku.", null],
    ["Wir sind ein Unternehmen mit über 25 Jahren Erfahrung.", null],
    ["Our company has 12 years of experience; you have 3 years of experience.", 3],
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
    ["Werkstudent Marketing (m/w/d)", ["trainee"]],
    ["Praktikum Online Marketing", ["trainee"]],
    ["Stage - Chargé de marketing (H/F)", ["trainee"]],
    ["Alternance Chargé de communication", ["trainee"]],
    ["Becario marketing", ["trainee"]],
    ["Tirocinio marketing", ["trainee"]],
    ["Stagiair marketing", ["trainee"]],
    ["Specjalista ds. marketingu (staż)", ["trainee"]],
    ["Apprenticeship", ["trainee"]],
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
    ["Stage & Events Marketing Manager", []],
    ["Pre-IPO stage Growth Lead", []],
    ["Content Manager (intern)", []],
    ["Specjalista ds. kontraktacji", []],
    // Employee jobs, permanent or fixed-term: full time unless they say otherwise
    ["CDI", ["fulltime"]],
    ["Permanent", ["fulltime"]],
    ["Fixed-term", ["fulltime"]],
    ["Unbefristete Festanstellung", ["fulltime"]],
    ["Marketing Manager (vast contract)", ["fulltime"]],
    ["Contract pe perioadă nedeterminată", ["fulltime"]],
    ["Contract de muncă", ["fulltime"]],
    ["CDI - temps partiel", ["other"]],
    ["Fixed-term, Part-time", ["other"]],
    ["Project contract", ["contract"]],
    ["Temp agency", ["trainee"]],
    ["Πλήρης απασχόληση", ["fulltime"]],
    ["Festanstellung, Freie Mitarbeit", ["contract", "fulltime"]],
    ["Specjalista ds. SEO (UoP lub B2B)", ["contract", "fulltime"]],
    ["Marketing Manager - 12 Month Fixed Term Contract", ["fulltime"]],
    ["Content Marketing Manager (m/w/d) – Teilzeit möglich", []],
    ["Performance Marketing Manager (m/w/d) Vollzeit (Teilzeitmodelle möglich)", ["fulltime"]],
    ["Kommunikationsmanager (m/w/d) intern & extern", []],
    ["Referent Ausbildungsmarketing (m/w/d)", []],
    ["Pflichtpraktikum Brand Marketing ab März", ["trainee"]],
    ["Volontariat PR & Unternehmenskommunikation", ["trainee"]],
    ["Marketing Manager 80-100%", ["fulltime", "other"]],
    ["Marketing Manager 60%", ["other"]],
    ["Junior Marketing Manager (m/w/d) – 100 % Homeoffice", []],
    ["Intérim", ["trainee"]],
    ["Directeur Marketing par intérim", ["contract"]],
    ["Head of Marketing (Interim)", ["contract"]],
    ["Gestor de Marketing Digital (Recibos Verdes)", ["contract"]],
    ["Specialist marketing (PFA)", ["contract"]],
    // Developer titles
    ["Werkstudent Softwareentwicklung (m/w/d)", ["trainee"]],
    ["Software Engineer Intern", ["trainee"]],
    ["Junior Developer (Traineeship)", ["trainee"]],
    ["Stage Développeur Full-Stack (H/F)", ["trainee"]],
    ["Staż Programista Java", ["trainee"]],
    ["Software Engineer – Vollzeit (Werkstudent möglich)", ["fulltime"]],
    ["Backend Developer (Series A stage)", []],
    ["Frontend Developer (100% remote)", []],
    ["Backend Developer + 15% Bonus", []],
    ["Fullstack Entwickler 80-100%", ["fulltime", "other"]],
    ["Software Engineer, Pensum 80%", ["other"]],
  ];
  for (const [text, want] of cases) assert.deepEqual(kinds(text), want, text);
});

test("descriptions only count explicit type phrases", () => {
  const desc = { bareContract: false, other: false };
  assert.deepEqual(kinds("Teilzeit ist möglich. Praktikanten betreuen.", desc), []);
  assert.deepEqual(kinds("Anstellung in Vollzeit", desc), ["fulltime"]);
  assert.deepEqual(kinds("Zusammenarbeit auf freiberuflicher Basis", desc), ["contract"]);
  assert.deepEqual(kinds("Collaborazione in partita IVA", desc), ["contract"]);
  assert.deepEqual(kinds("This is a contract role for 6 months", desc), ["contract"]);
  // Company footers, postcodes and passing mentions
  assert.deepEqual(kinds("Du verantwortest unser B2B-Marketing", desc), []);
  assert.deepEqual(kinds("Acme S.r.l. – Partita IVA 01234567890", desc), []);
  assert.deepEqual(kinds("Herengracht 1, 1099 AB Amsterdam", desc), []);
  assert.deepEqual(kinds("You brief our freelancers and contractors", desc), []);
  assert.deepEqual(kinds("Wir bieten eine unbefristete Festanstellung", desc), ["fulltime"]);
  assert.deepEqual(kinds("This is a permanent position", desc), ["fulltime"]);
  assert.deepEqual(kinds("Open to permanent residents of the EU", desc), []);
  assert.deepEqual(kinds("We store temporal data in Postgres", desc), []);
  // Indeed's footer names the type
  assert.deepEqual(kinds("Job Types: Part-time. Schedule: Monday to Friday", desc), ["other"]);
  assert.deepEqual(kinds("Type d'emploi : Freelance / Indépendant", desc), ["contract"]);
  assert.deepEqual(kinds("Oferujemy: umowa B2B lub umowa o pracę.", desc), ["contract", "fulltime"]);
});

test("picking a type keeps jobs that never state one", () => {
  const job = (fields) => ({ title: "", listing_type: "", description: "", ...fields });
  assert.ok(matches(job({ title: "Online Marketing Manager (m/w/d)" }), "fulltime"));
  assert.ok(!matches(job({ title: "Werkstudent Online Marketing" }), "fulltime"));
  assert.ok(!matches(job({ title: "Werkstudent Online Marketing" }), "both"));
  assert.ok(matches(job({ title: "Marketing Manager (Voll- oder Teilzeit)" }), "fulltime"));
  assert.ok(matches(job({ listing_type: "Freelance" }), "contract"));
  // A trainee job goes even when the listing says full time
  assert.ok(!matches(job({ listing_type: "Full-time", title: "Werkstudent Softwareentwicklung" }), "fulltime"));
  assert.ok(!matches(job({ title: "Software Engineer Intern" }), "both"));
  assert.ok(!matches(job({ listing_type: "Full-time" }), "contract"));
});

test("long or repetitive descriptions are read quickly", () => {
  // Patterns that could split one long word many ways took minutes here
  const inputs = [
    "a".repeat(20000) + " 3 jahre " + "b".repeat(20000),
    ("3 Jahre " + "abcdefghij ".repeat(8) + "x ").repeat(800) + " Erfahrung",
    ("erfahrung " + "abc ".repeat(4)).repeat(3000) + "3 jahre",
  ];
  for (const text of inputs) {
    const start = performance.now();
    years(text);
    kinds(text, { bareContract: false, other: false });
    kinds(text.slice(0, 5000));
    assert.ok(performance.now() - start < 2000, `${text.length} characters took too long`);
  }
});
