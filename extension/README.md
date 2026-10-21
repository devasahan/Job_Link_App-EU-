# JobBridge EU Chrome Extension

Standalone extension — **no `web.app` / Flask server required**.

Fetches **remote marketing jobs open to EU countries** from job boards' public APIs, then downloads an Excel (`.xlsx`) file. Built from JobBridge Fetch 1.14.0 (remote US jobs). Indeed is the first board; more boards plug into the same pipeline (see **Adding a board**).

## Platforms

| Option | How it fetches |
|--------|----------------|
| Indeed | GraphQL `apis.indeed.com`, one search per ticked country that has an Indeed site: the `indeed-co` header picks the country (`DE`, `FR`, `GB`…); labels come back in English (`indeed-locale: en-US`, as JobSpy sent until Sep 2026 and omkarcloud/indeed-scraper sends for every country). Remote jobs only: Indeed's remote attribute `DSQF7` and not its hybrid one `PAXZC`. The **Posted** window is applied by Indeed (`dateOnIndeed`) and checked again here. Indeed's newer filter list is tried first; if Indeed rejects it, the run says so and steps down — without the hybrid exclusion, then the remote filter alone (the US version's shape) — and checks the rest itself. With no **Title**, each country is searched for "marketing" and for its own word for communications (`Kommunikation`, `communication`, `comunicazione`, `komunikacji`…), plus the local word for marketing in Danish, Finnish, Greek, Norwegian and Swedish; many PR and communications ads never say "marketing". Up to 5 pages of 100 per search, newest first, one request at a time (0.5 s between pages, 1 s between countries, 20 s timeout). The job type is read from each job's attribute keys. A job Indeed places in a country you didn't tick is left out. Links point at the country's site (`de.indeed.com/viewjob?jk=…`, `uk.indeed.com` for the UK). An Indeed 401 (app key refused), 403 or 429 stops Indeed for that run; other errors skip only that country. Country codes and subdomains follow [JobSpy](https://github.com/speedyapply/JobSpy)'s `jobspy/indeed/constant.py` |

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
- **Type** — **Full time**, **Contract / freelance** or **Both**. Both keeps full-time and contract jobs (and jobs that never say a type) and drops part-time, internship, apprenticeship, working-student, temp-agency, seasonal and volunteer ones. With Full time or Contract, a job that clearly says the other type is dropped; jobs that never say a type stay. The type is read from Indeed's attribute keys, then the title, then explicit phrases or Indeed's "Job Types:" footer in the description, in any EU language (`Vollzeit`, `Teilzeit`, `Werkstudent`, `Praktikum`, `temps plein`, `stage`, `alternance`, `prácticas`, `tirocinio`, `deeltijd`, `pełny etat`, `staż`, `freiberuflich`, `umowa B2B`, `partita IVA`…). Permanent and fixed-term jobs (`Festanstellung`, `befristet`, `CDI`, `CDD`, `vast contract`) are employee jobs, so they count as full time unless they say part time. `Voll- oder Teilzeit` and `UoP lub B2B` are either. Swiss workloads count too (`80–100%` is either, `60%` part time). Jobs *about* a type aren't of that type: `Contract Manager`, `Stage Manager`, `Ausbildungsleiter`, `Early-Stage Startup`, `B2B Marketing`; neither are company footers (`Partita IVA 0123…`) or passing mentions (`we brief our freelancers`).
- **Years** — optional. Enter `3` to keep jobs whose posting asks for **3.5 years or fewer**: `3+ years of experience`, `mindestens 3 Jahre Berufserfahrung`, `Berufserfahrung (mind. 3 Jahre)`, `3 ans d'expérience`, `almeno 3 anni di esperienza`, `minimaal 3 jaar werkervaring`, `min. 3 lata doświadczenia`, `minst 3 års erfarenhet`, `vähintään 3 vuoden kokemus`, Indeed's `Experience: SEO: 3 years` footer, and the same shapes in 13 EU languages, including number words and year adjectives (`drei Jahre`, `trois ans`, `dreijährige`, `triennale`, `dwuletnie`, `διετής`). Ranges use the minimum (`3–5`, `2/3 anni`, `zwischen 2 und 4 Jahren`). The highest stated requirement is used. Company blurbs are ignored (`we have 15 years of experience`, `Wir blicken auf 12 Jahre Erfahrung zurück`, `Forte de 12 ans d'expérience, notre agence…`, anything above 15 years). Jobs that don't mention years stay. No language model is used.
- **Title** — optional. **Empty: any marketing role** — the job title must be a marketing job in any EU language (marketing, SEO/SEA/PPC, paid social, Meta/Google/TikTok Ads, programmatic, content, copywriting, brand, social media, community, CRM, lifecycle, email, growth, CRO, communications, PR and press, influencer, affiliate, UGC, market research…; `Marketingmanager`, `Chargé de communication`, `Attaché(e) de presse`, `Specjalista ds. marketingu`, `Marknadsförare`, `Υπεύθυνος Μάρκετινγκ`). Left out: telemarketing and call centres, MLM and promoters, sales jobs (SDR, Account Executive, Key Account, Business Developer), engineering and developer jobs, teaching, recruiting, design, AI-training and survey gigs, and look-alikes (`Content Moderator`, `Communications Engineer`, `Marktkommunikation`, `Kundenkommunikation`, `Brand Ambassador`, `Talent Acquisition`, `Account Growth Manager`). The check is tested against 179 real Indeed remote titles from 13 countries (`tests/fixtures/indeed-titles.json`). **With a title**, every word must be in the job title; separate titles with commas to get any of them (`SEO Manager, Content Marketing`), and each title is searched on its own.
- **Skills** — optional keywords such as `HubSpot`, `Google Ads`, `SEO`. Indeed is searched with title + skills, and each skill word must also be a whole word in the title or description (`SEO` = `search engine optimisation`, `Google Ads` = `AdWords`, `E-Mail` = `email`). The description is not written to the sheet.
- **OK** — opens a runner tab that fetches in-browser and saves `.xlsx`

Title and skill words are compared without case or accents in any EU language (`Référent` = `referent`, `Straße` = `strasse`, `Łódź` = `lodz`), with `Sr` = `Senior`, hyphens as spaces (`Online-Marketing-Manager`), longer words also inside German compounds (`marketing` matches `Onlinemarketing-Manager`), and gender tags like `(m/w/d)`, `(H/F)` or `Manager*in` ignored.

## Notes

- **Skip jobs I already downloaded** (popup, on by default): every job you download is remembered in this browser for 30 days, by its link and by its title + company (so the same job found later in another country or on another board counts too). Later runs leave those jobs out, and each board is asked for extra results so you still get up to Count new jobs per board. If nothing new turns up, the run says "No new jobs" and no file is downloaded. Untick the box to include repeats, or click **Forget downloaded jobs** to start fresh.
- The same job posted in several countries (same title + company) is one row; the first found wins.
- Boards may rate-limit or change their APIs; failed platforms are listed in the runner log while others still export. A board that stops partway (blocked, timed out, one country failing) keeps what it found and says "stopped early" in the log. If Indeed stops accepting its newer filters, the log says which step it fell back to.
- **403 fixes:** the extension installs a `declarativeNetRequest` header rule so its own Indeed API requests get the mobile Indeed App User-Agent (Indeed answers other user agents with 403). The rule skips requests made by Indeed's own pages, so your normal browsing is untouched. After updating, click **Reload** on the extension card (needed once so the rule installs).
- Excel is built with SheetJS (`lib/xlsx.mini.min.js`). Columns: Title, Company, Location, Country, Site, Posted, Remote, Listing type, Experience years, Job URL, Direct URL. Job URL and Direct URL cells are clickable links.
- Tests: `npm test` from the repository root (Node 20+, no install needed).

## Adding a board

1. Add `scrapers/<board>.js` exporting `scrape<Board>(opts)`, which returns jobs built with `normalizeJob()` (set `country` to the ISO code of the country the job is open to). `opts` holds `title`, `skills`, `countries` (ISO codes), `resultsWanted`, `datePreset`, `years`, `jobType`, `onProgress`. Filter each page with `filterByRequest()` so Count holds.
2. Register it in `scrapers/index.js` (`SCRAPERS` and `BOARD_COUNTRIES`, the countries it can search), add its checkbox to `popup.html`, and its hosts to `host_permissions` in `manifest.json`.
3. Boards that must run inside a real site tab (Cloudflare / DataDome) used a background service worker in the US version: see `background.js` (`scrapeInSiteTab`, `runPageScrape`) in the repository's first commit. `title-match.js`, `marketing.js` and `job-filters.js` are plain scripts so they can be injected into such tabs.
