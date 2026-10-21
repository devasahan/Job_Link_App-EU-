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
  jobKeys,
  loadDownloaded,
  normalizeWords,
  rememberDownloaded,
} from "../extension/scrapers/history.js";

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
