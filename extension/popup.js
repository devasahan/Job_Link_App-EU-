import { downloadedCount, forgetDownloaded } from "./scrapers/history.js";
import { ABROAD_CODES, ALL_COUNTRIES, EU_CODES, countryName, describeCountries } from "./scrapers/countries.js";
import { GROUPS, liveSources, sourceById } from "./scrapers/sources.js";
import { DATE_PRESETS } from "./scrapers/util.js";

const form = document.getElementById("fetch-form");
const statusEl = document.getElementById("status");
const okBtn = document.getElementById("ok-btn");
const checkBtn = document.getElementById("check-btn");
const countryList = document.getElementById("country-list");
const countrySummary = document.getElementById("country-summary");
const countryNote = document.getElementById("country-note");
const homeSelect = document.getElementById("home");
const sourceGroups = document.getElementById("source-groups");

const STORAGE_KEYS = [
  "title",
  "stack",
  "count",
  "sites",
  "countries",
  "abroad",
  "home",
  "date_preset",
  "years",
  "job_type",
  "known_sites",
  "skip_downloaded",
];

// Sources the popup had before known_sites was saved
const FIRST_SITES = ["indeed"];
const EVERY_CODE = [...ALL_COUNTRIES.map((c) => c.code), ...ABROAD_CODES];

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

/** Countries at least one ticked source can search (a source with no list searches any). */
function coveredCountries() {
  const covered = new Set();
  for (const site of selectedSites()) {
    for (const code of sourceById(site)?.countries || EVERY_CODE) covered.add(code);
  }
  return covered;
}

/** Only sources bound to the ticked countries: the user's own country alone is nothing to search. */
const allCountryBound = (sites) => sites.length > 0 && sites.every((id) => sourceById(id)?.countryBound);

