/**
 * Indeed scraper — one GraphQL search per selected country (the indeed-co
 * header picks the country's Indeed site), remote jobs only: the remote
 * attribute (DSQF7) without the hybrid one (PAXZC), as JobSpy does.
 * The posted-date window is applied on Indeed's side (dateOnIndeed) and again
 * here. If Indeed rejects that filter list, the run falls back to the remote
 * filter alone (the US version's) and the rest is checked here.
 * The job type is read from attribute keys here, not sent to Indeed: keys in
 * one filter must all be present, contract keys differ by country, and jobs
 * that never state a type stay.
 * Country codes, subdomains and locales follow JobSpy's jobspy/indeed/constant.py.
 */

import {
  normalizeJob,
  formatLocation,
  stripHtml,
  resolveDatePreset,
  filterByRequest,
  yearsFromExperienceLabels,
  requiredYearsFromText,
  withinHours,
  sleep,
} from "./util.js";
import { readJson } from "./http.js";
import { countryName } from "./countries.js";

const API_URL = "https://apis.indeed.com/graphql";

/** Countries with an Indeed site → its subdomain (uk.indeed.com, de.indeed.com, …). */
export const INDEED_SITES = {
  AT: "at",
  BE: "be",
  CZ: "cz",
  DK: "dk",
  FI: "fi",
  FR: "fr",
  DE: "de",
  GR: "gr",
  HU: "hu",
  IE: "ie",
  IT: "it",
  LU: "lu",
  NL: "nl",
  PL: "pl",
  PT: "pt",
  RO: "ro",
  ES: "es",
  SE: "se",
  NO: "no",
  CH: "ch",
  GB: "uk",
};

// indeed-locale is "<language>-<country>"; countries not listed use English
const LANGUAGES = {
  AT: "de",
  BE: "nl",
  CH: "de",
  CZ: "cs",
  DE: "de",
  DK: "da",
  ES: "es",
  FI: "fi",
  FR: "fr",
  GR: "el",
  HU: "hu",
  IT: "it",
  LU: "fr",
  NL: "nl",
  NO: "nb",
  PL: "pl",
  PT: "pt",
  RO: "ro",
  SE: "sv",
};

const HEADERS = {
  "content-type": "application/json",
  "indeed-api-key":
    "161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8",
  accept: "application/json",
  "accept-language": "en-US,en;q=0.9",
  "indeed-app-info":
    "appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone",
};

// Location codes Indeed writes differently from ISO 3166 (JobSpy maps "SL" to Slovenia)
const COUNTRY_ALIASES = { SL: "SI", UK: "GB", EL: "GR" };

const REMOTE_KEY = "DSQF7";
const HYBRID_KEY = "PAXZC";
// Attribute keys are the same on every Indeed site; their labels are translated
// (JobSpy constant.py, omkarcloud/indeed-scraper refdata.py)
const TYPE_LABELS = {
  CF3CP: "Full-time",
  NJXCK: "Contract",
  T9BXE: "Contract",
  T65DZ: "Contract",
  ZG59D: "Freelance",
  V7KSJ: "Contract",
  "7SBAT": "Contract-to-hire",
  "5QWDV": "Permanent",
  "75GKK": "Part-time",
  VDTG7: "Internship",
  CPAHG: "Apprenticeship",
  "4HKF7": "Temporary",
  CJWTS: "Temporary",
  "9SYVT": "Seasonal",
  TQKYQ: "Per diem",
  UXQZ8: "Volunteer",
};

// With no Title, boards are searched for marketing; where the local word
// differs, that word is searched too
const DEFAULT_TERMS = ["marketing"];
const LOCAL_TERMS = {
  DK: ["markedsføring"],
  FI: ["markkinointi"],
  GR: ["μάρκετινγκ"],
  NO: ["markedsføring"],
  SE: ["marknadsföring"],
};

const PAGE_PAUSE_MS = 500;
const COUNTRY_PAUSE_MS = 1000;
const REQUEST_TIMEOUT_MS = 20000;

const QUERY_TMPL = `
query GetJobData {
  jobSearch(
    {{WHAT}}
    limit: 100
    {{CURSOR}}
    sort: DATE
    {{FILTERS}}
  ) {
    pageInfo { nextCursor }
    results {
      job {
        key
        title
        datePublished
        dateOnIndeed
        description { html }
        location {
          city
          admin1Code
          countryCode
          formatted { long }
        }
        employer { name }
        attributes { key label }
        recruit { viewJobUrl }
      }
    }
  }
}
`;

const keyword = (keys, match = "") =>
  `{ keyword: { field: "attributes", keys: [${keys.map((k) => `"${k}"`).join(", ")}]${match} } }`;

