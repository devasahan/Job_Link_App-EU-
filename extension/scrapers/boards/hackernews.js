/**
 * Hacker News "Ask HN: Who is hiring?" — the monthly thread posted by the
 * whoishiring account, read through the public HN Algolia API (no key):
 *   search_by_date?tags=story,author_whoishiring           → newest threads
 *   search_by_date?tags=comment,story_<id>&numericFilters=created_at_i>…&page=N
 *                                                           → the window's comments
 * Each top-level comment is one company's post. Its first line usually reads
 * "Company | Role | Location | REMOTE | …". Threads go up at 11:00 New York
 * time on the first weekday of the month and most posts arrive in the first
 * 1-3 days, so short windows find few posts later in the month. A window
 * reaching back past the newest thread also reads last month's.
 * The thread asks posts to say REMOTE when remote candidates are welcome and
 * ONSITE when not, so the work mode comes from the header (then the next two
 * lines when the header names neither a place nor a mode): a remote word →
 * remote ("Onsite or Remote" too), else hybrid or on-site, and a header that
 * names a city or country without one is on-site. Who may apply is never
 * structured here: open-to.js rule 7 reads the posting (jbOpenToEurope), with
 * the header's place parts as the location ("REMOTE (EU)", "Remote (US only)",
 * "CET ±3h"), so a plain "Remote" with nothing about Europe is left out. A
 * remote part that names places or time zones wins over the office's city
 * ("Berlin, Germany | Remote (CET ±2h)" is open to European time zones).
 * Job-seeker posts, replies and posts without a header are skipped (not
 * scanned). Jobs link to the HN comment, with the post's ATS or careers link
 * as Direct URL.
 */

import { normalizeJob } from "../util.js";
import { expectArray } from "../http.js";

const API = "https://hn.algolia.com/api/v1";
const ITEM_URL = "https://news.ycombinator.com/item?id=";
const MAX_THREAD_AGE_DAYS = 45;
const HITS_PER_PAGE = 1000;
const MAX_PAGES = 3;
const HIRING_RE = /^Ask HN: Who is hiring\?/i;

// Not a letter or digit on that side (\b only knows ASCII)
const NB = "(?<![\\p{L}\\p{N}])";
const NA = "(?![\\p{L}\\p{N}])";
const words = (alts, flags = "i") => new RegExp(`${NB}(?:${alts})${NA}`, `u${flags}`);

const ROLE_RE =
  /\b(?:engineers?|developers?|swe|sde|programmers?|architects?|scientists?|designers?|devops|sre|cto|founding|full[- ]?stack|front[- ]?end|back[- ]?end|roles|positions)\b/i;
const GENERIC_ROLE_RE = /\b(?:multiple|various|several|many|all|open)\b.*\b(?:roles|positions)\b/i;
// Someone looking for work, not a company hiring ("SEEKING WORK | Remote | Python")
const SEEKER_RE =
  /\b(?:seeking\s+(?:work|freelance|contract|employment|opportunities|a\s+(?:new\s+)?(?:job|role|position))|looking\s+for\s+(?:a\s+)?(?:new\s+)?(?:job|work|role|position|contract)|open\s+to\s+work|available\s+for\s+(?:hire|work|contract)|for\s+hire)\b/i;
// The "Who wants to be hired?" template, posted in the wrong thread
const SEEKER_FORM_RE = /^\s*(?:location|willing to relocate|r[ée]sum[ée](?:\s*\/\s*cv)?)\s*:/i;

// The work mode. A remote word anywhere in the header wins: "Onsite or Remote", "Hybrid (NYC) or Remote (EU)"
const REMOTE_RE = words("remote(?:ly)?|wfh|work\\s+from\\s+home");
const NOT_REMOTE_RE = words("(?:no|not|non|isn'?t)[\\s-]+remote|remote\\s*:\\s*(?:no|none)");
const PARTLY_REMOTE_RE = words("(?:partial(?:ly)?|partly|part|semi)[\\s-]+remote|remote\\s+\\d\\s*(?:days?|d)\\s*(?:/|a|per)\\s*(?:week|wk)");
// Not "Hybrid Cloud", "hybrid apps"
const HYBRID_RE = words("hybrid(?![\\s-]+(?:cloud|apps?|mobile|infrastructure|systems?|search|vehicles?|quantum|work\\s+platform))");
const ONSITE_RE = words("on[\\s-]?site|in[\\s-](?:office|person)|office[\\s-]based");
const KIND_LABELS = { fulltime: "Full-time", contract: "Contract", other: "Part-time / intern / temp" };
const ATS_RE =
  /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters|recruitee|teamtailor|personio|bamboohr|rippling|workday|jobs\.|\/jobs|\/careers/i;

