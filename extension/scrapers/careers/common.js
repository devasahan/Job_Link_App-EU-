/**
 * What the careers sources share: reading an ATS location into a Where
 * (open-to.js), a company board's JSON with its 404 told apart, and the walk
 * through the company list with its failure rules.
 */

import "../util.js";
import { countryCode } from "../countries.js";
import { SourceError, parseJson } from "../http.js";

// Not one of open-to.js's remote words, but how boards write it: "Home based - EMEA" (Canonical)
const HOME_BASED_RE = /(?<![\p{L}\p{N}])home[\s-]?based(?![\p{L}\p{N}])/iu;
// "Anywhere", "Remote - Anywhere", "Anywhere in the world": the world
const ANYWHERE_RE = /(?<![\p{L}\p{N}])anywhere(?:\s+in\s+the\s+world)?(?![\p{L}\p{N}])/giu;
// One location field may hold several: "Berlin, Germany; Remote, Spain", "London | Remote (UK)"
const SPLIT_RE = /\s*[;|\n]\s*/;

/** "remote", "hybrid", "onsite" from one location's own words, or null. */
function saysWorkplace(text) {
  if (HOME_BASED_RE.test(text)) return "remote";
  return globalThis.jbWorkplaceFromText({ location: text }, { cheap: true });
}

const readPlaces = (texts) => globalThis.jbReadPlaces(texts.map((t) => t.replace(ANYWHERE_RE, "Worldwide")));
const namesPlace = (text) => {
  const read = readPlaces([text]);
  return read.codes.length > 0 || read.outside.length > 0;
};
// "Europe", "EMEA", "Worldwide", "DACH": no office is a region
const regionOnly = (text) => {
  const read = readPlaces([text]);
  return Boolean(read.wide || read.parts.length) && !read.names.length && !read.outside.length;
};

/** The one country the places name ("Remote - Spain", "Remote, US"), or "" for none or several. */
function singleCountry(read) {
  if (read.wide || read.parts.length) return "";
  // Outside places that are no country the popup knows ("California", "APAC") aren't one
  const outside = read.outside.map(countryCode);
  if (outside.some((code) => !code)) return "";
  const codes = new Set([...read.names.map((n) => n.code), ...outside]);
  return codes.size === 1 ? [...codes][0] : "";
}

/**
 * Where a job on a company's job board is, as a Where (open-to.js), from its
 * location names and, when the ATS has them, its workplace field and the
 * country of its address:
 *   - a remote word with places ("Remote - EMEA", "Spain (Remote)", "Remote,
 *     Germany", "Home based - Europe"): open to those places. One European
 *     country is where the job is listed, so Indeed's rules apply: your own
 *     country is left out, an unticked one too, and with You live in set the
 *     posting must not say you must live there. One country outside Europe
 *     ("Remote - US") is listed there and limited to it;
 *   - a remote word alone ("Remote"): the posting's text decides (rule 7);
 *   - places and no remote word ("Berlin, Germany"): on-site, unless they are
 *     regions only ("EMEA"), which no office is: then open to them, and the
 *     posting may still say the job is hybrid;
 *   - the ATS's workplace field wins over the words. A remote job whose
 *     locations name no place is placed by its address country when that is
 *     European; one outside Europe is often the head office's, so the text decides.
 * Several locations: the places of those that say remote, or of all of them
 * when the workplace field does.
 * @param {{ locations?: string[], workplace?: "remote"|"hybrid"|"onsite"|null, country?: string }} info
 */
