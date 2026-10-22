import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/env.js";
import { createHttp, expectArray, SourceError } from "../extension/scrapers/http.js";
import { createCache, memoryStorage } from "../extension/scrapers/core/cache.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch stub: `respond(url, n)` gives { status, body, headers, delay } or throws; calls keep start/end times. */
function fakeFetch(respond) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), host: new URL(url).host, method: init.method || "GET", start: Date.now(), end: 0 };
    calls.push(call);
    const n = calls.filter((c) => c.url === call.url).length;
    try {
      const out = (await respond(call.url, n, init)) || {};
      if (out.delay) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, out.delay);
          init.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(init.signal.reason);
          });
        });
      }
      const body = typeof out.body === "string" ? out.body : JSON.stringify(out.body ?? {});
      return new Response(body, { status: out.status || 200, headers: out.headers || {} });
    } finally {
      call.end = Date.now();
    }
  };
  return { fetch, calls };
}

const memCache = () => createCache({ storage: memoryStorage() });
const meta = (extra = {}) => ({ id: "test", label: "Test", gaps: {}, robots: "api", ...extra });

test("one request in flight per host, with the gap after each answer; hosts run in parallel", async () => {
  const { fetch, calls } = fakeFetch(() => ({ body: { ok: 1 }, delay: 20 }));
  const http = createHttp({ fetch, cache: memCache() });
  const client = http.client(meta({ gaps: { "a.test": 60 } }));
  const t0 = Date.now();
  await Promise.all([
    client.json("https://a.test/1"),
    client.json("https://a.test/2"),
    client.json("https://a.test/3"),
    client.json("https://b.test/1"),
    client.json("https://b.test/2"),
  ]);
  const a = calls.filter((c) => c.host === "a.test");
  for (let i = 1; i < a.length; i++) assert.ok(a[i].start >= a[i - 1].end + 58, `gap ${a[i].start - a[i - 1].end} ms`);
  // b.test (default gap 1 s) started at once, alongside a.test
  const b = calls.filter((c) => c.host === "b.test");
  assert.ok(b[0].start - t0 < 15);
  assert.ok(b[1].start >= b[0].end + 990);
});

test("at most 6 requests in flight in all", async () => {
  let now = 0;
  let peak = 0;
  const { fetch } = fakeFetch(async () => {
    now += 1;
    peak = Math.max(peak, now);
    await wait(15);
    now -= 1;
    return { body: {} };
  });
  const client = createHttp({ fetch, cache: memCache() }).client(meta());
  await Promise.all(Array.from({ length: 10 }, (_, i) => client.json(`https://h${i}.test/`)));
  assert.equal(peak, 6);
});

test("a stopped request waiting for a slot leaves the queue at once; the one behind it still gets the slot", async () => {
  const { fetch, calls } = fakeFetch((url) => ({ body: {}, delay: url.includes("a.test") ? 80 : 5 }));
  // One slot stands in for six busy hosts
  const http = createHttp({ fetch, maxInFlight: 1, cache: memCache() });
  const stopB = new AbortController();
  const a = http.client(meta()).json("https://a.test/1");
  await wait(10);
  const b = http.client(meta(), { signal: stopB.signal }).json("https://b.test/1");
  const c = http.client(meta()).json("https://c.test/1");
  await wait(10);
  const t0 = Date.now();
  stopB.abort(new SourceError("aborted", "stopped by you"));
  await assert.rejects(b, (err) => err.kind === "aborted" && err.message === "stopped by you");
  assert.ok(Date.now() - t0 < 40, "not when A's slot frees");
  await a;
  await c;
  assert.deepEqual(calls.map((x) => x.host), ["a.test", "c.test"]);
});

test("a server error or a network error is retried once", async () => {
  const flaky = fakeFetch((url, n) => (n === 1 ? { status: 500, body: "oops" } : { body: { jobs: [1] } }));
  assert.deepEqual(await createHttp({ fetch: flaky.fetch, scale: 0.01, cache: memCache() }).client(meta()).json("https://x.test/a"), {
    jobs: [1],
  });
  assert.equal(flaky.calls.length, 2);

  const down = fakeFetch(() => ({ status: 502, body: "bad gateway" }));
  const client = createHttp({ fetch: down.fetch, scale: 0.01, cache: memCache() }).client(meta());
  await assert.rejects(client.json("https://x.test/a"), (err) => err.kind === "http" && /HTTP 502 at x\.test\/a/.test(err.message));
  assert.equal(down.calls.length, 2);

  const offline = fakeFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  const c2 = createHttp({ fetch: offline.fetch, scale: 0.01, cache: memCache() }).client(meta());
  await assert.rejects(c2.json("https://x.test/a"), (err) => err.kind === "network" && /Failed to fetch/.test(err.message));
  assert.equal(offline.calls.length, 2);
});

