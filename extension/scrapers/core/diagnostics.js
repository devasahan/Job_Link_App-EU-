/**
 * What each source did, in one shared format: the counters every check
 * keeps, the run log's per-source line and the "Left out" list. The counters
 * always balance: scanned = kept + Σ dropped (own duplicates are counted
 * apart, before scanning).
 */

/** Why a job was left out, in the order the run log lists them. */
export const REASONS = {
  // "not matching the title" when a Title is typed
  title: "not developer roles",
  // "older than 24 hours": the Posted window's span
  old: "older than the Posted window",
  expired: "expired",
  type: "other job types",
  years: "asking for more years",
  stack: "without the stack words",
  notRemote: "hybrid or not remote",
  elsewhere: "placed in other countries",
  abroadOff: "in countries not ticked under Employers abroad",
  inHome: "in your country",
  residentsOnly: "only for people living in their country",
  restricted: "limited to other countries",
  notOpen: "not open to Europe",
};

export const emptyDropped = () => Object.fromEntries(Object.keys(REASONS).map((k) => [k, 0]));

const titled = (title) =>
  globalThis.jbTitleQueryPhrases ? globalThis.jbTitleQueryPhrases(title).length > 0 : Boolean(String(title || "").trim());

/** The label for one reason, with the run's Title and Posted span. */
export function reasonLabel(key, { title, span } = {}) {
  if (key === "title") return titled(title) ? "not matching the title" : REASONS.title;
  if (key === "old" && span) return `older than ${span}`;
  return REASONS[key] || key;
}

/** "1 not developer roles, 2 older than 24 hours" (reasons with a count only). */
export function leftOut(dropped, opts = {}) {
  const known = Object.keys(REASONS);
  const keys = [...known, ...Object.keys(dropped || {}).filter((k) => !known.includes(k))];
  return keys
    .filter((k) => dropped?.[k])
    .map((k) => `${dropped[k]} ${reasonLabel(k, opts)}`)
    .join(", ");
}

const sum = (dropped) => Object.values(dropped || {}).reduce((a, n) => a + (Number(n) || 0), 0);

/** scanned = kept + Σ dropped, for the source and each of its parts. */
export function invariantHolds(report) {
  const balanced = (r) => r.scanned === r.kept + sum(r.dropped);
  return balanced(report) && Object.values(report.parts || {}).every(balanced);
}

/** A fresh report for one source. */
export function newReport(meta, { title = "", span = "", wanted = 0 } = {}) {
  return {
    id: meta.id,
    label: meta.label || meta.id,
    group: meta.group || "",
    status: "running",
    scanned: 0,
    kept: 0,
    dropped: emptyDropped(),
    duplicates: 0,
    // Kept jobs the source itself merged into another of its rows (Indeed's countries)
    merged: 0,
    error: "",
    errorKind: "",
    failures: [],
    notes: [],
    parts: {},
    requests: 0,
    ms: 0,
    samples: [],
    wanted,
    title,
    span,
  };
}

function partsText(report) {
  const parts = Object.values(report.parts || {});
  if (!parts.length) return "";
  const failed = parts.filter((p) => p.error && !p.kept).length;
  // A careers source's parts are its companies
  const [one, many] = report.group === "careers" ? ["company", "companies"] : ["part", "parts"];
  return ` (${parts.length} ${parts.length === 1 ? one : many}${failed ? `, ${failed} failed` : ""})`;
}

/**
 * Copy report's line for one part (a company):
 *   "GitLab (gitlab): 40 jobs listed, 12 scanned → 3 kept"
 *   "Mozilla (mozilla): not found (HTTP 404)"
 *   "Acme (acme): failed: HTTP 500 at boards-api.greenhouse.io/v1/boards/acme/jobs"
 */
