/** Shared HTTP helpers for scrapers. */

import { createRobots } from "./core/robots.js";

export function isBlockedResponse(status, bodyText = "") {
  if (status === 403 || status === 429 || status === 503) return true;
  const t = String(bodyText || "").slice(0, 800).toLowerCase();
  return (
    t.includes("security | glassdoor") ||
    t.includes("cf-browser-verification") ||
    t.includes("attention required") ||
    t.includes("just a moment...") ||
    t.includes("access denied")
  );
}

export function blockedError(site, status, bodyText = "") {
  const snip = String(bodyText || "").replace(/\s+/g, " ").slice(0, 120);
  if (site === "glassdoor") {
    return new Error(
      `Glassdoor HTTP ${status} (blocked). Open https://www.glassdoor.com in a normal tab, pass any security check, then retry.`
    );
  }
  if (site === "indeed" && status === 429) {
    return new Error("Indeed is limiting requests (HTTP 429). Wait a few minutes, then retry.");
  }
  if (site === "indeed" && status === 503) {
    return new Error("Indeed is temporarily unavailable (HTTP 503). Try again later.");
  }
  if (site === "indeed") {
    return new Error(
      `Indeed HTTP ${status}. Reload the extension so header rules install (Indeed requires a special User-Agent).`
    );
  }
  return new Error(
    `${site} HTTP ${status}${snip ? `: ${snip}` : ""}`
  );
}

// Raw control characters some APIs leave in their JSON (Himalayas): JSON.parse refuses them
const cleanJsonText = (raw) => raw.replace(/[\u0000-\u001f]/g, (c) => (/[\n\r\t]/.test(c) ? " " : ""));

/**
 * Parse a JSON API response. A block page is only suspected when the body
 * isn't JSON: job text inside real JSON can say "access denied".
 */
export async function readJson(res, site, label = site) {
  const raw = cleanJsonText(await res.text());
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    throw blockedError(site, res.status, raw);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    if (isBlockedResponse(res.status, raw)) throw blockedError(site, res.status, raw);
    throw new Error(`${label} returned non-JSON (HTTP ${res.status})`);
  }
  return data;
}

/**
 * Why a source's request failed. `kind` is what the run report and the
 * contract tests read:
 *   http     an HTTP error after the retry (404, 500…)
 *   blocked  403, 503, a 429 that didn't clear, or a challenge page
 *   network  no answer at all (DNS, connection reset, CORS)
 *   timeout  no answer within the request timeout
 *   format   not the answer the adapter expects (HTML for JSON, a missing array)
 *   robots   robots.txt disallows the path
 *   aborted  the run was stopped (Stop, the source's time budget, the run's cap)
 *   skipped  nothing to do for this run (no site for the ticked countries)
 */
export class SourceError extends Error {
  constructor(kind, message, { status, url } = {}) {
    super(message);
    this.name = "SourceError";
    this.kind = kind;
    if (status != null) this.status = status;
    if (url) this.url = url;
  }
}

/** host/path of a URL, for messages: "himalayas.app/jobs/api/search". */
export function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return String(url || "");
  }
}

function keysOf(value) {
  if (Array.isArray(value)) return `array of ${value.length}`;
  if (!value || typeof value !== "object") return typeof value;
  const keys = Object.keys(value);
  return `keys: ${keys.slice(0, 12).join(", ") || "none"}${keys.length > 12 ? ", …" : ""}`;
}

/**
 * The array at `path` ("jobs", "data.items"; several paths: the first that is
 * an array) or a format error naming what came back instead, so a changed API
 * reads "unexpected response (keys: message, status)" in the report.
 */
export function expectArray(data, path, what = "") {
  const paths = Array.isArray(path) ? path : [path];
  for (const p of paths) {
    let value = data;
    for (const key of String(p || "").split(".").filter(Boolean)) value = value?.[key];
    if (Array.isArray(value)) return value;
  }
  throw new SourceError("format", `unexpected response${what ? ` from ${what}` : ""} (${keysOf(data)})`);
}

/**
 * The JSON in an answer from client.request() ({ status, url, text }), or a
 * format error that says what came back instead; a challenge page is blocked.
 */
export function parseJson({ status, url, text }) {
  const raw = cleanJsonText(text);
  try {
    return JSON.parse(raw);
  } catch {
    if (isBlockedResponse(status, raw)) {
      throw new SourceError("blocked", `a challenge page, not JSON, at ${shortUrl(url)}`, { status, url });
    }
    const kind = /^\s*</.test(raw) ? "HTML" : raw.trim() ? "text" : "an empty answer";
    throw new SourceError("format", `returned ${kind}, not JSON (HTTP ${status}) at ${shortUrl(url)}`, { status, url });
  }
}

