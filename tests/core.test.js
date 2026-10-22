import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/env.js";
import { normalizeJob, DATE_PRESETS } from "../extension/scrapers/util.js";
import { createContext, runSource } from "../extension/scrapers/core/context.js";
import { checkLine, invariantHolds, leftOut, newReport, sourceLine } from "../extension/scrapers/core/diagnostics.js";
import { createCache, memoryStorage } from "../extension/scrapers/core/cache.js";
import { isAllowed, parseRobots, pathMatches } from "../extension/scrapers/core/robots.js";
import { createHttp, SourceError } from "../extension/scrapers/http.js";

const HOUR = 3600e3;
const META = { id: "board", label: "Board", group: "boards", priority: 30, budgetMs: 1000, gaps: {}, robots: "api" };
const OPTS = {
  title: "",
  stack: "",
  countries: ["DE", "FR", "SE"],
  abroad: ["US"],
  home: "",
  preset: DATE_PRESETS.today,
  years: "",
  jobType: "both",
};

function job(id, extra = {}, where = { open: [], emptyOpen: "world", remoteOnly: true }) {
  return {
    ...normalizeJob({
      title: "Backend Developer",
      company: `Co ${id}`,
      date_posted: new Date(Date.now() - 2 * HOUR).toISOString(),
      job_url: `https://board.test/jobs/${id}`,
      description: "Build our APIs in Go.",
      ...extra,
    }),
    _id: id,
    _where: where,
  };
}

const ctxFor = (opts = {}, wanted = 10) => createContext(META, { opts: { ...OPTS, ...opts }, wanted });

test("accept runs the checks in order and counts each drop; the counters balance", () => {
  const { ctx, finish } = ctxFor({ stack: "Go", years: 3, jobType: "fulltime" });
  const kept = ctx.accept([
    job("ok"),
    job("ok"),
    job("expired", { title: "Backend Developer" }),
    job("old", { date_posted: new Date(Date.now() - 40 * HOUR).toISOString() }),
    job("pm", { title: "Product Manager" }),
    job("hybrid", { title: "Backend Developer (Hybrid)" }),
    job("us", {}, { open: ["United States"] }),
    job("nostack", { description: "Build our APIs in Rust." }),
    job("contract", { listing_type: "Contract" }),
    job("senior", { description: "Build our APIs in Go. 8+ years of experience." }),
  ].map((j) => (j._id === "expired" ? { ...j, _expires: new Date(Date.now() - HOUR).toISOString() } : j)));
  assert.deepEqual(kept.map((j) => j._id), ["ok"]);
  const { report, jobs } = finish();
  assert.equal(report.status, "ok");
  assert.equal(report.duplicates, 1);
  assert.equal(report.scanned, 9);
  assert.equal(report.kept, 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(report.dropped).filter(([, n]) => n)),
    { expired: 1, old: 1, title: 1, notRemote: 1, restricted: 1, stack: 1, type: 1, years: 1 }
  );
  assert.ok(invariantHolds(report));
  // The kept job is the sheet's: where it is open, remote, and its source
  assert.equal(jobs[0].open_to, "Worldwide");
  assert.equal(jobs[0].is_remote, "Yes");
  assert.equal(jobs[0].site, "board");
  assert.equal(jobs[0]._priority, 30);
});

test("screen drops list rows on cheap checks; survivors are counted once when accepted", () => {
  const { ctx, finish } = ctxFor({ home: "SE" });
  const rows = [
    job("a", { description: "" }, { listedIn: "DE" }),
    job("b", { description: "" }, { listedIn: "ES" }),
    job("c", { title: "Accountant", description: "" }),
    job("a", { description: "" }, { listedIn: "DE" }),
  ];
  const survivors = ctx.screen(rows);
  assert.deepEqual(survivors.map((j) => j._id), ["a"]);
  // With the details, the residence check runs
  ctx.accept([job("a", { description: "100% Homeoffice innerhalb Deutschlands." }, { listedIn: "DE" })]);
  ctx.accept([job("a", {}, { listedIn: "DE" })]);
  const { report } = finish();
  assert.equal(report.scanned, 3);
  assert.equal(report.dropped.elsewhere, 1);
  assert.equal(report.dropped.title, 1);
  assert.equal(report.dropped.residentsOnly, 1);
  assert.equal(report.duplicates, 2);
  assert.ok(invariantHolds(report));
});

