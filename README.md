# Job Link App (EU)

**JobBridge EU** — a Chrome extension that fetches remote developer jobs open to people living in the EU and downloads them as an Excel file. No server needed.

- The extension is in [`extension/`](extension/): load that folder with **Load unpacked** in `chrome://extensions`. Its [README](extension/README.md) explains every popup field and how each board is searched.
- Boards: Indeed, searched country by country — 18 EU countries plus Norway and Switzerland — and on its UK, Canada and US sites for employers that say they hire in Europe. More boards can be added; see **Adding a board** in the extension README.
- Tests: `npm test` (Node 20+, no install needed).

**Work Application Tracker** — a one-file web app in [`tracker/index.html`](tracker/index.html) for tracking applications, tailoring a resume and cover letter for each job with any AI chat (or a Gemini key), checking ATS keywords and downloading PDFs. Open the file in Chrome; data stays in that browser unless you turn on Supabase sync. It opens with an example profile you can remove.

The first commit holds the US version this was built from (JobBridge Fetch 1.14.0, 14 boards, remote US jobs).
