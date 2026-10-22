/**
 * JSON that pages embed for their own scripts: Next.js's __NEXT_DATA__,
 * <script type="application/json" id="…"> blocks, and objects assigned in
 * inline scripts ("window.__INITIAL_STATE__ = {…};"). String scanning only,
 * so it runs in Node tests; a missing block is null, a broken one throws.
 */

const SCRIPT_CLOSE = "</script";

/** The text inside the first <script …> whose start tag contains `marker`, or null. */
function scriptText(html, marker) {
  const text = String(html || "");
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("<script", i);
    if (at < 0) return null;
    const gt = text.indexOf(">", at);
    if (gt < 0) return null;
    const end = text.indexOf(SCRIPT_CLOSE, gt);
    if (end < 0) return null;
    if (text.slice(at, gt).includes(marker)) return text.slice(gt + 1, end);
    i = end + SCRIPT_CLOSE.length;
  }
  return null;
}

function parse(raw, what) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`malformed ${what} JSON: ${err.message}`);
  }
}

/** The JSON in <script id="…">, or null when the page has none. */
export function scriptJson(html, id) {
  const raw = scriptText(html, `id="${id}"`) ?? scriptText(html, `id='${id}'`);
  return raw == null ? null : parse(raw.trim(), id);
}

/** Next.js's page data (props.pageProps holds what the page shows), or null. */
export const nextData = (html) => scriptJson(html, "__NEXT_DATA__");

/** Index just past the JSON value (object, array or string) that starts at `at`, or -1. */
function valueEnd(text, at) {
  const open = text[at];
  if (open === '"') {
    for (let i = at + 1; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === '"') return i + 1;
    }
    return -1;
  }
  if (open !== "{" && open !== "[") return -1;
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The JSON value right after `marker` ("window.__STATE__ =", "\"jobs\":"),
 * skipping spaces, "=" and ":"; null when the marker or a whole value isn't there.
 */
export function jsonAfter(text, marker, from = 0) {
  const s = String(text || "");
  const at = s.indexOf(marker, from);
  if (at < 0) return null;
  let i = at + marker.length;
  while (i < s.length && /[\s=:]/.test(s[i])) i++;
  const end = valueEnd(s, i);
  if (end < 0) return null;
  try {
    return JSON.parse(s.slice(i, end));
  } catch {
    return null;
  }
}

/**
 * The first value, breadth first, for which `test(value, key)` is true:
 * pages move their data around ("props.pageProps.jobs" one month,
 * "props.pageProps.data.jobs.items" the next). Stops after `maxNodes`.
 */
export function findDeep(root, test, { maxNodes = 100000 } = {}) {
  const queue = [[root, ""]];
  for (let n = 0; n < queue.length && n < maxNodes; n++) {
    const [value, key] = queue[n];
    if (test(value, key)) return value;
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) if (v && typeof v === "object") queue.push([v, k]);
    }
  }
  return null;
}
