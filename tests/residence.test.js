import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./helpers/env.js";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/residence.js";
import { stripHtml } from "../extension/scrapers/util.js";

const required = (job, country, home = "SE") =>
  globalThis.jbResidenceRequired({ title: "Senior Backend Developer", location: "", company: "", ...job }, { country, home })
    .required;

// [expected, description, country, home] (home SE unless given)
const expectAll = (cases) => {
  for (const [want, text, country, home = "SE"] of cases) assert.equal(required({ description: text }, country, home), want, text);
};

const { records: RECORDS } = JSON.parse(readFileSync(new URL("./fixtures/residence.json", import.meta.url), "utf8"));

// A title-only reading can't decide these; each with why
const KNOWN_MISSES = {
  // The only signal is the city in the title; the researcher called it borderline
  "real-hu-meltwater-ai": "an office address and '(Budapest)' in the title",
  // "team members who live in…" usually describes the company's own staff, so it's skipped
  "real-pt-imaginarycloud": "'team members who live in Portugal or are willing … to live and work in the country'",
};

test("labelled postings: residence required or not, for each home named", () => {
  const wrong = [];
  for (const r of RECORDS) {
    const job = { title: r.title, location: r.location, description: r.text };
    for (const [home, label] of [[r.home, r.label], ...Object.entries(r.also || {})]) {
      if (required(job, r.country, home) !== (label === "required")) wrong.push(`${r.id} (${r.country}, home ${home})`);
    }
  }
  const unexpected = wrong.filter((w) => !Object.keys(KNOWN_MISSES).some((id) => w.startsWith(`${id} `)));
  assert.deepEqual(unexpected, []);
  // A fixed miss leaves the list
  for (const id of Object.keys(KNOWN_MISSES)) assert.ok(wrong.some((w) => w.startsWith(`${id} `)), `${id} is fixed`);
  assert.ok(Object.keys(KNOWN_MISSES).length < RECORDS.length * 0.05);
});

test("living in, or working from within, another country", () => {
  for (const [text, country] of [
    ["100% Homeoffice innerhalb Deutschlands.", "DE"],
    ["Du hast deinen Wohnsitz in Deutschland.", "DE"],
    ["Remote werken vanuit Nederland is mogelijk.", "NL"],
    ["Télétravail complet depuis la France.", "FR"],
    ["Trabajo 100% remoto desde España.", "ES"],
    ["Praca zdalna z terenu Polski.", "PL"],
    ["You must be based in Ireland.", "IE"],
  ]) {
    assert.equal(required({ description: text }, country), true, text);
  }
  assert.equal(required({ title: "Softwareentwickler (m/w/d) - Remote (Deutschland)" }, "DE"), true);
});

test("silent, open or including home: not required", () => {
  for (const [text, country] of [
    ["Wir sind ein Unternehmen mit Sitz in Berlin. Fließend Deutsch.", "DE"],
    ["Remote aus ganz Europa möglich.", "DE"],
    ["Remote from anywhere in the EU.", "NL"],
    ["Remote in Deutschland oder Schweden.", "DE"],
    ["Arbeitserlaubnis für Deutschland erforderlich.", "DE"],
  ]) {
    assert.equal(required({ description: text }, country), false, text);
  }
  // Indeed's own location field isn't the employer's words
  assert.equal(required({ location: "Remote in Deutschland", description: "Spannende Projekte." }, "DE"), false);
});

test("only: a hire, remote or residence word comes first, and not after a negation", () => {
  expectAll([
    [true, "Remote – nur in Deutschland.", "DE"],
    [true, "Bewerbungen nur aus Deutschland.", "DE"],
    [true, "Wir stellen ausschließlich in Deutschland ein.", "DE"],
    // Customers, products, the company's markets
    [false, "Wir haben Kunden nur in Deutschland und Österreich.", "DE"],
    [false, "Unser Produkt ist aktuell nur in Deutschland verfügbar.", "DE"],
    [false, "Operamos solo en España.", "ES"],
    [false, "Our product is available in Germany only.", "DE"],
    [false, "Unsere Software wird nicht nur in Deutschland, sondern in ganz Europa eingesetzt.", "DE"],
    [false, "Il nostro software è usato non solo in Italia.", "IT"],
    [false, "Nasze oprogramowanie działa nie tylko w Polsce.", "PL"],
  ]);
  assert.equal(required({ title: "Backend Developer (Remote, nur Deutschland)" }, "DE"), true);
});

