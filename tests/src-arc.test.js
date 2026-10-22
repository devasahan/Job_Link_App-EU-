import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { adapterContract, runFixture } from "./helpers/contract.js";
import { FIXTURES_DIR } from "./helpers/fixture.js";
import { toJob, toIso, jobArrays, readPage } from "../extension/scrapers/boards/arc.js";
import { DATE_PRESETS } from "../extension/scrapers/util.js";
import { jobKeys } from "../extension/scrapers/history.js";
import { mergeSources } from "../extension/scrapers/index.js";

// The registry entry this adapter ships with (sources.js)
const META = {
  id: "arc",
  label: "Arc.dev",
  group: "boards",
  hint: "free profile (fragile)",
  url: "https://arc.dev",
  module: "./boards/arc.js",
  hosts: ["arc.dev"],
  defaultOn: false,
  gaps: { "arc.dev": 1500 },
  robots: "obey",
};
const id = META.id;
const fixture = (file) => fs.readFileSync(path.join(FIXTURES_DIR, id, file), "utf8");
const pageOf = (url) => new URL(url).searchParams.get("page");
const isRobots = (url) => new URL(url).pathname === "/robots.txt";
const isList = (url) => new URL(url).pathname === "/remote-jobs";
const page2 = (url) => isList(url) && pageOf(url) === "2";
/** A Next.js page whose __NEXT_DATA__ holds these pageProps. */
const nextPage = (pageProps) =>
  `<!DOCTYPE html><html><head><title>Arc</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps }, page: "/remote-jobs", buildId: "x" })}</script></body></html>`;
const html = (body) => ({ body, contentType: "text/html" });
const hoursAgo = (h) => String(Math.floor(Date.now() / 1000) - h * 3600);

adapterContract({
  id,
  meta: META,
  secondPage: page2,
  empty: { body: fixture("empty.html"), contentType: "text/html" },
  expect: {
    kept: ["Senior Frontend Engineer", "Full Stack Developer", "DevOps Engineer", "Golang Engineer", "Software Engineer, Platform", "Elixir Developer"],
    dropped: { title: 1, old: 2, notRemote: 1, restricted: 1, notOpen: 1 },
  },
});

test("a row: links, dates, countries, company and job type, read defensively", () => {
  const job = toJob({
    id: 42,
    title: "Backend Engineer",
    company: { name: "Kestrel Labs" },
    requiredCountries: ["de", { code: "SE", name: "Sweden" }, "US", "PL"],
    postedAt: 1792576800,
    jobType: "fulltime",
    slug: "kestrel-labs-backend-engineer-k1",
    applyUrl: "https://kestrel.example/apply",
    categories: [{ name: "Node.js" }, "Postgres"],
    primarySkills: [{ name: "TypeScript" }],
    description: "<p>APIs.</p>",
    minYearsOfExperience: 4,
  });
  assert.equal(job.job_url, "https://arc.dev/remote-jobs/j/kestrel-labs-backend-engineer-k1");
  assert.equal(job.job_url_direct, "https://kestrel.example/apply");
  assert.equal(job.date_posted, "2026-10-21T10:00:00.000Z");
  assert.equal(job.listing_type, "Full Time");
  assert.equal(job.company, "Kestrel Labs");
  assert.equal(job.location, "Remote (Germany, Sweden, United States + 1 more)");
  assert.equal(job.description, "APIs. Node.js Postgres TypeScript");
  assert.equal(job.years_required, 4);
  assert.equal(job._id, "arc:42");
  assert.deepEqual(job._where, { workplace: null, listedIn: null, open: ["de", "SE", "US", "PL"], emptyOpen: "world", utc: null, remoteOnly: true });
  // Milliseconds, ISO and numeric strings read the same; a path is on arc.dev
  assert.equal(toIso(1792576800000), "2026-10-21T10:00:00.000Z");
  assert.equal(toIso("1792576800"), "2026-10-21T10:00:00.000Z");
  assert.equal(toIso("2026-10-21T10:00:00Z"), "2026-10-21T10:00:00.000Z");
  assert.equal(toIso("soon"), "");
  const byPath = toJob({ title: "Dev", path: "/remote-jobs/j/dev-z9", companyName: "Acme", workplaceType: "On-site" });
  assert.equal(byPath.job_url, "https://arc.dev/remote-jobs/j/dev-z9");
  assert.equal(byPath._where.workplace, "onsite");
  assert.equal(byPath.is_remote, "No");
});

