import { test } from "node:test";
import assert from "node:assert/strict";
import { adapterContract, runFixture } from "./helpers/contract.js";
import { sourceById } from "../extension/scrapers/sources.js";
import { ASHBY_BOARDS } from "../extension/scrapers/careers/companies.js";
import { toJob } from "../extension/scrapers/careers/ashby.js";
import { reportText } from "../extension/scrapers/core/diagnostics.js";

// Three companies: two boards and one gone (404)
const company = (token) => ASHBY_BOARDS.find((c) => c.token === token);
const COMPANIES = ["posthog", "n8n", "sentry"].map(company);
const meta = { ...sourceById("ashby"), companies: COMPANIES };

adapterContract({
  id: "ashby",
  meta,
  empty: { body: { apiVersion: "1", jobs: [] } },
  expect: {
    kept: ["Senior Full Stack Engineer", "Backend Engineer", "Mobile Engineer (iOS)", "Senior Backend Engineer", "Senior Frontend Engineer"],
    dropped: { notRemote: 3, restricted: 1, title: 1, old: 1, type: 1 },
  },
});

test("one request per company; each its own part with its Count; unlisted jobs unseen; a 404 is a note", async () => {
  const { report, jobs, calls } = await runFixture({ id: "ashby", meta });
  assert.deepEqual(
    calls.map((c) => `${new URL(c.url).pathname} ${c.status}`),
    ["/posting-api/job-board/posthog 200", "/posting-api/job-board/n8n 200", "/posting-api/job-board/sentry 404"]
  );
  assert.equal(report.status, "ok");
  assert.deepEqual(report.notes, ["Ashby: 1 company not found (HTTP 404): Sentry (sentry)"]);
  // PostHog lists 7 (one unlisted), all scanned
  assert.deepEqual([report.parts.PostHog.scanned, report.parts.PostHog.kept, report.parts.PostHog.note], [7, 3, "7 jobs listed"]);
  assert.ok(!jobs.some((j) => j.title === "Frontend Engineer"));
  assert.match(reportText({ reports: [report] }), /Ashby by company\n- PostHog \(posthog\): 7 jobs listed, 7 scanned → 3 kept\n- n8n: 5 jobs listed, 5 scanned → 2 kept\n- Sentry \(sentry\): not found \(HTTP 404\)\n/);
  // Count per company: the newest of each, and no more of them checked
  const one = await runFixture({ id: "ashby", meta, wanted: 1 });
  assert.deepEqual(one.jobs.map((j) => `${j.company}: ${j.title}`), ["PostHog: Senior Full Stack Engineer", "n8n: Senior Backend Engineer"]);
  assert.ok(one.report.parts.PostHog.scanned < 7);
});

test("workplace: workplaceType over isRemote, isRemote when it's unset, else the words; the posting can still say hybrid", async () => {
  const { report, jobs } = await runFixture({ id: "ashby", meta });
  const by = (title) => jobs.find((j) => j.title === title);
  // workplaceType Hybrid though isRemote is true; OnSite; and "Europe" with a posting that says hybrid
  assert.equal(report.dropped.notRemote, 3);
  assert.equal(by("Backend Engineer").is_remote, "Yes");
  assert.equal(by("Backend Engineer").country, "DE");
  // A US address on a plain Remote job is left to the posting: this one hires anywhere
  assert.equal(by("Mobile Engineer (iOS)").open_to, "Worldwide");
  assert.equal(by("Senior Backend Engineer").open_to, "Germany, Netherlands");
  assert.equal(by("Senior Backend Engineer").location, "Berlin; Remote - Germany; Remote - Netherlands");
});

test("You live in Germany, Finland or Spain", async () => {
  const titles = (r) => r.jobs.map((j) => `${j.company}: ${j.title}`).sort();
  // Germany: the jobs placed in Germany are in your country; one open to Germany and the Netherlands stays
  const de = await runFixture({ id: "ashby", meta, opts: { home: "DE" } });
  assert.deepEqual(titles(de), ["PostHog: Mobile Engineer (iOS)", "PostHog: Senior Full Stack Engineer", "n8n: Senior Backend Engineer"]);
  assert.equal(de.report.dropped.inHome, 2);
  // Finland: Germany and the Netherlands only is restricted; must be based in Germany is residents only
  const fi = await runFixture({ id: "ashby", meta, opts: { home: "FI" } });
  assert.deepEqual(titles(fi), ["PostHog: Backend Engineer", "PostHog: Mobile Engineer (iOS)", "PostHog: Senior Full Stack Engineer"]);
  assert.deepEqual([fi.report.dropped.restricted, fi.report.dropped.residentsOnly], [2, 1]);
  // Spain, with Germany unticked: placed in other countries
  const es = await runFixture({ id: "ashby", meta, opts: { home: "ES", countries: ["ES", "FR"] } });
  assert.deepEqual(titles(es), ["PostHog: Mobile Engineer (iOS)", "PostHog: Senior Full Stack Engineer"]);
  assert.equal(es.report.dropped.elsewhere, 2);
});

test("a job: fields, links, the posting as plain text, an HTML-only posting stripped", () => {
  const row = {
    id: "abc-1",
    title: "  Senior   Rust Engineer ",
    location: "Remote - Europe",
    secondaryLocations: [{ location: "Remote - Spain" }, { location: "Remote - Portugal" }, { location: "Remote - Italy" }, { location: "Remote - Europe" }],
    workplaceType: "Remote",
    isRemote: false,
    publishedAt: "2026-10-25T09:30:00.000+02:00",
    employmentType: "Contract",
    jobUrl: "https://jobs.ashbyhq.com/Enode/abc-1",
    applyUrl: "https://jobs.ashbyhq.com/Enode/abc-1/application",
    descriptionHtml: "<p>Ignored when plain text is there.</p>",
    descriptionPlain: "Rust and Tokio.\n5+ years of experience.",
  };
  const job = toJob(row, company("Enode"));
  assert.equal(job.title, "Senior Rust Engineer");
  assert.equal(job.company, "Enode");
  assert.equal(job.location, "Remote - Europe; Remote - Spain; Remote - Portugal + 1 more");
  assert.equal(job.listing_type, "Contract");
  assert.equal(job.date_posted, "2026-10-25T07:30:00.000Z");
  assert.equal(job.job_url, "https://jobs.ashbyhq.com/Enode/abc-1");
  assert.equal(job.job_url_direct, "https://jobs.ashbyhq.com/Enode/abc-1/application");
  assert.equal(job.description, "Rust and Tokio.\n5+ years of experience.");
  assert.equal(job.years_required, 5);
  assert.equal(job._id, "Enode:abc-1");
  assert.deepEqual(job._where.open, ["Remote - Europe", "Remote - Spain", "Remote - Portugal", "Remote - Italy"]);
  const bare = toJob({ id: "x 2", title: "Dev", employmentType: "FullTime", workplaceType: "OnSite", descriptionHtml: "<p>Go</p><ul><li>Kubernetes</li></ul>" }, company("kraken.com"));
  assert.equal(bare.job_url, "https://jobs.ashbyhq.com/kraken.com/x%202");
  assert.equal(bare.job_url_direct, "");
  assert.equal(bare.description, "Go\nKubernetes");
  assert.equal(bare.listing_type, "Full Time");
  assert.equal(bare.is_remote, "No");
});