test("enough(), parts and what an error leaves", () => {
  const { ctx, finish } = ctxFor({}, 2);
  ctx.accept([job("1")]);
  assert.equal(ctx.enough(), false);
  ctx.accept([job("2")]);
  assert.equal(ctx.enough(), true);
  const { report } = finish(new SourceError("blocked", "HTTP 429 (rate-limited) at board.test/api"));
  assert.equal(report.status, "incomplete");
  assert.equal(report.errorKind, "blocked");
  // Sealed: nothing more is kept
  assert.deepEqual(ctx.accept([job("3")]), []);

  const empty = ctxFor();
  assert.equal(empty.finish(new Error("HTTP 500")).report.status, "failed");
  const skipped = ctxFor();
  assert.equal(skipped.finish(new SourceError("skipped", "no site")).report.status, "skipped");

  // Each part counts as its own source for Count; a failing part leaves the others
  const careers = ctxFor({}, 1);
  const a = careers.ctx.part("Acme");
  const b = careers.ctx.part("Beta");
  a.accept([job("a1"), job("a2")]);
  b.fail(new Error("HTTP 404 at boards.test/beta"));
  assert.equal(a.enough(), true);
  assert.equal(b.enough(), false);
  assert.equal(careers.ctx.enough(), false);
  const { report: r, jobs } = careers.finish();
  assert.equal(r.status, "incomplete");
  assert.deepEqual(Object.keys(r.parts), ["Acme", "Beta"]);
  assert.equal(r.parts.Acme.kept, 2);
  assert.equal(r.parts.Beta.error, "HTTP 404 at boards.test/beta");
  assert.deepEqual(jobs.map((j) => j._part), ["Acme", "Acme"]);
  assert.ok(invariantHolds(r));
});

test("adopt takes a source's own counters (Indeed)", () => {
  const { ctx, finish } = ctxFor();
  ctx.adopt([job("x")], { scanned: 6, kept: 2, merged: 1, dropped: { title: 3, notRemote: 1 } });
  const { report, jobs } = finish();
  assert.equal(sourceLine(report), "Board: 6 scanned → 2 kept. Left out: 3 not developer roles, 1 hybrid or not remote");
  assert.equal(report.merged, 1);
  assert.equal(jobs[0].site, "board");
  assert.ok(invariantHolds(report));
});

test("runSource keeps what a stopped adapter accepted, even one that ignores the stop", async () => {
  const http = createHttp({ cache: createCache({ storage: memoryStorage() }) });
  const controller = new AbortController();
  const run = async (ctx) => {
    ctx.accept([job("early")]);
    await new Promise((r) => setTimeout(r, 2000));
    ctx.accept([job("late")]);
  };
  setTimeout(() => controller.abort(new SourceError("aborted", "stopped by you")), 20);
  const t0 = Date.now();
  const { report, jobs } = await runSource(META, { run, opts: OPTS, wanted: 5, http, signal: controller.signal, graceMs: 50 });
  assert.ok(Date.now() - t0 < 500);
  assert.deepEqual(jobs.map((j) => j._id), ["early"]);
  assert.equal(report.status, "incomplete");
  assert.equal(report.error, "stopped by you");
  // An adapter that throws after keeping something is incomplete; one that keeps nothing failed
  const thrown = await runSource(META, {
    run: async (ctx) => {
      ctx.accept([job("p1")]);
      throw new SourceError("blocked", "HTTP 429 (rate-limited) at board.test/api?page=2");
    },
    opts: OPTS,
    wanted: 5,
    http,
  });
  assert.equal(thrown.report.status, "incomplete");
  assert.equal(thrown.jobs.length, 1);
});

test("the run log's line for a source, and Left out in Indeed's order", () => {
  const report = { ...newReport(META, { title: "", span: "24 hours" }), status: "ok", scanned: 120, kept: 14 };
  Object.assign(report.dropped, { notOpen: 6, title: 80, old: 20 });
  assert.equal(sourceLine(report), "Board: 120 scanned → 14 kept. Left out: 80 not developer roles, 20 older than 24 hours, 6 not open to Europe");
  assert.equal(leftOut({ title: 2 }, { title: "Backend Developer" }), "2 not matching the title");
  assert.equal(leftOut({ restricted: 1, abroadOff: 2, expired: 3 }), "3 expired, 2 in countries not ticked under Employers abroad, 1 limited to other countries");
  assert.equal(
    sourceLine({ ...report, status: "incomplete", error: "HTTP 429 (rate-limited) at board.test/api" }),
    "Board: 120 scanned → 14 kept. Left out: 80 not developer roles, 20 older than 24 hours, 6 not open to Europe. Stopped early: HTTP 429 (rate-limited) at board.test/api"
  );
  const failed = { ...newReport(META), status: "failed", error: "HTTP 403 (blocked) at board.test/api" };
  assert.equal(sourceLine(failed), "Board failed: HTTP 403 (blocked) at board.test/api");
  assert.equal(sourceLine({ ...failed, status: "skipped", error: "Type is Full time" }), "Board skipped: Type is Full time");
  assert.equal(checkLine({ ...report, ms: 1234 }), "Board: OK · 120 scanned → 14 kept (1.2 s)");
  assert.equal(checkLine({ ...failed, ms: 300 }), "Board: FAILED · HTTP 403 (blocked) at board.test/api (0.3 s)");
  assert.equal(checkLine({ ...newReport(META), status: "ok" }), "Board: answered, but no jobs in the last 7 days");
  assert.equal(invariantHolds({ scanned: 3, kept: 1, dropped: { title: 1 } }), false);
});