test("external jobs: their own link, and an empty country list leaves it to the text", () => {
  const job = toJob({ id: "e1", title: "Data Engineer", companyName: "Quanta AI", url: "https://quanta.example/jobs/1", requiredCountries: [] }, { external: true });
  assert.equal(job.job_url, "https://quanta.example/jobs/1");
  assert.equal(job.job_url_direct, "");
  assert.equal(job._id, "ext:e1");
  assert.equal(job.location, "Remote");
  assert.equal(job._where.emptyOpen, null);
  // A location that names places stands in for the list
  const placed = toJob({ title: "Dev", location: "Europe", requiredCountries: [] }, { external: true });
  assert.deepEqual(placed._where.open, ["Europe"]);
  assert.equal(placed.location, "Remote (Europe)");
  assert.equal(placed.anonymous, true);
});

test("a row with no url or slug has no link: the listing page would make every such job one", () => {
  const bare = (title, company) => toJob({ randomKey: title, title, ...(company ? { company: { name: company } } : {}) });
  const jobs = [bare("Senior Backend Engineer", "Alpha"), bare("Frontend Developer", "Beta")];
  assert.deepEqual(jobs.map((j) => j.job_url), ["", ""]);
  assert.equal(jobs[0]._id, "arc:Senior Backend Engineer");
  assert.equal(toJob({ title: "Go Developer", companyName: "Gamma" })._id, "arc:Go Developer|Gamma");
  // Downloaded, they don't hide later Arc jobs
  const later = jobKeys(bare("Go Developer", "Gamma"));
  assert.ok(!jobs.flatMap(jobKeys).some((k) => later.includes(k)));
  // Without a company, the merge leaves them apart
  const anonymous = [bare("Senior Backend Engineer"), bare("Frontend Developer")];
  assert.ok(anonymous.every((j) => j.anonymous));
  assert.deepEqual(mergeSources(anonymous), { jobs: anonymous, merged: 0 });
});

test("You live in: a list that names your country opens the job; 'must be based in' elsewhere is residents only", async () => {
  const se = await runFixture({ id, meta: META, opts: { home: "SE" } });
  assert.equal(se.jobs.find((j) => j.title === "Elixir Developer").open_to, "Sweden");
  assert.ok(!se.jobs.some((j) => j.title === "Golang Engineer"));
  assert.equal(se.report.dropped.residentsOnly, 1);
  const de = await runFixture({ id, meta: META, opts: { home: "DE" } });
  assert.equal(de.jobs.find((j) => j.title === "Full Stack Developer").open_to, "Germany");
  assert.ok(!de.jobs.some((j) => j.title === "Elixir Developer"));
});

test("pages: no page parameter first, ?page=N after, until an empty page; own repeats counted apart", async () => {
  const { calls, jobs, report } = await runFixture({ id, meta: META });
  assert.ok(isRobots(calls[0].url), "robots.txt is read first");
  assert.deepEqual(calls.filter((c) => isList(c.url)).map((c) => pageOf(c.url)), [null, "2", "3"]);
  assert.equal(report.duplicates, 1, "page 2 shows page 1's first job again");
  assert.equal(jobs.find((j) => j.title === "Full Stack Developer").open_to, "Germany, Netherlands, Poland");
  assert.equal(jobs.find((j) => j.title === "Senior Frontend Engineer").open_to, "Worldwide");
  assert.equal(jobs.find((j) => j.title === "Software Engineer, Platform").open_to, "Europe");
});

