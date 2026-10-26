/**
 * What an adapter gets: ctx = { opts, wanted, signal, http, cache, progress,
 * screen, accept, enough, part, fail, note, adopt, report }.
 *
 * An adapter fetches through ctx.http only, maps each row with normalizeJob()
 * plus `_id` (stable within the source), `_where` (see open-to.js), and
 * optionally `_expires` and `anonymous` (the employer is hidden), and calls
 * ctx.accept(jobs) on each page, stopping when ctx.enough(). accept runs the
 * checks in order and counts each drop: own duplicate (not scanned),
 * scanned, expired, old, title, place (jbOpenTo), stack, type, years.
 * ctx.screen(rows) runs the checks that need no description on list rows, so
 * the adapter fetches details for the survivors only; it counts its drops the
 * same way, and the survivors are counted when accepted.
 * What was accepted is kept even if the adapter throws later: something kept,
 * then an error → incomplete; nothing kept → failed.
 */

import { titleMatches, withinHours, matchesEmployment, withinExperience } from "../util.js";
import "../open-to.js";
import { SourceError } from "../http.js";
import { createCache } from "./cache.js";
import { newReport } from "./diagnostics.js";

const message = (err) => err?.message || String(err);

/**
 * @param {object} meta  the source's registry entry (sources.js)
 * @param {{ opts: object, wanted: number, signal?: AbortSignal, http?: object, cache?: object,
 *           onProgress?: (msg: string) => void, now?: () => number }} env
 * opts: { title, stack, countries, abroad, home, preset: { hoursOld, span }, years, jobType, check }
 * (check: a Check sources run, which only needs to see that the source answers)
 */