/**
 * "list": date window, remote and not hybrid, all applied by Indeed (a list
 * of filters must all match; JobSpy since Sep 2026).
 * "legacy": the remote filter alone, the shape the US version used.
 */
export function buildFilters(style, { hoursOld }) {
  if (style === "legacy") {
    return `filters: { composite: { filters: [${keyword([REMOTE_KEY])}] } }`;
  }
  const filters = [
    `{ date: { field: "dateOnIndeed", start: "${hoursOld}h" } }`,
    keyword([REMOTE_KEY]),
    keyword([HYBRID_KEY], ", match: MUST_NOT"),
  ];
  return `filters: [${filters.join(", ")}]`;
}

export function buildQuery(whatTerm, cursor, filters) {
  // JSON string escaping is valid GraphQL string escaping, so quotes and
  // backslashes in the input are safe
  const term = (whatTerm || "").trim();
  const what = term ? `what: ${JSON.stringify(term)}` : "";
  const cursorPart = cursor ? `cursor: ${JSON.stringify(cursor)}` : "";
  return QUERY_TMPL.replace("{{WHAT}}", what)
    .replace("{{CURSOR}}", cursorPart)
    .replace("{{FILTERS}}", filters);
}

export function requestHeaders(country) {
  return {
    ...HEADERS,
    "indeed-co": country,
    "indeed-locale": `${LANGUAGES[country] || "en"}-${country}`,
  };
}

/**
 * What to search on one country's Indeed: each comma-separated title (plus
 * the skills, so Indeed checks them on the whole posting), or marketing in
 * English and the local language when there is no title.
 */
export function searchTerms(title, skills, country) {
  const titles = String(title || "")
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const roles = titles.length ? titles : [...DEFAULT_TERMS, ...(LOCAL_TERMS[country] || [])];
  const extra = String(skills || "").trim();
  return roles.map((role) => [role, extra].filter(Boolean).join(" "));
}

function toDatePosted(ms) {
  if (!ms) return "";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "";
  }
}

/** One Indeed result → a job, or null when it isn't remote after all. */
export function toJob(raw, country) {
  const keys = (raw.attributes || []).map((attr) => attr?.key).filter(Boolean);
  // Indeed already filtered these; a result that slipped through is dropped
  if (keys.length && (!keys.includes(REMOTE_KEY) || keys.includes(HYBRID_KEY))) return null;
  const loc = raw.location || {};
  const labels = (raw.attributes || []).map((attr) => attr?.label).filter(Boolean);
  const listingType = [...new Set(keys.map((k) => TYPE_LABELS[k]).filter(Boolean))].join(", ");
  const description = stripHtml(raw.description?.html);
  const fromLabels = yearsFromExperienceLabels(labels);
  const fromText = requiredYearsFromText(description);
  const yearsRequired =
    fromLabels == null
      ? fromText
      : fromText == null
        ? fromLabels
        : Math.max(fromLabels, fromText);
  const base = `https://${INDEED_SITES[country] || country.toLowerCase()}.indeed.com`;
  const code = String(loc.countryCode || country).toUpperCase();
  return normalizeJob({
    title: raw.title,
    company: raw.employer?.name || "",
    location:
      loc.formatted?.long ||
      formatLocation([loc.city, loc.admin1Code, loc.countryCode]),
    country: COUNTRY_ALIASES[code] || code,
    site: "indeed",
    listing_type: listingType,
    date_posted: toDatePosted(raw.dateOnIndeed || raw.datePublished),
    is_remote: true,
    job_url: `${base}/viewjob?jk=${raw.key}`,
    job_url_direct: raw.recruit?.viewJobUrl || "",
    description,
    years_required: yearsRequired == null ? undefined : yearsRequired,
  });
}

/** Rejected filters (style "list") show up as GraphQL errors without results. */
const filterRejected = (data) =>
  !data?.data?.jobSearch &&
  /filter|date|match|argument|syntax|validation/i.test(JSON.stringify(data?.errors || ""));

/**
 * @param {{
 *   title?: string,
 *   skills?: string,
 *   countries: string[],
 *   resultsWanted: number,
 *   datePreset?: string,
 *   years?: number | "",
 *   jobType?: string,
 *   onProgress?: (msg: string) => void
 * }} opts
 */