test("a line break ends a sentence, as stripHtml leaves list items", () => {
  expectAll([
    [true, "Requirements\nA degree in Computer Science is not required\nBased in Ireland\nStrong Python skills", "IE"],
    [true, "About you\nYou enjoy working in a small team\nMust be based in Ireland", "IE"],
    [true, "What you bring:\n- 5+ years of experience\n- You are located in Ireland", "IE"],
  ]);
  const html =
    "<p>Dein Profil</p><ul><li>Ein abgeschlossenes Studium ist kein Muss</li><li>Du lebst in Deutschland</li><li>Gute Englischkenntnisse</li></ul>";
  assert.equal(required({ description: stripHtml(html) }, "DE"), true);
  assert.equal(required({ description: stripHtml("<p>Was wir bieten</p><ul><li>Team-Events</li><li>Wohnsitz in Deutschland erforderlich</li></ul>") }, "DE"), true);
  // A label and its value on two lines are one sentence
  assert.equal(required({ description: stripHtml("<p><b>Standort:</b></p><p>Deutschland (remote)</p>") }, "DE"), true);
});

test("cross-border commuters: welcome opens the neighbours, turned away leaves the country", () => {
  expectAll([
    [true, "Voraussetzung ist ein Wohnsitz in der Schweiz (Grenzgänger leider ausgeschlossen).", "CH", "DE"],
    [true, "Homeoffice an bis zu fünf Tagen pro Woche, sofern du in der Schweiz wohnst (Grenzgänger:innen ausgeschlossen).", "CH", "DE"],
    [true, "Résidence au Luxembourg obligatoire, pas de frontaliers.", "LU", "FR"],
    [true, "Residenza in Svizzera obbligatoria, frontalieri esclusi.", "CH", "IT"],
    [false, "Wohnsitz in der Schweiz oder Grenzgänger mit Ausweis G.", "CH", "DE"],
  ]);
});

test("a perk says nothing about where the hire lives", () => {
  expectAll([
    [false, "Workation: Bis zu 30 Tage im Jahr kannst du aus dem EU-Ausland arbeiten.", "DE"],
    [false, "Work from abroad for up to 20 days a year.", "IE"],
    [false, "Teamevents, Sommerfest und eine jährliche Team-Workation in Portugal.", "DE"],
    [false, "Puedes trabajar desde el extranjero hasta 4 semanas al año.", "ES"],
    // …nor does it open a posting that asks for a home there
    [true, "Wohnsitz in Deutschland. Workation: bis zu 30 Tage im Jahr aus dem EU-Ausland.", "DE"],
  ]);
});

test("German and Dutch put the residence verb after the place", () => {
  expectAll([
    [true, "Du musst in Deutschland wohnen.", "DE"],
    [true, "Voraussetzung ist, dass du in Deutschland lebst.", "DE"],
    [true, "Du solltest in Deutschland gemeldet sein.", "DE"],
    [true, "Je moet in Nederland wonen.", "NL"],
    [true, "Je werkt volledig van thuis uit, op voorwaarde dat je in België woont.", "BE", "NL"],
    // Not the reader or the hire
    [false, "Unsere Software hilft Millionen Menschen, die in Deutschland leben.", "DE"],
    [false, "Das Unternehmen ist in Deutschland ansässig.", "DE"],
    [false, "Wij zijn in Nederland gevestigd.", "NL"],
  ]);
});

test("compounds, dashes and the employer's own team", () => {
  expectAll([
    [false, "Du begleitest den Go-Live unserer Plattform in Deutschland.", "DE"],
    [false, "We build a cloud-based platform used by banks in Ireland.", "IE"],
    // A spaced dash ends the clause a negation reads
    [true, "Remote innerhalb Deutschlands – Deutschkenntnisse nicht erforderlich.", "DE"],
    [true, "Ein Umzug nach Berlin ist nicht notwendig – du arbeitest von jedem Ort in Deutschland aus.", "DE"],
    [false, "Wohnsitz in Deutschland – kein Muss.", "DE"],
    [false, "Wir arbeiten remote aus ganz Deutschland.", "DE"],
    [false, "Unsere Kolleg:innen arbeiten remote aus ganz Deutschland.", "DE"],
    [false, "Wir betreuen Kunden aus ganz Deutschland.", "DE"],
    [true, "Wir suchen Entwickler aus ganz Deutschland.", "DE"],
  ]);
});

