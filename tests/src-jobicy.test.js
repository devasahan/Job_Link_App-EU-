import { test } from "node:test";
import assert from "node:assert/strict";
import { adapterContract, runFixture } from "./helpers/contract.js";
import { run, toJob, toIso, jobUrl, geoPlaces, geosFor } from "../extension/scrapers/boards/jobicy.js";
import { createCache, memoryStorage } from "../extension/scrapers/core/cache.js";
import { sourceById } from "../extension/scrapers/sources.js";

// The registry entry handed to the integrator (sources.js), with the boards group's defaults
const ENTRY = {
  id: "jobicy",
  label: "Jobicy",
  group: "boards",
  hint: "remote",
  url: "https://jobicy.com",
  module: "./boards/jobicy.js",
  hosts: ["jobicy.com"],
  defaultOn: true,
};
const META = { countries: null, countryBound: false, priority: 30, budgetMs: 120e3, gaps: {}, robots: "api", ...ENTRY };

const page2 = (url) => new URL(url).searchParams.has("cursor");
const geoOf = (call) => new URL(call.url).searchParams.get("geo");

adapterContract({
  id: "jobicy",
  meta: META,
  secondPage: page2,
  empty: { body: { apiVersion: "2", jobCount: 0, jobs: [] } },
  expect: {
    kept: [
      "Senior Backend Engineer",
      "Senior React Developer",
      "Go Developer",
      "Python Developer",
      "DevOps Engineer",
      "Site Reliability Engineer",
      "Backend Developer",
    ],
    dropped: { title: 2, notRemote: 1, restricted: 3, old: 1, type: 1 },
  },
});

test("the registry entry is the one handed over", { skip: (!sourceById("jobicy") || sourceById("jobicy").pending) && "not merged yet" }, () => {
  const live = sourceById("jobicy");
  for (const [key, value] of Object.entries(META)) assert.deepEqual(live[key], value, key);
});

test("a row: jobGeo is who may apply (Anywhere = worldwide), the page link without tracking, UTC dates", () => {
  const job = toJob({
    id: 98765,
    url: "http://jobicy.com/jobs/98765-golang-engineer?utm_source=api#apply",
    jobSlug: "98765-golang-engineer",
    jobTitle: " Golang Engineer ",
    companyName: "Acme",
    jobType: ["full-time", "contract"],
    jobGeo: "Germany,  Austria & Anywhere",
    pubDate: "2026-10-21 10:22:48",
    jobExcerpt: "Short.",
    jobDescription: "<p>Go &amp; gRPC.</p><ul><li>3+ years of experience</li></ul>",
  });
  assert.equal(job.title, "Golang Engineer");
  assert.equal(job.company, "Acme");
  assert.equal(job.location, "Remote (Germany, Austria & Anywhere)");
  assert.equal(job.listing_type, "full-time, contract");
  assert.equal(job.date_posted, "2026-10-21T10:22:48.000Z");
  assert.equal(job.job_url, "https://jobicy.com/jobs/98765-golang-engineer");
  assert.equal(job.job_url_direct, "");
  assert.equal(job.is_remote, "Yes");
  assert.match(job.description, /Go & gRPC\.\n3\+ years of experience/);
  assert.equal(job.years_required, 3);
  assert.equal(job._id, "98765");
  assert.deepEqual(job._where, {
    workplace: null,
    listedIn: null,
    open: ["Germany", "Austria", "Worldwide"],
    emptyOpen: null,
    utc: null,
    remoteOnly: true,
  });
  // No jobGeo: the text decides; no url: one from the slug
  const bare = toJob({ id: 1, jobSlug: "1-dev", jobTitle: "Dev", jobGeo: "", pubDate: "" });
  assert.equal(bare._where.open, null);
  assert.equal(bare.location, "Remote");
  assert.equal(bare.job_url, "https://jobicy.com/jobs/1-dev");
  assert.equal(bare.date_posted, "");
});

test("dates, links and places", () => {
  assert.equal(toIso("2026-10-21T10:22:48+02:00"), "2026-10-21T08:22:48.000Z");
  assert.equal(toIso("1792576800"), "2026-10-21T10:00:00.000Z");
  assert.equal(toIso(1792576800000), "2026-10-21T10:00:00.000Z");
  assert.equal(toIso("soon"), "");
  assert.equal(jobUrl({ url: "https://example.com/jobs/1", jobSlug: "1-x" }), "https://jobicy.com/jobs/1-x");
  assert.equal(jobUrl({}), "");
  assert.deepEqual(geoPlaces("USA, Canada"), ["USA", "Canada"]);
  assert.deepEqual(geoPlaces("Europe / Israel"), ["Europe", "Israel"]);
  assert.deepEqual(geoPlaces("anywhere"), ["Worldwide"]);
  assert.deepEqual(geosFor(""), ["europe", "emea", "anywhere"]);
  assert.deepEqual(geosFor("SE"), ["europe", "sweden", "emea", "anywhere"]);
  // Luxembourg has no slug of its own
  assert.deepEqual(geosFor("LU"), ["europe", "emea", "anywhere"]);
});

