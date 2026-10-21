/**
 * Does a remote job at an employer abroad (UK, Canada, US) hire people living
 * in Europe? Plain script (no import/export) so it can be injected via
 * chrome.scripting.executeScript({ files }) after title-match.js.
 *
 * The title, location and description are read one at a time (a phrase never
 * runs from one field into the next), folded (lowercase, no accents, "U.S." =
 * usa, "CET" = central european time) and without the company's own name
 * ("Zap Solutions Europe"). Each place a posting names (Europe, EMEA, a
 * country, a list of them) is read with the words around it:
 *   - strong open: "Remote (Europe)", "EU/UK Based", "candidates based in the
 *     UK, Germany or Spain", "must reside in Ireland or the UK", "we can't
 *     hire outside the EU", a region in the title or location field,
 *     "anywhere in the world", an employer of record or "candidates outside
 *     the US";
 *   - loose open: a region after work / people / engineers / developers
 *     ("you'll collaborate with engineers in Europe"), often a company blurb;
 *     with the employer as the subject it is no signal ("our team members
 *     work across Europe", "our servers are located in the EU");
 *   - weak open: European time zones ("CET", "UTC-3 to UTC+3", "GMT +/- 3
 *     hours"); "work from anywhere" or "staff in 40+ countries" alone;
 *   - strong closed: "US only", "must live in Canada", "Remote (US)" (unless
 *     joined to "or Remote (Europe)"), "anywhere in the United States",
 *     "Canada-wide", "not open to other countries", "we don't hire outside
 *     the US", "not open to candidates in the EU", "This role will be remote
 *     and based in the United States";
 *   - weak closed: "authorized to work in the US", W2 / 1099 / C2C, US or UK
 *     hours (written for the home half of a mixed hire);
 *   - citizenship, green card, security clearance or ITAR close the job
 *     whatever else it says (not "green card sponsorship" or "public trust
 *     in elections").
 * A third person, a thing or a blurb as the subject is no signal ("our VP,
 * who is based in Germany", "trips outside the US", "a team of 120 people
 * across…", "best places to work in Europe").
 * Strong open beats weak closed; against strong closed it is open only from
 * the title or location field. Loose open and time zones are open unless a
 * closed signal is there too. "Anywhere" alone, and no signal, are closed:
 * most remote jobs there are local.
 *
 * A country list opens the job only for the ticked countries it names, a
 * time-zone window only for the ticked countries inside it ("UTC+1 to UTC-8"
 * leaves out Finland, Greece and Romania), and "must reside in…" narrows the
 * rest ("Sales Engineer (EMEA)" that must live in Ireland or the UK).
 */
