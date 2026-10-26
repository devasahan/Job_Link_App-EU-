/**
 * The companies the careers sources check, each on its own public job board.
 * Curated in October 2026: companies on Greenhouse and Ashby known to hire
 * remote developers living in Europe, each board token seen working by
 * another public project in 2026 or, marked "unchecked", taken from a list.
 * There is no settings page for it: a company is added or fixed here.
 * Each entry is { token, name, country }:
 *   token    the board's name in its API URL, exactly as the company has it
 *            (case, dots and hyphens count: "kraken.com", "duck-duck-go", "Enode")
 *   name     the employer: the sheet's Company column and its Copy report line
 *   country  where it is based (ISO code), for reference: it says nothing
 *            about where a job may be done
 * A token that stops working shows on its company's Copy report line as
 * "not found (HTTP 404)" after Check sources.
 */

const boards = (rows) => Object.freeze(rows.map(([token, name, country]) => Object.freeze({ token, name, country })));

/** boards-api.greenhouse.io/v1/boards/{token}/jobs */
export const GREENHOUSE_BOARDS = boards([
  ["gitlab", "GitLab", "US"],
  ["canonical", "Canonical", "GB"],
  ["grafanalabs", "Grafana Labs", "US"],
  ["elastic", "Elastic", "NL"],
  ["wikimedia", "Wikimedia Foundation", "US"],
  ["mozilla", "Mozilla", "US"],
  ["automatticcareers", "Automattic", "US"],
  ["remotecom", "Remote", "US"],
  ["vercel", "Vercel", "US"],
  ["bitwarden", "Bitwarden", "US"],
  ["netlify", "Netlify", "US"],
  ["sourcegraph91", "Sourcegraph", "US"],
  ["mattermost", "Mattermost", "US"],
  ["datadog", "Datadog", "US"],
  ["mongodb", "MongoDB", "US"],
  ["cloudflare", "Cloudflare", "US"],
  ["stripe", "Stripe", "IE"],
  ["twilio", "Twilio", "US"],
  ["contentful", "Contentful", "DE"],
  ["storyblok", "Storyblok", "AT"],
  ["platformsh", "Upsun (Platform.sh)", "FR"],
  ["brave", "Brave", "US"],
  ["customerio", "Customer.io", "US"],
  ["circleci", "CircleCI", "US"],
  ["cribl", "Cribl", "US"],
  ["cloudbeds", "Cloudbeds", "US"],
  ["saucelabs", "Sauce Labs", "US"],
  ["kentik", "Kentik", "US"],
  ["dbtlabsinc", "dbt Labs", "US"],
  ["fivetran", "Fivetran", "US"],
  ["singlestore", "SingleStore", "US"],
  ["neo4j", "Neo4j", "SE"],
  ["digitalocean98", "DigitalOcean", "US"],
  ["fastly", "Fastly", "US"],
  ["okta", "Okta", "US"],
  ["typeform", "Typeform", "ES"],
  ["algolia", "Algolia", "FR"],
  ["dataiku", "Dataiku", "FR"],
  ["celonis", "Celonis", "DE"],
  ["veriff", "Veriff", "EE"],
  ["bitmovin", "Bitmovin", "AT"],
  ["pleo", "Pleo", "DK"],
  ["mewssystems", "Mews", "CZ"],
  ["apaleo", "apaleo", "DE"],
  ["lighthouse", "Lighthouse", "BE"],
  ["getyourguide", "GetYourGuide", "DE"],
  ["trivago", "trivago", "DE"],
  ["hometogo", "HomeToGo", "DE"],
  ["raisin", "Raisin", "DE"],
  ["toogoodtogo", "Too Good To Go", "DK"],
  ["bitpanda", "Bitpanda", "AT"],
  ["lokalise", "Lokalise", "LV"],
  ["commercetools", "commercetools", "DE"],
  ["spryker", "Spryker", "DE"],
  ["phrase", "Phrase", "DE"],
  ["collibra", "Collibra", "BE"],
  ["rocketchat", "Rocket.Chat", "BR"],
  ["moduscreate", "Modus Create", "US"],
  ["turing", "Turing", "US"],
  ["consensys", "Consensys", "US"],
  ["openzeppelin", "OpenZeppelin", "US"],
  ["xapo61", "Xapo Bank", "GI"],
  ["amplemarket", "Amplemarket", "PT"],
  ["feverup", "Fever", "ES"],
  ["cabify", "Cabify", "ES"],
  ["ebury", "Ebury", "GB"],
  ["hubspotjobs", "HubSpot", "US"], // unchecked
  ["proton", "Proton", "CH"], // unchecked
  ["aiven36", "Aiven", "FI"], // unchecked
  ["truelayer", "TrueLayer", "GB"], // unchecked
  ["nearform", "Nearform", "IE"], // unchecked
  ["starburst", "Starburst", "US"], // unchecked
  ["redpandadata", "Redpanda", "US"], // unchecked
  ["bird", "Bird", "NL"], // unchecked
  ["gostudent", "GoStudent", "AT"], // unchecked
  ["buildkite", "Buildkite", "AU"], // unchecked
  ["castaigroupinc", "CAST AI", "LT"], // unchecked
  ["doitintl", "DoiT", "US"], // unchecked
  ["gympass", "Wellhub", "US"], // unchecked
  ["processstreet", "Process Street", "US"], // unchecked
  ["qualio", "Qualio", "IE"], // unchecked
  ["appfire", "Appfire", "US"], // unchecked
  ["shopfully", "Shopfully", "IT"], // unchecked
  ["block", "Block", "US"], // unchecked
  ["letsgetchecked", "LetsGetChecked", "IE"], // unchecked
]);

