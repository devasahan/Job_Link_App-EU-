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
  explainRequest,
  yearsFromExperienceLabels,
  requiredYearsFromText,
  withinHours,
  sleep,
} from "./util.js";
import { readJson } from "./http.js";
import { normalizeWords } from "./history.js";
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
// Countries whose own word for developer is English: a typed title is already in it
const ENGLISH_SITES = new Set(["GB", "IE", "CA", "US"]);
// The English role word in a typed title, swapped for the country's own word
// ("Backend Developer" is also searched as "Backend Entwickler" in Germany,
// "Software Engineer" as "Software Entwickler"). Other engineer titles stay
// English: "Data Engineer" is "Data Engineer" in Germany too
const ROLE_WORD_RE =
  /(?<![\p{L}\p{N}])(?:developer|programmer|dev)(?![\p{L}\p{N}])|(?<=(?<![\p{L}\p{N}])software[\s-]+)engineer(?![\p{L}\p{N}])/iu;
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
  // Function replacers: a "$'" or "$&" in the title must stay literal
  return QUERY_TMPL.replace("{{WHAT}}", () => what)
    .replace("{{CURSOR}}", () => cursorPart)
    .replace("{{FILTERS}}", () => filters);
}

export function requestHeaders(country) {
  return { ...HEADERS, "indeed-co": country };
}

/**
 * What to search on one country's Indeed: each comma-separated title (plus
 * the stack, so Indeed checks it on the whole posting) as typed and with the
 * country's own word for developer (not with `local: false`), or with no
 * title "developer" in English and the local language. For employers abroad each search also names Europe,
 * EMEA or worldwide.
 */
