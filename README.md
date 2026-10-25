# Kairo Research Workspace

Kairo is an evidence-first research workspace. It composes a question, runs a real web search, retrieves source excerpts, extracts checkable claims, optionally reviews those claims against their cited evidence (JEV), and streams a cited answer. Results, sources, claims, graph layout, memos, preferences, and usage are stored server-side in SQLite.

The interface keeps the dark graphite, monochrome visual system. Research runs are no longer simulated: they call the model and search providers configured on the server.

## Requirements

- Node.js 20 or later
- npm
- A Tavily API key
- OpenAI-compatible chat completion endpoints for OpenAI and/or JarvisLabs
- Build tools for `better-sqlite3` if a prebuilt binary is unavailable

## Configuration

```sh
cp .env.example .env
```

Fill in:

- `OPENAI_BASE_URL`, `OPENAI_API_KEY`
- `JARVISLABS_BASE_URL`, `JARVISLABS_API_KEY`
- `TAVILY_API_KEY`
- `MODEL_<PROFILE>_PROVIDER` and `MODEL_<PROFILE>_NAME` for each of the six Kairo profiles

Both model providers are called through the OpenAI-compatible `/v1/chat/completions` shape. The six Kairo profiles are UI presets that route to the real model IDs you configure. Keys stay on the server and are never sent to the browser.

If required values are missing, Kairo shows a setup screen listing the missing variables and does not fall back to mock data.

## Install and run

```sh
npm install
npm --prefix server install
npm run dev
```

- Web: Vite prints the local URL (usually `http://localhost:5173`).
- API: `http://127.0.0.1:8787`.
- Vite proxies `/api` to the API during development.

Production build and local run:

```sh
npm run build
npm start
```

`npm start` runs the API server, which serves the built `dist/` app and the API from one origin.

Docker:

```sh
docker compose up --build
```

The compose stack binds to `127.0.0.1:8787` and persists SQLite and uploads in the `kairo-data` volume.

## Routes

- `/` — research composer
- `/research/:sessionId` — answer, sources, claims, and graph
- `/library` — searchable local research history
- `/settings` — research defaults, appearance, and data reset
- `/settings/models` — model profiles and provider routes
- `/settings/usage` — real token usage and run history
- `/graph/:sessionId` — graph view
- `/share/:token` — public, frozen, read-only result snapshot
- `/models`, `/usage`, `/credits` — legacy redirects to settings

## Research lifecycle

1. The selected model profile plans search queries.
2. Tavily searches and retrieves source content; results are deduplicated and capped by mode.
3. Uploaded PDF/text attachments are included as evidence sources.
4. The model extracts checkable claims tied to source IDs.
5. When JEV is enabled, a second model pass labels claims `Supported`, `Contradicted`, or `Insufficient evidence` against their cited excerpts.
6. The model streams a Markdown answer with `[S1]`-style citations.
7. Sources, claims, answer, token usage, and graph data are persisted; progress is delivered over SSE with replay support.

The effort slider is functional: it changes answer length, token budget, temperature, and query depth. Mode controls search breadth and source count.

## Data and trust boundaries

- Storage: SQLite (`data/kairo.db`) plus uploaded files (`data/uploads`). No account system; this is a single-user workspace.
- Usage: provider-reported token counts when available, clearly marked estimates when not. There is no credit balance or billing integration.
- Search: Tavily retrieval only; source contents can be incomplete, outdated, or wrong.
- JEV: a model-assisted review of the cited excerpts, not a certification of absolute truth or independent validation.
- Attachments: PDF, text, Markdown, CSV, and JSON are extracted locally; the extracted text is sent to the configured model and search providers as part of a run.
- Sharing: share links are unguessable tokens pointing to a frozen snapshot. Revoking a link in the result view deletes it.
- Access: the server assumes loopback/local use. If you expose it beyond your machine, put it behind an authenticated reverse proxy. There is no built-in login.

## Scripts

- `npm run dev` — Vite plus the API server
- `npm run build` — web typecheck/build plus server typecheck
- `npm run preview` — preview the Vite build
- `npm start` — run the production API server
- `npm test` — web tests plus server tests

Test suites use fake provider and search adapters. They do not make live provider calls.

## Repository map

- `src/` — React app, API client, Markdown/citation rendering, settings, usage
- `shared/` — model profiles and API/SSE types used by both sides
- `server/` — Fastify API, SQLite repositories, provider adapters, research pipeline
- `Dockerfile`, `docker-compose.yml`, `.env.example`
- `CONTEXT.md`, `ARCHITECTURE.md`, `AGENTS.md` — product, implementation, and contribution guidance
