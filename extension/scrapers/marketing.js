/**
 * "Is this job title a marketing role?" in EU languages, for runs with no
 * Title. Plain script (no import/export) so it can be injected via
 * chrome.scripting.executeScript({ files }) after title-match.js, whose
 * normalizer it uses: lowercase, no accents, punctuation as spaces,
 * "Search Engine Optimisation" = "seo", "Public Relations" = "pr".
 *
 * A title is a marketing role when it has a marketing word and nothing that
 * makes it another kind of job:
 *   1. never: telemarketing, network marketing / MLM, door to door, sales reps;
 *   2. never: engineering and developer jobs, even about marketing;
 *   3. strong words always count (marketing, SEO, PR, copywriter, social media…);
 *   4. ambiguous words count unless the title says what else they are
 *      ("Content Manager" yes, "Content Moderator" no).
 */
(function () {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Inside a word, so German and Nordic compounds count
  const inside = (list) => new RegExp(`(?:${list.map(esc).join("|")})`);
  // At the start of a word
  const starts = (list) => new RegExp(`(?:^| )(?:${list.map(esc).join("|")})`);
  // Whole words or phrases
  const words = (list) => new RegExp(`(?:^| )(?:${list.map(esc).join("|")})(?= |$)`);
  const any = (...res) => ({ test: (s) => res.some((re) => re.test(s)) });

  const EXCLUDE = any(
    words([
      "telemarketing",
      "telemarketer",
      "tele marketing",
      "network marketing",
      "multi level marketing",
      "mlm",
      "direct selling",
      "door to door",
      "haustur",
    ]),
    inside(["telemarket"]),
    // "Sales & Marketing Representative" is a sales job; "Sales & Marketing Manager" stays
    {
      test: (s) =>
        /(?:^| )(?:sales|vertrieb|verkauf|ventas|vendite|vente|verkoop)(?= |$)/.test(s) &&
        /(?:^| )(?:representative|rep|associate|agent|advisor|adviser|ambassador|closer|setter|aussendienst\w*|vertriebsmitarbeiter\w*|verkaufer\w*|vendeur\w*|vendedor\w*|venditore\w*)(?= |$)/.test(
          s
        ),
    }
  );

  const TECH = any(
    inside([
      "engineer",
      "ingenieur",
      "developer",
      "entwickler",
      "programmer",
      "programmierer",
      "techniker",
      "technician",
      "elektroniker",
    ]),
    words(["devops", "data scientist", "machine learning", "sysadmin"])
  );

  const STRONG = any(
    inside([
      "marketing",
      "marketer",
      "marketeer",
      "marknadsfor",
      "markedsfor",
      "markkinoin",
      "μαρκετινγκ",
      "mercadotecnia",
      "mercadeo",
      "offentlichkeitsarbeit",
      "pressesprecher",
      "pressereferent",
      "werbekauf",
      "socialmedia",
      "copywrit",
      "influencer",
      "kampagnen",
      "contentmanag",
      "markenmanag",
      "markenfuhrung",
      "markenstrateg",
      "mediaplan",
      "referencement",
    ]),
    // Swedish marknadschef, Norwegian/Danish markedssjef, German Werbung
    starts(["marknads", "markeds", "werbung", "campaign"]),
    words([
      "seo",
      "sem",
      "ppc",
      "abm",
      "pr",
      "paid social",
      "paid search",
      "paid media",
      "social media",
      "social ads",
      "community manager",
      "community management",
      "media buyer",
      "media buying",
      "media planner",
      "brand manager",
      "brand marketing",
      "brand strategist",
      "brand strategy",
      "brand lead",
      "head of brand",
      "content manager",
      "content strategist",
      "content strategy",
      "content creator",
      "content writer",
      "content specialist",
      "content lead",
      "head of content",
      "demand generation",
      "demand gen",
      "user acquisition",
      "customer acquisition",
      "traffic manager",
      "growth hacker",
      "growth manager",
      "growth lead",
      "head of growth",
      "affiliate",
      "advertising",
      "publicite",
      "publicidad",
      "pubblicita",
      "publicidade",
      "reclame",
      "reklama",
      "reklamy",
      "relations publiques",
      "relaciones publicas",
      "pubbliche relazioni",
      "redes sociales",
      "reseaux sociaux",
    ])
  );

  // [marketing word, words that make it another job]
  const AMBIGUOUS = [
    [words(["content"]), inside(["moderat", "review", "annotat", "rater", "labell", "safety", "policy"])],
    [words(["growth"]), inside(["equity", "invest", "fund", "capital", "venture", "portfolio"])],
    [words(["crm"]), inside(["administrator", "admin", "architect", "consultant", "berater", "support", "implement"])],
    [words(["lifecycle"]), inside(["product lifecycle", "plm", "asset", "software", "application", "clinical", "contract"])],
    [words(["brand"]), inside(["ambassador", "botschafter", "promoter", "protection", "schutz", "store", "filial"])],
    [words(["gtm"]), { test: () => false }],
    [
      words(["sea"]),
      inside(["freight", "logistic", "shipping", "export", "import", "cargo", "ocean", "maritime", "vessel", "fracht", "spedition", "offshore"]),
    ],
    [
      words(["acquisition"]),
      inside(["talent", "recruit", "recrut", "personal", "real estate", "immobil", "property", "data", "merger"]),
    ],
    [
      any(
        inside(["kommunikation", "kommunikasjon", "komunikac", "kommunikacio", "viestint"]),
        starts(["communication", "comunicacion", "comunicazione", "comunicacao", "communicatie"])
      ),
      any(
        inside([
          "network",
          "netzwerk",
          "telecom",
          "telekom",
          "unified",
          "radio",
          "satellite",
          "signal",
          "nachrichtentechn",
          "informationstechn",
          "kommunikationstechn",
          "elektro",
          "avionic",
          "firmware",
          "optical",
          "wireless",
        ]),
        words(["it", "ict", "systems", "system", "5g", "rf", "military"])
      ),
    ],
  ];

  function jbIsMarketingTitle(title) {
    const s = globalThis.jbNormalizeWords(title).join(" ");
    if (!s || EXCLUDE.test(s) || TECH.test(s)) return false;
    if (STRONG.test(s)) return true;
    return AMBIGUOUS.some(([term, other]) => term.test(s) && !other.test(s));
  }

  globalThis.jbIsMarketingTitle = jbIsMarketingTitle;
})();
