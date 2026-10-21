# JobBridge EU Chrome Extension

Standalone extension — **no `web.app` / Flask server required**.

Fetches **remote marketing jobs open to EU countries** from job boards' public APIs, then downloads an Excel (`.xlsx`) file. Built from JobBridge Fetch 1.14.0 (remote US jobs). Indeed is the first board; more boards plug into the same pipeline (see **Adding a board**).

## Platforms

| Option | How it fetches |
|--------|----------------|
| Indeed | GraphQL `apis.indeed.com`, one search per ticked country that has an Indeed site: the `indeed-co` header picks the country (`DE`, `FR`, `GB`…) and `indeed-locale` its language (`de-DE`, `nl-BE`, `en-IE`…). Remote jobs only: Indeed's remote attribute `DSQF7` and not its hybrid one `PAXZC`. The **Posted** window is applied by Indeed (`dateOnIndeed`) and checked again here; if Indeed rejects that filter list, the run says so and falls back to the remote filter alone. Up to 5 pages of 100 per search, newest first, one request at a time (0.5 s between pages, 1 s between countries, 20 s timeout). The job type is read from the attribute keys of each job (Indeed's labels are translated), so jobs that never state a type stay. A job Indeed places in a country you didn't tick is left out. Links point at the country's site (`de.indeed.com/viewjob?jk=…`, `uk.indeed.com` for the UK). Country codes, subdomains and locales follow [JobSpy](https://github.com/speedyapply/JobSpy)'s `jobspy/indeed/constant.py` |

## Countries

The popup lists the 27 EU member states (all ticked by default) and the UK, Switzerland and Norway as extras (unticked). **All EU** / **None** pick quickly.

Indeed has a site for 18 EU countries — Austria, Belgium, Czechia, Denmark, Finland, France, Germany, Greece, Hungary, Ireland, Italy, Luxembourg, Netherlands, Poland, Portugal, Romania, Spain, Sweden — and for the UK, Switzerland and Norway. Bulgaria, Croatia, Cyprus, Estonia, Latvia, Lithuania, Malta, Slovakia and Slovenia have none: they are greyed out, the popup names them under the list, and the run log says they were not searched. Remote boards added later can cover them.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `extension/` folder
4. Pin **JobBridge EU** → set platforms / countries / count / type / years / title / skills → **OK**
5. Keep the fetch tab open until the Excel download finishes

If you already had the extension loaded, click **Reload** on the card after updates.

## Popup fields

- **Platforms** — boards to search. Boards added in an update start ticked, even if you saved your choices before.
- **Countries** — where the remote job must be open (see **Countries**). The summary shows "All EU (27)" or the names you picked.
- **Count** — max results **per platform** (1–200), across all ticked countries, newest first. One country can fill it.
- **Posted** — **Today** (last 24h) or **3 days** (last 72h)
- **Type** — **Full time**, **Contract / freelance** or **Both**. Both keeps full-time and contract jobs (and jobs that never say a type) and drops part-time, internship, apprenticeship and temporary ones. With Full time or Contract, a job that clearly says the other type is dropped; jobs that never say a type stay. Titles like `Contract Manager` are jobs about contracts, not contract jobs.
- **Years** — optional. Enter `3` to keep jobs whose posting asks for **3.5 years or fewer** (`3+ years of experience`, `mindestens 3 Jahre Berufserfahrung`, `3 ans d'expérience`, and the same shapes in other EU languages). The highest stated requirement is used. Company blurbs are ignored (`we have 15 years of experience`, anything above 15 years). Jobs that don't mention years stay. No language model is used.
- **Title** — optional. **Empty: any marketing role** — the job title must be a marketing job in any EU language (marketing, SEO/SEA/SEM/PPC, paid social, content, copywriting, brand, social media, community, CRM, lifecycle, growth, communications/PR, influencer, affiliate…; `Marketingmanager`, `Chargé de communication`, `Specjalista ds. marketingu`, `Marknadsförare`), while telemarketing, MLM, sales-rep, engineering/developer jobs and look-alikes (`Content Moderator`, `Communications Engineer`, `Brand Ambassador`, `Talent Acquisition`) are left out. Boards are then searched for "marketing" (plus the local word in Danish, Finnish, Greek, Norwegian and Swedish). **With a title**, every word must be in the job title; separate titles with commas to get any of them (`SEO Manager, Content Marketing`), and each title is searched on its own.
- **Skills** — optional keywords such as `HubSpot`, `Google Ads`, `SEO`. Indeed is searched with title + skills, and each skill word must also be a whole word in the title or description (`SEO` = `search engine optimisation`, `Google Ads` = `AdWords`, `E-Mail` = `email`). The description is not written to the sheet.
- **OK** — opens a runner tab that fetches in-browser and saves `.xlsx`

Title and skill words are compared without case or accents in any EU language (`Référent` = `referent`, `Straße` = `strasse`, `Łódź` = `lodz`), with `Sr` = `Senior`, hyphens as spaces (`Online-Marketing-Manager`), longer words also inside German compounds (`marketing` matches `Onlinemarketing-Manager`), and gender tags like `(m/w/d)`, `(H/F)` or `Manager*in` ignored.

## Notes

- **Skip jobs I already downloaded** (popup, on by default): every job you download is remembered in this browser for 30 days, by its link and by its title + company (so the same job found later in another country or on another board counts too). Later runs leave those jobs out, and each board is asked for extra results so you still get up to Count new jobs per board. If nothing new turns up, the run says "No new jobs" and no file is downloaded. Untick the box to include repeats, or click **Forget downloaded jobs** to start fresh.
- The same job posted in several countries (same title + company) is one row; the first found wins.
- Boards may rate-limit or change their APIs; failed platforms are listed in the runner log while others still export. A board that stops partway (blocked, timed out, one country failing) keeps what it found and says "stopped early" in the log. An Indeed 403 or 429 stops Indeed for that run; other errors skip only that country.
- **403 fixes:** the extension installs a `declarativeNetRequest` header rule so its own Indeed API requests get the mobile Indeed App User-Agent (Indeed answers other user agents with 403). The rule skips requests made by Indeed's own pages, so your normal browsing is untouched. After updating, click **Reload** on the extension card (needed once so the rule installs).
- Excel is built with SheetJS (`lib/xlsx.mini.min.js`). Columns: Title, Company, Location, Country, Site, Posted, Remote, Listing type, Experience years, Job URL, Direct URL. Job URL and Direct URL cells are clickable links.
- Tests: `npm test` from the repository root (Node 20+, no install needed).

## Adding a board

1. Add `scrapers/<board>.js` exporting `scrape<Board>(opts)`, which returns jobs built with `normalizeJob()` (set `country` to the ISO code of the country the job is open to). `opts` holds `title`, `skills`, `countries` (ISO codes), `resultsWanted`, `datePreset`, `years`, `jobType`, `onProgress`. Filter each page with `filterByRequest()` so Count holds.
2. Register it in `scrapers/index.js` (`SCRAPERS` and `BOARD_COUNTRIES`, the countries it can search), add its checkbox to `popup.html`, and its hosts to `host_permissions` in `manifest.json`.
3. Boards that must run inside a real site tab (Cloudflare / DataDome) used a background service worker in the US version: see `background.js` (`scrapeInSiteTab`, `runPageScrape`) in the repository's first commit. `title-match.js`, `marketing.js` and `job-filters.js` are plain scripts so they can be injected into such tabs.
