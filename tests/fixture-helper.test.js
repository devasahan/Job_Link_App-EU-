import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTokens, fixtureFetch, routeMatches } from "./helpers/fixture.js";

test("date tokens are filled relative to now", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  assert.equal(fillTokens("{{ago:2h}}", now), "2026-10-22T10:00:00.000Z");
  assert.equal(fillTokens("{{ago:2h|unix}}", now), String(Date.parse("2026-10-22T10:00:00Z") / 1000));
  assert.equal(fillTokens("{{ago:30m|ms}}", now), String(now - 30 * 60e3));
  assert.equal(fillTokens("{{ago:3d|date}}", now), "2026-10-19");
  assert.equal(fillTokens("{{ago:1h|rfc822}}", now), "Thu, 22 Oct 2026 11:00:00 +0000");
  assert.equal(fillTokens('{"at": "{{in:5d}}"}', now), '{"at": "2026-10-27T12:00:00.000Z"}');
});

test("routes match the method, the path and the listed query parameters", async () => {
  const route = { url: "https://x.test/api", query: { page: "2", q: "*", cursor: null } };
  assert.ok(routeMatches(route, "https://x.test/api?page=2&q=go&sort=recent"));
  assert.ok(!routeMatches(route, "https://x.test/api?page=2"));
  assert.ok(!routeMatches(route, "https://x.test/api?page=2&q=go&cursor=abc"));
  assert.ok(!routeMatches(route, "https://x.test/api?page=2&q=go", "POST"));
  assert.ok(routeMatches({ url: "https://x.test/s", method: "POST", bodyIncludes: '"page":2' }, "https://x.test/s", "POST", '{"page":2}'));
  const { fetch, calls } = fixtureFetch([{ url: "https://x.test/api", body: '{"ok":1}', contentType: "application/json", status: 200 }]);
  assert.deepEqual(await (await fetch("https://x.test/api?a=1")).json(), { ok: 1 });
  assert.equal((await fetch("https://x.test/other")).status, 404);
  assert.deepEqual(calls.map((c) => c.status), [200, 404]);
});
