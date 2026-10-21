/**
 * "Is this job title a software-development role?" in EU languages, for runs
 * with no Title. Plain script (no import/export) so it can be injected via
 * chrome.scripting.executeScript({ files }) after title-match.js, whose
 * normalizer it uses: lowercase, no accents, punctuation as spaces, and the
 * EU words for developer, engineer and software as the English ones
 * ("Softwareentwickler" = "software developer", "Ingénieur logiciel" =
 * "engineer software", "Mjukvaruingenjör" = "software engineer").
 *
 * A title is a developer role when it names one and nothing makes it another
 * kind of job:
 *   1. never: developers of businesses, property, land, products, people,
 *      policy, course content or events ("Projektentwickler",
 *      "forretningsudvikler", "Développeur foncier", "Curriculum Developer",
 *      "Music Programmer"), developer relations, sales / solutions / support /
 *      security / network engineers, marketing, design and teaching;
 *   2. hardware, machine programming (PLC, CNC), other engineering
 *      disciplines, renewable-energy projects and manual testing only with a
 *      software word ("Firmware-/Elektronikentwickler");
 *   3. developer, programmer, DevOps, SRE, frontend/backend/fullstack, mobile,
 *      test automation, CTO, tech lead… always count, but Finnish kehittäjä
 *      and Hungarian fejlesztő alone need a software word;
 *   4. engineers and architects count next to a software word ("Data
 *      Engineer", "Cloud Architect", "Ingénieur systèmes embarqués");
 *   5. trainees and specialists named after a programming language count
 *      ("Werkstudent Java", "PL/SQL Specialist").
 */
