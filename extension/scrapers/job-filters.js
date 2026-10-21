/**
 * Experience-year and employment-type checks shared by extension pages
 * and site tabs. Plain script (no import/export) so it can be injected
 * via chrome.scripting.executeScript({ files }) after title-match.js.
 *
 * English rules first; a second pass reads the other EU languages on folded
 * text (lowercase, no accents: "Jahre", "años" → "anos", "doświadczenie" →
 * "doswiadczenie"), so the word lists below are folded too.
 *
 * Years: "5+ years of experience", "3-5 years experience", "4 years' experience",
 * "5 or more years of experience", "Experience: 5+ years".
 * A range uses its minimum (the years the job requires).
 * Several mentions use the highest requirement.
 * Company blurbs are skipped ("we have 15 years of experience",
 * "a consultancy with an experience of 12 years", anything above 15 years).
 */
(function () {
  const YEARS_RE =
    /(?:\b(?:at least|minimum(?: of)?|min\.?)\s+)?(?<![\d.,])(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:[.,]\d+)?))?(?:\s*\+|\s+or\s+more|\s+plus)?\s*(?:years?|yrs?)['’]?(?:\s+of)?((?:\s+\.?[a-z][a-z0-9+#./-]*[a-z0-9+#]){0,6}?)\s+experience\b/gi;
  const EXPERIENCE_FIRST_RE =
    /\bexperience(?:\s+(?:required|needed))?\s*(?::|-|–|—|\bof\b)\s*(?:(?:at least|minimum(?: of)?|min\.?)\s+)?(?<![\d.,])(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?)?(?:\s*\+|\s+or\s+more|\s+plus)?\s*(?:years?|yrs?)\b/gi;
  // "We have …", "Our company has over …" right before the number
  const COMPANY_BEFORE_RE =
    /\b(?:we|our\s+[a-z]+(?:\s+(?:team|group|staff|founders?|company|firm))?|the\s+company|company|firm|agency|founders?)\s+(?:has|have|had|brings?|boasts?)\s+(?:(?:over|more\s+than|nearly|almost|about|around)\s+)?$/i;
  // "12 years of combined experience across our leadership" is a blurb;
  // "5+ years of combined experience in backend" is a requirement
  const COMBINED_RE = /\b(?:combined|collective|cumulative)\b/i;
  const COMPANY_WORD_RE = /\b(?:we|our|us|team|founders?|leadership)\b/i;
  // Same sentence, before "experience of N years": the company's history
  // ("Our company, with an experience of 12 years, …")…
  const COMPANY_SENTENCE_RE =
    /\b(?:we|our|company|firm|agency|consultancy|founders?)\b[^.!?\n]*$/i;
  // …always when the company itself takes it ("a staffing firm having experience of 12 years")…
  const COMPANY_TAKES_RE =
    /\b(?:company|firm|agency|consultancy)\s+(?:(?:that|which)\s+)?(?:with|having|has|brings?|bringing)\s+(?:an?\s+)?$|\b(?:we|our\s+(?:[a-z]+\s+)?(?:team|company|firm|agency|consultants|recruiters|founders?))(?:,?\s+(?:that|which|who))?\s+(?:(?:also|now)\s+)?(?:bring|brings|have|has|boast|boasts)\s+(?:an?\s+)?$|\b(?:client|partner),\s+an?\s+(?:[\w-]+\s+){0,3}(?:company|firm|organi[sz]ation|business|startup)\s+(?:with|having|that\s+has)\s+(?:an?\s+)?$/i;
  // …but not when the sentence asks for a person ("We are looking for someone with experience of 5 years")
  // (a hiring verb of the reader or the firm's clients doesn't count: "Whether
  // you need a developer or a team, we bring an experience of 12 years")
  const HIRING_RE =
    /(?<!\b(?:you|you're|you\s+are|your\s+\w+|companies|clients|businesses|enterprises|startups|organi[sz]ations|employers)(?:\s+(?:that|who))?\s+)\b(?:(?:looking|searching)\s+for|seeking|hiring(?:\s+for)?|needs?|wants?|requires?)\s+(?:an?\s|someone|somebody|candidates?|engineers?|developers?|professionals?)|\bideal\s+candidate\b|\b(?:must|should)\s+have\b|\bjoin\s+(?:our|the)\b|\bwhat\s+(?:we're|we\s+are)\s+looking\s+for\b|\b(?:requirements|qualifications)\b/i;
  // "- Startup or agency experience of 3+ years", "Must have agency experience
  // of 3 years" describe the experience ("We have agency experience…" doesn't)
  const MODIFIER_RE =
    /(?:(?:^|[\n:•*])\s*[-•*]?|\b(?:must|should)\s+have)\s*(?:(?:strong|prior|proven|some)\s+)?(?:[a-z-]+\s+(?:or|and)\s+)?(?:[a-z-]+\s+)?(?:company|firm|agency|consultancy)\s*$/i;
  // "We are an IT staffing company | Experience: 12+ years" is a profile
  const COMPANY_INTRO_RE = /\bwe\s+are\s+an?\s+[^.!?\n]*\b(?:company|firm|agency|consultancy)\b[^.!?\n]*$/i;
  // Bigger numbers are company history ("25 years of industry experience")
  const MAX_REQUIRED_YEARS = 15;

  const fold = (text) =>
    globalThis.jbFold ? globalThis.jbFold(text) : String(text || "").toLowerCase();
  // Not a letter or digit on that side (\b only knows ASCII)
  const NB = "(?<![\\p{L}\\p{N}])";
  const NA = "(?![\\p{L}\\p{N}])";
  const words = (alts) => new RegExp(`${NB}(?:${alts})${NA}`, "u");

  // Year words: Jahre, ans, años, anni, jaar, lat/lata, år/års, vuotta, roky/let, év, ani,
  // χρόνια/ετών, and year adjectives (3-jährige, 3-letnie, 3letá, 3ετής). Greek is
  // folded too: final ς is σ
  const EU_YEAR =
    "jahre|jahren|jahr|jahres|jahrig\\p{L}*|ans|an|annees|annee|anos|ano|anni|anno|jaar|jaren|lat|lata|roku|rok|roky|let|leta|lete|letou|ar|ars|vuotta|vuoden|vuosi|ev|eves|ani|χρονια|χρονων|ετη|ετων|ετησ|ετουσ|letni\\p{L}*";
  // Experience words, Germanic and Finnish ones also inside compounds
  // (Berufserfahrung, werkervaring, arbetslivserfarenhet, erhvervserfaring, työkokemus)
  const EU_EXP =
    "\\p{L}*erfahrung\\p{L}*|experience|experiencia|esperienza|experienta|\\p{L}*ervaring|doswiadcz\\p{L}*|staz pracy|\\p{L}*erfarenhet\\p{L}*|\\p{L}*erfaring\\p{L}*|\\p{L}*kokemus\\p{L}*|praxe|praxi|zkusenost\\p{L}*|\\p{L}*tapasztalat\\p{L}*|εμπειρια\\p{L}*";
  // Requirement minimums: "mindestens", "au moins", "al menos", "almeno", "minimaal", "co najmniej", "minst", "vähintään"…
  const EU_REQ_MIN =
    "mindestens|mind\\.?|mindst|min\\.?|minimum|minimal|minimaal|minimo|minima|minim|minst|vahintaan|legalabb|au moins|al menos|almeno|ten minste|tenminste|co najmniej|przynajmniej|alespon|nejmene|cel putin|τουλαχιστον";
  // "über", "plus de", "more than": requirements, and companies about themselves
  const EU_MORE_THAN = "mehr als|plus de|mas de|piu di|meer dan|ponad|uber|ueber|oltre|over|ruim|more than";
  const EU_MIN = `${EU_REQ_MIN}|${EU_MORE_THAN}`;
  // "3-5", "3 bis 5", "3 à 5", "2/3 anni"
  const EU_RANGE = "-|–|—|/|bis|a|al|tot|do|till|til|to|ate";
  // Words that end the gap between "3 Jahre" and "Erfahrung": another clause
  // ("für 2 Jahre mit Erfahrung", "10 Jahre alt und …")
  const GAP_STOP = "mit|with|und|and|et|y|e|oder|or|ou|o|sowie|fur|pour|para|per|voor|dla|als|as|alt|old|jung";
  const EU_MORE =
    "oder mehr|ou plus|o mas|o piu|of meer|lub wiecej|eller mer|eller mere|tai enemman|vagy tobb|sau mai mult";
  const NUM = "(\\d+(?:[.,]\\d+)?)";
  // "3+ Jahre Berufserfahrung", "3 ans d'expérience", "minimaal 3 jaar werkervaring", "3-letnie doświadczenie".
  // Gap words are whole words between spaces, so a long word can't be split
  // many ways (that backtracks for minutes on long descriptions)
  const EU_YEARS_FIRST_RE = new RegExp(
    `${NB}(?:(?:${EU_MIN})\\s+)?${NUM}(?:\\s*(?:${EU_RANGE})\\s*\\d+(?:[.,]\\d+)?)?(?:\\s*\\+|\\s+(?:${EU_MORE}))?\\s*-?\\s*(?:${EU_YEAR})${NA}(?:\\s+(?:de|d['’]|di|van|av|af|z|ze))?(?:\\s+(?!(?:${GAP_STOP})${NA})[\\p{L}'’+#/-]+){0,6}?(?:\\s+|(?<=['’]))(?:${EU_EXP})${NA}`,
    "gu"
  );
  // "Berufserfahrung von mindestens 3 Jahren", "expérience de 3 ans minimum",
  // "doświadczenie min. 3 lata", "Berufserfahrung (mind. 3 Jahre)"
  // ("Erfahrung mit Kindern von 3 bis 6 Jahren" names an age, not a requirement)
  const AUDIENCE = "kinder\\p{L}*|kids|children|child|enfants|ninos|bambini|dzieci|deti|jugendliche\\p{L}*|schuler\\p{L}*|zielgruppe\\p{L}*|alter|age|ages|aged|ans et plus";
  const EU_EXPERIENCE_FIRST_RE = new RegExp(
    `${NB}(?:${EU_EXP})${NA}(?:\\s+(?!(?:${AUDIENCE})${NA})[\\p{L}'’]+){0,4}?\\s*(?:[(:–—-]\\s*)?(?:(?:${EU_MIN})\\s+)?${NUM}(?:\\s*(?:${EU_RANGE})\\s*\\d+(?:[.,]\\d+)?)?(?:\\s*\\+)?\\s*-?\\s*(?:${EU_YEAR})${NA}`,
    "gu"
  );
  // Indeed's posting footer: "Experience: SEO: 2 years (Required), total work: 3 years (Preferred)".
  // Only "<label>: N years" items right after the heading, up to the sentence end
  const FOOTER_RE = new RegExp(`${NB}(?:experience|${EU_EXP})\\s*:`, "gu");
  const FOOTER_ITEM_RE = new RegExp(
    `(?:^|[,;])\\s*[\\p{L}\\p{N} +#/&-]{1,40}:\\s*${NUM}(?:\\s*(?:${EU_RANGE})\\s*\\d+(?:[.,]\\d+)?)?\\s*\\+?\\s*(?:years?|yrs?|${EU_YEAR})${NA}`,
    "gu"
  );
  // The company about itself: "wir blicken auf 12", "notre agence a 10", "nuestra
  // empresa cuenta con 20", "ons bureau heeft ruim 15" (not "wir erwarten 3")
  const COMPANY_SUBJECT =
    "wir|unser\\p{L}*|nous|notre|nos|nuestr\\p{L}*|nosotros|noi|nostr\\p{L}*|wij|onze|ons|nasz\\p{L}*|vi|vart|vara|vores|meidan|nase\\p{L}*|nosso|nossa|nossos|nossas|μασ|εμεισ|(?:die |das |der |la |le |l |el |il |het |de )?(?:agentur|agence|agencia|agenzia|unternehmen|entreprise|empresa|azienda|bedrijf|bureau|firma|firm|company|team|equipe|equipo|squadra)";
  const COMPANY_HAS =
    "haben|hat|blicken auf|blickt auf|verfugen uber|verfugt uber|bringen|bringt|avons|a|cumulons|comptons|compte|tenemos|tiene|cuenta con|contamos con|abbiamo|ha|vantiamo|vanta|hebben|heeft|mamy|ma|har|on|mame|avem|are|εχουμε|εχει|have|has|bring|brings";
  const COMPANY_HAS_RE = new RegExp(
    `${NB}(?:${COMPANY_SUBJECT})(?:\\s+\\p{L}+){0,3}?\\s+(?:${COMPANY_HAS})(?:\\s+(?:${EU_MORE_THAN}|fast|bijna|pres de|casi|quasi|prawie|nearly|almost|about|around))?\\s*$`,
    "u"
  );
  // "Forte de 12 ans d'expérience, notre agence…", "Con más de 20 años de experiencia,
  // somos…", "Als Agentur mit über 12 Jahren…", "Firma z ponad 12-letnim doświadczeniem"
  const WITH_YEARS_RE = new RegExp(`${NB}(?:fortes? de|fort de|mit|with|avec|con|com|z|met|med|cu)(?:\\s+(?:${EU_MORE_THAN}))?\\s*$`, "u");
  const COMPANY_FIRST_RE = new RegExp(
    `(?:^|[,;:])\\s*(?:als\\s+|as\\s+an?\\s+|en tant qu\\s*|come\\s+|como\\s+)?(?:${COMPANY_SUBJECT})${NA}`,
    "u"
  );
  const COMPANY_NEXT_RE = new RegExp(
    `^[^,;]*[,;]\\s*(?:${COMPANY_SUBJECT}|somos|siamo|sommes|sind|zijn|jestesmy|we are|we re)${NA}`,
    "u"
  );
  const REQ_MIN_RE = new RegExp(`${NB}(?:${EU_REQ_MIN})(?=\\s)`, "u");

  // Number words next to a year word ("drei Jahre", "trois ans", "kolmen vuoden")
  // and year adjectives ("dreijährige", "triennale", "dwuletnie", "tříletá",
  // "διετής") are read as digits
  const NUMBER_WORDS = [
    "ein|eine|einem|einen|einer|un|une|uno|una|um|uma|een|jeden|jedna|jedno|ett|yhden|yksi|egy|unu|ενα",
    "zwei|deux|dos|due|dois|duas|twee|dwa|dwie|dwoch|dva|dve|kaksi|kahden|tva|ket|doi|δυο",
    "drei|trois|tres|tre|drie|trzy|trzech|tri|kolme|kolmen|harom|trei|τρια",
    "vier|quatre|cuatro|quattro|quatro|cztery|czterech|ctyri|nelja|neljan|fyra|fire|negy|patru|τεσσερα",
    "funf|cinq|cinco|cinque|vijf|piec|pieciu|pet|viisi|viiden|fem|ot|cinci|πεντε",
  ];
  // Also the first of a range: "zwei bis drei Jahre", "trois à cinq ans"
  const NUMBER_WORD_RE = new RegExp(
    `${NB}(${NUMBER_WORDS.join("|")})(?=(?:\\s*(?:${EU_RANGE}|oder|ou|o|of|lub|eller|tai|vagy|sau)\\s*(?:${NUMBER_WORDS.join("|")}|\\d+))?\\s*-?\\s*(?:${EU_YEAR})${NA})`,
    "gu"
  );
  // Only next to an experience word: "laurea triennale" is a degree, "roczny" annual
  const NEAR_EXP = `(?=(?:\\s+\\p{L}+){0,2}?\\s+(?:${EU_EXP})${NA}|(?<=(?:${EU_EXP})(?:\\s+\\p{L}+){0,2}\\s+\\p{L}*))`;
  const adjective = (stems, tail) =>
    new RegExp(`(?<![\\p{L}\\p{N}])(?<!(?:laurea|corso|studi|diploma)\\s+)(${stems})${tail}${NEAR_EXP}`, "gu");
  const YEAR_ADJECTIVES = [
    [adjective("ein|zwei|drei|vier|funf", "jahrig\\p{L}*"), " jahre"],
    [adjective("biennale|triennale|quadriennale|quinquennale", "(?![\\p{L}\\p{N}])"), " anni"],
    [adjective("dwulet|trzylet|czterolet|pieciolet", "\\p{L}*"), " lat"],
    [adjective("dvoulet|trilet|ctyrlet|petilet", "\\p{L}*"), " let"],
    [adjective("διετ|τριετ|τετραετ|πενταετ", "\\p{L}*"), " ετη"],
  ];
  const ADJECTIVE_NUMBERS = {
    ein: 1,
    zwei: 2, biennale: 2, dwulet: 2, dvoulet: 2, διετ: 2,
    drei: 3, triennale: 3, trzylet: 3, trilet: 3, τριετ: 3,
    vier: 4, quadriennale: 4, czterolet: 4, ctyrlet: 4, τετραετ: 4,
    funf: 5, quinquennale: 5, pieciolet: 5, petilet: 5, πενταετ: 5,
  };
  // "zwischen 2 und 4 Jahren", "entre 2 y 4 años", "da 2 a 4 anni": the range 2-4
  const BETWEEN_RE =
    /(?<![\p{L}\p{N}])(?:zwischen|entre|tra|fra|between|tussen|mellan|mellem|miedzy|da|od)\s+(\d+(?:[.,]\d+)?)\s+(?:und|y|e|and|et|en|i|och|og|a|do)\s+(\d+(?:[.,]\d+)?)/gu;

  /** Folded text with number words, year adjectives and "between" ranges as digits. */
  function digitsForYears(t) {
    let out = t.replace(NUMBER_WORD_RE, (w) => String(NUMBER_WORDS.findIndex((alts) => alts.split("|").includes(w)) + 1));
    for (const [re, unit] of YEAR_ADJECTIVES) out = out.replace(re, (_, stem) => `${ADJECTIVE_NUMBERS[stem]}${unit}`);
    return out.replace(BETWEEN_RE, "$1-$2");
  }

  // "seit über 20 Jahren", "depuis plus de 15 ans", "desde hace 10 años": company history
  const EU_SINCE_RE =
    /(?:seit|depuis|desde(?: hace)?|sinds|sedan|siden|od|da|dal)\s+(?:(?:uber|mehr als|plus de|mas de|over|meer dan|oltre|ponad)\s+)?$/u;

  /** The highest EU-language requirement in already folded text, or null. */
  function euRequiredYears(folded) {
    const t = digitsForYears(folded);
    let max = null;
    for (const field of t.matchAll(FOOTER_RE)) {
      const start = field.index + field[0].length;
      const items = t.slice(start, start + 200).split(/[.!?\n]/)[0];
      for (const item of items.matchAll(FOOTER_ITEM_RE)) {
        const n = Number(item[1].replace(",", "."));
        if (Number.isFinite(n) && n <= MAX_REQUIRED_YEARS && (max == null || n > max)) max = n;
      }
    }
    for (const re of [EU_YEARS_FIRST_RE, EU_EXPERIENCE_FIRST_RE]) {
      for (const match of t.matchAll(re)) {
        const n = Number(match[1].replace(",", "."));
        if (!Number.isFinite(n) || n > MAX_REQUIRED_YEARS) continue;
        const numberAt = match.index + match[0].indexOf(match[1]);
        // The sentence up to the number, and the rest of it after the match
        const lead = t.slice(Math.max(0, numberAt - 100), numberAt).split(/[.!?\n]/).pop();
        const end = match.index + match[0].length;
        const rest = t.slice(end, end + 120).split(/[.!?\n]/)[0];
        if (EU_SINCE_RE.test(lead) || COMPANY_HAS_RE.test(lead)) continue;
        if (
          !REQ_MIN_RE.test(match[0]) &&
          WITH_YEARS_RE.test(lead) &&
          (COMPANY_FIRST_RE.test(lead) || COMPANY_NEXT_RE.test(rest))
        ) {
          continue;
        }
        if (max == null || n > max) max = n;
      }
    }
    return max;
  }

  const EN_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  function requiredYearsFromText(text) {
    // "two years of experience" reads as "2 years of experience", "three to
    // five years" as "3 to 5 years", "between 2 and 4 years" as "2-4 years"
    const s = String(text || "")
      .replace(
        /\b(one|two|three|four|five|six|seven|eight|nine|ten)(?=(?:\s*(?:-|–|to|or)\s*(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+))?[\s-]+(?:\+\s*)?(?:years?|yrs?)\b)/gi,
        (w) => String(EN_NUMBERS[w.toLowerCase()])
      )
      .replace(/\bbetween\s+(\d+(?:[.,]\d+)?)\s+and\s+(\d+(?:[.,]\d+)?)(?=\s+(?:years?|yrs?)\b)/gi, "$1-$2");
    let max = null;
    const consider = (value) => {
      const n = Number(String(value).replace(",", "."));
      if (!Number.isFinite(n) || n > MAX_REQUIRED_YEARS) return;
      if (max == null || n > max) max = n;
    };
    const re = new RegExp(YEARS_RE.source, YEARS_RE.flags);
    let match;
    while ((match = re.exec(s))) {
      const before = s.slice(Math.max(0, match.index - 60), match.index);
      const n = Number(match[1].replace(",", "."));
      const sentence = `${before.split(/[.!?\n]/).pop()} ${
        s.slice(re.lastIndex, re.lastIndex + 80).split(/[.!?\n]/)[0]
      }`;
      const blurb =
        COMPANY_BEFORE_RE.test(before) ||
        (COMBINED_RE.test(match[3] || "") && COMPANY_WORD_RE.test(sentence));
      if (blurb || n > MAX_REQUIRED_YEARS) {
        // Rescan from the skipped "years" (not its number, or "10-12" would
        // re-match "12"): a real requirement may follow
        re.lastIndex = match.index + match[0].search(/years?|yrs?/i) + 1;
        continue;
      }
      consider(match[1]);
    }
    for (const match of s.matchAll(EXPERIENCE_FIRST_RE)) {
      const before = s.slice(Math.max(0, match.index - 80), match.index);
      // "3+ years of experience required – 5+ preferred", "No experience needed – 2 years of training"
      if (
        /^experience\s+(?:required|needed)/i.test(match[0]) &&
        (/\d\s*\+?\s*(?:years?|yrs?)['’]?(?:\s+of)?(?:\s+[a-z][\w+#./-]*){0,6}\s*$/i.test(before) ||
          /\bno\s+(?:prior\s+|previous\s+)?$/i.test(before))
      ) {
        continue;
      }
      // "Experience: 5+ years" starting a line or field is a label, never a blurb
      // ("Our industry experience: 12 years", "deep domain experience - 12 years" aren't labels)
      const label =
        /^experience(?:\s+(?:required|needed))?\s*(?::|-|–|—)/i.test(match[0]) &&
        /(?:^|[\n|•*:.;]|\s-\s)\s*[-•*]?\s*$/.test(before) &&
        !COMPANY_INTRO_RE.test(before);
      const blurb =
        COMPANY_TAKES_RE.test(before) ||
        (COMPANY_SENTENCE_RE.test(before) &&
          !HIRING_RE.test(before.split(/[.!?\n]/).pop()) &&
          !MODIFIER_RE.test(before));
      if (!label && blurb) continue;
      consider(match[1]);
    }
    const eu = euRequiredYears(fold(s));
    if (eu != null) consider(eu);
    return max;
  }

  const LABEL_YEARS_RE = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*\\+?\\s*(?:years?|${EU_YEAR})$`, "u");

  /** Indeed-style attribute labels: "5 years", "1 year", "5 Jahre", "3 ans". */
  function yearsFromExperienceLabels(labels) {
    let max = null;
    for (const label of labels || []) {
      const match = fold(label).trim().match(LABEL_YEARS_RE);
      if (!match) continue;
      const n = Number(match[1].replace(",", "."));
      if (!Number.isFinite(n)) continue;
      if (max == null || n > max) max = n;
    }
    return max;
  }

  // Jobs about contracts, not contract jobs: "Contract Manager",
  // "Contracting Officer", "Smart Contracts Engineer"
  const CONTRACT_ROLE_RE =
    /\bcontract(?:s|ing)?\s+(?:manager|management|specialist|administrator|administration|analyst|negotiator|coordinator|officer|compliance)\b|\bsmart\s+contracts?\b/g;

  // Jobs about these types, not of them: "Ausbildungsleiter", "Stage Manager",
  // "Lead (Early-Stage Startup)", "Stage & Events Manager", "intern/extern"
  // and "(intern)" (internal), "Teilzeit möglich", "Werkstudent möglich" (options)
  const TYPE_ROLE_RE = new RegExp(
    `${NB}(?:ausbildungs(?:leit|beauftragt|koordinat|referent)\\p{L}*|ausbilder\\p{L}*|praktikumsbetreu\\p{L}*|werkstudentenbetreu\\p{L}*|stage\\s+(?:manager|management|director|designer|technician|hand)\\p{L}*|stage\\s*(?:&|and|und|et)\\s*events?|(?:early|late|growth|seed|multi|later|pre|post|ipo|series\\s+[a-e]|scale[\\s-]?up|start[\\s-]?up)[\\s-]+stage|internship\\s+(?:program\\s+)?(?:coordinator|manager)|kontrakt(?:acj|manag|styr|hanter)\\p{L}*|intern(?:e)?\\s*(?:&|und|and|en|et|/)\\s*extern\\p{L}*|intern(?:e)?\\s+(?:communicatie\\p{L}*|kommunikation\\p{L}*|kommunikasjon\\p{L}*|communication\\p{L}*)|(?:adviseur|medewerker|specialist|coordinator|consultant|manager|kommunikat\\p{L}*|communicatie\\p{L}*|kommunikasjon\\p{L}*)\\s+intern(?:e)?|teilzeit(?:modelle?)?\\s+(?:moglich|denkbar|optional)|(?:auch\\s+)?(?:als\\s+)?(?:werkstudent\\p{L}*|praktikum)\\s+(?:moglich|denkbar)|(?:auch\\s+)?in\\s+teilzeit\\s+moglich|part[\\s-]?time\\s+(?:possible|available|optional))${NA}|\\(intern\\)`,
    "gu"
  );
  // Dutch and Romanian use "contract" for any employment contract: these are
  // employee jobs ("vast contract", "contract voor 12 maanden", "contract de muncă")
  const EMPLOYEE_CONTRACT_RE = new RegExp(
    `${NB}(?:(?:vast|vaste|tijdelijk|tijdelijke)\\s+contract|contract\\s+voor\\s+(?:\\d+|een|1)\\s+(?:jaar|maand|maanden)|contract\\s+voor\\s+(?:on)?bepaalde\\s+tijd|contract\\s+met\\s+uitzicht\\s+op\\s+(?:een\\s+)?vast\\p{L}*|contract\\s+(?:individual\\s+)?de\\s+munca|contract\\s+pe\\s+(?:perioada|durata)\\s+(?:ne)?determinata|(?:fixed[\\s-]?term|permanent|temporary)\\s+contract)${NA}`,
    "gu"
  );
  // Employee jobs, permanent or fixed-term: full time unless the job says otherwise
  const EMPLOYEE_WORDS =
    "festanstellung|unbefristet\\p{L}*|befristet\\p{L}*|cdi|cdd|contrat a duree (?:in)?determinee|contrato indefinido|tempo (?:in)?determinato|vaste baan|onbepaalde tijd|bepaalde tijd|umowa o prace|uop|vikariat|vikarie|elternzeitvertretung|mutterschutzvertretung|krankheitsvertretung|conge maternite|fast anstallning|tillsvidareanstallning|visstidsanstallning|fastansaettelse|fast stilling|fast ansettelse|vakituinen|maaraaikainen|hatarozatlan ideju|hatarozott ideju|αοριστου χρονου|ορισμενου χρονου";
  const PERMANENT_RE = words(`permanent|fixed[\\s-]?term|temporal|indefinido|${EMPLOYEE_WORDS}`);
  // In descriptions "permanent" and "fixed term" count only as a kind of job
  // ("permanent residents", "temporal data" aren't)
  const PERMANENT_DESC_RE = words(
    `(?:permanent|fixed[\\s-]?term)\\s+(?:position|role|contract|employment|job|basis|post|hire)|${EMPLOYEE_WORDS}`
  );
  // Full time in EU languages; "Voll- oder Teilzeit" is either
  const EU_FULLTIME_RE = words(
    "vollzeit\\p{L}*|voll[\\s-]+(?:(?:oder|und|bzw\\.?)\\s+)?teilzeit|temps (?:plein|complet)|plein temps|jornada completa|tiempo completo|tempo (?:pieno|integral)|voltijd\\p{L}*|pelny etat|pelen etat|pelnym etacie|heltid\\p{L}*|fuldtid\\p{L}*|kokoaikai\\p{L}*|plny uvazek|plnym uvazkem|teljes munkaido\\p{L}*|norma intreaga|tempo inteiro|periodo integral|πληρησ απασχοληση"
  );
  // Freelance / self-employed, in titles and listing types. "B2B" alone is a
  // product word, only "umowa B2B" is a contract
  const EU_CONTRACT_RE = words(
    "freiberuf\\p{L}*|freie[rn]? mitarbeit\\p{L}*|honorarbasis|selbststandig\\p{L}*|independant\\p{L}*|auto[\\s-]?entrepreneur\\p{L}*|portage salarial|autonomo|autonoma|partita iva|libero professionista|zzp\\p{L}*|interim|(?:umowa|kontrakt|wspolpraca|forma wspolpracy|forma zatrudnienia)\\s*:?\\s*b2b|b2b\\s+(?:contract|kontrakt|umowa)|umowa (?:zlecenie|o dzielo)|frilans\\p{L}*|konsultuppdrag|zivnostensk\\p{L}*|vallalkozoi szerzodes|recibos verdes|pfa|na ico|fractional|de transition|uop\\s*(?:lub|i|or)?\\s*b2b|b2b\\s*(?:lub|i|or)?\\s*uop"
  );
  // Polish "kontrakt" is the bare word "contract"
  const EU_BARE_CONTRACT_RE = words("kontrakt");
  // In descriptions only explicit phrases count: footers carry VAT numbers
  // ("Partita IVA 0123…", "con Partita IVA: IT0123…"), "we brief our
  // freelancers" isn't a freelance job, nor is "experience as a freelancer"
  const CONTRACT_PHRASE_RE = words(
    "contract (?:role|position|job|opportunity|opening|basis)|(?:job|employment|position) type\\s*[:\\-]?\\s*contract|freelance (?:role|position|basis|contract|project|mission)|(?:work|working|join|joining|hire|hiring|engage|engaged|contracted|paid) (?:\\p{L}+ ){0,2}as an? (?:freelancer|contractor)|contractor (?:role|position)|contract[\\s-]?to[\\s-]?hire|auf (?:freiberuflich\\p{L}*|freelancer\\p{L}*|honorar)\\s*(?:basis)?|(?:arbeitest|arbeiten|tatig|beschaftigt|unterstutzt|unterstutzen|zusammenarbeit) (?:\\p{L}+ ){0,3}als (?:freelancer\\p{L}*|freie[rn]? mitarbeiter\\p{L}*)|freiberufliche (?:tatigkeit|zusammenarbeit|basis|mitarbeit)|auf honorarbasis|(?:poste|mission|travailler|travail|statut) (?:en )?freelance|statut (?:d )?(?:independant|auto[\\s-]?entrepreneur)|como autonomo|en regimen de autonomos?|(?:con|in|regime di|aprire la|apertura) partita iva(?!\\s*[:.]?\\s*(?:it)?\\s*\\d)|als zzp\\p{L}*|op zzp[\\s-]?basis|(?:umowa|kontrakt|wspolpraca|forma wspolpracy|forma zatrudnienia)\\s*:?\\s*b2b|na (?:zasadach|podstawie) b2b"
  );
  // Part time
  const EU_PARTTIME_RE = words(
    "per diem|teilzeit\\p{L}*|minijob\\p{L}*|temps partiel|mi[\\s-]?temps|tiempo parcial|media jornada|jornada parcial|deeltijd\\p{L}*|niepelny etat|pol etatu|tempo parcial|deltid\\p{L}*|osa[\\s-]?aikai\\p{L}*|castecny uvazek|zkraceny uvazek|reszmunkaido\\p{L}*|norma partiala|jumatate de norma|μερικη απασχοληση"
  );
  // Trainee and short jobs: internships, apprenticeships, working students,
  // temp-agency, seasonal and volunteer work
  const EU_TRAINEE_RE = words(
    "apprentice\\p{L}*|traineeships?|working student|seasonal|volunteer|\\p{L}*praktikum\\p{L}*|praktikant\\p{L}*|werkstudent\\p{L}*|ausbildung|ausbildungsplatz|ausbildungsstelle|azubi\\p{L}*|volontariat|duales studium|aushilfe\\p{L}*|stage|stages|stagiaire\\p{L}*|alternance|alternant\\p{L}*|apprenti|apprentie|apprentis|apprentissage|contrat de professionnalisation|interimaire\\p{L}*|studentenjob|studentjob|studentenbaan|interimjob|interimkantoor|interimbureau|uitzendbureau|uitzendwerk|saisonnier\\p{L}*|job etudiant|practicas|becari[oa]s?|beca|tirocin\\p{L}*|stagista|stagisti|apprendista|apprendistato|stagiair\\p{L}*|afstudeerstage|bijbaan|uitzendkracht\\p{L}*|staz|stazysta\\p{L}*|praktyki|praktykant\\p{L}*|estagio|estagiari[oa]s?|praktik|sommarjobb|studiejob|student\\p{L}*medhj\\p{L}*|\\p{L}*elev|sommerjobb|laerling\\p{L}*|harjoittel\\p{L}*|kesatyo\\p{L}*|oppisopimus\\p{L}*|brigad\\p{L}*|gyakornok\\p{L}*|diakmunka|stagiu|stagiar\\p{L}*|πρακτικη ασκηση"
  );

  // Swiss workload in titles: "80-100%" is full or part time, "60%" part time.
  // A single percentage counts only at the end of the title or a part of it
  // ("+ 15% Bonus", "25% travel", "100% da remoto" are something else)
  const NOT_WORKLOAD = "(?!\\s*(?:home|remote|online|telet|remoto|da remoto|en remoto|a distance|thuiswerk|praca zdalna|zdal|telearbeit|mobil|smart|bonus|travel|reise|office|buro|equity))";
  const PENSUM_RES = [
    new RegExp(`(?<![\\d.,])(\\d{2,3})\\s*%?\\s*(?:-|–|bis|a)\\s*(\\d{2,3})\\s*%${NOT_WORKLOAD}`, "gu"),
    new RegExp(`(?<![\\d.,%]\\s*(?:-|–|bis|a)?\\s*)(?<![\\d.,])(\\d{2,3})\\s*%()(?=\\s*(?:$|[),|/]))`, "gu"),
    new RegExp(`(?:pensum|arbeitspensum|beschaftigungsgrad|taux d activite|taux|workload)\\s*:?\\s*(\\d{2,3})\\s*%()`, "gu"),
  ];
  // Indeed's posting footer names the type: "Job Types: Part-time", "Type d'emploi : CDI"
  const TYPE_FIELD_RE =
    /(?:job types?|type d['’ ]?emploi|type de contrat|art der (?:stelle|anstellung)|anstellungsart|beschaftigungsart|tipo de (?:empleo|puesto|contrato)|tipo di (?:impiego|contratto)|soort dienstverband|rodzaj (?:umowy|zatrudnienia)|typ (?:umowy|uvazku)|tipo de vaga|anstallningsform|ansaettelsesform|ansettelsesform)\s*:\s*([^.;|\n]{1,80})/gu;
  // French "intérim" is temp-agency work; English "Interim Manager" and French
  // "par intérim" (acting) are not
  const FR_INTERIM_RE = /(?<!(?:par|en)\s)intérim(?:aire)?s?/giu;

  /**
   * Kinds: "fulltime", "contract", "other" (part time) and "trainee"
   * (internships, apprenticeships, working students, temp, seasonal, volunteer).
   * @param {string} text
   * @param {{ bareContract?: boolean, other?: boolean }} [opts]
   *   bareContract false and other false: read as a description (explicit phrases only)
   */
  function employmentKinds(text, opts = {}) {
    const bareContract = opts.bareContract !== false;
    const other = opts.other !== false;
    const s = fold(String(text || "").normalize("NFC").replace(FR_INTERIM_RE, "interimaire"))
      .replace(CONTRACT_ROLE_RE, " ")
      .replace(TYPE_ROLE_RE, " ")
      .replace(/[_/]+/g, " ")
      .replace(EMPLOYEE_CONTRACT_RE, " permanent ");
    const kinds = new Set();
    if (/\bfull[\s-]?time\b|\bfulltime\b/.test(s) || EU_FULLTIME_RE.test(s)) kinds.add("fulltime");
    if (
      bareContract
        ? /\b(?:contractors?|contracting|contracts?|freelance\w*|contract[\s-]?to[\s-]?hire)\b/.test(s) ||
          EU_CONTRACT_RE.test(s) ||
          EU_BARE_CONTRACT_RE.test(s)
        : CONTRACT_PHRASE_RE.test(s)
    ) {
      kinds.add("contract");
    }
    if (other) {
      if (/\b(?:part[\s-]?time|parttime)\b/.test(s) || EU_PARTTIME_RE.test(s)) kinds.add("other");
      if (/\b(?:intern(?:ship)?s?|temporary|temp)\b/.test(s) || EU_TRAINEE_RE.test(s)) kinds.add("trainee");
    }
    if (bareContract) {
      for (const re of PENSUM_RES) {
        for (const [, lo, hi] of s.matchAll(re)) {
          if (Number(hi || lo) >= 100) kinds.add("fulltime");
          if (Number(lo) < 90) kinds.add("other");
        }
      }
    } else {
      for (const [, field] of s.matchAll(TYPE_FIELD_RE)) {
        for (const kind of employmentKinds(field)) kinds.add(kind);
      }
    }
    // Permanent or fixed-term: an employee job, so full time unless it says part time
    if (!kinds.has("other") && !kinds.has("trainee") && (bareContract ? PERMANENT_RE : PERMANENT_DESC_RE).test(s)) {
      kinds.add("fulltime");
    }
    return [...kinds];
  }

  function detectEmployment(job) {
    // The listing type and the title together ("Full-time" on a "Werkstudent" title)
    const kinds = new Set([
      ...employmentKinds(job?.listing_type || ""),
      ...employmentKinds(job?.title || ""),
    ]);
    if (kinds.size) return [...kinds];
    // Descriptions say "contract" in passing. Only count explicit type phrases.
    return employmentKinds(job?.description || "", {
      bareContract: false,
      other: false,
    });
  }

  /**
   * jobType "fulltime", "contract" or "both" (either one). Part-time jobs go
   * unless they also say the wanted type; trainee jobs (internships,
   * apprenticeships, working students, temp, seasonal) always go.
   */
  function matchesEmployment(job, jobType) {
    const wanted =
      jobType === "both"
        ? ["fulltime", "contract"]
        : jobType === "contract" || jobType === "fulltime"
          ? [jobType]
          : [];
    if (!wanted.length) return true;
    const kinds = detectEmployment(job);
    if (!kinds.length) return true;
    if (kinds.includes("trainee")) return false;
    return kinds.some((k) => wanted.includes(k));
  }

  /** Keep the job when it asks for years <= userYears + 0.5. Unstated years stay. */
  function withinExperience(job, years) {
    if (years == null || years === "") return true;
    const limit = Number(years) + 0.5;
    if (!Number.isFinite(limit)) return true;
    const required = job?.years_required;
    if (required == null || required === "") return true;
    const n = Number(required);
    if (!Number.isFinite(n)) return true;
    return n <= limit + 1e-9;
  }

  globalThis.jbRequiredYearsFromText = requiredYearsFromText;
  globalThis.jbYearsFromExperienceLabels = yearsFromExperienceLabels;
  globalThis.jbEmploymentKinds = employmentKinds;
  globalThis.jbMatchesEmployment = matchesEmployment;
  globalThis.jbWithinExperience = withinExperience;
})();
