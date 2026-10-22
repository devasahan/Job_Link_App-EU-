/**
 * Arc.dev — remote developer jobs; applying needs a free Arc profile. There
 * is no public API: the listing pages are Next.js and carry their data in
 * __NEXT_DATA__ (⚠ unverified live, fragile):
 *   GET /remote-jobs[?page=N]
 *   props.pageProps.arcJobs       Arc's own listings
 *   props.pageProps.externalJobs  jobs Arc found on other sites
 * Fields seen in open-source parsers: title, company { name },
 * requiredCountries (ISO codes; empty = anyone, anywhere), postedAt (epoch
 * seconds), jobType, categories, salary, and a url or slug. The data moves
 * between releases, so when those two keys are missing the adapter takes
 * every array of job-like objects in the page data, and with none it fails
 * with "unexpected response (keys: …)" naming what pageProps holds. Every
 * field is read defensively (seconds, milliseconds or ISO dates; codes or
 * { code, name } countries; a company object or a name).
 * An empty requiredCountries means worldwide on Arc's own listings; on
 * external ones Arc only copied what the other site said, so the posting's
 * text decides. Pages may not be sorted by date: paging stops when a whole
 * page is older than the window, a page brings nothing new, or the data
 * says it was the last. One request at a time, 1.5 s apart, robots.txt
 * obeyed (sources.js).
 */

import { normalizeJob, stripHtml, withinHours } from "../util.js";
import { SourceError, expectArray, isBlockedResponse, shortUrl } from "../http.js";
import { nextData } from "../formats/embedded.js";

const BASE = "https://arc.dev";
const LIST_PATH = "/remote-jobs";
const MAX_PAGES = [
  [24, 5],
  [72, 8],
  [168, 12],
  [Infinity, 20],
];
const KNOWN_LISTS = ["arcJobs", "externalJobs"];
// Nodes looked at when searching the page data for job lists
const MAX_NODES = 50000;

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const list = (v) => (Array.isArray(v) ? v.filter((x) => x != null && x !== "") : []);
/** A name from a string or an object ({ name }, { label }, { title }). */
const nameOf = (v) => str(v) || (v && typeof v === "object" ? str(v.name) || str(v.label) || str(v.title) || str(v.displayName) : "");

/** Seconds, milliseconds, a numeric string or an ISO date, as ISO; "" when unreadable. */
export function toIso(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (Number.isFinite(n)) return n > 0 ? new Date(n > 1e12 ? n : n * 1000).toISOString() : "";
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

/** A job-like object: a title and something only a job has. */
function looksLikeJob(v) {
  if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.title !== "string") return false;
  return ["company", "companyName", "postedAt", "requiredCountries", "jobType", "randomKey"].some((k) => k in v);
}

/**
 * Every array of job-like objects under `root`, breadth first, as
 * [{ key, rows }]: what to read when the known keys moved. An array that
 * holds jobs isn't searched further (a job's own lists aren't more jobs).
 */
export function jobArrays(root, { maxNodes = MAX_NODES } = {}) {
  const out = [];
  const queue = [[root, ""]];
  for (let n = 0; n < queue.length && n < maxNodes; n++) {
    const [value, key] = queue[n];
    if (Array.isArray(value) && value.slice(0, 5).some(looksLikeJob)) {
      out.push({ key, rows: value });
      continue;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) if (v && typeof v === "object") queue.push([v, k]);
    }
  }
  return out;
}

