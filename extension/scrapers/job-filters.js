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
    /(?:\b(?:at least|minimum(?: of)?|min\.?)\s+)?(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?(?:\s*\+|\s+or\s+more|\s+plus)?\s*(?:years?|yrs?)['’]?(?:\s+of)?((?:\s+\.?[a-z][a-z0-9+#./-]*[a-z0-9+#]){0,6}?)\s+experience\b/gi;
  const EXPERIENCE_FIRST_RE =
    /\bexperience(?:\s+(?:required|needed))?\s*(?::|-|–|—|\bof\b)\s*(?:(?:at least|minimum(?: of)?|min\.?)\s+)?(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?)?(?:\s*\+|\s+or\s+more|\s+plus)?\s*(?:years?|yrs?)\b/gi;
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

  // Year words: Jahre, ans, años, anni, jaar, lat/lata, år/års, vuotta, roky/let, év, ani, χρόνια/ετών
  const EU_YEAR =
    "jahre|jahren|jahr|jahres|ans|an|annees|annee|anos|ano|anni|anno|jaar|jaren|lat|lata|roku|rok|roky|let|ar|ars|vuotta|vuoden|vuosi|ev|eves|ani|χρονια|χρονων|ετη|ετων|letni\\p{L}*";
  // Experience words, German and Dutch ones also inside compounds (Berufserfahrung, werkervaring)
  const EU_EXP =
    "\\p{L}*erfahrung\\p{L}*|experience|experiencia|esperienza|experienta|\\p{L}*ervaring|doswiadcz\\p{L}*|erfarenhet\\p{L}*|erfaring\\p{L}*|kokemus\\p{L}*|praxe|praxi|zkusenost\\p{L}*|\\p{L}*tapasztalat\\p{L}*|εμπειρια\\p{L}*";
  // "mindestens", "au moins", "al menos", "almeno", "minimaal", "co najmniej", "minst", "vähintään"…
  const EU_MIN =
    "mindestens|min\\.?|minimum|minimal|minimaal|minimo|minima|minim|minst|vahintaan|legalabb|au moins|al menos|almeno|ten minste|tenminste|co najmniej|przynajmniej|alespon|nejmene|mehr als|plus de|mas de|piu di|meer dan|ponad|uber|ueber|oltre|cel putin|τουλαχιστον";
  const EU_RANGE = "-|–|—|bis|a|al|tot|do|till|til|to|ate";
  const EU_MORE =
    "oder mehr|ou plus|o mas|o piu|of meer|lub wiecej|eller mer|eller mere|tai enemman|vagy tobb|sau mai mult";
  const NUM = "(\\d+(?:[.,]\\d+)?)";
  // "3+ Jahre Berufserfahrung", "3 ans d'expérience", "minimaal 3 jaar werkervaring", "3-letnie doświadczenie"
  const EU_YEARS_FIRST_RE = new RegExp(
    `${NB}(?:(?:${EU_MIN})\\s+)?${NUM}(?:\\s*(?:${EU_RANGE})\\s*\\d+(?:[.,]\\d+)?)?(?:\\s*\\+|\\s+(?:${EU_MORE}))?\\s*-?\\s*(?:${EU_YEAR})${NA}(?:\\s+(?:de|d['’]|di|van|av|af|z|ze))?(?:\\s*[\\p{L}'’+#/-]+){0,6}?\\s*(?:${EU_EXP})${NA}`,
    "gu"
  );
  // "Berufserfahrung von mindestens 3 Jahren", "expérience de 3 ans minimum", "doświadczenie min. 3 lata"
  const EU_EXPERIENCE_FIRST_RE = new RegExp(
    `${NB}(?:${EU_EXP})${NA}(?:\\s+[\\p{L}'’]+){0,4}?\\s*(?:[:–—-]\\s*)?(?:(?:${EU_MIN})\\s+)?${NUM}(?:\\s*(?:${EU_RANGE})\\s*\\d+(?:[.,]\\d+)?)?(?:\\s*\\+)?\\s*-?\\s*(?:${EU_YEAR})${NA}`,
    "gu"
  );
  // The company speaking about itself ("Wir blicken auf 10 Jahre Erfahrung", "notre agence…")…
  const EU_COMPANY_RE = words(
    "wir|unser\\p{L}*|uns|nous|notre|nos|nosotros|nosotras|nuestr\\p{L}*|noi|nostr\\p{L}*|wij|onze|ons|nasz\\p{L}*|vi|var|vart|vara|vores|me|meidan|nase\\p{L}*|nosso|nossa|nossos|nossas|μας|εμεις|unternehmen|entreprise|empresa|azienda|bedrijf|agentur|agence|agencia|agenzia"
  );
  // …unless the sentence asks something of the reader ("Wir suchen …", "Du bringst …")
  const EU_HIRING_RE = words(
    "du|dich|dein\\p{L}*|ihr|vous|votre|tu|ton|tienes|cuentas|hai|possiedi|je|jij|masz|posiadasz|har du|sinulla|candidat\\p{L}*|bewerber\\p{L}*|kandydat\\p{L}*|profil|anforderung\\p{L}*|voraussetzung\\p{L}*|exigences|requisitos|requisiti|vereisten|wymagania|krav|vaatimukset|pozadavky|cerinte|απαιτησεις|suchen|recherch\\p{L}*|buscamos|cerchiamo|zoeken|szukamy|soker|etsimme|hledame|keresunk|cautam|αναζητουμε|mitbring\\p{L}*|bringst|verfugst|hast|besitzt|disposez|possedez|avez|beschik\\p{L}*|rendelkez\\p{L}*"
  );
  // "seit über 20 Jahren", "depuis plus de 15 ans", "desde hace 10 años": company history
  const EU_SINCE_RE =
    /(?:seit|depuis|desde(?: hace)?|sinds|sedan|siden|od|da|dal)\s+(?:(?:uber|mehr als|plus de|mas de|over|meer dan|oltre|ponad)\s+)?$/u;

  /** The highest EU-language requirement in already folded text, or null. */
  function euRequiredYears(t) {
    let max = null;
    for (const re of [EU_YEARS_FIRST_RE, EU_EXPERIENCE_FIRST_RE]) {
      for (const match of t.matchAll(re)) {
        const n = Number(match[1].replace(",", "."));
        if (!Number.isFinite(n) || n > MAX_REQUIRED_YEARS) continue;
        const numberAt = match.index + match[0].indexOf(match[1]);
        const before = t.slice(Math.max(0, match.index - 80), match.index);
        if (EU_SINCE_RE.test(t.slice(Math.max(0, numberAt - 40), numberAt))) continue;
        const sentence = `${before.split(/[.!?\n]/).pop()} ${t.slice(match.index, match.index + match[0].length)}`;
        if (EU_COMPANY_RE.test(sentence) && !EU_HIRING_RE.test(sentence)) continue;
        if (max == null || n > max) max = n;
      }
    }
    return max;
  }

  function requiredYearsFromText(text) {
    const s = String(text || "");
    let max = null;
    const consider = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n > MAX_REQUIRED_YEARS) return;
      if (max == null || n > max) max = n;
    };
    const re = new RegExp(YEARS_RE.source, YEARS_RE.flags);
    let match;
    while ((match = re.exec(s))) {
      const before = s.slice(Math.max(0, match.index - 60), match.index);
      const n = Number(match[1]);
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
  // "Marketing Lead (Early-Stage Startup)"
  const TYPE_ROLE_RE = new RegExp(
    `${NB}(?:ausbildungs(?:leit|beauftragt|koordinat|referent)\\p{L}*|ausbilder\\p{L}*|praktikumsbetreu\\p{L}*|werkstudentenbetreu\\p{L}*|stage\\s+(?:manager|management|director|designer|technician|hand)\\p{L}*|(?:early|late|growth|seed|multi|later|pre|post)[\\s-]+stage|internship\\s+(?:coordinator|manager))${NA}`,
    "gu"
  );
  // Full time in EU languages; "Voll- oder Teilzeit" is either
  const EU_FULLTIME_RE = words(
    "vollzeit\\p{L}*|voll[\\s-]+(?:(?:oder|und|bzw\\.?)\\s+)?teilzeit|temps (?:plein|complet)|plein temps|jornada completa|tiempo completo|tempo (?:pieno|integral)|voltijd\\p{L}*|pelny etat|pelen etat|pelnym etacie|heltid\\p{L}*|fuldtid\\p{L}*|kokoaikai\\p{L}*|plny uvazek|plnym uvazkem|teljes munkaido\\p{L}*|norma intreaga|πληρης απασχοληση"
  );
  // Freelance / self-employed. "B2B" alone is a marketing word, only "umowa B2B" is a contract
  const EU_CONTRACT_RE = words(
    "freiberuf\\p{L}*|freie[rn]? mitarbeit\\p{L}*|honorarbasis|selbststandig\\p{L}*|independant\\p{L}*|auto[\\s-]?entrepreneur\\p{L}*|portage salarial|autonomo|autonoma|partita iva|libero professionista|zzp\\p{L}*|interim|(?:umowa|kontrakt|wspolpraca|forma wspolpracy|forma zatrudnienia)\\s*:?\\s*b2b|b2b\\s+(?:contract|kontrakt|umowa)|umowa (?:zlecenie|o dzielo)|frilans\\p{L}*|konsultuppdrag|zivnostensk\\p{L}*|vallalkozoi szerzodes"
  );
  // Polish "kontrakt" is the bare word "contract"
  const EU_BARE_CONTRACT_RE = words("kontrakt");
  // Part-time, internships, apprenticeships, working students, temp and seasonal work
  const EU_OTHER_RE = words(
    "apprentice\\p{L}*|working student|seasonal|per diem|volunteer|teilzeit\\p{L}*|praktikum\\p{L}*|praktikant\\p{L}*|werkstudent\\p{L}*|ausbildung\\p{L}*|azubi\\p{L}*|duales studium|minijob\\p{L}*|aushilfe\\p{L}*|temps partiel|mi[\\s-]?temps|stage|stages|stagiaire\\p{L}*|alternance|alternant\\p{L}*|apprenti|apprentie|apprentis|apprentissage|contrat de professionnalisation|interimaire\\p{L}*|saisonnier\\p{L}*|job etudiant|tiempo parcial|media jornada|jornada parcial|practicas|becari[oa]s?|beca|tirocin\\p{L}*|stagista|stagisti|apprendista|apprendistato|deeltijd\\p{L}*|stagiair\\p{L}*|afstudeerstage|bijbaan|uitzendkracht\\p{L}*|niepelny etat|pol etatu|staz|stazysta\\p{L}*|praktyki|praktykant\\p{L}*|tempo parcial|estagio|estagiari[oa]s?|deltid\\p{L}*|praktik|sommarjobb|studiejob|studentmedhjelper|sommerjobb|laerling\\p{L}*|osa[\\s-]?aikai\\p{L}*|harjoittel\\p{L}*|kesatyo\\p{L}*|oppisopimus\\p{L}*|castecny uvazek|zkraceny uvazek|brigad\\p{L}*|reszmunkaido\\p{L}*|gyakornok\\p{L}*|diakmunka|stagiu|stagiar\\p{L}*|μερικη απασχοληση|πρακτικη ασκηση"
  );

  /**
   * @param {string} text
   * @param {{ bareContract?: boolean, other?: boolean }} [opts]
   */
  function employmentKinds(text, opts = {}) {
    const bareContract = opts.bareContract !== false;
    const other = opts.other !== false;
    const s = fold(text)
      .replace(/[_/]+/g, " ")
      .replace(CONTRACT_ROLE_RE, " ")
      .replace(TYPE_ROLE_RE, " ");
    const kinds = new Set();
    if (/\bfull[\s-]?time\b|\bfulltime\b/.test(s) || EU_FULLTIME_RE.test(s)) kinds.add("fulltime");
    if (
      /\b(?:contractors?|contracting|freelance|c2c|1099|contract[\s-]?to[\s-]?hire)\b/.test(
        s
      ) ||
      EU_CONTRACT_RE.test(s) ||
      (bareContract && (/\bcontract\b/.test(s) || EU_BARE_CONTRACT_RE.test(s))) ||
      // Dice lists the type as "CONTRACTS"
      /^\s*contracts\s*$/.test(s) ||
      (!bareContract &&
        /\bcontract\s+(?:role|position|job|opportunity|opening)\b/.test(s)) ||
      (!bareContract &&
        /\b(?:job|employment|position)\s+type\s*[:\-]?\s*contract\b/.test(s))
    ) {
      kinds.add("contract");
    }
    if (
      other &&
      (/\b(?:part[\s-]?time|parttime|intern(?:ship)?|temporary|temp)\b/.test(s) ||
        EU_OTHER_RE.test(s))
    ) {
      kinds.add("other");
    }
    return [...kinds];
  }

  function detectEmployment(job) {
    const listing = employmentKinds(job?.listing_type || "");
    if (listing.length) return listing;
    const title = employmentKinds(job?.title || "");
    if (title.length) return title;
    // Descriptions say "contract" in passing. Only count explicit type phrases.
    return employmentKinds(job?.description || "", {
      bareContract: false,
      other: false,
    });
  }

  /** jobType "fulltime", "contract" or "both" (either one; part-time and internships go). */
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
