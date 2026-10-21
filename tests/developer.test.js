import { test } from "node:test";
import assert from "node:assert/strict";
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
];

test("developer roles in EU languages", () => {
  assert.deepEqual(DEVELOPER.filter((t) => !isDeveloper(t)), []);
});

test("other jobs that share developer words", () => {
  assert.deepEqual(NOT_DEVELOPER.filter((t) => isDeveloper(t)), []);
});