export function atsWhere({ locations = [], workplace = null, country = "" } = {}) {
  const items = [...new Set(locations.flatMap((l) => String(l || "").split(SPLIT_RE)).map((t) => t.trim()).filter(Boolean))];
  const said = items.map(saysWorkplace);
  const remote = items.filter((_, i) => said[i] === "remote");
  let place = workplace || null;
  if (!place && remote.length) place = "remote";
  else if (!place && said.includes("hybrid")) place = "hybrid";
  else if (!place && (said.includes("onsite") || (items.length && !items.every(regionOnly)))) place = "onsite";

  let placed = remote.filter(namesPlace);
  // The workplace field says remote, or the locations are regions only: all their places count
  if (!placed.length && (workplace === "remote" || !place)) placed = items.filter(namesPlace);
  if (!placed.length && place === "remote" && country) {
    const at = readPlaces([String(country)]);
    if (at.names.length === 1 && !at.outside.length) placed = [at.names[0].name];
  }
  const where = { workplace: place, listedIn: null, open: null, emptyOpen: null, utc: null, remoteOnly: false };
  if (!placed.length) return where;
  const read = readPlaces(placed);
  const listed = singleCountry(read);
  if (listed) where.listedIn = listed;
  // One European country: Indeed's rules (rule 6), not a "who may apply" list
  if (!listed || !read.names.length) where.open = placed;
  return where;
}

/**
 * A company board's JSON, or null when the host doesn't know the board (404:
 * a token gone stale, or the company switched its board off).
 */
export async function boardJson(ctx, url) {
  const res = await ctx.http.get(url, { allow: [404], headers: { accept: "application/json" } });
  return res.status === 404 ? null : parseJson(res);
}

const NO_ANSWER_IN_A_ROW = 3;

/**
 * What ends a careers source rather than one company: a stop, a block (403,
 * a lasting 429: asking the other companies would only add to it), or the
 * third company in a row with no answer at all (the host is down: each would
 * wait out its timeout). check(err) rethrows those; ok() after an answer.
 */
function companyGuard() {
  let silent = 0;
  return {
    ok() {
      silent = 0;
    },
    check(err) {
      if (err?.kind === "aborted" || err?.kind === "blocked") throw err;
      silent = err?.kind === "network" || err?.kind === "timeout" ? silent + 1 : 0;
      if (silent >= NO_ANSWER_IN_A_ROW) throw err;
    },
  };
}

const listNames = (companies, max = 12) =>
  companies.slice(0, max).map((c) => `${c.name} (${c.token})`).join(", ") + (companies.length > max ? `, … +${companies.length - max}` : "");

/**
 * Each company in turn as its own part (its own Count, counters and Copy
 * report line). `readBoard(part, company)` reads one board and returns how
 * many jobs it lists, or null when the board isn't there. Then:
 *   - boards not found are summed up in one log line, not a failure; none
 *     found at all is one (the API itself has moved);
 *   - a stop, a block or a host that stopped answering ends the source
 *     (companyGuard);
 *   - any other error fails that company only, unless no company answered:
 *     then the first error is the source's (500 → failed, as for any source).
 * Returns { answered, missing }.
 */
export async function runCompanies(ctx, companies, readBoard) {
  const label = ctx.meta?.label || "";
  const guard = companyGuard();
  const missing = [];
  let answered = 0;
  let first = null;
  let done = 0;
  try {
    for (const company of companies) {
      if (done % 10 === 0) ctx.progress(`${label}: company ${done + 1} of ${companies.length} (${ctx.report.kept} kept)…`);
      done += 1;
      const part = ctx.part(company.name, { key: company.token });
      try {
        const listed = await readBoard(part, company);
        guard.ok();
        if (listed == null) {
          missing.push(company);
          part.note("not found (HTTP 404)");
          continue;
        }
        answered += 1;
        part.note(`${listed} ${listed === 1 ? "job" : "jobs"} listed`);
      } catch (err) {
        guard.check(err);
        first ||= err;
        part.fail(err);
      }
    }
  } finally {
    if (done < companies.length) ctx.note(`${label}: ${companies.length - done} of ${companies.length} companies not checked (stopped first)`);
    if (missing.length) {
      ctx.note(`${label}: ${missing.length} ${missing.length === 1 ? "company" : "companies"} not found (HTTP 404): ${listNames(missing)}`);
    }
  }
  if (!answered && first) throw first;
  if (!answered && missing.length) {
    throw new SourceError("http", `no company board found (HTTP 404 for all ${missing.length})`, { status: 404 });
  }
  return { answered, missing };
}

/** Newest first; undated last. */
export const newestFirst = (a, b) => String(b.date_posted || "").localeCompare(String(a.date_posted || ""));
