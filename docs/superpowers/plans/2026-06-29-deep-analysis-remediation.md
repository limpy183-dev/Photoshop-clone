# Deep Analysis Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every concrete remediation in `docs/codebase-deep-analysis-report-2026-06-29-codex.md` and turn deployment-dependent recommendations into fail-closed, testable interfaces.

**Architecture:** Keep the existing reducer and browser-editor architecture. Make history storage lossless and lifecycle-aware; isolate external effects behind runners/adapters; protect paid server work with signed short-lived capabilities plus bounded/shared service interfaces; make CI selection and bundle analysis route-aware; extract focused editor command/state modules without a state-library rewrite.

**Tech Stack:** Next.js 16, React 19, TypeScript, Canvas 2D/WebGL, Node.js 22, Playwright, GitHub Actions.

---

### Task 1: Lossless, exhaustive, cancellable history storage

**Files:**
- Modify: `components/photoshop/editor-history-storage.ts`
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `tests/editor-history-storage.spec.ts`
- Create: `tests/editor-history-pixel-fidelity.spec.ts`

- [ ] Add regression tests proving PNG encoding is requested, every canvas-bearing history field is traversed, cancellation prevents late blob publication, release cancels pending work, and restored deterministic RGBA pixels are byte-identical.
- [ ] Run the focused tests and confirm they fail on WebP-only/layer-canvas-only behavior.
- [ ] Add one mutable-canvas visitor used by compression, restoration, release, and estimation.
- [ ] Introduce per-history compression controllers with generation/liveness checks and cancellation on branch trim, reset, purge, close, and undo-limit trim.
- [ ] Encode with `image/png`; restore all traversed placeholders; release all traversed blobs.
- [ ] Run:
  `npx playwright test tests/editor-history-storage.spec.ts tests/editor-history-pixel-fidelity.spec.ts --config=playwright.node.config.ts`
  and expect all tests to pass.

### Task 2: Pure editor transitions and post-commit effects

**Files:**
- Create: `components/photoshop/editor-transition-effects.ts`
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `tests/editor-document-lifecycle.spec.ts`
- Modify: `tests/editor-history-storage.spec.ts`

- [ ] Add tests for deterministic clocks and for compression/release effects executing exactly once after a transition.
- [ ] Confirm the tests fail while the reducer directly calls `Date.now`, blob release, and compression scheduling.
- [ ] Add `transitionEditorState(state, action, services)` returning `{ state, effects }`.
- [ ] Keep the exported compatibility reducer pure by using deterministic/default transition services and execute effects only in the provider dispatch runner.
- [ ] Move history compression/release and reducer timestamps into effect descriptors/injected clock calls.
- [ ] Run focused lifecycle/history tests.

### Task 3: Paid capability authorization and bounded service state

**Files:**
- Create: `lib/server-capabilities.ts`
- Create: `lib/rate-limit-store.ts`
- Modify: `lib/marketing-store.ts`
- Modify: `app/api/photoshop/generative-fill/route.ts`
- Modify: `components/photoshop/generative-fill-engine.ts`
- Modify: `tests/marketing-security.spec.ts`
- Modify: `docs/deployment-persistence.md`
- Modify: `.env.example` if present

- [ ] Add failing tests for headerless rejection, missing/expired/invalid capability rejection, valid signed capability acceptance, bounded local buckets, shared-store delegation, account/day/concurrency controls, and normal upstream forwarding.
- [ ] Implement HMAC-SHA256 short-lived capabilities scoped to `generative-fill`, with subject, expiry, nonce, and constant-time signature verification.
- [ ] Require `GENERATIVE_FILL_CAPABILITY_SECRET` whenever the upstream key is configured and reject absent browser metadata before parsing/forwarding.
- [ ] Add a bounded local rate limiter and an adapter contract for shared production rate limiting; fail closed in production when only the local adapter is configured.
- [ ] Key limits and spend/concurrency guards by authenticated subject plus trusted client identity.
- [ ] Document required production auth, durable rate limiting, account spend limits, concurrency, and local-only persistence.
- [ ] Run `npx playwright test tests/marketing-security.spec.ts`.

### Task 4: Complete PR test mapping and visual CI

