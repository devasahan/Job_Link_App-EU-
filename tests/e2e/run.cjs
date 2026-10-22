// End-to-end check (npm run e2e): load the unpacked extension in Chromium,
// drive the popup, answer every request from fixtures (each
// tests/fixtures/sources/*/routes.json, plus an Indeed GraphQL mock below),
// and read the Excel the runner saves. Nothing reaches the network.
// Scenarios: the popup; a run with every board (per-source lines, Left out,
// merges, Site and Also on); You live in; two sources failing while the others
// export; Stop and download; Check sources (no download) with Copy report.
// Runs tick their sources explicitly, so later releases' sources don't move
// these numbers.
// PLAYWRIGHT=<path to playwright> overrides where Playwright is loaded from.
const { chromium } = require(process.env.PLAYWRIGHT || "/opt/node-tools/node_modules/playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "extension");
const OUT = path.join(__dirname, "out");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
// Chrome writes _metadata into an unpacked extension: load a copy, not the repo
const EXT = path.join(OUT, "extension");
fs.cpSync(SRC, EXT, { recursive: true });

let failed = 0;
function check(ok, what, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `\n     ${String(detail).replace(/\n/g, "\n     ")}` : ""}`);
  if (!ok) failed += 1;
}

function extensionId(dir) {
  const hex = crypto.createHash("sha256").update(dir).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

// ---- Indeed: a GraphQL mock, one job list per indeed-co country ----
const H = 3600e3;
function indeedJob(key, title, country, extra = {}) {
  const now = Date.now();
  return {
    key,
    title,
    datePublished: now - 2 * H,
    dateOnIndeed: now - 2 * H,
    description: { html: "<p>Remote role across the country.</p><ul><li>3+ years of experience</li></ul>" },
    location: { city: "", admin1Code: "", countryCode: country, formatted: { long: "Remote" } },
    employer: { name: `${country} Co` },
    attributes: [{ key: "DSQF7", label: "Remote" }, { key: "CF3CP", label: "Full-time" }],
    recruit: { viewJobUrl: "" },
    ...extra,
  };
}
const INDEED_RUN = () => ({
  DE: [
    indeedJob("de1", "Backend-Entwickler (m/w/d) Go", "DE", { location: { countryCode: "DE", formatted: { long: "Homeoffice in Berlin" } }, description: { html: "<p>Mindestens 3 Jahre Berufserfahrung mit Go und Kubernetes.</p>" } }),
    indeedJob("de2", "Buchhalter (m/w/d)", "DE"),
    indeedJob("de3", "Frontend-Entwickler (w/m/d)", "DE", { attributes: [{ key: "DSQF7" }, { key: "PAXZC" }] }),
  ],
  FR: [
    indeedJob("fr1", "Développeur Full-Stack React (H/F)", "FR", { dateOnIndeed: Date.now() - 1 * H, location: { countryCode: "FR", formatted: { long: "Télétravail à Paris" } } }),
    indeedJob("fr2", "Business Developer B2B", "FR"),
  ],
  IE: [indeedJob("ie1", "Senior Software Engineer", "IE", { attributes: [{ key: "DSQF7" }, { key: "NJXCK" }] })],
  // The same job as Himalayas's "Senior Backend Engineer" at "US Co Inc."
  US: [
    indeedJob("us1", "Senior Backend Engineer", "US", { description: { html: "<p>Remote (Europe). We hire engineers across the EU. 5+ years of experience.</p>" } }),
    indeedJob("us2", "Backend Engineer", "US", { description: { html: "<p>This role is US only.</p>" } }),
  ],
});
const INDEED_HOME = () => ({
  DE: [
    indeedJob("de1", "Backend-Entwickler (m/w/d) Go", "DE", { description: { html: "<p>Spannende Projekte mit Go.</p><ul><li>3+ Jahre Erfahrung</li></ul>" } }),
    indeedJob("de4", "Softwareentwickler (m/w/d)", "DE", { description: { html: "<p>Dein Arbeitsplatz</p><ul><li>100% Homeoffice innerhalb Deutschlands</li><li>Flexible Arbeitszeiten</li></ul>" } }),
    indeedJob("de5", "Frontend Developer", "SE", { description: { html: "<p>React and TypeScript.</p>" } }),
  ],
  SE: [indeedJob("se1", "Systemutvecklare", "SE")],
  US: [
    indeedJob("us-se", "Senior Backend Engineer", "US", { description: { html: "<p>Open to candidates based in Sweden or Norway.</p>" } }),
    indeedJob("us-de", "Platform Engineer", "US", { description: { html: "<p>Open to candidates based in Germany.</p>" } }),
  ],
});

function readSheet(file) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, "lib/xlsx.mini.min.js"), "utf8"), sandbox);
  const XLSX = sandbox.XLSX;
  const book = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0]];
  return { sheet, rows: XLSX.utils.sheet_to_json(sheet), header: XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [] };
}

/**
 * A fresh browser with the extension; `state.fail` / `state.slow` hold
 * source ids whose fixture routes answer 500 / hang.
 */
async function launch(name, { indeed = INDEED_RUN() } = {}) {
  const fixture = await import(pathToFileURL(path.join(ROOT, "tests/helpers/fixture.js")).href);
  const { SOURCES } = await import(pathToFileURL(path.join(SRC, "scrapers/sources.js")).href);
  const userData = fs.mkdtempSync(path.join(OUT, `profile-${name}-`));
  const context = await chromium.launchPersistentContext(userData, {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    viewport: { width: 380, height: 1000 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const state = { fail: new Set(), slow: new Set(), asked: [], indeed: [] };

  // Every source's fixture routes; anything else on a source's host is a 404
  const routes = fixture.fixtureIds().flatMap((id) => fixture.loadRoutes(id));
  const hosts = new Set(SOURCES.flatMap((s) => s.hosts).filter((h) => h !== "apis.indeed.com"));
  await context.route(
    (url) => hosts.has(url.host),
    async (route) => {
      const req = route.request();
      const url = req.url();
      state.asked.push(url);
      const hit = fixture.findRoute(routes, url, req.method(), req.postData() || "");
      const id = hit?.source;
      try {
        if (id && state.slow.has(id)) {
          await new Promise((r) => setTimeout(r, 30000));
          return await route.abort();
        }
        if (id && state.fail.has(id)) return await route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
        if (!hit) return await route.fulfill({ status: 404, contentType: "text/plain", body: `no fixture route for ${url}` });
        await route.fulfill({ status: hit.status, contentType: hit.contentType, headers: hit.headers, body: hit.body });
      } catch {
        // The runner stopped waiting (Stop): nothing to answer
      }
    }
  );
  await context.route("https://apis.indeed.com/**", async (route) => {
    const req = route.request();
    const headers = req.headers();
    const country = headers["indeed-co"];
    const query = JSON.parse(req.postData() || "{}").query || "";
    state.indeed.push({ country, what: (query.match(/what: ("[^"]*")/) || [])[1] });
    const results = (indeed[country] || []).map((j) => ({ job: j }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { jobSearch: { pageInfo: { nextCursor: null }, results } } }) });
  });

  const id = extensionId(EXT);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForSelector('input[name="site"]', { state: "attached" });
  return { context, popup, state, id };
}

/** Press OK (or Check sources) and wait for the runner to finish; returns its page, log, results and the file. */
async function runFrom(popup, context, { button = "#ok-btn", expectDownload = true, during } = {}) {
  const runnerPromise = context.waitForEvent("page");
  await popup.click(button);
  const runner = await runnerPromise;
  let download = null;
  runner.on("download", (d) => {
    download = d;
  });
  if (during) await during(runner);
  await runner.waitForFunction(() => /Downloaded|No jobs|No new|Checked|Select|Tick/.test(document.getElementById("status").textContent), null, { timeout: 120000 });
  if (expectDownload) {
    for (let i = 0; i < 50 && !download; i++) await runner.waitForTimeout(100);
  } else {
    await runner.waitForTimeout(1500);
  }
  let file = null;
  if (download) {
    file = path.join(OUT, `${Date.now()}-${download.suggestedFilename()}`);
    await download.saveAs(file);
  }
  const status = await runner.textContent("#status");
  const log = await runner.textContent("#log");
  const lines = await runner.$$eval("#source-list li", (els) => els.map((e) => ({ id: e.dataset.source, status: e.dataset.status, text: e.textContent })));
  const merge = await runner.textContent("#merge-line");
  return { runner, status, log, lines, merge, file, downloaded: Boolean(download) };
}

async function pickCountries(popup, codes) {
  await popup.click("#countries summary");
  await popup.click('[data-countries="none"]');
  for (const code of codes) await popup.check(`input[name="country"][value="${code}"]`);
}

/** Tick exactly these sources, so sources added in later releases don't change a scenario's numbers. */
async function pickSources(popup, ids) {
  await popup.evaluate(() => document.querySelectorAll(".source-group").forEach((d) => (d.open = true)));
  for (const button of await popup.$$('[data-group-pick="none"]')) await button.click();
  for (const id of ids) await popup.check(`input[name="site"][value="${id}"]`);
}

const line = (lines, id) => lines.find((l) => l.id === id) || { text: "", status: "" };
const showLines = (run) => `status: ${run.status}\n${run.lines.map((l) => `  [${l.status}] ${l.text}`).join("\n")}${run.merge ? `\n  ${run.merge}` : ""}`;

// The 2.4.0 boards; Arc.dev is off by default
const BOARDS = ["indeed", "himalayas", "jobicy", "hackernews", "euremotejobs", "arc"];
const DEFAULTS = BOARDS.filter((id) => id !== "arc");
// Each board's line for scenario 2's search (DE, FR, IE, HR; 24 hours; any type)
const RUN_LINES = {
  himalayas:
    "Himalayas: 11 scanned → 4 kept. Left out: 1 not developer roles, 1 older than 24 hours, 1 expired, 1 hybrid or not remote, 3 limited to other countries",
  jobicy:
    "Jobicy: 15 scanned → 6 kept. Left out: 2 not developer roles, 1 older than 24 hours, 1 other job types, 1 hybrid or not remote, 4 limited to other countries",
  hackernews:
    "Hacker News: 16 scanned → 9 kept. Left out: 1 not developer roles, 1 older than 24 hours, 2 hybrid or not remote, 3 not open to Europe",
  euremotejobs:
    "EU Remote Jobs: 12 scanned → 5 kept. Left out: 1 not developer roles, 1 older than 24 hours, 1 other job types, 1 hybrid or not remote, 2 limited to other countries, 1 not open to Europe",
  arc: "Arc.dev: 12 scanned → 5 kept. Left out: 1 not developer roles, 2 older than 24 hours, 1 hybrid or not remote, 2 limited to other countries, 1 not open to Europe",
};

(async () => {
  const { SOURCES } = await import(pathToFileURL(path.join(SRC, "scrapers/sources.js")).href);
  const live = SOURCES.filter((s) => !s.pending);
  const label = (id) => SOURCES.find((s) => s.id === id).label;

  // ---- 1. The popup ----
  {
    const { context, popup } = await launch("popup");
    const groups = await popup.$$eval(".source-group", (els) => els.map((e) => e.querySelector("summary").textContent.replace(/\s+/g, " ").trim()));
    const boards = live.filter((s) => s.group === "boards");
    const on = boards.filter((s) => s.defaultOn).length;
    check(groups.length === 1 && groups[0] === `Job boards · ${on} of ${boards.length}`, `one Platforms group with counts: ${groups.join(" | ")}`);
    const sites = await popup.$$eval('input[name="site"]', (els) => els.map((e) => `${e.value}:${e.checked}`));
    check(
      sites.join(", ") === live.map((s) => `${s.id}:${s.defaultOn}`).join(", ") && DEFAULTS.every((id) => sites.includes(`${id}:true`)) && sites.includes("arc:false"),
      `every source at its default, Arc.dev off: ${sites.join(", ")}`
    );
    check((await popup.textContent('label.field:has(#count) span')) === "Count per source", "Count reads per source");
    check(await popup.isVisible("#check-btn"), "a Check sources link");
    check(JSON.stringify(await popup.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())) === '["header_rules"]', "header rules enabled");
    await popup.screenshot({ path: path.join(OUT, "popup-collapsed.png"), fullPage: true });
    // A remote board searches every country: none greyed out while one is ticked
    const greyed = () => popup.$$eval('input[name="country"]', (els) => els.filter((e) => e.parentElement.classList.contains("uncovered")).map((e) => e.value));
    check((await greyed()).length === 0, "no country greyed out with the remote boards ticked");
    await popup.click(".source-group summary");
    await popup.screenshot({ path: path.join(OUT, "popup-sources.png"), fullPage: true });
    await popup.click('[data-group-pick="none"]');
    await popup.check('input[name="site"][value="indeed"]');
    check((await greyed()).join(",") === "BG,HR,CY,EE,LV,LT,MT,SK,SI", `Indeed alone greys out its missing sites: ${await greyed()}`);
    check((await popup.textContent(".source-group summary")).trim().endsWith(`· 1 of ${boards.length}`), "the group count follows the ticks");
    await popup.check('input[name="site"][value="hackernews"]');
    check((await greyed()).length === 0, "one remote board covers every country again");
    await popup.click('[data-group-pick="all"]');
    check((await greyed()).length === 0 && (await popup.textContent(".source-group summary")).trim().endsWith(`· ${boards.length} of ${boards.length}`), "All ticks the whole group");
    await popup.click("#countries summary");
    await popup.screenshot({ path: path.join(OUT, "popup-default.png"), fullPage: true });
    await popup.selectOption("#home", "SE");
    check((await popup.textContent("#country-summary")) === "All EU (27) · not Sweden", `summary with You live in: ${await popup.textContent("#country-summary")}`);
    await popup.screenshot({ path: path.join(OUT, "popup-home.png"), fullPage: true });
    await context.close();
  }

  // ---- 2. A run: every 2.4.0 board, merges, Site and Also on ----
  {
    const { context, popup, state } = await launch("run");
    await pickSources(popup, BOARDS);
    await pickCountries(popup, ["DE", "FR", "IE", "HR"]);
    await popup.fill("#count", "20");
    await popup.selectOption("#job_type", "both");
    await popup.selectOption("#date_preset", "today");
    await popup.screenshot({ path: path.join(OUT, "popup-picked.png"), fullPage: true });
    const run = await runFrom(popup, context);
    await run.runner.screenshot({ path: path.join(OUT, "runner.png"), fullPage: true });
    console.log(showLines(run));
    check(run.downloaded, "the run downloads Excel", run.status);
    check(run.lines.map((l) => l.id).join(",") === BOARDS.join(","), `a line per ticked source, in the registry's order: ${run.lines.map((l) => l.id)}`);
    check(run.lines.every((l) => l.status === "ok"), "every source ok");
    check(/^Indeed: \d+ scanned → 4 kept\. Left out: .*not developer roles/.test(line(run.lines, "indeed").text), "Indeed's line", line(run.lines, "indeed").text);
    for (const [id, want] of Object.entries(RUN_LINES)) {
      check(line(run.lines, id).text === want, `${label(id)}'s line with Left out`, line(run.lines, id).text);
    }
    // Nordlys on four boards (3), US Co on Indeed and Himalayas, Atlantique Cloud on Himalayas and Arc.dev
    check(run.merge === "5 duplicates merged, 0 already downloaded", `merge line: ${run.merge}`);
    check(/Fetching Himalayas…/.test(run.log) && /Himalayas page 2/.test(run.log), "the log follows Himalayas's pages", run.log);
    const himalayas = state.asked.filter((u) => /himalayas\.app\/jobs\/api\/search/.test(u));
    check(himalayas.length === 2 && himalayas.every((u) => /sort=recent/.test(u) && !/country=/.test(u)), `Himalayas asked twice, without country: ${himalayas.join(" ")}`);
    const jobicy = state.asked.filter((u) => /jobicy\.com\/api\//.test(u)).map((u) => new URL(u));
    check(
      jobicy.map((u) => u.searchParams.get("geo")).join(",") === "europe,europe,emea,anywhere" &&
        jobicy.every((u) => u.pathname === "/api/jobs" && !u.searchParams.has("tag") && !u.searchParams.has("industry")),
      `Jobicy asked for europe (2 pages), emea and anywhere, no tag: ${jobicy.map((u) => u.search).join(" ")}`
    );
    const hn = state.asked.filter((u) => /hn\.algolia\.com/.test(u)).map((u) => new URL(u).searchParams.get("tags"));
    check(hn.join(",") === "story,author_whoishiring,comment,story_45500000,comment,story_45500000", `Hacker News asked for the thread, then its 2 comment pages: ${hn.join(" ")}`);
    for (const host of ["euremotejobs.com", "arc.dev"]) {
      const asked = state.asked.filter((u) => new URL(u).host === host);
      check(asked[0] === `https://${host}/robots.txt` && asked.filter((u) => /robots\.txt/.test(u)).length === 1, `${host}: robots.txt read once, first: ${asked.join(" ")}`);
    }
    check(!state.asked.some((u) => /wp-json/.test(u)), "EU Remote Jobs reads its feed, no fallback");
    const { rows, header, sheet } = readSheet(run.file);
    console.log("rows:", JSON.stringify(rows.map((r) => [r.Title, r.Company, r.Site, r["Open to"], r["Also on"] || ""])));
    check(header[10] === "Job URL" && header[header.length - 1] === "Also on", `columns: ${header.join(", ")}`);
    check(rows.length === 28, `28 rows (4 Indeed + 4 Himalayas + 6 Jobicy + 9 Hacker News + 5 EU Remote Jobs + 5 Arc.dev − 5 merged): ${rows.length}`);
    const sitesSeen = new Set(rows.map((r) => r.Site));
    check(sitesSeen.size === BOARDS.length && BOARDS.every((id) => sitesSeen.has(label(id))), `Site is the source's label: ${[...sitesSeen].join(", ")}`);
    const merged = rows.filter((r) => r.Title === "Senior Backend Engineer");
    check(merged.length === 2 && merged.some((r) => r.Site === "Indeed" && r["Also on"] === "Himalayas" && r.Company === "US Co"), "Indeed's copy kept, Also on Himalayas");
    const nordlys = merged.find((r) => r.Company === "Nordlys Software AB") || {};
    check(nordlys.Site === "Himalayas" && nordlys["Open to"] === "Germany", "a Himalayas list names the ticked country it covers");
    check(
      String(nordlys["Also on"] || "").split(", ").sort().join(",") === "EU Remote Jobs,Hacker News,Jobicy",
      `one job on four boards: one row, Also on the other three: ${nordlys["Also on"]}`
    );
    const devops = rows.filter((r) => r.Company === "Atlantique Cloud SAS");
    // Same priority: the newer copy (Arc.dev's) is kept
    check(devops.length === 1 && devops[0].Site === "Arc.dev" && devops[0]["Also on"] === "Himalayas", `Arc.dev's newer copy of a Himalayas job kept: ${JSON.stringify(devops)}`);
    check(rows.filter((r) => r.Title === "DevOps Engineer").length === 3, "the same title at other companies isn't merged");
    check(Boolean(sheet.K2 && sheet.K2.l && /^https:\/\//.test(sheet.K2.l.Target)), "Job URL cells are links");
    await context.close();
  }

  // ---- 3. You live in Sweden ----
  {
    const { context, popup, state } = await launch("home", { indeed: INDEED_HOME() });
    await pickSources(popup, DEFAULTS);
    await popup.selectOption("#home", "SE");
    await pickCountries(popup, ["DE", "SE"]);
    for (const code of ["GB", "CA"]) await popup.uncheck(`input[name="abroad"][value="${code}"]`);
    await popup.selectOption("#job_type", "both");
    await popup.selectOption("#date_preset", "week");
    const run = await runFrom(popup, context);
    console.log(showLines(run));
    const { rows } = readSheet(run.file);
    const urls = rows.map((r) => r["Job URL"]);
    console.log("rows:", JSON.stringify(rows.map((r) => [r.Title, r.Company, r.Site, r["Open to"], r["Also on"] || ""])));
    check(!state.indeed.some((r) => r.country === "SE"), "Sweden's Indeed isn't searched");
    check(urls.some((u) => /jk=de1$/.test(u)) && urls.some((u) => /jk=us-se$/.test(u)), "the German job and the US job open to Sweden stay");
    check(!urls.some((u) => /jk=de4$|jk=de5$|jk=us-de$/.test(u)), "jobs for Germany's residents, in Sweden, or only open to Germany are left out");
    check(state.asked.some((u) => /himalayas\.app\/jobs\/api\/search\?.*country=SE/.test(u)), "Himalayas is asked for jobs open to Sweden");
    check(rows.some((r) => r.Title === "Python Developer" && r.Site === "Himalayas" && r["Open to"] === "Sweden"), "a Himalayas job limited to Sweden is kept for Sweden");
    check(!rows.some((r) => r.Title === "Go Developer"), "a Himalayas job saying you must be based in Germany is left out");
    check(/1 only for people living in their country/.test(line(run.lines, "himalayas").text), "Himalayas's line counts it", line(run.lines, "himalayas").text);
    const geos = state.asked.filter((u) => /jobicy\.com\/api\//.test(u)).map((u) => new URL(u).searchParams.get("geo"));
    check(geos.join(",").startsWith("europe") && geos.includes("sweden"), `Jobicy also asks for Sweden's own jobs: ${geos.join(",")}`);
    check(rows.some((r) => r.Company === "Svea Tech AB" && r.Site === "Jobicy" && r["Open to"] === "Sweden"), "a Jobicy job from geo=sweden is kept for Sweden");
    // A week back, Jobicy's older copy of EU Remote Jobs's Birch Analytics job is in too
    check(run.merge === "5 duplicates merged, 0 already downloaded" && rows.length === 21, `21 rows, 5 merged: ${rows.length}, ${run.merge}`);
    check(rows.some((r) => r.Company === "Birch Analytics" && r.Site === "EU Remote Jobs" && r["Also on"] === "Jobicy"), "Birch Analytics on EU Remote Jobs, Also on Jobicy");
    await context.close();
  }

  // ---- 4. Two sources failing: the others still export ----
  {
    const { context, popup, state } = await launch("fail");
    state.fail.add("himalayas");
    state.fail.add("euremotejobs");
    await pickSources(popup, DEFAULTS);
    await pickCountries(popup, ["DE", "FR", "IE"]);
    for (const code of ["GB", "CA", "US"]) await popup.uncheck(`input[name="abroad"][value="${code}"]`);
    await popup.selectOption("#job_type", "both");
    const run = await runFrom(popup, context);
    console.log(showLines(run));
    check(line(run.lines, "himalayas").text === "Himalayas failed: HTTP 500 at himalayas.app/jobs/api/search", "Himalayas failed, with why", line(run.lines, "himalayas").text);
    check(
      line(run.lines, "euremotejobs").text === "EU Remote Jobs failed: HTTP 500 at euremotejobs.com; fallback: HTTP 500 at euremotejobs.com/wp-json/wp/v2/job-listings",
      "EU Remote Jobs failed after trying its fallback, with both reasons",
      line(run.lines, "euremotejobs").text
    );
    check(
      ["himalayas", "euremotejobs"].every((id) => line(run.lines, id).status === "failed") && ["indeed", "jobicy", "hackernews"].every((id) => line(run.lines, id).status === "ok"),
      "the failed lines are marked failed, the others ok"
    );
    const sites = new Set(run.file ? readSheet(run.file).rows.map((r) => r.Site) : []);
    check(run.downloaded && [...sites].sort().join(",") === "Hacker News,Indeed,Jobicy", `the other sources' jobs still download: ${[...sites].join(", ")}`);
    check(/Warnings:\n- Himalayas: HTTP 500/.test(run.log) && /\n- EU Remote Jobs: HTTP 500/.test(run.log), "the log lists both failures", run.log);
    check(/EU Remote Jobs: the job feed failed \(HTTP 500 at euremotejobs\.com\); trying the WordPress API/.test(run.log), "the log says EU Remote Jobs tried its fallback", run.log);
    check(readSheet(run.file).rows.length === 17, "17 rows: Indeed 3 + Jobicy 6 + Hacker News 9 − 1 merged");
    await context.close();
  }

  // ---- 5. Stop and download ----
  {
    const { context, popup, state } = await launch("stop");
    state.slow.add("himalayas");
    await pickSources(popup, DEFAULTS);
    await pickCountries(popup, ["DE", "FR", "IE"]);
    for (const code of ["GB", "CA", "US"]) await popup.uncheck(`input[name="abroad"][value="${code}"]`);
    await popup.selectOption("#job_type", "both");
    let live = "";
    const run = await runFrom(popup, context, {
      during: async (runner) => {
        // Everyone but Himalayas has answered
        await runner.waitForFunction((n) => document.querySelectorAll("#source-list li").length >= n, DEFAULTS.length - 1, { timeout: 60000 });
        live = await runner.textContent("#live");
        await runner.click("#stop-btn");
      },
    });
    console.log(showLines(run));
    check(live === `Running: Himalayas · ${DEFAULTS.length - 1} of ${DEFAULTS.length} done`, `live status while Himalayas runs: ${live}`);
    check(run.downloaded && /stopped early/.test(run.status), `Stop downloads what was found: ${run.status}`);
    check(line(run.lines, "himalayas").text === "Himalayas failed: stopped by you", "Himalayas says it was stopped", line(run.lines, "himalayas").text);
    const rows = run.file ? readSheet(run.file).rows : [];
    check(rows.filter((r) => r.Site === "Indeed").length === 3 && !rows.some((r) => r.Site === "Himalayas") && rows.length === 21, `the others' 21 jobs are in the file, Indeed's 3 among them: ${rows.length}`);
    check(!(await run.runner.isVisible("#stop-btn")), "the Stop button goes away");
    await context.close();
  }

  // ---- 6. Check sources, then Copy report ----
  {
    const { context, popup, state } = await launch("check");
    state.fail.add("himalayas");
    await pickCountries(popup, ["DE", "FR"]);
    for (const code of ["GB", "CA", "US"]) await popup.uncheck(`input[name="abroad"][value="${code}"]`);
    // Check sources asks every source, ticked or not (Arc.dev is off by default)
    await popup.click(".source-group summary");
    await popup.uncheck('input[name="site"][value="indeed"]');
    const run = await runFrom(popup, context, { button: "#check-btn", expectDownload: false });
    console.log(showLines(run));
    check(!run.downloaded, "Check sources downloads nothing");
    check(run.status === `Checked ${live.length} sources: ${live.length - 1} answered, 1 failed. Copy report shows what each sent back.`, `status: ${run.status}`);
    check(run.lines.length === live.length, `a line for every source: ${run.lines.map((l) => l.id)}`);
    check(/^Indeed: OK · \d+ scanned → [1-3] kept/.test(line(run.lines, "indeed").text), "Indeed OK, at most 3 kept", line(run.lines, "indeed").text);
    for (const id of ["jobicy", "hackernews", "euremotejobs", "arc"]) {
      check(new RegExp(`^${label(id).replace(/\./g, "\\.")}: OK · \\d+ scanned → [1-9]\\d* kept`).test(line(run.lines, id).text), `${label(id)} OK`, line(run.lines, id).text);
    }
    check(/^Himalayas: FAILED · HTTP 500 at himalayas\.app\/jobs\/api\/search/.test(line(run.lines, "himalayas").text), "Himalayas FAILED", line(run.lines, "himalayas").text);
    check(/Each source: up to 3 jobs from the last 7 days/.test(run.log), "the log says what a check does");
    check(state.indeed.length > 0 && state.asked.some((u) => /^https:\/\/arc\.dev\/remote-jobs/.test(u)), "Indeed and Arc.dev were asked although unticked");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await run.runner.click("#copy-btn");
    await run.runner.waitForSelector("#copy-note:not([hidden])");
    const copied = await run.runner.evaluate(() => navigator.clipboard.readText().catch((e) => `unreadable: ${e.message}`));
    check(/^JobBridge EU [\d.]+ · source check · /.test(copied), "Copy report: a header", copied.slice(0, 200));
    check(/== Himalayas ==\nGET https:\/\/himalayas\.app\/jobs\/api\/search\?sort=recent&page=1 → HTTP 500\ncontent-type: text\/plain\nInternal Server Error/.test(copied), "Copy report: the failed source's response sample", copied);
    check(!/== (Indeed|Jobicy|Hacker News|EU Remote Jobs|Arc\.dev) ==/.test(copied) && !/cookie/i.test(copied), "no samples for sources that kept jobs, no cookies");
    await run.runner.screenshot({ path: path.join(OUT, "runner-check.png"), fullPage: true });
    await context.close();
  }

  console.log(failed ? `\nE2E: ${failed} check(s) failed` : "\nE2E: all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
