import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/env.js";
import { moreResultsHint } from "../extension/hint.js";
import { DATE_PRESETS } from "../extension/scrapers/util.js";

const base = { found: 5, count: 50, preset: DATE_PRESETS.today, title: "", stack: "", years: "", abroad: ["GB"], type: "both" };

test("the hint names only settings that would widen the run", () => {
  assert.equal(moreResultsHint({ ...base, found: 50 }), "");
  assert.equal(
    moreResultsHint(base),
    "Fewer than 50 found. For more, try a longer Posted window (3 days, 7 days or 30 days)."
  );
  assert.equal(
    moreResultsHint({ ...base, preset: DATE_PRESETS.week, title: "software engineer", abroad: [], type: "fulltime" }),
    "Fewer than 50 found. For more, try a longer Posted window (30 days), an empty Title (every developer role, " +
      "searched in each country's own language), ticking Employers abroad, Type: Both."
  );
  assert.equal(
    moreResultsHint({ ...base, preset: DATE_PRESETS.month, stack: "React", years: 3 }),
    "Fewer than 50 found. For more, try fewer Stack words, a higher or empty Years."
  );
  assert.equal(moreResultsHint({ ...base, preset: DATE_PRESETS.month }), "");
});
