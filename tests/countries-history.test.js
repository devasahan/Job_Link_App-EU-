import { test } from "node:test";
import assert from "node:assert/strict";
import { installChromeStorage } from "./helpers/env.js";
import {
  ABROAD_CODES,
  ALL_COUNTRIES,
  EU_CODES,
  cleanAbroadCodes,
  cleanCountryCodes,
  countryNames,
  countryName,
  describeCountries,
} from "../extension/scrapers/countries.js";
import {
  companyKey,
  jobKeys,
  loadDownloaded,
  mergeKey,
  normalizeWords,
  rememberDownloaded,
} from "../extension/scrapers/history.js";
import { dedupeKey } from "../extension/scrapers/index.js";

test("EU-27 plus Norway and Switzerland; the UK, Canada and US as employers abroad", () => {
  assert.equal(EU_CODES.length, 27);
  assert.equal(ALL_COUNTRIES.length, 29);
  assert.deepEqual(ABROAD_CODES, ["GB", "CA", "US"]);
  assert.ok(EU_CODES.includes("GR"));
  assert.ok(!ALL_COUNTRIES.some((c) => c.code === "GB"));
  assert.equal(countryName("si"), "Slovenia");
  assert.equal(countryName("us"), "United States");
  assert.deepEqual(countryNames("DE"), ["Germany", "Deutschland"]);
  assert.deepEqual(cleanAbroadCodes(["us", "GB", "DE"]), ["GB", "US"]);
});

test("country codes are cleaned and described", () => {
  // The popup's order (alphabetical by English name), unknown codes dropped
  assert.deepEqual(cleanCountryCodes(["de", "FR", "XX", "DE"]), ["FR", "DE"]);
  assert.equal(describeCountries(["DE", "FR"]), "France, Germany");
  assert.equal(describeCountries(EU_CODES), "All EU (27)");
  assert.equal(describeCountries([...EU_CODES, "NO"]), "All EU (27) + Norway");
});

test("history keys keep accented and Greek titles apart", () => {
  assert.equal(normalizeWords("Développeur Backend (m/w/d)"), "developpeur backend m w d");
  assert.notEqual(normalizeWords("Υπεύθυνος Μάρκετινγκ"), "");
  const keys = jobKeys({ title: "Chargé de communication", company: "Société Générale", job_url: "https://fr.indeed.com/viewjob?jk=1&utm_source=x" });
  assert.deepEqual(keys, ["url:fr.indeed.com/viewjob?jk=1", "job:charge de communication|societe generale"]);
});

test("downloaded jobs are remembered and recognised", async () => {
  installChromeStorage();
  const job = { title: "SEO Manager", company: "Acme", job_url: "https://de.indeed.com/viewjob?jk=9", site: "indeed" };
  await rememberDownloaded([job]);
  const downloaded = await loadDownloaded();
  assert.equal(downloaded.size, 1);
  assert.ok(downloaded.has({ ...job, job_url: "https://at.indeed.com/viewjob?jk=other" }));
  assert.equal(downloaded.recentCount("indeed", 24), 1);
});

test("history keys: the company with and without its legal form; anonymous jobs by link only", async () => {
  assert.equal(companyKey("ACME GmbH & Co. KG"), "acme");
  assert.equal(companyKey("Nordlys Sp. z o.o."), "nordlys");
  assert.equal(companyKey("Société Générale S.A."), "societe generale");
  assert.equal(companyKey("AB"), "ab");
  assert.deepEqual(jobKeys({ title: "Go Developer", company: "Acme GmbH", job_url: "https://x.test/1" }), [
    "url:x.test/1",
    "job:go developer|acme gmbh",
    "job:go developer|acme",
  ]);
  assert.deepEqual(jobKeys({ title: "Go Developer", company: "Confidential", anonymous: true, job_url: "https://x.test/2" }), [
    "url:x.test/2",
  ]);
  // An entry saved before 2.4.0 (title | company as written) still matches
  installChromeStorage({
    downloadedJobs: [{ keys: ["url:old.test/9", "job:go developer|acme gmbh"], site: "indeed", at: Date.now() }],
  });
  const downloaded = await loadDownloaded();
  assert.ok(downloaded.has({ title: "Go Developer", company: "Acme GmbH", job_url: "https://himalayas.test/1" }));
  // The same title at a hidden employer is not that job
  assert.ok(!downloaded.has({ title: "Go Developer", company: "Acme GmbH", anonymous: true, job_url: "https://agency.test/1" }));
});

test("history keys hold the merge key: copies a run merges know each other, gender tag or not", async () => {
  const indeed = { title: "Senior Backend Engineer (m/w/d)", company: "Acme GmbH", job_url: "https://de.indeed.com/viewjob?jk=9", site: "indeed" };
  const board = { title: "Senior Backend Engineer", company: "Acme", job_url: "https://board.test/jobs/1", site: "board" };
  assert.deepEqual(jobKeys(indeed), [
    "url:de.indeed.com/viewjob?jk=9",
    "job:senior backend engineer m w d|acme gmbh",
    "job:senior backend engineer m w d|acme",
    "job:senior backend engineer|acme",
  ]);
  assert.equal(mergeKey(indeed), mergeKey(board));
  assert.equal(dedupeKey(indeed), mergeKey(indeed));
  assert.equal(mergeKey({ ...board, anonymous: true }), "");
  // Either one downloaded, the other is a repeat
  for (const [before, now] of [
    [indeed, board],
    [board, indeed],
  ]) {
    installChromeStorage();
    await rememberDownloaded([before]);
    assert.ok((await loadDownloaded()).has(now), `${before.site} → ${now.site}`);
  }
});
