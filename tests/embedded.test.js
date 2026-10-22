import { test } from "node:test";
import assert from "node:assert/strict";
import { findDeep, jsonAfter, nextData, scriptJson } from "../extension/scrapers/formats/embedded.js";

const PAGE = `<!doctype html><html><head>
<script>window.dataLayer = [];</script>
<script type="application/ld+json">{"@type":"WebSite"}</script>
</head><body><div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"data":{"jobs":{"items":[{"title":"Go Developer","requiredCountries":["DE"]}]}},"text":"a </ b \\" c"}},"page":"/remote-jobs","buildId":"x1"}</script>
<script>window.__INITIAL_STATE__ = {"jobs":[{"id":1,"title":"He said \\"hi\\" {not a brace}"}],"n":2}; window.other = 1;</script>
</body></html>`;

test("__NEXT_DATA__ and script blocks by id", () => {
  const data = nextData(PAGE);
  assert.equal(data.page, "/remote-jobs");
  assert.equal(data.props.pageProps.text, 'a </ b " c');
  assert.equal(nextData("<html><body>No data</body></html>"), null);
  assert.throws(() => nextData('<script id="__NEXT_DATA__">{"broken": </script>'), /malformed __NEXT_DATA__ JSON/);
  assert.deepEqual(scriptJson(`<script id='cfg' type="application/json"> {"a":1} </script>`, "cfg"), { a: 1 });
});

test("jsonAfter reads the value after a marker, with braces and quotes inside strings", () => {
  const state = jsonAfter(PAGE, "window.__INITIAL_STATE__");
  assert.equal(state.n, 2);
  assert.equal(state.jobs[0].title, 'He said "hi" {not a brace}');
  assert.deepEqual(jsonAfter('"jobs": [1, 2, {"a": [3]}], "next"', '"jobs"'), [1, 2, { a: [3] }]);
  assert.equal(jsonAfter('x = "a\\"b"', "x"), 'a"b');
  assert.equal(jsonAfter("window.x = {unclosed", "window.x"), null);
  assert.equal(jsonAfter("nothing here", "window.x"), null);
});

test("findDeep finds the jobs wherever the page moved them", () => {
  const data = nextData(PAGE);
  const jobs = findDeep(data, (v) => Array.isArray(v) && v.some((x) => x?.title && x?.requiredCountries));
  assert.equal(jobs[0].title, "Go Developer");
  assert.equal(findDeep(data, (v, key) => key === "missing"), null);
  // A cycle or a huge tree stops at maxNodes
  const loop = { a: {} };
  loop.a.b = loop;
  assert.equal(findDeep(loop, () => false, { maxNodes: 50 }), null);
});
