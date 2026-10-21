import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/developer.js";

const isDeveloper = (t) => globalThis.jbIsDeveloperTitle(t);

const DEVELOPER = [
  "Senior Backend Developer (m/w/d)",
  "Softwareentwickler (m/w/d) Java",
  "Fachinformatiker Anwendungsentwicklung (m/w/d)",
  "Werkstudent Softwareentwicklung",
  "Développeur Full-Stack React H/F",
  "Ingénieur Études et Développement Java",
  "Desarrollador Frontend",
  "Sviluppatore Java",
  "Programista Python",
  "Vývojář .NET",
  "Systemutvecklare",
  "Ohjelmistokehittäjä",
  "Μηχανικός Λογισμικού",
  "Software Engineer",
  "Data Engineer",
  "DevOps Engineer",
  "Site Reliability Engineer",
  "QA Automation Engineer",
  "iOS Developer",
  "Machine Learning Engineer",
  "Engineering Manager",
  "Cloud Architect",
  "CTO",
  "Tech Lead",
  "Founding Engineer",
  "Salesforce Developer",
  "Internal Tools Engineer",
  "Forward Deployed Engineer (EMEA)",
  "Growth Engineer",
  "Build Tools Engineer",
  // Word forms and families no fixture title has
  "Junior PHP vývojáři",
  "Programatoare Java",
  "Programmatrice Java",
  "Ohjelmoija",
  "Mjukvaruingenjör",
  "Programvaruingenjör",
  "Szoftvermérnök",
  "Dateningenieur (m/w/d)",
  "Ingeniero de datos",
  "Testautomatisierungsingenieur (m/w/d)",
  "Testiautomaatioinsinööri",
  "Inżynier automatyzacji testów",
  "Informatiker EFZ Applikationsentwicklung",
  "Ingénieur systèmes embarqués",
  "Arquitecto de software",
  "SDE II",
  "Release Engineer",
  "NLP Engineer",
  "Application Security Engineer",
  "Cloud Infrastructure Engineer",
  "Automotive Software Engineer",
  "Java fejlesztő",
  "Pelien kehittäjä",
  "Concepteur logiciel",
  "Μηχανικός ανάπτυξης λογισμικού",
  "Werkstudent Python (m/w/d)",
  // An industry or a hardware word next to software work
  "Senior iOS Engineer – Connected Hardware (Remote)",
  "Werkstudent Softwareentwicklung Leistungselektronik (m/w/d)",
  "Hardwarenaher Embedded-Entwickler (m/w/d)",
  "Android-Entwickler Automotive (m/w/d)",
  "Junior Web Developer (Construction Tech)",
  "Data Engineer – Renewable Energy (Remote UK)",
  "Electronic Trading Developer",
  "Développeur Web – Facturation Électronique (H/F)",
  "QA Engineer (Manual & Automation)",
  // Web and mobile application engineers
  "Senior Web Application Engineer (Remote, EU)",
  "Mobile Applications Engineer – iOS",
  // A team or business area after the role ("developer experience", "commercial", "sales")
  "Senior Software Engineer, Developer Experience",
  "Staff Engineer, Developer Experience (Remote)",
  "Java Developer – Support & Maintenance",
  ".NET Developer - Commercial Insurance (Remote)",
  "Java Developer, Commercial Lending Platform",
  "Software Engineer – Sales Platform",
  "Backend Engineer, Support Tools",
  // One-word compounds whose stem names software
  "Spillutvikler",
  "Applikasjonsutvikler",
  "Tekoälykehittäjä",
  "Integrationsentwickler SAP PI/PO",
  "Chefentwickler (m/w/d)",
  // Word forms
  "Softvérový inžinier (Java)",
  "Μηχανικός Δεδομένων",
  "Ingénieur Sécurité Logicielle H/F",
  "Ingeniero/a de IA",
  "Embedded Software Designer",
  "Linux Kernel Engineer - Remote",
  "Neural Network Engineer",
];

