/**
 * Greenhouse — the public Job Board API (no key), one board per company in
 * careers/companies.js:
 *   GET /v1/boards/{token}/jobs
 *     { jobs: [{ id, title, location: { name }, first_published, updated_at,
 *       absolute_url, metadata: [{ name, value }] | null, … }], meta: { total } }
 *   GET /v1/boards/{token}/jobs/{id}
 *     the same job plus `content` (the posting's HTML, escaped once more),
 *     departments and offices
 * The list has no descriptions (about 1 KB a job, where ?content=true would
 * send every posting), so its rows are screened first (title, age, place)
 * and only the survivors' postings are read, newest first, until the
 * company's Count (in Check sources, until the source has a few); a posting
 * that fails fails its company, as its board would. A board in Greenhouse's
 * EU region answers on boards-api.eu.greenhouse.io, asked when the main host
 * says 404; a board neither knows (a stale token) is noted, not a failure
 * (common.js runCompanies). Where a job is: its location name ("Remote -
 * EMEA", "Spain (Remote)", "Berlin, Germany; Remote, Spain"), read by
 * atsWhere, and a workplace custom field when the board has one.
 */

import { normalizeJob, stripHtml } from "../util.js";
import { expectArray } from "../http.js";
import { decodeEntities } from "../formats/feed.js";
import { atsWhere, boardJson, newestFirst, runCompanies } from "./common.js";

const MAIN = "boards-api.greenhouse.io";
const EU = "boards-api.eu.greenhouse.io";
// Where each host's boards are shown, for a job without its own https link
const PAGES = { [MAIN]: "job-boards.greenhouse.io", [EU]: "job-boards.eu.greenhouse.io" };

// Custom fields some boards fill in: "Workplace Type: Remote", "Remote: Yes", "Employment Type: Full-time"
const WORKPLACE_FIELD_RE = /workplace|remote|location\s*type|work\s*(?:type|model|arrangement|style)/i;
const TYPE_FIELD_RE = /employment|job\s*type|contract\s*type|time\s*type/i;

function fieldValue(row, nameRe) {
  for (const m of Array.isArray(row.metadata) ? row.metadata : []) {
    if (!m || !nameRe.test(String(m.name || ""))) continue;
    const value = Array.isArray(m.value) ? m.value.join(", ") : m.value;
    if (value != null && value !== "") return { name: String(m.name), value: String(value).trim() };
  }
  return null;
}

/** The board's own workplace field, or null (a "No" says too little: the location decides). */
function workplaceField(row) {
  const field = fieldValue(row, WORKPLACE_FIELD_RE);
  if (!field) return null;
  const v = field.value.toLowerCase();
  if (/hybrid/.test(v)) return "hybrid";
  if (/remote/.test(v) || (/^(?:yes|true)$/.test(v) && /remote/i.test(field.name))) return "remote";
  if (/on[\s-]?site|office/.test(v)) return "onsite";
  return null;
}

const toIso = (value) => {
  const t = Date.parse(String(value || ""));
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
};

/** One list row, or a posting from /jobs/{id} (with its content), as a job. */
export function toJob(row, company, host = MAIN) {
  const location = String(row.location?.name || "").replace(/\s+/g, " ").trim();
  const where = atsWhere({ locations: [location], workplace: workplaceField(row) });
  const link = /^https:\/\//i.test(String(row.absolute_url || "")) ? row.absolute_url : `https://${PAGES[host]}/${encodeURIComponent(company.token)}/jobs/${row.id}`;
  return {
    ...normalizeJob({
      title: String(row.title || "").trim(),
      company: company.name,
      location,
      site: "greenhouse",
      listing_type: fieldValue(row, TYPE_FIELD_RE)?.value || "",
      // first_published stays when a posting is edited; updated_at only for boards without it
      date_posted: toIso(row.first_published) || toIso(row.updated_at),
      is_remote: where.workplace === "remote" ? true : where.workplace ? false : "",
      job_url: link,
      description: row.content ? stripHtml(decodeEntities(row.content)) : "",
    }),
    _id: `${company.token}:${row.id}`,
    _where: where,
  };
}

const boardUrl = (host, company, path = "") => `https://${host}/v1/boards/${encodeURIComponent(company.token)}/jobs${path}`;

/**
 * A board on the EU host, or null. Only boards kept in Greenhouse's EU region
 * are there, so its errors leave the company not found (logged) rather than
 * failing it, or ending the source over a host most companies never use.
 */
async function euBoard(ctx, company) {
  try {
    return await boardJson(ctx, boardUrl(EU, company));
  } catch (err) {
    if (err?.kind === "aborted") throw err;
    ctx.progress(`Greenhouse: ${company.name} not on the main host, and the EU host: ${err.message}`);
    return null;
  }
}

export async function run(ctx) {
  await runCompanies(ctx, ctx.meta.companies || [], async (part, company) => {
    let host = MAIN;
    let data = await boardJson(ctx, boardUrl(host, company));
    if (!data) {
      host = EU;
      data = await euBoard(ctx, company);
    }
    if (!data) return null;
    const rows = expectArray(data, "jobs", `${company.name}'s board`).filter((r) => r && r.id != null && r.title);
    const byId = new Map(rows.map((row) => [`${company.token}:${row.id}`, row]));
    // Only the rows that pass the screen are read in full, newest first, up to the company's Count
    // (in Check sources, until the source has a few)
    const passed = part.screen(rows.map((row) => toJob(row, company, host))).sort(newestFirst);
    for (const job of passed) {
      if (part.enough() || (ctx.opts.check && ctx.report.kept >= ctx.wanted)) break;
      const row = byId.get(job._id);
      const posting = await boardJson(ctx, boardUrl(host, company, `/${encodeURIComponent(row.id)}`));
      // Closed since the list was read
      if (posting && typeof posting === "object") part.accept([toJob({ ...row, ...posting }, company, host)]);
    }
    return rows.length;
  });
}
