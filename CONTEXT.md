# Kairo Project Context

## Why this document exists

This document describes the product intent, current capabilities, and explicit limits of the Kairo repository. It reflects the implemented system, not an aspirational brief. For code structure and data flow, see [ARCHITECTURE.md](./ARCHITECTURE.md). For contribution rules, see [AGENTS.md](./AGENTS.md).

## Product in one paragraph

Kairo is an evidence-first research workspace. A user asks a question, chooses one of six model profiles, and receives a cited answer assembled from real web sources and optional uploaded documents. The result can be inspected through sources, claims, and an interactive evidence graph. JEV is a model-assisted review of whether the cited excerpts support, contradict, or fail to support each claim. It is not a truth certification.

## Current direction

The app is a single-user, browser-accessed workspace backed by a local Fastify server and SQLite. It performs real Tavily searches and calls both model providers through OpenAI-compatible chat completion endpoints. It does not run mock research, use fixture answers, expose credit balances, or call a billing system.

Current interaction decisions:

- The interface remains dark graphite and monochrome, with restrained evidence-status colors.
- Research verification is enabled by the research defaults; the composer does not expose redundant activation toggles. Verification can be changed in Settings.
- The composer grows with content, keeps the leftmost plus affordance for real PDF/text attachments, and has no manual resize handle or usage-factor badge.
- The model picker is an in-composer popover. Selecting a model does not navigate to the catalog. Settings → Models remains the catalog.
- The research result page uses Answer, Sources, Claims, and Graph tabs; there is no Investigation side panel.
- Graph nodes can be dragged, the canvas supports fullscreen, and memos are editable/deletable. Layout and memos now persist per session.
- The graph has no React Flow minimap or zoom control guide.
- Settings keeps the hierarchy `/settings`, `/settings/models`, `/settings/usage`; legacy routes redirect.
- Usage is shown as real token counts, run counts, and search calls. Raw credit balances are not part of the UI.
- The effort slider is functional and persisted. It changes answer budget, temperature, and query depth.

## What the app does today

- **Research home (`/`)**: question composer, model profile picker, research mode, effort, attachments, and a real submit flow.
- **Research result (`/research/:sessionId`)**: streams staged progress and answer tokens over SSE, then renders a cited Markdown answer, real sources, extracted claims, JEV statuses, and the graph. Supports save, copy, rerun with another model, export, share, cancel, and follow-up.
- **Research library (`/library`)**: server-persisted history with search, model filter, saved filter, sorting, rename, delete, and open.
- **Settings (`/settings`)**: default mode, effort, JEV, reduced motion, usage link, and full data reset.
- **Settings → Models (`/settings/models`)**: six profiles with their real provider/model route and availability.
- **Settings → Usage (`/settings/usage`)**: run history, token totals, per-model totals, search counts, and estimated-token labeling.
- **Graph (`/graph/:sessionId` and the result tab)**: question, claim, source, and memo nodes; draggable positions; filters and search; fullscreen; persisted memos.
- **Share (`/share/:token`)**: a public, frozen snapshot with answer, sources, claims, and a read-only graph.

## Evidence and trust language

Sources are real web results or uploaded files, but they can be wrong, incomplete, or outdated. Claims are model-extracted. JEV statuses are model-assisted judgments over the cited excerpts available to that run. UI copy should say “supported by the available cited evidence,” not “true” or “verified fact.”

The app must not imply:

- that a run searched or verified beyond the configured providers;
- that a source is reliable merely because it is relevant;
- that token counts are invoices or a credit balance;
- that a shared snapshot remains live after the original sources change.

## Model profiles

`shared/models.ts` defines six profile presets: Obsidian, Opal, Jade, Garnet, Topaz, and Aventurine. Their names, roles, and relative multipliers are product metadata. They are not benchmark results or provider prices. The server maps each profile to a provider and real model ID from environment configuration.

## Persistence

Server-side SQLite stores sessions, runs, sources, claims, events, graph layout, memos, attachments metadata/text, preferences, and frozen share snapshots. Uploaded files are stored under `data/uploads`. Browser localStorage is no longer the source of truth for research data.

Browser storage may still be used by the browser or development tooling, but it does not hold the workspace history. “Reset data” removes sessions, shares, attachments, files, and preferences from the server.

## Boundaries and known limitations

- No user account, authentication, multi-tenancy, or authorization. The server assumes loopback/local use.
- No billing, payment, credit economy, or quotas. Concurrency is capped, but usage is not billed.
- No provider fallback guarantee; each profile requires a configured route.
- No independent fact-checking or human review. JEV is model-assisted.
- Token counts are provider-reported when available and otherwise estimated.
- No OCR for scanned PDFs, no DOCX ingestion, and no image understanding.
- No scheduled crawling, monitoring, or cross-device sync.
- Public share links are unguessable but not access-controlled beyond the token.
- Provider errors and rate limits are surfaced to the user; runs can fail.
- Graph persistence covers layout and memos, not arbitrary edge editing.

## Local development

- `npm install` and `npm --prefix server install`
- `npm run dev` starts Vite and the API
- `npm run build` checks/builds both sides
- `npm test` runs web and server tests
- `npm start` serves the built app and API
- `docker compose up --build` runs the local stack

Live research requires the environment variables documented in `.env.example`.
