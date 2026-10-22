/**
 * Jobicy — free public JSON API (no key), remote-only board.
 * https://github.com/Jobicy/remote-jobs-api
 *   GET /api/jobs?count=1-200&geo=<slug>&cursor=<nextCursor>
 *   GET /api/v2/remote-jobs?count=1-100&geo=<slug>  (the older path, no cursor:
 *   tried when /api/jobs is a 404)
 * Unknown parameters are rejected with 400, so only documented ones are sent:
 * no `tag` (a raw substring match, "rust" finds "trust") and no `industry`;
 * titles are checked here. The request never depends on the run's options,
 * so one answer serves every run for an hour: Jobicy asks for no automated
 * polling more than once an hour, and each answer is cached that long.
 * Regions asked: europe, emea and anywhere, plus the country's own slug with
 * You live in set (Luxembourg and Malta have none). A job listed under
 * several regions comes back in each and is counted once.
 * Newest first; the feed covers about the last 7 days, and listings show up a
 * few hours after their pubDate ("2026-10-21 10:22:48", UTC). Jobicy also
 * re-publishes older listings with a fresh pubDate.
 * Where a job is open: `jobGeo` ("Europe", "Germany, Austria, Switzerland",
 * "USA, Canada", "Anywhere" = worldwide), read by open-to.js as the board's
 * "who may apply" list.
 * Terms: credit Jobicy (the sheet's Site column) and link to the Jobicy job
 * page (kept as job_url, without tracking parameters).
 */

import { normalizeJob, stripHtml, withinHours } from "../util.js";
import { expectArray, SourceError } from "../http.js";

const BASE = "https://jobicy.com";
// The newer path first; each page size is that path's maximum
const PATHS = [
  { path: "/api/jobs", count: 200, cursor: true },
  { path: "/api/v2/remote-jobs", count: 100, cursor: false },
];
const REGIONS = ["europe", "emea", "anywhere"];
// Jobicy's geo slugs for the popup's countries (none for Luxembourg or Malta)
const SLUGS = {
  AT: "austria",
  BE: "belgium",
  BG: "bulgaria",
  HR: "croatia",
  CY: "cyprus",
  CZ: "czechia",
  DK: "denmark",
  EE: "estonia",
  FI: "finland",
  FR: "france",
  DE: "germany",
  GR: "greece",
  HU: "hungary",
  IE: "ireland",
  IT: "italy",
  LV: "latvia",
  LT: "lithuania",
  NL: "netherlands",
  PL: "poland",
  PT: "portugal",
  RO: "romania",
  SK: "slovakia",
  SI: "slovenia",
  ES: "spain",
  SE: "sweden",
  NO: "norway",
  CH: "switzerland",
};
const MAX_PAGES_PER_GEO = 5;
const CACHE_MS = 60 * 60e3;
// "Anywhere" is Jobicy's word for worldwide; open-to.js reads "Worldwide"
const ANYWHERE_RE = /^(?:anywhere|worldwide|global)$/i;

/** The regions to ask, the user's own country after Europe. */
export function geosFor(home) {
  const own = SLUGS[String(home || "").toUpperCase()];
  return own ? ["europe", own, "emea", "anywhere"] : [...REGIONS];
}

/** "2026-10-21 10:22:48" (UTC), an ISO date, or seconds / milliseconds → ISO; "" when unreadable. */
export function toIso(value) {
  if (value == null || value === "") return "";
  const s = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 0 ? new Date(n > 1e12 ? n : n * 1000).toISOString() : "";
  }
  // No zone in Jobicy's own format: its feed's RFC 822 dates say +0000
  const plain = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  const t = Date.parse(plain ? `${plain[1]}T${plain[2]}Z` : s);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

/** The Jobicy job page without tracking parameters, or one built from the slug. */
export function jobUrl(row) {
  try {
    const u = new URL(String(row.url || ""));
    if (u.hostname === "jobicy.com" || u.hostname.endsWith(".jobicy.com")) {
      u.protocol = "https:";
      u.search = "";
      u.hash = "";
      return u.href;
    }
  } catch {
    // no usable url: build it
  }
  return row.jobSlug ? `${BASE}/jobs/${encodeURIComponent(String(row.jobSlug))}` : "";
}

