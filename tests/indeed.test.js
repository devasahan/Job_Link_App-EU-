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
    title: "Online Marketing Manager (m/w/d)",
    datePublished: Date.now() - 2 * HOUR,
    dateOnIndeed: Date.now() - 2 * HOUR,
    description: { html: "<p>Du verantwortest SEO und SEA.</p><ul><li>3+ Jahre Berufserfahrung</li></ul>" },
    location: { city: "Berlin", admin1Code: "BE", countryCode: "DE", formatted: { long: "Homeoffice in Berlin" } },
    employer: { name: "Acme GmbH" },
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

test("Indeed sites: 18 EU countries plus Norway, Switzerland and the UK", () => {
  assert.equal(Object.keys(INDEED_SITES).length, 21);
  assert.equal(INDEED_SITES.GB, "uk");
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

test("search terms: each title, or marketing and communications in the local language", () => {
  assert.deepEqual(searchTerms("", "", "DE"), ["marketing", "Kommunikation"]);
  assert.deepEqual(searchTerms("", "HubSpot", "SE"), ["marketing HubSpot", "marknadsföring HubSpot", "kommunikation HubSpot"]);
  // Every country Indeed covers has its own words
  for (const code of Object.keys(INDEED_SITES)) assert.ok(searchTerms("", "", code).length >= 2, code);
  assert.deepEqual(searchTerms("SEO Manager, Content Marketing", "", "FR"), ["SEO Manager", "Content Marketing"]);
});

test("toJob: country site link, type from attribute keys, years from the text", () => {
  const job = toJob(rawJob("k1"), "DE");
  assert.equal(job.job_url, "https://de.indeed.com/viewjob?jk=k1");
  assert.equal(job.country, "DE");
  assert.equal(job.listing_type, "Full-time");
  assert.equal(job.location, "Homeoffice in Berlin");
  assert.equal(job.is_remote, "Yes");
  assert.equal(job.description, "Du verantwortest SEO und SEA. 3+ Jahre Berufserfahrung");
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
        title: "Chargé de communication (H/F)",
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
  // Marketing, then communications, in each country's words; repeats are dropped
  assert.deepEqual(calls.map((c) => `${c.country} ${c.query.match(/what: "([^"]*)"/)[1]}`), [
    "DE marketing",
    "DE Kommunikation",
    "FR marketing",
    "FR communication",
  ]);
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

test("scrapeIndeed pages with the cursor and stops at Count", async () => {
  mockFetch((country, call) => {
    if (!/cursor:/.test(call.query)) return page([rawJob("a"), rawJob("b")], "next1");
    return page([rawJob("c"), rawJob("d")], "next2");
  });
  const jobs = await scrapeIndeed({ countries: ["DE"], resultsWanted: 3, datePreset: "today" });
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
  // Austria's error skips Austria; Belgium's 429 stops before France
  assert.deepEqual(calls.map((c) => c.country), ["AT", "DE", "DE", "BE"]);
  assert.deepEqual(jobs.map((j) => j.country), ["DE"]);
  assert.ok(log.some((m) => /stopped early/.test(m) && /Austria/.test(m) && /Belgium: .*429/.test(m)));
});

test("scrapeIndeed fails when every country fails", async () => {
  mockFetch(() => new Response("{}", { status: 500 }));
  await assert.rejects(scrapeIndeed({ countries: ["DE"], resultsWanted: 5, datePreset: "today" }), /Indeed HTTP 500/);
  await assert.rejects(scrapeIndeed({ countries: ["HR"], resultsWanted: 5, datePreset: "today" }), /no site/);
});
