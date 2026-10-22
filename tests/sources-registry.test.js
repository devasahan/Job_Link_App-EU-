import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./helpers/env.js";
import { GROUPS, SOURCES, liveSources } from "../extension/scrapers/sources.js";
import { loadAdapter } from "../extension/scrapers/adapters.js";
import { ABROAD_CODES, ALL_COUNTRIES } from "../extension/scrapers/countries.js";
import { FIXTURES_DIR, fixtureIds, loadRoutes } from "./helpers/fixture.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const rules = JSON.parse(fs.readFileSync(path.join(EXT, "rules/headers.json"), "utf8"));
const permitted = new Set(manifest.host_permissions.map((p) => p.replace(/^https:\/\/|\/\*$/g, "")));
// Indeed's answers are built in indeed.test.js and the e2e harness's mock
const OWN_FIXTURES = new Set(["indeed"]);
const CODES = new Set([...ALL_COUNTRIES.map((c) => c.code), ...ABROAD_CODES]);

test("every entry is complete and its id unique", () => {
  const ids = SOURCES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const s of SOURCES) {
    assert.match(s.id, /^[a-z0-9]+$/, `${s.id}: lowercase letters and digits`);
    assert.ok(s.label, `${s.id}: label`);
    assert.ok(GROUPS.some((g) => g.id === s.group), `${s.id}: group ${s.group}`);
    assert.ok(Number.isFinite(s.priority), `${s.id}: priority`);
    assert.ok(s.budgetMs > 0 && s.budgetMs <= 600e3, `${s.id}: budget within the run's 10 minutes`);
    assert.ok(["api", "obey"].includes(s.robots), `${s.id}: robots`);
    assert.equal(typeof s.defaultOn, "boolean", `${s.id}: defaultOn`);
    assert.match(s.module || "", /^\.\/(?:boards|careers|freelance|agencies)\/[a-z0-9-]+\.js$/, `${s.id}: module`);
    assert.ok(Array.isArray(s.hosts) && s.hosts.length, `${s.id}: hosts`);
    for (const host of Object.keys(s.gaps)) assert.ok(s.hosts.includes(host), `${s.id}: gap for ${host}, not in its hosts`);
    assert.ok(s.countries === null || s.countries.every((c) => CODES.has(c)), `${s.id}: countries`);
  }
});

test("every live source loads, has its hosts in the manifest, and its header rule", async () => {
  for (const s of liveSources()) {
    assert.equal(typeof (await loadAdapter(s)), "function", `${s.id}: run(ctx)`);
    for (const host of s.hosts) assert.ok(permitted.has(host), `${s.id}: ${host} in host_permissions`);
    if (s.headerRule) {
      const rule = rules.find((r) => r.id === s.headerRule);
      assert.ok(rule, `${s.id}: rule ${s.headerRule} in rules/headers.json`);
      assert.ok(s.hosts.some((h) => rule.condition.urlFilter.includes(h)), `${s.id}: rule ${s.headerRule} is for its host`);
      // The site's own pages keep their headers
      assert.ok(rule.condition.excludedInitiatorDomains?.length, `${s.id}: rule ${s.headerRule} skips the site's own pages`);
    }
  }
  // Nothing in the manifest that no source uses
  const used = new Set(liveSources().flatMap((s) => s.hosts));
  for (const host of permitted) assert.ok(used.has(host), `${host} in host_permissions belongs to a live source`);
  const ruleIds = rules.map((r) => r.id);
  assert.equal(new Set(ruleIds).size, ruleIds.length, "rule ids are unique");
  for (const id of ruleIds) assert.ok(SOURCES.some((s) => s.headerRule === id), `rule ${id} belongs to a source`);
});

test("every live source has a fixture and a contract test; routes stay on its hosts", () => {
  for (const s of liveSources()) {
    if (OWN_FIXTURES.has(s.id)) continue;
    assert.ok(fixtureIds().includes(s.id), `${s.id}: tests/fixtures/sources/${s.id}/routes.json`);
    const routes = loadRoutes(s.id);
    assert.ok(routes.length, `${s.id}: routes`);
    for (const r of routes) assert.ok(s.hosts.includes(new URL(r.url).host), `${s.id}: route ${r.url} on its hosts`);
    const testFile = path.join(ROOT, "tests", `src-${s.id}.test.js`);
    assert.ok(fs.existsSync(testFile), `${s.id}: tests/src-${s.id}.test.js`);
    assert.match(fs.readFileSync(testFile, "utf8"), /adapterContract\(/, `${s.id}: runs the adapter contract`);
  }
  // A fixture folder belongs to a source
  for (const id of fixtureIds()) assert.ok(SOURCES.some((s) => s.id === id), `fixture ${id} has a registry entry`);
  assert.ok(fs.existsSync(FIXTURES_DIR));
});

test("pending entries stay out of the popup and the run", () => {
  for (const s of SOURCES.filter((x) => x.pending)) {
    assert.ok(!liveSources().includes(s));
  }
});
