import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/env.js";
import {
  FILTER_STYLES,
  INDEED_SITES,
  buildFilters,
  buildQuery,
  requestHeaders,
  scrapeIndeed,
  searchTerms,
  toJob,
} from "../extension/scrapers/indeed.js";

const HOUR = 3600e3;
const realFetch = globalThis.fetch;
let calls;

function rawJob(key, overrides = {}) {
  return {
    key,
    title: "Backend-Entwickler (m/w/d)",
    datePublished: Date.now() - 2 * HOUR,
    dateOnIndeed: Date.now() - 2 * HOUR,
    description: { html: "<p>Du entwickelst unsere APIs in Go.</p><ul><li>3+ Jahre Berufserfahrung</li></ul>" },
    location: { city: "Berlin", admin1Code: "BE", countryCode: "DE", formatted: { long: "Homeoffice in Berlin" } },
    employer: { name: `Acme ${key}` },
    attributes: [
      { key: "DSQF7", label: "Homeoffice" },
      { key: "CF3CP", label: "Vollzeit" },
    ],
    recruit: { viewJobUrl: "https://acme.example/jobs/1" },
    ...overrides,
  };
}

const page = (jobs, nextCursor = null) => ({ data: { jobSearch: { pageInfo: { nextCursor }, results: jobs.map((job) => ({ job })) } } });

/** fetch stub: `respond(country, body, call)` returns the JSON body (or a Response). */
function mockFetch(respond) {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const call = { url, headers: init.headers, query: body.query, country: init.headers["indeed-co"] };
    calls.push(call);
    const out = await respond(call.country, call);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  };
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("Indeed sites: 18 EU countries, Norway, Switzerland, and the UK, Canada and US", () => {
  assert.equal(Object.keys(INDEED_SITES).length, 23);
  assert.equal(INDEED_SITES.GB, "uk");
  assert.equal(INDEED_SITES.US, "www");
  assert.equal(INDEED_SITES.CA, "ca");
  assert.equal(INDEED_SITES.DE, "de");
  for (const code of ["BG", "HR", "CY", "EE", "LV", "LT", "MT", "SK", "SI"]) {
    assert.equal(INDEED_SITES[code], undefined, code);
  }
});

test("each country gets its own indeed-co; labels stay English", () => {
  assert.equal(requestHeaders("DE")["indeed-co"], "DE");
  assert.equal(requestHeaders("GB")["indeed-co"], "GB");
  assert.equal(requestHeaders("DE")["indeed-locale"], "en-US");
});

test("filters: date window, remote but not hybrid; no job type", () => {
  assert.deepEqual(FILTER_STYLES, ["full", "date", "legacy"]);
  assert.equal(
    buildFilters("full", { hoursOld: 72 }),
    'filters: [{ date: { field: "dateOnIndeed", start: "72h" } }, { keyword: { field: "attributes", keys: ["DSQF7"] } }, { keyword: { field: "attributes", keys: ["PAXZC"], match: MUST_NOT } }]'
  );
  assert.equal(
    buildFilters("date", { hoursOld: 24 }),
    'filters: [{ date: { field: "dateOnIndeed", start: "24h" } }, { keyword: { field: "attributes", keys: ["DSQF7"] } }]'
  );
  assert.equal(
    buildFilters("legacy", { hoursOld: 24 }),
    'filters: { composite: { filters: [{ keyword: { field: "attributes", keys: ["DSQF7"] } }] } }'
  );
});

test("query escapes the search words", () => {
  const q = buildQuery('SEO "Lead" \\ Manager', "abc", "filters: []");
  assert.match(q, /what: "SEO \\"Lead\\" \\\\ Manager"/);
  assert.match(q, /cursor: "abc"/);
  assert.doesNotMatch(buildQuery("", null, ""), /what:|cursor:/);
});

