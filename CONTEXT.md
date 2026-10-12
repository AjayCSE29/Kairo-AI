# Kairo Project Context

## Why this document exists

This document gives contributors the product context and the current state of the Kairo repository. It distinguishes the product vision in the user-provided implementation brief from features that are actually present in this frontend prototype. For implementation details, see [ARCHITECTURE.md](./ARCHITECTURE.md). For working rules, see [AGENTS.md](./AGENTS.md).

## Product in one paragraph

Kairo is a research workspace concept for exploring a question through claims and evidence. Its intended experience makes the reasoning trail inspectable: a user should be able to review an answer, inspect sources, evaluate individual claims, and see the relationships in a graph. A family of named model profiles gives users different research styles. Kairo's design uses a restrained, monochrome workspace rather than a conventional dashboard. The name refers to a moment when conditions are right for an insight or discovery.

The intended trust posture is evidence-first, not truth-certifying. Evidence coverage and verification language describe what the cited material supports; they do not establish universal or absolute truth.

## Product brief and current direction

The repository was initially shaped by a detailed user-provided frontend implementation brief. That document is useful background for the vision, preferred interaction patterns, model family, and desired pages. It is not a reliable inventory of what this code currently does. Subsequent direct user requests refine or supersede parts of that brief. When the two disagree, implement the most recent direct user request and describe the actual code accurately.

Current user-directed interface decisions include:

- Keep the interface monochrome and visually close to the supplied Codex model picker reference. The model control is an in-composer popover with model selection and a separate effort slider interaction; selecting a model should not redirect to a model catalog.
- Keep the model catalog under Settings → Models and usage history under Settings → Usage. Legacy paths redirect to these settings pages.
- Do not show raw numeric credit balances as ordinary UI copy. Internally, the demo still estimates and records relative usage to simulate capacity.
- Research and evidence verification are enabled defaults, so the composer does not expose redundant Web or JEV activation buttons.
- Do not render the former Investigation side panel on the research result page. The evidence views and graph carry the result experience.
- Keep the composer organized, let its text area grow automatically, and use the plus button for attachment affordance. There is no manual resize handle or model usage factor badge in the composer.
- Graph items can be dragged to arrange them. A fullscreen control expands the graph, and a memo control adds draggable editable notes with a delete button. The old zoom guide/controls are absent. Graph edits, including memo text and node positions, are currently in-memory only.
- Prioritize readable text and a consistent typographic system across the workspace.

The original brief also described real web discovery, retrieval augmented generation, provider models, account and billing flows, and a more extensive credit economy. Those capabilities are not present. The current app is a browser-only mock-data prototype: the “research” lifecycle and its evidence are simulations.

## What the app does today

The app presents a local workspace with these experiences:

- **Research home (`/`)**: a composer for a question, model selection, research mode selection, estimated demo usage, and a simulated submit flow. The model popover and effort control are part of the composer interaction.
- **Research result (`/research/:sessionId`)**: a simulated investigation with Answer, Sources, Claims, and Graph tabs. Users can inspect source and claim drawers, save a result, copy the answer, rerun, and ask a follow-up. While a run is “in progress,” a timed local sequence updates progress; it does not call a model or search service.
- **Research library (`/library`)**: local investigation history with search, saved filtering, and session actions such as opening, renaming, saving, and removing.
- **Settings (`/settings`)**: research defaults, appearance/reduced-motion preference, demo data actions, and product information.
- **Settings → Models (`/settings/models`)**: a comparison of the six local model profiles and selection of the default/current profile.
- **Settings → Usage (`/settings/usage`)**: local completed-session usage history and demo-capacity actions. Usage is represented as relative factors and session records; raw balances are not intended for visible UI copy.
- **Evidence graph**: an interactive React Flow canvas with question, claim, and source nodes. Nodes can be moved; edges express the fixture relationships. Users can filter/search nodes, add and edit memo nodes, delete memos, and enter fullscreen.

The graph shown on a result is generated from the shared fixture claims and sources. It is not a graph produced by a live research run. The active graph state is component state and does not survive leaving/remounting the page.

## Model profiles

`src/data.ts` defines six model profiles. Their names, role descriptions, characteristics, and multipliers are demo metadata, not measurements of real model performance or provider pricing.

| Profile | Demo multiplier | Intended profile |
| --- | ---: | --- |
| Obsidian | 3.0× | Flagship, deep reasoning |
| Opal | 0.65× | Fast answers |
| Jade | 1.5× | Research and discovery |
| Garnet | 1.8× | Critical analysis |
| Topaz | 2.1× | Complex problem solving |
| Aventurine | 1.25× | Exploratory work |

