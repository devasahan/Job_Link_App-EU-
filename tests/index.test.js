import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installChromeStorage } from "./helpers/env.js";
import { scrapeJobs } from "../extension/scrapers/index.js";
import { loadDownloaded, rememberDownloaded } from "../extension/scrapers/history.js";

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

test("a run: countries in popup order, one row per title + company, marketing only", async () => {
  const asked = serve({
    DE: [job("1", "DE", "Marketing Manager (m/w/d)"), job("2", "DE", "Buchhalter (m/w/d)")],
    AT: [job("3", "AT", "Marketing Manager (m/w/d)"), job("4", "AT", "SEO Specialist", "Beta")],
  });
  const { jobs, errors } = await scrapeJobs({
    sites: ["indeed"],
    countries: ["de", "AT", "XX"],
    title: "",
    skills: "",
    count: 50,
    datePreset: "today",
    jobType: "fulltime",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(asked, ["AT", "AT", "DE", "DE"]);
  // The same job on the Austrian and German sites is one row
  assert.deepEqual(
    jobs.map((j) => `${j.country} ${j.title}`).sort(),
    ["AT Marketing Manager (m/w/d)", "AT SEO Specialist"]
  );
});

test("a run with titles and earlier downloads", async () => {
  installChromeStorage();
  serve({ FR: [job("5", "FR", "Chargé de communication"), job("6", "FR", "Content Manager"), job("7", "FR", "SEO Manager")] });
  await rememberDownloaded([{ title: "SEO Manager", company: "Acme", job_url: "https://fr.indeed.com/viewjob?jk=7", site: "indeed" }]);
  const { jobs, skipped } = await scrapeJobs({
    sites: ["indeed"],
    countries: ["FR"],
    title: "communication, seo",
    skills: "",
    count: 10,
    datePreset: "3days",
    jobType: "both",
    downloaded: await loadDownloaded(),
  });
  assert.equal(skipped, 1);
  assert.deepEqual(jobs.map((j) => j.title), ["Chargé de communication"]);
});

test("a run needs a platform and a country", async () => {
  await assert.rejects(scrapeJobs({ sites: [], countries: ["DE"] }), /platform/);
  await assert.rejects(scrapeJobs({ sites: ["indeed"], countries: [] }), /country/);
});