test("what is asked: the regions, the page size, a cursor for page 2, never the title", async () => {
  const { calls, report } = await runFixture({ id: "jobicy", meta: META, wanted: 1000, opts: { title: "Backend Developer", stack: "Go" } });
  assert.deepEqual(calls.map((c) => `${geoOf(c)}${page2(c.url) ? "+cursor" : ""}`), ["europe", "europe+cursor", "emea", "anywhere"]);
  for (const call of calls) {
    const u = new URL(call.url);
    assert.equal(u.pathname, "/api/jobs");
    assert.equal(u.searchParams.get("count"), "200");
    assert.equal(u.searchParams.get("tag"), null);
    assert.equal(u.searchParams.get("industry"), null);
  }
  assert.equal(new URL(calls[1].url).searchParams.get("cursor"), "eyJwYWdlIjoyfQ");
  // Listed under Europe and EMEA: counted once
  assert.equal(report.duplicates, 1);
});

test("the open-to cell: the region, or the ticked countries a list names", async () => {
  const { jobs } = await runFixture({ id: "jobicy", meta: META, wanted: 1000 });
  const to = (title) => jobs.find((j) => j.title === title)?.open_to;
  assert.equal(to("Senior Backend Engineer"), "Europe");
  assert.equal(to("Senior React Developer"), "Austria, Germany");
  assert.equal(to("DevOps Engineer"), "France, Spain");
  assert.equal(to("Site Reliability Engineer"), "EMEA");
  assert.equal(to("Backend Developer"), "Worldwide");
  assert.equal(jobs.find((j) => j.title === "Senior Backend Engineer").job_url, "https://jobicy.com/jobs/131001-senior-backend-engineer");
});

test("You live in: the country's own slug is asked; a list without it is restricted; residents only", async () => {
  const se = await runFixture({ id: "jobicy", meta: META, wanted: 1000, opts: { home: "SE" } });
  assert.deepEqual([...new Set(se.calls.map(geoOf))], ["europe", "sweden", "emea", "anywhere"]);
  assert.equal(se.jobs.find((j) => j.company === "Svea Tech AB").open_to, "Sweden");
  assert.equal(se.jobs.find((j) => j.title === "Python Developer").open_to, "Sweden");
  // "You must be based in Germany" on a Europe-wide job
  assert.ok(!se.jobs.some((j) => j.title === "Go Developer"));
  assert.equal(se.report.dropped.residentsOnly, 1);
  assert.ok(!se.jobs.some((j) => j.title === "Senior React Developer"), "DACH only");
  const de = await runFixture({ id: "jobicy", meta: META, wanted: 1000, opts: { home: "DE" } });
  assert.ok(!de.jobs.some((j) => j.title === "Python Developer"), "Sweden only");
  assert.equal(de.jobs.find((j) => j.title === "Senior React Developer").open_to, "Germany");
  assert.ok(de.jobs.some((j) => j.title === "Go Developer"));
});

test("one poll an hour: a second run within the hour reads the cache", async () => {
  let clock = Date.now();
  const storage = memoryStorage();
  const cache = createCache({ storage, now: () => clock }).scope("jobicy");
  const cached = (ctx) => run({ ...ctx, cache });
  const first = await runFixture({ id: "jobicy", meta: META, run: cached, wanted: 1000 });
  assert.equal(first.calls.length, 4);
  // One key per region and page, whatever the cursors: the cache can't grow run after run
  assert.deepEqual(Object.keys(await storage.get(null)).sort(), ["jbcache:jobicy:anywhere|1", "jbcache:jobicy:emea|1", "jbcache:jobicy:europe|1", "jbcache:jobicy:europe|2"]);
  const again = await runFixture({ id: "jobicy", meta: META, run: cached, wanted: 1000 });
  assert.equal(again.calls.length, 0, "nothing asked");
  assert.equal(again.report.kept, first.report.kept);
  clock += 61 * 60e3;
  const later = await runFixture({ id: "jobicy", meta: META, run: cached, wanted: 1000 });
  assert.equal(later.calls.length, 4, "asked again after an hour");
});

test("/api/jobs gone (404): the older /api/v2/remote-jobs, without cursors", async () => {
  const { calls, report } = await runFixture({
    id: "jobicy",
    meta: META,
    wanted: 1000,
    respond: (call) => (new URL(call.url).pathname === "/api/jobs" ? { status: 404, body: "<html>Not Found</html>", contentType: "text/html" } : null),
  });
  assert.equal(report.status, "ok", report.error);
  // One 404, then the older path for every region
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ["/api/jobs", "/api/v2/remote-jobs", "/api/v2/remote-jobs", "/api/v2/remote-jobs"]);
  assert.ok(calls.slice(1).every((c) => new URL(c.url).searchParams.get("count") === "100" && !page2(c.url)));
  assert.equal(report.kept, 6, "europe's page 2 isn't on the older path");
});

test("a region Jobicy refuses (HTTP 400) leaves the others: incomplete, with why", async () => {
  const { report, jobs } = await runFixture({
    id: "jobicy",
    meta: META,
    wanted: 1000,
    respond: (call) => (geoOf(call) === "anywhere" ? { status: 400, body: { success: false, error: "Unknown geo" } } : null),
  });
  assert.equal(report.status, "incomplete");
  assert.match(report.error, /^geo=anywhere: HTTP 400 at jobicy\.com\/api\/jobs/);
  assert.ok(jobs.some((j) => j.title === "Site Reliability Engineer"));
  assert.ok(!jobs.some((j) => j.title === "Backend Developer"));
});

test("an answer that says it failed is reported in Jobicy's words", async () => {
  const { report } = await runFixture({
    id: "jobicy",
    meta: META,
    respond: () => ({ body: { success: false, error: "Rate limit: one request per hour" } }),
  });
  assert.equal(report.status, "failed");
  assert.equal(report.errorKind, "format");
  assert.equal(report.error, "Jobicy refused geo=europe: Rate limit: one request per hour");
});