test("search terms: each title, or developer in English and the local language", () => {
  assert.deepEqual(searchTerms("", "", "DE"), ["developer", "Entwickler"]);
  assert.deepEqual(searchTerms("", "React", "SE"), ["developer React", "utvecklare React"]);
  // Every country Indeed covers has its own words
  for (const code of Object.keys(INDEED_SITES)) assert.ok(searchTerms("", "", code).length >= 2, code);
  // A typed title is also searched with the country's own word for developer
  assert.deepEqual(searchTerms("Backend Developer, Platform Engineer", "", "FR"), [
    "Backend Developer",
    "Platform Engineer",
    "Backend développeur",
  ]);
  assert.deepEqual(searchTerms("Software Engineer", "", "DE"), ["Software Engineer", "Software Entwickler"]);
  assert.deepEqual(searchTerms("Java Dev", "", "BE"), ["Java Dev", "Java développeur", "Java ontwikkelaar"]);
  assert.deepEqual(searchTerms("Software Engineer", "", "IE"), ["Software Engineer"]);
  assert.deepEqual(searchTerms("DevOps", "", "DE"), ["DevOps"]);
  assert.deepEqual(searchTerms("Java Programmer", "", "PT"), ["Java Programmer", "Java programador"]);
  // Employers abroad: each search also names where the job may be held
  assert.deepEqual(searchTerms("Backend Developer", "Go", "US", { abroad: true }), [
    "Backend Developer Go Europe",
    "Backend Developer Go EMEA",
    "Backend Developer Go worldwide",
  ]);
});

test("toJob: country site link, type from attribute keys, years from the text", () => {
  const job = toJob(rawJob("k1"), "DE");
  assert.equal(job.job_url, "https://de.indeed.com/viewjob?jk=k1");
  assert.equal(job.country, "DE");
  assert.equal(job.listing_type, "Full-time");
  assert.equal(job.location, "Homeoffice in Berlin");
  assert.equal(job.is_remote, "Yes");
  assert.equal(job.description, "Du entwickelst unsere APIs in Go. 3+ Jahre Berufserfahrung");
  assert.equal(toJob(rawJob("k2", { location: { countryCode: "GB" } }), "GB").job_url, "https://uk.indeed.com/viewjob?jk=k2");
  // Indeed writes Slovenia as SL
  assert.equal(toJob(rawJob("k3", { location: { countryCode: "SL" } }), "DE").country, "SI");
});

test("toJob drops hybrid or non-remote results", () => {
  assert.equal(toJob(rawJob("h", { attributes: [{ key: "DSQF7" }, { key: "PAXZC" }] }), "DE"), null);
  assert.equal(toJob(rawJob("o", { attributes: [{ key: "CF3CP" }] }), "DE"), null);
  assert.ok(toJob(rawJob("n", { attributes: [] }), "DE"));
});

