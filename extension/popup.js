import { downloadedCount, forgetDownloaded } from "./scrapers/history.js";
import { ALL_COUNTRIES, EU_CODES, describeCountries } from "./scrapers/countries.js";
import { BOARD_COUNTRIES } from "./scrapers/index.js";
import { DATE_PRESETS } from "./scrapers/util.js";

const form = document.getElementById("fetch-form");
const statusEl = document.getElementById("status");
const okBtn = document.getElementById("ok-btn");
const countryList = document.getElementById("country-list");
const countrySummary = document.getElementById("country-summary");
const countryNote = document.getElementById("country-note");

const STORAGE_KEYS = [
  "title",
  "stack",
  "count",
  "sites",
  "countries",
  "abroad",
  "date_preset",
  "years",
  "job_type",
  "known_sites",
  "skip_downloaded",
];

// Boards the popup had before known_sites was saved
const FIRST_SITES = ["indeed"];

const siteBoxes = () => [...form.querySelectorAll('input[name="site"]')];
const countryBoxes = () => [...form.querySelectorAll('input[name="country"]')];
const abroadBoxes = () => [...form.querySelectorAll('input[name="abroad"]')];

function setStatus(message, kind = "") {
  statusEl.textContent = message || "";
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function selectedSites() {
  return [...form.querySelectorAll('input[name="site"]:checked')].map(
    (el) => el.value
  );
}

function selectedCountries() {
  return countryBoxes()
    .filter((el) => el.checked)
    .map((el) => el.value);
}

function selectedAbroad() {
  return abroadBoxes()
    .filter((el) => el.checked)
    .map((el) => el.value);
}

/** Countries at least one ticked board can search. */
function coveredCountries() {
  const covered = new Set();
  for (const site of selectedSites()) {
    for (const code of BOARD_COUNTRIES[site] || []) covered.add(code);
  }
  return covered;
}

function renderCountries() {
  for (const { code, name } of ALL_COUNTRIES) {
    const label = document.createElement("label");
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.name = "country";
    box.value = code;
    // EU-27 by default; the UK, Switzerland and Norway are extras
    box.checked = EU_CODES.includes(code);
    label.append(box, ` ${name}`);
    countryList.append(label);
  }
}

/** Summary line, greyed-out countries no ticked board covers, and the note about them. */
function refreshCountries() {
  const covered = coveredCountries();
  const uncovered = [];
  for (const box of countryBoxes()) {
    const off = !covered.has(box.value);
    box.parentElement.classList.toggle("uncovered", off);
    box.parentElement.title = off ? "No ticked platform has a site for this country" : "";
    if (off && box.checked) uncovered.push(box.parentElement.textContent.trim());
  }
  const picked = selectedCountries();
  countrySummary.textContent = picked.length
    ? describeCountries(picked) + (uncovered.length ? ` · ${uncovered.length} not searched` : "")
    : "none";
  countryNote.hidden = !uncovered.length;
  countryNote.textContent = uncovered.length
    ? `Not searched (no site on the ticked platforms): ${uncovered.join(", ")}.`
    : "";
}

async function restoreForm() {
  const saved = await chrome.storage.local.get(STORAGE_KEYS);
  if (saved.title) form.title.value = saved.title;
  if (saved.stack) form.stack.value = saved.stack;
  if (saved.count) form.count.value = String(saved.count);
  if (Object.hasOwn(DATE_PRESETS, saved.date_preset)) {
    form.date_preset.value = saved.date_preset;
  }
  if (["fulltime", "contract", "both"].includes(saved.job_type)) {
    form.job_type.value = saved.job_type;
  }
  if (saved.years != null && saved.years !== "") {
    form.years.value = String(saved.years);
  }
  form.skip_downloaded.checked = saved.skip_downloaded !== false;
  if (Array.isArray(saved.sites) && saved.sites.length) {
    const known = Array.isArray(saved.known_sites) ? saved.known_sites : FIRST_SITES;
    // Boards added since the last save keep their default (ticked)
    siteBoxes().forEach((el) => {
      if (known.includes(el.value)) el.checked = saved.sites.includes(el.value);
    });
  }
  if (Array.isArray(saved.countries) && saved.countries.length) {
    countryBoxes().forEach((el) => {
      el.checked = saved.countries.includes(el.value);
    });
  }
  if (Array.isArray(saved.abroad)) {
    abroadBoxes().forEach((el) => {
      el.checked = saved.abroad.includes(el.value);
    });
  }
  refreshCountries();
}

const countEl = document.getElementById("downloaded-count");
const forgetBtn = document.getElementById("forget-btn");

async function showDownloaded() {
  const n = await downloadedCount();
  countEl.textContent = n ? `(${n} remembered)` : "";
  forgetBtn.hidden = !n;
}

forgetBtn.addEventListener("click", async () => {
  await forgetDownloaded();
  await showDownloaded();
  setStatus("Forgot downloaded jobs: the next run includes them again.");
});

form.querySelectorAll("[data-countries]").forEach((button) => {
  button.addEventListener("click", () => {
    const eu = button.dataset.countries === "eu";
    countryBoxes().forEach((el) => {
      el.checked = eu && EU_CODES.includes(el.value);
    });
    refreshCountries();
  });
});

form.addEventListener("change", (event) => {
  if (event.target.name === "site" || event.target.name === "country") refreshCountries();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = form.title.value.trim();
  const stack = form.stack.value.trim();
  const count = Math.max(1, Math.min(200, Number(form.count.value) || 50));
  const datePreset = Object.hasOwn(DATE_PRESETS, form.date_preset.value) ? form.date_preset.value : "today";
  const jobType = ["contract", "both"].includes(form.job_type.value) ? form.job_type.value : "fulltime";
  const yearsRaw = form.years.value.trim();
  let years = "";
  if (yearsRaw !== "") {
    years = Number(yearsRaw);
    if (!Number.isFinite(years) || years < 0 || years > 40) {
      setStatus("Years must be a number from 0 to 40.", "error");
      return;
    }
  }
  const sites = selectedSites();
  const countries = selectedCountries();
  const abroad = selectedAbroad();
  const skipDownloaded = form.skip_downloaded.checked;

  if (!sites.length) {
    setStatus("Select at least one platform.", "error");
    return;
  }
  if (!countries.length) {
    setStatus("Select at least one country.", "error");
    document.getElementById("countries").open = true;
    return;
  }
  const covered = coveredCountries();
  if (![...countries, ...abroad].some((code) => covered.has(code))) {
    setStatus("The ticked platforms have no site for any selected country.", "error");
    document.getElementById("countries").open = true;
    return;
  }

  okBtn.disabled = true;
  setStatus("Opening fetch tab…");

  await chrome.storage.local.set({
    title,
    stack,
    count,
    sites,
    countries,
    abroad,
    date_preset: datePreset,
    years,
    job_type: jobType,
    known_sites: siteBoxes().map((el) => el.value),
    skip_downloaded: skipDownloaded,
    pendingFetch: { title, stack, count, sites, countries, abroad, datePreset, years, jobType, skipDownloaded },
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL("runner.html"),
  });

  window.close();
});

renderCountries();
restoreForm();
showDownloaded();
