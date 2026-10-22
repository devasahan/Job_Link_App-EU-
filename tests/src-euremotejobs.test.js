import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { adapterContract, runFixture } from "./helpers/contract.js";
import { FIXTURES_DIR } from "./helpers/fixture.js";
import { whereOf, fromFeedItem, fromRestRow } from "../extension/scrapers/boards/euremotejobs.js";
import { parseFeed } from "../extension/scrapers/formats/feed.js";
import { DATE_PRESETS } from "../extension/scrapers/util.js";

// The registry entry this adapter ships with (sources.js)
const META = {
  id: "euremotejobs",
  label: "EU Remote Jobs",
  group: "boards",
  hint: "remote, Europe",
  url: "https://euremotejobs.com",
  module: "./boards/euremotejobs.js",
  hosts: ["euremotejobs.com"],
  defaultOn: true,
  robots: "obey",
};
const id = META.id;
const fixture = (file) => fs.readFileSync(path.join(FIXTURES_DIR, id, file), "utf8");
const params = (url) => new URL(url).searchParams;
const isFeed = (url) => params(url).get("feed") === "job_feed";
const isRest = (url) => new URL(url).pathname.startsWith("/wp-json/");
const isRobots = (url) => new URL(url).pathname === "/robots.txt";
const page2 = (url) => (isFeed(url) && params(url).get("paged") === "2") || (isRest(url) && params(url).get("page") === "2");
const HTML_404 = { status: 404, body: "<!doctype html><html><head><title>Page not found</title></head><body>Nothing here</body></html>", contentType: "text/html" };

adapterContract({
  id,
  meta: META,
  secondPage: page2,
  empty: { body: fixture("empty.xml"), contentType: "application/rss+xml" },
  expect: {
    kept: ["Senior Backend Engineer", "Python Developer", "Scala Developer", "Platform Engineer", "Data Engineer", "Senior Rust Engineer"],
    dropped: { title: 1, old: 1, type: 1, notRemote: 1, restricted: 1, notOpen: 1 },
  },
});

test("Where: the location as the board's list; none or a bare Remote is Europe, Anywhere the world, a city the text", () => {
  const base = { workplace: null, listedIn: null, emptyOpen: "europe", utc: null, remoteOnly: true };
  assert.deepEqual(whereOf(""), { ...base, open: [] });
  assert.deepEqual(whereOf(" Remote "), { ...base, open: [] });
  assert.deepEqual(whereOf("Fully Remote"), { ...base, open: [] });
  assert.deepEqual(whereOf("Anywhere"), { ...base, open: ["Worldwide"] });
  assert.deepEqual(whereOf("Remote - Anywhere"), { ...base, open: ["Worldwide"] });
  assert.deepEqual(whereOf("EMEA"), { ...base, open: ["EMEA"] });
  assert.deepEqual(whereOf("Europe,  Netherlands"), { ...base, open: ["Europe, Netherlands"] });
  assert.deepEqual(whereOf("USA"), { ...base, open: ["USA"] });
  assert.deepEqual(whereOf("Berlin"), { ...base, open: null });
});

