# Job Link App (EU)

**JobBridge EU** — a Chrome extension that fetches remote marketing jobs open to EU countries and downloads them as an Excel file. No server needed.

- The extension is in [`extension/`](extension/): load that folder with **Load unpacked** in `chrome://extensions`. Its [README](extension/README.md) explains every popup field and how each board is searched.
- Boards: Indeed, searched country by country (18 EU countries plus the UK, Switzerland and Norway). More boards can be added; see **Adding a board** in the extension README.
- Tests: `npm test` (Node 20+, no install needed).

The first commit holds the US version this was built from (JobBridge Fetch 1.14.0, 14 boards, remote US jobs).
