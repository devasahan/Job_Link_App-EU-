/**
 * The contract every adapter passes, run by each tests/src-<id>.test.js:
 *   adapterContract({ id, meta?, run?, opts?, wanted?, expect?, empty, broken?, secondPage? })
 * against its fixture (tests/fixtures/sources/<id>/routes.json):
 *   - the jobs' shape and the counters (scanned = kept + Σ dropped);
 *   - every fetch goes through ctx.http: one request per host in flight,
 *     the source's gaps respected;
 *   - a 500 → failed; a 403 → blocked; a missing array → "unexpected
 *     response (…)"; an empty list → 0 kept, not failed;
 *   - a 429 on page 2 → what page 1 found, incomplete;
 *   - a stopped run returns quickly; wanted = 1 stops early.
 * meta: the source's registry entry (default: sources.js's; an adapter
 * not merged yet passes the entry it hands back). run: default, the
 * module's. empty / broken: { body, contentType? } for "no jobs" and for a
 * changed API (broken.error: the message expected, /unexpected response/
 * by default). secondPage(url): is this a page-2 request (paged sources).
 * expect: { kept?: titles, dropped?: { reason: n }, minKept? }.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import "./env.js";
import { EU_CODES } from "../../extension/scrapers/countries.js";
import { DATE_PRESETS } from "../../extension/scrapers/util.js";
import { sourceById } from "../../extension/scrapers/sources.js";
import { loadAdapter } from "../../extension/scrapers/adapters.js";
import { createHttp, SourceError } from "../../extension/scrapers/http.js";
import { createCache, memoryStorage } from "../../extension/scrapers/core/cache.js";
import { runSource } from "../../extension/scrapers/core/context.js";
import { invariantHolds } from "../../extension/scrapers/core/diagnostics.js";
import { fixtureFetch, loadRoutes } from "./fixture.js";

// Gaps shrink 50 times in tests: 800 ms → 16 ms
export const SCALE = 0.02;
const TOLERANCE_MS = 4;

/** The run options a contract run uses (the popup's defaults, every EU country). */
export function contractOpts(extra = {}) {
  return {
    title: "",
    stack: "",
    countries: [...EU_CODES],
    abroad: ["GB", "CA", "US"],
    home: "",
    preset: DATE_PRESETS.today,
    years: "",
    jobType: "both",
    ...extra,
  };
}

const isRobots = (url) => new URL(url).pathname === "/robots.txt";

/**
 * Run one adapter against its fixture (with `respond` overriding answers).
 * Returns { report, jobs, calls, ms }.
 */
