# Codebase Bug and Error Analysis Report

Generated: 2026-06-29

Scope: current local working tree at `C:\Users\damia\Desktop\AI_Projects\Photoshop\Claude_code_Pohotoshop_continuingfromopus4.7`. The tree was already dirty before this analysis, so this report describes the current local state rather than a clean branch baseline. Generated/runtime-heavy directories such as `.next`, `node_modules`, `out`, and `test-results` were treated as build artifacts, not source ownership.

## Executive Summary

The codebase is in strong operational shape. I did not find any current build-breaking, type-breaking, lint-breaking, architecture-gate, smoke-test, static-export, visual-regression, dependency-audit, import-hardening, plugin-boundary, or core image-workflow failure in the current tree.

The main actionable bugs I found are narrower:

1. P2: the model-backed generative-fill endpoint consumes the daily quota before validating the request body and before checking concurrency, so invalid, oversized, or concurrency-rejected requests can burn a user's paid daily quota without reaching the upstream model.
2. P2: the remote rate-limit adapter drops `reason` values returned by a configured rate-limit service when that service responds with HTTP 200 and `{ allowed: false, reason: "unavailable" | "capacity" }`, causing callers to report a normal 429 instead of a 503 outage/capacity failure.
3. P3: one video-render export path leaks object URLs by calling `downloadDataUrl(URL.createObjectURL(blob), ...)` directly instead of `downloadBlob(...)`, which is the helper that revokes blob URLs.
4. P3: the exported File System Access project picker still advertises the stale `.psproj` extension while the active project format uses `.psprojson`.

No P0/P1 defects were found in this pass.

## Verification Run

| Check | Result |
| --- | --- |
| `npm.cmd run doctor` | Pass, Node 22.23.1 and npm 11.5.2 match repo requirements |
| `npm.cmd run lint` | Pass |
| `npm.cmd run lint:strict` | Pass, zero warnings |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run check:capabilities` | Pass, 72 capability records and 13 advanced-format entries |
| `npm.cmd run check:architecture` | Pass, no import cycles; top 10 largest files 33,969/34,000 lines |
| `npm.cmd run check:unused-scaffolds` | Pass |
| `npm.cmd run build` | Pass |
| `npm.cmd run analyze:bundle` | Pass, 138 client chunks, `/editor` 775.8 KiB encoded startup JS |
| `npm.cmd run test:smoke` | Pass, 9 tests |
| `npm.cmd run test:static-export:smoke` | Pass, 3 tests |
| `npm.cmd run test:visual` | Pass, 2 tests |
| `npm.cmd audit --omit=dev` | Pass, 0 vulnerabilities |
| `npm.cmd audit` | Pass, 0 vulnerabilities |
| `npx.cmd playwright test --list` | 1,025 tests in 139 files |

Targeted suites also passed:

- `tests/architecture-gates.spec.ts`, `tests/pr-test-selection.spec.ts`, `tests/editor-history-storage.spec.ts` under `playwright.node.config.ts`: 18 passed.
- `tests/marketing-security.spec.ts`, `tests/security-regression-limits.spec.ts`, `tests/import-hardening.spec.ts`, `tests/document-io-preflight.spec.ts`, `tests/project-json-sanitizer.spec.ts`: 43 passed.
- `tests/plugin-system.spec.ts`, `tests/plugin-host-contract.spec.ts`: 34 passed.
- `tests/menu-command-access.spec.ts`: 8 passed.
- `tests/editor-history-pixel-fidelity.spec.ts`, `tests/brush-preset-color-fidelity.spec.ts`, `tests/content-aware-photo-workflows.spec.ts`, `tests/photo-workflow-depth.spec.ts`: 24 passed.
- `tests/image-algorithm-coverage.spec.ts`, `tests/selection-mask-algorithms.spec.ts`, `tests/selection-masking-quality.spec.ts` under `playwright.node.config.ts`: 24 passed.

Not run: the full unsharded non-visual Playwright suite. It currently lists 1,025 tests and is intended to run sharded in CI on `main` pushes.

## Findings

### P2 - Invalid or concurrency-rejected generative-fill requests consume daily quota

Evidence:

- `app/api/photoshop/generative-fill/route.ts:113` computes `dailyLimit`.
- `app/api/photoshop/generative-fill/route.ts:114` through `app/api/photoshop/generative-fill/route.ts:117` consumes the daily quota with `checkServerRateLimit("genfill:day:...")`.
- Request body reading does not start until `app/api/photoshop/generative-fill/route.ts:132`.
- Schema validation does not happen until `app/api/photoshop/generative-fill/route.ts:148`.
- Concurrency rejection does not happen until `app/api/photoshop/generative-fill/route.ts:156` through `app/api/photoshop/generative-fill/route.ts:163`.
- The upstream paid call starts only at `app/api/photoshop/generative-fill/route.ts:168`.

Impact:

A caller with a valid capability can exhaust their daily quota using malformed JSON, schema-invalid payloads, over-large payloads, or requests rejected by the local concurrency gate. Those requests return 400, 413, or 429 and never reach the model endpoint, but the daily quota bucket has already been incremented. This makes quota behavior surprising and creates an avoidable denial-of-service path against a user's paid capability.

Recommendation:

Keep the minute-level abuse limiter before body parsing if desired, but move the daily paid quota check until after `readJsonWithLimit`, `GenerativeFillSchema.safeParse`, and `acquireConcurrencySlot` succeed. Ideally the quota should be consumed as close as possible to the upstream `fetch(endpoint, ...)`, or use a reservation API that can be released when no upstream attempt is made.

Suggested regression test:

- Configure local server rate limiting and `GENERATIVE_FILL_DAILY_REQUEST_LIMIT=1`.
- Send one authenticated request with invalid JSON or invalid schema.
- Send one authenticated valid request.
- Assert the invalid request does not consume the daily quota and the valid request is not rejected as `Daily generative fill quota exceeded.`

### P2 - Remote rate-limit adapter loses outage/capacity reasons from successful JSON responses

Evidence:

- `lib/rate-limit-store.ts:42` maps non-2xx rate-limit-service responses to `{ allowed: false, reason: "unavailable" }`.
- `lib/rate-limit-store.ts:43` parses a 2xx JSON response as `RateLimitDecision`.
- `lib/rate-limit-store.ts:44` through `lib/rate-limit-store.ts:49` preserves only `allowed` and `retryAfterSeconds`, dropping `result.reason`.
- `app/api/photoshop/generative-fill/route.ts:103` through `app/api/photoshop/generative-fill/route.ts:109` and `app/api/photoshop/generative-fill/route.ts:121` through `app/api/photoshop/generative-fill/route.ts:127` rely on `reason` to decide whether to return 503 service-unavailable versus 429 rate-limited.

Impact:

If a shared Redis/edge rate-limit service reports a soft failure with HTTP 200 and `{ allowed: false, reason: "unavailable" }`, this adapter converts it to a normal rate-limit denial. The generative-fill route then returns 429 instead of 503, making service outages look like user throttling and sending the wrong retry semantics to clients and monitoring.

Recommendation:

Validate and preserve remote `reason` when `allowed === false`:

```ts
return result.allowed
  ? { allowed: true }
  : {
      allowed: false,
      reason: result.reason,
      retryAfterSeconds: Math.max(1, Number(result.retryAfterSeconds) || 1),
    }
