# MetaGame data provenance

The public sources available for MetaGame do not disclose exact Freecash user totals by country or by country and game. The seed database therefore separates reported facts from modeled estimates.

## Reported facts

- Freecash reported more than 80 million registered users worldwide on 17 June 2026.
- Freecash reports user loyalty across more than 100 countries, but does not publish the full country list. The database therefore contains only 15 explicitly named public markets and marks its geographic coverage as partial.
- Almedia published Freecash's January 2026 iOS ranking footprint across the seeded countries.
- The game catalog contains campaigns or offers publicly confirmed by Almedia or Freecash.
- Individual case studies sometimes report global or multi-market campaign totals, but not a country-level split.

## Estimated metrics

`countries.total_users` and the generated country-game user values are relative footprint estimates retained for the interactive prototype. They support honest comparisons within the map, but they must not be described as Almedia-reported customer counts. Their status is declared in `server/db.json` and returned by the API.

The ordering of country estimates follows published App Store rank evidence. Game allocations use the `regional-game-mix-v1` model stored in `server/db.json`. Its regional weights cover all seven sourced games and sum to 100% in every supported continent. The API uses remainder-safe integer allocation, so every country's game estimates add exactly to its country estimate. These modeled values should be replaced if first-party country-level campaign data becomes available.

The 30-day growth rates are modeled demonstration estimates, not reported Almedia growth figures. Continent growth is calculated as the user-weighted average of its available country growth estimates.

Freshness is computed from each record's evidence age and confidence using the policy stored in `server/db.json`. `fresh`, `review`, and `stale` are operational attention states for the future agent; they are not claims published by Almedia.

The May and June 2026 time-travel snapshots are modeled backward from July's country estimates using each country's modeled 30-day growth rate. Their confidence is reduced for every projected month. These snapshots demonstrate twin history and must not be described as observed historical Almedia data.

Growth-potential values are scenario estimates derived from current footprint, modeled growth, certainty, and market-maturity multipliers. They are not Almedia forecasts.

Latency, failure rate, queue lag, utilization, and headroom values are modeled infrastructure scenarios. Almedia has not publicly disclosed its underlying telemetry, cloud topology, or processing limits.

Business economics are scenario calculations rather than Almedia accounts. Public evidence establishes the rewarded-UA mechanism, public reward examples, and relative ROAS outcomes, but not Almedia's advertiser prices, reward share, costs, or margins. The editable `business_model` assumptions cover monthly activity, paid completion, advertiser revenue, user rewards, variable operations, onboarding, and infrastructure investment. The OpenAI agent may interpret these calculations but is instructed not to create unsupported financial values.

Tavily results are runtime research evidence, not trusted database facts. Results retain their URL, title, relevance, retrieval time, and extracted claim. They remain pending until explicitly approved, and approval adds evidence to the agent context without changing numeric twin records.

Cognee stores long-term agent memory for approved evidence and rejected-source decisions. Retrieved memory is supporting context, not authoritative state, and cannot overwrite the JSON twin. Memory writes that fail remain explicitly pending for retry.

## Missing data

No estimate is created when public evidence is insufficient. A zero or missing value is rendered without a fill. This is different from a reported count of zero.

## Visual encoding

- Hue encodes relative user magnitude using the shared teal-to-purple `userColorScale()`.
- Continent colors are scaled across non-zero continent aggregates.
- Country colors are scaled within the selected continent.
- Game-filter colors are scaled from that game's non-zero country estimates.
- Shade intensity independently encodes confidence: pale means less certain and dark means more certain. Missing values remain transparent.
- Growth-potential mode uses the same magnitude-and-certainty encoding for estimated untapped users.
- Latency-and-capacity mode uses a teal-to-amber-to-red severity scale and is explicitly labeled as modeled.

Full source records and URLs are stored in `server/db.json`.
