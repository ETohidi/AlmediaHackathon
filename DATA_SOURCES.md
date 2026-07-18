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

## Missing data

No estimate is created when public evidence is insufficient. A zero or missing value is rendered without a fill. This is different from a reported count of zero.

## Visual encoding

- Hue encodes relative user magnitude using the shared teal-to-purple `userColorScale()`.
- Continent colors are scaled across non-zero continent aggregates.
- Country colors are scaled within the selected continent.
- Game-filter colors are scaled from that game's non-zero country estimates.
- Shade intensity independently encodes confidence: pale means less certain and dark means more certain. Missing values remain transparent.

Full source records and URLs are stored in `server/db.json`.