export function createContext(meta, { opts, wanted, signal, http, cache, onProgress, now = Date.now }) {
  const preset = opts.preset || {};
  const report = newReport(meta, { title: opts.title, span: preset.span, wanted });
  const kept = [];
  // Ids every check has seen (kept or dropped), and list rows screen() passed
  const decided = new Set();
  const screened = new Set();
  let closed = false;
  let usedParts = false;
  const started = now();

  const placeOpts = (cheap) => ({
    home: opts.home || "",
    ticked: opts.countries || [],
    abroad: opts.abroad || [],
    cheap,
  });

  /** Why the job is left out, or "" to keep it. Fills open_to, country and is_remote on the way. */
  function verdict(job, cheap) {
    const expires = job._expires == null || job._expires === "" ? NaN : new Date(job._expires).getTime();
    if (expires < now()) return "expired";
    if (preset.hoursOld && !withinHours(job.date_posted, preset.hoursOld)) return "old";
    if (!titleMatches(job.title, opts.title)) return "title";
    const where = job._where || {};
    const place = globalThis.jbOpenTo(job, where, placeOpts(cheap));
    if (!place.open) return place.reason;
    if (!cheap) {
      if (!job.open_to && place.to) job.open_to = place.to;
      if (!job.country && where.listedIn) job.country = String(where.listedIn).toUpperCase();
      if (!job.is_remote && (where.remoteOnly || where.workplace === "remote")) job.is_remote = "Yes";
      if (opts.stack && !globalThis.jbStackMatches(job, opts.stack)) return "stack";
    }
    if (!matchesEmployment(job, opts.jobType)) return "type";
    if (!cheap && !withinExperience(job, opts.years)) return "years";
    return "";
  }

  const idOf = (job) => String(job._id || job.job_url || `${job.title}|${job.company}`);
  const counters = (name) => {
    if (!name) return null;
    if (!report.parts[name]) report.parts[name] = { scanned: 0, kept: 0, dropped: {}, duplicates: 0, error: "", key: "", note: "" };
    return report.parts[name];
  };
  const drop = (part, reason) => {
    report.dropped[reason] = (report.dropped[reason] || 0) + 1;
    if (part) part.dropped[reason] = (part.dropped[reason] || 0) + 1;
  };

  function screen(rows, partName = "") {
    if (closed) return [];
    const part = counters(partName);
    const out = [];
    for (const row of rows || []) {
      if (!row) continue;
      const id = idOf(row);
      if (decided.has(id) || screened.has(id)) {
        report.duplicates += 1;
        if (part) part.duplicates += 1;
        continue;
      }
      const reason = verdict(row, true);
      if (!reason) {
        screened.add(id);
        out.push(row);
        continue;
      }
      decided.add(id);
      report.scanned += 1;
      if (part) part.scanned += 1;
      drop(part, reason);
    }
    return out;
  }

  function accept(jobs, partName = "") {
    if (closed) return [];
    const part = counters(partName);
    const out = [];
    for (const job of jobs || []) {
      if (!job) continue;
      const id = idOf(job);
      if (decided.has(id)) {
        report.duplicates += 1;
        if (part) part.duplicates += 1;
        continue;
      }
      decided.add(id);
      report.scanned += 1;
      if (part) part.scanned += 1;
      const reason = verdict(job, false);
      if (reason) {
        drop(part, reason);
        continue;
      }
      job._id = id;
      job.site = meta.id;
      job._priority = meta.priority;
      if (partName) job._part = partName;
      report.kept += 1;
      if (part) part.kept += 1;
      kept.push(job);
      out.push(job);
    }
    return out;
  }

  /**
   * Jobs a source checked itself (Indeed), with its own counters
   * { scanned, kept, dropped, merged }; `kept` may exceed the jobs given when
   * the source already merged (`merged`) or trimmed them.
   */
  function adopt(jobs, counts = {}) {
    if (closed) return;
    report.scanned += counts.scanned ?? jobs.length;
    report.kept += counts.kept ?? jobs.length;
    report.merged += counts.merged || 0;
    for (const [reason, n] of Object.entries(counts.dropped || {})) {
      if (n) report.dropped[reason] = (report.dropped[reason] || 0) + n;
    }
    for (const job of jobs) {
      job._id = idOf(job);
      job.site = meta.id;
      job._priority = meta.priority;
      kept.push(job);
    }
  }

  const progress = (msg) => {
    if (!closed) onProgress?.(msg);
  };
  const note = (msg) => {
    report.notes.push(msg);
    progress(msg);
  };
  /**
   * Part of the source failed (one query, one country, one company); the rest
   * goes on. `log: false` when the adapter already said so.
   */
  const fail = (err, partName = "", { log = true } = {}) => {
    const text = message(err);
    if (partName) counters(partName).error = text;
    report.failures.push(partName ? `${partName}: ${text}` : text);
    if (log) progress(`${report.label}${partName ? ` ${partName}` : ""}: ${text}`);
  };
  const aborted = () => closed || Boolean(signal?.aborted);

  const ctx = {
    meta,
    opts,
    wanted,
    signal,
    http,
    cache: cache || createCache({ now }).scope(meta.id),
    report,
    progress,
    note,
    fail: (err, how) => fail(err, "", how),
    screen: (rows) => screen(rows),
    accept: (jobs) => accept(jobs),
    adopt,
    enough: () => aborted() || (!usedParts && report.kept >= wanted),
    /**
     * One part of a source that counts as its own source for Count (each
     * company of a careers source): the same calls, counted under its name.
     * `key` (a company's board token) is shown beside the name in Copy
     * report; the part's note(msg) ("40 jobs listed", "not found (HTTP 404)")
     * goes on that line only, not into the log, and fails nothing.
     */
    part(name, { key = "" } = {}) {
      usedParts = true;
      const own = counters(name);
      if (key) own.key = String(key);
      return {
        ...ctx,
        screen: (rows) => screen(rows, name),
        accept: (jobs) => accept(jobs, name),
        fail: (err, how) => fail(err, name, how),
        note: (msg) => {
          if (!closed) own.note = String(msg || "");
        },
        enough: () => aborted() || own.kept >= wanted,
      };
    },
  };

  /** Seal the report: later accept() calls are ignored. */
  function finish(err) {
    if (closed) return { report, jobs: kept };
    closed = true;
    report.ms = now() - started;
    report.requests = http?.requests?.() || 0;
    report.samples = http?.samples?.() || [];
    if (err) {
      report.error = message(err);
      report.errorKind = err.kind || "error";
    } else if (report.failures.length) {
      report.error = report.failures.slice(0, 3).join("; ") + (report.failures.length > 3 ? "; …" : "");
      report.errorKind = "partial";
    }
    if (report.errorKind === "skipped") report.status = "skipped";
    else if (err) report.status = report.kept ? "incomplete" : "failed";
    else if (report.failures.length) report.status = report.kept || report.scanned ? "incomplete" : "failed";
    else report.status = "ok";
    return { report, jobs: kept };
  }

  return { ctx, finish };
}

/** Resolves when `promise` settles, or `graceMs` after `signal` aborts, whichever comes first. */
function settleOrAbort(promise, signal, graceMs) {
  promise.catch(() => {});
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let timer = null;
    const onAbort = () => {
      timer = setTimeout(resolve, graceMs);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

/**
 * Run one adapter: its own context and HTTP view; returns { report, jobs }
 * however the adapter ends. A stopped source (Stop, its budget, the run's
 * cap) gets `graceMs` to wind down, then keeps what it accepted.
 * @param {object} meta
 * @param {{ run: (ctx: object) => Promise<void>, opts: object, wanted: number, http: object,
 *           signal?: AbortSignal, cache?: object, onProgress?: (msg: string) => void,
 *           graceMs?: number, now?: () => number }} env
 */
export async function runSource(meta, { run, opts, wanted, http, signal, cache, onProgress, graceMs = 3000, now }) {
  const client = http.client(meta, { signal });
  const { ctx, finish } = createContext(meta, { opts, wanted, signal, http: client, cache, onProgress, now });
  let error = null;
  try {
    await settleOrAbort(Promise.resolve().then(() => run(ctx)), signal, graceMs);
  } catch (err) {
    error = err;
  }
  // Cut short (even if the adapter swallowed the abort): say why, unless it had failed already
  if (signal?.aborted && (!error || error.kind === "aborted")) {
    error = signal.reason instanceof SourceError ? signal.reason : new SourceError("aborted", "stopped");
  }
  return finish(error);
}