export async function scrapeIndeed({
  title,
  skills,
  countries,
  resultsWanted,
  datePreset,
  years,
  jobType,
  onProgress,
}) {
  const preset = resolveDatePreset(datePreset);
  const titleFilter = (title || "").trim();
  const wanted = new Set(countries || []);
  const targets = [...wanted].filter((code) => INDEED_SITES[code]);
  const noSite = [...wanted].filter((code) => !INDEED_SITES[code]);
  if (noSite.length) {
    onProgress?.(`Indeed has no site for ${noSite.map(countryName).join(", ")}: not searched`);
  }
  if (!targets.length) {
    throw new Error("Indeed has no site for the selected countries");
  }

  const matched = [];
  const seen = new Set();
  const failures = [];
  let scanned = 0;
  let elsewhere = 0;
  let style = "list";
  let requests = 0;
  // A country's results are newest first; most windows fit in a page or two
  const MAX_PAGES = 5;

  let lastCountry = "";
  async function fetchPage(country, term, cursor) {
    const post = async () => {
      // One request at a time: a pause between pages, a longer one between countries
      if (requests++) await sleep(country === lastCountry ? PAGE_PAUSE_MS : COUNTRY_PAUSE_MS);
      lastCountry = country;
      const filters = buildFilters(style, { hoursOld: preset.hoursOld });
      const res = await fetch(API_URL, {
        method: "POST",
        headers: requestHeaders(country),
        body: JSON.stringify({ query: buildQuery(term, cursor, filters) }),
        // A stuck request would hold up every country after it
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return { res, data: await readJson(res, "indeed", "Indeed") };
    };
    let { res, data } = await post();
    if (style === "list" && filterRejected(data)) {
      onProgress?.("Indeed rejected the date filter: falling back to the remote filter only");
      style = "legacy";
      ({ res, data } = await post());
    }
    if (!res.ok) {
      throw new Error(`Indeed HTTP ${res.status}: ${data?.errors?.[0]?.message || "request rejected"}`);
    }
    const search = data?.data?.jobSearch;
    if (!search) {
      throw new Error(data?.errors?.[0]?.message || "Indeed returned no jobSearch data");
    }
    return search;
  }

  countries: for (const country of targets) {
    const name = countryName(country);
    const countryMatched = [];
    for (const term of searchTerms(titleFilter, skills, country)) {
      let cursor = null;
      for (let page = 1; page <= MAX_PAGES && countryMatched.length < resultsWanted; page++) {
        onProgress?.(
          `Indeed ${name} "${term}" page ${page} (${preset.label}, ${matched.length + countryMatched.length} matching)…`
        );
        let search;
        try {
          search = await fetchPage(country, term, cursor);
        } catch (err) {
          const msg = /does not correspond to a valid Indeed site/i.test(err?.message)
            ? "Indeed has no site there"
            : err?.message || String(err);
          failures.push(`${name}: ${msg}`);
          matched.push(...countryMatched);
          // Blocked or rate-limited: the next countries would be refused too
          if (/\b(?:403|429)\b/.test(msg)) break countries;
          continue countries;
        }
        const results = search.results || [];
        if (!results.length) break;

        const pageJobs = [];
        for (const row of results) {
          const raw = row?.job;
          if (!raw?.key || seen.has(raw.key)) continue;
          seen.add(raw.key);
          scanned += 1;
          const job = toJob(raw, country);
          if (!job) continue;
          // A job placed in a country that isn't ticked isn't open to the ticked ones
          if (!wanted.has(job.country)) {
            elsewhere += 1;
            continue;
          }
          pageJobs.push(job);
        }
        countryMatched.push(
          ...filterByRequest(pageJobs, {
            hoursOld: preset.hoursOld,
            title: titleFilter,
            skills,
            years,
            jobType,
          })
        );

        // Results are newest first: once a whole page is too old, the rest are too
        const dated = pageJobs.filter((j) => j.date_posted);
        if (dated.length && dated.every((j) => !withinHours(j.date_posted, preset.hoursOld))) {
          break;
        }
        cursor = search.pageInfo?.nextCursor || null;
        if (!cursor) break;
      }
      if (countryMatched.length >= resultsWanted) break;
    }
    matched.push(...countryMatched);
  }

  if (!matched.length && failures.length) {
    // Nothing found and something failed: the board failed
    if (failures.length === targets.length || /\b(?:403|429)\b/.test(failures[0])) {
      throw new Error(failures[0].replace(/^[^:]+: /, ""));
    }
  }
  if (failures.length) {
    onProgress?.(`Indeed stopped early, results may be incomplete: ${failures.join("; ")}`);
  }
  onProgress?.(
    `Indeed: ${targets.length} ${targets.length === 1 ? "country" : "countries"}, ${scanned} scanned` +
      `${elsewhere ? `, ${elsewhere} placed in other countries` : ""} → ${matched.length} matching`
  );
  // Newest first across countries, then Count
  return matched
    .sort((a, b) => String(b.date_posted).localeCompare(String(a.date_posted)))
    .slice(0, resultsWanted)
    .map((j) => ({ ...j, date_posted: String(j.date_posted).slice(0, 10) }));
}