test("the cache keeps a value until its TTL and clears by scope", async () => {
  let now = 1000;
  const storage = memoryStorage();
  const cache = createCache({ storage, now: () => now });
  const jobicy = cache.scope("jobicy");
  let calls = 0;
  const load = async () => ({ n: ++calls });
  assert.deepEqual(await jobicy.wrap("geo=europe", 3600e3, load), { n: 1 });
  now += 3599e3;
  assert.deepEqual(await jobicy.wrap("geo=europe", 3600e3, load), { n: 1 });
  now += 2e3;
  assert.deepEqual(await jobicy.wrap("geo=europe", 3600e3, load), { n: 2 });
  await cache.scope("robots").set("https://a.test", { rules: [] }, 60e3);
  assert.equal(await jobicy.clear(), 1);
  assert.deepEqual(await cache.scope("robots").get("https://a.test"), { rules: [] });
  assert.equal(await cache.scope("jobicy").get("geo=europe"), undefined);
});

test("robots.txt: our group or *, the longest rule wins, * and $ wildcards", () => {
  const robots = parseRobots(
    [
      "# comment",
      "User-agent: Googlebot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Disallow: /jobs/",
      "Allow: /jobs/feed",
      "Disallow: /*.json$",
      "Disallow: /search?*sort=",
      "Crawl-delay: 2",
    ].join("\n")
  );
  assert.equal(robots.delayMs, 2000);
  assert.equal(isAllowed(robots, "/"), true);
  assert.equal(isAllowed(robots, "/jobs/123"), false);
  assert.equal(isAllowed(robots, "/jobs/feed?x=1"), true);
  assert.equal(isAllowed(robots, "/api/data.json"), false);
  assert.equal(isAllowed(robots, "/api/data.json?x"), true);
  assert.equal(isAllowed(robots, "/search?q=go&sort=new"), false);
  const ours = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: JobBridge\nUser-agent: other\nAllow: /\nDisallow: /admin");
  assert.equal(isAllowed(ours, "/jobs"), true);
  assert.equal(isAllowed(ours, "/admin"), false);
  assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow:"), "/anything"), true);
  assert.equal(pathMatches("/a*b*c$", "/axxbyyc"), true);
  assert.equal(pathMatches("/a*b*c$", "/axxbyycd"), false);
});

test("Copy report: lines, log, and samples only for sources that failed or kept nothing", async () => {
  const { reportText } = await import("../extension/scrapers/core/diagnostics.js");
  const sample = (body) => ({ method: "GET", url: "https://a.test/api?page=1", status: 403, headers: { "content-type": "text/html" }, body });
  const ok = { ...newReport({ id: "ok", label: "Fine" }), status: "ok", scanned: 3, kept: 2, samples: [sample("FINE BODY")] };
  const bad = { ...newReport({ id: "bad", label: "Broken" }), status: "failed", error: "HTTP 403 (blocked) at a.test/api", samples: [sample("<html>blocked</html>")] };
  const zero = { ...newReport({ id: "zero", label: "Empty" }), status: "ok", scanned: 4, kept: 0, samples: [sample("{\"jobs\":[]}")] };
  const text = reportText({ version: "2.4.0", at: new Date("2026-10-22T10:00:00Z"), log: "Fetching Fine…", reports: [ok, bad, zero], merged: 1, skipped: 2 });
  assert.match(text, /^JobBridge EU 2\.4\.0 · run · 2026-10-22 10:00 UTC/);
  assert.match(text, /- Broken failed: HTTP 403/);
  assert.match(text, /1 duplicates merged, 2 already downloaded/);
  assert.match(text, /== Broken ==\nGET https:\/\/a\.test\/api\?page=1 → HTTP 403\ncontent-type: text\/html\n<html>blocked<\/html>/);
  assert.match(text, /== Empty ==/);
  assert.ok(!text.includes("FINE BODY"));
  const check = reportText({ mode: "check", reports: [ok] });
  assert.match(check, /source check/);
  assert.match(check, /- Fine: OK · 3 scanned → 2 kept/);
});