(function () {
  const fold = (text) =>
    globalThis.jbFold ? globalThis.jbFold(text) : String(text || "").toLowerCase();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Not a letter or digit on that side (\b only knows ASCII)
  const NB = "(?<![\\p{L}\\p{N}])";
  const NA = "(?![\\p{L}\\p{N}])";
  const pattern = (source, flags = "") => new RegExp(source, `u${flags}`);
  const words = (alts, flags) => pattern(`${NB}(?:${alts})${NA}`, flags);

  // Countries a job may be open to: code, English name, standard UTC offset
  // (for time-zone windows), and the names postings write (countries.js's,
  // plus "Holland", "Republic of Ireland", "ROI" as in "UK & ROI"…)
  const COUNTRIES = [
    ["AT", "Austria", 1, ["Österreich"]],
    ["BE", "Belgium", 1, ["België", "Belgique", "Belgien"]],
    ["BG", "Bulgaria", 2, ["България"]],
    ["HR", "Croatia", 1, ["Hrvatska"]],
    ["CY", "Cyprus", 2, ["Κύπρος"]],
    ["CZ", "Czechia", 1, ["Czech Republic", "Česko", "Česká republika"]],
    ["DK", "Denmark", 1, ["Danmark"]],
    ["EE", "Estonia", 2, ["Eesti"]],
    ["FI", "Finland", 2, ["Suomi"]],
    ["FR", "France", 1, []],
    ["DE", "Germany", 1, ["Deutschland"]],
    ["GR", "Greece", 2, ["Ελλάδα", "Hellas"]],
    ["HU", "Hungary", 1, ["Magyarország"]],
    ["IE", "Ireland", 0, ["Éire", "Republic of Ireland", "ROI"]],
    ["IT", "Italy", 1, ["Italia"]],
    ["LV", "Latvia", 2, ["Latvija"]],
    ["LT", "Lithuania", 2, ["Lietuva"]],
    ["LU", "Luxembourg", 1, ["Lëtzebuerg", "Luxemburg"]],
    ["MT", "Malta", 1, []],
    ["NL", "Netherlands", 1, ["Nederland", "The Netherlands", "Holland"]],
    ["PL", "Poland", 1, ["Polska"]],
    ["PT", "Portugal", 0, []],
    ["RO", "Romania", 2, ["România"]],
    ["SK", "Slovakia", 1, ["Slovensko"]],
    ["SI", "Slovenia", 1, ["Slovenija"]],
    ["ES", "Spain", 1, ["España"]],
    ["SE", "Sweden", 1, ["Sverige"]],
    ["NO", "Norway", 1, ["Norge"]],
    ["CH", "Switzerland", 1, ["Schweiz", "Suisse", "Svizzera"]],
  ];
  // Regions that hold every country above
  const REGIONS = [
    // "european" only before a person ("European candidates"), not "European markets"
    ["Europe", ["europe", "european countries", "european country", "european"]],
    ["EU", ["eu", "european union", "eu member states", "eu member state", "member states", "member state"]],
    ["EEA", ["eea", "european economic area"]],
    ["EMEA", ["emea"]],
  ];
  // Parts of Europe: the job is open to their countries only
  const PARTS = [
    ["DACH", "DE AT CH", ["dach"]],
    ["Nordics", "DK FI SE NO", ["nordics", "nordic countries", "nordic region"]],
    ["Scandinavia", "DK SE NO", ["scandinavia"]],
    ["Benelux", "BE NL LU", ["benelux"]],
    ["Baltics", "EE LV LT", ["baltics", "baltic states", "baltic countries"]],
    ["Iberia", "ES PT", ["iberia", "iberian peninsula"]],
    [
      "CEE",
      "PL CZ SK HU RO BG HR SI EE LV LT",
      ["cee", "central and eastern europe", "central & eastern europe", "eastern europe"],
    ],
    ["Central Europe", "AT CZ DE HU PL SK SI CH", ["central europe"]],
    ["Western Europe", "AT BE FR DE IE IT LU NL PT ES CH", ["western europe"]],
    ["Southern Europe", "ES PT IT GR MT CY HR SI", ["southern europe"]],
    ["Northern Europe", "DK FI SE NO IE EE LV LT", ["northern europe"]],
  ];
  const WORLD = ["worldwide", "world wide", "world", "globe", "global", "globally", "any country", "any location"];
  // The employer's own countries ("us" is the pronoun: prep() turns the
  // country into "usa")
  const HOME = [
    "usa",
    "united states",
    "united states of america",
    "america",
    "north america",
    "na",
    "continental usa",
    "continental united states",
    "contiguous usa",
    "contiguous united states",
    "lower 48",
    "canada",
    "uk",
    "united kingdom",
    "great britain",
    "britain",
    "england",
    "scotland",
    "wales",
    "northern ireland",
  ];
  // Naming a US state or Canadian province limits the job to it
  const STATES = [
    "states", "provinces", "territories", "usa states", "canadian provinces", "dc", "district of columbia",
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
    "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
    "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska",
    "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
    "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
    "ontario", "quebec", "british columbia", "alberta", "manitoba", "saskatchewan", "nova scotia",
    "new brunswick", "newfoundland", "newfoundland and labrador", "prince edward island", "yukon", "nunavut",
    "northwest territories",
  ];
  // Elsewhere: they keep a list going ("US, Canada, UK, Ireland, Australia")
  const OTHER = [
    "australia", "new zealand", "nz", "india", "indonesia", "thailand", "israel", "malaysia", "philippines",
    "singapore", "japan", "china", "hong kong", "taiwan", "south korea", "korea", "vietnam", "pakistan",
    "bangladesh", "sri lanka", "nepal", "mexico", "brazil", "argentina", "colombia", "chile", "peru", "uruguay",
    "costa rica", "south africa", "nigeria", "kenya", "egypt", "morocco", "ghana", "turkey", "turkiye", "ukraine",
    "serbia", "armenia", "moldova", "belarus", "russia", "albania", "north macedonia", "macedonia", "montenegro",
    "bosnia", "bosnia and herzegovina", "kosovo", "iceland", "liechtenstein", "uae", "united arab emirates",
    "saudi arabia", "qatar", "latam", "latin america", "south america", "central america", "americas", "amer",
    "apac", "asia", "asia pacific", "africa", "middle east", "mena", "oceania", "anz", "australasia", "weu",
  ];

  // Built on first use: the names are folded like the text (title-match.js
  // may load after this file)
  let vocab = null;
  function places() {
    if (vocab) return vocab;
    const byName = new Map();
    const add = (names, place) => names.forEach((n) => byName.set(prep(n), place));
    for (const [code, name, utc, local] of COUNTRIES) add([name, ...local], { kind: "country", code, name, utc });
    for (const [label, names] of REGIONS) add(names, { kind: "region", label });
    for (const [label, codes, names] of PARTS) add(names, { kind: "part", label, codes: codes.split(" ") });
    add(WORLD, { kind: "world", label: "Worldwide" });
    add(HOME, { kind: "home" });
    add(STATES, { kind: "state" });
    add(OTHER, { kind: "other" });
    const keys = [...byName.keys()].sort((a, b) => b.length - a.length).map(esc).join("|");
    vocab = {
      byName,
      // "Belfast, Northern Ireland" is not Ireland; "EU countries" is the EU
      re: pattern(`${NB}(?<!northern\\s)(${keys})(?:\\s+(?:countries|country|nations|region|area))?${NA}`, "g"),
      // After "…can't hire outside": a place, or one named before ("outside of these regions")
      outsideNext: pattern(`^\\s+(?:of\\s+)?(?:the\\s+)?(?:${keys}|these|those|this|that|such)${NA}`),
    };
    return vocab;
  }

  // Case tells these apart: "US" is the country and "us" the pronoun, "CET"
  // a time zone and "cet" French; they are written out before folding
  const CASED = {
    CET: "central european time",
    CEST: "central european summer time",
    EET: "eastern european time",
    EEST: "eastern european summer time",
    WET: "western european time",
    EST: "eastern standard time",
    EDT: "eastern daylight time",
    CST: "central standard time",
    CDT: "central daylight time",
    MST: "mountain standard time",
    MDT: "mountain daylight time",
    PST: "pacific standard time",
    PDT: "pacific daylight time",
    eDV: "enhanced developed vetting",
  };
  const CASED_RE = /(?<![\p{L}\p{N}])(?:U\.S\.A\.?|U\.S\.?|USA|US|CEST|CET|EEST|EET|WET|[ECMP][SD]T|eDV)(?![\p{L}\p{N}])/gu;

  /** Folded text: lowercase, no accents, straight quotes, "-" for dashes, one space. */
  function prep(text) {
    return fold(String(text || "").replace(CASED_RE, (w) => CASED[w] || "USA"))
      .replace(/[‘’‛`´]/g, "'")
      .replace(/[“”„]/g, '"')
      .replace(/[‐‑‒–—―−]/g, "-")
      .replace(/(?<![\p{L}\p{N}])u\.s\.(?:a\.?)?/gu, "usa")
      .replace(/(?<![\p{L}\p{N}])u\.k\.?/gu, "uk")
      .replace(/(?<![\p{L}\p{N}])e\.u\.?/gu, "eu")
      .replace(/(?<![\p{L}\p{N}])the us(?![\p{L}\p{N}])/gu, "the usa")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ---- Words around a place or a list of places ----

  // Who is hired, before "in / from / within / across <places>" (a person:
  // "as an employee in Germany"; "our employees in Europe" is a blurb).
  // "Anyone" only with where they live ("anyone who lives in the EU") or as
  // the subject ("Anyone in Europe can apply", not "care for everyone in the
  // world"); "applications" only when welcomed (not "deploying applications
  // across Europe")
  const HIRE =
    "candidates?|applicants?|hire|hires|hiring|employ|employs|recruit(?:s|ing)?|employee|contractors?|freelancers?|(?:anyone|everyone|someone|those)(?=\\s+(?:who|that|currently|based|located|living|residing))|(?<!\\p{L}\\s)(?:anyone|everyone)(?=\\s+(?:in|from|within|across))|(?:welcomes?|welcoming|accepts?|accepting|considers?|considering|invites?|encourages?)\\s+applications|(?:open|available)\\s+to(?:\\s+(?:those|anyone|everyone|people|residents|individuals))?";
  // Where they live, unless the employer, a thing or a third person is the
  // subject ("our team is based in Europe", "our servers are located in the
  // EU", "our VP, who is based in Germany", "banks and insurers based in the
  // UK"), or it's a blurb ("a team of 120 people across…", "we have engineers
  // across…", "experience working across…", "best places to work in…")
  const COMPANY =
    "teams?|employees|staff|colleagues|people|members|engineers|developers|offices?|headquarters|hq|we|we're|our|it|customers|clients|users|company|business|operations|partners|founders|investors|servers|data|infrastructure|entity|subsidiary|who|which|that|have|has|experience|\\d+\\+?|\\p{L}+(?:ers|ors|ies|ces|tres)";
  const NOT_COMPANY = `(?<!${NB}(?:${COMPANY})(?:\\s+(?:are|is|were|all|mostly|currently|who\\s+are|to))*\\s+)`;
  const LIVE = `${NOT_COMPANY}(?:based|located|living|residing|reside|resides|resident|residents|live|lives|domiciled)`;
  // "in the EU", "in an EU country", "in one of the EU countries"
  const DET = "(?:the|an?|any|(?:one|any)\\s+of\\s+(?:the|our))\\s+";
  const IN = `(?:in|from|within|across|throughout|all\\s+over)\\s+(?:${DET})?$`;
  // Up to 4 words between ("candidates currently based in", "based and eligible to work within"),
  // not a past, a market or praise ("candidates who have worked in Germany", "hire the best people in the world")
  const GAP_WORD =
    "(?!(?:worked|lived|studied|experience|experienced|expertise|sold|selling|serve|serving|expand|expanding|launch|launching|operate|operating|grow|growing|clients?|customers?|markets?|best|top|most|brightest|finest|greatest|smartest|strongest|leading)(?![\\p{L}\\p{N}]))[\\p{L}'-]+";
  // ...not a skill ("experience hiring engineers in the EU market")
  const SKILL = "(?<!(?:experience|experienced)\\s+(?:(?:in|with)\\s+)?)";
  const STRONG_BEFORE = pattern(`${NB}${SKILL}(?:${HIRE}|${LIVE})(?:\\s+${GAP_WORD}){0,4}?\\s+${IN}`);
  // "work from Europe", "engineers across Europe" (not "our team members work across Europe")
  const LOOSE_BEFORE = pattern(
    `${NB}${NOT_COMPANY}(?:work|works|working|people|engineers?|developers?)(?:\\s+${GAP_WORD}){0,2}?\\s+${IN}`
  );
  // "must be within EMEA", "must be in the US"
  const MUST_BE_BEFORE = pattern(
    `${NB}(?:must|need\\s+to|needs\\s+to|have\\s+to|has\\s+to|required\\s+to|should)\\s+be(?:\\s+(?:physically|currently|permanently))?\\s+(?:in|within)\\s+(?:${DET})?$`
  );
  const ANYWHERE_BEFORE = pattern(`${NB}anywhere\\s+${IN}`);
  // "Remote (Europe)", "remote - EMEA", "remote within the EU", "Remote, Continental United States"
  const TAG_BEFORE = pattern(
    `${NB}remote(?:ly)?(?:\\s*[(\\[,:/|-]\\s*(?:(?:in|within|across|from|for|throughout)\\s+)?|\\s+(?:in|within|across|from|for|throughout)\\s+)(?:the\\s+)?$`
  );
  // "Remote Europe" with no punctuation: a tag in the title or location field
  const BARE_TAG_BEFORE = pattern(`${NB}remote\\s+$`);
  // "registered: UK, Netherlands…", "live in one of our selected markets: Portugal…", "Location: Europe"
  const COLON_BEFORE = pattern(
    `${NB}(?:${HIRE}|${LIVE}|countries|locations?|regions)(?:\\s+[^\\s:.;!?]+){0,12}?\\s*:\\s*(?:[^\\s.;!?]+\\s+){0,3}?$`
  );
  // "residents of the EU", "nationals of an EU country"
  const OF_BEFORE = pattern(`${NB}(?:residents?|citizens?|nationals?)\\s+of\\s+(?:the\\s+|an?\\s+)?$`);
  const OPEN_TO_BEFORE = pattern(`${NB}(?:open|available|limited|restricted)\\s+(?:only\\s+)?to\\s+(?:the\\s+)?$`);
  // The hire outside a place ("candidates based outside the US", "we can't hire outside the US", "if
  // you're outside the US"), not things or a blurb ("trips outside the US", "customers outside the US",
  // "our app helps people outside the US")
  const OUTSIDE_BEFORE = pattern(
    `${NB}(?:${HIRE}|${LIVE}|you're|you\\s+are)(?:\\s+${GAP_WORD}){0,2}?\\s+outside\\s+(?:of\\s+)?(?:the\\s+)?$`
  );
  // "n't" has a letter before it
  const NOT = `(?:${NB}(?:not|unable|cannot|never|no)|n't)${NA}`;
  // "we don't currently hire outside the", "we are unable to employ people located outside the"
  const NOT_OUTSIDE_BEFORE = pattern(`${NOT}(?:\\s+${GAP_WORD}){0,6}?\\s+outside\\s+(?:of\\s+)?(?:the\\s+)?$`);
  // "candidates outside the US are not eligible"
  const NOT_AFTER = pattern(`^\\s*,?\\s*(?:(?:are|is|will|would|can|may|could)\\s+)?(?:not|cannot|never|ineligible|\\p{L}+n't)${NA}`);
  // "not open to candidates in the EU", "we don't hire in Europe", "not able to hire candidates located in"
  const NOT_HIRE_BEFORE = pattern(
    `${NOT}(?:\\s+(?:be|currently|yet|able|to)){0,3}\\s+(?:open|available|hire|hiring|employ|employing|consider|considering|accept|accepting|recruit|recruiting)(?:\\s+${GAP_WORD}){0,4}?\\s+${IN}`
  );
  const AUTH_BEFORE = pattern(
    `${NB}(?:authori[sz]ed|authori[sz]ation|eligible|eligibility|legally\\s+(?:able|permitted|allowed|entitled)|right|rights|permission|permitted|entitled|allowed)\\s+to\\s+(?:live\\s+and\\s+)?work\\s+(?:in|for|within|from)\\s+(?:the\\s+)?$`
  );
  // A requirement, not an offer: "must", "only", "This role will be…"
  const RESTRICT = pattern(
    `${NB}(?:(?<!(?:not|n't|never)\\s+)(?:must|need\\s+to|needs\\s+to|have\\s+to|has\\s+to|required\\s+to)|requires?|required|only|exclusively|solely|limited\\s+to|restricted\\s+to|(?:role|position|job|opportunity|vacancy)\\s+(?:is|will\\s+be))${NA}`
  );
  // "(Canada)", "- US" in the title: a location tag
  const SEGMENT_BEFORE = /[(\[|,:/-]\s*$/u;

  const REMOTE_AFTER = pattern(`^[\\s(\\[,:/|-]*remote${NA}`);
  const BASED_AFTER = pattern(`^[\\s-]*based${NA}`);
  // "a Europe-based team", "a UK-based fintech company": the employer, not the job
  const BASED_COMPANY_AFTER = pattern(
    `^[\\s-]*based(?:\\s+[\\p{L}-]+){0,2}?\\s+(?:teams?|company|companies|start-?ups?|scale-?ups?|business|firm|agency|organi[sz]ation|employer|studio|consultancy|offices?|headquarters|hq|group|brand|clients?|customers|provider|platform|bank|retailer|manufacturer)${NA}`
  );
  const ROLE_AFTER = pattern(`^[\\s-]*based\\s+(?:role|position|job|opportunity)${NA}`);
  const ONLY_AFTER = pattern(
    `^[\\s-]*(?:(?:based|resident|residents|citizens?|candidates|applicants|locations?|hires|remote)[\\s-]+)?only${NA}`
  );
  const WIDE_AFTER = pattern(`^[\\s-]*wide${NA}`);
  // A perk, not where the job is: "work from anywhere in Europe for up to 4 weeks a year"
  const PERK_AFTER = pattern(
    `^\\s+(?:for\\s+)?(?:up\\s+to\\s+|a\\s+few\\s+|several\\s+)?(?:(?:\\d+|one|two|three|four|five|six|a)\\s*)?(?:days?|weeks?|months?)${NA}`
  );
  // ...also written before it: "four weeks a year to work from anywhere in the world"
  const PERK_BEFORE = pattern(
    `${NB}(?:\\d+|one|two|three|four|five|six|eight|a\\s+few|several)\\s+(?:days?|weeks?|months?)\\s+(?:a|per|each|every)\\s+year(?:\\s+${GAP_WORD}){0,5}?\\s+${IN}`
  );
  // "EU residents", "European candidates", "US residents"
  const PEOPLE_AFTER = pattern(`^\\s+(?:residents|citizens|nationals|candidates|applicants|talent|hires)${NA}`);
  // "valid EU work permit", "UK right to work"
  const AUTH_AFTER = pattern(`^\\s+(?:work\\s+(?:permit|visa|authori[sz]ation|rights?|eligibility)|right\\s+to\\s+work)${NA}`);
  // "European and U.S. time zones": read as a time zone below
  const TZ_AFTER = pattern(`^\\s+(?:(?:business|working|work|office)\\s+)?(?:hours|time\\s*zones?|timezones?|time)${NA}`);
  const SEGMENT_AFTER = /^\s*(?:[)\]|,]|$)/u;
  // The place ends its phrase: "based in Europe or…", "in the EU." (not "the EU regulatory
  // environment", "an EU-funded project")
  const FOLLOW = pattern(
    `^(?:\\s*(?:$|[.,;:!?()\\[\\]|/&+"'])|\\s+-|\\s+(?:and|or|but|nor|so|as|at|by|for|from|in|into|of|on|to|with|within|without|through|via|during|after|before|than|plus|including|except|who|whom|whose|that|which|where|when|while|if|unless|until|only|preferred|preferably|ideally|currently|also|too|now|today|is|are|was|were|be|will|would|can|could|may|might|must|should|you|we|they|it|this|these|those|the|a|an|our|your|their|its|please|apply|region|area|zone|remote|remotely|full|fully|based|candidates|residents|applicants|citizens|nationals|talent)${NA})`
  );
  // Between a home tag and a European one: ") or Remote (", " (remote) / "
  const ALT_TAG_GAP = pattern(
    `^\\s*(?:[(\\[]\\s*remote\\s*[)\\]]|[)\\]])?\\s*[,/|;]?\\s*(?:(?:or|and|&)\\s+)?(?:remote(?:ly)?\\s*[(\\[,:/|-]?\\s*(?:(?:in|within|from|across)\\s+)?(?:the\\s+)?)?$`
  );
  // Between two places of one list: ", ", " or the ", ", and ", " / ", " (", " + ",
  // " or an / any other / another ", " or within the ", " or elsewhere in the "
  const LIST_GAP =
    /^[\s,/|&+;()]*(?:(?:and\/or|and|or|plus|as well as)\s+)?(?:(?:elsewhere|anywhere(?:\s+else)?)\s+)?(?:(?:in|from|within|across)\s+)?(?:(?:any|one)\s+of\s+)?(?:(?:the|an?|any|another|other)\s+){0,2}$/u;

  // ---- Signals that aren't a place ----

  // Nothing reopens these: what the hire must hold or be ("Public Trust clearance", "subject to export
  // controls"), not the product or a perk ("public trust in elections", "green card sponsorship")
  const ABSOLUTE_RE = words(
    "(?:usa|united\\s+states|american|canadian|uk|british)\\s+citizen(?:s|ship)?|citizen(?:s|ship)?\\s+of\\s+(?:the\\s+)?(?:usa|united\\s+states|canada|uk|united\\s+kingdom)|green\\s+card(?!\\s+(?:sponsorship|sponsor|sponsors|sponsoring|process|processes|applications?|support))|permanent\\s+residen(?:t|ts|ce|cy)\\s+(?:of|in)\\s+(?:the\\s+)?(?:usa|united\\s+states|canada|uk|united\\s+kingdom)|(?:usa|canadian)\\s+permanent\\s+residen(?:t|ts|ce|cy)|public\\s+trust\\s+(?:clearance|position|background|investigation|eligibility|suitability)|(?:obtain|hold|maintain|pass|active|current)\\s+(?:an?\\s+|the\\s+)?public\\s+trust|security\\s+clearance|(?:secret|top\\s+secret|ts|ts\\s*/\\s*sci|sc|dv|nv1|nv2|baseline)\\s+(?:security\\s+)?(?:clearance|cleared)|ts\\s*/\\s*sci|security\\s+check\\s+\\(sc\\)|developed\\s+vetting|reliability\\s+status|bpss|nppv\\d?|itar|ear99|export[\\s-]+controlled|(?:subject\\s+to|comply\\s+with|compliance\\s+with|pursuant\\s+to|governed\\s+by|under)\\s+(?:(?:the|all|applicable|usa|united\\s+states|federal)\\s+){0,3}export[\\s-]+controls?|usa\\s+persons?"
  );
  // "…can't hire outside" + a place is read with the place's list (placeLists), "…outside of these
  // regions" with the list it points back to
  const NO_ABROAD_RE = words(
    "(?:reside|resides|residing|located|based|live|living)\\s+(?:within|in)\\s+the\\s+country\\s+of\\s+the\\s+(?:advertised\\s+)?(?:role|position|job|posting|vacancy)|not\\s+(?:open|available)\\s+to\\s+(?:(?:candidates|applicants)\\s+(?:in|from)\\s+)?(?:other\\s+countries|international|(?:candidates|applicants|those|anyone)\\s+outside)|(?:unable|not\\s+able|cannot|can't|can\\s+not|do\\s+not|don't|won't|will\\s+not)\\s+(?:to\\s+)?(?:hire|employ|consider|accept|engage)\\s+(?:(?:candidates|applicants|anyone|people|talent)\\s+)?(?:(?:based|located|residing|living)\\s+)?(?:from\\s+)?outside|(?:eligible|approved|following|listed)\\s+(?:usa\\s+)?states",
    "g"
  );
  const WORLD_RE = words(
    "location[\\s-]+(?:independent|agnostic)|(?:your\\s+)?location\\s+is\\s+not\\s+a\\s+(?:requirement|restriction|barrier)|(?:hire|hires|hiring|recruit|recruits|recruiting)\\s+(?:(?:talent|people|engineers|developers)\\s+)?(?:globally|wherever\\s+(?:you|they)\\s+(?:are|live|reside))|open\\s+to\\s+international\\s+(?:candidates|applicants|talent)|international\\s+(?:candidates|applicants)\\s+(?:are\\s+)?(?:welcome|encouraged|considered)|(?:contractors?|freelancers?|contract)\\s+(?:basis\\s+)?worldwide|worldwide\\s+(?:contractors?|contract)"
  );
  // How a job abroad is held: an employer of record ("employed through Oyster", "hired via a local
  // EOR"), not what the employer sells ("Acme is the leading employer of record platform")
  const EOR_RE = words(
    "(?:through|via|using|uses?|with|by|as)\\s+(?:(?:our|an?|the|local|third[\\s-]party|partner)\\s+){0,3}(?:employers?\\s+of\\s+record|eor)(?!\\s+(?:platform|platforms|software|services|solutions?|products?|industry|market|space))|(?:through|via|with|using|by)\\s+(?:our\\s+|an?\\s+|the\\s+)?(?:partner\\s+|provider\\s+)?(?:deel|remote\\.com|oyster(?:\\s+hr)?|velocity\\s+global|papaya\\s+global|omnipresent|multiplier|globalization\\s+partners|g-p|rippling)|non-usa\\s+(?:employees|candidates|hires|residents|applicants|staff|team\\s+members)"
  );
  // Not where it hires: "work from anywhere" (often anywhere in the US), "customers in 120 countries"
  const ANY_RE = words(
    "anywhere(?!\\s+(?:in|within|across|throughout|between|from\\s+\\d))|(?:globally|fully)\\s+distributed|distributed\\s+(?:team|company|workforce)|(?:in|across|from)\\s+(?:over\\s+|more\\s+than\\s+)?\\d+\\+?\\s+countries|around\\s+the\\s+(?:world|globe)"
  );
  const FORMS_RE = words("w-?2|1099|c2c|corp[\\s-]+to[\\s-]+corp");
  const HOME_TZ =
    "(?:eastern|central|mountain|pacific|atlantic)\\s+(?:standard\\s+|daylight\\s+)?(?:time|hours)|(?:est|edt|cst|cdt|mst|mdt|pst|pdt|et|ct|mt|pt)\\s+(?:business\\s+|working\\s+|work\\s+)?(?:hours|time\\s*zones?|timezones?)|(?:usa|north\\s+american|canadian|uk|british)\\s+(?:business\\s+|working\\s+|work\\s+|office\\s+)?(?:hours|time\\s*zones?|timezones?)";
  const HOME_TZ_RE = words(HOME_TZ);
  // An offset that spells out home hours is home time: "UK hours (9am-5:30pm, UTC+0 in winter…)"
  const HOME_TZ_BEFORE = pattern(`${NB}(?:${HOME_TZ})${NA}\\s*[(\\[][^()\\[\\]]{0,60}$`);
  // Where the employer's own team is, not who it hires: "a team spread from PST to CET"
  const SPREAD_BEFORE = pattern(
    `${NB}(?:teams?|team\\s+members|we|we're|we\\s+are|colleagues|employees|staff)(?:\\s+(?:is|are|all))?\\s+(?:spread|spans?|spanning|distributed)${NA}`
  );

  // ---- Time zones (standard offsets: Western 0, Central 1, Eastern European 2) ----

  const TZ_ELSE = "usa|us|american|north\\s+american|americas|amer|uk|british|latam|asia|asian|apac|africa|african|middle\\s+east";
  const PLUS_MINUS = "(?:\\+\\s*/\\s*-|±|plus\\s+or\\s+minus)\\s*(\\d{1,2})";
  // "CET", "European time zones", "UK / EU timezone", "Western European or American time zone", "CET Zone +/- 2 hours"
  const TZ_NAMED_RE = words(
    `(?:(?:${TZ_ELSE})\\s*(?:and|or|&|/|\\+)\\s*)?(western european|central european|eastern european|european|eu|emea|europe)(?:\\s*(?:and|or|&|/|\\+)\\s*(?:${TZ_ELSE}))?\\s+(?:(?:summer|standard|business|working|work)\\s+)?(?:time[\\s-]*zones?|timezones?|time|hours|zones?|tz)(?:\\s*(?:\\(\\s*)?(?:or\\s+)?${PLUS_MINUS})?`,
    "g"
  );
  // "UTC+1", "UTC-3 to UTC+3", "UTC/GMT -3 to -8", "between UTC-1 and UTC+3"
  const TZ_RANGE_RE = words(
    "(?:utc|gmt)(?:\\s*/\\s*(?:utc|gmt))?\\s*([+-]|±)\\s*(\\d{1,2})(?:[:.][0-5]\\d)?(?:\\s*(?:to|-|and|through|until|till)\\s*(?:(?:utc|gmt)\\s*)?(?:([+-])\\s*)?(\\d{1,2})(?:[:.][0-5]\\d)?)?",
    "g"
  );
  // "GMT time zone (or +/- 3 hours", "UTC +/- 3"
  const TZ_PM_RE = words(`(?:utc|gmt)(?:\\s*/\\s*(?:utc|gmt))?(?:\\s+time[\\s-]*zones?)?\\s*(?:\\(\\s*)?(?:or\\s+)?${PLUS_MINUS}`, "g");
  // "within 3 hours of GMT"
  const TZ_WITHIN_RE = words(
    "within\\s+(\\d{1,2})\\s*(?:hours?|hrs?|h)\\s+(?:of\\s+)?(?:the\\s+)?(gmt|utc|uk|western european|central european|eastern european|european)",
    "g"
  );
  const ZONE_UTC = { gmt: 0, utc: 0, uk: 0, "western european": 0, "central european": 1, "eastern european": 2 };

  // A posting names a few time zones; more add nothing (and cost time on long text)
  const MAX_ZONES = 12;

  function* first(text, re) {
    let n = 0;
    for (const m of text.matchAll(re)) {
      if (++n > MAX_ZONES) return;
      yield m;
    }
  }

  function timeZones(text, field, hits) {
    const add = (m, lo, hi) => {
      const before = sentenceBefore(text, m.index);
      if (HOME_TZ_BEFORE.test(before) || SPREAD_BEFORE.test(before)) return;
      hits.push({
        type: "tz",
        field,
        text: m[0],
        window: [lo, hi],
        // "must be located within…", "between…": a requirement that narrows the rest
        req: RESTRICT.test(before) || /(?:within|between)\s+(?:the\s+)?$/u.test(before) || /^within/u.test(m[0]),
      });
    };
    for (const m of first(text, TZ_NAMED_RE)) {
      const utc = ZONE_UTC[m[1]];
      const n = m[2] == null ? null : Number(m[2]);
      // A named zone also takes its neighbours; "European time zones" are all of them
      if (utc == null) add(m, 0 - (n || 0), 2 + (n || 0));
      else add(m, utc - (n ?? 1), utc + (n ?? 1));
    }
    for (const m of first(text, TZ_RANGE_RE)) {
      const a = m[1] === "-" ? -Number(m[2]) : Number(m[2]);
      if (m[1] === "±") add(m, -a, a);
      else if (m[4] == null) add(m, a - 1, a + 1);
      else {
        const sign = m[3] || m[1];
        const b = sign === "-" ? -Number(m[4]) : Number(m[4]);
        add(m, Math.min(a, b), Math.max(a, b));
      }
    }
    for (const m of first(text, TZ_PM_RE)) add(m, -Number(m[1]), Number(m[1]));
    for (const m of first(text, TZ_WITHIN_RE)) {
      const utc = ZONE_UTC[m[2]] ?? 1;
      add(m, utc - Number(m[1]), utc + Number(m[1]));
    }
  }

  /** The text of the sentence before `at` (a list is read with its own sentence). */
  function sentenceBefore(text, at) {
    const before = text.slice(Math.max(0, at - 160), at);
    const end = Math.max(...[". ", "! ", "? ", "; ", "• "].map((stop) => before.lastIndexOf(stop)));
    return end < 0 ? before : before.slice(end + 2);
  }

  const EUROPE_KINDS = new Set(["country", "region", "part", "world"]);

  /** Reads each list of places in one field, with the words around it. */
  function placeLists(text, field, hits) {
    const { re, byName } = places();
    const head = field !== "description";
    const found = [...text.matchAll(re)];
    // One list: places joined by ", ", " or ", " / "…
    const lists = [];
    for (let i = 0; i < found.length; ) {
      let j = i + 1;
      while (j < found.length && LIST_GAP.test(text.slice(found[j - 1].index + found[j - 1][0].length, found[j].index))) j++;
      const last = found[j - 1];
      const items = found.slice(i, j).map((m) => ({ key: m[1], ...byName.get(m[1]) }));
      lists.push({ start: found[i].index, end: last.index + last[0].length, items });
      i = j;
    }
    // "Remote (US/Canada) or Remote (Europe)": a home tag joined to a European one is the other half of the hire
    const isEurope = (list) => list.items.some((p) => EUROPE_KINDS.has(p.kind));
    const joined = (a, b) => a && b && b.start - a.end < 40 && ALT_TAG_GAP.test(text.slice(a.end, b.start));
    const besideEurope = (k) =>
      (joined(lists[k - 1], lists[k]) && isEurope(lists[k - 1])) || (joined(lists[k], lists[k + 1]) && isEurope(lists[k + 1]));

    for (let k = 0; k < lists.length; k++) {
      const { start, end } = lists[k];
      const items = [...lists[k].items];
      const piped = items.length > 1 && /[|/+]/u.test(text.slice(start, end));
      const before = sentenceBefore(text, start);
      const after = text.slice(end, end + 60);
      if (TZ_AFTER.test(after)) continue;
      // "European" names people only: "European candidates" (not "European markets")
      if (items[items.length - 1].key === "european" && !PEOPLE_AFTER.test(after)) items.pop();
      if (!items.length || BASED_COMPANY_AFTER.test(after) || PERK_AFTER.test(after) || PERK_BEFORE.test(before)) continue;
      const europe = items.filter((p) => EUROPE_KINDS.has(p.kind));
      const homeOnly = !europe.length && items.some((p) => p.kind === "home" || p.kind === "state");
      // The last words before the list: a "must" further back is about something else ("you must be
      // comfortable working with a team that is mostly in the US")
      const near = before.trimEnd().split(" ").slice(-10).join(" ");
      const restrict = RESTRICT.test(near) || ROLE_AFTER.test(after) || MUST_BE_BEFORE.test(before);
      const tag = TAG_BEFORE.test(before) || REMOTE_AFTER.test(after);
      const bareTag = BARE_TAG_BEFORE.test(before) && (head || /^\s*(?:$|[.,;:!?)\]|])/u.test(after));
      const follows = FOLLOW.test(after);
      // What it says, for the log: the last words before the list, the list, and a tag after it
      const lead = head ? before : before.split(" ").slice(-7).join(" ");
      const tail = after.match(/^(?:[\s(\[,:/|-]*(?:remote|based|only|wide)(?![\p{L}\p{N}]))?\)?/u)[0];
      const what = `${lead}${text.slice(start, end)}${tail}`.trim();
      const hit = { field, text: what };

      if (OUTSIDE_BEFORE.test(before)) {
        // "candidates outside the US" are hired elsewhere; "we can't hire outside the US" are not, and
        // "we can't hire outside the EU" hire in the EU only
        const not = NOT_OUTSIDE_BEFORE.test(before) || NOT_AFTER.test(after);
        if (homeOnly) hits.push(not ? { ...hit, type: "closed" } : { ...hit, type: "strong", scope: null, label: "Worldwide" });
        else if (europe.length && not) hits.push({ ...hit, type: "strong", req: true, ...scopeOf(europe) });
        continue;
      }
      if (europe.length) {
        if (NOT_HIRE_BEFORE.test(before)) {
          hits.push({ ...hit, type: "closed" });
          continue;
        }
        const strong =
          tag ||
          bareTag ||
          BASED_AFTER.test(after) ||
          PEOPLE_AFTER.test(after) ||
          AUTH_AFTER.test(after) ||
          AUTH_BEFORE.test(before) ||
          ANYWHERE_BEFORE.test(before) ||
          MUST_BE_BEFORE.test(before) ||
          COLON_BEFORE.test(before) ||
          OF_BEFORE.test(before) ||
          // Who is hired or where they live needs no end to the phrase: a bullet runs into the next
          // one ("Based in the EU 5+ years of Go"); "EU-funded" is no place
          (STRONG_BEFORE.test(before) && !/^-/u.test(after)) ||
          (follows && (head || piped));
        const loose = !strong && follows && LOOSE_BEFORE.test(before);
        if (!strong && !loose) continue;
        // "people across the world" is a blurb
        const worldOnly = europe.every((p) => p.kind === "world");
        const type = strong ? "strong" : worldOnly ? "weak" : "loose";
        hits.push({ ...hit, type, req: strong && restrict, ...scopeOf(europe) });
        continue;
      }
      if (!homeOnly) continue;
      if (AUTH_BEFORE.test(before) || AUTH_AFTER.test(after)) {
        hits.push({ ...hit, type: "weakClosed" });
        continue;
      }
      // Where the hire lives ("based in", "Location:"), not who they work with ("collaboration with
      // engineers in the US")
      const triggered = STRONG_BEFORE.test(before) || COLON_BEFORE.test(before);
      const closes =
        ((tag || bareTag) && !besideEurope(k)) ||
        ANYWHERE_BEFORE.test(before) ||
        WIDE_AFTER.test(after) ||
        // "Open to US residents" (not "US candidates must be authorized…", the US half of a mixed hire)
        (PEOPLE_AFTER.test(after) && (restrict || OPEN_TO_BEFORE.test(before))) ||
        ONLY_AFTER.test(after) ||
        ROLE_AFTER.test(after) ||
        (restrict && (triggered || BASED_AFTER.test(after) || MUST_BE_BEFORE.test(before))) ||
        (field === "title" && (SEGMENT_BEFORE.test(before) || SEGMENT_AFTER.test(after)));
      if (closes) hits.push({ ...hit, type: "closed" });
    }
  }

  /** Who a list of European places opens the job to: everyone (scope null) or some countries. */
  function scopeOf(europe) {
    const wide = europe.find((p) => p.kind === "region" || p.kind === "world");
    if (wide) return { scope: null, label: wide.label };
    const scope = new Set(europe.flatMap((p) => p.codes || [p.code]));
    return { scope, label: null, names: europe.filter((p) => p.kind === "country"), parts: europe.filter((p) => p.kind === "part") };
  }

  function signals(text, field, hits) {
    if (!text) return;
    const add = (re, type, extra = {}) => {
      const m = text.match(re);
      if (m) hits.push({ type, field, text: m[0], ...extra });
    };
    add(ABSOLUTE_RE, "absolute");
    for (const m of first(text, NO_ABROAD_RE)) {
      const next = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (m[0].endsWith("outside") && places().outsideNext.test(next)) continue;
      hits.push({ type: "closed", field, text: m[0] });
      break;
    }
    add(WORLD_RE, "strong", { scope: null, label: "Worldwide" });
    add(EOR_RE, "strong", { scope: null, label: "Worldwide", how: true });
    add(ANY_RE, "weak");
    add(FORMS_RE, "weakClosed");
    add(HOME_TZ_RE, "homeTz");
    placeLists(text, field, hits);
    timeZones(text, field, hits);
  }

  const union = (a, b) => (a === null || b === null ? null : new Set([...a, ...b]));
  const intersect = (a, b) => (a === null ? b : b === null ? a : new Set([...a].filter((c) => b.has(c))));
  const windowScope = ([lo, hi]) => new Set(COUNTRIES.filter(([, , utc]) => utc >= lo && utc <= hi).map(([code]) => code));
  const utcText = (n) => `UTC${n < 0 ? "-" : "+"}${Math.abs(n)}`;

  /** Ticked countries: code → the names given for it (no names: every country). */
  function tickedCountries(countryNames) {
    const { byName } = places();
    const out = new Map();
    for (const name of countryNames) {
      const p = byName.get(prep(name));
      if (p?.kind !== "country") continue;
      if (!out.has(p.code)) out.set(p.code, []);
      out.get(p.code).push(name);
    }
    if (!countryNames.length) for (const [code, name] of COUNTRIES) out.set(code, [name]);
    return out;
  }

  const closed = (reason) => ({ open: false, to: "", reason: reason || "" });

  /** Who the deciding signals open the job to, among the ticked countries. */
  function decide(use, all, ticked) {
    const tz = use.every((h) => h.type === "tz");
    // Where it hires; an employer of record or "must reside in…" alone: anywhere, narrowed below
    const offers = use.filter((h) => !h.req && !h.how);
    let scope = tz
      ? use.map((h) => windowScope(h.window)).reduce(union)
      : offers.length
        ? offers.map((h) => h.scope).reduce(union)
        : null;
    // "must reside in Ireland or the UK", "must be located within UTC+1 to UTC-8" narrow the rest
    const reqs = all.filter((h) => h.req && (h.type === "strong" || (h.type === "tz" && !tz)));
    for (const h of reqs) scope = intersect(scope, h.type === "tz" ? windowScope(h.window) : h.scope);
    const codes = [...ticked.keys()].filter((code) => scope === null || scope.has(code));
    const lead = use[0];
    if (!codes.length) return closed(`not the ticked countries: ${lead.text}`);
    const listed = [...use, ...reqs].filter((h) => h.names);
    let to;
    if (scope !== null && listed.length) {
      // The ticked countries a list names, as the posting or the user wrote them, and the parts of Europe it names
      const shown = new Map();
      for (const h of listed) {
        for (const p of h.names) {
          const given = ticked.get(p.code);
          if (given && codes.includes(p.code) && !shown.has(p.code)) shown.set(p.code, given.find((n) => prep(n) === p.key) || given[0]);
        }
      }
      for (const h of listed) {
        for (const p of h.parts) {
          if (p.codes.some((c) => codes.includes(c) && !shown.has(c))) shown.set(p.label, p.label);
        }
      }
      to = [...shown.values()].join(", ");
    } else {
      // A place before how the job is held ("Remote across the EU. Employed through Deel.")
      const label = use.find((h) => h.label && !h.how)?.label || use.find((h) => h.label)?.label;
      to = label || (use.some((h) => h.type === "tz") ? "European time zones" : "Europe");
      const windows = [...use, ...reqs].filter((h) => h.type === "tz");
      if (windows.length && codes.length < ticked.size) {
        const lo = Math.min(...windows.map((h) => h.window[0]));
        const hi = Math.max(...windows.map((h) => h.window[1]));
        to = `European time zones (${lo === hi ? utcText(lo) : `${utcText(lo)} to ${utcText(hi)}`})`;
      }
    }
    return { open: true, to, reason: lead.text };
  }

  /**
   * @param {{ title?: string, location?: string, company?: string, description?: string }} job
   * @param {string[]} countryNames  ticked countries (English and local names); none: all
   * @returns {{ open: boolean, to: string, reason: string }}
   */
  function jbOpenToEurope(job, countryNames = []) {
    const ticked = tickedCountries(countryNames);
    let description = prep(job?.description);
    // "WeMove Europe is registered in…": the company's name is not a place it hires
    const company = prep(job?.company).replace(/[,.]?\s+(?:inc|ltd|llc|gmbh|plc|limited|corp|sa|bv|ag|e\.?\s?v)\.?$/u, "");
    if (company && description) {
      const { re } = places();
      if ([...company.matchAll(re)].some((m) => m[0].length < company.length)) {
        description = description.split(company).join(" ").replace(/\s+/g, " ");
      }
    }
    const hits = [];
    signals(prep(job?.title), "title", hits);
    signals(prep(job?.location), "location", hits);
    signals(description, "description", hits);
    const of = (type) => hits.filter((h) => h.type === type);

    const absolute = of("absolute");
    if (absolute.length) return closed(absolute[0].text);
    const strong = of("strong");
    const loose = of("loose");
    const tz = of("tz").filter((h) => windowScope(h.window).size);
    const strongClosed = of("closed");
    // "European and U.S. time zones": the US half is part of the open phrase
    const weakClosed = [...of("weakClosed"), ...(tz.length ? [] : of("homeTz"))];

    if (strong.length) {
      if (!strongClosed.length) return decide(strong, hits, ticked);
      // Both: the title or location field says where the job is
      const head = strong.filter((h) => h.field !== "description");
      if (head.length) return decide(head, hits, ticked);
      return closed(`${strong[0].text} / ${strongClosed[0].text}`);
    }
    if (strongClosed.length) return closed(strongClosed[0].text);
    if (loose.length) {
      if (weakClosed.length) return closed(`${loose[0].text} / ${weakClosed[0].text}`);
      return decide(loose, hits, ticked);
    }
    if (tz.length) {
      if (weakClosed.length) return closed(`${tz[0].text} / ${weakClosed[0].text}`);
      return decide(tz, hits, ticked);
    }
    if (of("tz").length) return closed(of("tz")[0].text);
    return closed(of("weak")[0]?.text || weakClosed[0]?.text);
  }

  globalThis.jbOpenToEurope = jbOpenToEurope;
})();
