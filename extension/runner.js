import { scrapeJobs } from "./scrapers/index.js";
import { resolveDatePreset } from "./scrapers/util.js";
import { moreResultsHint } from "./hint.js";
import { loadDownloaded, rememberDownloaded } from "./scrapers/history.js";
import { cleanAbroadCodes, countryName, describeCountries } from "./scrapers/countries.js";
import { liveSources, sourceLabel } from "./scrapers/sources.js";
import { checkLine, reportText, sourceLine } from "./scrapers/core/diagnostics.js";

const statusEl = document.getElementById("status");
const liveEl = document.getElementById("live");
const logEl = document.getElementById("log");
const stopBtn = document.getElementById("stop-btn");
const copyBtn = document.getElementById("copy-btn");
const copyNote = document.getElementById("copy-note");
const resultsEl = document.getElementById("results");
const listEl = document.getElementById("source-list");
const mergeEl = document.getElementById("merge-line");

// What Copy report needs once the run ends
const finished = { mode: "run", reports: [], merged: 0, skipped: 0 };

function setStatus(message, kind = "") {
  statusEl.textContent = message || "";
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function log(line) {
  logEl.hidden = false;
  logEl.textContent += (logEl.textContent ? "\n" : "") + line;
}

/** "Running: Indeed, Himalayas · 1 of 2 done · 1 failed" while sources run. */
function showLive({ running, done, total, failed }) {
  liveEl.hidden = false;
  const parts = [running.length ? `Running: ${running.join(", ")}` : "Finishing", `${done} of ${total} done`];
  if (failed) parts.push(`${failed} failed`);
  liveEl.textContent = parts.join(" · ");
}

/** One line per source, as each finishes; in the registry's order at the end. */
function showSource(report) {
  resultsEl.hidden = false;
  const li = document.createElement("li");
  // Not a class: "ok" is the button style
  li.dataset.status = report.status;
  li.dataset.source = report.id;
  li.textContent = finished.mode === "check" ? checkLine(report) : sourceLine(report);
  listEl.append(li);
}

function showResults(reports, { merged, skipped }) {
  listEl.textContent = "";
  reports.forEach(showSource);
  if (finished.mode !== "check") {
    mergeEl.hidden = false;
    mergeEl.textContent = `${merged} duplicates merged, ${skipped} already downloaded`;
  }
}

function downloadExcel(jobs) {
  if (typeof XLSX === "undefined") {
    throw new Error("Excel library failed to load");
  }

  // Job URL stays in column K; Also on is the last column
  const rows = jobs.map((j) => ({
    Title: j.title ?? "",
    Company: j.company ?? "",
    Location: j.location ?? "",
    Country: j.country ? countryName(j.country) : "",
    "Open to": j.open_to ?? "",
    Site: sourceLabel(j.site),
    Posted: j.date_posted ?? "",
    Remote: j.is_remote ?? "",
    "Listing type": j.listing_type ?? "",
    "Experience years":
      j.years_required == null || j.years_required === ""
        ? ""
        : j.years_required,
    "Job URL": j.job_url ?? "",
    "Direct URL": j.job_url_direct ?? "",
    "Also on": j.also_on ?? "",
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

/** The hint, or after a source stopped early, a reminder that the run wasn't complete. */
function logMoreResults(found, settings, incomplete) {
  if (incomplete.length) {
    log(`${incomplete.join(", ")} stopped early: wait a few minutes and run again before widening the search.`);
    return;
  }
  const more = moreResultsHint({ found, ...settings });
  if (more) log(more);
}

async function copyReport() {
  const text = reportText({
    version: chrome.runtime.getManifest?.().version || "",
    mode: finished.mode,
    log: logEl.textContent,
    reports: finished.reports,
    merged: finished.merged,
    skipped: finished.skipped,
  });
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard refused (tab not focused): copy through a selection instead
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  copyNote.hidden = false;
  copyNote.textContent = "Copied: paste it into a message (no cookies or personal data in it).";
}
copyBtn.addEventListener("click", copyReport);

async function run() {
  const { pendingFetch } = await chrome.storage.local.get("pendingFetch");
  if (!pendingFetch) {
    setStatus("No pending fetch. Open the extension popup and press OK.", "error");
    return;
  }

  const { title, stack, count, countries, abroad, home, datePreset, years, jobType, skipDownloaded } = pendingFetch;
  const check = pendingFetch.mode === "check";
  finished.mode = check ? "check" : "run";
  await chrome.storage.local.remove("pendingFetch");
  // Check sources asks every source this build has, ticked or not
  const sites = check ? liveSources().map((s) => s.id) : pendingFetch.sites;

  const preset = resolveDatePreset(check ? "week" : datePreset);
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
  const downloaded = check || skipDownloaded === false ? null : await loadDownloaded();
  const where = `Countries: ${describeCountries(countries)}\nYou live in: ${home ? `${countryName(home)} (its jobs are left out)` : "—"}\nEmployers abroad: ${cleanAbroadCodes(abroad).map(countryName).join(", ") || "—"}`;
  if (check) {
    log(`Check sources: ${sites.map(sourceLabel).join(", ")}\n${where}\nEach source: up to 3 jobs from the last 7 days; Title, Stack and Years are not used; nothing is downloaded`);
  } else {
    log(
      `Platforms: ${sites.map(sourceLabel).join(", ")}\n${where}\nCount (per source): ${count}\nPosted: ${preset.label}\nType: ${typeLabel}\nYears: ${yearsLabel}\nTitle: ${title || "any developer role"}\nStack: ${stack || "—"}\nFilters: remote · open to the selected countries\nAlready downloaded: ${downloaded ? `skipped (${downloaded.size} remembered)` : "included"}`
    );
  }
  setStatus(check ? "Checking every source…" : "Fetching remote developer jobs open to the EU from the selected platforms…");

  const stop = new AbortController();
  stopBtn.hidden = false;
  stopBtn.textContent = check ? "Stop" : "Stop and download";
  stopBtn.onclick = () => {
    stop.abort();
    stopBtn.disabled = true;
    stopBtn.textContent = "Stopping…";
    log("Stopped: each source keeps what it found so far");
  };

  try {
    const { jobs, errors, skipped, incomplete, reports, merged } = await scrapeJobs({
      sites,
      countries,
      abroad,
      home,
      title,
      stack,
      count,
      datePreset: preset.id,
      years: years === "" || years == null ? "" : Number(years),
      jobType: type,
      downloaded,
      mode: finished.mode,
      signal: stop.signal,
      onProgress: (msg) => log(msg),
      onSource: showSource,
      onStatus: showLive,
    });
    Object.assign(finished, { reports, merged, skipped });
    stopBtn.hidden = true;
    liveEl.hidden = true;
    copyBtn.hidden = false;
    showResults(reports, { merged, skipped });

    if (check) {
      const bad = reports.filter((r) => r.status === "failed").length;
      setStatus(
        `Checked ${reports.length} sources: ${reports.length - bad} answered, ${bad} failed. Copy report shows what each sent back.`,
        bad ? "error" : "success"
      );
      return;
    }
    if (skipped) log(`Skipped ${skipped} job(s) you already downloaded`);
    const unticked = liveSources()
      .filter((s) => !sites.includes(s.id))
      .map((s) => s.label);
    const settings = { count, preset, title, stack, years, abroad, type, unticked };

    if (errors.length) {
      log(`Warnings:\n- ${errors.join("\n- ")}`);
    }

    if (!jobs.length) {
      if (skipped) {
        setStatus(`No new jobs: all ${skipped} matching job(s) were downloaded before.`);
      } else {
        setStatus(
          errors.length
            ? "No jobs found. See the results by source."
            : "No jobs found for those filters.",
          "error"
        );
      }
      if (!errors.length && !stop.signal.aborted) logMoreResults(0, settings, incomplete);
      return;
    }

    downloadExcel(jobs);
    await rememberDownloaded(jobs);
    setStatus(
      `Downloaded ${jobs.length}${downloaded ? " new" : ""} job(s) as Excel${stop.signal.aborted ? " (stopped early)" : ""}.`,
      "success"
    );
    log(`Done — ${jobs.length} rows written to .xlsx`);
    // After Stop the run is short on purpose: no advice
    if (!stop.signal.aborted) logMoreResults(jobs.length, settings, incomplete);
  } catch (err) {
    const msg = err?.message || String(err);
    stopBtn.hidden = true;
    setStatus(msg, "error");
    log(msg);
  }
}

run();