const SAMPLE_BYTES = 2048;
const MAX_SAMPLES = 12;
// Response headers the report may show: never cookies
const SAMPLE_HEADERS = ["content-type", "server", "retry-after", "cf-mitigated", "location", "x-robots-tag"];
const RETRY_AFTER_MAX_S = 30;
// A 429 that doesn't say how long is often a moment's throttle: waited out as a short Retry-After
const RETRY_AFTER_DEFAULT_S = 5;
const ROBOTS_DELAY_MAX_MS = 10000;

const abortedError = (signal) =>
  signal?.reason instanceof SourceError ? signal.reason : new SourceError("aborted", "stopped");

function sleepFor(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    const stop = () => {
      done();
      reject(abortedError(signal));
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
  });
}

/** Seconds from a Retry-After header (seconds or an HTTP date), or null. */
function retryAfterSeconds(value, now) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const at = Date.parse(s);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now()) / 1000));
}

/**
 * Polite HTTP for every source but Indeed:
 *   - one request in flight per host, with a gap after each answer: the
 *     source's gap for that host, or robots.txt's Crawl-delay (at most 10 s)
 *     when larger, 1 s by default; different hosts run in parallel, up to 6
 *     requests in all;
 *   - one retry on a 5xx (not 503) or a network error; a 429 waits out
 *     Retry-After once when it is 30 s or less (5 s when it has none), and
 *     so does every request to that host; 403, 503 and a 429 that doesn't
 *     clear count as blocked;
 *   - a 2 KB sample of each URL path's answer is kept for the run report.
 * `scale` shortens every wait (tests); `fetch` replaces the network (tests).
 * client(meta, { signal }) gives one source its view: its gaps, its robots
 * rule ("obey" checks robots.txt before each request), its request timeout
 * (meta.timeoutMs, 20 s by default) and its samples.
 */
