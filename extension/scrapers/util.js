/** Shared helpers for JobBridge extension scrapers. */

import "./title-match.js";
import "./developer.js";
import "./eligibility.js";
import "./job-filters.js";

export const DATE_PRESETS = {
  today: {
    id: "today",
    label: "Today (24 hours)",
    hoursOld: 24,
  },
  "3days": {
    id: "3days",
    label: "3 days (72 hours)",
    hoursOld: 72,
  },
};

export function resolveDatePreset(id) {
  return DATE_PRESETS[id] || DATE_PRESETS.today;
}

export const BLOCK_TAG_RE =
  /<\/?(?:p|div|li|ul|ol|br|h[1-6]|tr|td|th|table|section|article|header|footer|blockquote|pre|dd|dt)\b[^>]*>/gi;

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function stripHtml(html) {
  if (!html) return "";
  // Keep "<li>React</li><li>AWS</li>" from becoming "ReactAWS"
  const spaced = String(html).replace(BLOCK_TAG_RE, " $&");
  const doc = new DOMParser().parseFromString(spaced, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

export function formatLocation(parts) {
  return parts.filter(Boolean).join(", ");
}

/**
 * Every word of one comma-separated title (Sr = Senior, Front-End = Frontend,
 * Entwickler = Developer, …) is in the job title. No title: any
 * software-development role.
 */
export function titleMatches(jobTitle, title) {
  // A title with no usable words ("-", "(m/w/d)") counts as none
  if (!globalThis.jbTitleQueryPhrases(title).length) return globalThis.jbIsDeveloperTitle(jobTitle);
  return globalThis.jbTitleMatches(jobTitle, title);
}

export function filterByTitle(jobs, title) {
  return jobs.filter((j) => titleMatches(j.title, title));
}

export function requiredYearsFromText(text) {
  return globalThis.jbRequiredYearsFromText(text);
}

export function yearsFromExperienceLabels(labels) {
  return globalThis.jbYearsFromExperienceLabels(labels);
}

export function employmentKinds(text, opts) {
  return globalThis.jbEmploymentKinds(text, opts);
}

/** Job asks for at most userYears + 0.5. Jobs that never state years stay. */
export function withinExperience(job, years) {
  return globalThis.jbWithinExperience(job, years);
}

/** fulltime | contract. Jobs that never state a type stay. */
export function matchesEmployment(job, jobType) {
  return globalThis.jbMatchesEmployment(job, jobType);
}

export function acceptJob(job, { years, jobType } = {}) {
  return withinExperience(job, years) && matchesEmployment(job, jobType);
}

/**
 * Everything a board's results must pass. Pass `stack` only for boards that
 * return the job description; boards searched with the stack words already
 * checked the whole posting.
 */
export function filterByRequest(jobs, { title, stack, years, jobType, hoursOld } = {}) {
  let out = jobs;
  if (hoursOld) out = filterByHoursOld(out, hoursOld);
  out = filterByTitle(out, title);
  if (stack) out = filterByStack(out, stack);
  return out.filter((job) => acceptJob(job, { years, jobType }));
}

/** Pass/fail for the posted-date window on one job (unknown dates pass). */
export function withinHours(datePosted, hoursOld) {
  if (!hoursOld || !datePosted) return true;
  const s = String(datePosted).trim();
  const t = Date.parse(s);
  if (Number.isNaN(t)) return true;
  const cutoff = Date.now() - hoursOld * 3600 * 1000;
  // Date-only values parse as UTC midnight; compare by day or recent jobs drop out
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const cutoffDay = new Date(cutoff).toISOString().slice(0, 10);
    return s >= cutoffDay;
  }
  return t >= cutoff;
}

/** Every stack word must be a whole word in the title or description. */
export function filterByStack(jobs, stack) {
  if (!String(stack || "").trim()) return jobs;
  return jobs.filter((j) => globalThis.jbStackMatches(j, stack));
}

/** Keep jobs whose date_posted is within hoursOld (when a parseable date exists). */
export function filterByHoursOld(jobs, hoursOld) {
  if (!hoursOld) return jobs;
  return jobs.filter((j) => withinHours(j.date_posted, hoursOld));
}

function resolveYearsRequired(partial) {
  const explicit = partial.years_required;
  if (explicit != null && explicit !== "" && Number.isFinite(Number(explicit))) {
    return Number(explicit);
  }
  const parsed = requiredYearsFromText(partial.description || "");
  return parsed == null ? "" : parsed;
}

export function normalizeJob(partial) {
  const isRemote = partial.is_remote;
  const description = partial.description || "";
  return {
    title: partial.title || "",
    company: partial.company || "",
    location: partial.location || "",
    // ISO 3166 alpha-2 code of the country the job is listed in ("DE", "US")
    country: partial.country || "",
    // Who can take it: the country's name, or "Europe", "EMEA", "Worldwide"… for employers abroad
    open_to: partial.open_to || "",
    site: partial.site || "",
    listing_type: partial.listing_type || "",
    date_posted: partial.date_posted || "",
    is_remote:
      isRemote === true || isRemote === "Yes"
        ? "Yes"
        : isRemote === false || isRemote === "No"
          ? "No"
          : partial.is_remote || "",
    job_url: partial.job_url || "",
    job_url_direct: partial.job_url_direct || "",
    description,
    years_required: resolveYearsRequired({ ...partial, description }),
  };
}
