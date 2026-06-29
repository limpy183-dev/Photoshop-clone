# Deep Codebase Analysis and Improvement Report

Generated: 2026-06-29

Scope: current working tree at `C:\Users\damia\Desktop\AI_Projects\Photoshop\Claude_code_Pohotoshop_continuingfromopus4.7`. Generated/runtime-heavy paths were excluded from source-size interpretation: `.git`, `.next`, `.superpowers`, `.tocodex`, `node_modules`, `out`, `public/vendor`, `test-results`, and `tocodex-docs`. The worktree was already dirty before analysis, so this report describes the current local tree rather than a clean `main`.

## Executive Summary

This is a large browser-native Photoshop-style editor with mature engineering guardrails. It is a Next.js 16, React 19, TypeScript, Canvas/WebGL, worker-backed editor with a broad Photoshop-inspired tool surface, heavy document-format handling, plugin/automation compatibility layers, static export support, and a sizable Playwright suite.

The overall codebase is in good condition: lint, typecheck, capability reconciliation, production build, bundle budgets, audits, smoke tests, static-export smoke, visual regression, security/API slices, plugin slices, and history fidelity checks pass locally.

The one current hard failure is the architecture gate. `npm.cmd run check:architecture` fails because the top-ten largest Photoshop source files total 36,052 lines against a budget of 36,016. The corresponding `tests/architecture-gates.spec.ts` suite fails for the same reason. CI's quality job runs this gate before build, so the current tree would fail that job until the budget is either reduced by code extraction or explicitly rebaselined.

The highest-return improvements are:

1. Fix the architecture budget failure by extracting at least 36 lines from the top-ten files, preferably from `menu-bar.tsx`, `editor-context.tsx`, or `canvas-view.tsx`.
2. Continue decomposing the largest orchestration files and ratchet budgets down after each extraction.
3. Continue migrating broad `useEditor()` consumers to selectors/command-only hooks.
4. Add real ownership attribution for the largest non-decoder startup chunks.
5. Move reducer side effects toward a pure-transition plus effect-runner model over time.
6. Keep production server adapters and paid capability configuration fail-closed.

## Repository Snapshot

Measured text inventory, including docs and package metadata but excluding generated/runtime-heavy directories:

| Area | Files | Lines |
| --- | ---: | ---: |
| Total measured scope | 647 | 248,826 |
| `components` | 402 | 190,106 |
| `tests` | 140 | 32,274 |
| `docs` | 51 | 8,986 |
| `scripts` | 12 | 1,937 |
| `app` | 12 | 1,762 |
| `lib` | 5 | 645 |
| `hooks` | 2 | 218 |
| `types` | 3 | 57 |

Primary extension mix:

| Extension | Files | Lines |
| --- | ---: | ---: |
| `.ts` | 377 | 136,132 |
| `.tsx` | 192 | 88,007 |
| `.json` | 5 | 11,722 |
| `.md` | 56 | 9,579 |
| `.mjs` | 14 | 2,192 |
| `.css` | 1 | 1,113 |

Architecture gate snapshot:

| Signal | Current | Budget | Result |
| --- | ---: | ---: | --- |
| Import cycles | 0 | 0 | Pass |
| Raw `ps-*` events | 0 | 0 | Pass |
| Raw `ps-*` listeners | 0 | 0 | Pass |
| Direct client storage outside adapter | 0 | 0 | Pass |
| Files over 1,500 lines | 24 | 24 | Pass, no headroom |
| Broad `useEditor` import files | 60 | 60 | Pass, no headroom |
| Top-ten largest files | 36,052 lines | 36,016 lines | Fail |

Largest Photoshop source files:

| File | Lines |
| --- | ---: |
| `components/photoshop/canvas-view.tsx` | 6,435 |
| `components/photoshop/editor-context.tsx` | 4,853 |
| `components/photoshop/menu-bar.tsx` | 4,028 |
| `components/photoshop/raster-codecs.ts` | 3,804 |
| `components/photoshop/advanced-subsystems-dialog.tsx` | 3,531 |
| `components/photoshop/document-io.ts` | 3,049 |
| `components/photoshop/tool-helpers.ts` | 2,892 |
| `components/photoshop/filters/registry-helpers.ts` | 2,613 |
| `components/photoshop/advanced-subsystems.ts` | 2,469 |
| `components/photoshop/typography-engine.ts` | 2,378 |

