/**
 * Every job source the popup offers, in four groups. One object per source;
 * adding a source means adding its object here (plus its adapter module, its
 * hosts in manifest.json and a fixture, see README "Adding a board"):
 *   id            the job's `site`, history's board key and the fixture folder name
 *   label         shown in the popup, the run log and the sheet's Site column
 *   group         "boards" | "careers" | "freelance" | "agencies"
 *   hint          a few words after the label in the popup
 *   url           the site, credited in the run summary
 *   module        the adapter, relative to scrapers/: it exports run(ctx)
 *   hosts         hosts it fetches from (each needs a host_permissions entry)
 *   countries     ISO codes it can search, or null for any (greys out the rest in the popup)
 *   countryBound  it finds only jobs listed in the ticked countries (Indeed): with
 *                 every ticked source bound, the user's own country alone is nothing to search
 *   defaultOn     ticked for new users, and for everyone the first time it appears
 *   priority      lower wins when the same job comes from several sources
 *                 (careers 10, Indeed 20, Workable 25, boards 30, HN/Jobgether/Djinni 40,
 *                 freelance 50, agencies 60); the group's by default
 *   budgetMs      how long it may run; the group's by default
 *   gaps          { host: ms } between two requests to that host (default 1 s)
 *   robots        "api" (a documented API) or "obey" (robots.txt is checked)
 *   headerRule    id of its rule in rules/headers.json, if it needs one
 *   pending       the adapter isn't merged yet: hidden and never run
 * Optional: needsContract (Type must allow contract work), optionalHosts.
 */

import { INDEED_SITES } from "./indeed.js";

export const GROUPS = [
  { id: "boards", label: "Job boards", priority: 30, budgetMs: 120e3 },
  { id: "careers", label: "Company career pages", priority: 10, budgetMs: 180e3 },
  { id: "freelance", label: "Freelance", priority: 50, budgetMs: 90e3 },
  { id: "agencies", label: "Recruitment agencies", priority: 60, budgetMs: 180e3 },
];

function withDefaults(entry) {
  const group = GROUPS.find((g) => g.id === entry.group) || GROUPS[0];
  return {
    hint: "",
    url: "",
    hosts: [],
    countries: null,
    countryBound: false,
    defaultOn: false,
    priority: group.priority,
    budgetMs: group.budgetMs,
    gaps: {},
    robots: "api",
    ...entry,
  };
}

export const SOURCES = [
  {
    id: "indeed",
    label: "Indeed",
    group: "boards",
    hint: "by country",
    url: "https://www.indeed.com",
    module: "./boards/indeed.js",
    hosts: ["apis.indeed.com"],
    countries: Object.keys(INDEED_SITES),
    countryBound: true,
    defaultOn: true,
    priority: 20,
    budgetMs: 300e3,
    // scrapeIndeed paces itself (0.5 s between pages, 1 s between countries)
    gaps: { "apis.indeed.com": 500 },
    headerRule: 1,
  },
  {
    id: "himalayas",
    label: "Himalayas",
    group: "boards",
    hint: "remote",
    url: "https://himalayas.app",
    module: "./boards/himalayas.js",
    hosts: ["himalayas.app"],
    defaultOn: true,
    gaps: { "himalayas.app": 800 },
    headerRule: 2,
  },
  // 2.4.0 adapters being built: each is replaced by the entry its agent hands back
  {
    id: "jobicy",
    label: "Jobicy",
    group: "boards",
    hint: "remote",
    url: "https://jobicy.com",
    module: "./boards/jobicy.js",
    hosts: ["jobicy.com"],
    defaultOn: true,
    pending: true,
  },
  {
    id: "hackernews",
    label: "Hacker News",
    group: "boards",
    hint: "Who is hiring",
    url: "https://news.ycombinator.com",
    module: "./boards/hackernews.js",
    hosts: ["hn.algolia.com"],
    defaultOn: true,
    priority: 40,
    pending: true,
  },
  {
    id: "euremotejobs",
    label: "EU Remote Jobs",
    group: "boards",
    hint: "remote, Europe",
    url: "https://euremotejobs.com",
    module: "./boards/euremotejobs.js",
    hosts: ["euremotejobs.com"],
    defaultOn: true,
    robots: "obey",
    pending: true,
  },
  {
    id: "arc",
    label: "Arc.dev",
    group: "boards",
    hint: "remote, free profile",
    url: "https://arc.dev",
    module: "./boards/arc.js",
    hosts: ["arc.dev"],
    defaultOn: false,
    gaps: { "arc.dev": 1500 },
    robots: "obey",
    pending: true,
  },
].map(withDefaults);

/** Sources this build can run (not pending), in the popup's order. */
export const liveSources = () => SOURCES.filter((s) => !s.pending);

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;

/** "Himalayas" for "himalayas"; an unknown id stays as it is. */
export const sourceLabel = (id) => sourceById(id)?.label || String(id || "");
