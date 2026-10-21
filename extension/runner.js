import { scrapeJobs } from "./scrapers/index.js";
import { resolveDatePreset } from "./scrapers/util.js";
import { loadDownloaded, rememberDownloaded } from "./scrapers/history.js";
import { cleanAbroadCodes, countryName, describeCountries } from "./scrapers/countries.js";

const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

function setStatus(message, kind = "") {
  statusEl.textContent = message || "";
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function log(line) {
  logEl.hidden = false;
  logEl.textContent += (logEl.textContent ? "\n" : "") + line;
}

function downloadExcel(jobs) {
  if (typeof XLSX === "undefined") {
    throw new Error("Excel library failed to load");
  }

  const rows = jobs.map((j) => ({
    Title: j.title ?? "",
    Company: j.company ?? "",
    Location: j.location ?? "",
    Country: j.country ? countryName(j.country) : "",
    "Open to": j.open_to ?? "",
    Site: j.site ?? "",
    Posted: j.date_posted ?? "",
    Remote: j.is_remote ?? "",
    "Listing type": j.listing_type ?? "",
    "Experience years":
      j.years_required == null || j.years_required === ""
        ? ""
        : j.years_required,
    "Job URL": j.job_url ?? "",
    "Direct URL": j.job_url_direct ?? "",
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  // Make the URL columns clickable
  const headers = Object.keys(rows[0] || {});
  for (const name of ["Job URL", "Direct URL"]) {
    const c = headers.indexOf(name);
    rows.forEach((row, i) => {
      const url = row[name];
      if (c < 0 || !/^https?:\/\//i.test(url)) return;
      const cell = sheet[XLSX.utils.encode_cell({ r: i + 1, c })];
      if (cell) cell.l = { Target: url };
    });
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Jobs");

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  XLSX.writeFile(book, `jobbridge-eu-developers-${stamp}.xlsx`);
}

/** Fewer jobs than Count: the settings that would widen the next run. */
function moreResultsHint({ found, count, preset, title, abroad, type }) {
  if (found >= Number(count)) return "";
  const tips = [];
  if (preset.id !== "month") tips.push("a longer Posted window (7 or 30 days)");
  if (String(title || "").trim()) {
    tips.push("an empty Title (every developer role, searched in each country's own language)");
  }
  if (!cleanAbroadCodes(abroad).length) tips.push("ticking Employers abroad");
  if (type !== "both") tips.push("Type: Both");
  return tips.length ? `Fewer than ${count} found. For more, try ${tips.join(", ")}.` : "";
}

async function run() {
  const { pendingFetch } = await chrome.storage.local.get("pendingFetch");
  if (!pendingFetch) {
    setStatus("No pending fetch. Open the extension popup and press OK.", "error");
    return;
  }

  const { title, stack, count, sites, countries, abroad, datePreset, years, jobType, skipDownloaded } =
    pendingFetch;
  await chrome.storage.local.remove("pendingFetch");

  const preset = resolveDatePreset(datePreset);

  const type = ["contract", "both"].includes(jobType) ? jobType : "fulltime";
  const typeLabel = {
    fulltime: "Full time",
    contract: "Contract / freelance",
    both: "Full time + contract",
  }[type];
  const yearsLabel =
    years === "" || years == null
      ? "—"
      : `${years} (keep jobs asking for ${Number(years) + 0.5} years or fewer)`;
  // Older settings have no skipDownloaded: skipping is the default
  const downloaded = skipDownloaded === false ? null : await loadDownloaded();
  log(
    `Platforms: ${sites.join(", ")}\nCountries: ${describeCountries(countries)}\nCount (per site): ${count}\nPosted: ${preset.label}\nType: ${typeLabel}\nYears: ${yearsLabel}\nEmployers abroad: ${cleanAbroadCodes(abroad).map(countryName).join(", ") || "—"}\nTitle: ${title || "any developer role"}\nStack: ${stack || "—"}\nFilters: remote · open to the selected countries\nAlready downloaded: ${downloaded ? `skipped (${downloaded.size} remembered)` : "included"}`
  );
  setStatus("Fetching remote developer jobs open to the EU from selected platforms…");

  try {
    const { jobs, errors, skipped } = await scrapeJobs({
      sites,
      countries,
      abroad,
      title,
      stack,
      count,
      datePreset: preset.id,
      years: years === "" || years == null ? "" : Number(years),
      jobType: type,
      downloaded,
      onProgress: (msg) => log(msg),
    });
    if (skipped) log(`Skipped ${skipped} job(s) you already downloaded`);

    if (errors.length) {
      log(`Warnings:\n- ${errors.join("\n- ")}`);
    }

    if (!jobs.length) {
      if (skipped) {
        setStatus(`No new jobs: all ${skipped} matching job(s) were downloaded before.`);
      } else {
        setStatus(
          errors.length
            ? "No jobs found. See log for platform errors."
            : "No jobs found for those filters.",
          "error"
        );
        const more = moreResultsHint({ found: 0, count, preset, title, abroad, type });
        if (more && !errors.length) log(more);
      }
      return;
    }

    downloadExcel(jobs);
    await rememberDownloaded(jobs);
    setStatus(`Downloaded ${jobs.length}${downloaded ? " new" : ""} job(s) as Excel.`, "success");
    log(`Done — ${jobs.length} rows written to .xlsx`);
    const more = moreResultsHint({ found: jobs.length, count, preset, title, abroad, type });
    if (more) log(more);
  } catch (err) {
    const msg = err?.message || String(err);
    setStatus(msg, "error");
    log(msg);
  }
}

run();