test("403 and 503 are blocked at once; a 429 waits out a short Retry-After once", async () => {
  for (const status of [403, 503]) {
    const { fetch, calls } = fakeFetch(() => ({ status, body: "<html>no</html>" }));
    const client = createHttp({ fetch, scale: 0.01, cache: memCache() }).client(meta());
    await assert.rejects(client.text("https://x.test/p"), (err) => err.kind === "blocked" && err.status === status);
    assert.equal(calls.length, 1);
  }
  const once = fakeFetch((url, n) => (n === 1 ? { status: 429, headers: { "retry-after": "2" } } : { body: { a: 1 } }));
  const t0 = Date.now();
  assert.deepEqual(await createHttp({ fetch: once.fetch, scale: 0.01, cache: memCache() }).client(meta()).json("https://x.test/p"), { a: 1 });
  assert.ok(Date.now() - t0 >= 18);
  // Too long, missing, or a second 429: blocked
  for (const headers of [{ "retry-after": "120" }, {}]) {
    const { fetch, calls } = fakeFetch(() => ({ status: 429, headers }));
    const client = createHttp({ fetch, scale: 0.01, cache: memCache() }).client(meta());
    await assert.rejects(client.json("https://x.test/p"), (err) => err.kind === "blocked" && /429 \(rate-limited\)/.test(err.message));
    assert.equal(calls.length, 1);
  }
  const twice = fakeFetch(() => ({ status: 429, headers: { "retry-after": "1" } }));
  await assert.rejects(createHttp({ fetch: twice.fetch, scale: 0.01, cache: memCache() }).client(meta()).json("https://x.test/p"), /429/);
  assert.equal(twice.calls.length, 2);
});

test("a 429's Retry-After pauses its whole host, not only the request that got it", async () => {
  const { fetch, calls } = fakeFetch((url, n) =>
    url.endsWith("x.test/1") && n === 1 ? { status: 429, headers: { "retry-after": "3" } } : { body: {} }
  );
  // 3 s × 0.02 = a 60 ms pause
  const client = createHttp({ fetch, scale: 0.02, cache: memCache() }).client(meta({ gaps: { "x.test": 10 } }));
  await Promise.all([
    client.json("https://x.test/1"),
    client.json("https://x.test/2"),
    client.json("https://x.test/3"),
    client.json("https://y.test/1"),
  ]);
  const x = calls.filter((c) => c.host === "x.test");
  assert.deepEqual(x.map((c) => new URL(c.url).pathname), ["/1", "/2", "/3", "/1"]);
  for (const c of x.slice(1)) assert.ok(c.start - x[0].end >= 55, `${c.url} ${c.start - x[0].end} ms after the 429`);
  // Other hosts go on
  assert.ok(calls.find((c) => c.host === "y.test").start - x[0].start < 30);
});

test("an answer that isn't JSON says what it was; a challenge page is blocked", async () => {
  const html = fakeFetch(() => ({ body: "<!doctype html><html><body>Jobs</body></html>" }));
  await assert.rejects(
    createHttp({ fetch: html.fetch, cache: memCache() }).client(meta()).json("https://x.test/api"),
    (err) => err.kind === "format" && err.message === "returned HTML, not JSON (HTTP 200) at x.test/api"
  );
  const cf = fakeFetch(() => ({ body: "<html><title>Just a moment...</title></html>" }));
  await assert.rejects(createHttp({ fetch: cf.fetch, cache: memCache() }).client(meta()).json("https://x.test/api"), (err) => err.kind === "blocked");
  await assert.rejects(createHttp({ fetch: cf.fetch, cache: memCache() }).client(meta()).text("https://x.test/page"), (err) => err.kind === "blocked");
  // Raw control characters inside JSON strings are dropped, as readJson does
  const ctrl = fakeFetch(() => ({ body: '{"t":"a\u0001b"}' }));
  assert.deepEqual(await createHttp({ fetch: ctrl.fetch, cache: memCache() }).client(meta()).json("https://x.test/api"), { t: "ab" });
  // A status the adapter handles itself comes back
  const missing = fakeFetch(() => ({ status: 404, body: "gone" }));
  const res = await createHttp({ fetch: missing.fetch, cache: memCache() }).client(meta()).get("https://x.test/old", { allow: [404] });
  assert.equal(res.status, 404);
});

test("2 KB samples per path, no cookies, a failure replacing the first answer", async () => {
  const { fetch } = fakeFetch((url) =>
    /fail/.test(url)
      ? { status: 404, body: "not here", headers: { "set-cookie": "sid=secret", "content-type": "text/plain" } }
      : { body: { big: "x".repeat(5000) }, headers: { "content-type": "application/json", "set-cookie": "sid=secret" } }
  );
  const client = createHttp({ fetch, cache: memCache() }).client(meta({ gaps: { "x.test": 0 } }));
  await client.json("https://x.test/jobs?page=1");
  await client.json("https://x.test/jobs?page=2");
  await assert.rejects(client.json("https://x.test/fail"));
  const samples = client.samples();
  assert.equal(samples.length, 2);
  assert.equal(samples[0].url, "https://x.test/jobs?page=1");
  assert.equal(samples[0].body.length, 2048);
  assert.deepEqual(samples[0].headers, { "content-type": "application/json" });
  assert.equal(samples[1].status, 404);
  assert.ok(!JSON.stringify(samples).includes("secret"));
  assert.equal(client.requests(), 3);
});

