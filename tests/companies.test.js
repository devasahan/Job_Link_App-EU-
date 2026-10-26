import { test } from "node:test";
import assert from "node:assert/strict";
import { ASHBY_BOARDS, GREENHOUSE_BOARDS } from "../extension/scrapers/careers/companies.js";
import { sourceById } from "../extension/scrapers/sources.js";

const LISTS = { greenhouse: GREENHOUSE_BOARDS, ashby: ASHBY_BOARDS };

test("each list: tokens and names present and unique (a name is the company's part)", () => {
  for (const [id, list] of Object.entries(LISTS)) {
    assert.ok(list.length >= 80, `${id}: ${list.length} companies`);
    const tokens = list.map((c) => c.token);
    const names = list.map((c) => c.name);
    for (const c of list) {
      assert.ok(typeof c.token === "string" && c.token.trim() === c.token && c.token, `${id}: token ${JSON.stringify(c.token)}`);
      // Path-safe as written: letters, digits, dots, hyphens and underscores
      assert.match(c.token, /^[A-Za-z0-9._-]+$/, `${id}: ${c.token}`);
      assert.ok(typeof c.name === "string" && c.name.trim(), `${id}: ${c.token} has a name`);
      assert.match(c.country, /^[A-Z]{2}$/, `${id}: ${c.token} country`);
    }
    assert.equal(new Set(tokens.map((t) => t.toLowerCase())).size, tokens.length, `${id}: tokens unique`);
    assert.equal(new Set(names).size, names.length, `${id}: names unique`);
    assert.equal(sourceById(id).companies, list, `${id}: the registry entry uses the list`);
    assert.equal(sourceById(id).hint, `${list.length} companies`);
  }
});

test("no token on both lists; tokens kept exactly as the companies write them", () => {
  const greenhouse = new Set(GREENHOUSE_BOARDS.map((c) => c.token.toLowerCase()));
  const both = ASHBY_BOARDS.filter((c) => greenhouse.has(c.token.toLowerCase())).map((c) => c.token);
  assert.deepEqual(both, []);
  const ashby = ASHBY_BOARDS.map((c) => c.token);
  for (const token of ["kraken.com", "primer.io", "duck-duck-go", "Enode", "DeepL", "vClusterLabs", "1password"]) {
    assert.ok(ashby.includes(token), token);
  }
  assert.ok(GREENHOUSE_BOARDS.some((c) => c.token === "automatticcareers" && c.name === "Automattic"));
  assert.ok(Object.isFrozen(GREENHOUSE_BOARDS) && Object.isFrozen(GREENHOUSE_BOARDS[0]));
});
