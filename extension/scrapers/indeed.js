/**
 * Indeed scraper — one GraphQL search per selected country (the indeed-co
 * header picks the country's Indeed site), remote jobs only: the remote
 * attribute (DSQF7) without the hybrid one (PAXZC), as JobSpy does.
 * The posted-date window is applied on Indeed's side (dateOnIndeed) and again
 * here. Indeed's filter list is newer than the US version's single filter, so
 * when Indeed rejects it the run steps down: without the hybrid exclusion,
 * then the remote filter alone; whatever Indeed no longer filters is checked
 * here.
 * The job type is read from attribute keys here, not sent to Indeed: keys in
 * one filter must all be present, contract keys differ by country, and jobs
 * that never state a type stay.
 * Country codes and subdomains follow JobSpy's jobspy/indeed/constant.py.
 * The locale stays en-US everywhere (attribute labels in English), as JobSpy
 * sent it until Sep 2026 and omkarcloud/indeed-scraper does for every country.
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
import { countryName, countryNames } from "./countries.js";

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
  CA: "ca",
  US: "www",
};

const HEADERS = {
  "content-type": "application/json",
  "indeed-api-key":
    "161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8",
  accept: "application/json",
  "accept-language": "en-US,en;q=0.9",
  "indeed-locale": "en-US",
  "indeed-app-info":
    "appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone",
};

// Location codes Indeed writes differently from ISO 3166 (JobSpy maps "SL" to Slovenia)
const COUNTRY_ALIASES = { SL: "SI", UK: "GB", EL: "GR" };

const REMOTE_KEY = "DSQF7";
const HYBRID_KEY = "PAXZC";
// Attribute keys are the same on every Indeed site; their labels are translated
// (JobSpy constant.py, omkarcloud/indeed-scraper refdata.py, Indeed Job Sync's
// job-type table). Written to the sheet and read by employmentKinds():
// "Permanent" and "Fixed-term" count as full time unless the job says otherwise.
const TYPE_LABELS = {
  CF3CP: "Full-time",
  NJXCK: "Contract",
  T65DZ: "Project contract",
  ZG59D: "Freelance",
  V7KSJ: "Contract",
  "7SBAT": "Contract-to-hire",
  "5QWDV": "Permanent",
  // Employees on a fixed term (Befristet, CDD), not freelancers
  T9BXE: "Fixed-term",
  "4HKF7": "Fixed-term",
  CJWTS: "Fixed-term",
  "8YWGX": "Temp agency",
  "75GKK": "Part-time",
  VDTG7: "Internship",
  CPAHG: "Apprenticeship",
  "9SYVT": "Seasonal",
  TQKYQ: "Per diem",
  UXQZ8: "Volunteer",
};

// With no Title, each country is searched for "developer" and its own word
// for it (Indeed's search reads the posting text); the title check then keeps
// the developer roles.
const DEFAULT_TERMS = ["developer"];
const LOCAL_TERMS = {
  AT: ["Entwickler"],
  BE: ["développeur", "ontwikkelaar"],
  CH: ["Entwickler"],
  CZ: ["vývojář"],
  DE: ["Entwickler"],
  DK: ["udvikler"],
  ES: ["desarrollador"],
  FI: ["kehittäjä"],
  FR: ["développeur"],
  GB: ["software engineer"],
  GR: ["προγραμματιστής"],
  HU: ["fejlesztő"],
  IE: ["software engineer"],
  IT: ["sviluppatore"],
  LU: ["développeur"],
  NL: ["ontwikkelaar"],
  NO: ["utvikler"],
  PL: ["programista"],
  PT: ["programador"],
  RO: ["dezvoltator"],
  SE: ["utvecklare"],
  CA: ["software engineer"],
  US: ["software engineer"],
};
// Employers abroad: most of their remote jobs are local, so each search also
// names where the job may be held; Indeed's search reads the posting text
const ABROAD_WORDS = ["Europe", "EMEA", "worldwide"];

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
 * Filter shapes, tried in this order until Indeed accepts one:
 * "full": date window, remote, not hybrid (a list of filters must all match;
 *   JobSpy since Oct 2026);
 * "date": date window and remote (the hybrid exclusion is the newest part);
 * "legacy": the remote filter alone, the shape the US version used.
 */
export const FILTER_STYLES = ["full", "date", "legacy"];

export function buildFilters(style, { hoursOld }) {
  if (style === "legacy") {
    return `filters: { composite: { filters: [${keyword([REMOTE_KEY])}] } }`;
  }
  const filters = [`{ date: { field: "dateOnIndeed", start: "${hoursOld}h" } }`, keyword([REMOTE_KEY])];
  if (style === "full") filters.push(keyword([HYBRID_KEY], ", match: MUST_NOT"));
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
  return { ...HEADERS, "indeed-co": country };
}

/**
 * What to search on one country's Indeed: each comma-separated title (plus
 * the stack, so Indeed checks it on the whole posting), or with no title
 * "developer" in English and the local language. For employers abroad each
 * search also names Europe, EMEA or worldwide.
 */