## Verification Results

| Check | Result |
| --- | --- |
| Node/npm | Node 22.23.1, npm 11.5.2 |
| `npm.cmd run doctor` | Pass |
| `npm.cmd run lint:strict` | Pass |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run check:capabilities` | Pass, 72 capability records and 13 advanced-format entries |
| `npm.cmd run check:unused-scaffolds` | Pass |
| `npm.cmd audit --omit=dev` | Pass, 0 vulnerabilities |
| `npm.cmd audit` | Pass, 0 vulnerabilities |
| `npm.cmd run build` | Pass |
| `npm.cmd run analyze:bundle` | Pass |
| `npm.cmd run test:smoke` | Pass, 9 tests |
| `npm.cmd run test:static-export:smoke` | Pass, 3 tests |
| `npm.cmd run test:visual` | Pass, 2 tests |
| `npx.cmd playwright test --list` | 1,024 tests in 139 files |
| `tests/architecture-gates.spec.ts` | Fail, 1 failed / 5 passed |
| `tests/marketing-security.spec.ts` | Pass, 16 tests |
| `tests/editor-history-storage.spec.ts` | Pass, 6 tests under node config |
| `tests/editor-history-pixel-fidelity.spec.ts` | Pass, 1 browser test |
| `tests/pr-test-selection.spec.ts` | Pass, 5 tests |
| `tests/plugin-system.spec.ts` + `tests/plugin-host-contract.spec.ts` | Pass, 34 tests |
| `tests/security-regression-limits.spec.ts` | Pass, 9 tests |

Not run: full non-visual Playwright execution. It currently lists 1,024 tests and is already sharded on pushes to `main`.

## Strengths to Preserve

### Browser-boundary honesty

`BOUNDARIES.md` clearly separates browser-achievable work from proprietary Adobe services, native plugin runtimes, certified CMM behavior, professional codec guarantees, and exact native Photoshop algorithm parity. This is important product governance and should remain central.

### Guardrails with teeth

The repo has strict lint, typecheck, capability reconciliation, architecture budgets, unused-scaffold checks, route-aware bundle budgets, build checks, smoke tests, static-export smoke, visual regression, targeted PR selection, and full Playwright sharding on `main`.

### History fidelity has improved

History compression now uses raw RGBA deflate with PNG fallback rather than lossy WebP. Compression visits every canvas-bearing history field, can be cancelled, and checks released-entry liveness before publishing blobs. The browser pixel-fidelity test confirms a deterministic 128x128 RGBA round trip restores every channel exactly.

### Paid server capability is much safer

The model-backed generative-fill route now requires same-origin/fetch metadata, a signed short-lived `generative-fill` capability, shared rate limiting in production, daily quotas, and bounded per-subject concurrency before forwarding to the upstream endpoint.

### Plugin and import boundaries are well tested

Plugin manifests, panel messages, storage patches, UI trees, replayed request IDs, source-window validation, token validation, oversized payloads, unsupported methods, and dangerous JSON keys have focused tests. Project/file import paths enforce size, dimension, layer, channel, smart-filter, storage, and schema limits.

### CI has better test selection and visuals

PR test selection now splits browser and node commands, includes `marketing-security.spec.ts` for API/security changes, covers more production subsystems, and falls back to broad non-visual browser tests for unmatched production source files. CI also has a dedicated Windows visual-regression job for PRs, schedules, and manual runs.

## Priority Findings and Recommendations

### P0 - Fix the failing architecture gate

Evidence:

- `scripts/architecture-budgets.json` sets `topLargestFiles.maxTotalLines` to 36,016.
- `scripts/check-architecture.mjs` reports the current top ten at 36,052 lines.
- `tests/architecture-gates.spec.ts` fails because the script exits with status 1.
- The CI quality workflow runs `npm run check:architecture` before build.

Impact:

The local tree currently fails the same architecture gate that CI enforces. This is not a theoretical cleanup item; it blocks a normal quality run.

Recommended change:

Extract at least 36 lines from one or more top-ten files without rebaselining the budget upward. The best near-term target is `menu-bar.tsx`, because command-service lazy-loading has already started and the next extraction can preserve behavior while moving menu dialog state or command handlers into focused modules. If the growth is intentional and urgent, rebaseline the budget explicitly in the same PR with a short note, but that should be treated as debt.

Success criterion:

`npm.cmd run check:architecture` and `npx.cmd playwright test tests/architecture-gates.spec.ts --config=playwright.node.config.ts` both pass.

### P1 - Continue decomposing orchestration files

The repo is healthy for its size, but the largest files are still ownership bottlenecks:

- `canvas-view.tsx`: rendering, pointer lifecycle, active tool routing, overlays, transform/text editing, cursor state, and scheduling.
- `editor-context.tsx`: document lifecycle, reducer, history, actions, persistence, render subscriptions, helpers, and selector store.
- `menu-bar.tsx`: menu state, save/open flows, command routing, dialog launch state, plugin commands, and workspace/recent-document behavior.

Recommended slices:

- Move remaining menu command execution and dialog launch state out of `menu-bar.tsx`.
- Split `canvas-view.tsx` by pointer lifecycle, tool handlers, overlays, transform/text state, and render scheduling.
- Split `editor-context.tsx` into pure transitions, effect execution, history lifecycle, document lifecycle, action playback, persistence, and public hooks.
- Keep facade APIs stable and add focused characterization tests as files are extracted.
- Lower `scripts/architecture-budgets.json` after each successful extraction.

Suggested next budget milestones:

| Metric | Current | Next | Later |
| --- | ---: | ---: | ---: |
| Files over 1,500 lines | 24 | 20 | 15 |
| Broad `useEditor` import files | 60 | 50 | 40 |
| Top-ten largest files | 36,052 | 34,000 | 30,000 |

### P1 - Continue selector migration

Selector migration is real: `history-panel.tsx` now uses focused history hooks, and the architecture budget has dropped to 60 broad import files. However, several high-fanout components still subscribe broadly:

- `options-bar.tsx`
- `layers-panel.tsx`
- `properties-panel.tsx`
- `command-palette.tsx`
- `tool-palette.tsx`
- `canvas-view.tsx`

Also, `useToolState()` is a named helper hook but still calls `useEditor()` internally, so it does not yet avoid broad context invalidation.

Recommended change:

Convert read-heavy components to `useEditorSelector` or focused hooks. For write-heavy components, expose command-only hooks so dispatching commands does not require subscribing to the full editor value. Prioritize `options-bar.tsx` and `properties-panel.tsx`, because they read many frequently changing tool and document fields.

Success criterion:

The `useEditorImports` budget drops below 50 without replacing the existing reducer architecture.

### P1 - Improve bundle ownership attribution

Route-aware bundle measurement now passes and is much more useful than legacy initial-JS accounting:

| Route | Encoded | Decoded | Requests | Largest startup chunk |
| --- | ---: | ---: | ---: | --- |
| `/` | 165.3 KiB | 550.4 KiB | 11 | `3794...js` |
| `/editor` | 686.0 KiB | 2,295.0 KiB | 14 | `4067...js` |
| `/marketing` | 208.0 KiB | 657.5 KiB | 15 | `3794...js` |
| `/documentation` | 140.1 KiB | 466.6 KiB | 10 | `3794...js` |

Remaining issue:

The largest non-decoder editor startup chunk, `.next/static/chunks/4067...js`, is about 1.31 MiB decoded and still has no manifest, sourcemap, or webpack-stats module attribution in `artifacts/bundle-report.json`.

Recommended change:

Generate a dedicated analysis build with production source maps or webpack stats and wire that into `scripts/analyze-bundle.mjs` so shared chunks list owning modules. Then add a budget for largest non-decoder app-owned startup chunk.

Success criterion:

The report can name the source modules responsible for `4067...js`, not just its size.

### P2 - Move reducer side effects toward explicit effects

`editor-context.tsx` intentionally runs the real reducer once outside React's `useReducer`, because the reducer is impure: it calls `Date.now`, releases blobs, schedules history compression, and creates IDs. The current workaround is documented and behavior-tested, but it keeps transition logic and effects coupled.

Recommended change:

Introduce a pure transition function that returns `{ state, effects }`, then run compression, blob release, persistence, timestamps, and other external work after state commit. Inject clock/ID services where deterministic tests need them. This can be incremental: start with history push/reset/purge effects.

Success criterion:

React can no longer accidentally double-run side effects if state transition execution changes, and reducer tests can assert state without scheduling browser work.

### P2 - Keep server adapters fail-closed in production

The route code and deployment docs have moved in the right direction:

- production marketing storage refuses local JSONL fallback unless explicitly allowed;
- production server rate limiting refuses in-process fallback unless explicitly allowed;
- generative fill requires `GENERATIVE_FILL_CAPABILITY_SECRET` and shared rate limiting in production.

Recommended change:

Before any real production deployment, provide concrete durable adapters for `MARKETING_RECORD_STORE_URL` and `RATE_LIMIT_SERVICE_URL`, plus monitoring for adapter outages, quota rejections, and paid-provider spend. Keep local/demo fallbacks separate from production docs.

Success criterion:

A public production deployment cannot silently fall back to local process memory or local JSONL files for rate limiting, paid API controls, subscriber records, or feedback records.

### P2 - Keep focused tests aligned with runtime needs

The new `tests/editor-history-pixel-fidelity.spec.ts` is a browser test because it navigates to `/` and uses page APIs. It fails under `playwright.node.config.ts` but passes under the normal browser config. The PR selector currently covers editor history with node tests; if browser-only history fidelity should run for editor/history changes, add it to the selector as a browser test.

Recommended change:

Add a browser-test bucket for `tests/editor-history-pixel-fidelity.spec.ts` when `components/photoshop/editor-history-storage.ts` or history-sensitive editor files change.

Success criterion:

The browser-only pixel-fidelity check runs automatically for history storage changes.

### P3 - Burn down source hygiene exceptions

Quick scan results:

- no source hits for `@ts-ignore`, `@ts-expect-error`, or `dangerouslySetInnerHTML`;
- no broad `any` patterns from the quick regex scan;
- 9 `react-hooks/exhaustive-deps` suppressions remain;
- one isolated `new Function` dynamic-import shim remains in `raster-codecs.ts`.

Recommended change:

Review the hook dependency suppressions and either remove them or document the invariant next to each suppression. Keep the dynamic-import shim isolated and covered by format/import tests.

### P3 - Upgrade dependencies in risk-based batches

Audits are clean, but `npm outdated --json` reports normal drift and several major upgrades:

- lower-risk patch/minor: `typescript-eslint`, `libraw-wasm`, `tw-animate-css`;
- UI/runtime majors: Radix components, `react-resizable-panels`, `sonner`, `lucide-react`, `@vercel/analytics`;
- compatibility majors: `ag-psd`, `pdfjs-dist`, `zod`, `typescript`, `@hookform/resolvers`, `@types/node`.

Recommended policy:

- Apply patch/minor tooling updates with lint/typecheck/smoke.
- Batch Radix updates with accessibility and panel tests.
- Treat `ag-psd`, `pdfjs-dist`, Zod 4, TypeScript 6, and panel/layout majors as separate migration branches with fixture-backed tests.
- Do not upgrade decoder/format dependencies without corpus import/export coverage.

## Suggested Delivery Order

### Immediate

1. Fix the top-ten largest-files budget failure.
2. Add `editor-history-pixel-fidelity.spec.ts` to browser-targeted PR selection for history storage changes.
3. Add ownership attribution for the `4067...js` editor startup chunk.

### Short Term

4. Extract another slice from `menu-bar.tsx` and lower the top-ten budget.
5. Convert `useToolState`, `options-bar.tsx`, and `properties-panel.tsx` to selector/command-only hooks.
6. Start moving history reducer side effects into explicit effects.

### Medium Term

7. Push oversized files below 20 and broad `useEditor` importers below 50.
8. Add production-ready rate-limit and marketing-store adapters if server routes will be deployed publicly.
9. Run major dependency upgrades as isolated compatibility projects.

## Success Metrics

- `npm.cmd run check:architecture` passes.
- Top-ten largest source files drop below 34,000 lines.
- Broad `useEditor` import files drop below 50.
- Import cycles, raw `ps-*` events/listeners, and direct storage violations remain at zero.
- `/editor` startup remains under route budgets and has module ownership for its largest app chunk.
- Deep-history pixel restoration remains byte-identical.
- Paid generative fill remains unavailable without a signed, short-lived capability and production shared rate limiting.
- Visual regression remains automated in CI.
- Production and full dependency audits remain at zero vulnerabilities.

## Final Assessment

The current tree is much healthier than the previous deep-analysis baseline: history fidelity, paid capability protection, PR test selection, route bundle measurement, visual CI, deployment docs, and contributor docs have all improved. The main issue is now concentrated architecture debt, and one budget has crossed from "tight" into "failing." Fix that first, then keep reducing broad context subscriptions and oversized orchestration files with small, behavior-preserving extractions.

## Implementation Reconciliation

Updated: 2026-06-29

Implemented local remediation:

- Architecture budgets now enforce 20 files over 1,500 lines, 50 broad `useEditor` import files, and 34,000 top-ten source lines.
- Current architecture result: 20/20 oversize files, 49/50 broad `useEditor` imports, and 33,969/34,000 top-ten lines.
- `useToolState()` now uses focused selectors instead of a broad `useEditor()` read.
- PR selection now runs `tests/editor-history-pixel-fidelity.spec.ts` as a browser command for `components/photoshop/editor-history-storage.ts` changes without adding that browser test to unrelated editor/security changes.
- Menu, plugin workspace, documentation data, export dialog, quick-selection diagnostics, quick-selection helpers, and photo workflow transform code were extracted into focused modules while preserving existing facade exports.
- Production fail-closed capability/rate-limit/marketing-store adapter behavior is covered by `tests/marketing-security.spec.ts`.

Verification run after remediation:

- `npm.cmd run doctor`
- `npm.cmd run lint:strict`
- `npm.cmd run typecheck`
- `npm.cmd run check:capabilities`
- `npm.cmd run check:unused-scaffolds`
- `npm.cmd run check:architecture`
- `npm.cmd run build`
- `npm.cmd run analyze:bundle`
- `npm.cmd audit`
- `npx.cmd playwright test tests/architecture-gates.spec.ts --config=playwright.node.config.ts`
- `npx.cmd playwright test tests/pr-test-selection.spec.ts --config=playwright.node.config.ts`
- `npx.cmd playwright test tests/selection-masking-quality.spec.ts --config=playwright.node.config.ts`
- `npx.cmd playwright test tests/content-aware-photo-workflows.spec.ts --config=playwright.node.config.ts`
- `npx.cmd playwright test tests/marketing-security.spec.ts`
- `npx.cmd playwright test tests/editor-history-storage.spec.ts --config=playwright.node.config.ts`
- `npx.cmd playwright test tests/editor-history-pixel-fidelity.spec.ts`
- `npm.cmd run test:smoke`
- `npm.cmd run test:static-export:smoke`
- `npm.cmd run test:visual`

Proof gap:

- `scripts/analyze-bundle.mjs` supports client-reference, sourcemap, and webpack-stats ownership fields, but the current build artifact still lacks sourcemap/webpack owner samples for the largest non-decoder app chunk. Do not treat the large app chunk's exact module ownership as proven until a source-map or webpack-stats build is supplied to the analyzer.