/** The Platforms groups ("Job boards · 2 of 3", All / None); empty groups aren't shown. */
function renderSources() {
  for (const group of GROUPS) {
    const sources = liveSources().filter((s) => s.group === group.id);
    if (!sources.length) continue;
    const details = document.createElement("details");
    details.className = "source-group";
    details.dataset.group = group.id;
    const summary = document.createElement("summary");
    const label = document.createElement("span");
    label.textContent = group.label;
    const count = document.createElement("span");
    count.className = "hint group-count";
    summary.append(label, " ", count);
    const pick = document.createElement("div");
    pick.className = "pick";
    for (const [which, text] of [
      ["all", "All"],
      ["none", "None"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link";
      button.dataset.groupPick = which;
      button.textContent = text;
      pick.append(button);
    }
    const grid = document.createElement("div");
    grid.className = "source-grid";
    for (const source of sources) {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.name = "site";
      box.value = source.id;
      // New sources start at their default, so many new ones don't all switch on at once
      box.checked = source.defaultOn;
      const item = document.createElement("label");
      item.className = "check";
      item.title = source.url || "";
      item.append(box, ` ${source.label}`);
      if (source.hint) {
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = `(${source.hint})`;
        item.append(" ", hint);
      }
      grid.append(item);
    }
    details.append(summary, pick, grid);
    sourceGroups.append(details);
  }
}

/** Group counts, and freelance greyed out while Type is Full time. */
function refreshSources() {
  for (const details of sourceGroups.querySelectorAll(".source-group")) {
    const boxes = [...details.querySelectorAll('input[name="site"]')];
    const on = boxes.filter((b) => b.checked).length;
    details.querySelector(".group-count").textContent = `· ${on} of ${boxes.length}`;
    const off = details.dataset.group === "freelance" && form.job_type.value === "fulltime";
    details.classList.toggle("off", off);
    details.title = off ? "Freelance work isn't full time: set Type to Contract or Both" : "";
  }
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

function renderHome() {
  const byName = [...ALL_COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
  for (const { code, name } of byName) homeSelect.append(new Option(name, code));
}

/** Summary line, greyed-out countries (no ticked board covers them, or you live there), and the note. */
function refreshCountries() {
  const covered = coveredCountries();
  const home = homeSelect.value;
  const uncovered = [];
  for (const box of countryBoxes()) {
    const mine = box.value === home;
    const off = mine || !covered.has(box.value);
    box.parentElement.classList.toggle("uncovered", off);
    box.parentElement.title = mine
      ? "You live here: its jobs are left out"
      : off
        ? "No ticked platform has a site for this country"
        : "";
    if (off && !mine && box.checked) uncovered.push(box.parentElement.textContent.trim());
  }
  const picked = selectedCountries();
  const notes = [
    picked.includes(home) ? `not ${countryName(home)}` : "",
    uncovered.length ? `${uncovered.length} not searched` : "",
  ].filter(Boolean);
  // "All EU (27) · not Sweden", but "Germany · not Sweden" rather than naming it twice
  const named = describeCountries(picked);
  const shown = named.startsWith("All EU") ? named : describeCountries(picked.filter((code) => code !== home));
  countrySummary.textContent = picked.length ? [shown || "none", ...notes].join(" · ") : "none";
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
    // Sources added since the last save keep their default
    siteBoxes().forEach((el) => {
      if (known.includes(el.value)) el.checked = saved.sites.includes(el.value);
    });
  }
  if (Array.isArray(saved.countries) && saved.countries.length) {
    countryBoxes().forEach((el) => {
      el.checked = saved.countries.includes(el.value);
    });
  }
  if (ALL_COUNTRIES.some((c) => c.code === saved.home)) homeSelect.value = saved.home;
  if (Array.isArray(saved.abroad)) {
    abroadBoxes().forEach((el) => {
      el.checked = saved.abroad.includes(el.value);
    });
  }
  refreshCountries();
  refreshSources();
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

sourceGroups.addEventListener("click", (event) => {
  const which = event.target.dataset?.groupPick;
  if (!which) return;
  const details = event.target.closest(".source-group");
  details.querySelectorAll('input[name="site"]').forEach((el) => {
    el.checked = which === "all";
  });
  refreshCountries();
  refreshSources();
});

form.addEventListener("change", (event) => {
  if (["site", "country", "home"].includes(event.target.name)) refreshCountries();
  if (["site", "job_type"].includes(event.target.name)) refreshSources();
});

/** Save the form and open the runner: a run ("run") or Check sources ("check"). */
async function start(mode) {
  const check = mode === "check";
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
  const home = homeSelect.value;
  const skipDownloaded = form.skip_downloaded.checked;

  if (!sites.length && !check) {
    setStatus("Select at least one platform.", "error");
    return;
  }
  if (!countries.length) {
    setStatus("Select at least one country.", "error");
    document.getElementById("countries").open = true;
    return;
  }
  if (!check && allCountryBound(sites) && home && !abroad.length && countries.every((code) => code === home)) {
    setStatus(`Tick a country other than ${countryName(home)}, where you live.`, "error");
    document.getElementById("countries").open = true;
    return;
  }
  const covered = coveredCountries();
  if (!check && ![...countries.filter((code) => code !== home), ...abroad].some((code) => covered.has(code))) {
    setStatus("The ticked platforms have no site for any selected country.", "error");
    document.getElementById("countries").open = true;
    return;
  }

  okBtn.disabled = true;
  checkBtn.disabled = true;
  setStatus(check ? "Opening the source check…" : "Opening fetch tab…");

  await chrome.storage.local.set({
    title,
    stack,
    count,
    sites,
    countries,
    abroad,
    home,
    date_preset: datePreset,
    years,
    job_type: jobType,
    known_sites: siteBoxes().map((el) => el.value),
    skip_downloaded: skipDownloaded,
    pendingFetch: { title, stack, count, sites, countries, abroad, home, datePreset, years, jobType, skipDownloaded, mode },
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL("runner.html"),
  });

  window.close();
}

checkBtn.addEventListener("click", () => start("check"));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  start("run");
});

renderSources();
renderCountries();
renderHome();
refreshSources();
restoreForm();
showDownloaded();