test("the data moved: job lists found deeper in the page data, other arrays ignored", async () => {
  const row = (n, h) => ({ id: n, title: `Developer ${n}`, company: { name: "Acme" }, requiredCountries: [], postedAt: hoursAgo(h), slug: `acme-dev-${n}` });
  const moved = nextPage({ seo: { title: "Jobs" }, categories: [{ title: "Backend", slug: "backend" }], data: { jobs: { items: [row(1, 1), row(2, 2)] }, featuredExternal: [{ title: "Developer 3", companyName: "Beta", postedAt: hoursAgo(3), url: "https://beta.example/3" }] } });
  const { lists } = readPage(moved, 1);
  assert.deepEqual(lists.map((l) => [l.external, l.rows.length]).sort(), [[false, 2], [true, 1]]);
  const { report, jobs } = await runFixture({ id, meta: META, respond: (call) => (isList(call.url) ? html(pageOf(call.url) ? fixture("empty.html") : moved) : null) });
  assert.equal(report.status, "ok", report.error);
  assert.deepEqual(jobs.map((j) => j.title).sort(), ["Developer 1", "Developer 2"]);
  assert.equal(report.dropped.notOpen, 1, "the external one says nothing about where");
  assert.deepEqual(jobArrays({ a: [1, 2], b: [{ name: "x" }] }), []);
});

test("a changed page says what came back", async () => {
  const noJobs = await runFixture({ id, meta: META, respond: (call) => (isList(call.url) ? html(nextPage({ seo: {}, categories: [{ name: "Data" }] })) : null) });
  assert.equal(noJobs.report.status, "failed");
  assert.equal(noJobs.report.errorKind, "format");
  assert.equal(noJobs.report.error, "unexpected response from Arc.dev page 1 (keys: seo, categories)");
  const appRouter = await runFixture({ id, meta: META, respond: (call) => (isList(call.url) ? html("<!DOCTYPE html><html><body><script>self.__next_f.push([1,\"…\"])</script></body></html>") : null) });
  assert.equal(appRouter.report.error, "unexpected response from Arc.dev page 1 (Next.js app-router data, no __NEXT_DATA__)");
  const broken = await runFixture({ id, meta: META, respond: (call) => (isList(call.url) ? html('<script id="__NEXT_DATA__" type="application/json">{"props":</script>') : null) });
  assert.match(broken.report.error, /^unexpected response from Arc\.dev page 1 \(malformed __NEXT_DATA__ JSON/);
});

test("paging stops: a 404 past the end, the same page again, a whole page past the window", async () => {
  const gone = await runFixture({ id, meta: META, respond: (call) => (page2(call.url) ? { status: 404, body: "Not found", contentType: "text/html" } : null) });
  assert.equal(gone.report.status, "ok", gone.report.error);
  assert.equal(gone.calls.filter((c) => isList(c.url)).length, 2);
  const same = await runFixture({ id, meta: META, respond: (call) => (isList(call.url) ? html(fixture("page1.html")) : null) });
  assert.equal(same.report.status, "ok");
  assert.equal(same.calls.filter((c) => isList(c.url)).length, 2, "page 2 repeats page 1: stop");
  const old = (n) => ({ id: n, title: `Developer ${n}`, company: { name: "Acme" }, postedAt: hoursAgo(100), slug: `d-${n}` });
  let n = 0;
  const stale = await runFixture({ id, meta: META, opts: { preset: DATE_PRESETS.today }, respond: (call) => (isList(call.url) ? html(nextPage({ arcJobs: [old(++n), old(++n)], externalJobs: [] })) : null) });
  assert.equal(stale.calls.filter((c) => isList(c.url)).length, 1);
  assert.equal(stale.report.dropped.old, 2);
});

test("robots.txt disallowing the listing fails the source, saying so; a challenge page is blocked", async () => {
  const robots = await runFixture({ id, meta: META, respond: (call) => (isRobots(call.url) ? { body: "User-agent: *\nDisallow: /remote-jobs\n", contentType: "text/plain" } : null) });
  assert.equal(robots.report.status, "failed");
  assert.equal(robots.report.errorKind, "robots");
  assert.equal(robots.report.error, "robots.txt disallows /remote-jobs on arc.dev");
  const challenge = await runFixture({ id, meta: META, respond: (call) => (isList(call.url) ? html("<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>") : null) });
  assert.equal(challenge.report.status, "failed");
  assert.equal(challenge.report.errorKind, "blocked");
  assert.equal(challenge.report.error, "a challenge page at arc.dev/remote-jobs");
});