export async function runFixture({ id, meta, run, opts, wanted = 50, respond, signal, now }) {
  const source = meta || sourceById(id);
  assert.ok(source, `no registry entry for ${id}: pass meta`);
  const adapter = run || (await loadAdapter({ ...source, pending: false }));
  const routes = loadRoutes(id, { now });
  const { fetch, calls } = fixtureFetch(routes, { respond });
  const http = createHttp({ fetch, scale: SCALE, timeoutMs: 5000, cache: createCache({ storage: memoryStorage() }) });
  // Adapters fetch through ctx.http only
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error(`${id} called fetch() directly: use ctx.http`);
  };
  const t0 = Date.now();
  try {
    const result = await runSource(source, {
      run: adapter,
      opts: contractOpts(opts),
      wanted,
      http,
      signal,
      cache: createCache({ storage: memoryStorage() }).scope(id),
      graceMs: 200,
    });
    return { ...result, calls, ms: Date.now() - t0 };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const NORMALIZED = ["title", "company", "location", "country", "open_to", "site", "listing_type", "date_posted", "is_remote", "job_url", "job_url_direct", "description"];

export function adapterContract({ id, meta, run, opts, wanted = 50, expect = {}, empty, broken = {}, secondPage }) {
  const source = meta || sourceById(id);
  const base = { id, meta: source, run, opts, wanted };
  const brokenBody = broken.body ?? JSON.stringify({ message: "Not found", status: "error" });
  const brokenType = broken.contentType || "application/json";
  const dataCall = (call) => !isRobots(call.url);

  describe(`${id}: adapter contract`, () => {
    test("maps the fixture: job shape, ids, and counters that balance", async () => {
      const { report, jobs } = await runFixture(base);
      assert.equal(report.status, "ok", `${report.status}: ${report.error}`);
      assert.ok(report.kept >= (expect.minKept ?? 1), `kept ${report.kept}`);
      assert.ok(invariantHolds(report), JSON.stringify(report.dropped));
      const ids = new Set();
      for (const job of jobs) {
        for (const key of NORMALIZED) assert.equal(typeof job[key], "string", `${key} of ${job.title}`);
        assert.ok(job.years_required === "" || Number.isFinite(job.years_required), `years_required of ${job.title}`);
        assert.equal(job.site, id);
        assert.ok(job.title, "every job has a title");
        assert.match(job.job_url, /^https:\/\//, "job_url is a link");
        assert.ok(job._id && !ids.has(job._id), `unique _id: ${job._id}`);
        ids.add(job._id);
        assert.equal(typeof job._where, "object", "every job has a _where");
        assert.ok(!job.date_posted || !Number.isNaN(Date.parse(job.date_posted)), `date_posted ${job.date_posted}`);
      }
      if (expect.kept) assert.deepEqual(jobs.map((j) => j.title).sort(), [...expect.kept].sort());
      for (const [reason, n] of Object.entries(expect.dropped || {})) {
        assert.equal(report.dropped[reason] || 0, n, `dropped.${reason}`);
      }
    });

    test("polite: one request per host in flight, gaps respected", async () => {
      const { calls } = await runFixture(base);
      assert.ok(calls.length >= 1);
      const byHost = new Map();
      for (const call of calls) byHost.set(call.host, [...(byHost.get(call.host) || []), call]);
      for (const [host, list] of byHost) {
        assert.ok(source.hosts.includes(host), `${host} is in the entry's hosts`);
        const gap = (source.gaps?.[host] ?? 1000) * SCALE;
        for (let i = 1; i < list.length; i++) {
          assert.ok(list[i].start >= list[i - 1].end, `${host}: two requests in flight`);
          // robots.txt is fetched without a gap before it
          if (!isRobots(list[i].url)) {
            assert.ok(list[i].start - list[i - 1].end >= gap - TOLERANCE_MS, `${host}: gap ${list[i].start - list[i - 1].end} ms < ${gap} ms`);
          }
        }
      }
    });

    test("a 500 fails the source (after one retry)", async () => {
      const { report, calls } = await runFixture({ ...base, respond: (call) => (dataCall(call) ? { status: 500, body: "Internal Server Error" } : null) });
      assert.equal(report.status, "failed");
      assert.equal(report.errorKind, "http");
      assert.match(report.error, /HTTP 500/);
      const first = calls.find(dataCall).url;
      assert.equal(calls.filter((c) => c.url === first).length, 2);
      assert.ok(report.samples.some((s) => s.status === 500), "the failure is sampled for Copy report");
    });

    test("a 403 is blocked", async () => {
      const { report } = await runFixture({ ...base, respond: (call) => (dataCall(call) ? { status: 403, body: "<html>Forbidden</html>", contentType: "text/html" } : null) });
      assert.equal(report.status, "failed");
      assert.equal(report.errorKind, "blocked");
      assert.match(report.error, /HTTP 403/);
    });

    test("a changed answer says what came back", async () => {
      const { report } = await runFixture({ ...base, respond: (call) => (dataCall(call) ? { body: brokenBody, contentType: brokenType } : null) });
      assert.equal(report.status, "failed");
      assert.match(report.error, broken.error || /unexpected response/);
    });

    test("an empty list keeps 0 and doesn't fail", async () => {
      assert.ok(empty?.body != null, "pass empty: { body } for this source's empty answer");
      const { report, jobs } = await runFixture({ ...base, respond: (call) => (dataCall(call) ? { body: empty.body, contentType: empty.contentType || "application/json" } : null) });
      assert.equal(report.status, "ok", report.error);
      assert.equal(report.kept, 0);
      assert.equal(jobs.length, 0);
    });

    test("a 429 on page 2 keeps page 1, incomplete", { skip: !secondPage && "one page only" }, async () => {
      const { report, jobs, calls } = await runFixture({
        ...base,
        wanted: 1000,
        respond: (call) => (secondPage(call.url) ? { status: 429, body: "Too Many Requests" } : null),
      });
      assert.ok(calls.some((c) => secondPage(c.url)), "page 2 was asked for");
      assert.equal(report.status, "incomplete", report.error);
      assert.equal(report.errorKind, "blocked");
      assert.ok(jobs.length >= 1);
    });

    test("a stopped run returns quickly", async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new SourceError("aborted", "stopped by you")), 30);
      const { report, ms } = await runFixture({ ...base, signal: controller.signal, respond: (call) => (dataCall(call) ? { delay: 5000 } : null) });
      assert.ok(ms < 1000, `${ms} ms`);
      assert.notEqual(report.status, "ok");
      assert.equal(report.error, "stopped by you");
    });

    test("wanted = 1 stops early", async () => {
      const full = await runFixture({ ...base, wanted: 1000 });
      const one = await runFixture({ ...base, wanted: 1 });
      assert.ok(one.report.kept >= 1);
      const data = (r) => r.calls.filter(dataCall).length;
      assert.ok(data(one) <= data(full));
      if (secondPage) assert.ok(!one.calls.some((c) => secondPage(c.url)), "no page 2 once one job is kept");
    });
  });
}
