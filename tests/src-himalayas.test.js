import { test } from "node:test";
import assert from "node:assert/strict";
import { adapterContract, runFixture } from "./helpers/contract.js";
import { toJob } from "../extension/scrapers/boards/himalayas.js";
import { DATE_PRESETS } from "../extension/scrapers/util.js";

const page2 = (url) => new URL(url).searchParams.get("page") === "2";

adapterContract({
  id: "himalayas",
  secondPage: page2,
  empty: { body: { offset: 0, limit: 20, totalCount: 0, jobs: [] } },
  expect: {
    kept: ["Senior Backend Engineer", "Python Developer", "Go Developer", "Senior Backend Engineer", "DevOps Engineer"],
    dropped: { title: 1, old: 1, restricted: 2, notRemote: 1, expired: 1 },
  },
});

test("Where: the restriction list (names or codes), empty = worldwide, the time-zone window", () => {
  const job = toJob({
    title: "Go Developer",
    companyName: "Acme",
    locationRestrictions: [{ alpha2: "DE", name: "Germany" }, "Sweden", { name: "Poland" }, "Spain"],
    timezoneRestrictions: [2, 0, "1", -1],
    pubDate: 1792576800,
    guid: "https://himalayas.app/companies/acme/jobs/go",
    applicationLink: "https://acme.example/apply",
    categories: ["React-Native-Developer"],
    description: "<p>Go.</p> Originally posted on Himalayas.",
  });
  assert.deepEqual(job._where, {
    workplace: null,
    listedIn: null,
    open: ["DE", "Sweden", "Poland", "Spain"],
    emptyOpen: "world",
    utc: [-1, 2],
    remoteOnly: true,
  });
  assert.equal(job.location, "Remote (Germany, Sweden, Poland + 1 more)");
  assert.equal(job.date_posted, "2026-10-21T10:00:00.000Z");
  assert.equal(job.job_url, "https://himalayas.app/companies/acme/jobs/go");
  assert.equal(job.job_url_direct, "https://acme.example/apply");
  assert.equal(job.description, "Go. React Native Developer");
  // Milliseconds (the spec's example) read the same; an empty list is worldwide
  const ms = toJob({ title: "Dev", pubDate: 1792576800000, locationRestrictions: [], applicationLink: "https://himalayas.app/x/apply", guid: "g" });
  assert.equal(ms.date_posted, "2026-10-21T10:00:00.000Z");
  assert.equal(ms.location, "Remote (Worldwide)");
  assert.equal(ms.job_url_direct, "");
  assert.equal(ms._where.utc, null);
});

test("what is asked: country with You live in, q for one title, the employment type", async () => {
  const { calls } = await runFixture({ id: "himalayas", opts: { home: "SE", title: "Backend Developer", jobType: "fulltime" } });
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get("sort"), "recent");
  assert.equal(params.get("page"), "1");
  assert.equal(params.get("country"), "SE");
  assert.equal(params.get("q"), "Backend Developer");
  assert.equal(params.get("employment_type"), "Full Time");
  const plain = await runFixture({ id: "himalayas", opts: { title: "Backend Developer, Platform Engineer" } });
  const p = new URL(plain.calls[0].url).searchParams;
  assert.equal(p.get("country"), null);
  assert.equal(p.get("q"), null);
  assert.equal(p.get("employment_type"), null);
});

test("You live in: a list that names your country opens the job; one that leaves it out is restricted", async () => {
  const se = await runFixture({ id: "himalayas", opts: { home: "SE" } });
  const python = se.jobs.find((j) => j.title === "Python Developer");
  assert.equal(python.open_to, "Sweden");
  // "You must be based in Germany" on a worldwide job
  assert.ok(!se.jobs.some((j) => j.title === "Go Developer"));
  assert.equal(se.report.dropped.residentsOnly, 1);
  const de = await runFixture({ id: "himalayas", opts: { home: "DE", countries: ["FR", "SE"] } });
  assert.ok(!de.jobs.some((j) => j.title === "Python Developer"));
  assert.ok(de.jobs.some((j) => j.title === "Go Developer"));
  const nordlys = de.jobs.find((j) => j.company === "Nordlys Software AB");
  assert.equal(nordlys.open_to, "Germany");
});

test("the open-to cell names the ticked countries a list covers; paging stops at totalCount", async () => {
  const { jobs, calls } = await runFixture({ id: "himalayas", opts: { countries: ["DE", "FR", "PL", "SE"] } });
  assert.equal(jobs.find((j) => j.company === "Nordlys Software AB").open_to, "Germany, Poland, Sweden");
  assert.equal(jobs.find((j) => j.title === "DevOps Engineer").open_to, "France");
  assert.equal(jobs.find((j) => j.company === "US Co Inc.").open_to, "Worldwide");
  assert.deepEqual(calls.map((c) => new URL(c.url).searchParams.get("page")), ["1", "2"]);
});

test("a page that is all older than the window ends the paging", async () => {
  const old = (n) => ({ title: `Developer ${n}`, guid: `https://himalayas.app/j/${n}`, pubDate: Math.floor(Date.now() / 1000) - 100 * 3600 });
  const { calls, report } = await runFixture({
    id: "himalayas",
    opts: { preset: DATE_PRESETS.today },
    respond: () => ({ body: { totalCount: 500, jobs: [old(1), old(2)] } }),
  });
  assert.equal(calls.length, 1);
  assert.equal(report.dropped.old, 2);
});
