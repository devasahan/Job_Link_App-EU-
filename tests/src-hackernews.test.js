import { test } from "node:test";
import assert from "node:assert/strict";
import { adapterContract, runFixture } from "./helpers/contract.js";
import { toJob } from "../extension/scrapers/boards/hackernews.js";
import { DATE_PRESETS } from "../extension/scrapers/util.js";
import { sourceById } from "../extension/scrapers/sources.js";

// The registry entry handed to the integrator (sources.js), with the boards group's defaults
const ENTRY = {
  id: "hackernews",
  label: "Hacker News",
  group: "boards",
  hint: "Who is hiring",
  url: "https://news.ycombinator.com",
  module: "./boards/hackernews.js",
  hosts: ["hn.algolia.com"],
  defaultOn: true,
  priority: 40,
};
const META = { countries: null, countryBound: false, budgetMs: 120e3, gaps: {}, robots: "api", ...ENTRY };

const params = (call) => new URL(call.url).searchParams;
const isComments = (url) => /^comment,/.test(new URL(url).searchParams.get("tags") || "");
const page2 = (url) => isComments(url) && new URL(url).searchParams.get("page") === "1";

adapterContract({
  id: "hackernews",
  meta: META,
  secondPage: page2,
  empty: { body: { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 1000 } },
  expect: {
    kept: [
      "Senior Backend Engineer",
      "Go Developer",
      "Data Platform Engineer",
      "Senior Backend Engineer (Python)",
      "DevOps Engineer",
      "Backend Engineer (Rust)",
      "Hybrid Cloud Engineer",
      "Senior Software Engineer",
      "Software Engineer",
    ],
    dropped: { title: 1, old: 1, notRemote: 2, notOpen: 3 },
  },
});

test("the registry entry is the one handed over", { skip: (!sourceById("hackernews") || sourceById("hackernews").pending) && "not merged yet" }, () => {
  const live = sourceById("hackernews");
  for (const [key, value] of Object.entries(META)) assert.deepEqual(live[key], value, key);
});

let seq = 1;
const post = (html, extra = {}) => ({ objectID: String(9000 + seq++), comment_text: html, created_at_i: 1792576800, parent_id: 1, ...extra });