// Cities posts name without their country ("SF | ONSITE", "Berlin"); countries come from jbReadPlaces
const CITIES =
  "sf|nyc|bay\\s+area|san\\s+francisco|new\\s+york|boston|seattle|austin|chicago|denver|los\\s+angeles|san\\s+diego|miami|atlanta|" +
  "london|manchester|edinburgh|berlin|munich|hamburg|amsterdam|rotterdam|paris|dublin|stockholm|copenhagen|oslo|helsinki|zurich|geneva|" +
  "barcelona|madrid|lisbon|porto|warsaw|krakow|prague|vienna|budapest|milan|brussels|tallinn|toronto|vancouver|montreal|" +
  "tel\\s+aviv|bangalore|bengaluru|singapore|sydney|melbourne|tokyo";
const CITY_RE = words(CITIES);
// Place words a header part may hold besides cities, for telling "Remote, Berlin" from "Engineer, Platform"
const PLACE_WORDS =
  "europe|european|emea|eu|eea|uk|united\\s+kingdom|britain|england|ireland|germany|france|spain|netherlands|poland|portugal|italy|austria|" +
  "belgium|switzerland|sweden|norway|denmark|finland|estonia|latvia|lithuania|czechia|czech\\s+republic|romania|bulgaria|greece|hungary|" +
  "croatia|slovakia|slovenia|luxembourg|malta|cyprus|dach|nordics|benelux|cee|canada|india|israel|brazil|mexico|latam|latin\\s+america|" +
  "apac|asia|australia|singapore|japan|united\\s+states|usa?|north\\s+america|americas|worldwide|global(?:ly)?|anywhere|" +
  "cet|cest|eet|wet|gmt|utc|est|pst|cst|mst|et|pt|ct|mt";

// "acme.com", "jobs.lever.co/acme"; not "Engineer, ASP.NET" or "Socket.io"
const URL_RE =
  /https?:|www\.|\b[\w-]+\.(?:com|io|ai|co|org|net|dev|app|jobs|so|xyz|tech)\/|^[\w.-]+\.(?:com|io|ai|co|org|net|dev|app|jobs|so|xyz|tech)$/i;
// Pay amounts: "$150k", "USD 150k-190k", "$90-120/hr"
const PAY_AMOUNT_RE = /(?:[$€£]|\b(?:USD|EUR|GBP)\s?)\s?\d[\d,.]*\s*k?|\b\d+(?:\.\d+)?\s*k\b|\/\s*(?:hr|hour|yr|year)\b/gi;
// Pay runs to the end of a part: "— $180k + equity", ", 150k-200k", "up to $200k"
const PAY_TAIL_RE = /\s*(?:[-–—,:~@+]\s*|\bup\s+to\s+)*(?:(?:[$€£]|\b(?:USD|EUR|GBP)\s?)\s?\d|\b\d+(?:\.\d+)?\s*k\b).*$/i;
// Time-zone offsets: "±2h", "+/- 3 hours", "UTC+1"
const OFFSET_RE = /(?:\+\s*\/\s*-|±|[+-])\s*\d+(?:\.\d+)?\s*(?:h|hrs?|hours?)?\b/gi;
// Words that only say where, how, how long or for how much
const META_WORD_RE = new RegExp(
  String.raw`\b(?:remote|onsite|on-site|hybrid|in-office|office|visa(?:\s+sponsorship)?|equity|base|ote|full[- ]?time|part[- ]?time|contract(?:or)?|contract[- ]to[- ]hire|freelance|intern(?:ship)?|temporary|w2|1099|c2c|months?|weeks?|only|based|preferred|ok|okay|friendly|first|or|and|in|from|within|the|time ?zones?|timezones?|hours?|overlap|${PLACE_WORDS}|${CITIES})\b`,
  "gi"
);
const WORK_MODE_RE = /\b(?:remote|onsite|on-site|hybrid|in-office)\b/i;

const decode = (text) =>
  String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Comment HTML → plain lines. HN puts <p> between paragraphs (newer comments wrap them in <p>…</p>). */
