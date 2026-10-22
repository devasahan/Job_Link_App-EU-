/** The runner's advice when a run finds fewer jobs than Count. */

import { DATE_PRESETS } from "./scrapers/util.js";
import { cleanAbroadCodes } from "./scrapers/countries.js";

const orList = (items) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}` : items[0] || "";

/**
 * Fewer jobs than Count: the settings that would widen the next run.
 * `unticked` are the labels of sources this run didn't search.
 */
export function moreResultsHint({ found, count, preset, title, stack, years, abroad, type, unticked = [] }) {
  if (found >= Number(count)) return "";
  const tips = [];
  const longer = Object.values(DATE_PRESETS)
    .filter((p) => p.hoursOld > preset.hoursOld)
    .map((p) => p.span);
  if (longer.length) tips.push(`a longer Posted window (${orList(longer)})`);
  if (unticked.length) tips.push(`ticking more Platforms (${unticked.join(", ")})`);
  // A title with no usable words ("-", "(m/w/d)") already runs as none
  if (globalThis.jbTitleQueryPhrases(title).length) {
    tips.push("an empty Title (every developer role, searched in each country's own language)");
  }
  if (String(stack || "").trim()) tips.push("fewer Stack words");
  if (years !== "" && years != null) tips.push("a higher or empty Years");
  if (!cleanAbroadCodes(abroad).length) tips.push("ticking Employers abroad");
  if (type !== "both") tips.push("Type: Both");
  return tips.length ? `Fewer than ${count} found. For more, try ${tips.join(", ")}.` : "";
}
