# Job Link App (EU)

**JobBridge EU** — a Chrome extension that fetches remote developer jobs open to people living in the EU and downloads them as an Excel file. No server needed.

- The extension is in [`extension/`](extension/): load that folder with **Load unpacked** in `chrome://extensions`. Its [README](extension/README.md) explains every popup field and how each board is searched.
- **You live in** (optional): set your country to get jobs from other countries only. Your own country is left out, and so are remote jobs elsewhere that say you must live there ("Homeoffice innerhalb Deutschlands", "must be based in the Netherlands").
- Sources: Indeed, searched country by country — 18 EU countries plus Norway and Switzerland — and on its UK, Canada and US sites for employers that say they hire in Europe; and five remote job boards: Himalayas, Jobicy, Hacker News "Who is hiring", EU Remote Jobs and Arc.dev (off by default: it needs a free profile to apply and reads pages that change). All ticked sources run at once, each source's line says what it kept and left out, and the same job found on several sources is one row that names the others under **Also on**. More sources are being added; see **Adding a board** in the extension README.
- **Check sources** (under OK in the popup): run it after installing or updating. It asks every source for a few recent jobs and shows which answer and why the others don't, without downloading. **Copy report** then copies the log and what failing sources sent back (never cookies), to send when a source needs fixing.
- Tests: `npm test` (Node 20+, no install needed); `npm run e2e` drives the extension in Chromium against fixtures (needs Playwright).

The first commit holds the US version this was built from (JobBridge Fetch 1.14.0, 14 boards, remote US jobs).