function linesOf(html) {
  return decode(String(html || "").replace(/<\/?p>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The first line: comment HTML up to the first paragraph break. */
function headerOf(html) {
  const first = String(html || "")
    .replace(/^\s*<p>/i, "")
    .split(/<\/?p>|<br\s*\/?>|\n/i)[0];
  return decode(first.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 200);
}

function segmentsOf(header) {
  for (const sep of [/\s*\|\s*/, /\s+—\s+/, /\s+–\s+/, /\s+·\s+/]) {
    const parts = header.split(sep).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) return parts;
  }
  return [header];
}

const isPlaceOrMeta = (seg) =>
  REMOTE_RE.test(seg) ||
  /\b(?:onsite|on-site|hybrid|in-office|visa)\b/i.test(seg) ||
  /[$€£]|\b\d+k\b|\busd\b|\bequity\b/i.test(seg) ||
  URL_RE.test(seg) ||
  globalThis.jbEmploymentKinds(seg).length > 0;

/**
 * Only place, pay or employment type: "Remote, Europe", "$150k",
 * "Full-time", "Hybrid (NYC) or Remote". Not "US Payments" or "Smart
 * Contract Security", where a specialty is left over.
 */
function isMetaText(text) {
  const rest = text
    .replace(OFFSET_RE, " ")
    .replace(PAY_AMOUNT_RE, " ")
    .replace(META_WORD_RE, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .trim();
  if (!rest) return true;
  // A work mode plus a short place: "Remote/SF", "Hybrid (NYC) or Remote", "Remote (Estonia)"
  return WORK_MODE_RE.test(text) && /^(?:[A-Z][\p{L}.'-]*\s*){1,2}$/u.test(rest);
}

// The last part after " - ", "—", ",", ":" or "/"
const TAIL_RE = /(?:\s+-\s+|\s*[–—,:/]\s*)((?:(?!\s+-\s+|[–—,:/]).)+)$/;

/**
 * The role words of a header part: "Senior Engineer (Remote, EU)",
 * "Engineer, Full-time", "Engineer — $180k + equity" and "Engineer – EU only"
 * → "… Engineer". "Software Engineer (Backend)" keeps its specialty.
 */
function cleanRole(seg) {
  let s = seg
    .replace(/\(([^)]*)\)/g, (m, inner) => (isMetaText(inner) ? " " : m))
    .replace(PAY_TAIL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  for (let m = s.match(TAIL_RE); m && isMetaText(m[1]); m = s.match(TAIL_RE)) {
    s = s.slice(0, m.index).trim();
  }
  return s;
}

/** The role this post offers: a header part, else a short role line in the body. */
function titleOf(segments, bodyLines, titleQuery) {
  const roles = segments
    .slice(1)
    .map(cleanRole)
    // A part that names a role but is also pay, type or place stays; a link doesn't
    .filter(
      (s) =>
        s &&
        !URL_RE.test(s) &&
        // "Full-time roles", "Visa sponsorship for engineers" are not roles
        (ROLE_RE.test(s.replace(/\b(?:roles|positions)\b|\bfor\s+\w+\s*$/gi, "")) || !isPlaceOrMeta(s))
    );
  // "Remote (EU) for senior engineers" only when no plainer role part fits
  const pick = (ok) => roles.find((s) => ok(s) && !isPlaceOrMeta(s)) || roles.find(ok);
  if (titleQuery) {
    const hit = pick((s) => globalThis.jbTitleMatches(s, titleQuery));
    if (hit) return hit;
  }
  const role = pick((s) => ROLE_RE.test(s) && !GENERIC_ROLE_RE.test(s));
  if (role && !titleQuery) return role;
  // "Tech Lead", "QA Automation": a developer title without a role word, before any body line
  const dev = !titleQuery && roles.find((s) => !isPlaceOrMeta(s) && globalThis.jbIsDeveloperTitle(s));
  if (dev) return dev;
  // "Multiple roles": the body lists them
  const line = bodyLines.find(
    (l) => l.length <= 100 && (titleQuery ? globalThis.jbTitleMatches(l, titleQuery) : ROLE_RE.test(l))
  );
  return line || role || "";
}

/**
 * The bits of a header part that may say where: a role part's brackets and
 * tail ("Engineer (Hybrid)", "Engineer - Onsite", "Engineer, Berlin"), so
 * "Hybrid Cloud Engineer" is no work mode; any other part whole.
 */
function wherePieces(seg) {
  if (!ROLE_RE.test(seg)) return [seg];
  const brackets = [...seg.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  const tail = seg
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+[-–—]\s+|\s*[,:/;]\s*/)
    .slice(1);
  return [...brackets, ...tail].map((p) => p.trim()).filter(Boolean);
}

/** Does the text name a city or a country (a spot), or only a region ("EU", "CET")? */
function placesIn(text) {
  const read = globalThis.jbReadPlaces(text);
  const spot = CITY_RE.test(text) || read.names.length > 0 || read.outside.length > 0;
  return { spot, any: spot || Boolean(read.wide) || read.parts.length > 0 };
}

/** "remote" | "hybrid" | "onsite" from words alone, or null. */
function modeOf(text, { spots = false } = {}) {
  if (!text) return null;
  if (NOT_REMOTE_RE.test(text)) return "onsite";
  if (PARTLY_REMOTE_RE.test(text)) return "hybrid";
  if (REMOTE_RE.test(text)) return "remote";
  if (HYBRID_RE.test(text)) return "hybrid";
  if (ONSITE_RE.test(text)) return "onsite";
  // The thread asks for REMOTE when remote candidates are welcome: a place without it is on-site
  if (spots && placesIn(text).spot) return "onsite";
  return null;
}

/**
 * Where the work happens, from the header's parts after the company (and
 * the next two lines when they name neither a place nor a mode): "remote",
 * "hybrid", "onsite", or null (open-to.js then reads the posting).
 */
function workplaceOf(parts, nextLines) {
  const all = parts.join(" | ");
  const where = parts.flatMap(wherePieces).join(" | ");
  if (NOT_REMOTE_RE.test(all)) return "onsite";
  if (PARTLY_REMOTE_RE.test(all)) return "hybrid";
  if (REMOTE_RE.test(all)) return "remote";
  const mode = modeOf(where, { spots: true });
  if (mode) return mode;
  // A region alone ("Europe", "EU"): the posting decides
  if (placesIn(where).any) return null;
  // "Company | Role | Full-time": the next lines may say it; a city in a company blurb doesn't
  return modeOf(nextLines.join(" | "));
}

const ZONE_RE = /\b(?:cet|cest|eet|eest|wet|gmt|utc)\b|time\s*zones?|timezones?/i;

/**
 * The header's place parts: `shown`, the sheet's Location ("Berlin, Germany |
 * REMOTE"); `office`, the parts that only say where the office is. When a
 * remote part names places or time zones ("Berlin, Germany | Remote (CET
 * ±2h)"), it says who may apply and the office doesn't: only it is shown, and
 * the office parts leave the header line rule 7 reads.
 */
function locationOf(parts) {
  const pieces = parts
    .flatMap(wherePieces)
    .map((p) => p.replace(PAY_TAIL_RE, "").trim())
    .filter((p) => p && (WORK_MODE_RE.test(p) || placesIn(p).any));
  const remote = pieces.filter((p) => REMOTE_RE.test(p) && (placesIn(p).any || ZONE_RE.test(p)));
  if (!remote.length) return { shown: pieces.slice(0, 3), office: [] };
  return { shown: remote.slice(0, 3), office: pieces.filter((p) => !remote.includes(p)) };
}

/** The header line without the office parts, the company left as it is. */
function withoutOffice(line, company, office) {
  if (!office.length) return line;
  const at = line.indexOf(company);
  const start = at >= 0 ? at + company.length : 0;
  const rest = office.reduce((text, p) => text.replace(p, " "), line.slice(start));
  return `${line.slice(0, start)}${rest}`.replace(/\s+/g, " ").trim();
}

function directLink(html) {
  const links = [...String(html || "").matchAll(/href="([^"]+)"/gi)]
    .map((m) => decode(m[1]))
    .filter((u) => /^https?:\/\//i.test(u) && !/news\.ycombinator\.com/i.test(u));
  return links.find((u) => ATS_RE.test(u)) || links[0] || "";
}

const toIso = (sec) => {
  const n = Number(sec);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : "";
};

/** One top-level comment → a job, or null when it isn't a job post (a seeker, no header). */
export function toJob(hit, titleQuery = "") {
  const html = String(hit?.comment_text || "");
  const header = headerOf(html);
  const segments = segmentsOf(header);
  const lines = linesOf(html);
  if (segments.length < 2 || SEEKER_RE.test(header) || lines.slice(0, 3).some((l) => SEEKER_FORM_RE.test(l))) return null;
  const bodyLines = lines.slice(1).map((l) => l.replace(/^[*•·-]+\s*/, "").trim());
  // The company's own link or name isn't where the job is ("Remote.com", "Berlin Brands Group")
  const parts = segments.slice(1).filter((s) => !URL_RE.test(s));
  const workplace = workplaceOf(parts, bodyLines.slice(0, 2));
  const where = locationOf(parts);
  const company = segments[0]
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    ...normalizeJob({
      title: titleOf(segments, bodyLines, titleQuery),
      company,
      location: where.shown.join(" | ") || (workplace === "remote" ? "Remote" : ""),
      site: "hackernews",
      // "Contract Software Engineer" → "Contract", not the whole part
      listing_type: [...new Set(segments.flatMap((s) => globalThis.jbEmploymentKinds(s)))]
        .map((k) => KIND_LABELS[k])
        .join(", "),
      date_posted: toIso(hit.created_at_i),
      is_remote: workplace === "remote" ? true : workplace ? false : "",
      job_url: `${ITEM_URL}${hit.objectID}`,
      job_url_direct: directLink(html),
      description: [withoutOffice(lines[0] || "", segments[0], where.office), ...lines.slice(1)].join("\n"),
    }),
    _id: String(hit.objectID),
    _where: { workplace, listedIn: null, open: null, emptyOpen: null, utc: null, remoteOnly: false },
  };
}

const search = (params) =>
  `${API}/search_by_date?${new URLSearchParams({ ...params, attributesToHighlight: "none" })}`;

export async function run(ctx) {
  const { opts } = ctx;
  const hoursOld = opts.preset?.hoursOld || 24;
  const titleQuery = String(opts.title || "").trim();
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec - hoursOld * 3600;

  ctx.progress("Hacker News: finding the latest “Who is hiring?” thread…");
  const stories = await ctx.http.json(
    search({ tags: "story,author_whoishiring", hitsPerPage: "10", attributesToRetrieve: "objectID,title,created_at_i" })
  );
  // The account posts "Who wants to be hired?" and "Freelancer?" at the same moment
  const threads = expectArray(stories, "hits", "Hacker News search")
    .filter((h) => h && HIRING_RE.test(h.title || ""))
    .sort((a, b) => Number(b.created_at_i) - Number(a.created_at_i));
  const [latest, previous] = threads;
  if (!latest || nowSec - Number(latest.created_at_i) > MAX_THREAD_AGE_DAYS * 86400) {
    ctx.note(`Hacker News: no “Who is hiring?” thread in the last ${MAX_THREAD_AGE_DAYS} days`);
    return;
  }
  const ids = [String(latest.objectID)];
  if (previous && cutoffSec < Number(latest.created_at_i)) ids.push(String(previous.objectID));
  const storyTag = ids.length > 1 ? `(${ids.map((id) => `story_${id}`).join(",")})` : `story_${ids[0]}`;
  const name = `“${latest.title}”${ids.length > 1 ? " and last month's" : ""}`;

  let notPosts = 0;
  for (let page = 0; page < MAX_PAGES && !ctx.enough(); page++) {
    ctx.progress(`Hacker News: ${name} page ${page + 1} (${ctx.report.kept} kept)…`);
    const data = await ctx.http.json(
      search({
        tags: `comment,${storyTag}`,
        numericFilters: `created_at_i>${cutoffSec}`,
        hitsPerPage: String(HITS_PER_PAGE),
        page: String(page),
        attributesToRetrieve: "objectID,comment_text,created_at_i,parent_id,story_id,author",
      })
    );
    const hits = expectArray(data, "hits", "Hacker News comments");
    const jobs = [];
    // Top-level posts only: replies hang off other comments; flagged ones have no text
    for (const hit of hits) {
      if (!hit?.comment_text || !ids.includes(String(hit.parent_id))) continue;
      const job = toJob(hit, titleQuery);
      if (job) jobs.push(job);
      else notPosts += 1;
    }
    ctx.accept(jobs);
    if (!hits.length || page + 1 >= Number(data.nbPages || 1)) break;
  }
  if (notPosts) ctx.progress(`Hacker News: ${notPosts} top-level ${notPosts === 1 ? "comment was" : "comments were"} not a job post (job seekers, no header)`);
}