export function searchTerms(title, stack, country, { abroad = false, local: translate = true } = {}) {
  // Titles with no usable words ("-", "(m/w/d)") are dropped, as the title check
  // drops them; gender forms are left out of the search ("Entwickler*in" → "Entwickler")
  const titles = String(title || "")
    .split(/[,;]/)
    .filter((t) => globalThis.jbTitleQueryTokens(t).length)
    .map((t) => globalThis.jbStripGender(t));
  const local = !translate || ENGLISH_SITES.has(country) ? [] : LOCAL_TERMS[country] || [];
  const translated = titles.flatMap((t) =>
    ROLE_WORD_RE.test(t)
      ? local
          .map((word) => t.replace(ROLE_WORD_RE, () => word))
          // Only a search whose words the title check accepts can keep a job
          .filter((term) => globalThis.jbTitleMatches(term, t))
      : []
  );
  const roles = titles.length
    ? [...new Map([...titles, ...translated].map((t) => [t.toLowerCase(), t])).values()]
    : [...DEFAULT_TERMS, ...(LOCAL_TERMS[country] || [])];
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

/**
 * Indeed refused the query itself (a filter it doesn't know): HTTP 400 or a
 * GraphQL validation code, not a broken request (syntax) or a country it has
 * no site for. Only that steps the filters down.
 */
const queryRejected = (res, data) => {
  if (data?.data?.jobSearch || !Array.isArray(data?.errors) || !data.errors.length) return false;
  const errors = JSON.stringify(data.errors);
  if (INVALID_SITE_RE.test(errors) || /syntax error/i.test(errors)) return false;
  return res.status === 400 || /GRAPHQL_VALIDATION_FAILED|BAD_USER_INPUT/.test(errors);
};

/** A server error or an empty answer: worth one more try with the same filters. */
const transientFailure = (res, data) =>
  res.status >= 500 || (res.ok && !data?.data?.jobSearch && !queryRejected(res, data));

/**
 * @param {{
 *   title?: string,
 *   stack?: string,
 *   countries: string[],
 *   abroad?: string[],
 *   home?: string,
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
  home,
  resultsWanted,
  datePreset,
  years,
  jobType,
  onProgress,
}) {
  const preset = resolveDatePreset(datePreset);
  const titleFilter = (title || "").trim();
  // Where the user lives isn't searched: they want jobs from other countries
  const wanted = new Set((countries || []).filter((code) => code !== home));
  const abroadSites = new Set((abroad || []).filter((code) => INDEED_SITES[code] && !wanted.has(code)));
  const targets = [...[...wanted].filter((code) => INDEED_SITES[code]), ...abroadSites];
  const noSite = [...wanted].filter((code) => !INDEED_SITES[code]);
  // Names a job abroad may give for where it hires, in English and their own language: where the
  // user lives, or with that not set the ticked countries
  const openToNames = home ? countryNames(home) : [...wanted].flatMap((code) => countryNames(code));
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
  let notRemote = 0;
  let inHome = 0;
  let residentsOnly = 0;
  // What each check left out, for the run summary
  const dropped = { old: 0, title: 0, stack: 0, type: 0, years: 0 };
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
    if (transientFailure(res, data)) ({ res, data } = await post());
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
    const scannedBefore = scanned;
    const isAbroad = abroadSites.has(country);
    // Every search runs: each title (and each language's word) has its own newest jobs.
    // A typed title's local-language searches only run while the country is short of Count
    const typed = new Set(searchTerms(titleFilter, stack, country, { abroad: isAbroad, local: false }));
    for (const term of searchTerms(titleFilter, stack, country, { abroad: isAbroad })) {
      if (titleFilter && !typed.has(term) && countryMatched.length >= resultsWanted) continue;
      let cursor = null;
      let termMatched = 0;
      for (let page = 1; page <= MAX_PAGES && termMatched < resultsWanted; page++) {
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
          onProgress?.(`Indeed ${name}: ${scanned - scannedBefore} scanned → ${countryMatched.length} kept (stopped)`);
          // Key refused, blocked or rate-limited: the next countries would be refused too
          if (/\b(?:401|403|429)\b/.test(msg)) break countries;
          continue countries;
        }
        const results = search.results || [];
        if (!results.length) break;

        const pageJobs = [];
        // Results are newest first: once a whole page is too old, the rest are too
        // (jobs already seen under another search count; their dates are the same)
        const pageDates = results.map((row) => row?.job?.dateOnIndeed || row?.job?.datePublished).filter(Boolean);
        for (const row of results) {
          const raw = row?.job;
          if (!raw?.key || seen.has(raw.key)) continue;
          seen.add(raw.key);
          scanned += 1;
          const job = toJob(raw, country);
          if (!job) {
            notRemote += 1;
            continue;
          }
          if (isAbroad) {
            // Employers abroad count only when the posting says it hires in Europe
            const open = globalThis.jbOpenToEurope(job, openToNames);
            if (!open.open) {
              notOpen += 1;
              continue;
            }
            job.open_to = open.to;
          } else if (home && job.country === home) {
            // Placed where the user lives (an EU site can list a job in another country)
            inHome += 1;
            continue;
          } else if (!wanted.has(job.country)) {
            // A job placed in a country that isn't ticked isn't open to the ticked ones
            elsewhere += 1;
            continue;
          } else if (home && globalThis.jbResidenceRequired?.(job, { country: job.country, home }).required) {
            // "Homeoffice innerhalb Deutschlands", "must live in the Netherlands": not from where the user lives
            residentsOnly += 1;
            continue;
          } else {
            job.open_to = countryName(job.country);
          }
          pageJobs.push(job);
        }
        const { kept, dropped: why } = explainRequest(pageJobs, {
          hoursOld: preset.hoursOld,
          title: titleFilter,
          stack,
          years,
          jobType,
        });
        for (const [reason, n] of Object.entries(why)) dropped[reason] += n;
        countryMatched.push(...kept);
        termMatched += kept.length;

        if (pageDates.length && pageDates.every((ms) => !withinHours(toDatePosted(ms), preset.hoursOld))) {
          break;
        }
        cursor = search.pageInfo?.nextCursor || null;
        if (!cursor) break;
      }
    }
    matched.push(...countryMatched);
    onProgress?.(`Indeed ${name}: ${scanned - scannedBefore} scanned → ${countryMatched.length} kept`);
  }

  if (!matched.length && failures.length) {
    // Nothing found and something failed: the board failed. A refused key,
    // block or rate limit stopped the run, so it is the reason
    const stop = failures.find((f) => /\b(?:401|403|429)\b/.test(f));
    if (stop) throw new Error(stop.replace(/^[^:]+: /, ""));
    if (failures.length === targets.length) {
      const reason = failures.find((f) => !/no site there/.test(f)) || failures[0];
      throw new Error(reason.replace(/^[^:]+: /, ""));
    }
  }
  if (failures.length) {
    onProgress?.(`Indeed stopped early, results may be incomplete: ${failures.join("; ")}`);
  }
  const leftOut = [
    [
      dropped.title,
      globalThis.jbTitleQueryPhrases(titleFilter).length ? "not matching the title" : "not developer roles",
    ],
    [dropped.old, `older than ${preset.span}`],
    [dropped.type, "other job types"],
    [dropped.years, "asking for more years"],
    [dropped.stack, "without the stack words"],
    [notRemote, "hybrid or not remote"],
    [elsewhere, "placed in other countries"],
    [inHome, "in your country"],
    [residentsOnly, "only for people living in their country"],
    [notOpen, "abroad, not open to Europe"],
  ]
    .filter(([n]) => n)
    .map(([n, why]) => `${n} ${why}`);
  onProgress?.(
    `Indeed: ${targets.length} ${targets.length === 1 ? "country" : "countries"}, ${scanned} scanned → ${matched.length} matching` +
      (leftOut.length ? `. Left out: ${leftOut.join(", ")}` : "")
  );
  // Newest first across countries; the same job posted in several countries
  // (title + company) counts once, the newest copy, before Count
  const seenJobs = new Set();
  const jobs = matched
    .sort((a, b) => String(b.date_posted).localeCompare(String(a.date_posted)))
    .filter((j) => {
      const title = normalizeWords(j.title);
      const company = normalizeWords(j.company);
      const key = title && company ? `${title}|${company}` : j.job_url;
      if (seenJobs.has(key)) return false;
      seenJobs.add(key);
      return true;
    })
    .slice(0, resultsWanted)
    .map((j) => ({ ...j, date_posted: String(j.date_posted).slice(0, 10) }));
  // Some countries weren't searched to the end: wider settings aren't the fix
  jobs.incomplete = failures.some((f) => !/no site there/.test(f));
  return jobs;
}