const NOT_DEVELOPER = [
  "Business Developer B2B",
  "Projektentwickler Immobilien",
  "Personalentwickler (m/w/d)",
  "Produktentwickler Lebensmittel",
  "Sales Engineer",
  "Solutions Engineer",
  "Field Service Engineer",
  "Mechanical Engineer",
  "Electrical Engineer",
  "Bauingenieur (m/w/d)",
  "Civil Engineer",
  "Data Analyst",
  "Product Manager",
  "Mobile Product Manager",
  "UX Designer",
  "IT Support",
  "Account Executive",
  "Marketing Manager",
  "Developer Marketing Manager",
  "SAP Consultant",
  "Senior Developer Content Marketing and Communications Specialist",
  "Growth Marketing Manager (AI Software)",
  "Freelancer (m/w/d) für den Softwaresupport der Auxilium Communication GmbH",
  "MT & AI Localization Engineer (MT-Spezialist) (m/w/d)",
  "Tooling Engineer (Injection Moulding)",
  "",
  // Word forms and families no fixture title has
  "CNC-Programmierer",
  "SPS-Programmierer (m/w/d)",
  "Programator producție",
  "Affärsutvecklare",
  "Eiendomsutvikler",
  "Liiketoiminnan kehittäjä",
  "Szervezetfejlesztő",
  "Bekleidungsentwickler",
  "Course Developer",
  "Wind Project Developer",
  "Desarrollador de negocio",
  "Säljingenjör",
  "Netzwerkingenieur",
  "Cloud Support Engineer",
  "Embedded Hardware Engineer",
  "Software Product Manager",
  "Kehittäjä",
  "Fejlesztő",
  "Data Analyst Intern (Python)",
  "Music Programmer",
  "Sviluppatore di prodotti tessili",
  // Developers of something else, as unlisted compounds or Romance gender forms
  "Verfahrensentwickler (m/w/d) Chemie",
  "Rezepturentwickler Lebensmittel (m/w/d)",
  "Conceptontwikkelaar Retail",
  "Näringslivsutvecklare",
  "Erhvervsudvikler",
  "Hankekehittäjä",
  "Tananyagfejlesztő (e-learning)",
  "HR-utvecklare",
  "Policy Developer",
  "Learning Developer – Remote",
  "Solar Developer",
  "Desarrollador/a de Negocio – Sector Tecnológico",
  "Sviluppatore/trice Commerciale",
  "Programador de Produção",
  // Compound engineers whose stem names another discipline
  "Entwicklungsingenieur Mobile Arbeitsmaschinen (m/w/d)",
  "Systemingenieur Plattform (m/w/d)",
  // Applications, sales, support and data-centre engineers; SAFe roles; IA is Iowa
  "Field Applications Engineer – Embedded",
  "Ingénieur d'Applications H/F",
  "Ingénieur Support Logiciel (H/F)",
  "Ingeniero/a de Soluciones Cloud (Preventa)",
  "Data Centre Engineer (Night Shift)",
  "Ingeniero/a de Centro de Datos",
  "Release Train Engineer (RTE) – SAFe",
  "Project Engineer – Ames, IA",
  "Solutions Engineering Manager, EMEA",
  // "developer" as the audience
  "Technical Writer – Developer Documentation (Remote)",
  "Developer Support Specialist",
  // Managers and teachers of software work
  "Product Manager – Developer Tools",
  "Projektmanager Softwareentwicklung (m/w/d)",
  "Formateur Développeur Web et Web Mobile (H/F)",
  "Docente di Sviluppo Web (Full Stack)",
  "Ausbilder Fachinformatiker Anwendungsentwicklung (m/w/d)",
  "Software Engineering Instructor – Coding Bootcamp",
  "Programista obrabiarek sterowanych numerycznie",
];

test("developer roles in EU languages", () => {
  assert.deepEqual(DEVELOPER.filter((t) => !isDeveloper(t)), []);
});

test("other jobs that share developer words", () => {
  assert.deepEqual(NOT_DEVELOPER.filter((t) => isDeveloper(t)), []);
});

// Real titles labelled by hand (see "about" in the fixture)
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/dev-titles.json", import.meta.url), "utf8"));

// Titles a title-only rule cannot decide, with why
const KNOWN_MISSES = {
  "Senior R&D Engineer – QShield":
    "the posting's full title adds 'Software Protection & Compilation'; an R&D Engineer on a product name names no software work",
};

test("labelled real titles get their label, except the known misses", () => {
  const wrong = [
    ...FIXTURE.developer.filter((t) => !isDeveloper(t)),
    ...FIXTURE.notDeveloper.filter((t) => isDeveloper(t)),
  ];
  assert.deepEqual(wrong.filter((t) => !(t in KNOWN_MISSES)), []);
  // A known miss that now gets its label leaves the list
  assert.deepEqual(Object.keys(KNOWN_MISSES).filter((t) => !wrong.includes(t)), []);
  // …which stays under 2% of each label
  for (const label of ["developer", "notDeveloper"]) {
    const misses = FIXTURE[label].filter((t) => t in KNOWN_MISSES).length;
    assert.ok(misses < FIXTURE[label].length * 0.02, `${misses} known misses among ${label} titles`);
  }
});