let regionNames = null;
/** "US" → "United States" for the Location cell; the code when the runtime can't say. */
function countryName(code) {
  try {
    regionNames ||= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

/** "hybrid" | "onsite" | "remote" from the row's own field, or null when it says nothing. */
function workplaceOf(row) {
  const said = [row.workplaceType, row.locationType, row.remoteType, row.workType, row.workArrangement].map(nameOf).find(Boolean) || "";
  if (/hybrid/i.test(said)) return "hybrid";
  // "Remote or office" can be done remotely
  if (/remote/i.test(said)) return "remote";
  if (/on[\s_-]?site|office/i.test(said)) return "onsite";
  if (row.isRemote === false || row.remote === false) return "onsite";
  return null;
}

function employmentType(row) {
  const t = nameOf(row.jobType) || nameOf(row.employmentType) || nameOf(row.type);
  if (/^full[\s_-]?time$/i.test(t)) return "Full Time";
  if (/^part[\s_-]?time$/i.test(t)) return "Part Time";
  if (/^(?:contract|freelance|contractor)$/i.test(t)) return "Contract";
  return t;
}

/** An https link on arc.dev or elsewhere, or "". */
function absolute(value) {
  const s = str(value);
  if (!s) return "";
  try {
    const u = new URL(s, BASE);
    return u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

const onArc = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === "arc.dev";
  } catch {
    return false;
  }
};

/**
 * The job's page and its outside apply link: a url field, a path, or a slug
 * under /remote-jobs/j/. With none, no link: the listing page it was found
 * on is every such job's page, and history and the merge would take them
 * all for one job.
 */
function linksOf(row) {
  const given = [row.url, row.jobUrl, row.link, row.href, row.path, row.applyUrl, row.applicationUrl, row.externalUrl]
    .map(absolute)
    .filter(Boolean);
  const slug = str(row.slug) || str(row.jobSlug);
  const fromSlug = slug ? absolute(slug.includes("/") ? slug : `${LIST_PATH}/j/${encodeURIComponent(slug)}`) : "";
  const page = given.find(onArc) || fromSlug;
  const elsewhere = given.find((u) => !onArc(u)) || "";
  // An external job's only link is its page: no separate direct link
  return page ? { url: page, direct: elsewhere } : { url: elsewhere, direct: "" };
}

/** One row of arcJobs or externalJobs (or a job list found elsewhere) as a job. */
export function toJob(row, { external = false } = {}) {
  const countries = list(row.requiredCountries ?? row.countries)
    .map((c) => str(c) || (c && typeof c === "object" ? str(c.code) || str(c.alpha2) || str(c.isoCode) || str(c.name) : ""))
    .filter(Boolean);
  const place = nameOf(row.location) || str(row.locationText) || str(row.locationName);
  const company = nameOf(row.company) || str(row.companyName);
  const { url, direct } = linksOf(row);
  const categories = [...list(row.categories), ...list(row.primarySkills), ...list(row.skills), ...list(row.tags)].map(nameOf).filter(Boolean);
  const workplace = workplaceOf(row);
  // Codes or names the readers know; a location naming places stands in for an empty list
  const placeNamed = (text) => {
    const read = globalThis.jbReadPlaces(text);
    return read.codes.length > 0 || read.outside.length > 0;
  };
  const open = countries.length ? countries : place && placeNamed(place) ? [place] : [];
  const names = countries.map((c) => (/^[A-Za-z]{2}$/.test(c) ? countryName(c.toUpperCase()) : c));
  const location = names.length
    ? `Remote (${names.slice(0, 3).join(", ")}${names.length > 3 ? ` + ${names.length - 3} more` : ""})`
    : place
      ? /remote|hybrid|on[\s-]?site|office/i.test(place)
        ? place
        : `Remote (${place})`
      : external
        ? "Remote"
        : "Remote (Worldwide)";
  const years = Number(row.minYearsOfExperience ?? row.yearsOfExperience ?? row.minExperience);
  // Rows with no id or link are told apart by title and company
  const key = str(row.id) || str(row.randomKey) || str(row.uuid) || url || `${str(row.title)}|${company}`;
  return {
    ...normalizeJob({
      title: str(row.title),
      company,
      location,
      site: "arc",
      listing_type: employmentType(row),
      date_posted: toIso(row.postedAt ?? row.publishedAt ?? row.createdAt ?? row.datePosted),
      is_remote: workplace ? workplace === "remote" : true,
      job_url: url,
      job_url_direct: direct,
      description: `${stripHtml(str(row.description) || str(row.descriptionHtml) || str(row.summary) || str(row.intro))} ${categories.join(" ")}`.trim(),
      ...(Number.isFinite(years) && years > 0 ? { years_required: years } : {}),
    }),
    _id: `${external ? "ext" : "arc"}:${key}`,
    _where: {
      workplace,
      listedIn: null,
      open,
      emptyOpen: external ? null : "world",
      utc: null,
      remoteOnly: workplace ? workplace === "remote" : true,
    },
    ...(company ? {} : { anonymous: true }),
  };
}

/** What the page says about the last page, or NaN. */
function lastPage(props) {
  const p = props?.pagination || props?.pageInfo || props?.meta || {};
  return Number(props?.totalPages ?? props?.pageCount ?? p.totalPages ?? p.pageCount ?? p.lastPage);
}

/**
 * The page's job lists as [{ external, rows }], or a format error saying
 * what came back instead.
 */
export function readPage(html, page = 1) {
  const what = `Arc.dev page ${page}`;
  let data;
  try {
    data = nextData(html);
  } catch (err) {
    throw new SourceError("format", `unexpected response from ${what} (${err.message})`);
  }
  if (!data) {
    let parsed = null;
    try {
      parsed = JSON.parse(html);
    } catch {
      parsed = null;
    }
    // Next.js's JSON for the page ({ pageProps }) reads the same; any other JSON says what it holds
    if (parsed?.pageProps) data = { props: parsed };
    else if (parsed?.props?.pageProps) data = parsed;
    else if (parsed && typeof parsed === "object") expectArray(parsed, "props.pageProps.arcJobs", what);
    else {
      const why = /self\.__next_f/.test(html) ? "Next.js app-router data, no __NEXT_DATA__" : `no __NEXT_DATA__ in ${/^\s*</.test(html) ? "the HTML" : "the answer"}`;
      throw new SourceError("format", `unexpected response from ${what} (${why})`);
    }
  }
  const props = data.props?.pageProps;
  const scope = props && typeof props === "object" ? props : data;
  const known = KNOWN_LISTS.filter((k) => Array.isArray(props?.[k]));
  // The known keys hold jobs by name; a list found elsewhere only when its rows look like jobs
  const lists = known.length
    ? known.map((k) => ({ key: k, rows: props[k].filter((row) => row && typeof row.title === "string") }))
    : jobArrays(scope).map(({ key, rows }) => ({ key, rows: rows.filter(looksLikeJob) }));
  // Nothing job-like anywhere: name pageProps's keys for the report
  if (!lists.length) expectArray(scope, "arcJobs", what);
  return {
    lists: lists.map(({ key, rows }) => ({ external: /external/i.test(key), rows })),
    last: lastPage(props),
  };
}

export async function run(ctx) {
  const hoursOld = ctx.opts.preset?.hoursOld || 24;
  const maxPages = MAX_PAGES.find(([hours]) => hoursOld <= hours)[1];
  const seen = new Set();

  for (let page = 1; page <= maxPages && !ctx.enough(); page++) {
    ctx.progress(`Arc.dev page ${page} (${ctx.report.kept} kept)…`);
    const url = page === 1 ? `${BASE}${LIST_PATH}` : `${BASE}${LIST_PATH}?page=${page}`;
    // A page past the last one may be a 404: the end, not a failure
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, allow: page > 1 ? [404] : [] });
    if (res.status === 404) break;
    if (isBlockedResponse(res.status, res.text) && /<html|<!doctype/i.test(res.text.slice(0, 400))) {
      throw new SourceError("blocked", `a challenge page at ${shortUrl(url)}`, { status: res.status, url });
    }
    const { lists, last } = readPage(res.text, page);
    const jobs = lists.flatMap(({ external, rows }) => rows.map((row) => toJob(row, { external })));
    if (!jobs.length) break;
    // The same jobs again: the site ignores the page number
    const fresh = jobs.filter((j) => !seen.has(j._id));
    if (!fresh.length) break;
    for (const j of fresh) seen.add(j._id);
    ctx.accept(jobs);

    if (Number.isFinite(last) && page >= last) break;
    // Not sorted for sure: stop only when a whole page is past the window
    const dated = jobs.map((j) => j.date_posted).filter(Boolean);
    if (dated.length && dated.every((d) => !withinHours(d, hoursOld))) break;
  }
}