test("a stopped source's requests end at once, with the stop's reason", async () => {
  const { fetch } = fakeFetch(() => ({ body: {}, delay: 5000 }));
  const controller = new AbortController();
  const client = createHttp({ fetch, cache: memCache() }).client(meta(), { signal: controller.signal });
  const t0 = Date.now();
  const pending = client.json("https://x.test/slow");
  const queued = client.json("https://x.test/next");
  setTimeout(() => controller.abort(new SourceError("aborted", "stopped by you")), 20);
  await assert.rejects(pending, (err) => err.kind === "aborted" && err.message === "stopped by you");
  await assert.rejects(queued, (err) => err.kind === "aborted");
  assert.ok(Date.now() - t0 < 500);
  await assert.rejects(client.json("https://x.test/later"), (err) => err.kind === "aborted");
});

test("a request with no answer times out (and is retried once)", async () => {
  const { fetch, calls } = fakeFetch(() => ({ body: {}, delay: 1000 }));
  const client = createHttp({ fetch, timeoutMs: 30, scale: 0.01, cache: memCache() }).client(meta());
  await assert.rejects(client.json("https://x.test/a"), (err) => err.kind === "timeout" && /no answer in 0 s/.test(err.message));
  assert.equal(calls.length, 2);
});

test('"obey" sources check robots.txt (once per host) and take its Crawl-delay', async () => {
  const { fetch, calls } = fakeFetch((url) =>
    url.endsWith("/robots.txt")
      ? { body: "User-agent: *\nDisallow: /private\nAllow: /private/jobs\nCrawl-delay: 0.08\n" }
      : { body: "<rss></rss>" }
  );
  const client = createHttp({ fetch, cache: memCache() }).client(meta({ robots: "obey", gaps: { "x.test": 10 } }));
  await client.text("https://x.test/private/jobs/feed");
  await client.text("https://x.test/public");
  await assert.rejects(client.text("https://x.test/private/admin"), (err) => err.kind === "robots" && /disallows \/private\/admin/.test(err.message));
  assert.equal(calls.filter((c) => c.url.endsWith("robots.txt")).length, 1);
  const pages = calls.filter((c) => !c.url.endsWith("robots.txt"));
  assert.ok(pages[1].start >= pages[0].end + 78, "Crawl-delay is the gap");
  // An "api" source never asks
  const api = fakeFetch(() => ({ body: {} }));
  await createHttp({ fetch: api.fetch, cache: memCache() }).client(meta()).json("https://y.test/private");
  assert.equal(api.calls.length, 1);
});

test("robots.txt that can't be read allows for 10 minutes only; a real answer (2xx, 4xx) is kept a day", async () => {
  let clock = Date.now();
  const storage = memoryStorage();
  let robots = { status: 503, body: "" };
  const { fetch } = fakeFetch((url) => {
    if (!url.endsWith("/robots.txt")) return { body: "<html>jobs</html>" };
    if (robots === "offline") throw new TypeError("Failed to fetch");
    return robots;
  });
  const run = () =>
    createHttp({ fetch, cache: createCache({ storage, now: () => clock }) })
      .client(meta({ robots: "obey", gaps: { "x.test": 10 } }))
      .text("https://x.test/jobs");
  const disallowed = (err) => err.kind === "robots";
  await run();
  robots = { body: "User-agent: *\nDisallow: /\n" };
  clock += 5 * 60e3;
  await run();
  clock += 6 * 60e3;
  await assert.rejects(run(), disallowed);
  // No answer at all: the same 10 minutes
  clock += 25 * 3600e3;
  robots = "offline";
  await run();
  robots = { body: "User-agent: *\nDisallow: /\n" };
  clock += 11 * 60e3;
  await assert.rejects(run(), disallowed);
  // A real answer stays a day; a 404 is one too
  robots = { status: 404, body: "Not found" };
  clock += 23 * 3600e3;
  await assert.rejects(run(), disallowed);
  clock += 2 * 3600e3;
  await run();
  robots = { body: "User-agent: *\nDisallow: /\n" };
  clock += 23 * 3600e3;
  await run();
});

test("expectArray names the keys that came back", () => {
  assert.deepEqual(expectArray({ jobs: [1, 2] }, "jobs"), [1, 2]);
  assert.deepEqual(expectArray({ data: { items: [3] } }, ["jobs", "data.items"]), [3]);
  assert.deepEqual(expectArray([4], ""), [4]);
  assert.throws(
    () => expectArray({ message: "Moved", status: 301 }, "jobs"),
    (err) => err.kind === "format" && err.message === "unexpected response (keys: message, status)"
  );
  assert.throws(() => expectArray("nope", "jobs"), /unexpected response \(string\)/);
});
