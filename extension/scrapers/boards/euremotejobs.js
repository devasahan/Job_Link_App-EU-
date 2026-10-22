/**
 * EU Remote Jobs — remote jobs for people in Europe (WordPress with the WP
 * Job Manager plugin). Reads the plugin's job feed (⚠ unverified live):
 *   GET /?feed=job_feed&posts_per_page=50[&paged=N]
 * RSS 2.0, newest first. Each <item>: title, link, pubDate, guid, description
 * (an excerpt), content:encoded (the posting), and the plugin's own fields
 * job_listing:location ("EMEA", "Worldwide", "Europe, Netherlands"),
 * job_listing:company and job_listing:job_type ("Full Time", "Freelance").
 * When the feed is missing or isn't a feed, page 1 falls back to the
 * WordPress REST API (⚠ unverified too):
 *   GET /wp-json/wp/v2/job-listings?per_page=50&page=N&_embed=wp:term
 * rows with title.rendered, link, guid.rendered (the feed's guid, so ids
 * match), date_gmt, content.rendered, the plugin's meta (_job_location,
 * _company_name, _application, _job_expires, _filled) and the job types as
 * embedded terms. A page past the last one is a 404 (feed) or a 400 (REST),
 * which ends the paging instead of failing the source.
 * Where a job is open: its location, as the board's "who may apply" list.
 * The board is for Europe, so no location (or a bare "Remote") means Europe,
 * "Anywhere" the world, and a place the readers don't know ("Berlin") leaves
 * it to the posting's text. robots.txt is obeyed (sources.js: robots "obey").
 */

import { normalizeJob, stripHtml, withinHours } from "../util.js";
import { SourceError, expectArray, isBlockedResponse, shortUrl } from "../http.js";
import { parseFeed, feedDate, decodeEntities } from "../formats/feed.js";

const BASE = "https://euremotejobs.com";
const HOST = "euremotejobs.com";
const PER_PAGE = 50;
// Pages of 50, newest first: the date check ends most runs on page 1 or 2
const MAX_PAGES = [
  [24, 3],
  [72, 6],
  [168, 10],
  [Infinity, 16],
];

// A location that names no place: the board's default, Europe
const NOWHERE_RE = /^(?:(?:100\s*%|fully)\s+)?(?:remote|remote[\s-]first|work\s+from\s+home|wfh|n\/a|tbd|various|flexible)$/i;
// "Anywhere", "Remote - Anywhere", "Anywhere in the world": open worldwide
const ANYWHERE_RE = /^(?:remote\s*[-–,:(]?\s*)?anywhere(?:\s+in\s+the\s+world)?\)?$/i;
// Location words that already say how the job is done
const WORKPLACE_RE = /remote|hybrid|on[\s-]?site|office/i;

/** The location as a Where: the board's "who may apply" list, empty meaning Europe. */
export function whereOf(location) {
  const text = String(location || "").replace(/\s+/g, " ").trim();
  const where = { workplace: null, listedIn: null, open: [], emptyOpen: "europe", utc: null, remoteOnly: true };
  if (!text || NOWHERE_RE.test(text)) return where;
  if (ANYWHERE_RE.test(text)) return { ...where, open: ["Worldwide"] };
  const read = globalThis.jbReadPlaces(text);
  // A city or a place the readers don't know: the posting's text decides (open-to.js rule 7)
  if (!read.codes.length && !read.outside.length) return { ...where, open: null };
  return { ...where, open: [text] };
}

/** The Location cell: "Remote (EMEA)", or the board's words when they say how. */
function shownLocation(location) {
  const text = String(location || "").replace(/\s+/g, " ").trim();
  if (!text) return "Remote (Europe)";
  return WORKPLACE_RE.test(text) ? text : `Remote (${text})`;
}

const isWeb = (url) => /^https?:\/\//i.test(String(url || ""));

/** The apply link when it leads off the board (an e-mail address doesn't). */
function directLink(apply) {
  if (!isWeb(apply)) return "";
  try {
    return new URL(apply).hostname.replace(/^www\./, "") === HOST ? "" : apply;
  } catch {
    return "";
  }
}

function toJob({ id, title, company, location, type, url, date, html, apply = "", expires = "", categories = [] }) {
  const name = String(company || "").trim();
  return {
    ...normalizeJob({
      title: String(title || "").trim(),
      company: name,
      location: shownLocation(location),
      site: "euremotejobs",
      listing_type: type,
      date_posted: date,
      is_remote: true,
      job_url: url,
      job_url_direct: directLink(apply),
      description: `${stripHtml(html)} ${categories.join(" ")}`.trim(),
    }),
    _id: String(id || url),
    _expires: expires,
    _where: whereOf(location),
    // No employer named: the merge across sources uses the link
    ...(name ? {} : { anonymous: true }),
  };
}

/** One feed <item> (formats/feed.js) as a job. */
export function fromFeedItem(item) {
  const f = item.fields || {};
  return toJob({
    id: item.guid || item.link,
    title: item.title,
    company: f["job_listing:company"],
    location: f["job_listing:location"],
    // One element with every type, or one per type, depending on the plugin's version
    type: (item.values?.["job_listing:job_type"] || []).filter(Boolean).join(", "),
    url: item.link,
    date: feedDate(item.date),
    html: item.content || item.description,
    categories: item.categories || [],
  });
}

