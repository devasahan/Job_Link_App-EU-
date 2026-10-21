import { test } from "node:test";
import assert from "node:assert/strict";
import "../extension/scrapers/title-match.js";
import "../extension/scrapers/developer.js";

const matches = (title, query) => globalThis.jbTitleMatches(title, query);
const stack = (job, query) => globalThis.jbStackMatches(job, query);
const words = (text) => globalThis.jbNormalizeWords(text).join(" ");

test("fold drops case and accents in EU languages", () => {
  const fold = globalThis.jbFold;
  assert.equal(fold("Développeur"), "developpeur");
  assert.equal(fold("Straße"), "strasse");
  assert.equal(fold("Łódź"), "lodz");
  assert.equal(fold("Vývojář"), "vyvojar");
  assert.equal(fold("København"), "kobenhavn");
  assert.equal(fold("ΠΡΟΓΡΑΜΜΑΤΙΣΤΗΣ"), "προγραμματιστησ");
});

test("developer, engineer and software in EU languages read as the English words", () => {
  assert.equal(words("Backend-Entwickler (m/w/d)"), "backend developer m w d");
  assert.equal(words("Softwareentwicklerin"), "software developer");
  assert.equal(words("Développeuse Full-Stack H/F"), "developer fullstack h f");
  assert.equal(words("Programista Python"), "developer python");
  assert.equal(words("Programador Java"), "developer java");
  assert.equal(words("Programmeur PHP"), "developer php");
  assert.equal(words("Programmierer (m/w/d)"), "developer m w d");
  assert.equal(words("Java Programmer"), "java programmer");
  assert.equal(words("Senior Systemutvecklare"), "senior system developer");
  assert.equal(words("Ingénieur logiciel"), "engineer software");
  assert.equal(words("Ohjelmistokehittäjä"), "software developer");
  assert.equal(words("Μηχανικός Λογισμικού / Προγραμματιστής"), "engineer software developer");
});

test("titles match across languages", () => {
  assert.ok(matches("Backend-Entwickler (m/w/d)", "Backend Developer"));
  assert.ok(matches("Développeur Full-Stack React (H/F)", "Fullstack Developer"));
  assert.ok(matches("Programista Java", "Java Developer"));
  assert.ok(matches("Ingeniero de software", "Software Engineer"));
  assert.equal(matches("Projektmanager", "Developer"), false);
});

test("next to another word, developer, engineer and programmer are one role", () => {
  assert.ok(matches("Softwareentwickler (m/w/d)", "Software Engineer"));
  assert.ok(matches("Software Developer", "Software Engineer"));
  assert.ok(matches("Ingénieur logiciel", "Software Engineer"));
  assert.ok(matches("Développeur logiciel", "Software Engineer"));
  assert.ok(matches("Backend Engineer", "Backend Developer"));
  assert.ok(matches("Java Programmer", "Java Developer"));
  assert.ok(matches("Programador Java", "Java Developer"));
  assert.ok(matches("Senior Software Engineer", "Senior Developer"));
  // Only for software roles: seniority words don't make a sales or hardware job one
  assert.equal(matches("Senior Sales Engineer", "Senior Developer"), false);
  assert.equal(matches("Junior Network Engineer", "Junior Developer"), false);
  assert.equal(matches("Senior Projektentwickler (m/w/d)", "Senior Engineer"), false);
  assert.equal(matches("Business Developer Software (m/w/d)", "Software Engineer"), false);
  assert.equal(matches("Remote Sales Engineer", "Remote Developer"), false);
  // Alone, each stays itself
  assert.equal(matches("Sales Engineer", "Developer"), false);
  assert.equal(matches("Developer Advocate", "Engineer"), false);
  assert.equal(matches("Software Engineer", "Engineering Manager"), false);
});

test("the US version's synonyms still hold", () => {
  assert.ok(matches("Sr. Front-End Engineer", "Senior Frontend Engineer"));
  assert.ok(matches("Full Stack Dev", "Fullstack Developer"));
  assert.ok(matches("SWE II", "Software Engineer"));
  assert.ok(matches("ASP.NET Developer", ".NET Developer"));
  assert.ok(matches("Golang Engineer", "Go Engineer"));
  assert.ok(matches("Machine Learning Engineer", "ML Engineer"));
  assert.ok(matches("Senior Software Engineering Lead", "software engineer"));
  // German compounds: longer words also count inside a word
  assert.ok(matches("Kubernetesplattform-Engineer", "Kubernetes Engineer"));
});

test("gender forms in a typed title are ignored", () => {
  assert.ok(matches("Softwareentwickler (m/w/d)", "Softwareentwickler*in"));
  assert.ok(matches("Backend Developer (m/w/d)", "Backend Entwickler:in"));
  assert.ok(matches("Softwarearchitekt (m/w/d)", "Softwarearchitekt(in)"));
  assert.ok(matches("Développeur Backend (H/F)", "Développeur·se Backend"));
  assert.ok(matches("Programista Java", "Programista/ka Java"));
  assert.ok(matches("Desarrollador Backend", "Desarrollador/a Backend"));
  assert.ok(matches("Backend Developer", "Backend Developer (m/f/div)"));
  assert.ok(matches("Backend Developer", "Backend Developer (all genders)"));
  assert.equal(globalThis.jbStripGender("Softwareentwickler*in (m/w/d)"), "Softwareentwickler");
  // Slashes between words stay
  assert.equal(globalThis.jbStripGender("UI/UX Developer"), "UI/UX Developer");
  assert.equal(globalThis.jbStripGender("C/C++ Developer"), "C/C++ Developer");
  assert.equal(matches("Frontend Developer", "Frontend/Backend Developer"), false);
});

test("a typed compound matches the title written in parts", () => {
  assert.ok(matches("Software-Architekt (m/w/d)", "Softwarearchitekt"));
  assert.ok(matches("Software Architekt Cloud (m/w/d)", "Softwarearchitekt"));
  assert.ok(matches("Software-Ingenieur (m/w/d)", "Softwareingenieur"));
  assert.ok(matches("System-Administrator", "Systemadministrator"));
  assert.ok(matches("Softwarearchitekt (m/w/d)", "Software Architekt"));
  assert.equal(matches("Software Engineer", "Softwarearchitekt"), false);
  assert.equal(matches("Daten Analyst", "Datenbank"), false);
});

test("commas mean any of the titles", () => {
  assert.ok(matches("Platform Engineer", "Backend Developer, Platform Engineer"));
  assert.ok(matches("Backend-Entwickler", "Backend Developer, Platform Engineer"));
  assert.equal(matches("Data Scientist", "Backend Developer, Platform Engineer"), false);
  assert.ok(matches("Anything", " , ;"));
});

test("stack words are whole words in title or description", () => {
  const job = {
    title: "Backend Engineer",
    description: "We use Golang, k8s and PostgreSQL. Frontend in React.js and Next.js. Python3 for scripts.",
  };
  assert.ok(stack(job, "Go Kubernetes Postgres"));
  assert.ok(stack(job, "React Next.js"));
  assert.ok(stack(job, "Python"));
  assert.equal(stack({ title: "", description: "Google Cloud" }, "Go"), false);
  assert.equal(stack({ title: "", description: "JavaScript" }, "Java"), false);
  assert.ok(stack({ title: "", description: "Express.js API" }, "Express"));
});
