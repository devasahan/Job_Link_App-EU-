import { INDEED_SITES, scrapeIndeed } from "./indeed.js";
import {
  acceptJob,
  filterByTitle,
  requiredYearsFromText,
  resolveDatePreset,
} from "./util.js";
import { normalizeWords } from "./history.js";
import { cleanAbroadCodes, cleanCountryCodes } from "./countries.js";

// More boards plug in here: (opts) => Promise<job[]>, see scrapeIndeed
const SCRAPERS = {
  indeed: scrapeIndeed,
};

/** Countries each board can search (the popup greys out the others). */
export const BOARD_COUNTRIES = {
  indeed: Object.keys(INDEED_SITES),
};

/**
 * Fetch remote developer jobs open to the selected EU countries (no local
 * server): jobs based in those countries, and jobs at employers abroad (UK,
 * Canada, US) that say they hire there.
 * @param {{
 *   sites: string[],
 *   countries: string[],
 *   abroad?: string[],
 *   title: string,
 *   stack: string,
 *   count: number,
 *   datePreset?: string,
 *   years?: number | "",
 *   jobType?: "fulltime" | "contract" | "both" | "",
 *   downloaded?: { has(job): boolean, recentCount(site: string, hours: number): number },
 *   onProgress?: (msg: string) => void
 * }} opts
 * With `downloaded`, jobs from earlier downloads are left out (counted in
 * `skipped`) and each board is asked for more, so Count new jobs still fit.
 * `incomplete` names the boards that stopped early.
 */
export async function scrapeJobs({
  sites,
  countries,
  abroad,
  title,
  stack,
  count,
  datePreset,
  years,
  jobType,
  downloaded,
  onProgress,
}) {
  const titleQ = (title || "").trim();
  const stackQ = (stack || "").trim();
  if (!sites?.length) {
    throw new Error("Select at least one platform");
  }
  const countryCodes = cleanCountryCodes(countries);
  if (!countryCodes.length) {
    throw new Error("Select at least one country");
  }
  const abroadCodes = cleanAbroadCodes(abroad);

  const preset = resolveDatePreset(datePreset);
  const resultsWanted = Math.max(1, Math.min(200, Number(count) || 50));
  const all = [];
  const errors = [];
  // Boards that stopped early (blocked, rate-limited, a country failing)
  const incomplete = [];

  for (const site of sites) {
    const fn = SCRAPERS[site];
    if (!fn) {
      errors.push(`Unknown platform: ${site}`);
      continue;
    }
    try {
      onProgress?.(`Fetching ${site}…`);
      // Jobs downloaded before may fill this board's first results again
      const repeats = downloaded ? downloaded.recentCount(site, preset.hoursOld) : 0;
      const jobs = await fn({
        title: titleQ,
        stack: stackQ,
        countries: countryCodes,
        abroad: abroadCodes,
        resultsWanted: Math.min(400, resultsWanted + repeats),
        datePreset: preset.id,
        years,
        jobType,
        onProgress,
      });
      all.push(...jobs);
      if (jobs.incomplete) incomplete.push(site);
      onProgress?.(`${site}: ${jobs.length} job(s)`);
    } catch (err) {
      const msg = err?.message || String(err);
      errors.push(`${site}: ${msg}`);
      onProgress?.(`${site} failed: ${msg}`);
    }
  }

  // Each scraper already applied the stack while paging, so Count holds
  let jobs = filterByTitle(all, titleQ);
  for (const job of jobs) {
    if (job.years_required == null || job.years_required === "") {
      const parsed = requiredYearsFromText(job.description || "");
      if (parsed != null) job.years_required = parsed;
    }
  }
  jobs = jobs.filter((job) => acceptJob(job, { years, jobType }));

  // One row per title + company, across all platforms and countries (first one wins)
  const seen = new Set();
  jobs = jobs.filter((j) => {
    const title = normalizeWords(j.title);
    const company = normalizeWords(j.company);
    const key = title && company ? `${title}|${company}` : j.job_url;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Leave out earlier downloads, then Count per board again
  let skipped = 0;
  if (downloaded) {
    const perSite = {};
    jobs = jobs.filter((j) => {
      if (downloaded.has(j)) {
        skipped += 1;
        return false;
      }
      perSite[j.site] = (perSite[j.site] || 0) + 1;
      return perSite[j.site] <= resultsWanted;
    });
  }

  return { jobs, errors, skipped, incomplete, datePreset: preset };
}