export function partLine(name, part) {
  const who = part.key && part.key !== name ? `${name} (${part.key})` : name;
  const counts = `${part.scanned} scanned → ${part.kept} kept`;
  if (part.error) return `${who}: failed: ${part.error}${part.scanned ? ` (${counts})` : ""}`;
  if (part.note && !part.scanned) return `${who}: ${part.note}`;
  return `${who}: ${part.note ? `${part.note}, ` : ""}${counts}`;
}

/**
 * The run log's line for a source:
 *   "Himalayas: 120 scanned → 14 kept. Left out: 80 not developer roles, …"
 *   "Himalayas: 40 scanned → 5 kept. Left out: …. Stopped early: HTTP 429 (rate-limited) at …"
 *   "Himalayas failed: HTTP 403 (blocked) at himalayas.app/jobs/api/search"
 *   "Freelancer skipped: Type is Full time"
 */
export function sourceLine(report) {
  const label = report.label || report.id;
  if (report.status === "skipped") return `${label} skipped: ${report.error || "nothing to search"}`;
  const why = leftOut(report.dropped, report);
  const counts = `${report.scanned} scanned → ${report.kept} kept${partsText(report)}${why ? `. Left out: ${why}` : ""}`;
  if (report.status === "failed") {
    return `${label} failed: ${report.error || "no answer"}${report.scanned ? ` (${counts})` : ""}`;
  }
  const stopped = report.status === "incomplete" ? `. Stopped early: ${report.error || "see the log"}` : "";
  return `${label}: ${counts}${stopped}`;
}

/** Check sources mode: does the source answer, and with jobs? */
export function checkLine(report) {
  const label = report.label || report.id;
  const secs = report.ms ? ` (${(report.ms / 1000).toFixed(1)} s)` : "";
  if (report.status === "skipped") return `${label}: skipped · ${report.error}`;
  if (report.status === "failed") return `${label}: FAILED · ${report.error || "no answer"}${secs}`;
  if (!report.scanned) return `${label}: answered, but no jobs in the last 7 days${secs}`;
  const partial = report.status === "incomplete" ? ` · stopped early: ${report.error}` : "";
  return `${label}: OK · ${report.scanned} scanned → ${report.kept} kept${partial}${secs}`;
}

/** Did the source fail or keep nothing? Its response samples go into Copy report. */
export const needsSamples = (report) => report.status === "failed" || (report.status !== "skipped" && !report.kept);

/**
 * Copy report: the run log, each source's line, a line per company of each
 * careers source (so a stale board token shows), and the response samples of
 * the sources that failed or kept nothing (status, a few headers, the first
 * 2 KB), so a live failure can be fixed from what the site really sent. Samples
 * never hold cookies (http.js keeps a short header list).
 */
export function reportText({ version = "", mode = "run", at = new Date(), log = "", reports = [], merged = 0, skipped = 0 }) {
  const check = mode === "check";
  const lines = [
    `JobBridge EU ${version} · ${check ? "source check" : "run"} · ${at.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "Results by source",
    ...reports.map((r) => `- ${check ? checkLine(r) : sourceLine(r)}`),
  ];
  if (!check) lines.push(`${merged} duplicates merged, ${skipped} already downloaded`);
  for (const r of reports) {
    const parts = Object.entries(r.parts || {});
    if (r.group !== "careers" || !parts.length) continue;
    lines.push("", `${r.label} by company`, ...parts.map(([name, part]) => `- ${partLine(name, part)}`));
  }
  lines.push("", "Log", log.trim());
  const sampled = reports.filter((r) => needsSamples(r) && r.samples?.length);
  if (sampled.length) {
    lines.push("", "Response samples (sources that failed or kept nothing)");
    for (const r of sampled) {
      lines.push("", `== ${r.label} ==`);
      for (const s of r.samples) {
        const headers = Object.entries(s.headers || {}).map(([k, v]) => `${k}: ${v}`);
        lines.push(`${s.method} ${s.url} → HTTP ${s.status}`, ...headers, s.body, "");
      }
    }
  }
  return lines.join("\n").trim() + "\n";
}