**Files:**
- Modify: `scripts/select-pr-tests.mjs`
- Modify: `tests/pr-test-selection.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

- [ ] Add failing selector tests for API/browser-suite separation, all production subsystem mappings, an unmapped production fallback, and documentation-only no-op behavior.
- [ ] Return separate node and browser commands, always mapping `app/api/**` and `lib/marketing-store.ts` to `tests/marketing-security.spec.ts` under the normal config.
- [ ] Add mappings for sanitization, compositor/WebGL, color/high-bit, storage/performance, panels/timeline, shared types, and scripts/config.
- [ ] Add a broad non-visual fallback for any unmatched production source.
- [ ] Add a visual CI job on UI-affecting pull requests and scheduled/manual baseline verification on the snapshot OS/browser.
- [ ] Run `npx playwright test tests/pr-test-selection.spec.ts --config=playwright.node.config.ts`.

### Task 5: Route-aware production bundle budgets

**Files:**
- Create: `scripts/measure-route-bundles.mjs`
- Modify: `scripts/analyze-bundle.mjs`
- Modify: `tests/architecture-gates.spec.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] Add failing static tests for per-route budgets and runtime resource measurement fields.
- [ ] Start the built app on an isolated port, visit `/`, `/editor`, `/marketing`, and `/documentation` in Chromium, and collect encoded transfer bytes, decoded body bytes, JS request count, largest startup chunk, and resource URLs.
- [ ] Keep decoder/late-loaded resources separate from startup and merge client-reference/source-map/stats ownership into each route report.
- [ ] Enforce per-route environment-configurable baselines, including `/editor`, with actionable violations naming the route and chunk/module owners.
- [ ] Make CI run the production server-backed analyzer after build.
- [ ] Run build and bundle analysis and inspect `artifacts/bundle-report.json`.

### Task 6: Reduce eager menu/editor startup coupling

**Files:**
- Create: `components/photoshop/menus/document-command-service.ts`
- Create: `components/photoshop/menus/image-command-service.ts`
- Create: `components/photoshop/menus/type-command-service.ts`
- Create: `components/photoshop/menus/advanced-command-service.ts`
- Modify: `components/photoshop/menu-bar.tsx`
- Modify: `tests/menu-command-access.spec.ts`

- [ ] Add tests proving command implementations remain reachable while heavy engines are absent from eager menu imports.
- [ ] Move heavy document I/O, tool-helper, typography, and advanced-subsystem calls behind command-service functions using conditional dynamic imports.
- [ ] Keep menu definitions and lightweight types eager; preload command modules on relevant menu focus where useful.
- [ ] Run menu command and smoke tests.

### Task 7: Focus editor state/canvas/menu responsibilities and selectors

**Files:**
- Create focused modules under `components/photoshop/canvas/`, `components/photoshop/editor/`, and `components/photoshop/menus/`
- Modify: `components/photoshop/canvas-view.tsx`
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `components/photoshop/menu-bar.tsx`
- Modify read-heavy panels/shell consumers currently importing `useEditor`
- Modify: `scripts/architecture-budgets.json`
- Modify: `tests/architecture-gates.spec.ts`

- [ ] Extract pointer lifecycle, cursor state, overlay geometry, and render scheduling from `canvas-view.tsx`.
- [ ] Extract pure history/document transitions and provider persistence/action effects from `editor-context.tsx`.
- [ ] Extract menu data/commands/dialog state from `menu-bar.tsx`.
- [ ] Add command-only and focused selector hooks, then migrate at least thirteen read-heavy consumers.
- [ ] Lower budgets to at most 20 oversize files, 60 broad `useEditor` importers, and 32,000 top-ten lines.
- [ ] Run architecture, type, focused UI, and smoke tests.

### Task 8: Production persistence adapters and atomic semantics

**Files:**
- Create: `lib/record-store.ts`
- Modify: `lib/marketing-store.ts`
- Modify API routes under `app/api/`
- Modify: `tests/marketing-security.spec.ts`
- Modify: `docs/deployment-persistence.md`

- [ ] Add adapter-contract tests for atomic deduplication, quotas, bounded rate limiting, and local/demo selection.
- [ ] Put the JSONL implementation behind the adapter and make production require an explicitly configured durable adapter.
- [ ] Keep local development behavior unchanged and bounded.
- [ ] Run marketing/security tests.

### Task 9: Documentation, dead scaffold prevention, and dependency policy

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Delete: `components/ui/use-toast.ts`
- Delete: `components/ui/use-mobile.tsx`
- Delete: `styles/globals.css`
- Create: `scripts/check-unused-scaffolds.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify dependency manifests only for verified compatible patch/minor upgrades

- [ ] Add a failing check for the three confirmed duplicate scaffold files and future configured dead paths.
- [ ] Remove the files and wire the check into verification/CI.
- [ ] Update contributor guidance for WebGL, color/high-bit/PSD support, lossless history, effect runners, route-aware budgets, and current key files.
- [ ] Apply compatible patch/minor updates; keep high-risk majors as independently testable migrations and document why they are not silently combined.
- [ ] Run audits, corpus/focused tests for changed decoder/format dependencies, build, and smoke tests.

### Task 10: Final reconciliation

**Files:**
- Modify: `docs/codebase-deep-analysis-report-2026-06-29-codex.md`

- [ ] Re-read every recommendation and link it to an implementation/test or an explicit production adapter contract.
- [ ] Run `npm.cmd run doctor`, `npm.cmd run lint:strict`, `npm.cmd run typecheck`, `npm.cmd run check:capabilities`, `npm.cmd run check:architecture`, `npm.cmd run build`, `npm.cmd run analyze:bundle`, `npm.cmd audit`, focused suites, smoke, static-export smoke, and visual tests where the snapshot platform matches.
- [ ] Record implemented status, commands, and any environment-bound proof gaps in the report without claiming unrun checks.