/** "2026-10-21T10:00:00" (WordPress's date_gmt has no zone) as ISO, or "". */
function restDate(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  return feedDate(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
}

const truthy = (v) => v === true || v === 1 || v === "1" || v === "yes";
const plain = (v) => decodeEntities(stripHtml(typeof v === "object" && v ? v.rendered : v));

/** One REST row (wp/v2/job-listings) as a job. */
export function fromRestRow(row) {
  const meta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : {};
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const terms = (row._embedded?.["wp:term"] || []).flat().filter((t) => t && typeof t === "object");
  const termNames = (taxonomy) => terms.filter((t) => t.taxonomy === taxonomy).map((t) => decodeEntities(t.name || ""));
  const date = restDate(row.date_gmt) || restDate(row.date);
  // "2026-11-20": open to the end of that day. A filled job counts as expired.
  const until = String(one(meta._job_expires) || "").trim();
  const expires = truthy(one(meta._filled))
    ? restDate(row.modified_gmt) || date || new Date(0).toISOString()
    : /^\d{4}-\d{2}-\d{2}$/.test(until)
      ? `${until}T23:59:59Z`
      : "";
  return toJob({
    id: plain(row.guid) || row.link || row.id,
    title: plain(row.title),
    company: decodeEntities(String(one(meta._company_name) || "")),
    location: decodeEntities(String(one(meta._job_location) || "")),
    type: termNames("job_listing_type").join(", "),
    url: row.link,
    date,
    html: row.content?.rendered || row.excerpt?.rendered || "",
    apply: String(one(meta._application) || ""),
    expires,
    categories: termNames("job_listing_category"),
  });
}

/** What came back instead of a feed, for the message. */
function whatIs(text) {
  const s = String(text || "").trimStart();
  if (!s) return "an empty answer";
  if (s[0] === "{" || s[0] === "[") return "JSON";
  return s[0] === "<" ? "HTML" : "text";
}

/** One page's body; past the last page (404 on page 2+) null. A challenge page is blocked. */
async function pageText(ctx, url, page) {
  const res = await ctx.http.get(url, { headers: { accept: "application/rss+xml, application/xml, text/xml" }, allow: page > 1 ? [404] : [] });
  if (res.status === 404) return null;
  if (isBlockedResponse(res.status, res.text) && /<html|<!doctype/i.test(res.text.slice(0, 400))) {
    throw new SourceError("blocked", `a challenge page at ${shortUrl(url)}`, { status: res.status, url });
  }
  return res.text;
}

async function feedPage(ctx, page) {
  const params = new URLSearchParams({ feed: "job_feed", posts_per_page: String(PER_PAGE) });
  if (page > 1) params.set("paged", String(page));
  const text = await pageText(ctx, `${BASE}/?${params}`, page);
  if (text == null) return null;
  const feed = parseFeed(text);
  if (!feed.kind) throw new SourceError("format", `unexpected response from the job feed (${whatIs(text)}, not RSS)`);
  return feed.items.filter((item) => item.title && isWeb(item.link)).map(fromFeedItem);
}

async function restPage(ctx, page) {
  const params = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page), _embed: "wp:term" });
  const data = await ctx.http.json(`${BASE}/wp-json/wp/v2/job-listings?${params}`, { allow: page > 1 ? [400, 404] : [] });
  // { code: "rest_post_invalid_page_number" }: past the last page
  if (page > 1 && data && !Array.isArray(data) && /invalid_page|not_found|no_route/i.test(String(data.code || ""))) return null;
  const rows = expectArray(data, "", "the WordPress API");
  return rows.filter((row) => row && typeof row === "object" && isWeb(row.link)).map(fromRestRow);
}

// Worth asking the REST API when the feed fails: not when stopped or rate-limited
const tryRest = (err) => err?.kind !== "aborted" && !(err?.kind === "blocked" && err?.status === 429);

/** Page 1 from the feed, or from the REST API when the feed fails: { jobs, mode }. */
async function firstPage(ctx) {
  try {
    return { jobs: await feedPage(ctx, 1), mode: "feed" };
  } catch (err) {
    if (!tryRest(err)) throw err;
    ctx.note(`EU Remote Jobs: the job feed failed (${err.message}); trying the WordPress API`);
    try {
      return { jobs: await restPage(ctx, 1), mode: "rest" };
    } catch (second) {
      if (second?.kind === "aborted") throw second;
      // The feed's error leads: it is the usual way in, and what the report's kind says
      throw new SourceError(err.kind || "error", `${err.message}; fallback: ${second?.message || second}`, {
        status: err.status,
        url: err.url,
      });
    }
  }
}

export async function run(ctx) {
  const hoursOld = ctx.opts.preset?.hoursOld || 24;
  const maxPages = MAX_PAGES.find(([hours]) => hoursOld <= hours)[1];
  const seen = new Set();
  let mode = "feed";

  for (let page = 1; page <= maxPages && !ctx.enough(); page++) {
    ctx.progress(`EU Remote Jobs page ${page} (${ctx.report.kept} kept)…`);
    let jobs;
    if (page === 1) ({ jobs, mode } = await firstPage(ctx));
    else jobs = mode === "feed" ? await feedPage(ctx, page) : await restPage(ctx, page);
    if (!jobs?.length) break;
    // The same jobs again: the site ignores the page number
    const fresh = jobs.filter((j) => !seen.has(j._id));
    if (!fresh.length) break;
    for (const j of fresh) seen.add(j._id);
    ctx.accept(jobs);

    // Newest first: once a page ends past the window, later pages are older still
    const last = jobs[jobs.length - 1].date_posted;
    if (last && !withinHours(last, hoursOld)) break;
  }
}
