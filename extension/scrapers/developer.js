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
 *      applications / security / network engineers, product and project
 *      managers, marketing, design and teaching;
 *   2. hardware, electronics, machine programming (PLC, CNC), other
 *      engineering disciplines, data centres and manual testing only with a
 *      word that names software work ("Firmware-/Elektronikentwickler",
 *      "Senior iOS Engineer – Connected Hardware"); the same goes for
 *      developers of renewable-energy projects and for one-word compounds
 *      whose stem names something else ("Verfahrensentwickler",
 *      "Entwicklungsingenieur Mobile Arbeitsmaschinen");
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
  // Gender endings after a role word: "Ingénieur(e)", "Desarrollador/a",
  // "Sviluppatore/trice", "Développeur·se", "Programista/ka"
  const GENDER = "(?: (?:e|se|euse|a|trice|ka))?";
  // Prepositions between a Romance role word and what follows it
  // ("Développeur de projets", "Ingeniero de datos", "Inżynier ds. sprzedaży")
  const OF = "(?: (?:de|di|du|des|del|della|dei|da|do|dos|d|en|in|af|av|ds))?";

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
  // "Music Programmer", "HR-utvecklare")…
  const OTHER_DEVELOPER_BEFORE = [
    "business",
    "property",
    "real estate",
    "land",
    "plan",
    "team",
    "policy",
    "hr",
    "proposal",
    "bid",
    "franchise",
    "content",
    "curriculum",
    "course",
    "courseware",
    "training",
    "instructional",
    // learning and development
    "learning",
    "assessment",
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
  // …or after it, mostly in Romance languages, with or without a preposition
  // ("Développeur foncier", "Développeur de projets", "Desarrollador/a de
  // negocio", "Sviluppatore di prodotti", "Programador de producción",
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
    "producao",
    "produzione",
    "παραγωγησ",
    "projets",
    "projet",
    "proyectos",
    "projetos",
    "progetti",
    "negocio",
    "negocios",
    "affaires",
    "afaceri",
    "eventos",
    "eventi",
    "produit",
    "produits",
    "prodotto",
    "prodotti",
    "producto",
    "productos",
    "e learning",
    "e learningu",
    "e laering",
    "aprendizaje electronico",
    "aprendizagem eletronica",
    "apprendimento elettronico",
    "elektronickeho vzdelavania",
    "elektronickeho vzdelavani",
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
      "applikations engineer",
      "anwendungs engineer",
      // SAFe programme roles
      "release train engineer",
      "solution train engineer",
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
    // …but a "Deep Learning Developer" or an "SAP HR Developer" writes code
    pattern(`(?<!deep|reinforcement|sap)${NB}(?:${alt(OTHER_DEVELOPER_BEFORE)}) (?:developers?|programmers?)${NA}`),
    // Sales engineers in other languages ("Vertriebsingenieur", "Salgsingeniør");
    // Romance word order is ENGINEER_OTHER below
    pattern(`${NB}(?:vertriebs|salgs|salj|myynti|kereskedelmi) engineer${NA}`),
    // Applications engineers support a product for its customers ("Field
    // Applications Engineer", "Ingénieur d'applications"), unless the
    // application is software ("Web Application Engineer")
    pattern(
      `(?<!web|mobile|software|cloud|ios|android|frontend|backend|fullstack|saas)${NB}applications? engineers?${NA}|${NB}engineer${GENDER} d applications?${NA}`
    ),
    // IT operations: security and network engineers ("Cloud Security Engineer",
    // "Netzwerkingenieur", "Ingénieur réseaux"), unless they secure software
    // ("Application Security Engineer", "Ingénieur sécurité logicielle");
    // a "Neural Network Engineer" builds models
    pattern(
      `(?<!application|product|software|appsec|neural)${NB}(?:security|cybersecurity|network|netzwerk|netwerk|sitovy) (?:engineers?|architects?)${NA}|${NB}engineer${GENDER}${OF} (?:(?:securite|seguridad|sicurezza|bezpieczenstwa)(?!${OF} (?:software|applicati|aplicac|applicazion))|reseaux?|redes|rete|sieci)${NA}`
    ),
    // Marketing jobs at software companies: "Growth Marketing Manager (AI Software)"
    pattern(`${NB}(?:marketing|growth|content|brand|communications?) (?:manager|specialist|lead|director|executive)${NA}`),
    // Managers of a product or project ("Product Owner Softwareentwicklung",
    // "Projektmanager Software", "Chef de projet web")
    pattern(
      `${NB}(?:product|project|projekt|prosjekt|program|programme|delivery) ?(?:managers?|managerin|owners?|leiter\\p{L}*|leder|ledare)${NA}|${NB}scrum masters?${NA}|${NB}(?:chef|cheffe|jefe|jefa|responsable|responsabile|gerente)${OF} (?:projet|projets|proyecto|proyectos|progetto|progetti|produit|producto|prodotto)${NA}`
    ),
    // Not building software: design, recruiting, account sales and teaching in EU
    // languages ("Formateur Développeur Web", "Docente di Sviluppo Web",
    // "Ausbilder Fachinformatiker Anwendungsentwicklung")
    pattern(
      `(?<!software )designer|${NB}(?:recruit\\p{L}*|teachers?|lecturers?|instructors?|trainer|tutor|dozent\\p{L}*|docent(?:e|es|i|en)?|lehrer\\p{L}*|lehrkraft|ausbilder\\p{L}*|leraar|format(?:eur|rice|ore|ori|or|oare)s?|formador(?:a|es|as)?|profes(?:or|sor)(?:a|es|as)?|professeur(?:e|s)?|insegnant[ei]|wykladowca|nauczyciel\\p{L}*|ucitel\\p{L}*|lektor(?:in)?|opettaja|kouluttaja|underviser|laerer|larare|oktato|καθηγητ\\p{L}*|εκπαιδευτ\\p{L}*)${NA}|${NB}(?:account executive|account manager)${NA}`
    )
  );

  // "developer" names the audience ("Developer Advocate", "Head of Developer
  // Relations", "Developer Experience Engineer", "Technical Writer – Developer
  // Documentation"), but after a role word or a programming language it names
  // the team or the work ("Senior Software Engineer, Developer Experience",
  // "Java Developer – Support & Maintenance")
  const AUDIENCE = pattern(
    `${NB}developer (?:relations?|advocates?|advocacy|evangelists?|experience|marketing|content|community|education|educators?|success|outreach|enablement|programs?|programmes?|ecosystem|documentation|docs|support)${NA}`
  );
  // Sales after a role word names the team ("Software Engineer – Sales Platform")
  const SALES = words(["sales"]);
  // Romance titles say which engineer after the word ("Ingénieur commercial",
  // "Ingeniero de ventas", "Ingénieur Support Logiciel", "Ingeniero/a de
  // Soluciones Cloud"); after a software word it names the team ("Software
  // Engineer – Solutions")
  const ENGINEER_OTHER = pattern(
    `${NB}engineer${GENDER}${OF} (?:commercial|commerciale|comercial|affaires|ventas|vendite|sprzedazy|vanzari|πωλησεων|support|soporte|supporto|suporte|wsparcia|avant vente|preventa|pre venta|prevendita|pre vendita|solutions|soluciones|soluzioni|solucoes)${NA}`
  );
  // What a Romance developer develops comes after the word ("Développeur
  // foncier"); after a software word the phrase names the business instead
  // (".NET Developer - Commercial Insurance")
  const DEVELOPS_OTHER = pattern(`${NB}developer${GENDER}${OF} (?:${alt(OTHER_DEVELOPER_AFTER)})${NA}`);
  /** re matches s with no `before` word ahead of the match. */
  const leads = (re, s, before) => {
    const m = re.exec(s);
    return !!m && !before.test(s.slice(0, m.index));
  };

  // Test automation in either word order ("Testautomatisierung", "testiautomaatio",
  // "QA Automation", "Automation Tester", "automatyzacji testów",
  // "automazione dei test"), also next to manual testing ("QA Engineer (Manual &
  // Automation)", "Tester manuell und automatisiert")
  const TEST_AUTOMATION = pattern(
    `${NB}(?:qa|tests?|testing|testi|teszt) ?automa|${NB}automa\\p{L}*(?: (?:de|des|dei|di|do|of))? (?:qa|tests?|testing|testers?|testow|testu|testes|pruebas|teszt\\p{L}*)${NA}|${NB}manu[ae]\\p{L}*(?: \\p{L}+){0,2} automa`
  );

  // Software compounds and phrases that name the work ("Softwarearchitekt",
  // "Werkstudent Softwareentwicklung", "Ohjelmistokehitysharjoittelija",
  // "Informatiker Applikationsentwicklung", "Software-Development")…
  const SOFTWARE_COMPOUND = pattern(
    `${NB}(?:software|ohjelmisto|mjukvaru|programvaru|szoftver|anwendungs|applikations|web|app|spiele) ?(?:entwickl|ontwikkel|utveckl|udvikl|utvikl|kehit|fejleszt|development|architekt|arkitekt|arkkiteh|suunnittelij)`
  );
  // …and with development first ("Ingénieur Études et Développement",
  // "Développement logiciel", "Desarrollo de software", "udvikling af software",
  // "Μηχανικός ανάπτυξης λογισμικού")
  const DEVELOPMENT_OF_SOFTWARE = pattern(
    `${NB}(?:etudes et developpement|(?:developpement|desarrollo|desenvolvimento|sviluppo|dezvoltare|rozwoj|vyvoj|ontwikkeling|entwicklung|udvikling|utveckling|utvikling|development|αναπτυξησ?)(?: (?:de|du|des|del|di|do|da|van|von|af|av|of))? (?:software|informatique|informatico|informatica|web|applications?|aplicaciones|applicazioni|aplicacoes|aplicatii|εφαρμογων|εφαρμογησ|mobile))${NA}`
  );

  // Words that name software work, for the fields below: they outweigh a
  // hardware or machine word ("Senior iOS Engineer – Connected Hardware",
  // "Werkstudent Softwareentwicklung Leistungselektronik", "Hardwarenaher
  // Embedded-Entwickler" writes software close to the hardware)
  const CODE = any(
    pattern(`${NB}hardwarenah\\p{L}*${NA}`),
    words([
      "software",
      "firmware",
      "frontend",
      "backend",
      "fullstack",
      "devops",
      "rpa",
      "web",
      "app",
      "apps",
      "ios",
      "android",
      "flutter",
      "react native",
      ...LANGUAGES,
    ]),
    SOFTWARE_COMPOUND,
    DEVELOPMENT_OF_SOFTWARE,
    TEST_AUTOMATION
  );

  // Hardware, machines, other engineering disciplines, data centres and
  // manual testing: another job unless the title also names software work
  // ("Firmware-/Elektronikentwickler", "Mechanical Engineer"). Industries
  // ("Automotive", "Construction Tech") are left out: they name where a
  // developer works, not what they build
  const OTHER_FIELD = any(
    inside([
      // hardware
      "hardware",
      "hardver",
      "pcb",
      "mikrochip",
      "microchip",
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
      "hvac",
      "maschinenbau",
      "werktuigbouw",
      "verfahrenstechn",
      "bau engineer",
      "konstrukt",
      "biomedical",
      "highway",
      "geotechn",
      "moulding",
      "molding",
    ]),
    // Electronics as the discipline, also at the end of a compound
    // ("Elektronikentwickler", "Leistungselektronikentwickler", "Electronics
    // Engineer", "Ingénieur électronique", "Vývojář elektroniky"), not
    // "Electronic Trading" or "Facturation électronique"
    pattern(
      `${NB}electronics${NA}|${NB}elektronik\\p{L}*${NA}|elektronik (?:developer|engineer)|${NB}(?:developer|engineer)${GENDER}${OF} (?:electroni|elettroni)\\p{L}*${NA}`
    ),
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
      "sterowanych numerycznie",
      "sterowane numerycznie",
      "cislicove rizene",
      "cislicove rizenych",
      // data centre operations ("Data Centre Engineer", "Ingeniero de centro de datos")
      "data center",
      "data centre",
      "data centers",
      "data centres",
      "datacenter",
      "datacentre",
      "rechenzentrum",
      "centro de datos",
      "centro de dados",
      "centre de donnees",
      "centro dati",
      "centrum danych",
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
    SOFTWARE_COMPOUND,
    DEVELOPMENT_OF_SOFTWARE,
    // Designers of software in most EU languages ("Concepteur logiciel",
    // "Progettista di software", "Projektant oprogramowania", "Software ontwerper")
    pattern(
      `${NB}(?:concept(?:eur|rice)s?|disenador(?:a|es|as)?|progettist[ai]|projektan(?:t|tka|ci)|ontwerpers?|proiectant(?:a)?|suunnittelij(?:a|at)|σχεδιαστ\\p{L}*)(?: (?:de|di|del|dei|of|van))? software${NA}|${NB}software (?:designers?|ontwerpers?|suunnittelij(?:a|at))${NA}`
    ),
    TEST_AUTOMATION,
    // Engineering leadership ("VP of Engineering", "Engineering Manager"), not
    // of customer-facing engineers ("Solutions Engineering Manager")
    pattern(
      `${NB}(?:vp|svp|vice president|head|director)(?: of)? engineering${NA}|(?<!solutions?|sales|presales|customer|support|field)${NB}engineering (?:manager|managers|lead|director)${NA}`
    ),
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
    "δεδομενων",
    "analytics",
    "ml",
    "ai",
    // AI in German ("KI-Ingenieur"); Romance "IA" is AI_AFTER below
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
    "kernel",
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
    "deep learning",
    "neural network",
    "neural networks",
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

  // Words before an audience or sales phrase that make it a team (see leads())
  const ROLE_WORD = any(ROLE, DEVELOPER);
  const ROLE_OR_LANGUAGE = any(ROLE, DEVELOPER, LANGUAGE);

  // Romance "IA" (AI) right after the role word ("Ingénieur(e) I.A",
  // "Ingeniero/a de IA"): elsewhere it can be Iowa ("Project Engineer – Ames, IA")
  const AI_AFTER = pattern(`${NB}(?:engineer|archite\\p{L}*|arquite\\p{L}*|arhitect\\p{L}*)${GENDER}${OF} ia${NA}`);

  // Developers of renewable-energy projects ("Développeur EnR", "Solar
  // Developer", "Développeur et gestionnaire de projets éoliens"), unless a
  // software word says they build its software ("Senior Developer – Solar
  // Monitoring Platform")
  const ENERGY_PROJECT = words([
    "eolien",
    "eoliens",
    "eolienne",
    "eoliennes",
    "photovoltaique",
    "photovoltaiques",
    "photovoltaic",
    "photovoltaik",
    "pv",
    "solar",
    "wind",
    "windkraft",
    "windenergie",
    "enr",
    "renouvelable",
    "renouvelables",
    "renewable",
    "renewables",
    "renovables",
    "rinnovabili",
  ]);

  // One-word compounds name what is developed or engineered in the stem
  // ("Verfahrensentwickler", "Hankekehittäjä", "Entwicklungsingenieur"), so
  // when the stem is not software the title needs a CODE word. Hyphenated
  // forms ("Linux-Kernel-Entwickler", "HR-utvecklare") are left to the words
  const COMPOUND_DEVELOPER =
    /(?<![\p{L}\p{N}])(\p{L}+?)(?:entwickler|ontwikkelaar|utvecklare|udvikler|utvikler|kehittaja|fejleszto|programmierer|programmerare|programmerer|programmor|ohjelmoija|programozo)/u;
  const COMPOUND_ENGINEER = /(?<![\p{L}\p{N}])(\p{L}+?)(?:ingenieur|ingenjor|ingenior|insinoori|mernok)/u;
  // Developer stems that name software besides the SOFTWARE words and
  // LOCAL_SOFTWARE ("Systemutvecklare", "Anwendungsentwickler",
  // "Spieleentwickler", "Applikasjonsutvikler", "Toepassingsontwikkelaar",
  // "Tekoälykehittäjä", "Lösningsutvecklare") or a seniority ("Chefentwickler",
  // "Seniorudvikler"); short ones must be the whole stem ("Spielzeugentwickler"
  // is a toy developer)
  const SOFTWARE_STEM =
    /^(?:(?:spiel|spel|spil|spill|peli|moln|pilvi|sky|tool|senior|junior|lead|chef|haupt|paa)$|softwar|ohjelm|mjukvar|program|szoftver|system|systeem|rendszer|jarjestelm|anwendung|applikation|applikasjon|applicatie|toepassing|alkalmaz|sovellu|web|verkko|mobil|mobiili|plattform|platform|data|daten|tietokan|adatbazis|spiele|jatek|pelin|tekoaly|ratkaisu|losning|losung|granssnitt|schnittstell|kayttoliittym|kernel|treiber|integra|middleware|algorithm)/u;
  const namesSoftware = (stem) => {
    const s = globalThis.jbNormalizeWords(stem).join(" ");
    return SOFTWARE.test(s) || CODE.test(s);
  };
  const developerStem = (stem) => SOFTWARE_STEM.test(stem) || LOCAL_SOFTWARE.test(stem) || namesSoftware(stem);
  /** The title is a one-word compound whose stem names no software. */
  const otherCompound = (folded, compound, isSoftware) => {
    const m = compound.exec(folded);
    return !!m && !isSoftware(m[1]);
  };

  function jbIsDeveloperTitle(title) {
    const s = globalThis.jbNormalizeWords(title).join(" ");
    if (!s || EXCLUDE.test(s)) return false;
    if (leads(AUDIENCE, s, ROLE_OR_LANGUAGE) || leads(SALES, s, ROLE_WORD)) return false;
    if (leads(ENGINEER_OTHER, s, SOFTWARE)) return false;
    // A programming language anywhere also makes it the business area
    // ("Developer – Commercial Systems (C#)")
    if (leads(DEVELOPS_OTHER, s, SOFTWARE) && !LANGUAGE.test(s)) return false;
    // CODE only matters to the gates, so it is tested when one needs it
    let code;
    const namesCode = () => (code ??= CODE.test(s));
    if (OTHER_FIELD.test(s) && !namesCode()) return false;
    if (STRONG.test(s)) return true;
    const folded = globalThis.jbFold(title);
    if (DEVELOPER.test(s)) {
      if (ENERGY_PROJECT.test(s) && !SOFTWARE.test(s)) return false;
      if (otherCompound(folded, COMPOUND_DEVELOPER, developerStem) && !namesCode()) return false;
      return !BARE_LOCAL_DEVELOPER.test(folded) || SOFTWARE.test(s) || LOCAL_SOFTWARE.test(s);
    }
    if (LANGUAGE.test(s) && CODER.test(s) && !OTHER_JOB.test(s)) return true;
    if (otherCompound(folded, COMPOUND_ENGINEER, namesSoftware) && !namesCode()) return false;
    return ROLE.test(s) && (SOFTWARE.test(s) || AI_AFTER.test(s));
  }

  globalThis.jbIsDeveloperTitle = jbIsDeveloperTitle;
})();
