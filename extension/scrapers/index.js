import { resolveDatePreset } from "./util.js";
import { canonicalUrl, mergeKey } from "./history.js";
import { cleanAbroadCodes, cleanCountryCodes, countryName } from "./countries.js";
import { liveSources, sourceById } from "./sources.js";
import { loadAdapter } from "./adapters.js";
import { createHttp, SourceError } from "./http.js";
import { createCache } from "./core/cache.js";
import { runSource } from "./core/context.js";
import { newReport, sourceLine } from "./core/diagnostics.js";

// The whole run stops after 10 minutes, whatever the sources' own budgets
const RUN_CAP_MS = 10 * 60e3;
// Check sources: a few recent jobs from each, enough to see it answers
const CHECK_WANTED = 3;
const CHECK_PRESET = "week";

/** A stop signal with a reason the report can show (SourceError "aborted"). */
function stopper(ms, why) {
  const controller = new AbortController();
  const timer = ms ? setTimeout(() => controller.abort(new SourceError("aborted", why)), ms) : null;
  return { controller, signal: controller.signal, clear: () => clearTimeout(timer) };
}

const newestFirst = (a, b) => String(b.date_posted || "").localeCompare(String(a.date_posted || ""));

/**
 * The key a job is merged by: title + company without its legal form (one of
 * the keys history.js remembers it by), or its link when the employer is hidden.
 */
export function dedupeKey(job) {
  return mergeKey(job) || (job.job_url ? `url:${canonicalUrl(job.job_url)}` : "");
}

/**
 * One row per job across sources: the copy from the source with the lowest
 * priority number wins (newest first among equals); it takes a direct link
 * from the others when it has none, and `also_on` names where else it was
 * found. Returns { jobs, merged }.
 */
export function mergeSources(jobs, labelOf = (id) => sourceById(id)?.label || id) {
  const order = [...jobs].sort((a, b) => (a._priority ?? 99) - (b._priority ?? 99) || newestFirst(a, b));
  const byKey = new Map();
  const out = [];
  let merged = 0;
  for (const job of order) {
    const key = dedupeKey(job);
    const first = key && byKey.get(key);
    if (!first) {
      if (key) byKey.set(key, job);
      out.push(job);
      continue;
    }
    merged += 1;
    if (!first.job_url_direct && job.job_url_direct) first.job_url_direct = job.job_url_direct;
    if (job.site !== first.site) {
      const also = new Set(String(first.also_on || "").split(", ").filter(Boolean));
      also.add(labelOf(job.site));
      first.also_on = [...also].join(", ");
    }
  }
  return { jobs: out, merged };
}

/** The sheet's fields only: no `_` helpers; the date trimmed to the day. */
function publicJob(job) {
  const out = {};
  for (const [k, v] of Object.entries(job)) if (!k.startsWith("_")) out[k] = v;
  out.date_posted = String(job.date_posted || "").slice(0, 10);
  if (!out.also_on) out.also_on = "";
  return out;
}

/**
 * Fetch remote developer jobs open to the selected EU countries (no local
 * server) from every ticked source at once, each with its own time budget
 * (the run stops after 10 minutes): jobs based in those countries, and jobs
 * abroad (UK, Canada, US) or on remote boards that say they hire there.
 * @param {{
 *   sites: string[],
 *   countries: string[],
 *   abroad?: string[],
 *   home?: string,
 *   title: string,
 *   stack: string,
 *   count: number,
 *   datePreset?: string,
 *   years?: number | "",
 *   jobType?: "fulltime" | "contract" | "both" | "",
 *   downloaded?: { has(job): boolean, recentCount(site: string, hours: number): number },
 *   mode?: "run" | "check",
 *   signal?: AbortSignal,
 *   onProgress?: (msg: string) => void,
 *   onSource?: (report: object) => void,
 *   onStatus?: (status: { running: string[], done: number, total: number, failed: number }) => void,
 *   sources?: object[],
 *   http?: object,
 *   cache?: object,
 *   capMs?: number,
 *   graceMs?: number
 * }} opts
 * With `home` (where the user lives), jobs in that country are left out, and
 * so are jobs elsewhere that say you must live there.
 * With `downloaded`, jobs from earlier downloads are left out (counted in
 * `skipped`) and each source is asked for more, so Count new jobs still fit.
 * `mode: "check"` asks every source for 3 jobs of the last 7 days (Title,
 * Stack and Years ignored) to see that it answers.
 * `signal` (Stop) ends every source; each keeps what it found.
 * `sources`, `http`, `cache`, `capMs` and `graceMs` are for tests (registry
 * entries may carry their own `run`).
 * Returns { jobs, errors, skipped, incomplete, reports, merged, datePreset }:
 * `errors` are the failed sources' lines, `incomplete` the labels of sources
 * that stopped early.
 */