test("a feed item: the plugin's fields, the guid as id, several job types", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:job_listing="https://euremotejobs.com"><channel>
    <item><title>Backend Engineer &#8211; Payments</title><link>https://euremotejobs.com/job/backend/</link>
      <pubDate>Wed, 21 Oct 2026 10:00:00 +0000</pubDate>
      <guid isPermaLink="false">https://euremotejobs.com/?post_type=job_listing&#038;p=7</guid>
      <description><![CDATA[Short.]]></description>
      <content:encoded><![CDATA[<p>Go and <b>Postgres</b>.</p>]]></content:encoded>
      <category><![CDATA[Software Development]]></category>
      <job_listing:location><![CDATA[Remote, Europe]]></job_listing:location>
      <job_listing:job_type><![CDATA[Full Time]]></job_listing:job_type>
      <job_listing:job_type><![CDATA[Freelance]]></job_listing:job_type>
      <job_listing:company><![CDATA[Ferrous BV]]></job_listing:company></item>
    <item><title>Developer</title><link>https://euremotejobs.com/job/dev/</link><guid>https://euremotejobs.com/?p=8</guid></item>
  </channel></rss>`;
  const [job, bare] = parseFeed(xml).items.map(fromFeedItem);
  assert.equal(job.title, "Backend Engineer – Payments");
  assert.equal(job.company, "Ferrous BV");
  assert.equal(job.location, "Remote, Europe");
  assert.equal(job.listing_type, "Full Time, Freelance");
  assert.equal(job.date_posted, "2026-10-21T10:00:00.000Z");
  assert.equal(job.job_url, "https://euremotejobs.com/job/backend/");
  assert.equal(job._id, "https://euremotejobs.com/?post_type=job_listing&p=7");
  assert.equal(job.description, "Go and Postgres. Software Development");
  assert.equal(job.is_remote, "Yes");
  assert.equal(job.anonymous, undefined);
  // No company, no location: anonymous, and the board's Europe
  assert.equal(bare.anonymous, true);
  assert.equal(bare.location, "Remote (Europe)");
  assert.deepEqual(bare._where.open, []);
});

test("You live in: a country list that leaves you out is restricted; 'must be based in' elsewhere is residents only", async () => {
  const se = await runFixture({ id, meta: META, opts: { home: "SE" } });
  assert.equal(se.jobs.find((j) => j.title === "Python Developer").open_to, "Sweden");
  assert.ok(!se.jobs.some((j) => j.title === "Scala Developer"));
  assert.equal(se.report.dropped.residentsOnly, 1);
  const de = await runFixture({ id, meta: META, opts: { home: "DE" } });
  assert.ok(!de.jobs.some((j) => j.title === "Python Developer"));
  assert.ok(de.jobs.some((j) => j.title === "Scala Developer"));
  assert.equal(de.report.dropped.restricted, 2);
});

test("what is asked: the job feed, 50 a page, paged from page 2, robots.txt first; the open-to cells", async () => {
  const { calls, jobs, report } = await runFixture({ id, meta: META });
  assert.ok(isRobots(calls[0].url), "robots.txt is read first");
  const data = calls.filter((c) => !isRobots(c.url));
  assert.equal(data.length, 2, "page 2 ends past the window: no page 3");
  assert.equal(params(data[0].url).get("posts_per_page"), "50");
  assert.equal(params(data[0].url).get("paged"), null);
  assert.equal(params(data[1].url).get("paged"), "2");
  const by = (title) => jobs.find((j) => j.title === title);
  assert.equal(by("Senior Backend Engineer").open_to, "Europe");
  assert.equal(by("Platform Engineer").open_to, "Europe", "no location: the board's Europe");
  assert.equal(by("Data Engineer").open_to, "Worldwide");
  assert.equal(by("Senior Rust Engineer").location, "Remote (Europe, Netherlands)");
  assert.equal(report.notes.length, 0);
});

test("the feed fails: the WordPress API answers instead, and the log says so", async () => {
  const { report, jobs, calls } = await runFixture({ id, meta: META, respond: (call) => (isFeed(call.url) ? HTML_404 : null) });
  assert.equal(report.status, "ok", report.error);
  assert.match(report.notes[0], /^EU Remote Jobs: the job feed failed \(HTTP 404 at euremotejobs\.com\); trying the WordPress API$/);
  const rest = calls.filter((c) => isRest(c.url));
  assert.equal(rest.length, 2, "page 2 is WordPress's 400 for a page past the end");
  assert.equal(params(rest[0].url).get("per_page"), "50");
  assert.equal(params(rest[0].url).get("_embed"), "wp:term");
  assert.deepEqual(jobs.map((j) => j.title).sort(), ["Python Developer", "Senior Backend Engineer – Payments"]);
  const backend = jobs.find((j) => j.company === "Nordlys Software AB");
  // The same id as the feed's guid
  assert.equal(backend._id, "https://euremotejobs.com/?post_type=job_listing&p=4101");
  assert.equal(backend.listing_type, "Full Time");
  assert.equal(backend.job_url_direct, "https://jobs.nordlys.example/apply/123");
  assert.match(backend.description, /Software Development$/);
  // An e-mail address is no link
  assert.equal(jobs.find((j) => j.title === "Python Developer").job_url_direct, "");
  // A filled job counts as expired
  assert.equal(report.dropped.expired, 1);
});

test("a REST row: zone-less GMT dates, the expiry day, filled jobs", () => {
  const job = fromRestRow({
    id: 1,
    date: "2026-10-21T12:00:00",
    date_gmt: "2026-10-21T10:00:00",
    link: "https://euremotejobs.com/job/x/",
    guid: { rendered: "https://euremotejobs.com/?post_type=job_listing&#038;p=1" },
    title: { rendered: "Go &amp; Rust Developer" },
    content: { rendered: "<p>Go.</p>" },
    meta: { _job_location: ["Germany"], _company_name: ["Brandt Systems"], _job_expires: "2026-11-20", _application: "https://euremotejobs.com/apply/1" },
  });
  assert.equal(job.date_posted, "2026-10-21T10:00:00.000Z");
  assert.equal(job.title, "Go & Rust Developer");
  assert.equal(job.company, "Brandt Systems");
  assert.equal(job._expires, "2026-11-20T23:59:59Z");
  assert.equal(job._id, "https://euremotejobs.com/?post_type=job_listing&p=1");
  assert.equal(job.job_url_direct, "", "the board's own apply page is no direct link");
  assert.deepEqual(job._where.open, ["Germany"]);
  const filled = fromRestRow({ link: "https://euremotejobs.com/job/y/", date_gmt: "2026-10-21T10:00:00", modified_gmt: "2026-10-21T11:00:00", meta: { _filled: true } });
  assert.equal(filled._expires, "2026-10-21T11:00:00.000Z");
  assert.equal(filled.anonymous, true);
});

test("both the feed and the API fail: the message says both, the feed's kind leads", async () => {
  const { report } = await runFixture({
    id,
    meta: META,
    respond: (call) => (isFeed(call.url) ? HTML_404 : isRest(call.url) ? { status: 403, body: "Forbidden", contentType: "text/plain" } : null),
  });
  assert.equal(report.status, "failed");
  assert.equal(report.errorKind, "http");
  assert.equal(report.error, "HTTP 404 at euremotejobs.com; fallback: HTTP 403 (blocked) at euremotejobs.com/wp-json/wp/v2/job-listings");
});

test("rate-limited on the feed: no second try at the API", async () => {
  const { report, calls } = await runFixture({ id, meta: META, respond: (call) => (isFeed(call.url) ? { status: 429, body: "slow down" } : null) });
  assert.equal(report.status, "failed");
  assert.equal(report.errorKind, "blocked");
  assert.ok(!calls.some((c) => isRest(c.url)));
});

test("robots.txt: the feed disallowed → the API; everything disallowed → failed, saying so", async () => {
  const robots = (body) => (call) => (isRobots(call.url) ? { body, contentType: "text/plain" } : null);
  const feedOff = await runFixture({ id, meta: META, respond: robots("User-agent: *\nDisallow: /?feed=\n") });
  assert.equal(feedOff.report.status, "ok", feedOff.report.error);
  assert.ok(!feedOff.calls.some((c) => isFeed(c.url)), "the disallowed feed is never fetched");
  assert.ok(feedOff.report.kept >= 1);
  const allOff = await runFixture({ id, meta: META, respond: robots("User-agent: *\nDisallow: /\n") });
  assert.equal(allOff.report.status, "failed");
  assert.equal(allOff.report.errorKind, "robots");
  assert.match(allOff.report.error, /robots\.txt disallows/);
  assert.equal(allOff.calls.filter((c) => !isRobots(c.url)).length, 0);
});

test("paging ends without failing: a 404 past the last page, or the same page again", async () => {
  const gone = await runFixture({ id, meta: META, respond: (call) => (page2(call.url) ? HTML_404 : null) });
  assert.equal(gone.report.status, "ok", gone.report.error);
  assert.equal(gone.report.kept, 5);
  const same = await runFixture({ id, meta: META, opts: { preset: DATE_PRESETS.week }, respond: (call) => (isFeed(call.url) ? { body: fixture("page1.xml"), contentType: "application/rss+xml" } : null) });
  assert.equal(same.report.status, "ok");
  assert.equal(same.calls.filter((c) => isFeed(c.url)).length, 2, "page 2 repeats page 1: stop");
  assert.equal(same.report.duplicates, 0);
});

test("a challenge page instead of the feed counts as blocked", async () => {
  const challenge = { body: "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf-browser-verification</body></html>", contentType: "text/html" };
  const { report } = await runFixture({ id, meta: META, respond: (call) => (isFeed(call.url) || isRest(call.url) ? challenge : null) });
  assert.equal(report.status, "failed");
  assert.equal(report.errorKind, "blocked");
  assert.match(report.error, /^a challenge page at euremotejobs\.com/);
});