test("a post: company, role, the header's place parts, the work mode, the ATS link", () => {
  const job = toJob(
    post(
      'Acme (YC W21) | Senior Engineer (Remote, EU) | $150k-$180k + equity | Full-time<p>We&#x27;re building <i>fast</i> things. 4+ years of experience with TypeScript.<p>See <a href="https:&#x2F;&#x2F;acme.example" rel="nofollow">https:&#x2F;&#x2F;acme.example</a> and apply at <a href="https:&#x2F;&#x2F;boards.greenhouse.io&#x2F;acme&#x2F;jobs&#x2F;1" rel="nofollow">https:&#x2F;&#x2F;boards.greenhouse.io&#x2F;acme&#x2F;jobs&#x2F;1</a>'
    )
  );
  assert.equal(job.company, "Acme");
  assert.equal(job.title, "Senior Engineer");
  assert.equal(job.location, "Remote, EU");
  assert.equal(job.listing_type, "Full-time");
  assert.equal(job.date_posted, "2026-10-21T10:00:00.000Z");
  assert.equal(job.job_url, `https://news.ycombinator.com/item?id=${job._id}`);
  assert.equal(job.job_url_direct, "https://boards.greenhouse.io/acme/jobs/1");
  assert.equal(job.is_remote, "Yes");
  assert.equal(job.years_required, 4);
  assert.match(job.description, /^Acme \(YC W21\) \| Senior Engineer[^\n]*\nWe're building fast things\./);
  // Who may apply is the text check's (open-to.js rule 7): nothing structured
  assert.deepEqual(job._where, { workplace: "remote", listedIn: null, open: null, emptyOpen: null, utc: null, remoteOnly: false });
});

test("the work mode comes from the header; a remote word wins, a place without one is on-site", () => {
  const mode = (header, body = "Body.") => toJob(post(`${header}<p>${body}`))._where.workplace;
  assert.equal(mode("Acme | Backend Engineer | Remote (US) or Onsite (Berlin)"), "remote");
  assert.equal(mode("Acme | Backend Engineer | ONSITE, REMOTE | Full-time"), "remote");
  assert.equal(mode("Acme | Backend Engineer | Hybrid (London) or Remote (UK/EU)"), "remote");
  assert.equal(mode("Acme | Backend Engineer | Berlin, Germany | Hybrid"), "hybrid");
  assert.equal(mode("Acme | Backend Engineer | Partially remote (2 days a week in the office)"), "hybrid");
  assert.equal(mode("Acme | Backend Engineer | No remote | NYC"), "onsite");
  assert.equal(mode("Acme | Backend Engineer | SF | Full-time"), "onsite");
  assert.equal(mode("Acme | Backend Engineer | Lisbon, Portugal"), "onsite");
  assert.equal(mode("Acme | Senior Engineer - Onsite | $150k"), "onsite");
  // Not a work mode: a technology, the company's own name
  assert.equal(mode("Acme | Hybrid Cloud Engineer | Remote (Europe)"), "remote");
  assert.equal(mode("Hybrid Labs | Backend Engineer | Remote (EU)"), "remote");
  // A region alone: the posting decides
  assert.equal(mode("Acme | Backend Engineer | Europe | Full-time"), null);
  // Neither place nor mode: the next two lines
  assert.equal(mode("Acme | Backend Engineer | Full-time", "We're a fully remote team."), "remote");
  assert.equal(mode("Acme | Backend Engineer | Full-time", "This role is onsite in our Berlin office."), "onsite");
  assert.equal(mode("Acme | Backend Engineer | Full-time", "We're a Berlin-based startup."), null);
});

test("an office plus a remote part that names places or time zones: the remote part says who may apply", () => {
  const read = (header, opts = {}) => {
    const job = toJob(post(`${header}<p>We build developer tools in TypeScript and Go.`));
    const place = globalThis.jbOpenTo(job, job._where, { ticked: ["DE", "SE", "PL"], abroad: [], home: "", ...opts });
    return { location: job.location, head: job.description.split("\n")[0], to: place.open ? place.to : place.reason };
  };
  assert.deepEqual(read("Acme | Senior SWE | Berlin, Germany | Remote (CET ±2h)"), {
    location: "Remote (CET ±2h)",
    head: "Acme | Senior SWE | | Remote (CET ±2h)",
    to: "European time zones",
  });
  assert.equal(read("Acme | Senior SWE | Berlin, Germany | Remote (CET ±2h)", { home: "SE" }).to, "European time zones");
  assert.equal(read("Acme | Senior SWE | London, UK | Remote (GMT ±2h)").to, "European time zones");
  assert.equal(read("Acme | Senior SWE | Amsterdam, Netherlands | Onsite or Remote (EU time zones)", { ticked: ["DE"] }).to, "European time zones");
  // The company keeps its name when it shares the office's
  assert.equal(read("Berlin Labs | Backend Engineer, Berlin | Remote (EU)").head, "Berlin Labs | Backend Engineer, | Remote (EU)");
  // A plain "REMOTE" says nothing about who: the office's country still does
  const plain = read("Acme | Senior SWE | Berlin, Germany | REMOTE");
  assert.equal(plain.location, "Berlin, Germany | REMOTE");
  assert.equal(plain.to, "Germany");
  // A remote part that names a country opens only to it
  assert.equal(read("Acme | Senior SWE | Paris, France | Hybrid or Remote (France)", { ticked: ["DE", "FR"] }).to, "France");
  assert.equal(read("Acme | Senior SWE | Paris, France | Hybrid or Remote (France)", { ticked: ["DE"] }).to, "notOpen");
});

test("headers: newer <p>-wrapped HTML, other separators, roles without a role word, multiple roles", () => {
  const wrapped = toJob(post("<p>Acme | Backend Engineer | REMOTE (EU)</p><p>Rust and Go.</p>"));
  assert.equal(wrapped.title, "Backend Engineer");
  assert.equal(wrapped.location, "REMOTE (EU)");
  assert.equal(wrapped.description, "Acme | Backend Engineer | REMOTE (EU)\nRust and Go.");
  const dashes = toJob(post("Acme — Platform Engineer — Remote (Europe)<p>Kubernetes."));
  assert.equal(dashes.title, "Platform Engineer");
  assert.equal(dashes.location, "Remote (Europe)");
  assert.equal(toJob(post("Acme | Tech Lead | REMOTE (EU)<p>We are a team of 12 engineers.")).title, "Tech Lead");
  const many = toJob(post("Acme | Multiple roles | Remote (EU)<p>We&#x27;re hiring:<p>- Senior Backend Engineer (Python)<p>- Engineering Manager"));
  assert.equal(many.title, "Senior Backend Engineer (Python)");
  // With a Title typed, the part or line that matches it
  assert.equal(toJob(post("Acme | Backend Engineer, Frontend Engineer | Remote (EU)<p>x"), "Frontend Developer").title, "Backend Engineer, Frontend Engineer");
  assert.equal(toJob(post("Acme | Multiple roles | Remote (EU)<p>- Backend Engineer<p>- Frontend Developer"), "Frontend Developer").title, "Frontend Developer");
  assert.equal(toJob(post("Acme | Contract Backend Engineer | Remote (EU)<p>x")).listing_type, "Contract");
});

test("not job posts: seekers, their template, no header; a company that is seeking stays", () => {
  assert.equal(toJob(post("SEEKING WORK | Remote (Europe) | Python, Django<p>Looking for contract work.")), null);
  assert.equal(toJob(post("Location: Lisbon, Portugal | Remote: Yes | Willing to relocate: No<p>Technologies: Go")), null);
  assert.equal(toJob(post("Backend developer | available for hire | Remote")), null);
  assert.equal(toJob(post("We&#x27;re hiring at Acme! Come build with us.")), null);
  const hiring = toJob(post("Acme | Seeking a Senior Engineer | Remote (EU)<p>x"));
  assert.ok(hiring);
  assert.equal(hiring.title, "Seeking a Senior Engineer");
});

test("what is asked: the whoishiring threads, then the newest thread's comments in the window", async () => {
  const { calls } = await runFixture({ id: "hackernews", meta: META, wanted: 1000 });
  assert.equal(calls.length, 3);
  const stories = params(calls[0]);
  assert.equal(new URL(calls[0].url).pathname, "/api/v1/search_by_date");
  assert.equal(stories.get("tags"), "story,author_whoishiring");
  assert.equal(stories.get("attributesToHighlight"), "none");
  const comments = params(calls[1]);
  assert.equal(comments.get("tags"), "comment,story_45500000");
  assert.equal(comments.get("hitsPerPage"), "1000");
  assert.deepEqual([params(calls[1]).get("page"), params(calls[2]).get("page")], ["0", "1"]);
  const cutoff = Number(comments.get("numericFilters").replace("created_at_i>", ""));
  assert.ok(Math.abs(cutoff - (Date.now() / 1000 - 24 * 3600)) < 60, "the Posted window");
});

test("the open-to cell: what the posting says, read by the text check", async () => {
  const { jobs } = await runFixture({ id: "hackernews", meta: META, wanted: 1000 });
  const to = (company) => jobs.find((j) => j.company === company)?.open_to;
  assert.equal(to("Nordlys Software AB"), "EU");
  assert.equal(to("Fjord Analytics"), "European time zones");
  assert.equal(to("Loire Cloud"), "France, Spain");
  // "Remote (Europe)" narrowed by "you must be based in Germany"
  assert.equal(to("Rhein Robotics"), "Germany");
  assert.equal(to("Tidewater"), "Europe");
  assert.equal(jobs.find((j) => j.company === "Nordlys Software AB").job_url_direct, "https://jobs.lever.co/nordlys/7f1c2e");
  assert.equal(jobs.find((j) => j.company === "Globetrot").job_url_direct, "https://jobs.ashbyhq.com/globetrot");
});

test("You live in: a job that must be done from another country is left out", async () => {
  const { jobs, report } = await runFixture({ id: "hackernews", meta: META, wanted: 1000, opts: { home: "SE", countries: ["DE", "SE"] } });
  assert.ok(!jobs.some((j) => j.company === "Rhein Robotics"));
  assert.ok(!jobs.some((j) => j.company === "Loire Cloud"), "France or Spain only");
  assert.ok(jobs.some((j) => j.company === "Nordlys Software AB"));
  assert.equal(report.dropped.notOpen, 5);
});

test("a window reaching past the thread's start reads last month's thread too", async () => {
  const { calls, jobs } = await runFixture({ id: "hackernews", meta: META, wanted: 1000, opts: { preset: DATE_PRESETS.month } });
  assert.equal(params(calls[1]).get("tags"), "comment,(story_45500000,story_45100000)");
  assert.deepEqual(jobs.map((j) => j.company), ["Septima"]);
});

test("no thread in the last 45 days: nothing to read, not a failure", async () => {
  const old = Math.floor(Date.now() / 1000) - 50 * 86400;
  const { calls, report } = await runFixture({
    id: "hackernews",
    meta: META,
    respond: (call) =>
      params(call).get("tags") === "story,author_whoishiring"
        ? { body: { hits: [{ objectID: "1", title: "Ask HN: Who is hiring? (August 2026)", created_at_i: old }], nbPages: 1 } }
        : null,
  });
  assert.equal(calls.length, 1);
  assert.equal(report.status, "ok");
  assert.equal(report.kept, 0);
  assert.deepEqual(report.notes, ["Hacker News: no “Who is hiring?” thread in the last 45 days"]);
});

test("a typed Title picks the matching role", async () => {
  const { jobs } = await runFixture({ id: "hackernews", meta: META, wanted: 1000, opts: { title: "DevOps Engineer" } });
  assert.deepEqual(jobs.map((j) => j.title), ["DevOps Engineer"]);
});