/** api.ashbyhq.com/posting-api/job-board/{token} */
export const ASHBY_BOARDS = boards([
  ["posthog", "PostHog", "US"],
  ["supabase", "Supabase", "US"],
  ["linear", "Linear", "US"],
  ["n8n", "n8n", "DE"],
  ["deel", "Deel", "US"],
  ["oyster", "Oyster", "US"],
  ["zapier", "Zapier", "US"],
  ["buffer", "Buffer", "US"],
  ["helpscout", "Help Scout", "US"],
  ["ghost", "Ghost", "SG"],
  ["railway", "Railway", "US"],
  ["sentry", "Sentry", "US"],
  ["docker", "Docker", "US"],
  ["1password", "1Password", "CA"],
  ["snyk", "Snyk", "GB"],
  ["camunda", "Camunda", "DE"],
  ["clickhouse", "ClickHouse", "US"],
  ["temporal", "Temporal", "US"],
  ["percona", "Percona", "US"],
  ["redis", "Redis", "US"],
  ["coder", "Coder", "US"],
  ["zed", "Zed", "US"],
  ["resend", "Resend", "US"],
  ["neon", "Neon", "US"],
  ["triggerdev", "Trigger.dev", "GB"],
  ["weaviate", "Weaviate", "NL"],
  ["elevenlabs", "ElevenLabs", "GB"],
  ["sanity", "Sanity", "NO"],
  ["paddle", "Paddle", "GB"],
  ["airbyte", "Airbyte", "US"],
  ["prefect", "Prefect", "US"],
  ["infisical", "Infisical", "US"],
  ["revenuecat", "RevenueCat", "US"],
  ["goteleport", "Teleport", "US"],
  ["constructor", "Constructor", "US"],
  ["hopper", "Hopper", "CA"],
  ["duck-duck-go", "DuckDuckGo", "US"],
  ["kraken.com", "Kraken", "US"],
  ["mapbox", "Mapbox", "US"],
  ["kit", "Kit", "US"],
  ["gitbook", "GitBook", "FR"],
  ["confluent", "Confluent", "US"],
  ["kong", "Kong", "US"],
  ["hubstaff", "Hubstaff", "US"],
  ["chilipiper", "Chili Piper", "US"],
  ["motherduck", "MotherDuck", "NL"],
  ["raycast", "Raycast", "GB"],
  ["checkly", "Checkly", "DE"],
  ["nango", "Nango", "US"],
  ["mazedesign", "Maze", "FR"],
  ["dune", "Dune", "NO"],
  ["polygon-labs", "Polygon Labs", "CH"],
  ["matter-labs", "Matter Labs", "DE"],
  ["oplabs", "OP Labs", "US"],
  ["ashby", "Ashby", "US"],
  ["lago", "Lago", "FR"],
  ["Enode", "Enode", "NO"],
  ["datafold", "Datafold", "US"],
  ["lightdash", "Lightdash", "GB"],
  ["Deepnote", "Deepnote", "CZ"],
  ["hightouch-inc", "Hightouch", "US"],
  ["oneleet", "Oneleet", "NL"],
  ["Influxdata", "InfluxData", "US"],
  ["lemlist", "lemlist", "FR"],
  ["velocity", "Velocity Global", "US"],
  ["atlas", "Atlas", "US"],
  ["secfix", "Secfix", "DE"],
  ["Nivoda", "Nivoda", "GB"],
  ["alan", "Alan", "FR"],
  ["qonto", "Qonto", "FR"],
  ["pennylane", "Pennylane", "FR"],
  ["poolside", "poolside", "FR"],
  ["synthesia", "Synthesia", "GB"],
  ["DeepL", "DeepL", "DE"], // unchecked
  ["mondoo", "Mondoo", "DE"], // unchecked
  ["vClusterLabs", "vCluster Labs", "US"],
  ["vivid", "Vivid Money", "DE"], // unchecked
  ["primer.io", "Primer", "GB"], // unchecked
  ["testgorilla", "TestGorilla", "NL"], // unchecked
  ["sketch", "Sketch", "NL"], // unchecked
  ["hostinger", "Hostinger", "LT"], // unchecked
  ["nethermind", "Nethermind", "GB"], // unchecked
  ["parity", "Parity", "DE"], // unchecked
  ["protocol", "Protocol Labs", "US"], // unchecked
]);