(function () {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word edges in a normalized title, whose words are single-space separated
  const NB = "(?:^| )";
  const NA = "(?= |$)";
  const alt = (list) => list.map(esc).join("|");
  const inside = (list) => new RegExp(`(?:${alt(list)})`, "u");
  const words = (list) => new RegExp(`${NB}(?:${alt(list)})${NA}`, "u");
  const pattern = (source) => new RegExp(source, "u");
  const any = (...res) => ({ test: (s) => res.some((re) => re.test(s)) });

  // Programming languages, for trainees and specialists and as words that name
  // software work (Go and Swift are left out: "Go-to-Market", SWIFT payments)
  const LANGUAGES = [
    "java",
    "python",
    "javascript",
    "typescript",
    "php",
    "c#",
    "c++",
    "rust",
    "ruby",
    "scala",
    "kotlin",
    "dotnet",
    "pl sql",
    "plsql",
    "t sql",
    "abap",
    "cobol",
    "perl",
    "elixir",
    "haskell",
    "delphi",
  ];

  // Developers of something other than software. German, Dutch, Nordic,
  // Finnish and Hungarian compounds ("Projektentwickler", "projectontwikkelaar",
  // "verksamhetsutvecklare", "palvelukehittäjä", "üzletfejlesztő") read as
  // "<stem> developer"…
  const OTHER_DEVELOPER_STEMS = [
    // business
    "biznis",
    "geschafts",
    "unternehmens",
    "bedrijfs",
    "forretnings",
    "affars",
    "verksamhets",
    "liiketoiminnan",
    "toiminnan",
    "uzlet",
    // property, land and projects
    "projekt",
    "project",
    "prosjekt",
    "immobilien",
    "vastgoed",
    "gebieds",
    "eiendoms",
    "fastighets",
    "ingatlan",
    "stadt",
    "stads",
    "regional",
    // products and services
    "produkt",
    "product",
    "tuote",
    "termek",
    "bekleidungs",
    "lederwaren",
    "textil",
    "schuh",
    "lebensmittel",
    "palvelu",
    "tjeneste",
    "kozmetik",
    "kosmetik",
    "parfum",
    "duft",
    "tartalom",
    // people, organisations, policy and teaching
    "personal",
    "personnel",
    "organisation",
    "organization",
    "organisatie",
    "szervezet",
    "kompetenz",
    "kompetens",
    "fag",
    "beleids",
    "onderwijs",
    "tanterv",
    "paedagogisk",
    "padagogisch",
    "sosiaalityon",
    "tehetseg",
    // events and the arts ("concertprogrammeur")
    "concert",
    "konzert",
    "muziek",
    "musik",
    "theater",
    "festival",
  ];
  // …or say so in a word before it ("Content Developer", "Land Developer",
  // "Music Programmer")…
  const OTHER_DEVELOPER_BEFORE = [
    "business",
    "property",
    "real estate",
    "land",
    "plan",
    "team",
    "content",
    "curriculum",
    "course",
    "courseware",
    "training",
    "instructional",
    "e learning",
    "elearning",
    "lesson",
    "formulation",
    "recipe",
    "flavour",
    "flavor",
    "fund",
    "account",
    "market",
    "brand",
    "talent",
    "people",
    "leadership",
    "cosmetic",
    "cosmetics",
    "fragrance",
    "music",
    "radio",
    "venue",
    "club",
    "event",
    "events",
    "arts",
    "artistic",
    "cultural",
    "theatre",
  ];
  // …or after it, mostly in Romance languages ("Développeur foncier",
  // "Développeur de projets", "Sviluppatore di prodotti", "Programador cultural",
  // "Programator producție", "Utvikler bolig")
  const OTHER_DEVELOPER_AFTER = [
    "foncier",
    "fonciere",
    "territorial",
    "territoriale",
    "commercial",
    "commerciale",
    "comercial",
    "reseau",
    "reseaux",
    "immobilier",
    "inmobiliario",
    "imobiliar",
    "bolig",
    "productie",
    "productiei",
    "produccion",
    "produzione",
    "παραγωγησ",
    "de projets",
    "de projet",
    "de proyectos",
    "de negocio",
    "de negocios",
    "d affaires",
    "de afaceri",
    "afaceri",
    "de eventos",
    "eventos",
    "di eventi",
    "produit",
    "produits",
    "de produits",
    "prodotto",
    "prodotti",
    "di prodotto",
    "di prodotti",
    "de producto",
    "de productos",
    "de e learning",
    "e learningu",
    "af e laering",
    "cultural",
    "culturel",
    "culturale",
    "artistico",
    "artistica",
    "artistique",
    "teatrale",
    "musicale",
  ];

  const EXCLUDE = any(
    words([
      "business development",
      "sales engineer",
      "presales engineer",
      "pre sales engineer",
      "solutions engineer",
      "solution engineer",
      "field engineer",
      "service engineer",
      "field service engineer",
      "support engineer",
      "implementation engineer",
      "application engineer",
      "applications engineer",
      "applikations engineer",
      "customer engineer",
      "onboarding engineer",
      "sales development",
      "localization engineer",
      "localisation engineer",
      "software support",
      "softwaresupport",
      "software sales",
      "softwarevertrieb",
      // developer relations
      "advocate",
      "advocates",
      "evangelist",
      "evangelists",
      "devrel",
    ]),
    pattern(`${NB}(?:${alt(OTHER_DEVELOPER_STEMS)})\\p{L}* developer`),
    pattern(`${NB}(?:${alt(OTHER_DEVELOPER_BEFORE)}) (?:developers?|programmers?)${NA}`),
    pattern(`${NB}developer(?: e| se| euse)? (?:${alt(OTHER_DEVELOPER_AFTER)})${NA}`),
    // Developer relations: "developer" names the audience ("Developer Advocate",
    // "Head of Developer Relations", "Developer Experience Engineer")
    pattern(
      `${NB}developer (?:relations?|advocates?|advocacy|evangelists?|experience|marketing|content|community|education|educators?|success|outreach|enablement|programs?|programmes?|ecosystem)${NA}`
    ),
    // Sales engineers in other languages ("Vertriebsingenieur", "Salgsingeniør",
    // "Ingénieur commercial", "Ingeniero de ventas")
    pattern(
      `${NB}(?:vertriebs|salgs|salj|myynti|kereskedelmi) engineer${NA}|${NB}engineer(?: e| a)? (?:commercial|commerciale|comercial|d affaires|de ventas|ventas|vendite|sprzedazy|de vanzari|vanzari|πωλησεων)${NA}`
    ),
    // IT operations: security and network engineers ("Cloud Security Engineer",
    // "Netzwerkingenieur", "Ingénieur réseaux"), unless they secure software
    // ("Application Security Engineer")
    pattern(
      `(?<!application|product|software|appsec)${NB}(?:security|cybersecurity|network|netzwerk|netwerk|sitovy) (?:engineers?|architects?)${NA}|${NB}engineer(?: e| a)? (?:de |en |di )?(?:securite|seguridad|sicurezza|bezpieczenstwa|reseaux?|redes|rete|sieci)${NA}`
    ),
    // Marketing jobs at software companies: "Growth Marketing Manager (AI Software)"
    pattern(`${NB}(?:marketing|growth|content|brand|communications?) (?:manager|specialist|lead|director|executive)${NA}`),
    // Not building software
    pattern(
      `designer|${NB}(?:recruit\\p{L}*|teacher|lecturer|dozent\\p{L}*|trainer|tutor)${NA}|${NB}(?:sales|account executive|account manager)${NA}`
    )
  );

  // Test automation in either word order ("Testautomatisierung", "testiautomaatio",
  // "QA Automation", "Automation Tester", "automatyzacji testów",
  // "automazione dei test")
  const TEST_AUTOMATION = pattern(
    `${NB}(?:qa|tests?|testing|testi|teszt) ?automa|${NB}automa\\p{L}*(?: (?:de|des|dei|di|do|of))? (?:qa|tests?|testing|testers?|testow|testu|testes|pruebas|teszt\\p{L}*)${NA}`
  );

  // Words that name software work, for the fields below
  const CODE = any(words(["software", "firmware", "frontend", "backend", "fullstack", "devops", "rpa", ...LANGUAGES]), TEST_AUTOMATION);

  // Hardware, machines, other engineering disciplines, energy projects and
  // manual testing: another job unless the title also names software
  // ("Firmware-/Elektronikentwickler", "Automotive Software Engineer")
  const OTHER_FIELD = any(
    inside([
      // hardware and electronics
      "hardware",
      "hardver",
      "pcb",
      "mikrochip",
      "microchip",
      "elektroni",
      "electroni",
      "elettroni",
      "rf engineer",
      // other engineering
      "mechanical",
      "mechanik",
      "mechanisch",
      "mechaniczn",
      "mecanique",
      "mecanic",
      "meccanic",
      "mechatron",
      "civil engineer",
      "genie civil",
      "structural",
      "electrical",
      "elektrotechn",
      "process engineer",
      "chemical",
      "manufacturing",
      "maintenance",
      "hvac",
      "construction",
      "maschinenbau",
      "werktuigbouw",
      "verfahrenstechn",
      "bau engineer",
      "konstrukt",
      "biomedical",
      "aerospace",
      "automotive",
      "highway",
      "geotechn",
      "moulding",
      "molding",
    ]),
    // Machine and production programmers ("Programista CNC", "SPS-Programmierer",
    // "Roboterprogrammierer"); Robot Framework is a test tool
    pattern(`${NB}(?:robot|roboter|robotow|robotu|robotti)${NA}(?! framework)`),
    words([
      "plc",
      "sps",
      "cnc",
      "cam",
      "nc",
      "scada",
      "levari",
      // numerical control ("programator mașină cu comandă numerică")
      "comanda numerica",
      "commande numerique",
      "control numerico",
      "controllo numerico",
      "numeerinen ohjaus",
      // renewable energy ("Développeur de projets éoliens")
      "eolien",
      "eoliens",
      "eolienne",
      "eoliennes",
      "photovoltaique",
      "photovoltaiques",
      "photovoltaic",
      "photovoltaik",
      "enr",
      "renouvelable",
      "renouvelables",
      "renewable",
      "renewables",
      "renovables",
      "rinnovabili",
      // manual testing
      "manual",
      "manuell",
      "manuel",
      "manuelle",
      "manueel",
      "manuale",
      "manuali",
      "manualny",
      "manualna",
      "manualne",
      "manualni",
      "manuaalinen",
    ])
  );

  const STRONG = any(
    inside(["devops", "devsecops", "mlops", "frontend", "backend", "fullstack"]),
    // Software compounds and phrases that name the work ("Softwarearchitekt",
    // "Werkstudent Softwareentwicklung", "Ohjelmistokehitysharjoittelija",
    // "Informatiker Applikationsentwicklung", "Software-Development")
    pattern(
      `${NB}(?:software|ohjelmisto|mjukvaru|programvaru|szoftver|anwendungs|applikations|web|app|spiele) ?(?:entwickl|ontwikkel|utveckl|udvikl|utvikl|kehit|fejleszt|development|architekt|arkitekt|arkkiteh|suunnittelij)`
    ),
    // …and with development first ("Ingénieur Études et Développement",
    // "Développement logiciel", "Desarrollo de software", "udvikling af software",
    // "Μηχανικός ανάπτυξης λογισμικού")
    pattern(
      `${NB}(?:etudes et developpement|(?:developpement|desarrollo|desenvolvimento|sviluppo|dezvoltare|rozwoj|vyvoj|ontwikkeling|entwicklung|udvikling|utveckling|utvikling|development|αναπτυξησ?)(?: (?:de|du|des|del|di|do|da|van|von|af|av|of))? (?:software|informatique|informatico|informatica|web|applications?|aplicaciones|applicazioni|aplicacoes|aplicatii|εφαρμογων|εφαρμογησ|mobile))${NA}`
    ),
    // Designers of software in most EU languages ("Concepteur logiciel",
    // "Progettista di software", "Projektant oprogramowania", "Software ontwerper")
    pattern(
      `${NB}(?:concept(?:eur|rice)s?|disenador(?:a|es|as)?|progettist[ai]|projektan(?:t|tka|ci)|ontwerpers?|proiectant(?:a)?|suunnittelij(?:a|at)|σχεδιαστ\\p{L}*)(?: (?:de|di|del|dei|of|van))? software${NA}|${NB}software (?:ontwerpers?|suunnittelij(?:a|at))${NA}`
    ),
    TEST_AUTOMATION,
    // Engineering leadership ("VP of Engineering", "Engineering Manager")
    pattern(`${NB}(?:vp|svp|vice president|head|director)(?: of)? engineering${NA}|${NB}engineering (?:manager|managers|lead|director)${NA}`),
    // French web integrators build front ends ("Intégrateur Web WordPress")
    pattern(`${NB}integrat(?:eur|rice)s?(?: e)? (?:web|html|front)`),
    words([
      "sre",
      "site reliability",
      "sdet",
      "ios",
      "android",
      "flutter",
      "react native",
      "unity",
      "unreal",
      "godot",
      "solidity",
      "smart contract",
      "cto",
      "chief technology officer",
      "tech lead",
      "technical lead",
      "founding engineer",
      "forward deployed",
      "internal tools",
      "staff engineer",
      "principal engineer",
      // test architects design the automation frameworks
      "test architect",
      "qa architect",
    ])
  );

  // Developer and programmer in any EU language (title-match.js reads them all
  // as "developer")
  const DEVELOPER = inside(["developer", "programmer"]);
  // Finnish kehittäjä and Hungarian fejlesztő alone also develop services and
  // organisations: they count next to a software word ("Kehittäjä, Dynamics 365")
  const BARE_LOCAL_DEVELOPER = /(?<![\p{L}\p{N}-])(?:kehittaja|kehittajat|fejleszto|fejlesztok)(?![\p{L}\p{N}])/u;

  // Trainees and specialists named after a programming language write code in
  // it ("Werkstudent im Bereich Java Anwendungen", "PL/SQL Specialist"), unless
  // the title names another job ("Data Analyst Intern (Python)")
  const LANGUAGE = words(LANGUAGES);
  const CODER = words([
    "specialist",
    "spezialist",
    "specjalista",
    "specialista",
    "especialista",
    "specialiste",
    "expert",
    "experte",
    "experto",
    "esperto",
    "intern",
    "internship",
    "working student",
    "werkstudent",
    "werkstudentin",
    "praktikant",
    "praktikantin",
    "praktikum",
    "trainee",
    "stage",
    "stagiaire",
    "stagiair",
    "tirocinio",
    "tirocinante",
    "becario",
    "becaria",
    "practicas",
    "apprenti",
    "alternant",
    "alternance",
    "azubi",
    "harjoittelija",
    "gyakornok",
    "stazysta",
    "stazystka",
  ]);
  const OTHER_JOB = words([
    "analyst",
    "analytiker",
    "analista",
    "analyste",
    "scientist",
    "tester",
    "testerka",
    "consultant",
    "berater",
    "beraterin",
    "manager",
    "support",
    "administrator",
    "admin",
    "writer",
  ]);

  // Engineers and architects count next to a software word ("Data Engineer",
  // "Ingénieur Études et Développement", "Cloud Architect", "Arquitecto de software")
  const ROLE = words([
    "engineer",
    "engineers",
    "engineering",
    "architect",
    "architects",
    "architekt",
    "architektin",
    "architecte",
    "architectes",
    "arquitecto",
    "arquitecta",
    "arquiteto",
    "arquiteta",
    "architetto",
    "architetti",
    "arkitekt",
    "arkkitehti",
    "arhitect",
    "arhitecta",
    "αρχιτεκτονασ",
    "αρχιτεκτονισσα",
    // Polish "twórca oprogramowania" (software creator)
    "tworca",
    "tworcy",
  ]);
  const SOFTWARE = words([
    "software",
    "web",
    "mobile",
    "mobil",
    "app",
    "apps",
    "api",
    // data in EU languages ("Ingeniero de datos", "Dateningenieur", "adatmérnök")
    "data",
    "daten",
    "datos",
    "dados",
    "dati",
    "donnees",
    "danych",
    "adat",
    "datovy",
    "de date",
    "analytics",
    "ml",
    "ai",
    // AI in Romance languages and German ("Ingénieur IA", "KI-Ingenieur")
    "ia",
    "ki",
    "llm",
    "genai",
    "nlp",
    "cloud",
    "platform",
    "plattform",
    "qa",
    "integration",
    "application",
    "applications",
    "ui",
    "embedded",
    "embarque",
    "embarques",
    "embarquee",
    "embarquees",
    "embebido",
    "embebidos",
    "firmware",
    "rpa",
    "release",
    "build",
    "compiler",
    "graphics",
    "application security",
    "appsec",
    "product security",
    ...LANGUAGES,
    "go",
    "swift",
    "react",
    "angular",
    "vue",
    "node",
    "salesforce",
    "sap",
    "dynamics 365",
    "dynamics crm",
    "microsoft dynamics",
    "d365",
    "servicenow",
    "outsystems",
    "mendix",
    "kubernetes",
    "aws",
    "azure",
    "gcp",
    "terraform",
    "blockchain",
    "game",
    "games",
    "gameplay",
    "computer vision",
    "robotics",
    "growth",
    "martech",
    "tools",
    "devtools",
    "backend",
  ]);
  // …and in Finnish and Hungarian, also inside words, for kehittäjä and
  // fejlesztő ("Pelien kehittäjä", "Sovellusohjelmistojen kehittäjä",
  // "Felhasználói felület fejlesztő")
  const LOCAL_SOFTWARE = inside([
    "ohjelmisto",
    "ohjelmien",
    "sovellu",
    "pelien",
    "kayttoliittym",
    "sulautet",
    "jatek",
    "beagyazott",
    "alkalmazas",
    "webes",
    "felulet",
  ]);

  function jbIsDeveloperTitle(title) {
    const s = globalThis.jbNormalizeWords(title).join(" ");
    if (!s || EXCLUDE.test(s)) return false;
    if (OTHER_FIELD.test(s) && !CODE.test(s)) return false;
    if (STRONG.test(s)) return true;
    if (DEVELOPER.test(s)) {
      return !BARE_LOCAL_DEVELOPER.test(globalThis.jbFold(title)) || SOFTWARE.test(s) || LOCAL_SOFTWARE.test(s);
    }
    if (LANGUAGE.test(s) && CODER.test(s) && !OTHER_JOB.test(s)) return true;
    return ROLE.test(s) && SOFTWARE.test(s);
  }

  globalThis.jbIsDeveloperTitle = jbIsDeveloperTitle;
})();
