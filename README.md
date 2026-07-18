# MetaGame

MetaGame is an interactive digital twin of Almedia's global rewarded user-acquisition footprint. It currently visualizes an evidence-aware local dataset and is designed to support an agent-maintained refresh loop in later steps.

## Run locally

Install dependencies once:

```bash
npm install
```

Start the API:

```bash
npm run start:server
```

In another terminal, start the frontend:

```bash
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

## Current API

- `GET /health`
- `GET /twin/meta` — dataset methodology and source catalog
- `GET /twin/games` — sourced game catalog
- `GET /twin/validation` — reconciliation of country, game, and continent totals
- `GET /twin/continents` — country-derived continent aggregates
- `GET /twin/countries?continent=<id>` — country and per-game estimates

## Data integrity

Public sources do not disclose exact Freecash users by country and game. The API therefore labels the current map values as estimates and labels unsupported geography as missing. Reported facts, source URLs, methodology, and visual encoding rules are documented in [DATA_SOURCES.md](DATA_SOURCES.md).

## Verification

```bash
npm run build
npm run lint
```