test("a preference is not a requirement; a lasting stay and a reader's home are", () => {
  expectAll([
    [false, "Ideally based in Ireland, but we are open to candidates elsewhere.", "IE"],
    [false, "Bewerber aus Deutschland werden bevorzugt.", "DE"],
    [false, "Ein Wohnsitz in Deutschland ist von Vorteil.", "DE"],
    [false, "Résider en France est un plus.", "FR"],
    [true, "Die Stelle ist zu 100 % remote, setzt aber einen dauerhaften Aufenthalt in Deutschland voraus.", "DE", "ES"],
    [false, "Eine Aufenthaltserlaubnis für Deutschland ist erforderlich.", "DE"],
    // A region the vocabulary doesn't know, after a verb that speaks to the reader
    [true, "Du wohnst in Bayern oder Baden-Württemberg, denn einmal im Monat treffen wir uns in München.", "DE", "NL"],
    [true, "Vous habitez en Île-de-France ou êtes prêt(e) à vous y installer.", "FR", "IT"],
    [false, "Du lebst in deiner Freizeit für Open Source.", "DE"],
  ]);
});

test("Finnish etä, Nordic verbs, Hungarian adjectives, Dutch nu, citizens, also abroad", () => {
  expectAll([
    [true, "Du måste vara bosatt i Sverige.", "SE", "DE"],
    [true, "Du skal bo i Danmark.", "DK"],
    [false, "Vi är bosatta i Sverige.", "SE", "DE"],
    [true, "Sijainti: Helsinki / etä. Edellytämme, että asut Suomessa.", "FI"],
    [false, "Külföldi lakhellyel is jelentkezhetsz.", "HU"],
    [false, "Jelenlegi lakhelyedtől függetlenül dolgozhatsz velünk.", "HU"],
    [true, "Budapesti vagy Pest megyei lakhellyel.", "HU"],
    [false, "We groeien hard en zijn nu ook buiten Nederland actief.", "NL"],
    [true, "We cannot hire outside of Sweden.", "SE", "DE"],
    [true, "You must be an EU citizen and reside in Spain.", "ES"],
    [false, "You must be eligible to live and work in Germany.", "DE"],
    [false, "Remote aus Deutschland – auch aus dem Ausland möglich.", "DE"],
    [false, "Du arbeitest remote in Deutschland oder im europäischen Ausland.", "DE"],
  ]);
});

test("anywhere in the country, travel time, the country's code in the title", () => {
  expectAll([
    [true, "Δυνατότητα 100% απομακρυσμένης εργασίας από οποιοδήποτε σημείο της Ελλάδας.", "GR", "IT"],
    [true, "Teletrabajo desde cualquier punto de la Península.", "ES", "IT"],
    [true, "Je woont op maximaal een uur reizen van ons kantoor in Utrecht.", "NL", "BE"],
    [true, "Du wohnst maximal eine Stunde von unserem Büro in Hamburg entfernt.", "DE"],
  ]);
  assert.equal(required({ title: "Java Entwickler (w/m/d) – Full Remote (nur DE)" }, "DE", "AT"), true);
  assert.equal(required({ title: "Java Developer (Remote - DE)" }, "DE"), true);
  // IT is also information technology
  assert.equal(required({ title: "IT Support Engineer (Remote)" }, "IT"), false);
  assert.equal(required({ title: "Remote IT Consultant" }, "IT"), false);
});

test("long descriptions are read quickly", () => {
  // The first call builds the patterns
  required({ description: "" }, "DE");
  const blurb =
    "Wir sind ein Unternehmen mit Sitz in München und Kunden in ganz Deutschland, Österreich und der Schweiz. " +
    "Du arbeitest 100% remote innerhalb Deutschlands, mit Workation bis zu 20 Tage aus dem EU-Ausland. ";
  for (const text of [blurb.repeat(160), "deutschland, ".repeat(2500), "wohnsitz in ".repeat(2700), "x".repeat(30000)]) {
    const start = performance.now();
    required({ description: text }, "DE");
    assert.ok(performance.now() - start < 2000, `${text.length} characters took too long`);
  }
});
