/**
 * Himalayas — free public JSON API (no key), remote-only board.
 * https://github.com/Himalayas-App/remote-jobs-api
 *   GET /jobs/api/search?sort=recent&page=N[&q=<title>][&country=<home>][&employment_type=…]
 * 20 jobs a page (often a few fewer after de-duplication), newest first with
 * sort=recent; `totalCount` says how many match. country=<code> keeps jobs
 * open to that country plus worldwide ones, so it is sent only with You live
 * in set; otherwise every job comes back and open-to.js decides. `q` is a
 * fuzzy full-text search: it is sent for a single typed title only (extra
 * words make it broader, not narrower), and titles are checked here anyway.
 * Where a job is open: `locationRestrictions` (country names, or
 * { alpha2, name } per the spec), empty meaning worldwide, narrowed by
 * `timezoneRestrictions` (UTC offsets). The API sends no CORS headers (the
 * host permission covers that) and refuses browser-like user agents, so
 * header rule 2 sends a plain client name for the extension's own requests.
 * Position 1 of a page can be a promoted listing, so page dates are judged
 * on every job, not the first. Responses are cached by Himalayas for up to a
 * day.
 * Terms: credit Himalayas (the sheet's Site column) and link to the job on
 * himalayas.app (kept as job_url).
 */

import { normalizeJob, stripHtml, withinHours } from "../util.js";
import { expectArray } from "../http.js";

const BASE = "https://himalayas.app";
const PER_PAGE = 20;
// About 8-9 pages a day for every developer role; the budget (120 s) caps longer windows
const MAX_PAGES = [
  [24, 10],
  [72, 20],
  [168, 35],
  [Infinity, 60],
];

function employmentType(jobType) {
  if (jobType === "fulltime") return "Full Time";
  if (jobType === "contract") return "Contractor";
  return "";
}

/** Seconds in real responses, milliseconds in the spec. */
function toIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

/** [lo, hi] from the UTC offsets a job accepts ([-1, 0, 1, 2] → [-1, 2]), or null. */
function utcWindow(list) {
  const offsets = (Array.isArray(list) ? list : [])
    .map((v) => Number(typeof v === "string" ? v.replace(/^(?:utc|gmt)\s*/i, "") : v))
    .filter(Number.isFinite);
  return offsets.length ? [Math.min(...offsets), Math.max(...offsets)] : null;
}

/** A job on himalayas.app, from one search row. */
export function toJob(row) {
  const restrictions = (Array.isArray(row.locationRestrictions) ? row.locationRestrictions : []).filter(Boolean);
  // open-to.js reads codes or names; the sheet shows names
  const open = restrictions.map((c) => (typeof c === "string" ? c : c.alpha2 || c.name || "")).filter(Boolean);
  const names = restrictions.map((c) => (typeof c === "string" ? c : c.name || c.alpha2 || "")).filter(Boolean);
  const company = row.companyName && row.companyName !== "name" ? row.companyName : row.companySlug || "";
  let direct = "";
  try {
    if (row.applicationLink && new URL(row.applicationLink).hostname !== "himalayas.app") direct = row.applicationLink;
  } catch {
    direct = "";
  }
  // Categories are skill-like ("React-Native-Developer"): let the stack see them
  const categories = Array.isArray(row.categories) ? row.categories.join(" ").replace(/-/g, " ") : "";
  // Lists can hold 70+ countries: keep the cell short
  const where = names.length
    ? `Remote (${names.slice(0, 3).join(", ")}${names.length > 3 ? ` + ${names.length - 3} more` : ""})`
    : "Remote (Worldwide)";
  return {
    ...normalizeJob({
      title: String(row.title || "").trim(),
      company: String(company).trim(),
      location: where,
      site: "himalayas",
      listing_type: row.employmentType || "",
      date_posted: toIso(row.pubDate),
      is_remote: true,
      job_url: row.guid || row.applicationLink || "",
      job_url_direct: direct,
      description: `${stripHtml(row.description || row.excerpt || "").replace(/\s*Originally posted on Himalayas\.?\s*$/i, "")} ${categories}`.trim(),
    }),
    _id: String(row.guid || row.applicationLink || `${row.title}|${company}`),
    _expires: toIso(row.expiryDate),
    _where: {
      workplace: null,
      listedIn: null,
      open,
      emptyOpen: "world",
      utc: utcWindow(row.timezoneRestrictions),
      remoteOnly: true,
    },
  };
}

export async function run(ctx) {
  const { opts } = ctx;
  const hoursOld = opts.preset?.hoursOld || 24;
  const maxPages = MAX_PAGES.find(([hours]) => hoursOld <= hours)[1];
  const titles = String(opts.title || "").split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  const type = employmentType(opts.jobType);

  for (let page = 1; page <= maxPages && !ctx.enough(); page++) {
    ctx.progress(`Himalayas page ${page} (${ctx.report.kept} kept)…`);
    const params = new URLSearchParams({ sort: "recent", page: String(page) });
    if (titles.length === 1) params.set("q", titles[0]);
    if (opts.home) params.set("country", opts.home);
    if (type) params.set("employment_type", type);
    const data = await ctx.http.json(`${BASE}/jobs/api/search?${params}`);
    const rows = expectArray(data, "jobs", "Himalayas search");
    if (!rows.length) break;
    ctx.accept(rows.map(toJob));

    // Newest first, but the tail of a result set isn't: stop only when a whole page is old
    const dated = rows.map((r) => toIso(r.pubDate)).filter(Boolean);
    if (dated.length && dated.every((d) => !withinHours(d, hoursOld))) break;
    const total = Number(data.totalCount);
    if (Number.isFinite(total) && page * PER_PAGE >= total) break;
  }
}
