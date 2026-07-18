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

### OpenAI business agent

Copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and export it before starting the backend. The key is server-side only and must never be exposed through Vite or committed. Without a key, the map remains available and chat reports that OpenAI is not configured.

Set `TAVILY_API_KEY` in the same ignored `.env` to enable current web research. Search results remain pending evidence until a user approves them; approval does not automatically change numeric twin records.

Set `COGNEE_API_KEY` and the tenant-specific `COGNEE_BASE_URL` to persist approved/rejected research decisions. Cognee is agent memory only; the JSON database remains authoritative. Failed memory writes are marked for retry and never block an approval decision.

All external services degrade safely: OpenAI falls back to deterministic twin answers, Tavily to the local source catalog, and Cognee to runtime approved evidence. Credit exhaustion, rate limits, timeouts, or missing credentials do not interrupt the map or chat.

## Current API

- `GET /health`
- `GET /twin/meta` — dataset methodology and source catalog
- `GET /twin/games` — sourced game catalog
- `GET /twin/economics` — modeled unit economics, onboarding, infrastructure ROI, and risk
- `POST /twin/agent/chat` — OpenAI analysis grounded in the current twin and financial scenario
- `POST /twin/research/propose` — create a cited Tavily evidence proposal
- `POST /twin/research/:id/apply` — approve evidence for runtime agent context
- `POST /twin/research/:id/reject` — reject pending evidence
- `GET /twin/memory/status` — Cognee configuration and availability state
- `POST /twin/memory/retry/:id` — retry a failed Cognee memory write
- `GET /twin/services/status` — primary-service and fallback availability
- `GET /twin/snapshots` — available modeled twin-history dates
- `GET /twin/attention` — countries requiring freshness or confidence review
- `POST /twin/refresh/propose` — deterministic country refresh proposal
- `POST /twin/refresh/proposals/:id/apply` — approve a pending proposal
- `POST /twin/refresh/proposals/:id/reject` — reject a pending proposal
- `POST /twin/refresh/reset` — clear in-memory demo updates
- `GET /twin/validation` — reconciliation of country, game, and continent totals
- `GET /twin/continents?asOf=<date>` — snapshot-aware continent aggregates
- `GET /twin/countries?continent=<id>&asOf=<date>` — snapshot-aware country and game estimates

## Data integrity

Public sources do not disclose exact Freecash users by country and game. The API therefore labels the current map values as estimates and labels unsupported geography as missing. Reported facts, source URLs, methodology, and visual encoding rules are documented in [DATA_SOURCES.md](DATA_SOURCES.md).

## Verification

```bash
npm run build
npm run lint
```
