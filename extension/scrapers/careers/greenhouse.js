/**
 * Greenhouse — the public Job Board API (no key), one board per company in
 * careers/companies.js:
 *   GET /v1/boards/{token}/jobs
 *     { jobs: [{ id, title, location: { name }, first_published, updated_at,
 *       absolute_url, metadata: [{ name, value }] | null, … }], meta: { total } }
 *   GET /v1/boards/{token}/jobs/{id}
 *     the same job plus `content` (the posting's HTML, escaped once more),
 *     departments and offices
 *   GET /v1/boards/{token}/jobs?content=true
 *     every job as /jobs/{id} has it
 * The list has no descriptions (about 1 KB a job), so its rows are screened
 * first (title, age, place) and only the survivors' postings are checked,
 * newest first, until the company's Count (in Check sources, until the
 * source has a few). One or two are read on their own (/jobs/{id}); when
 * more are needed the board is read once more with every posting
 * (?content=true): one request where a 30-day window could need dozens,
 * which would use up the time budget before the last companies. A posting
 * that fails fails its company, as its board would. A board in
 * Greenhouse's EU region answers on boards-api.eu.greenhouse.io, asked when
 * the main host says 404; a board neither knows (a stale token) is noted,
 * not a failure (common.js runCompanies). Where a job is: its location name
 * ("Remote - EMEA", "Spain (Remote)", "Berlin, Germany; Remote, Spain"),
 * read by atsWhere, a workplace custom field when the board has one, and the
 * office a location names ("Remote - Berlin").
 */

import { normalizeJob, stripHtml } from "../util.js";
import { expectArray } from "../http.js";
import { decodeEntities } from "../formats/feed.js";
import { atsWhere, boardJson, newestFirst, runCompanies } from "./common.js";

const MAIN = "boards-api.greenhouse.io";
const EU = "boards-api.eu.greenhouse.io";
// Where each host's boards are shown, for a job without its own https link
const PAGES = { [MAIN]: "job-boards.greenhouse.io", [EU]: "job-boards.eu.greenhouse.io" };

// Postings read one by one; more than this, and the board is read with all of them
const FEW_POSTINGS = 2;

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
  // Read as open-to.js reads a location: "Remote or Hybrid" can be done remotely, "Not Remote" can't
  const said = globalThis.jbWorkplaceFromText({ location: field.value }, { cheap: true });
  if (said) return said;
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
  const title = String(row.title || "").trim();
  const description = row.content ? stripHtml(decodeEntities(row.content)) : "";
  // The office the location names places a remote job ("Remote - Berlin": Berlin, Germany); not the head office
  const named = location.toLowerCase();
  const office = (Array.isArray(row.offices) ? row.offices : []).find((o) => o?.name && o.location && named.includes(String(o.name).toLowerCase()));
  const where = atsWhere({ locations: [location], workplace: workplaceField(row), country: office ? String(office.location) : "", title, description });
  const link = /^https:\/\//i.test(String(row.absolute_url || "")) ? row.absolute_url : `https://${PAGES[host]}/${encodeURIComponent(company.token)}/jobs/${row.id}`;
  return {
    ...normalizeJob({
      title,
      company: company.name,
      location,
      site: "greenhouse",
      listing_type: fieldValue(row, TYPE_FIELD_RE)?.value || "",
      // first_published stays when a posting is edited; updated_at only for boards without it
      date_posted: toIso(row.first_published) || toIso(row.updated_at),
      is_remote: where.workplace === "remote" ? true : where.workplace ? false : "",
      job_url: link,
      description,
    }),
    _id: `${company.token}:${row.id}`,
    _where: where,
  };
}

const boardUrl = (host, company, path = "") => `https://${host}/v1/boards/${encodeURIComponent(company.token)}/jobs${path}`;

/** Every posting of a board in one answer (?content=true), by job id; none when the board is gone since. */
async function allPostings(ctx, host, company) {
  const data = await boardJson(ctx, boardUrl(host, company, "?content=true"));
  const rows = data ? expectArray(data, "jobs", `${company.name}'s board`) : [];
  return new Map(rows.filter((r) => r?.id != null).map((r) => [`${company.token}:${r.id}`, r]));
}

// The EU host is given up for the run when it doesn't answer or limits us; a 404, a 500 or a 403
// may be one board's
const hostDown = (err) => err?.kind === "network" || err?.kind === "timeout" || (err?.kind === "blocked" && err.status !== 403);

export async function run(ctx) {
  let euDown = false;
  /**
   * A board on the EU host, or null. Only boards kept in Greenhouse's EU
   * region are there, so its errors leave the company not found (logged)
   * rather than failing it, or ending the source over a host most companies
   * never use; once it doesn't answer, it isn't asked again this run (each
   * stale token would wait out its timeouts).
   */
  async function euBoard(company) {
    if (euDown) return null;
    try {
      return await boardJson(ctx, boardUrl(EU, company));
    } catch (err) {
      if (err?.kind === "aborted") throw err;
      if (!hostDown(err)) {
        ctx.progress(`Greenhouse: ${company.name} not on the main host, and the EU host: ${err.message}`);
        return null;
      }
      euDown = true;
      ctx.note(`Greenhouse: the EU host isn't answering (${err.message}): boards kept only there count as not found this run`);
      return null;
    }
  }

  await runCompanies(ctx, ctx.meta.companies || [], async (part, company) => {
    let host = MAIN;
    let data = await boardJson(ctx, boardUrl(host, company));
    if (!data) {
      host = EU;
      data = await euBoard(company);
    }
    if (!data) return null;
    const rows = expectArray(data, "jobs", `${company.name}'s board`).filter((r) => r && r.id != null && r.title);
    const byId = new Map(rows.map((row) => [`${company.token}:${row.id}`, row]));
    // Only the rows that pass the screen are checked in full, newest first, up to the company's Count
    // (in Check sources, until the source has a few)
    const passed = part.screen(rows.map((row) => toJob(row, company, host))).sort(newestFirst);
    const room = ctx.opts.check ? ctx.wanted - ctx.report.kept : ctx.wanted;
    let full = null;
    let read = 0;
    for (const job of passed) {
      if (part.enough() || (ctx.opts.check && ctx.report.kept >= ctx.wanted)) break;
      // More postings than a few to check, or a few read and still short: every posting in one answer
      if (!full && (read >= FEW_POSTINGS || Math.min(passed.length, room) > FEW_POSTINGS)) full = await allPostings(ctx, host, company);
      const row = byId.get(job._id);
      let posting;
      if (full) posting = full.get(job._id);
      else {
        read += 1;
        posting = await boardJson(ctx, boardUrl(host, company, `/${encodeURIComponent(row.id)}`));
      }
      // Closed since the list was read
      if (posting && typeof posting === "object") part.accept([toJob({ ...row, ...posting }, company, host)]);
    }
    return rows.length;
  });
}
