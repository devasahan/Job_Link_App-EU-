import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installChromeStorage } from "./helpers/env.js";
import { scrapeJobs } from "../extension/scrapers/index.js";
import { loadDownloaded, rememberDownloaded } from "../extension/scrapers/history.js";
import { SourceError } from "../extension/scrapers/http.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function job(key, country, title, company = "Acme") {
  return {
    key,
    title,
    dateOnIndeed: Date.now() - 3600e3,
    description: { html: "<p>Remote role.</p>" },
    location: { countryCode: country, formatted: { long: "Remote" } },
    employer: { name: company },
    attributes: [{ key: "DSQF7" }, { key: "CF3CP" }],
    recruit: {},
  };
}

function serve(byCountry) {
  const asked = [];
  globalThis.fetch = async (_url, init) => {
    const country = init.headers["indeed-co"];
    asked.push(country);
    const results = (byCountry[country] || []).map((j) => ({ job: j }));
    return new Response(JSON.stringify({ data: { jobSearch: { pageInfo: {}, results } } }), { status: 200 });
  };
  return asked;
}

test("a run: countries in popup order, one row per title + company, developers only", async () => {
  const asked = serve({
    DE: [job("1", "DE", "Backend-Entwickler (m/w/d)"), job("2", "DE", "Buchhalter (m/w/d)")],
    AT: [job("3", "AT", "Backend-Entwickler (m/w/d)"), job("4", "AT", "Python Developer", "Beta")],
  });
  const { jobs, errors } = await scrapeJobs({
    sites: ["indeed"],
    countries: ["de", "AT", "XX"],
    title: "",
    stack: "",
    count: 50,
    datePreset: "today",
    jobType: "fulltime",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(asked, ["AT", "AT", "DE", "DE"]);
  // The same job on the Austrian and German sites is one row
  assert.deepEqual(
    jobs.map((j) => `${j.country} ${j.title}`).sort(),
    ["AT Backend-Entwickler (m/w/d)", "AT Python Developer"]
  );
});

test("a run with titles and earlier downloads", async () => {
  installChromeStorage();
  serve({ FR: [job("5", "FR", "Développeur Java (H/F)"), job("6", "FR", "Data Analyst"), job("7", "FR", "Python Developer")] });
  await rememberDownloaded([{ title: "Python Developer", company: "Acme", job_url: "https://fr.indeed.com/viewjob?jk=7", site: "indeed" }]);
  const { jobs, skipped } = await scrapeJobs({
    sites: ["indeed"],
    countries: ["FR"],
    title: "java developer, python",
    stack: "",
    count: 10,
    datePreset: "3days",
    jobType: "both",
    downloaded: await loadDownloaded(),
  });
  assert.equal(skipped, 1);
  assert.deepEqual(jobs.map((j) => j.title), ["Développeur Java (H/F)"]);
});

test("a run needs a platform and a country", async () => {
  await assert.rejects(scrapeJobs({ sites: [], countries: ["DE"] }), /platform/);
  await assert.rejects(scrapeJobs({ sites: ["indeed"], countries: [] }), /country/);
  // Only the country the user lives in: nothing left to search
  await assert.rejects(scrapeJobs({ sites: ["indeed"], countries: ["SE"], home: "SE" }), /other than Sweden/);
});

// ---- Many sources (fake adapters through the `sources` option) ----

const HOUR = 3600e3;
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();

function row(site, id, title, company, extra = {}) {
  return {
    title,
    company,
    location: "Remote",
    country: "",
    open_to: "",
    site,
    listing_type: "",
    date_posted: ago(2),
    is_remote: "Yes",
    job_url: `https://${site}.test/jobs/${id}`,
    job_url_direct: "",
    description: "Build our APIs.",
    years_required: "",
    _id: id,
    _where: { open: [], emptyOpen: "world", remoteOnly: true },
    ...extra,
  };
}

function source(id, run, extra = {}) {
  return { id, label: id[0].toUpperCase() + id.slice(1), group: "boards", priority: 30, budgetMs: 5000, gaps: {}, robots: "api", run, ...extra };
}

const base = { countries: ["DE", "FR"], abroad: [], title: "", stack: "", count: 10, datePreset: "today", jobType: "both" };

test("sources run at once; the same job from several is one row, from the lowest priority, with Also on", async () => {
  const started = [];
  const delayed = (id, jobs, ms) => async (ctx) => {
    started.push([id, Date.now()]);
    await new Promise((r) => setTimeout(r, ms));
    ctx.accept(jobs);
  };
  const sources = [
    source("careers", delayed("careers", [row("careers", "c1", "Backend Developer", "Acme", { job_url_direct: "" })], 60), { priority: 10 }),
    source("board", delayed("board", [
      row("board", "b1", "Backend Developer (m/w/d)", "ACME GmbH", { job_url_direct: "https://acme.example/apply" }),
      row("board", "b2", "Frontend Developer", "Beta"),
    ], 60)),
    source("other", delayed("other", [row("other", "o1", "Backend Developer", "Acme Inc.")], 60), { priority: 40 }),
  ];
  const { jobs, merged, reports, errors } = await scrapeJobs({ ...base, sites: ["careers", "board", "other"], sources });
  assert.deepEqual(errors, []);
  assert.ok(Math.max(...started.map(([, t]) => t)) - Math.min(...started.map(([, t]) => t)) < 40, "in parallel");
  assert.equal(merged, 2);
  const acme = jobs.find((j) => j.company === "Acme");
  assert.equal(acme.site, "careers");
  assert.equal(acme.also_on, "Board, Other");
  assert.equal(acme.job_url_direct, "https://acme.example/apply");
  assert.equal(jobs.find((j) => j.company === "Beta").also_on, "");
  assert.ok(jobs.every((j) => !Object.keys(j).some((k) => k.startsWith("_"))));
  assert.ok(jobs.every((j) => /^\d{4}-\d{2}-\d{2}$/.test(j.date_posted)));
  assert.deepEqual(reports.map((r) => r.id), ["careers", "board", "other"]);
});

test("anonymous jobs merge by link only; Count applies per source (and per part)", async () => {
  const sources = [
    source("agency", async (ctx) =>
      ctx.accept([
        row("agency", "a1", "Java Developer", "Confidential", { anonymous: true }),
        row("agency", "a2", "Java Developer", "Confidential", { anonymous: true }),
      ])
    ),
    source("board", async (ctx) => ctx.accept([1, 2, 3, 4].map((n) => row("board", `b${n}`, `Developer ${n}`, `Co ${n}`)))),
    source("careers", async (ctx) => {
      ctx.part("Acme").accept([1, 2, 3].map((n) => row("careers", `a${n}`, `Software Engineer ${n}`, "Acme")));
      ctx.part("Beta").accept([1, 2, 3].map((n) => row("careers", `z${n}`, `Software Engineer ${n}`, "Beta")));
    }),
  ];
  const { jobs, merged } = await scrapeJobs({ ...base, count: 2, sites: ["agency", "board", "careers"], sources });
  assert.equal(merged, 0);
  const by = (site) => jobs.filter((j) => j.site === site).length;
  assert.equal(by("agency"), 2);
  assert.equal(by("board"), 2);
  assert.equal(by("careers"), 4);
});

test("one source failing, timing out or not loading leaves the others; a budget stop keeps what was found", async () => {
  const sources = [
    source("good", async (ctx) => ctx.accept([row("good", "g1", "Backend Developer", "Good")])),
    source("bad", async () => {
      throw new SourceError("blocked", "HTTP 403 (blocked) at bad.test/api");
    }),
    source("slow", async (ctx) => {
      ctx.accept([row("slow", "s1", "Go Developer", "Slow")]);
      await new Promise((r) => setTimeout(r, 5000));
    }, { budgetMs: 50 }),
    { ...source("gone", null), module: "./boards/does-not-exist.js" },
  ];
  const log = [];
  const t0 = Date.now();
  const { jobs, errors, incomplete, reports } = await scrapeJobs({
    ...base,
    sites: ["good", "bad", "slow", "gone"],
    sources,
    graceMs: 20,
    onProgress: (m) => log.push(m),
  });
  assert.ok(Date.now() - t0 < 1500);
  assert.deepEqual(jobs.map((j) => j.site).sort(), ["good", "slow"]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^Bad: HTTP 403/);
  assert.match(errors[1], /^Gone: adapter .* failed to load/);
  assert.deepEqual(incomplete, ["Slow"]);
  assert.equal(reports.find((r) => r.id === "slow").error, "time budget (0 s) used up");
  assert.ok(log.includes("Bad failed: HTTP 403 (blocked) at bad.test/api"), log.join("\n"));
  assert.ok(log.some((m) => /^Slow: 1 scanned → 1 kept\. Stopped early: time budget/.test(m)), log.join("\n"));
});

test("Stop ends every source and keeps what each found; the run cap does the same", async () => {
  const forever = (id) => async (ctx) => {
    ctx.accept([row(id, `${id}1`, "Backend Developer", id)]);
    await new Promise((r) => setTimeout(r, 10000));
  };
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  const stopped = await scrapeJobs({
    ...base,
    sites: ["one", "two"],
    sources: [source("one", forever("one")), source("two", forever("two"))],
    signal: controller.signal,
    graceMs: 20,
  });
  assert.equal(stopped.jobs.length, 2);
  assert.deepEqual(stopped.reports.map((r) => r.error), ["stopped by you", "stopped by you"]);
  const capped = await scrapeJobs({ ...base, sites: ["one"], sources: [source("one", forever("one"))], capMs: 30, graceMs: 20 });
  assert.equal(capped.reports[0].status, "incomplete");
  assert.match(capped.reports[0].error, /the run's 0-minute limit/);
});

test("freelance is skipped for Full time; check mode asks each source for 3 recent jobs", async () => {
  const seen = [];
  const run = (id) => async (ctx) => {
    seen.push({ id, wanted: ctx.wanted, preset: ctx.opts.preset.id, title: ctx.opts.title });
    ctx.accept([1, 2, 3, 4, 5].map((n) => row(id, `${id}${n}`, `Backend Developer ${n}`, `${id} ${n}`)));
  };
  const sources = [source("board", run("board")), source("gig", run("gig"), { group: "freelance" })];
  const full = await scrapeJobs({ ...base, sites: ["board", "gig"], sources, jobType: "fulltime" });
  assert.equal(full.reports[1].status, "skipped");
  assert.equal(full.reports[1].error, "Type is Full time");
  assert.deepEqual(seen.map((s) => s.id), ["board"]);
  seen.length = 0;
  const checked = await scrapeJobs({ ...base, sites: ["board", "gig"], sources, jobType: "fulltime", title: "Rust", mode: "check" });
  assert.deepEqual(seen, [
    { id: "board", wanted: 3, preset: "week", title: "" },
    { id: "gig", wanted: 3, preset: "week", title: "" },
  ]);
  assert.equal(checked.jobs.filter((j) => j.site === "board").length, 3);
});

test("live status: which sources run, how many are done and failed", async () => {
  const statuses = [];
  const finished = [];
  await scrapeJobs({
    ...base,
    sites: ["a", "b"],
    sources: [
      source("a", async () => {}),
      source("b", async () => {
        await new Promise((r) => setTimeout(r, 20));
        throw new Error("down");
      }),
    ],
    onStatus: (s) => statuses.push(`${s.running.join("+")}|${s.done}/${s.total}|${s.failed}`),
    onSource: (r) => finished.push(`${r.id}:${r.status}`),
  });
  assert.deepEqual(finished, ["a:ok", "b:failed"]);
  assert.equal(statuses[statuses.length - 1], "|2/2|1");
  assert.ok(statuses.includes("A+B|0/2|0"));
});

test("your own country alone is nothing to search only when every ticked source is bound to countries", async () => {
  const bound = source("bound", async () => {}, { countryBound: true });
  const remote = source("remote", async (ctx) => ctx.accept([row("remote", "r1", "Backend Developer", "Remote Co")]));
  await assert.rejects(scrapeJobs({ ...base, countries: ["SE"], home: "SE", sites: ["bound"], sources: [bound, remote] }), /other than Sweden/);
  const { jobs } = await scrapeJobs({ ...base, countries: ["SE"], home: "SE", sites: ["bound", "remote"], sources: [bound, remote] });
  assert.equal(jobs.length, 1);
});
