# Agent Guide for Kairo

## Purpose

Use this file as the project-specific working guide for coding agents and contributors. Read [CONTEXT.md](./CONTEXT.md) for product background and [ARCHITECTURE.md](./ARCHITECTURE.md) for implementation structure before making broad changes.

## Source of truth and priority

1. Follow the user's latest direct request in the current task.
2. Follow earlier direct user decisions in the conversation when they remain relevant.
3. Use the repository's current behavior and existing docs as implementation evidence.
4. Treat the original pasted implementation brief as product context. It is not permission to claim unfinished features exist, and it does not override later direct requests.

When documenting behavior, distinguish implemented, simulated, and planned behavior. Do not copy the brief's aspirations into a description of the current app without checking the code.

## Product and scope constraints

- Kairo is currently a frontend-only prototype. Use local fixtures and browser-local storage. Do not add a backend, external API, provider SDK, authentication, billing integration, or network search as an incidental implementation choice.
- Treat research runs and their evidence as simulations. UI wording must not imply live web search, real model execution, validated model benchmarks, or absolute truth.
- Keep research and verification defaults active. Do not reintroduce redundant Web/JEV toggle buttons into the composer unless the user directly asks.
- Keep model catalog and usage history under Settings (`/settings/models` and `/settings/usage`). If adding routes, preserve the settings hierarchy and legacy redirects unless the user changes the information architecture.
- Preserve the user's preference to avoid raw numeric credit balances in visible UI. Internal estimate values may exist for demo logic; visible copy should use relative usage or clear nonnumeric language.
- The research result view should not regain the former Investigation side panel unless requested.
- The composer should grow with content automatically, keep the leftmost plus affordance for attachment, and omit a manual resize affordance and usage-factor badge unless requested.
- Preserve the compact monochrome model picker pattern in the composer. Model selection must not unexpectedly navigate to the catalog. The Settings → Models page remains the place to inspect all profiles.
- Keep graph nodes draggable. The graph has fullscreen and memo creation controls; memos are editable and deletable. Do not restore the removed zoom guide/React Flow minimap or controls without a direct request.

## Design and interaction rules

- Follow the dark graphite, monochrome visual system and existing CSS variables/classes in `src/styles.css`.
- Keep typography consistent and readable. Check the actual font loading before claiming a specific font is guaranteed; currently the HTML does not load external font assets.
- Match the existing compact control style and use Lucide icons already in the dependency set. Avoid adding a new UI or icon library for a small component.
- Preserve responsive behavior at the existing breakpoints. Inspect the mobile layout when changing the sidebar, composer, popovers, settings, drawers, or graph toolbar.
- Use semantic buttons, labels, inputs, and dialog roles. Give icon-only controls accessible names and preserve keyboard-operable behavior.
- Keep evidence status color restrained and ensure status is also communicated in text, not by color alone.
- Inspect the complete CSS cascade before editing a style. The stylesheet contains iterative overrides near its end; a rule earlier in the file may be superseded.

## State, data, and persistence

- Keep the shared model, source, claim, session, preference, and estimator types in `src/data.ts` unless there is a clear architectural reason to move them.
- Keep fixture references valid: every claim source ID must match an existing source ID. Keep model IDs consistent across `ModelId`, `MODELS`, preferences, session records, picker options, and settings catalog.
- New persisted fields need a safe default and compatibility behavior for existing localStorage records. Browser storage reads and writes can fail; follow the guarded access patterns in `src/data.ts` and `src/App.tsx`.
- Existing browser keys are `kairo.sessions`, `kairo.preferences`, and `kairo.credits`. Avoid changing or repurposing them without updating reset/read/write behavior and project documentation.
- The internal credit key supports a demo estimator only. It must not be represented as a provider invoice or authoritative user balance.
- The effort slider is currently presentation-only and ephemeral. If changing it to affect behavior or persistence, update the types, estimate logic, settings/model descriptions, and docs together.

## React Flow graph invariants

- Keep the graph controlled: use the React Flow node state hook and pass both `nodes` and `onNodesChange`. Recreating the base node array as the rendered state on each render will reset user positions and break manual movement.
- Preserve draggable nodes and keep node interactions distinct from canvas pan. Memo text input should not initiate node dragging; use the existing `nodrag`/`nowheel` conventions as appropriate.
- Keep the current static evidence edges unless the user asks for edge editing. New memo nodes do not need evidence edges.
- When filtering nodes, filter edges against the currently visible node IDs so no dangling connection is rendered.
- Keep memo callbacks stable in behavior: editing a memo updates that memo by ID; deleting a memo removes only that node. If callbacks are moved, ensure React Flow receives updated node data.
- Fullscreen state is synchronized to the Fullscreen API and must be cleaned up through the existing event listener lifecycle.
- Graph positions and notes currently reset on unmount. Do not promise persistence unless it is implemented.

## Code organization

`src/App.tsx` currently owns most of the app, including the route shell and many view components. Prefer focused, local changes and reuse existing helpers. Extract a component only when it improves clarity or supports a concrete feature; avoid broad rewrites that increase risk without changing user-visible behavior. Keep dedicated catalog and usage code in `src/SettingsModels.tsx` and `src/UsagePage.tsx`.

Use TypeScript types instead of widening props or fixture data to `any`. The app TypeScript config enables strict checking and unused-local/parameter checks, so remove unused imports and variables.

## Routes

Current canonical routes:

- `/` — research composer
- `/research/:sessionId` — investigation result
- `/library` — local research history
- `/settings` — preferences
- `/settings/models` — model profiles
- `/settings/usage` — local usage history
- `/graph/:sessionId` — graph route

Compatibility redirects:

- `/models` → `/settings/models`
- `/usage` and `/credits` → `/settings/usage`

Keep route navigation and active sidebar state consistent when modifying routing.

## Commands and verification

Available scripts are defined in `package.json`:

- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm test`

For code changes, use the smallest relevant verification. The build checks TypeScript and bundles the app. The existing test suite covers estimate scaling and fixture/model consistency. Do not add or run tests unless the user asks for tests/verification or the requested implementation requires them under the active task instructions. If verification is requested, report exactly which command ran and whether it passed; do not claim browser behavior was verified by a build.

For documentation-only work, verify the files and links are present and internally consistent; a production build is unnecessary.

## Documentation maintenance

Update these docs when a change alters product behavior, routes, persistence, trust claims, stack, or architectural boundaries:

- `CONTEXT.md`: current product intent and implemented capabilities/limits.
- `ARCHITECTURE.md`: actual code and data flow.
- `AGENTS.md`: durable constraints and contribution rules.

Do not use documentation to claim a feature is implemented solely because it appears in the original brief or a user request. Confirm the code first, and label requested-but-unimplemented ideas as future work if needed.
