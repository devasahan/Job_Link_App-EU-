/**
 * Ashby — the public job posting API (no key), one board per company in
 * careers/companies.js, every job with its posting in one answer:
 *   GET https://api.ashbyhq.com/posting-api/job-board/{token}
 *     { apiVersion, jobs: [{ id, title, location, secondaryLocations:
 *       [{ location, address }], workplaceType ("Remote" | "Hybrid" |
 *       "OnSite" | null), isRemote, isListed, publishedAt, employmentType,
 *       address: { postalAddress: { addressCountry } }, descriptionPlain,
 *       descriptionHtml, jobUrl, applyUrl }] }
 * Unlisted jobs (isListed false) are left out unseen. Answers are large, so
 * requests are 0.5 s apart and may take 30 s. Each company's jobs are
 * checked newest first until its Count; a board that isn't there (404) is
 * noted, not a failure (common.js runCompanies). Where a job is: workplaceType
 * when set (isRemote can disagree with it), else isRemote when true, else the
 * location words, which the posting may overrule ("this role is hybrid"); its
 * places are its location and secondary locations, and the address country
 * for a remote job that names no place (atsWhere).
 */

import { normalizeJob, stripHtml } from "../util.js";
import { expectArray } from "../http.js";
import { atsWhere, boardJson, newestFirst, runCompanies } from "./common.js";

const BASE = "https://api.ashbyhq.com/posting-api/job-board";
const TYPES = { fulltime: "Full Time", parttime: "Part Time", contract: "Contract", intern: "Internship", temporary: "Temporary" };
const WORKPLACES = { remote: "remote", hybrid: "hybrid", onsite: "onsite", inoffice: "onsite" };

const text = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const key = (value) => text(value).toLowerCase().replace(/[\s_-]+/g, "");

/** workplaceType when it says, else isRemote when true, else null: the location's words decide. */
function workplaceOf(row) {
  return WORKPLACES[key(row.workplaceType)] || (row.isRemote === true ? "remote" : null);
}

const countryOf = (address) => text(address?.postalAddress?.addressCountry) || text(address?.addressCountry);

const toIso = (value) => {
  const t = Date.parse(String(value || ""));
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
};

/** One job of a board as a job. */
export function toJob(row, company) {
  const places = [text(row.location), ...(Array.isArray(row.secondaryLocations) ? row.secondaryLocations : []).map((s) => text(s?.location))].filter(Boolean);
  const unique = [...new Set(places)];
  const description = text(row.descriptionPlain) ? String(row.descriptionPlain).trim() : stripHtml(row.descriptionHtml || "");
  const where = atsWhere({ locations: unique, workplace: workplaceOf(row), country: countryOf(row.address), title: text(row.title), description });
  const location = unique.length > 3 ? `${unique.slice(0, 3).join("; ")} + ${unique.length - 3} more` : unique.join("; ");
  const link = /^https:\/\//i.test(text(row.jobUrl)) ? text(row.jobUrl) : `https://jobs.ashbyhq.com/${encodeURIComponent(company.token)}/${encodeURIComponent(text(row.id))}`;
  return {
    ...normalizeJob({
      title: text(row.title),
      company: company.name,
      location,
      site: "ashby",
      listing_type: TYPES[key(row.employmentType)] || text(row.employmentType),
      date_posted: toIso(row.publishedAt),
      is_remote: where.workplace === "remote" ? true : where.workplace ? false : "",
      job_url: link,
      job_url_direct: /^https:\/\//i.test(text(row.applyUrl)) ? text(row.applyUrl) : "",
      description,
    }),
    _id: `${company.token}:${text(row.id) || link}`,
    _where: where,
  };
}

export async function run(ctx) {
  await runCompanies(ctx, ctx.meta.companies || [], async (part, company) => {
    const data = await boardJson(ctx, `${BASE}/${encodeURIComponent(company.token)}`);
    if (!data) return null;
    const rows = expectArray(data, "jobs", `${company.name}'s board`).filter((r) => r && r.isListed !== false && text(r.title));
    for (const job of rows.map((row) => toJob(row, company)).sort(newestFirst)) {
      if (part.enough()) break;
      part.accept([job]);
    }
    return rows.length;
  });
}