export function createHttp({
  fetch: doFetch = (...args) => globalThis.fetch(...args),
  maxInFlight = 6,
  defaultGapMs = 1000,
  timeoutMs = 20000,
  scale = 1,
  cache = null,
  now = Date.now,
} = {}) {
  const hosts = new Map();
  let inFlight = 0;
  const waiting = [];

  const hostState = (host) => {
    if (!hosts.has(host)) hosts.set(host, { tail: Promise.resolve(), lastEnd: 0, pauseUntil: 0 });
    return hosts.get(host);
  };

  /**
   * One of the requests in flight. A stopped request leaves the queue at once,
   * and one woken after its stop hands the wake-up on: else the request
   * behind it would wait for a slot that is already free.
   */
  async function slot(signal) {
    while (inFlight >= maxInFlight) {
      if (signal?.aborted) throw abortedError(signal);
      await new Promise((resolve, reject) => {
        const wake = () => {
          signal?.removeEventListener("abort", stop);
          resolve();
        };
        const stop = () => {
          const at = waiting.indexOf(wake);
          if (at >= 0) waiting.splice(at, 1);
          reject(abortedError(signal));
        };
        waiting.push(wake);
        signal?.addEventListener("abort", stop, { once: true });
      });
      if (signal?.aborted) {
        waiting.shift()?.();
        throw abortedError(signal);
      }
    }
    inFlight += 1;
  }
  function release() {
    inFlight -= 1;
    waiting.shift()?.();
  }

  /** Runs `task` when the host is free, its gap has passed and no Retry-After pause holds it. */
  function onHost(host, gapMs, signal, task) {
    const state = hostState(host);
    const run = state.tail.then(async () => {
      if (signal?.aborted) throw abortedError(signal);
      const wait = Math.max(state.lastEnd ? state.lastEnd + gapMs * scale : 0, state.pauseUntil) - now();
      await sleepFor(wait, signal);
      await slot(signal);
      try {
        return await task();
      } finally {
        release();
        state.lastEnd = now();
      }
    });
    // The next request waits for this one, whatever its outcome
    state.tail = run.catch(() => {});
    return run;
  }

  /** One fetch with the request timeout and the source's signal. */
  async function once(url, init, signal, limitMs = timeoutMs) {
    const timeout = AbortSignal.timeout(limitMs);
    const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await doFetch(url, { ...init, signal: both });
      const text = await res.text();
      return { res, text };
    } catch (err) {
      if (signal?.aborted) throw abortedError(signal);
      if (timeout.aborted) {
        throw new SourceError("timeout", `no answer in ${Math.round(limitMs / 1000)} s at ${shortUrl(url)}`, { url });
      }
      throw new SourceError("network", `network error at ${shortUrl(url)}: ${err?.message || err}`, { url });
    }
  }

  // robots.txt is fetched through the same host queue, never checked against itself
  const robots = createRobots({
    cache,
    now,
    fetchText: async (url, signal) => {
      const host = new URL(url).host;
      const { res, text } = await onHost(host, 0, signal, () => once(url, { headers: { accept: "text/plain" } }, signal));
      return { status: res.status, text };
    },
  });

  function client(meta = {}, { signal } = {}) {
    const samples = new Map();
    let requests = 0;
    // A source whose answers are large (Ashby's boards carry every posting) may wait longer
    const limitMs = meta.timeoutMs || timeoutMs;

    function sample(url, method, res, text) {
      let key;
      try {
        const u = new URL(url);
        key = `${method} ${u.host}${u.pathname}`;
      } catch {
        key = `${method} ${url}`;
      }
      // The first answer per path, replaced by a later failure: failures are what the report is for
      if (samples.has(key) && (res.ok || !samples.get(key).ok)) return;
      if (!samples.has(key) && samples.size >= MAX_SAMPLES) return;
      const headers = {};
      for (const name of SAMPLE_HEADERS) {
        const value = res.headers?.get?.(name);
        if (value) headers[name] = value;
      }
      samples.set(key, { method, url, status: res.status, ok: res.ok, headers, body: text.slice(0, SAMPLE_BYTES) });
    }

    async function gapFor(host) {
      const own = meta.gaps?.[host] ?? defaultGapMs;
      if (meta.robots !== "obey") return own;
      const delay = await robots.crawlDelay(`https://${host}/`, signal);
      return Math.max(own, Math.min(ROBOTS_DELAY_MAX_MS, delay));
    }

    /**
     * The answer as { status, ok, url, headers, text }. Statuses in `allow`
     * (e.g. [404]) come back instead of throwing.
     */
    async function request(method, url, { headers = {}, body, allow = [] } = {}) {
      if (signal?.aborted) throw abortedError(signal);
      const u = new URL(url);
      if (meta.robots === "obey" && !(await robots.allowed(url, signal))) {
        throw new SourceError("robots", `robots.txt disallows ${u.pathname} on ${u.host}`, { url });
      }
      const gap = await gapFor(u.host);
      const init = { method, headers };
      if (body != null) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
        if (typeof body !== "string" && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
          init.headers = { ...headers, "content-type": "application/json" };
        }
      }
      const attempt = () =>
        onHost(u.host, gap, signal, async () => {
          requests += 1;
          const out = await once(url, init, signal, limitMs);
          // A short Retry-After pauses the whole host, set before the next request in its queue starts
          if (out.res.status === 429) {
            const wait = retryAfterSeconds(out.res.headers?.get?.("retry-after"), now) ?? RETRY_AFTER_DEFAULT_S;
            if (wait <= RETRY_AFTER_MAX_S) {
              const state = hostState(u.host);
              state.pauseUntil = Math.max(state.pauseUntil, now() + wait * 1000 * scale);
              out.paused = true;
            }
          }
          return out;
        });

      // One retry in all: a network error, a timeout or a server error (503 is a block)
      let retried = false;
      let out;
      try {
        out = await attempt();
      } catch (err) {
        if (err.kind !== "network" && err.kind !== "timeout") throw err;
        retried = true;
        out = await attempt();
      }
      if (!retried && out.res.status >= 500 && out.res.status !== 503 && !allow.includes(out.res.status)) {
        sample(url, method, out.res, out.text);
        out = await attempt();
      }
      // Once, after the host's pause (set above), which holds every other request to that host too
      if (out.paused) {
        sample(url, method, out.res, out.text);
        out = await attempt();
      }
      const { res, text } = out;
      sample(url, method, res, text);
      if (allow.includes(res.status) || res.ok) {
        return { status: res.status, ok: res.ok, url, headers: res.headers, text };
      }
      const at = shortUrl(url);
      if (res.status === 403 || res.status === 429 || res.status === 503) {
        const why = { 403: "blocked", 429: "rate-limited", 503: "blocked or down" }[res.status];
        throw new SourceError("blocked", `HTTP ${res.status} (${why}) at ${at}`, { status: res.status, url });
      }
      throw new SourceError("http", `HTTP ${res.status} at ${at}`, { status: res.status, url });
    }

    /** Parsed JSON, or a format error that says what came back instead. */
    async function json(url, opts = {}) {
      const res = await request(opts.method || "GET", url, {
        ...opts,
        headers: { accept: "application/json", ...(opts.headers || {}) },
      });
      return parseJson(res);
    }

    /** The body as text (HTML, RSS); a challenge page counts as blocked. */
    async function text(url, opts = {}) {
      const res = await request(opts.method || "GET", url, opts);
      if (isBlockedResponse(res.status, res.text) && /<html|<!doctype/i.test(res.text.slice(0, 400))) {
        throw new SourceError("blocked", `a challenge page at ${shortUrl(url)}`, { status: res.status, url });
      }
      return res.text;
    }

    return {
      request,
      get: (url, opts) => request("GET", url, opts),
      json,
      text,
      post: (url, body, opts = {}) => json(url, { ...opts, method: "POST", body }),
      samples: () => [...samples.values()],
      requests: () => requests,
    };
  }

  return { client, robots };
}