/** jobGeo split into places: "Germany, Austria & Switzerland" → three, "Anywhere" → "Worldwide". */
export function geoPlaces(jobGeo) {
  return String(jobGeo || "")
    .split(/\s*[,;/|]\s*|\s+(?:and|&)\s+/i)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => (ANYWHERE_RE.test(p) ? "Worldwide" : p));
}

/** A job on jobicy.com, from one API row. */
export function toJob(row) {
  const places = geoPlaces(row.jobGeo);
  const shown = String(row.jobGeo || "").replace(/\s+/g, " ").trim();
  const title = String(row.jobTitle || "").trim();
  const company = String(row.companyName || "").trim();
  return {
    ...normalizeJob({
      title,
      company,
      location: shown ? `Remote (${shown})` : "Remote",
      site: "jobicy",
      listing_type: Array.isArray(row.jobType) ? row.jobType.join(", ") : String(row.jobType || ""),
      date_posted: toIso(row.pubDate),
      is_remote: true,
      job_url: jobUrl(row),
      description: stripHtml(row.jobDescription || row.jobExcerpt || ""),
    }),
    _id: String(row.id ?? row.jobSlug ?? row.url ?? `${title}|${company}`),
    _where: {
      workplace: null,
      listedIn: null,
      // No jobGeo at all: the posting's text decides (rule 7)
      open: places.length ? places : null,
      emptyOpen: null,
      utc: null,
      remoteOnly: true,
    },
  };
}

// What the cache keeps of a row: what toJob reads (logos and excerpts are most of the rest)
const slim = (row) => ({
  id: row.id,
  url: row.url,
  jobSlug: row.jobSlug,
  jobTitle: row.jobTitle,
  companyName: row.companyName,
  jobType: row.jobType,
  jobGeo: row.jobGeo,
  pubDate: row.pubDate,
  jobDescription: row.jobDescription || row.jobExcerpt || "",
});

/**
 * One page of one region: { rows, nextCursor }. `api.at` is the path that
 * answers, kept for the rest of the run once /api/jobs turns out to be gone.
 */
async function fetchPage(ctx, api, geo, cursor) {
  for (;;) {
    const { path, count } = PATHS[api.at];
    const params = new URLSearchParams({ count: String(count), geo });
    if (cursor) params.set("cursor", cursor);
    let data;
    try {
      data = await ctx.http.json(`${BASE}${path}?${params}`);
    } catch (err) {
      if (err?.status === 404 && !cursor && api.at + 1 < PATHS.length) {
        api.at += 1;
        continue;
      }
      throw err;
    }
    if (data && data.success === false) {
      throw new SourceError("format", `Jobicy refused geo=${geo}: ${data.error || data.message || "no reason given"}`);
    }
    const rows = expectArray(data, "jobs", "Jobicy");
    return {
      rows: rows.filter(Boolean).map(slim),
      nextCursor: PATHS[api.at].cursor && data.nextCursor ? String(data.nextCursor) : "",
    };
  }
}

export async function run(ctx) {
  const { opts } = ctx;
  const hoursOld = opts.preset?.hoursOld || 24;
  const api = { at: 0 };

  for (const geo of geosFor(opts.home)) {
    let cursor = "";
    for (let page = 1; page <= MAX_PAGES_PER_GEO && !ctx.enough(); page++) {
      ctx.progress(`Jobicy ${geo} page ${page} (${ctx.report.kept} kept)…`);
      // Keyed by page, not cursor (a few keys at most), and only good after the same page before it
      const key = `${geo}|${page}`;
      let answer = await ctx.cache.get(key);
      try {
        if (!Array.isArray(answer?.rows) || answer.cursor !== cursor) {
          answer = { cursor, ...(await fetchPage(ctx, api, geo, cursor)) };
          await ctx.cache.set(key, answer, CACHE_MS);
        }
      } catch (err) {
        // A region Jobicy doesn't know (HTTP 400) leaves the others; anything else ends the source
        if (err?.status !== 400) throw err;
        ctx.fail(new SourceError("http", `geo=${geo}: ${err.message}`, { status: 400, url: err.url }));
        break;
      }
      const { rows, nextCursor } = answer;
      ctx.accept(rows.map(toJob));
      // Newest first: once the last row is older than the window, the rest are too
      const last = rows[rows.length - 1];
      if (!rows.length || !nextCursor || (last && !withinHours(toIso(last.pubDate), hoursOld))) break;
      cursor = nextCursor;
    }
    if (ctx.enough()) break;
  }
}
