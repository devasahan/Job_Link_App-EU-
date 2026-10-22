/**
 * Source fixtures: tests/fixtures/sources/<id>/routes.json plus body files,
 * written from each source's documented response shape. Node tests serve
 * them through fixtureFetch(); the e2e harness serves the same routes to
 * Chromium (context.route).
 *
 * routes.json: { "routes": [ { "method"?: "GET", "url": "https://host/path",
 *   "query"?: { "page": "2", "q": "*", "cursor": null }, "bodyIncludes"?: "…",
 *   "status"?: 200, "contentType"?: "application/json", "headers"?: {},
 *   "file": "page1.json" | "body": "…" | {…} } ] }
 * A route matches the method, the URL without its query, and every listed
 * query parameter ("*": present, null: absent; others are ignored); the
 * first match wins, so specific routes go first.
 *
 * Bodies may hold date tokens, filled when loaded so fixtures stay recent:
 *   {{ago:2h}} ISO, {{ago:40h|unix}} seconds, {{ago:3d|ms}}, {{ago:1d|date}}
 *   (YYYY-MM-DD), {{ago:30m|rfc822}} (RSS pubDate), {{in:5d}} a future date.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sources");

const UNIT_MS = { m: 60e3, h: 3600e3, d: 86400e3 };
const TOKEN_RE = /\{\{(ago|in):(\d+(?:\.\d+)?)([mhd])(?:\|(iso|unix|ms|date|rfc822))?\}\}/g;

/** Fill {{ago:…}} / {{in:…}} tokens relative to `now`. */
export function fillTokens(text, now = Date.now()) {
  return String(text).replace(TOKEN_RE, (_, dir, n, unit, format = "iso") => {
    const at = new Date(now + (dir === "ago" ? -1 : 1) * Number(n) * UNIT_MS[unit]);
    if (format === "unix") return String(Math.floor(at.getTime() / 1000));
    if (format === "ms") return String(at.getTime());
    if (format === "date") return at.toISOString().slice(0, 10);
    if (format === "rfc822") return at.toUTCString().replace("GMT", "+0000");
    return at.toISOString();
  });
}

/** Fixture folders that have a routes.json. */
export function fixtureIds() {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((id) => fs.existsSync(path.join(FIXTURES_DIR, id, "routes.json")))
    .sort();
}

/** One source's routes with their bodies loaded and tokens filled. */
export function loadRoutes(id, { now = Date.now() } = {}) {
  const dir = path.join(FIXTURES_DIR, id);
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "routes.json"), "utf8"));
  return (spec.routes || []).map((route) => {
    let body = route.body ?? "";
    if (route.file) body = fs.readFileSync(path.join(dir, route.file), "utf8");
    else if (typeof body !== "string") body = JSON.stringify(body);
    const contentType =
      route.contentType ||
      (/\.json$/.test(route.file || "") || typeof route.body === "object" ? "application/json" : /\.(xml|rss)$/.test(route.file || "") ? "application/rss+xml" : "text/html");
    return { method: "GET", status: 200, headers: {}, ...route, source: id, contentType, body: fillTokens(body, now) };
  });
}

/** Does the route answer this request? */
export function routeMatches(route, url, method = "GET", body = "") {
  const u = new URL(url);
  const r = new URL(route.url);
  if ((route.method || "GET").toUpperCase() !== String(method || "GET").toUpperCase()) return false;
  if (u.origin !== r.origin || u.pathname !== r.pathname) return false;
  for (const [key, want] of Object.entries(route.query || {})) {
    const have = u.searchParams.get(key);
    if (want === null ? have !== null : want === "*" ? have === null : have !== String(want)) return false;
  }
  if (route.bodyIncludes && !String(body || "").includes(route.bodyIncludes)) return false;
  return true;
}

export const findRoute = (routes, url, method, body) => routes.find((r) => routeMatches(r, url, method, body)) || null;

/**
 * A fetch stub serving `routes`. `respond(call, route)` may return
 * { status, body, headers, contentType, delay } to answer differently
 * (contract tests: 500s, 403s, a 429 on page 2), or null for the route.
 * calls: [{ url, method, host, start, end, status }]. An unknown URL is a 404.
 */
export function fixtureFetch(routes, { respond } = {}) {
  const calls = [];
  async function fetch(url, init = {}) {
    const method = init.method || "GET";
    const call = { url: String(url), method, host: new URL(url).host, start: Date.now(), end: 0, status: 0 };
    calls.push(call);
    try {
      const route = findRoute(routes, call.url, method, init.body);
      const custom = (await respond?.(call, route)) || null;
      const out = custom || route || { status: 404, body: `no fixture route for ${method} ${call.url}`, contentType: "text/plain" };
      if (out.delay) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, out.delay);
          init.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(init.signal.reason || new Error("aborted"));
          });
        });
      }
      if (init.signal?.aborted) throw init.signal.reason || new Error("aborted");
      call.status = out.status || 200;
      const body = typeof out.body === "string" ? out.body : JSON.stringify(out.body ?? "");
      return new Response(body, {
        status: call.status,
        headers: { "content-type": out.contentType || route?.contentType || "text/plain", ...(out.headers || {}) },
      });
    } finally {
      call.end = Date.now();
    }
  }
  return { fetch, calls };
}