The values are used by the local estimate function. Do not present them as provider billing rates, benchmark results, or validated model capabilities. The effort slider visible in the model picker is currently local presentation state; it is not persisted in user preferences and does not affect the estimate or simulation.

## Evidence model and trust language

`src/data.ts` contains a small fixed evidence set: five source fixtures and three claim fixtures. Claims refer to source IDs and use one of the statuses `Supported`, `Insufficient evidence`, `Contradicted`, or `Not checked`. The fixtures drive citations, drawers, source/claim views, and graph links.

JEV (the brief's evidence verification concept) is represented as a local verification preference and explanatory UI. It does not run a verification algorithm or retrieve additional evidence. Avoid wording that suggests the fixtures prove an assertion in the real world. Prefer qualified language such as “supported by the available cited evidence.”

## Data and persistence

The app stores a small amount of browser-local demo state. It has no account, server synchronization, database, API, or cross-device persistence.

- `kairo.sessions`: serialized investigation history. If storage is empty or unavailable, the app falls back to starter examples. Session writes are guarded against storage errors.
- `kairo.preferences`: selected model, research mode, verification preference, and reduced-motion preference. Defaults are defined by `DEFAULT_PREFERENCES` in `src/data.ts`.
- `kairo.credits`: internal numeric demo capacity used by the local estimator and submit flow. A fallback is used if the key is absent; this data is not proof of an actual account balance.

Browser storage may be disabled, private, or cleared. The application catches common storage failures in read/write paths, but it does not offer durable backup or synchronization. “Reset demo” clears these keys and returns the app to its starter state.

## Design direction

The interface is a dark, monochrome workspace with graphite surfaces, subdued borders, and restrained semantic colors for evidence status. Model selection should remain compact and familiar, with an unobtrusive white/dark monochrome popover treatment consistent with the supplied Codex reference. The composer is the primary interaction surface. Settings contain secondary configuration and catalog/history views.

The code has CSS variables and component classes in `src/styles.css`. The stylesheet has accumulated appended overrides from iterative UI changes, so inspect the final cascade before changing a component. The original brief named Manrope and IBM Plex Mono; the current HTML does not load hosted font files, so actual rendering uses available/system fallback fonts. Do not assume the named font assets are bundled.

## Repository map

- `src/main.tsx`: React entry point; imports the global CSS and React Flow base CSS, then mounts the app inside `React.StrictMode` and `BrowserRouter`.
- `src/App.tsx`: application shell, route table, local state orchestration, composer, result views, graph, drawers, settings, library, and modal behavior. This file is currently the main implementation surface and is intentionally described as it exists; large refactors should be tied to a concrete need.
- `src/data.ts`: fixture types and data, model profiles, preferences, estimate function, and localStorage read helpers.
- `src/SettingsModels.tsx`: Settings → Models catalog.
- `src/UsagePage.tsx`: Settings → Usage view.
- `src/styles.css`: dark theme, layout, interaction, responsive rules, and later UI overrides.
- `src/data.test.ts`: a small Vitest suite for estimator behavior, fixture references, and model profile consistency.
- `index.html`: page shell and document title.
- `vite.config.ts`, `tsconfig*.json`, `package.json`: Vite, TypeScript, and scripts.

## Boundaries and current limitations

- No network search or web crawling is implemented.
- No LLM/model provider is called; all answers and evidence are local fixtures or simulated presentation.
- No server, authentication, user account, payment, or actual billing integration exists.
- The demo usage estimator is arithmetic over fixed mode/model values. It is not token metering.
- The “model profiles” are descriptive UI fixtures, not a model registry or runtime model adapter.
- Verification/JEV is a preference and explanatory state, not an evidence evaluation engine.
- Graph dragging and memo editing are transient. Refreshing or navigating away resets them.
- The composer attachment control is a visual affordance; file ingestion and upload are not implemented.
- The sample profile name and local usage records are demo content.

These limits should be explicit in user-facing copy whenever a screen could otherwise imply a live search, real model response, or account balance.

## Local development

Use Node/npm with the lockfile in the repository:

- `npm install` installs dependencies.
- `npm run dev` starts the Vite development server.
- `npm run build` runs the TypeScript project build and Vite production build.
- `npm run preview` serves the built output locally.
- `npm test` runs Vitest once.

The package is a frontend app. A successful static build does not validate browser interaction, accessibility, or external service behavior; there are no external services in this prototype.