```

Also reject malformed successful JSON responses as `{ allowed: false, reason: "unavailable" }`.

Suggested regression test:

- Stub `global.fetch` for `RATE_LIMIT_SERVICE_URL` to return `200` with `{ "allowed": false, "reason": "unavailable", "retryAfterSeconds": 7 }`.
- Assert `checkServerRateLimit(...)` returns `reason: "unavailable"` and `retryAfterSeconds: 7`.

### P3 - Video render export leaks object URLs

Evidence:

- `components/photoshop/document-file-system.ts:25` through `components/photoshop/document-file-system.ts:31` show that `downloadBlob` creates a blob URL and schedules `URL.revokeObjectURL`.
- `components/photoshop/document-file-system.ts:13` through `components/photoshop/document-file-system.ts:18` show that `downloadDataUrl` only clicks the URL and does not revoke object URLs.
- `components/photoshop/advanced-subsystems-dialog.tsx:753` calls `downloadDataUrl(URL.createObjectURL(blob), ...)` directly after MediaRecorder export.
- A repo-wide search found this as the only `downloadDataUrl(URL.createObjectURL(...))` source hit.

Impact:

Each rendered video export can keep the recorded Blob alive for the life of the tab. For large timeline renders or repeated export attempts, this can steadily increase memory pressure in the editor.

Recommendation:

Replace the call with:

```ts
downloadBlob(blob, `${activeDoc.name}-${preset.id}.${ext}`)
```

Suggested regression test:

- Spy on `URL.revokeObjectURL` around the video render download helper path, or extract the small download decision into a function and assert it uses `downloadBlob` for Blob-backed exports.

### P3 - Stale `.psproj` File System Access picker remains exported

Evidence:

- The main menu save path uses `.psprojson` in `components/photoshop/menu-bar.tsx:1608` through `components/photoshop/menu-bar.tsx:1627`.
- `components/photoshop/document-file-system.ts:48` still defaults `showSaveProjectPicker` to `project.psproj`.
- `components/photoshop/document-file-system.ts:55` through `components/photoshop/document-file-system.ts:57` still advertise `accept: { "application/json": [".psproj"] }`.
- `components/photoshop/document-io.ts:201` through `components/photoshop/document-io.ts:209` re-export that helper as part of the document I/O surface.

Impact:

This is not breaking the current menu save flow, but it leaves a public helper/API surface that points users or future callers at the old extension. Any future call site that reaches for `showSaveProjectPicker` will create files that do not match the active project format naming convention.

Recommendation:

Update `showSaveProjectPicker` to default to `project.psprojson` and accept `.psprojson`. If `.psproj` is a legacy extension that should still open, support it explicitly in import/open compatibility rather than as the primary save extension.

## Rechecked Older Findings

The following defects from older local reports appear fixed in the current tree:

- Plugin storage changes are dirty-routed: `set-plugin-storage` is in the dirty-action set and covered by `tests/editor-document-lifecycle.spec.ts`.
- Dirty tracking now receives both pre- and post-reducer state and avoids marking unchanged document identities dirty.
- Project embedded image data URLs are preflighted before browser decode and covered by `tests/document-io-preflight.spec.ts`.
- Project sanitizer truncation is surfaced through import warnings and covered by `tests/project-json-sanitizer.spec.ts`.
- Architecture budgets pass after the extraction work: 20/20 oversize files, 49/50 broad `useEditor` imports, 33,969/34,000 top-ten source lines.

## Residual Risk

This pass combined repo-wide grep scans, source inspection, production build checks, dependency audits, and targeted Playwright suites. It did not execute all 1,025 Playwright tests locally in one run. The remaining risk is concentrated in paths that are hard to exhaustively exercise locally: long-running browser memory behavior, full import/export corpus coverage, provider-backed generative-fill behavior, and sharded full-suite interactions.

## Recommended Fix Order

1. Move daily generative-fill quota consumption after body/schema validation and concurrency acceptance.
2. Preserve `reason` from the remote rate-limit service and add adapter tests.
3. Replace the direct object URL video download with `downloadBlob`.
4. Update or retire the stale `.psproj` picker helper.
