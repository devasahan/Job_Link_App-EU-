/**
 * Indeed in the shared pipeline: a thin wrapper around scrapeIndeed(), which
 * runs its own requests (GraphQL with an app key and the indeed-co header,
 * paced 0.5 s / 1 s) and its own checks, Indeed's version of open-to.js's
 * rules. Its counters come back as jobs.report and are adopted as they are.
 */

import { indeedTargets, scrapeIndeed } from "../indeed.js";
import { SourceError } from "../http.js";
import { countryName } from "../countries.js";

export async function run(ctx) {
  const { opts } = ctx;
  const { targets, noSite } = indeedTargets(opts);
  if (!targets.length) {
    const names = noSite.map(countryName).join(", ");
    throw new SourceError("skipped", `no Indeed site for ${names || "the ticked countries"}`);
  }
  const jobs = await scrapeIndeed({
    title: opts.title,
    stack: opts.stack,
    countries: opts.countries,
    abroad: opts.abroad,
    home: opts.home,
    resultsWanted: ctx.wanted,
    datePreset: opts.preset?.id,
    years: opts.years,
    jobType: opts.jobType,
    onProgress: ctx.progress,
    summary: false,
    signal: ctx.signal,
  });
  ctx.adopt(jobs, jobs.report);
  // Countries that stopped early (blocked, one failing) make the run incomplete; scrapeIndeed logged them
  for (const failure of jobs.report.failures) {
    if (!/no site there/.test(failure)) ctx.fail(failure, { log: false });
  }
}
