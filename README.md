# Kairo Research Workspace

A frontend-only prototype of Kairo, an evidence-first research and search workspace. The interface uses a graphite and silver visual system and includes research composition, simulated execution, cited synthesis, source inspection, JEV claim review, a knowledge graph, model selection, local research history, relative usage factors, and preferences.

## Requirements

- Node.js 20 or later
- npm

## Install and run

```sh
npm install
npm run dev
```

Vite prints the local development URL after startup. Create a production build with:

```sh
npm run build
```

## Frontend simulation boundary

All model profiles, source records, claims, answer text, graph relationships, and usage calculations are local demo fixtures. Submitting a question runs a bounded frontend timer sequence; no external search engine, model provider, backend, account system, or payment processor is called. The source destinations are sample links. JEV statuses describe only the evidence available in the demo and do not represent absolute truth. Research history and preferences are browser-local; do not store credentials or sensitive information in this prototype.

The model profiles describe intended specializations. They are not claims of independently trained models or measured performance. Model multipliers show relative demo usage.

## Routes

- `/` — research composer
- `/research/:sessionId` — results, sources, claims, and graph
- `/library` — searchable local research history
- `/settings/models` — model profiles and default selection
- `/settings/usage` — local research usage history
- `/settings` — local preferences and demo reset
- `/models`, `/usage`, and `/credits` — legacy routes redirect to their settings pages
- `/graph/:sessionId` — graph view
