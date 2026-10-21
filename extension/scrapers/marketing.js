/**
 * "Is this job title a marketing role?" in EU languages, for runs with no
 * Title. Plain script (no import/export) so it can be injected via
 * chrome.scripting.executeScript({ files }) after title-match.js, whose
 * normalizer it uses: lowercase, no accents (Greek final ς as σ), punctuation
 * as spaces, "Search Engine Optimisation" = "seo", "Public Relations" = "pr".
 *
 * A title is a marketing role when it has a marketing word and nothing that
 * makes it another kind of job:
 *   1. never: telemarketing and call centres, MLM, promoters, sales jobs,
 *      teaching, recruiting, design, AI-training and survey gigs, look-alike
 *      "communication" (telecom, customer service, energy market) and more;
 *   2. never: engineering and developer jobs, judged on the role before any
 *      " - ", "|", "(" or "," ("Marketing Data Engineer" no; "Product Marketing
 *      Manager, Developer Tools" yes);
 *   3. strong words always count (marketing, SEO, PR, copywriter, social media…);
 *   4. ambiguous words count unless the title says what else they are
 *      ("Content Manager" yes, "Content Moderator" no).
 * Checked against real Indeed titles from DE, FR, NL, PL, IT, ES and GB.
 */
(function () {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Inside a word, so German and Nordic compounds count
  const inside = (list) => new RegExp(`(?:${list.map(esc).join("|")})`, "u");
  // At the start of a word
  const starts = (list) => new RegExp(`(?:^| )(?:${list.map(esc).join("|")})`, "u");
  // Whole words or phrases
  const words = (list) => new RegExp(`(?:^| )(?:${list.map(esc).join("|")})(?= |$)`, "u");
  // Hand-written patterns over the normalized title (words separated by one space)
  const pattern = (source) => new RegExp(source, "u");
  const any = (...res) => ({ test: (s) => res.some((re) => re.test(s)) });
  const never = { test: () => false };

  const EXCLUDE = any(
    // Telemarketing, call centres, phone sales
    inside([
      "telemarket",
      "tele marketing",
      "marketing telef",
      "teleoperad",
      "televent",
      "telesales",
      "teleselling",
      "kaltakquise",
      "telefonmarketing",
      "τηλεφωνικ",
    ]),
    words(["call center", "call centre", "cold call", "cold caller", "cold calling", "llamadas en frio", "appointment setter", "closer"]),
    // "Kundenberater Dialogmarketing", "Kauffrau für Dialogmarketing (Inbound)": call-centre trades
    pattern(
      "(?:kundenberater|kundenbetreuer|agent|servicefachkraft|kaufmann|kauffrau|mitarbeiter)\\p{L}*(?: \\p{L}+){0,3} (?:im |fur )?dialogmarketing|dialogmarketing(?: \\p{L}+){0,2} (?:inbound|outbound)"
    ),
    // MLM and direct selling, promoters, door to door
    words([
      "network marketing",
      "multi level marketing",
      "mlm",
      "direct selling",
      "door to door",
      "haustur",
      "brand partner",
      "brand partners",
      "promoter",
      "promotor",
      "promotora",
      "promotorin",
      "hostess",
    ]),
    inside(["netzwerkmarketing", "netwerkmarketing", "empfehlungsmarketing", "strukturvertrieb"]),
    pattern("(?:^| )(?:brand )?ambassadors?(?! program)(?= |$)|markenbotschaft"),
    // Sales jobs, even about marketing ("Account Executive – Marketing SaaS")
    words([
      "sdr",
      "bdr",
      "sales development",
      "account executive",
      "key account",
      "inside sales",
      "business developer",
      "commercial terrain",
      "marketing representative",
      "marketing rep",
      "marketing agent",
      "field marketing representative",
    ]),
    pattern(
      "(?:^| )business development rep\\p{L}*|(?:^| )vertriebsmitarbeit\\p{L}*|(?:^| )comercial (?:b2b|venta|ventas|full cycle|autonomo|itinerante|junior|senior)|(?:^| )commerciale? (?:b2b|terrain|sedentaire|itinerant|junior|senior)"
    ),
    // "Sales & Marketing Representative" is a sales job; "Sales & Marketing Manager" stays
    {
      test: (s) =>
        /(?:^| )(?:sales|vertrieb|verkauf|ventas|vendite|vente|verkoop)(?= |$)/.test(s) &&
        /(?:^| )(?:representative|rep|associate|agent|advisor|adviser|consultant|aussendienst\p{L}*|vertriebsmitarbeiter\p{L}*|verkaufer\p{L}*|vendeur\p{L}*|vendedor\p{L}*|venditore\p{L}*)(?= |$)/u.test(
          s
        ),
    },
    // AI-training, rating, moderation and survey gigs
    pattern(
      "(?:^| )ai (?:trainer|tutor|training|data trainer|rater|evaluator)|model training|llm (?:training|evaluation)|(?:^| )rlhf(?= |$)|annotat|evaluator|(?:^| )rater(?= |$)|moderat(?:or|ion|eur|ore|orin)|survey (?:taker|participant)|focus group|mystery shop|befragung|interviewer|enqueteur|encuestador|intervistat|ankieter"
    ),
    // Teaching, training, coaching, research staff, recruiting
    pattern(
      "(?:^| )(?:dozent\\p{L}*|tutor\\p{L}*|lehrbeauftragt\\p{L}*|kursleit\\p{L}*|ausbilder\\p{L}*|lernbegleit\\p{L}*|lecturer|teacher|teaching|lehrer\\p{L}*|lehrkraft|professor\\p{L}*|trainer\\p{L}*|coach|coaches|formateur\\p{L}*|formador\\p{L}*|docente|insegnante|enseignant\\p{L}*|nauczyciel\\p{L}*|wykladowc\\p{L}*|kouluttaj\\p{L}*|underviser|forelasare|utbildare|mentor)(?= |$)|wissenschaftl|recruit(?!ment marketing|ing marketing)|recrut|reclutador|rekruter|headhunt|talent acquisition|personalberat"
    ),
    // Designers (unless the title is about marketing), photographers, video editors, models
    {
      test: (s) =>
        /designer|gestalter|grafiker|projektant/.test(s) && !/marketing/.test(s),
    },
    pattern("fotograf|photograph|videograf|video editor|(?:^| )model(?!l)(?= |$)(?<!mix model)"),
    // Look-alike "communication": customer service, energy market data, sign language
    pattern(
      "marktkommunikation|(?:^| )mako(?= |$)|kunden ?kommunikation|klant ?communicatie|komunikac\\p{L}* z klient|communication client|customer communications?|unterstutzte kommunikation|gebardensprach|sign language|langue des signes"
    ),
    // Advertising false friends: leaflet delivery, ad-space sales, complaints, product listing
    pattern(
      "zusteller|austrag|prospektvert|flyerverteil|διανομε|teknisk kommunikat|technical (?:writer|communicator)|technische[rn]? redakteur|anzeigenverkauf|mediaberater|media sales|advertising sales|ad sales|mediaadviseur buitendienst|werbeberater|referencement (?:des )?(?:fournisseur|produit|article|client)"
    ),
    // Nightlife PR, logistics traffic managers, apartment community managers
    pattern(
      "(?:^| )pr (?:discotec|eventi|serate|locali)|(?:relaciones publicas|rrpp)(?: \\p{L}+){0,2} (?:discotec|ocio nocturno|club)|traffic manag\\p{L}*(?: \\p{L}+){0,3} (?:logistic|transport|freight|fleet|road|rail)|transport (?:and |und )?traffic|community manag\\p{L}*(?: \\p{L}+){0,4} (?:apartment|property|residential|leasing|housing)"
    )
  );

  // Engineering heads, judged on the role part of the title only
  const TECH = any(
    inside([
      "engineer",
      "ingenieur",
      "ingeniero",
      "ingegnere",
      "inzynier",
      "ingenjor",
      "insinoori",
      "inzenyr",
      "inginer",
      "developer",
      "entwickler",
      "desarrollador",
      "sviluppat",
      "programista",
      "utvecklare",
      "udvikler",
      "programmer",
      "programmierer",
      "techniker",
      "technician",
      "elektroniker",
      "μηχανικ",
    ]),
    words(["devops", "data scientist", "machine learning", "sysadmin"])
  );
  // Marketing jobs named after developers or engineers
  const TECH_MARKETING = pattern(
    "developer (?:marketing|relations|content|community|advocate)|devrel|(?:product|technical) marketing engineer"
  );

  const STRONG = any(
    inside([
      "marketing",
      "marketer",
      "marketeer",
      "marketeur",
      "marketeuse",
      "martech",
      "marknadsfor",
      "markedsfor",
      "markkinoin",
      "markkinoij",
      "μαρκετινγκ",
      "mercadotecnia",
      "mercadeo",
      "offentlichkeitsarbeit",
      "pressesprecher",
      "pressereferent",
      "pressestelle",
      "pressearbeit",
      "werbekauf",
      "werbetext",
      "texter",
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
      "suchmaschinen",
      "webredakt",
      "webbredakt",
      "woordvoerder",
      "persvoorlicht",
      "sisallontuott",
      "κειμενογραφ",
      "διαφημ",
    ]),
    // Swedish marknadschef, Norwegian/Danish markedssjef, German Werbung, campaigns
    starts(["marknads", "markeds", "werbung", "campaign", "campagn", "programmatic", "trafficker", "kommunikator"]),
    words([
      "seo",
      "ppc",
      "abm",
      "pr",
      "cmo",
      "ugc",
      "paid social",
      "paid search",
      "paid media",
      "paid ads",
      "social media",
      "social ads",
      "community manager",
      "community management",
      "community lead",
      "community specialist",
      "head of community",
      "media buyer",
      "media buying",
      "media planner",
      "brand manager",
      "brand marketing",
      "brand strategist",
      "brand strategy",
      "brand lead",
      "head of brand",
      "brand partnerships",
      "chef de marque",
      "cheffe de marque",
      "chef de groupe marque",
      "creator partnerships",
      "creator partnership",
      "creative strategist",
      "creative strategy",
      "ambassador program",
      "demand generation",
      "demand gen",
      "growth hacker",
      "head of growth",
      "head of content",
      "head of crm",
      "head of social",
      "head of lifecycle",
      "affiliate",
      "affiliation",
      "advertising",
      "ad ops",
      "ad operations",
      "retail media",
      "newsletter",
      "emailing",
      "email specialist",
      "email campaigns",
      "conversion optimisation",
      "conversion optimization",
      "conversion rate optimisation",
      "conversion rate optimization",
      "web analytics",
      "web analyst",
      "digital analyst",
      "digital analytics",
      "market research",
      "market researcher",
      "marktforscher",
      "etudes de marche",
      "investigacion de mercados",
      "marktonderzoek",
      "traffic manager",
      "publicite",
      "publicidad",
      "pubblicita",
      "publicidade",
      "reclame",
      "reklama",
      "reklamy",
      "digital adv",
      "social adv",
      "relations publiques",
      "relations presse",
      "relations medias",
      "relaciones publicas",
      "pubbliche relazioni",
      "relazioni pubbliche",
      "ufficio stampa",
      "addetto stampa",
      "addetta stampa",
      "portavoce",
      "portavoz",
      "rzecznik prasowy",
      "rzeczniczka prasowa",
      "assessor de imprensa",
      "assessora de imprensa",
      "relacoes publicas",
      "press officer",
      "press office",
      "press relations",
      "press secretary",
      "media relations",
      "spokesperson",
      "spokesman",
      "spokeswoman",
      "publicist",
      "presschef",
      "pressansvarig",
      "talesperson",
      "tiedottaja",
      "redes sociales",
      "redes sociais",
      "reseaux sociaux",
      "medias sociaux",
      "sociale media",
      "media spolecznosciowe",
      "mediow spolecznosciowych",
      "mediach spolecznosciowych",
      "κοινωνικησ δικτυωσησ",
      "online redakteur",
      "web redakteur",
      "content redakteur",
      "seo redakteur",
      "social media redakteur",
      "generative engine optimisation",
      "generative engine optimization",
      "answer engine optimisation",
      "answer engine optimization",
      "aeo",
      "llmo",
    ]),
    // "Chargé(e) de RP", "Consultant SEA", "SEA & Tracking Manager", "Meta Ads specialist",
    // "CRO Specialist", "UA Manager", "GEO-Texter", "Promotions Coordinator", "δημοσίων σχέσεων"
    // French "(e)" splits off as its own word: "attache e de presse"
    pattern(
      "(?:^| )attachee?(?: e)? de presse|(?:^| )(?:charge|chargee|attache|attachee|responsable|consultant|consultante|chef de projet)(?: e)?(?: de| des)? rp(?= |$)|(?:^| )(?:google|meta|facebook|instagram|tiktok|linkedin|amazon|bing|microsoft|reddit|pinterest|snapchat|youtube|apple search|display|programmatic) ads(?= |$)|(?:^| )ads (?:manager|specialist|strategist|buyer|lead|operations)|(?:^| )(?:cro|ua) (?:specialist|manager|lead|analyst|strateg\\p{L}*)|(?:^| )(?:geo|ai search) (?:specialist|manager|lead|texter|expert|strateg\\p{L}*|optimi\\p{L}*)|(?:^| )promotions? (?:manager|coordinator|specialist|executive|director)|δημοσι\\p{L}* σχεσε|(?:^| )adv (?:specialist|manager|executive|campaign)"
    )
  );

  // [marketing word, words that make it another job]
  const AMBIGUOUS = [
    [
      words(["content"]),
      inside(["moderat", "review", "annotat", "rater", "labell", "safety", "policy", "legal", "medical", "juridi", "licens", "locali"]),
    ],
    [
      words(["growth"]),
      any(
        inside(["equity", "invest", "fund", "capital", "venture", "portfolio", "product"]),
        words(["account growth", "business growth", "revenue growth", "sales growth", "client growth"])
      ),
    ],
    [
      words(["crm"]),
      inside(["administrator", "admin", "architect", "consultant", "berater", "support", "implement", "integration", "technisch", "technical", "cloud", "api", "sales", "vertrieb"]),
    ],
    [words(["lifecycle"]), inside(["product lifecycle", "plm", "asset", "software", "application", "clinical", "contract"])],
    [words(["brand"]), inside(["ambassador", "botschafter", "promoter", "protection", "schutz", "store", "filial"])],
    [words(["gtm"]), never],
    [words(["sem"]), inside(["operator", "lab", "microscop", "technician"])],
    [
      words(["sea"]),
      inside(["freight", "logistic", "shipping", "export", "import", "cargo", "ocean", "maritime", "vessel", "fracht", "spedition", "offshore"]),
    ],
    [
      words(["acquisition"]),
      any(
        inside(["talent", "recruit", "recrut", "personal", "real estate", "immobil", "property", "data", "merger", "licens", "sales", "fonciere"]),
        words(["m a", "land", "site"])
      ),
    ],
    [
      any(
        inside(["kommunikation", "kommunikasjon", "komunikac", "kommunikacio", "viestint", "communicatie", "επικοινωνι"]),
        starts(["communication", "comunicacion", "comunicazione", "comunicacao", "comunicare"])
      ),
      any(
        inside([
          "network",
          "netzwerk",
          "telecom",
          "telekom",
          "τηλεπικοινων",
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
          "infra",
          "wissenschaft",
          "operador",
          "operator",
          "kierowca",
          "miejsk",
          "publiczn",
          "pozemn",
          "software",
          "support",
          "analyst",
        ]),
        words(["it", "ict", "systems", "system", "5g", "rf", "military", "driver"])
      ),
    ],
  ];

  /** The role before " - ", " | ", "(" or ",", normalized. */
  function rolePart(title) {
    const head = String(title || "").split(/\s[-–—|]\s|[(,|]/)[0];
    return globalThis.jbNormalizeWords(head).join(" ");
  }

  function jbIsMarketingTitle(title) {
    const s = globalThis.jbNormalizeWords(title).join(" ");
    if (!s || EXCLUDE.test(s)) return false;
    const role = rolePart(title);
    if (TECH.test(role) && !TECH_MARKETING.test(role)) return false;
    if (STRONG.test(s)) return true;
    return AMBIGUOUS.some(([term, other]) => term.test(s) && !other.test(s));
  }

  globalThis.jbIsMarketingTitle = jbIsMarketingTitle;
})();
