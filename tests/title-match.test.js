import { test } from "node:test";
import assert from "node:assert/strict";
import "../extension/scrapers/title-match.js";

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

test("developer and engineer in EU languages read as the English words", () => {
  assert.equal(words("Backend-Entwickler (m/w/d)"), "backend developer m w d");
  assert.equal(words("Softwareentwicklerin"), "software developer");
  assert.equal(words("Développeuse Full-Stack H/F"), "developer fullstack h f");
  assert.equal(words("Programista Python"), "developer python");
  assert.equal(words("Senior Systemutvecklare"), "senior system developer");
  assert.equal(words("Ingénieur logiciel"), "engineer logiciel");
  assert.equal(words("Μηχανικός Λογισμικού / Προγραμματιστής"), "engineer λογισμικου developer");
});

test("titles match across languages", () => {
  assert.ok(matches("Backend-Entwickler (m/w/d)", "Backend Developer"));
  assert.ok(matches("Développeur Full-Stack React (H/F)", "Fullstack Developer"));
  assert.ok(matches("Programista Java", "Java Developer"));
  assert.ok(matches("Ingeniero de software", "Software Engineer"));
  assert.equal(matches("Projektmanager", "Developer"), false);
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
