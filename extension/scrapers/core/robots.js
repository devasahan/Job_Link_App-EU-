/**
 * robots.txt for sources marked robots: "obey" (pages read like a visitor
 * would, not documented APIs). Rules come from the group for our own name
 * ("jobbridge") or else "*"; the longest matching Allow/Disallow path wins, an
 * Allow on a tie; "*" matches any run of characters and "$" ends the path, as
 * Google and RFC 9309 read them. Crawl-delay feeds the host's gap (http.js caps
 * it at 10 s). A missing robots.txt (4xx) allows everything; an unreachable
 * one too, since the request itself will say what is wrong. Each host's
 * rules are cached for a day.
 */

import { createCache } from "./cache.js";

const AGENT = "jobbridge";
const TTL_MS = 24 * 3600e3;
const MAX_BYTES = 500 * 1024;

/** Parse robots.txt into { rules: [{ allow, path }], delayMs } for our agent. */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text || "").slice(0, MAX_BYTES).split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      // Consecutive User-agent lines share one group
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [], delayMs: 0 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      // "Disallow:" with no path allows everything
      if (value) current.rules.push({ allow: field === "allow", path: value });
    } else if (field === "crawl-delay") {
      const s = Number(value);
      if (Number.isFinite(s) && s > 0) current.delayMs = Math.round(s * 1000);
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a && a !== "*" && AGENT.includes(a.replace(/\/.*/, ""))));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: chosen.flatMap((g) => g.rules),
    delayMs: Math.max(0, ...chosen.map((g) => g.delayMs)),
  };
}

/**
 * Does a robots path pattern match the path? "*" is any run, "$" at the end
 * anchors it. Greedy matching with one backtrack point per "*": linear in
 * practice, and never a regex built from the site's text.
 */
export function pathMatches(pattern, path) {
  const anchored = pattern.endsWith("$");
  const pat = anchored ? pattern.slice(0, -1) : pattern;
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < path.length) {
    if (p < pat.length && pat[p] !== "*" && pat[p] === path[s]) {
      p += 1;
      s += 1;
    } else if (p < pat.length && pat[p] === "*") {
      star = p++;
      mark = s;
    } else if (p >= pat.length && !anchored) {
      return true;
    } else if (star >= 0) {
      p = star + 1;
      s = ++mark;
    } else {
      return false;
    }
  }
  while (p < pat.length && pat[p] === "*") p += 1;
  return p >= pat.length;
}

/** Allowed by the parsed rules? The longest matching pattern wins; Allow wins a tie. */
export function isAllowed(parsed, pathAndQuery) {
  let best = null;
  for (const rule of parsed.rules) {
    if (!pathMatches(rule.path, pathAndQuery)) continue;
    const longer = !best || rule.path.length > best.path.length;
    const tieAllow = best && rule.path.length === best.path.length && rule.allow && !best.allow;
    if (longer || tieAllow) best = rule;
  }
  return !best || best.allow;
}

/**
 * @param {{ fetchText: (url: string, signal?: AbortSignal) => Promise<{ status: number, text: string }>,
 *           cache?: object, now?: () => number }} opts
 */
export function createRobots({ fetchText, cache, now = Date.now }) {
  const store = (cache || createCache({ now })).scope("robots");
  const pending = new Map();

  async function rulesFor(origin, signal) {
    if (pending.has(origin)) return pending.get(origin);
    const load = (async () => {
      const hit = await store.get(origin);
      if (hit) return hit;
      let parsed = { rules: [], delayMs: 0 };
      try {
        const { status, text } = await fetchText(`${origin}/robots.txt`, signal);
        if (status >= 200 && status < 300) parsed = parseRobots(text);
      } catch (err) {
        // Stopped: let the caller see it; unreachable: allow, the request will say why
        if (signal?.aborted) {
          pending.delete(origin);
          throw err;
        }
      }
      await store.set(origin, parsed, TTL_MS);
      return parsed;
    })();
    pending.set(origin, load);
    return load;
  }

  return {
    async allowed(url, signal) {
      const u = new URL(url);
      return isAllowed(await rulesFor(u.origin, signal), `${u.pathname}${u.search}`);
    },
    async crawlDelay(url, signal) {
      return (await rulesFor(new URL(url).origin, signal)).delayMs;
    },
  };
}
