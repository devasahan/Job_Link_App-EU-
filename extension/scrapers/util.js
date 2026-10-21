/** Shared helpers for JobBridge extension scrapers. */

import "./title-match.js";
import "./marketing.js";
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
  // Keep "<li>SEO</li><li>SEA</li>" from becoming "SEOSEA"
  const spaced = String(html).replace(BLOCK_TAG_RE, " $&");
  const doc = new DOMParser().parseFromString(spaced, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

export function formatLocation(parts) {
  return parts.filter(Boolean).join(", ");
}

/**
 * Every word of one comma-separated title phrase (Sr = Senior, SEO = search
 * engine optimisation, …) is in the job title. No title: any marketing role.
 */
export function titleMatches(jobTitle, title) {
  if (!String(title || "").trim()) return globalThis.jbIsMarketingTitle(jobTitle);
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
 * Everything a board's results must pass. Pass `skills` only for boards that
 * return the job description; boards searched with the skill words already
 * checked the whole posting.
 */
export function filterByRequest(jobs, { title, skills, years, jobType, hoursOld } = {}) {
  let out = jobs;
  if (hoursOld) out = filterByHoursOld(out, hoursOld);
  out = filterByTitle(out, title);
  if (skills) out = filterBySkills(out, skills);
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

/** Every skill word must be a whole word in the title or description. */
export function filterBySkills(jobs, skills) {
  if (!String(skills || "").trim()) return jobs;
  return jobs.filter((j) => globalThis.jbSkillsMatch(j, skills));
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
    // ISO 3166 alpha-2 code of the country the job is open to ("DE")
    country: partial.country || "",
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
