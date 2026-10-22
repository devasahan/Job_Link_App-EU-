// End-to-end check (npm run e2e): load the unpacked extension in Chromium,
// drive the popup, answer every request from fixtures (each
// tests/fixtures/sources/*/routes.json, plus an Indeed GraphQL mock below),
// and read the Excel the runner saves. Nothing reaches the network.
// Scenarios: the popup; a run (per-source lines, Left out, a merge, Site and
// Also on); You live in; one source failing while the other exports; Stop
// and download; Check sources (no download) with Copy report.
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

const line = (lines, id) => lines.find((l) => l.id === id) || { text: "", status: "" };

(async () => {
  // ---- 1. The popup ----
  {
    const { context, popup } = await launch("popup");
    const groups = await popup.$$eval(".source-group", (els) => els.map((e) => e.querySelector("summary").textContent.replace(/\s+/g, " ").trim()));
    check(groups.length === 1 && /^Job boards · \d+ of \d+$/.test(groups[0]), `one Platforms group with counts: ${groups.join(" | ")}`);
    const sites = await popup.$$eval('input[name="site"]', (els) => els.map((e) => `${e.value}:${e.checked}`));
    check(sites.includes("indeed:true") && sites.includes("himalayas:true"), `Indeed and Himalayas ticked by default: ${sites.join(", ")}`);
    check((await popup.textContent('label.field:has(#count) span')) === "Count per source", "Count reads per source");
    check(await popup.isVisible("#check-btn"), "a Check sources link");
    check(JSON.stringify(await popup.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())) === '["header_rules"]', "header rules enabled");
    await popup.screenshot({ path: path.join(OUT, "popup-collapsed.png"), fullPage: true });
    // A remote board searches every country: none greyed out while it is ticked
    const greyed = () => popup.$$eval('input[name="country"]', (els) => els.filter((e) => e.parentElement.classList.contains("uncovered")).map((e) => e.value));
    check((await greyed()).length === 0, "no country greyed out with Himalayas ticked");
    await popup.click(".source-group summary");
    await popup.uncheck('input[name="site"][value="himalayas"]');
    check((await greyed()).join(",") === "BG,HR,CY,EE,LV,LT,MT,SK,SI", `Indeed alone greys out its missing sites: ${await greyed()}`);
    check(/· 1 of 2$/.test(await popup.textContent(".source-group summary")), "the group count follows the ticks");
    await popup.click('[data-group-pick="all"]');
    check((await greyed()).length === 0, "All ticks the group again");
    await popup.click("#countries summary");
    await popup.screenshot({ path: path.join(OUT, "popup-default.png"), fullPage: true });
    await popup.selectOption("#home", "SE");
    check((await popup.textContent("#country-summary")) === "All EU (27) · not Sweden", `summary with You live in: ${await popup.textContent("#country-summary")}`);
    await popup.screenshot({ path: path.join(OUT, "popup-home.png"), fullPage: true });
    await context.close();
  }

  // ---- 2. A run: both sources, a merge, Site and Also on ----
  {
    const { context, popup, state } = await launch("run");
    await pickCountries(popup, ["DE", "FR", "IE", "HR"]);
    await popup.fill("#count", "20");
    await popup.selectOption("#job_type", "both");
    await popup.selectOption("#date_preset", "today");
    await popup.screenshot({ path: path.join(OUT, "popup-picked.png"), fullPage: true });
    const run = await runFrom(popup, context);
    await run.runner.screenshot({ path: path.join(OUT, "runner.png"), fullPage: true });
    console.log(`status: ${run.status}\n${run.lines.map((l) => `  [${l.status}] ${l.text}`).join("\n")}\n  ${run.merge}`);
    check(run.downloaded, "the run downloads Excel", run.status);
    check(/^Indeed: \d+ scanned → 4 kept\. Left out: .*not developer roles/.test(line(run.lines, "indeed").text), "Indeed's line", line(run.lines, "indeed").text);
    check(
      line(run.lines, "himalayas").text ===
        "Himalayas: 11 scanned → 4 kept. Left out: 1 not developer roles, 1 older than 24 hours, 1 expired, 1 hybrid or not remote, 3 limited to other countries",
      "Himalayas's line with Left out",
      line(run.lines, "himalayas").text
    );
    check(run.merge === "1 duplicates merged, 0 already downloaded", `merge line: ${run.merge}`);
    check(/Fetching Himalayas…/.test(run.log) && /Himalayas page 2/.test(run.log), "the log follows Himalayas's pages", run.log);
    const himalayas = state.asked.filter((u) => /himalayas\.app\/jobs\/api\/search/.test(u));
    check(himalayas.length === 2 && himalayas.every((u) => /sort=recent/.test(u) && !/country=/.test(u)), `Himalayas asked twice, without country: ${himalayas.join(" ")}`);
    const { rows, header, sheet } = readSheet(run.file);
    console.log("rows:", JSON.stringify(rows.map((r) => [r.Title, r.Company, r.Site, r["Open to"], r["Also on"] || ""])));
    check(header[10] === "Job URL" && header[header.length - 1] === "Also on", `columns: ${header.join(", ")}`);
    check(rows.length === 7, `7 rows (4 Indeed + 4 Himalayas − 1 merged): ${rows.length}`);
    check(new Set(rows.map((r) => r.Site)).size === 2 && rows.some((r) => r.Site === "Himalayas") && rows.some((r) => r.Site === "Indeed"), "Site is the source's label");
    const merged = rows.filter((r) => r.Title === "Senior Backend Engineer");
    check(merged.length === 2 && merged.some((r) => r.Site === "Indeed" && r["Also on"] === "Himalayas" && r.Company === "US Co"), "Indeed's copy kept, Also on Himalayas");
    check(rows.some((r) => r.Company === "Nordlys Software AB" && r["Open to"] === "Germany"), "a Himalayas list names the ticked country it covers");
    check(Boolean(sheet.K2 && sheet.K2.l && /^https:\/\//.test(sheet.K2.l.Target)), "Job URL cells are links");
    await context.close();
  }

  // ---- 3. You live in Sweden ----
  {
    const { context, popup, state } = await launch("home", { indeed: INDEED_HOME() });
    await popup.selectOption("#home", "SE");
    await pickCountries(popup, ["DE", "SE"]);
    for (const code of ["GB", "CA"]) await popup.uncheck(`input[name="abroad"][value="${code}"]`);
    await popup.selectOption("#job_type", "both");
    await popup.selectOption("#date_preset", "week");
    const run = await runFrom(popup, context);
    const { rows } = readSheet(run.file);
    const urls = rows.map((r) => r["Job URL"]);
    console.log("rows:", JSON.stringify(rows.map((r) => [r.Title, r.Site, r["Open to"]])));
    check(!state.indeed.some((r) => r.country === "SE"), "Sweden's Indeed isn't searched");
    check(urls.some((u) => /jk=de1$/.test(u)) && urls.some((u) => /jk=us-se$/.test(u)), "the German job and the US job open to Sweden stay");
    check(!urls.some((u) => /jk=de4$|jk=de5$|jk=us-de$/.test(u)), "jobs for Germany's residents, in Sweden, or only open to Germany are left out");
    check(state.asked.some((u) => /himalayas\.app\/jobs\/api\/search\?.*country=SE/.test(u)), "Himalayas is asked for jobs open to Sweden");
    check(rows.some((r) => r.Title === "Python Developer" && r["Open to"] === "Sweden"), "a Himalayas job limited to Sweden is kept for Sweden");
    check(!rows.some((r) => r.Title === "Go Developer"), "a Himalayas job saying you must be based in Germany is left out");
    check(/1 only for people living in their country/.test(line(run.lines, "himalayas").text), "Himalayas's line counts it", line(run.lines, "himalayas").text);
    await context.close();
  }

  // ---- 4. One source failing: the other still exports ----
  {
    const { context, popup, state } = await launch("fail");
    state.fail.add("himalayas");
    await pickCountries(popup, ["DE", "FR", "IE"]);
    for (const code of ["GB", "CA", "US"]) await popup.uncheck(`input[name="abroad"][value="${code}"]`);
    await popup.selectOption("#job_type", "both");
    const run = await runFrom(popup, context);
    console.log(`status: ${run.status}\n${run.lines.map((l) => `  [${l.status}] ${l.text}`).join("\n")}`);
    check(line(run.lines, "himalayas").text === "Himalayas failed: HTTP 500 at himalayas.app/jobs/api/search", "Himalayas failed, with why", line(run.lines, "himalayas").text);
    check(line(run.lines, "himalayas").status === "failed" && line(run.lines, "indeed").status === "ok", "its line is marked failed, Indeed's ok");
    check(run.downloaded && readSheet(run.file).rows.every((r) => r.Site === "Indeed"), "Indeed's jobs still download");
    check(/Warnings:\n- Himalayas: HTTP 500/.test(run.log), "the log lists the failure", run.log);
    await context.close();
  }

  // ---- 5. Stop and download ----
  {
    const { context, popup, state } = await launch("stop");
    state.slow.add("himalayas");
    await pickCountries(popup, ["DE", "FR", "IE"]);
    for (const code of ["GB", "CA", "US"]) await popup.uncheck(`input[name="abroad"][value="${code}"]`);
    await popup.selectOption("#job_type", "both");
    let live = "";
    const run = await runFrom(popup, context, {
      during: async (runner) => {
        await runner.waitForFunction(() => document.querySelector('#source-list li[data-source="indeed"]'), null, { timeout: 60000 });
        live = await runner.textContent("#live");
        await runner.click("#stop-btn");
      },
    });
    console.log(`status: ${run.status}\n${run.lines.map((l) => `  [${l.status}] ${l.text}`).join("\n")}`);
    check(/^Running: Himalayas · 1 of 2 done/.test(live), `live status while Himalayas runs: ${live}`);
    check(run.downloaded && /stopped early/.test(run.status), `Stop downloads what was found: ${run.status}`);
    check(line(run.lines, "himalayas").text === "Himalayas failed: stopped by you", "Himalayas says it was stopped", line(run.lines, "himalayas").text);
    check(readSheet(run.file).rows.length === 3, "Indeed's 3 jobs are in the file");
    check(!(await run.runner.isVisible("#stop-btn")), "the Stop button goes away");
    await context.close();
  }

  // ---- 6. Check sources, then Copy report ----
  {
    const { context, popup, state } = await launch("check");
    state.fail.add("himalayas");
    await pickCountries(popup, ["DE", "FR"]);
    for (const code of ["GB", "CA", "US"]) await popup.uncheck(`input[name="abroad"][value="${code}"]`);
    // Check sources asks every source, ticked or not
    await popup.click(".source-group summary");
    await popup.uncheck('input[name="site"][value="indeed"]');
    const run = await runFrom(popup, context, { button: "#check-btn", expectDownload: false });
    console.log(`status: ${run.status}\n${run.lines.map((l) => `  [${l.status}] ${l.text}`).join("\n")}`);
    check(!run.downloaded, "Check sources downloads nothing");
    check(run.status === "Checked 2 sources: 1 answered, 1 failed. Copy report shows what each sent back.", `status: ${run.status}`);
    check(/^Indeed: OK · \d+ scanned → [1-3] kept/.test(line(run.lines, "indeed").text), "Indeed OK, at most 3 kept", line(run.lines, "indeed").text);
    check(/^Himalayas: FAILED · HTTP 500 at himalayas\.app\/jobs\/api\/search/.test(line(run.lines, "himalayas").text), "Himalayas FAILED", line(run.lines, "himalayas").text);
    check(/Each source: up to 3 jobs from the last 7 days/.test(run.log), "the log says what a check does");
    check(state.indeed.length > 0, "Indeed was asked although unticked");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await run.runner.click("#copy-btn");
    await run.runner.waitForSelector("#copy-note:not([hidden])");
    const copied = await run.runner.evaluate(() => navigator.clipboard.readText().catch((e) => `unreadable: ${e.message}`));
    check(/^JobBridge EU [\d.]+ · source check · /.test(copied), "Copy report: a header", copied.slice(0, 200));
    check(/== Himalayas ==\nGET https:\/\/himalayas\.app\/jobs\/api\/search\?sort=recent&page=1 → HTTP 500\ncontent-type: text\/plain\nInternal Server Error/.test(copied), "Copy report: the failed source's response sample", copied);
    check(!/== Indeed ==/.test(copied) && !/cookie/i.test(copied), "no samples for sources that kept jobs, no cookies");
    await run.runner.screenshot({ path: path.join(OUT, "runner-check.png"), fullPage: true });
    await context.close();
  }

  console.log(failed ? `\nE2E: ${failed} check(s) failed` : "\nE2E: all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
