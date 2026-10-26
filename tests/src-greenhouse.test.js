import { test } from "node:test";
import assert from "node:assert/strict";
import { adapterContract, runFixture } from "./helpers/contract.js";
import { sourceById } from "../extension/scrapers/sources.js";
import { GREENHOUSE_BOARDS } from "../extension/scrapers/careers/companies.js";
import { toJob } from "../extension/scrapers/careers/greenhouse.js";
import { checkLine, reportText, sourceLine } from "../extension/scrapers/core/diagnostics.js";
import { SourceError } from "../extension/scrapers/http.js";

// Three companies: one on the main host, one in the EU region, one gone (404 on both)
const company = (token) => GREENHOUSE_BOARDS.find((c) => c.token === token);
const COMPANIES = ["grafanalabs", "proton", "mozilla"].map(company);
const meta = { ...sourceById("greenhouse"), companies: COMPANIES };
const isPosting = (url) => /\/jobs\/\d+$/.test(new URL(url).pathname);
// The board read once more with every posting
const isFull = (url) => new URL(url).searchParams.get("content") === "true";

adapterContract({
  id: "greenhouse",
  meta,
  empty: { body: { jobs: [], meta: { total: 0 } } },
  expect: {
    kept: ["Senior Backend Engineer", "Software Engineer, Frontend", "Backend Developer", "Platform Engineer", "Backend Software Engineer", "Mobile Developer (Android)"],
    dropped: { notRemote: 3, restricted: 1, title: 1, old: 1, notOpen: 1 },
  },
});

test("each company is its own part: counters, Count, a note for the board it found", async () => {
  const { report, jobs } = await runFixture({ id: "greenhouse", meta });
  assert.deepEqual(Object.keys(report.parts), ["Grafana Labs", "Proton", "Mozilla"]);
  const { "Grafana Labs": grafana, Proton: proton, Mozilla: mozilla } = report.parts;
  assert.deepEqual([grafana.scanned, grafana.kept, grafana.key, grafana.note], [10, 4, "grafanalabs", "10 jobs listed"]);
  assert.deepEqual([proton.scanned, proton.kept, proton.note], [3, 2, "3 jobs listed"]);
  assert.deepEqual([mozilla.scanned, mozilla.error, mozilla.note], [0, "", "not found (HTTP 404)"]);
  assert.ok(jobs.every((j) => j.company === j._part && j.site === "greenhouse"));
  // Count per company: one each, the newest
  const one = await runFixture({ id: "greenhouse", meta, wanted: 1 });
  assert.deepEqual(one.jobs.map((j) => `${j.company}: ${j.title}`).sort(), ["Grafana Labs: Senior Backend Engineer", "Proton: Backend Software Engineer"]);
});