test("scrapeIndeed searches each ticked country with an Indeed site", async () => {
  mockFetch((country) => {
    if (country === "DE") {
      return page([
        rawJob("de1"),
        rawJob("de2", { title: "Sales Manager" }),
        rawJob("de3", { title: "Content Moderator" }),
      ]);
    }
    return page([
      rawJob("fr1", {
        title: "Développeur Full-Stack (H/F)",
        dateOnIndeed: Date.now() - HOUR,
        location: { countryCode: "FR", formatted: { long: "Télétravail à Paris" } },
      }),
      // Placed in a country that isn't ticked
      rawJob("fr2", { location: { countryCode: "BE" } }),
    ]);
  });
  const log = [];
  const jobs = await scrapeIndeed({
    countries: ["DE", "FR", "HR"],
    resultsWanted: 10,
    datePreset: "today",
    jobType: "fulltime",
    onProgress: (m) => log.push(m),
  });
  // "developer" in English and each country's own word; repeats are dropped
  assert.deepEqual(calls.map((c) => `${c.country} ${c.query.match(/what: "([^"]*)"/)[1]}`), [
    "DE developer",
    "DE Entwickler",
    "FR developer",
    "FR développeur",
  ]);
  assert.equal(jobs[0].open_to, "France");
  assert.deepEqual(jobs.map((j) => j.job_url), [
    "https://fr.indeed.com/viewjob?jk=fr1",
    "https://de.indeed.com/viewjob?jk=de1",
  ]);
  assert.match(jobs[0].date_posted, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(log.some((m) => /no site for Croatia/.test(m)));
  assert.ok(log.some((m) => /1 placed in other countries/.test(m)));
});

test("job type is read from attribute keys; jobs without a type stay", async () => {
  mockFetch(() =>
    page([
      rawJob("full", { attributes: [{ key: "DSQF7" }, { key: "CF3CP" }] }),
      rawJob("freelance", { attributes: [{ key: "DSQF7" }, { key: "T65DZ" }] }),
      rawJob("fixedterm", { attributes: [{ key: "DSQF7" }, { key: "T9BXE" }] }),
      rawJob("untyped", { attributes: [{ key: "DSQF7" }] }),
      rawJob("intern", { attributes: [{ key: "DSQF7" }, { key: "VDTG7" }] }),
    ])
  );
  const keys = (jobs) => jobs.map((j) => j.job_url.split("jk=")[1]).sort();
  const run = (jobType) => scrapeIndeed({ countries: ["DE"], resultsWanted: 10, datePreset: "today", jobType });
  // Fixed-term employees count as full time, not as freelancers
  assert.deepEqual(keys(await run("contract")), ["freelance", "untyped"]);
  assert.deepEqual(keys(await run("fulltime")), ["fixedterm", "full", "untyped"]);
  assert.deepEqual(keys(await run("both")), ["fixedterm", "freelance", "full", "untyped"]);
  assert.doesNotMatch(calls[0].query, /CF3CP|NJXCK/);
});

test("employers abroad count only when the posting is open to Europe or a ticked country", async () => {
  const us = (key, title, description) =>
    rawJob(key, { title, description: { html: description }, location: { countryCode: "US", formatted: { long: "Remote" } } });
  mockFetch((country) => {
    if (country === "US") {
      return page([
        us("us-eu", "Senior Backend Engineer", "<p>Remote (Europe). We hire across the EU.</p>"),
        us("us-de", "Platform Engineer", "<p>Open to candidates based in Germany.</p>"),
        us("us-only", "Backend Engineer", "<p>This role is US only.</p>"),
        us("us-quiet", "Frontend Engineer", "<p>Great benefits, remote.</p>"),
      ]);
    }
    return page([rawJob("de1")]);
  });
  const log = [];
  const jobs = await scrapeIndeed({
    countries: ["DE"],
    abroad: ["US"],
    resultsWanted: 10,
    datePreset: "today",
    onProgress: (m) => log.push(m),
  });
  assert.deepEqual(
    jobs.map((j) => `${j.country} ${j.open_to} ${j.job_url}`).sort(),
    [
      "DE Germany https://de.indeed.com/viewjob?jk=de1",
      "US Europe https://www.indeed.com/viewjob?jk=us-eu",
      "US Germany https://www.indeed.com/viewjob?jk=us-de",
    ]
  );
  const usTerms = calls.filter((c) => c.country === "US").map((c) => c.query.match(/what: "([^"]*)"/)[1]);
  assert.deepEqual(usTerms.slice(0, 3), ["developer Europe", "developer EMEA", "developer worldwide"]);
  assert.ok(log.some((m) => /2 abroad, not open to Europe/.test(m)));
});

test("scrapeIndeed pages with the cursor and stops at Count", async () => {
  mockFetch((country, call) => {
    if (!/cursor:/.test(call.query)) return page([rawJob("a"), rawJob("b")], "next1");
    return page([rawJob("c"), rawJob("d")], "next2");
  });
  // A title without a role word: one search, paged until Count matches
  const jobs = await scrapeIndeed({ countries: ["DE"], title: "Backend", resultsWanted: 3, datePreset: "today" });
  assert.equal(calls.length, 2);
  assert.equal(jobs.length, 3);
});

test("scrapeIndeed steps down the filters Indeed rejects, once per run", async () => {
  const invalid = (msg) => new Response(JSON.stringify({ errors: [{ message: msg, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] }), { status: 400 });
  mockFetch((country, call) => {
    if (/MUST_NOT/.test(call.query)) return invalid('Field "match" is not defined by type "KeywordFilterInput".');
    if (/filters: \[\{ date/.test(call.query)) return invalid('Field "date" is not defined by type "JobSearchFilterInput".');
    return page([
      rawJob(`${country}x`, { location: { countryCode: country } }),
      rawJob(`${country}old`, { dateOnIndeed: Date.now() - 80 * HOUR, location: { countryCode: country } }),
      rawJob(`${country}hybrid`, { attributes: [{ key: "DSQF7" }, { key: "PAXZC" }], location: { countryCode: country } }),
    ]);
  });
  const log = [];
  const jobs = await scrapeIndeed({ countries: ["DE", "AT"], resultsWanted: 10, datePreset: "today", onProgress: (m) => log.push(m) });
  // DE: full → date → legacy, then its second search and AT's two go straight to legacy
  assert.equal(calls.length, 6);
  for (const call of calls.slice(2)) assert.match(call.query, /filters: \{ composite: \{ filters: \[\{ keyword/);
  assert.deepEqual(jobs.map((j) => j.job_url.split("jk=")[1]).sort(), ["ATx", "DEx"]);
  assert.ok(log.some((m) => /hybrid exclusion/.test(m)));
  assert.ok(log.some((m) => /date filter/.test(m)));
});

test("scrapeIndeed skips a country Indeed has no site for, and stops on a refused key", async () => {
  mockFetch((country) => {
    if (country === "AT") {
      return new Response(JSON.stringify({ errors: [{ message: "Request country AT does not correspond to a valid Indeed site." }] }), { status: 400 });
    }
    if (country === "BE") return new Response(JSON.stringify({ errors: [{ message: "Unauthorized" }] }), { status: 401 });
    return page([rawJob(`${country}1`, { location: { countryCode: country } })]);
  });
  const log = [];
  const jobs = await scrapeIndeed({ countries: ["AT", "DE", "BE", "FR"], resultsWanted: 10, datePreset: "today", onProgress: (m) => log.push(m) });
  assert.deepEqual(calls.map((c) => c.country), ["AT", "DE", "DE", "BE"]);
  assert.deepEqual(jobs.map((j) => j.country), ["DE"]);
  assert.ok(log.some((m) => /Austria: Indeed has no site there/.test(m)));
  assert.ok(log.some((m) => /Belgium: Indeed refused the app key/.test(m)));
});

test("scrapeIndeed: a blocked request stops the board; other failures skip the country", async () => {
  mockFetch((country) => {
    if (country === "AT") return new Response("{}", { status: 500 });
    if (country === "BE") return new Response("Too many requests", { status: 429 });
    return page([rawJob(`${country}1`, { location: { countryCode: country } })]);
  });
  const log = [];
  const jobs = await scrapeIndeed({
    countries: ["AT", "DE", "BE", "FR"],
    resultsWanted: 10,
    datePreset: "today",
    onProgress: (m) => log.push(m),
  });
  // Austria's server error is retried once, then skips Austria; Belgium's 429 stops before France
  assert.deepEqual(calls.map((c) => c.country), ["AT", "AT", "DE", "DE", "BE"]);
  assert.deepEqual(jobs.map((j) => j.country), ["DE"]);
  assert.ok(log.some((m) => /stopped early/.test(m) && /Austria/.test(m) && /Belgium: .*429/.test(m)));
});

test("every search runs, and a job posted in several countries counts once (the newest)", async () => {
  mockFetch((country, call) => {
    const what = call.query.match(/what: "([^"]*)"/)[1];
    if (what === "Frontend Developer") {
      return page([rawJob(`${country}-fe`, { title: "Frontend Developer", dateOnIndeed: Date.now() - HOUR, location: { countryCode: country } })]);
    }
    // The same Acme backend job on the Austrian and German sites
    return page([
      rawJob(`${country}-be`, {
        title: "Backend Developer",
        employer: { name: "Acme" },
        dateOnIndeed: Date.now() - (country === "DE" ? 2 : 3) * HOUR,
        location: { countryCode: country },
      }),
    ]);
  });
  const jobs = await scrapeIndeed({ countries: ["AT", "DE"], title: "Backend Developer, Frontend Developer", resultsWanted: 3, datePreset: "today" });
  assert.deepEqual(calls.map((c) => `${c.country} ${c.query.match(/what: "([^"]*)"/)[1]}`), [
    "AT Backend Developer",
    "AT Frontend Developer",
    "AT Backend Entwickler",
    "AT Frontend Entwickler",
    "DE Backend Developer",
    "DE Frontend Developer",
    "DE Backend Entwickler",
    "DE Frontend Entwickler",
  ]);
  // The newer German copy of the Acme job is kept, the Austrian one dropped
  assert.deepEqual(jobs.map((j) => j.job_url.split("jk=")[1]).sort(), ["AT-fe", "DE-be", "DE-fe"]);
});

test("a server error is retried once; a broken query doesn't step the filters down", async () => {
  let first = true;
  mockFetch(() => {
    if (first) {
      first = false;
      return new Response(JSON.stringify({ errors: [{ message: "Internal error" }] }), { status: 502 });
    }
    return page([rawJob("x")]);
  });
  const log = [];
  const jobs = await scrapeIndeed({ countries: ["DE"], title: "Backend Developer", resultsWanted: 5, datePreset: "today", onProgress: (m) => log.push(m) });
  assert.equal(jobs.length, 1);
  assert.ok(calls.every((c) => /MUST_NOT/.test(c.query)));
  assert.ok(!log.some((m) => /rejected/.test(m)));

  calls = [];
  mockFetch(() => new Response(JSON.stringify({ errors: [{ message: "Syntax Error: Unterminated string." }] }), { status: 400 }));
  await assert.rejects(scrapeIndeed({ countries: ["DE"], title: "Backend Developer", resultsWanted: 5, datePreset: "today" }), /Syntax Error/);
  assert.equal(calls.length, 1);
});

test("a dollar sign in the title stays literal in the query", () => {
  const q = buildQuery("C$' Developer $& $$", null, "filters: []");
  assert.match(q, /what: "C\$' Developer \$& \$\$"/);
  assert.match(q, /filters: \[\]/);
});

test("a title with no usable words searches like no title", () => {
  assert.deepEqual(searchTerms("-, (m/w/d)", "", "DE"), ["developer", "Entwickler"]);
});

test("gender forms are left out of the search", () => {
  assert.deepEqual(searchTerms("Backend-Entwickler*in (m/w/d), Développeur·se", "", "DE"), [
    "Backend-Entwickler",
    "Développeur",
  ]);
});

test("a refused key after another country's error still fails the board", async () => {
  mockFetch((country) => {
    if (country === "AT") return new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 500 });
    return new Response("Too many requests", { status: 429 });
  });
  await assert.rejects(scrapeIndeed({ countries: ["AT", "BE", "DE"], title: "Backend Developer", resultsWanted: 5, datePreset: "today" }), /429/);
});

test("scrapeIndeed fails when every country fails", async () => {
  mockFetch(() => new Response("{}", { status: 500 }));
  await assert.rejects(scrapeIndeed({ countries: ["DE"], resultsWanted: 5, datePreset: "today" }), /Indeed HTTP 500/);
  await assert.rejects(scrapeIndeed({ countries: ["HR"], resultsWanted: 5, datePreset: "today" }), /no site/);
});

test("the run log says what each check left out", async () => {
  mockFetch(() =>
    page([
      rawJob("ok"),
      rawJob("old", { dateOnIndeed: Date.now() - 40 * HOUR }),
      rawJob("pm", { title: "Product Manager" }),
      rawJob("intern", { title: "Werkstudent Softwareentwicklung" }),
      rawJob("hybrid", { attributes: [{ key: "DSQF7" }, { key: "PAXZC" }] }),
      rawJob("at", { location: { countryCode: "AT" } }),
    ])
  );
  const log = [];
  const jobs = await scrapeIndeed({
    countries: ["DE"],
    resultsWanted: 10,
    datePreset: "today",
    jobType: "fulltime",
    onProgress: (m) => log.push(m),
  });
  assert.deepEqual(jobs.map((j) => j.job_url.split("jk=")[1]), ["ok"]);
  assert.ok(log.includes("Indeed Germany: 6 scanned → 1 kept"), log.join("\n"));
  assert.ok(
    log.includes(
      "Indeed: 1 country, 6 scanned → 1 matching. Left out: 1 not developer roles, 1 older than 24 hours, " +
        "1 other job types, 1 hybrid or not remote, 1 placed in other countries"
    ),
    log.join("\n")
  );
});

test("a run that stopped early says so, so the runner doesn't advise wider settings", async () => {
  mockFetch((country) => (country === "AT" ? page([rawJob("at1", { location: { countryCode: "AT" } })]) : new Response("slow down", { status: 429 })));
  const stopped = await scrapeIndeed({ countries: ["AT", "DE"], resultsWanted: 10, datePreset: "today" });
  assert.equal(stopped.length, 1);
  assert.equal(stopped.incomplete, true);
  mockFetch(() => page([rawJob("de1")]));
  const done = await scrapeIndeed({ countries: ["DE", "HR"], resultsWanted: 10, datePreset: "today" });
  assert.equal(done.incomplete, false);
});

test("a typed title's local-language search runs only while the country is short of Count", async () => {
  mockFetch(() => page([rawJob("de1", { title: "Backend Developer" })]));
  await scrapeIndeed({ countries: ["DE"], title: "Backend Developer", resultsWanted: 1, datePreset: "today" });
  assert.deepEqual(calls.map((c) => c.query.match(/what: "([^"]*)"/)[1]), ["Backend Developer"]);
  calls = [];
  await scrapeIndeed({ countries: ["DE"], title: "Backend Developer", resultsWanted: 5, datePreset: "today" });
  assert.deepEqual(calls.map((c) => c.query.match(/what: "([^"]*)"/)[1]), ["Backend Developer", "Backend Entwickler"]);
});

test("a country that fails partway still gets its scanned → kept line", async () => {
  mockFetch((country, call) =>
    /Entwickler/.test(call.query) ? new Response("down", { status: 500 }) : page([rawJob("de1")])
  );
  const log = [];
  await scrapeIndeed({ countries: ["DE"], title: "Backend Developer", resultsWanted: 5, datePreset: "today", onProgress: (m) => log.push(m) });
  assert.ok(log.includes("Indeed Germany: 1 scanned → 1 kept (stopped)"), log.join("\n"));
});

test("a page whose jobs were all seen under another search still ends the paging when it is too old", async () => {
  // Indeed ignores the date filter (legacy shape): both searches return the same old jobs with a next cursor
  const old = Array.from({ length: 3 }, (_, i) => rawJob(`old${i}`, { dateOnIndeed: Date.now() - 40 * HOUR }));
  mockFetch(() => page(old, "more"));
  await scrapeIndeed({ countries: ["DE"], title: "Backend Developer", resultsWanted: 5, datePreset: "today" });
  assert.deepEqual(calls.map((c) => c.query.match(/what: "([^"]*)"/)[1]), ["Backend Developer", "Backend Entwickler"]);
});