export function searchTerms(title, stack, country, { abroad = false } = {}) {
  const titles = String(title || "")
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const roles = titles.length ? titles : [...DEFAULT_TERMS, ...(LOCAL_TERMS[country] || [])];
  const extra = String(stack || "").trim();
  const terms = roles.map((role) => [role, extra].filter(Boolean).join(" "));
  return abroad ? terms.flatMap((term) => ABROAD_WORDS.map((where) => `${term} ${where}`)) : terms;
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

const INVALID_SITE_RE = /does not correspond to a valid Indeed site/i;

/** A query Indeed refused as invalid (HTTP 400 or 200 with errors and no results). */
const queryRejected = (res, data) =>
  !data?.data?.jobSearch &&
  Array.isArray(data?.errors) &&
  data.errors.length > 0 &&
  ![401, 403, 429].includes(res.status) &&
  !INVALID_SITE_RE.test(JSON.stringify(data.errors));

/**
 * @param {{
 *   title?: string,
 *   stack?: string,
 *   countries: string[],
 *   abroad?: string[],
 *   resultsWanted: number,
 *   datePreset?: string,
 *   years?: number | "",
 *   jobType?: string,
 *   onProgress?: (msg: string) => void
 * }} opts
 */
export async function scrapeIndeed({
  title,
  stack,
  countries,
  abroad,
  resultsWanted,
  datePreset,
  years,
  jobType,
  onProgress,
}) {
  const preset = resolveDatePreset(datePreset);
  const titleFilter = (title || "").trim();
  const wanted = new Set(countries || []);
  const abroadSites = new Set((abroad || []).filter((code) => INDEED_SITES[code] && !wanted.has(code)));
  const targets = [...[...wanted].filter((code) => INDEED_SITES[code]), ...abroadSites];
  const noSite = [...wanted].filter((code) => !INDEED_SITES[code]);
  // Names a job abroad may give for where it hires: the ticked countries in English and their own language
  const openToNames = [...wanted].flatMap((code) => countryNames(code));
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
  let notOpen = 0;
  let styleIndex = 0;
  let requests = 0;
  // A country's results are newest first; most windows fit in a page or two
  const MAX_PAGES = 5;

  let lastCountry = "";
  async function fetchPage(country, term, cursor) {
    const post = async () => {
      // One request at a time: a pause between pages, a longer one between countries
      if (requests++) await sleep(country === lastCountry ? PAGE_PAUSE_MS : COUNTRY_PAUSE_MS);
      lastCountry = country;
      const filters = buildFilters(FILTER_STYLES[styleIndex], { hoursOld: preset.hoursOld });
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
    while (styleIndex < FILTER_STYLES.length - 1 && queryRejected(res, data)) {
      styleIndex += 1;
      onProgress?.(
        FILTER_STYLES[styleIndex] === "date"
          ? "Indeed rejected the hybrid exclusion: hybrid jobs are left out here instead"
          : "Indeed rejected the date filter: searching remote jobs and checking dates here"
      );
      ({ res, data } = await post());
    }
    if (res.status === 401) {
      throw new Error("Indeed refused the app key (HTTP 401): Indeed may have revoked it, so the extension needs an update");
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
    const isAbroad = abroadSites.has(country);
    for (const term of searchTerms(titleFilter, stack, country, { abroad: isAbroad })) {
      let cursor = null;
      for (let page = 1; page <= MAX_PAGES && countryMatched.length < resultsWanted; page++) {
        onProgress?.(
          `Indeed ${name} "${term}" page ${page} (${preset.label}, ${matched.length + countryMatched.length} matching)…`
        );
        let search;
        try {
          search = await fetchPage(country, term, cursor);
        } catch (err) {
          const msg = INVALID_SITE_RE.test(err?.message)
            ? "Indeed has no site there"
            : err?.message || String(err);
          failures.push(`${name}: ${msg}`);
          matched.push(...countryMatched);
          // Key refused, blocked or rate-limited: the next countries would be refused too
          if (/\b(?:401|403|429)\b/.test(msg)) break countries;
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
          if (isAbroad) {
            // Employers abroad count only when the posting says it hires in Europe
            const open = globalThis.jbOpenToEurope(job, openToNames);
            if (!open.open) {
              notOpen += 1;
              continue;
            }
            job.open_to = open.to;
          } else if (!wanted.has(job.country)) {
            // A job placed in a country that isn't ticked isn't open to the ticked ones
            elsewhere += 1;
            continue;
          } else {
            job.open_to = countryName(job.country);
          }
          pageJobs.push(job);
        }
        countryMatched.push(
          ...filterByRequest(pageJobs, {
            hoursOld: preset.hoursOld,
            title: titleFilter,
            stack,
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
    if (failures.length === targets.length || /\b(?:401|403|429)\b/.test(failures[0])) {
      throw new Error(failures[0].replace(/^[^:]+: /, ""));
    }
  }
  if (failures.length) {
    onProgress?.(`Indeed stopped early, results may be incomplete: ${failures.join("; ")}`);
  }
  onProgress?.(
    `Indeed: ${targets.length} ${targets.length === 1 ? "country" : "countries"}, ${scanned} scanned` +
      `${elsewhere ? `, ${elsewhere} placed in other countries` : ""}` +
      `${notOpen ? `, ${notOpen} abroad not open to Europe` : ""} → ${matched.length} matching`
  );
  // Newest first across countries, then Count
  return matched
    .sort((a, b) => String(b.date_posted).localeCompare(String(a.date_posted)))
    .slice(0, resultsWanted)
    .map((j) => ({ ...j, date_posted: String(j.date_posted).slice(0, 10) }));
}