export async function scrapeJobs({
  sites,
  countries,
  abroad,
  home,
  title,
  stack,
  count,
  datePreset,
  years,
  jobType,
  downloaded,
  mode = "run",
  signal,
  onProgress,
  onSource,
  onStatus,
  sources: registry,
  http,
  cache,
  capMs = RUN_CAP_MS,
  graceMs,
}) {
  const check = mode === "check";
  if (!sites?.length) {
    throw new Error("Select at least one platform");
  }
  const countryCodes = cleanCountryCodes(countries);
  if (!countryCodes.length) {
    throw new Error("Select at least one country");
  }
  const abroadCodes = cleanAbroadCodes(abroad);
  const homeCode = cleanCountryCodes([home])[0] || "";

  const known = registry || liveSources();
  const errors = [];
  const picked = [];
  for (const id of [...new Set(sites)]) {
    const meta = known.find((s) => s.id === id && !s.pending);
    if (meta) picked.push(meta);
    else errors.push(`Unknown platform: ${id}`);
  }
  // Only sources bound to the ticked countries have nothing to search in the user's own country alone
  if (
    homeCode &&
    !abroadCodes.length &&
    countryCodes.every((code) => code === homeCode) &&
    picked.length &&
    picked.every((s) => s.countryBound)
  ) {
    throw new Error(`Select a country other than ${countryName(homeCode)}, where you live`);
  }

  const preset = resolveDatePreset(check ? CHECK_PRESET : datePreset);
  const resultsWanted = Math.max(1, Math.min(200, Number(count) || 50));
  const type = check ? "both" : jobType;
  const opts = {
    title: check ? "" : (title || "").trim(),
    stack: check ? "" : (stack || "").trim(),
    countries: countryCodes,
    abroad: abroadCodes,
    home: homeCode,
    preset,
    years: check ? "" : years,
    jobType: type,
  };

  const net = http || createHttp({ cache });
  const store = cache || createCache();
  const user = signal;
  const cap = stopper(capMs, `the run's ${Math.round(capMs / 60e3)}-minute limit`);
  const stopAll = () => cap.controller.abort(new SourceError("aborted", "stopped by you"));
  if (user?.aborted) stopAll();
  else user?.addEventListener("abort", stopAll, { once: true });

  const running = new Set();
  const reports = [];
  let failed = 0;
  const status = () =>
    onStatus?.({ running: [...running].map((s) => s.label), done: reports.length, total: picked.length, failed });

  async function one(meta) {
    // Freelance work isn't full time
    if ((meta.group === "freelance" || meta.needsContract) && type === "fulltime") {
      const report = { ...newReport(meta), status: "skipped", error: "Type is Full time", errorKind: "skipped" };
      return { report, jobs: [] };
    }
    const own = stopper(meta.budgetMs, `time budget (${Math.round(meta.budgetMs / 1000)} s) used up`);
    const stop = () => own.controller.abort(cap.signal.reason);
    if (cap.signal.aborted) stop();
    else cap.signal.addEventListener("abort", stop, { once: true });
    // Jobs downloaded before may fill this source's first results again
    const repeats = downloaded ? downloaded.recentCount(meta.id, preset.hoursOld) : 0;
    const wanted = check ? CHECK_WANTED : Math.min(400, resultsWanted + repeats);
    running.add(meta);
    status();
    onProgress?.(`Fetching ${meta.label}…`);
    try {
      let run = meta.run;
      try {
        run ||= await loadAdapter(meta);
      } catch (err) {
        run = () => {
          throw err;
        };
      }
      return await runSource(meta, {
        run,
        opts,
        wanted,
        http: net,
        signal: own.signal,
        cache: store.scope(meta.id),
        onProgress,
        graceMs,
      });
    } finally {
      own.clear();
      cap.signal.removeEventListener("abort", stop);
      running.delete(meta);
    }
  }

  const settled = await Promise.allSettled(
    picked.map((meta) =>
      one(meta).then((result) => {
        reports.push(result.report);
        if (result.report.status === "failed") failed += 1;
        onProgress?.(sourceLine(result.report));
        onSource?.(result.report);
        status();
        return result;
      })
    )
  );
  cap.clear();
  user?.removeEventListener("abort", stopAll);

  // The registry's order, not the finishing order
  const results = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { report: { ...newReport(picked[i]), status: "failed", error: s.reason?.message || String(s.reason) }, jobs: [] }
  );
  const ordered = results.map((r) => r.report);
  for (const report of ordered) {
    if (report.status === "failed") errors.push(`${report.label}: ${report.error}`);
  }
  const incomplete = ordered.filter((r) => r.status === "incomplete").map((r) => r.label);

  // Leave out earlier downloads, then Count per source (each part of a source is
  // one), on each source's own jobs before they merge: a job another source also
  // found keeps its row even when the winning copy is past its own source's Count
  const limit = check ? CHECK_WANTED : resultsWanted;
  const skippedJobs = new Set();
  const trimmed = results.flatMap((r) => {
    const perPart = {};
    return r.jobs
      .filter((job) => {
        if (!downloaded?.has(job)) return true;
        // A job, not each copy of it
        skippedJobs.add(dedupeKey(job) || `${job.site}:${job._id}`);
        return false;
      })
      .sort(newestFirst)
      .filter((job) => (perPart[job._part || ""] = (perPart[job._part || ""] || 0) + 1) <= limit);
  });

  // One row per job across sources (and across a source's own countries)
  const labelOf = (id) => picked.find((s) => s.id === id)?.label || sourceById(id)?.label || id;
  let { jobs, merged } = mergeSources(trimmed, labelOf);
  merged += ordered.reduce((n, r) => n + (r.merged || 0), 0);

  jobs = jobs.sort(newestFirst).map(publicJob);
  return { jobs, errors, skipped: skippedJobs.size, incomplete, reports: ordered, merged, datePreset: preset };
}

