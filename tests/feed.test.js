import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, feedDate, parseFeed } from "../extension/scrapers/formats/feed.js";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:job_listing="https://wpjobmanager.com" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>EU Remote Jobs &#8211; Jobs</title>
  <!-- a comment with <item> inside -->
  <item>
    <title>Senior Backend Developer &amp; Team Lead</title>
    <link>https://euremotejobs.com/job/senior-backend/</link>
    <guid isPermaLink="false">https://euremotejobs.com/?post_type=job_listing&#038;p=123</guid>
    <pubDate>Wed, 21 Oct 2026 10:00:00 +0000</pubDate>
    <dc:creator><![CDATA[Nordlys]]></dc:creator>
    <description><![CDATA[<p>Build APIs in <b>Go</b>. Text with </description> inside CDATA.</p>]]></description>
    <content:encoded>&lt;p&gt;Remote across the EU&lt;/p&gt;</content:encoded>
    <category><![CDATA[Development]]></category>
    <category>Go</category>
    <job_listing:location><![CDATA[Europe]]></job_listing:location>
    <job_listing:job_type>Full Time</job_listing:job_type>
    <job_listing:company>Nordlys &#x26; Co</job_listing:company>
    <enclosure url="https://x.test/logo.png" type="image/png" />
  </item>
  <item><title>Second</title><link>https://euremotejobs.com/job/second/</link></item>
</channel>
</rss>`;

test("RSS: fields, CDATA, entities and namespaced tags", () => {
  const feed = parseFeed(RSS);
  assert.equal(feed.kind, "rss");
  assert.equal(feed.title, "EU Remote Jobs – Jobs");
  assert.equal(feed.items.length, 2);
  const [a, b] = feed.items;
  assert.equal(a.title, "Senior Backend Developer & Team Lead");
  assert.equal(a.link, "https://euremotejobs.com/job/senior-backend/");
  assert.equal(a.guid, "https://euremotejobs.com/?post_type=job_listing&p=123");
  assert.equal(feedDate(a.date), "2026-10-21T10:00:00.000Z");
  assert.equal(a.author, "Nordlys");
  assert.equal(a.description, "<p>Build APIs in <b>Go</b>. Text with </description> inside CDATA.</p>");
  assert.equal(a.content, "<p>Remote across the EU</p>");
  assert.deepEqual(a.categories, ["Development", "Go"]);
  assert.equal(a.fields["job_listing:location"], "Europe");
  assert.equal(a.fields["job_listing:job_type"], "Full Time");
  assert.equal(a.fields["job_listing:company"], "Nordlys & Co");
  assert.deepEqual(a.attrs.enclosure, { url: "https://x.test/logo.png", type: "image/png" });
  assert.deepEqual(a.values.category, ["Development", "Go"]);
  assert.equal(b.title, "Second");
  assert.equal(b.description, "");
});

test("Atom: alternate links, ids, dates, nested author", () => {
  const feed = parseFeed(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Jobs</title>
<entry>
  <id>urn:job:1</id>
  <title type="html">Go &lt;Engineer&gt;</title>
  <link rel="self" href="https://x.test/self/1"/>
  <link rel="alternate" type="text/html" href="https://x.test/jobs/1?a=1&amp;b=2"/>
  <updated>2026-10-21T08:00:00Z</updated>
  <author><name>Acme</name></author>
  <summary>Remote (EU)</summary>
  <category term="backend"/>
</entry>
</feed>`);
  assert.equal(feed.kind, "atom");
  const [e] = feed.items;
  assert.equal(e.title, "Go <Engineer>");
  assert.equal(e.link, "https://x.test/jobs/1?a=1&b=2");
  assert.equal(e.guid, "urn:job:1");
  assert.equal(e.date, "2026-10-21T08:00:00Z");
  assert.equal(e.author, "Acme");
  assert.equal(e.description, "Remote (EU)");
  assert.deepEqual(e.categories, ["backend"]);
});

test("not a feed: an HTML page or an error gives kind '' and no items", () => {
  assert.deepEqual(parseFeed("<!doctype html><html><head><title>Just a moment...</title></head></html>"), { kind: "", title: "", items: [] });
  assert.deepEqual(parseFeed(""), { kind: "", title: "", items: [] });
  // A truncated feed keeps the items that closed
  const cut = parseFeed("<rss><channel><item><title>A</title></item><item><title>B</ti");
  assert.equal(cut.items[0].title, "A");
});

test("entities: XML, HTML names, numeric; unknown names stay", () => {
  assert.equal(decodeEntities("a &amp; b &lt;p&gt; &#233;t&#xE9; &rsquo;s &nbsp;x &bogus;"), "a & b <p> été ’s  x &bogus;");
  assert.equal(decodeEntities("&#0; &#x110000;"), "&#0; &#x110000;");
});

test("broken markup stays linear", () => {
  for (const xml of [
    `<rss><channel><item><title>${"<".repeat(200000)}</title></item></channel></rss>`,
    `<rss><channel><item>${"<title".repeat(50000)}</item></channel></rss>`,
    `<rss><channel><item><a b="${"x".repeat(100)}${"<a c='".repeat(30000)}</item></channel></rss>`,
    `<rss>${"<item>".repeat(30000)}`,
  ]) {
    const t0 = performance.now();
    parseFeed(xml);
    assert.ok(performance.now() - t0 < 200, `${(performance.now() - t0).toFixed(0)} ms`);
  }
});

test("a 2 MB feed parses in under 100 ms", () => {
  const item = (n) =>
    `<item><title>Developer ${n} &amp; more</title><link>https://x.test/jobs/${n}</link><guid>g${n}</guid>` +
    `<pubDate>Wed, 21 Oct 2026 10:00:00 +0000</pubDate><description><![CDATA[<p>${"Remote across Europe. ".repeat(60)}</p>]]></description>` +
    `<category>Dev</category><job_listing:location>Europe</job_listing:location></item>`;
  let body = "";
  for (let n = 0; body.length < 2 * 1024 * 1024; n++) body += item(n);
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Big</title>${body}</channel></rss>`;
  parseFeed(xml);
  const t0 = performance.now();
  const feed = parseFeed(xml);
  const ms = performance.now() - t0;
  assert.ok(feed.items.length > 1000);
  assert.equal(feed.items.at(-1).fields["job_listing:location"], "Europe");
  assert.ok(ms < 100, `${ms.toFixed(1)} ms`);
});
