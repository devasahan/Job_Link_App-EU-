# Job Link App (EU)

**JobBridge EU** — a Chrome extension that fetches remote developer jobs open to people living in the EU and downloads them as an Excel file. No server needed.

- The extension is in [`extension/`](extension/): load that folder with **Load unpacked** in `chrome://extensions`. Its [README](extension/README.md) explains every popup field and how each board is searched.
- **You live in** (optional): set your country to get jobs from other countries only. Your own country is left out, and so are remote jobs elsewhere that say you must live there ("Homeoffice innerhalb Deutschlands", "must be based in the Netherlands").
- Boards: Indeed, searched country by country — 18 EU countries plus Norway and Switzerland — and on its UK, Canada and US sites for employers that say they hire in Europe. More boards can be added; see **Adding a board** in the extension README.
- Tests: `npm test` (Node 20+, no install needed).

The first commit holds the US version this was built from (JobBridge Fetch 1.14.0, 14 boards, remote US jobs).