test("a board neither host knows is a note, not a failure; the EU host is asked after a 404", async () => {
  const { report, calls } = await runFixture({ id: "greenhouse", meta });
  assert.equal(report.status, "ok");
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.notes, ["Greenhouse: 1 company not found (HTTP 404): Mozilla (mozilla)"]);
  const lists = calls.filter((c) => !isPosting(c.url) && !isFull(c.url)).map((c) => `${c.host} ${c.status}`);
  assert.deepEqual(lists, [
    "boards-api.greenhouse.io 200",
    "boards-api.greenhouse.io 404",
    "boards-api.eu.greenhouse.io 200",
    "boards-api.greenhouse.io 404",
    "boards-api.eu.greenhouse.io 404",
  ]);
  // Proton's postings come from the host its board is on
  assert.ok(calls.filter((c) => /\/proton\//.test(c.url) && isPosting(c.url)).every((c) => c.host === "boards-api.eu.greenhouse.io"));
  const text = reportText({ mode: "check", reports: [report] });
  assert.match(text, /Greenhouse by company\n- Grafana Labs \(grafanalabs\): 10 jobs listed, 10 scanned → 4 kept\n- Proton \(proton\): 3 jobs listed, 3 scanned → 2 kept\n- Mozilla \(mozilla\): not found \(HTTP 404\)\n/);
  // Every company gone: the API itself has moved
  const gone = await runFixture({ id: "greenhouse", meta: { ...meta, companies: [company("mozilla")] } });
  assert.equal(gone.report.status, "failed");
  assert.match(gone.report.error, /no company board found \(HTTP 404 for all 1\)/);
});

test("postings are checked only for the rows that pass the screen, newest first: one or two alone, more in one answer", async () => {
  const read = (calls) => calls.filter((c) => isPosting(c.url) || isFull(c.url)).map((c) => (isFull(c.url) ? `${c.url.split("/")[5]}: all` : c.url.split("/").pop()));
  // Passed: Grafana's 1 (2h), 2 (3h), 4 (5h), 8 (6h), 10 (7h): its board once more with every posting;
  // Proton's 1 (8h), 3 (9h): read one by one. Not the office, US-only, old, hybrid or non-developer rows
  const { calls, jobs } = await runFixture({ id: "greenhouse", meta });
  assert.deepEqual(read(calls), ["grafanalabs: all", "4512345101", "4512345103"]);
  assert.equal(jobs.find((j) => j.title === "Backend Developer").open_to, "Europe");
  // Count 1: the newest posting alone
  const one = await runFixture({ id: "greenhouse", meta, wanted: 1 });
  assert.deepEqual(read(one.calls), ["5012345001", "4512345101"]);
  // Two read alone and one left out on its posting (you must live in Spain): the rest in one answer
  const fi = await runFixture({ id: "greenhouse", meta, wanted: 2, opts: { home: "FI" } });
  assert.deepEqual(read(fi.calls), ["5012345001", "5012345002", "grafanalabs: all", "4512345101", "4512345103"]);
  assert.deepEqual(fi.jobs.filter((j) => j.company === "Grafana Labs").map((j) => j.title), ["Senior Backend Engineer", "Backend Developer"]);
  // You live in Spain: "Spain (Remote)" is in your country, its posting isn't read
  const es = await runFixture({ id: "greenhouse", meta, wanted: 1, opts: { home: "ES" } });
  assert.ok(!es.calls.some((c) => /5012345002$/.test(c.url)));
  assert.ok(!es.jobs.some((j) => j.title === "Software Engineer, Frontend"));
  assert.equal(es.report.parts["Grafana Labs"].dropped.inHome, 1);
  // Check sources: every board is listed, a few postings read
  const check = await runFixture({ id: "greenhouse", meta, wanted: 1, opts: { check: true } });
  assert.equal(check.calls.filter((c) => isPosting(c.url) || isFull(c.url)).length, 1);
  assert.equal(check.calls.filter((c) => !isPosting(c.url) && !isFull(c.url)).length, 5);
});

test("You live in Finland or Sweden: listed elsewhere stays unless the posting says you must live there", async () => {
  const fi = await runFixture({ id: "greenhouse", meta, opts: { home: "FI" } });
  const titles = fi.jobs.map((j) => j.title);
  // "Spain (Remote)" says you must be based in Spain, the Netherlands job "fully remote within the
  // Netherlands"; "Remote, Germany" says nothing of the kind
  assert.ok(!titles.includes("Software Engineer, Frontend") && !titles.includes("Platform Engineer"));
  assert.equal(fi.report.dropped.residentsOnly, 2);
  assert.ok(titles.includes("Mobile Developer (Android)"));
  assert.equal(fi.jobs.find((j) => j.title === "Mobile Developer (Android)").open_to, "Germany");
  const se = await runFixture({ id: "greenhouse", meta, opts: { home: "SE", countries: ["DE", "SE"] } });
  // Spain and the Netherlands aren't ticked: placed in other countries
  assert.deepEqual(se.jobs.map((j) => j.title).sort(), ["Backend Developer", "Backend Software Engineer", "Mobile Developer (Android)", "Senior Backend Engineer"]);
  assert.equal(se.report.dropped.elsewhere, 2);
  assert.equal(se.jobs.find((j) => j.title === "Senior Backend Engineer").open_to, "EMEA");
});

test("a job: the posting's HTML unescaped once, the custom fields, the dates and links", () => {
  const row = {
    id: 77,
    title: " Platform Engineer ",
    location: { name: "Netherlands" },
    first_published: "2026-10-20T08:00:00-04:00",
    updated_at: "2026-10-25T08:00:00-04:00",
    absolute_url: "https://example.com/careers?gh_jid=77",
    metadata: [
      { name: "Remote Eligible", value: "Yes" },
      { name: "Employment Type", value: "Full-time" },
    ],
    content: "&lt;p&gt;Go &amp;amp; Rust.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;4+ years of experience&lt;/li&gt;&lt;/ul&gt;",
  };
  const job = toJob(row, company("grafanalabs"));
  assert.equal(job.title, "Platform Engineer");
  assert.equal(job.company, "Grafana Labs");
  assert.equal(job.description, "Go & Rust.\n4+ years of experience");
  assert.equal(job.years_required, 4);
  assert.equal(job.listing_type, "Full-time");
  assert.equal(job.date_posted, "2026-10-20T12:00:00.000Z");
  assert.equal(job.job_url, "https://example.com/careers?gh_jid=77");
  assert.equal(job.is_remote, "Yes");
  assert.deepEqual(job._where, { workplace: "remote", listedIn: "NL", open: null, emptyOpen: null, utc: null, remoteOnly: false });
  assert.equal(job._id, "grafanalabs:77");
  // No https link of its own: the board's page on the host it came from; no field: the location decides
  const eu = toJob({ id: 8, title: "Dev", location: { name: "Berlin, Germany" }, absolute_url: "http://x.test/8" }, company("proton"), "boards-api.eu.greenhouse.io");
  assert.equal(eu.job_url, "https://job-boards.eu.greenhouse.io/proton/jobs/8");
  assert.equal(eu._where.workplace, "onsite");
  assert.equal(eu.is_remote, "No");
  assert.equal(eu.date_posted, "");
});

test("failures stay with their company; a block or a host that stopped answering ends the source", async () => {
  // One board's error: that company failed, on its line and the source's; every company was asked,
  // so the source didn't stop early
  const one = await runFixture({ id: "greenhouse", meta, respond: (call) => (/\/proton\/jobs$/.test(call.url) ? { status: 500, body: "oops" } : null) });
  assert.equal(one.report.status, "ok");
  assert.deepEqual(one.report.failures, []);
  assert.equal(one.report.parts.Proton.error, "HTTP 500 at boards-api.greenhouse.io/v1/boards/proton/jobs");
  assert.equal(one.report.parts["Grafana Labs"].kept, 4);
  assert.match(reportText({ reports: [one.report] }), /- Proton \(proton\): failed: HTTP 500 at boards-api\.greenhouse\.io\/v1\/boards\/proton\/jobs\n/);
  assert.match(sourceLine(one.report), /^Greenhouse: 10 scanned → 4 kept \(3 companies, 1 failed\)\. Left out: [^.]+$/);
  assert.match(checkLine(one.report), /^Greenhouse: OK · 10 scanned → 4 kept \(3 companies, 1 failed\) \(/);
  // A 429 that doesn't clear after its wait: the companies after it aren't asked, and are named
  const limited = await runFixture({ id: "greenhouse", meta, respond: (call) => (/\/proton\/jobs$/.test(call.url) ? { status: 429, body: "Too Many Requests" } : null) });
  assert.equal(limited.report.status, "incomplete");
  assert.equal(limited.report.errorKind, "blocked");
  assert.equal(limited.report.parts["Grafana Labs"].kept, 4);
  assert.equal(limited.calls.filter((c) => c.status === 429).length, 2, "waited, asked once more");
  assert.equal(limited.calls.at(-1).status, 429, "nothing asked after the block");
  assert.ok(limited.report.notes.includes("Greenhouse: 1 of 3 companies not checked (stopped first): Mozilla (mozilla)"), limited.report.notes.join("\n"));
  // A 429 without Retry-After that clears after a short wait: nothing lost
  let first = true;
  const throttled = await runFixture({
    id: "greenhouse",
    meta,
    respond: (call) => {
      if (!first || !/\/grafanalabs\/jobs$/.test(call.url)) return null;
      first = false;
      return { status: 429, body: "Too Many Requests" };
    },
  });
  assert.equal(throttled.report.status, "ok");
  assert.deepEqual([throttled.report.parts["Grafana Labs"].kept, throttled.report.parts.Proton.kept], [4, 2]);
  // A 403 may be one company's board: the others go on; a second in a row is the host's
  const refused = await runFixture({ id: "greenhouse", meta, respond: (call) => (/\/grafanalabs\/jobs$/.test(call.url) ? { status: 403, body: "Forbidden" } : null) });
  assert.equal(refused.report.status, "ok");
  assert.match(refused.report.parts["Grafana Labs"].error, /HTTP 403 \(blocked\)/);
  assert.equal(refused.report.parts.Proton.kept, 2);
  const twice = await runFixture({ id: "greenhouse", meta, respond: (call) => (/\/(?:grafanalabs|proton)\/jobs$/.test(call.url) ? { status: 403, body: "Forbidden" } : null) });
  assert.equal(twice.report.errorKind, "blocked");
  assert.ok(!twice.calls.some((c) => /\/mozilla\//.test(c.url)));
  // The EU host failing is the company's "not found", not a failure; once it doesn't answer it
  // isn't asked again this run
  const euDown = await runFixture({
    id: "greenhouse",
    meta,
    respond: (call) => {
      if (call.host === "boards-api.eu.greenhouse.io") throw new TypeError("Failed to fetch");
      return null;
    },
  });
  assert.equal(euDown.report.status, "ok");
  assert.deepEqual([euDown.report.parts.Proton.note, euDown.report.parts.Mozilla.note], ["not found (HTTP 404)", "not found (HTTP 404)"]);
  assert.equal(euDown.report.parts["Grafana Labs"].kept, 4);
  assert.deepEqual(euDown.calls.filter((c) => c.host === "boards-api.eu.greenhouse.io").map((c) => c.url.split("/")[5]), ["proton", "proton"]);
  assert.ok(euDown.report.notes.some((n) => /^Greenhouse: the EU host isn't answering \(network error at boards-api\.eu\.greenhouse\.io\/v1\/boards\/proton\/jobs: .*\): boards kept only there count as not found this run$/.test(n)), euDown.report.notes.join("\n"));
  // One that hangs costs its timeout once, not for every board the main host doesn't know
  const stale = ["gitlab", "canonical", "elastic", "wikimedia", "grafanalabs"].map(company);
  const hang = await runFixture({
    id: "greenhouse",
    meta: { ...meta, companies: stale, timeoutMs: 100 },
    respond: (call) => (call.host === "boards-api.eu.greenhouse.io" ? { delay: 60e3 } : null),
  });
  assert.equal(hang.report.status, "ok");
  assert.equal(hang.calls.filter((c) => c.host === "boards-api.eu.greenhouse.io").length, 2);
  assert.ok(hang.ms < 2000, `${hang.ms} ms`);
  assert.equal(hang.report.parts["Grafana Labs"].kept, 4);
  // A posting gone since its board was listed (a 404 on its own, missing from the full board): skipped, nothing failed
  const closed = await runFixture({ id: "greenhouse", meta, wanted: 1, respond: (call) => (/\/5012345001$/.test(call.url) ? { status: 404, body: '{"status":404,"error":"Job not found"}' } : null) });
  assert.equal(closed.report.status, "ok");
  assert.deepEqual(closed.jobs.filter((j) => j.company === "Grafana Labs").map((j) => j.title), ["Software Engineer, Frontend"]);
  const without = (body, id) => JSON.stringify({ ...JSON.parse(body), jobs: JSON.parse(body).jobs.filter((j) => j.id !== id) });
  const gone = await runFixture({ id: "greenhouse", meta, respond: (call, route) => (isFull(call.url) ? { body: without(route.body, 5012345001), contentType: "application/json" } : null) });
  assert.equal(gone.report.status, "ok");
  assert.ok(!gone.jobs.some((j) => j.title === "Senior Backend Engineer"));
  assert.equal(gone.report.parts["Grafana Labs"].kept, 3);
  // No answer from three companies in a row: the host is down
  const many = { ...meta, companies: GREENHOUSE_BOARDS.slice(0, 6) };
  const down = await runFixture({
    id: "greenhouse",
    meta: many,
    respond: () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.equal(down.report.status, "failed");
  assert.equal(down.report.errorKind, "network");
  assert.equal(new Set(down.calls.map((c) => c.url)).size, 3);
});

test("stopped partway: the company being read says so, and the companies not reached are named", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new SourceError("aborted", "time budget (300 s) used up")), 150);
  const { report } = await runFixture({
    id: "greenhouse",
    meta,
    signal: controller.signal,
    respond: (call) => (/\/proton\/jobs$/.test(call.url) ? { delay: 5000 } : null),
  });
  assert.equal(report.error, "time budget (300 s) used up");
  assert.equal(report.parts.Proton.note, "stopped while being read");
  const text = reportText({ reports: [report] });
  assert.match(text, /\n- Proton \(proton\): stopped while being read\n/);
  assert.match(text, /\n- Grafana Labs \(grafanalabs\): 10 jobs listed, 10 scanned → 4 kept\n/);
  assert.ok(report.notes.includes("Greenhouse: 1 of 3 companies not checked (stopped first): Mozilla (mozilla)"), report.notes.join("\n"));
});

test("where a job is: the workplace field read like a location, the office a location names, the posting's own words", () => {
  const job = (location, extra = {}) => toJob({ id: 1, title: "Backend Engineer", location: { name: location }, ...extra }, company("grafanalabs"));
  const field = (value, name = "Workplace Type") => ({ metadata: [{ id: 1, name, value, value_type: Array.isArray(value) ? "multi_select" : "single_select" }] });
  // Either way, it can be done remotely; "Not Remote" can't; "Yes" under a Remote field, "Office" as before
  assert.equal(job("Berlin, Germany", field("Remote or Hybrid"))._where.workplace, "remote");
  assert.equal(job("Berlin, Germany", field(["Hybrid", "Remote"]))._where.workplace, "remote");
  assert.equal(job("Berlin, Germany", field("Remote or Hybrid"))._where.listedIn, "DE");
  assert.equal(job("Remote - EMEA", field("Hybrid or Remote", "Remote Status"))._where.workplace, "remote");
  assert.equal(job("Remote - EMEA", field("Not Remote"))._where.workplace, "onsite");
  assert.equal(job("Remote - EMEA", field("Hybrid"))._where.workplace, "hybrid");
  assert.equal(job("Berlin, Germany", field("Yes", "Remote Eligible"))._where.workplace, "remote");
  assert.equal(job("Remote - EMEA", field("Office"))._where.workplace, "onsite");
  // "Remote - Berlin": the Berlin office's country; a head office the location doesn't name places nothing
  const berlin = { name: "Berlin", location: "Berlin, Germany" };
  assert.equal(job("Remote - Berlin", { offices: [berlin] })._where.listedIn, "DE");
  assert.equal(job("Remote", { offices: [{ name: "Berlin HQ", location: "Berlin, Germany" }] })._where.listedIn, null);
  assert.equal(job("Remote - Berlin")._where.listedIn, null);
  // Only the location says remote: the posting may say the job is hybrid or on-site; a field is trusted
  const content = (text) => ({ content: `&lt;p&gt;${text}&lt;/p&gt;` });
  assert.equal(job("Remote - Germany", content("This role is hybrid, with two days a week in our Berlin office."))._where.workplace, "hybrid");
  assert.equal(job("Remote - EMEA", content("The position is fully on-site in Amsterdam."))._where.workplace, "onsite");
  assert.equal(job("Spain (Remote)", content("Please note this is not a remote position."))._where.workplace, "onsite");
  assert.equal(job("Remote - EMEA", content("Optional: two days a week in our Amsterdam office."))._where.workplace, "remote");
  assert.equal(job("Remote - EMEA", { ...content("This role is hybrid."), ...field("Remote") })._where.workplace, "remote");
});
