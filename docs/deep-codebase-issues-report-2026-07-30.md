# Photoshop Clone: Deep Codebase Issues Report

**Review date:** 2026-07-30  
**Repository:** `limpy183-dev/Photoshop-clone`  
**Baseline reviewed:** default branch at commit `796de2242302c6db7bc6ad42a49b133cb29a3328`  
**Review type:** static architecture/code review, existing test and audit evidence synthesis, targeted source inspection  
**Status:** findings are prioritized for engineering follow-up; no production code was changed by this audit.

## Executive summary

This is a surprisingly ambitious browser image editor with a strong typed action model, broad workflow coverage, explicit capability reporting, worker/tile planning, and a real test suite. The biggest problem is not missing UI surface. It is correctness at the boundaries: asynchronous state transitions, save/recovery identity, pixel-storage eviction, render-backend consistency, format fidelity, static deployment, and test confidence.

The highest-risk defects can lose user data or create false confidence:

1. **P0: tiled eviction can destroy pixels** if persistence is unavailable or fails before a tile is cleared.
2. **P0: save completion can mark newer unsaved edits as saved.**
3. **P0: the reducer is invoked twice despite being impure**, allowing divergent IDs/timestamps and duplicate async compression.
4. **P0: GitHub Pages can ship a UI whose newsletter APIs cannot work**, and base-path handling has historically produced root-relative links/assets.
5. **P1: delayed history restore and save/generation callbacks can target the wrong document.**
6. **P1: PSD/high-bit/color-management round trips reduce or misrepresent data.**
7. **P1: rendering paths disagree about filters, transforms, halos, fallback allocation, and WebGL lifecycle.**
8. **P1: test/release gates have had concurrency, static-export, and coverage blind spots.**

## Scope and confidence

### Reviewed surfaces

- `app/`, `components/photoshop/`, `lib/`, `hooks/`, `types/`, `scripts/`, `tests/`, deployment workflow, and project documentation.
- State/reducer/history, document I/O, PSD/raster/advanced codecs, tiled backing storage, canvas/rendering, filters/workers, WebGL, autosave/recovery, menus/tabs/panels, API routes, marketing persistence, deployment, and test configuration.
- Existing repository review evidence in `Findings.txt`, plus targeted inspection of `package.json`, `.github/workflows/deploy-pages.yml`, `components/photoshop/tile-store.ts`, `components/photoshop/autosave-recovery.tsx`, `components/photoshop/document-tabs.tsx`, `components/photoshop/resize-handle.tsx`, and the generative-fill route.

### Confidence labels

- **Verified:** directly supported by source behavior or an existing reproducible review result.
- **Strong:** source-level defect with a clear failure path, but runtime reproduction was not performed in this pass.
- **Risk:** architectural or coverage concern requiring focused validation.

### Important limitation

I could not execute `npm run verify` or browser tests in this environment. Runtime claims below are therefore grounded in source inspection and the repository's prior findings, not a fresh local test run.

## Prioritized findings

### P0-01: tiled eviction can silently destroy pixel data

**Confidence:** Verified by source path.  
**Evidence:** `components/photoshop/tile-store.ts`, `acceptResident`, `evict`, `spillSlot`; prior finding identifies the failure when OPFS is disabled or persistence fails.

The store must evict before accepting a new resident tile, but the only safe eviction path is OPFS spill. When OPFS is unavailable, eviction returns false and allocation continues. More importantly, any alternate eviction implementation that clears resident data without a confirmed durable scratch write turns a valid tile into a transparent fabricated tile on the next read. This is a data-loss boundary, not merely a cache miss.

**Impact:** lost pixels in large documents; especially dangerous during brush, filter, or export operations.  
**Fix:** make eviction transactional: write and verify scratch bytes, record the key, then release memory. If persistence fails, retain the tile or reject the allocation. Add fault-injection tests for disabled OPFS, quota failure, partial write, read failure, and dispose races.

### P0-02: reducer double execution with side effects

**Confidence:** Verified by existing review evidence.  
**Evidence:** `components/photoshop/editor-context.tsx` around the dispatch path and reducer ID/timestamp/compression paths.

The context dispatch flow manually invokes the reducer and then routes the action through a raw dispatch that invokes it again. The reducer is not pure: it creates IDs/timestamps and schedules mutable asynchronous compression. Two executions can generate different identifiers, diverge `stateRef` from React state, and schedule overlapping compression against shared snapshots.

**Impact:** corrupted history, leaked blobs, duplicate entries, non-deterministic undo/redo, hard-to-reproduce document divergence.  
**Fix:** make reducer execution single-shot and pure. Generate IDs/timestamps in the command layer before dispatch. Move compression/blob lifetime management into a document-bound history service with cancellation and ownership.

### P0-03: save completion can clear dirty state for edits not written

**Confidence:** Verified by existing review evidence.  
**Evidence:** `components/photoshop/menu-bar.tsx` serialization/completion path and `editor-context.tsx` save-state handling.

The document is serialized before asynchronous picker/file operations finish, but completion records the current history index rather than the serialized revision. Edits made while the save is pending can therefore be marked saved even though they are absent from the file.

**Impact:** silent data loss on close or later save decisions.  
**Fix:** capture `{docId, revision, requestId}` at serialization time. Completion may update `savedRevision` only if the request is still current; otherwise leave the document dirty. Add delayed-save tests with an edit and tab switch between serialization and completion.

### P0-04: Pages deployment has historically broken API-dependent UI and base paths

**Confidence:** Verified by existing deployment review; current workflow has a stronger quality job but still needs deployment-model testing.  
**Evidence:** `.github/workflows/deploy-pages.yml`, `next.config.mjs`, marketing/API callers, and prior generated artifact review.

Static GitHub Pages cannot run Next API routes or middleware. Newsletter/feedback UI that calls `/api/*` cannot work on Pages without a separate backend or static-compatible provider. Base-path deployments are also vulnerable to root-relative anchors and image paths that bypass `/Photoshop-clone`.

**Impact:** production forms fail; links/assets fail only after deployment, while dev tests pass.  
**Fix:** choose one explicit deployment contract: remove/disable server-only features on Pages, use an external endpoint, or deploy the full app to a runtime host. Test the built artifact under the actual `/Photoshop-clone/` base path and assert all internal links/assets are prefixed.

### P1-01: delayed history restore is not document-bound

**Confidence:** Verified by existing review evidence.  
**Evidence:** `editor-context.tsx` undo/decompression path.

Undo captures a document/history entry, awaits decompression, then dispatches a restore action without a document ID or expected history generation. If the user switches tabs before the await resolves, the old snapshot can be applied to the newly active document.

**Impact:** cross-document layer/history corruption.  
**Fix:** include `docId`, `historyGeneration`, and request ID in restore actions; discard stale completions. Cancel pending restores when a document closes or a newer restore begins.

### P1-02: save and asset-generation callbacks can target the active document instead of the requested document

**Confidence:** Verified by existing review evidence.  
**Evidence:** `hooks/use-shortcuts.ts`, `components/photoshop/menu-bar.tsx`, `image-assets-generator-runner.tsx`.

Shortcut save requests omit `docId`; completion re-emits the missing identity and downstream code falls back to whichever document is active. A tab switch during save can generate assets for the wrong document.

**Impact:** wrong file/asset content, misleading success UI.  
**Fix:** resolve and carry `docId` and correlation ID through every request, async boundary, event, completion, and generator call. Reject completions for closed or superseded documents.

### P1-03: dirty tracking is action-name based rather than revision based

**Confidence:** Verified by existing review evidence.  
**Evidence:** `editor-context.tsx` dirty allow-list and plugin-storage paths.

A manually maintained action allow-list creates false negatives for persisted plugin/settings mutations and false positives when a listed action is rejected, such as removing the only layer.

**Impact:** unsaved work may look clean, or harmless/rejected actions may trigger unnecessary save prompts.  
**Fix:** assign each document a monotonic content revision. Increment only when the reducer produces a materially changed document; compare `revision` to `savedRevision`. Keep UI/session preferences outside document dirtiness.

### P1-04: history snapshots omit persisted document state

**Confidence:** Verified by existing review evidence.  
**Evidence:** `types.ts` `PsDocument`, `HistoryEntry`, `makeHistoryEntry`, and File Info workflow.

Timeline, plugins, metadata, color management, print settings, and related persisted fields are present on the document but omitted from the manually duplicated history snapshot. File Info can create a history entry that cannot undo its own changes.

**Impact:** undo is not trustworthy across non-pixel editing workflows.  
**Fix:** define one complete serializable document snapshot contract and version it. Prefer immutable document snapshots or inverse domain operations over hand-maintained subsets.

### P1-05: smart filters can be applied twice in tiled rendering

**Confidence:** Strong.  
**Evidence:** `layer-tile-renderer.ts` materializes smart filters; `tile-only-pipeline.ts` applies them again.

Two rendering layers appear to own smart-filter materialization. The result is duplicate effects, incorrect opacity/strength, and mismatch between tiled and full-canvas paths.

**Impact:** visible fidelity bugs, especially on large documents where tiled mode is selected.  
**Fix:** define a canonical render graph and a single filter ownership contract. Add pixel golden tests comparing tiled, 2D, and WebGL outputs for each smart-filter type.

### P1-06: tile filters lack effect halos and can produce seams

**Confidence:** Strong.  
**Evidence:** `components/photoshop/tile-only-pipeline.ts` filter crop path.

Filters are applied to cropped tiles without neighboring pixels. Blur, sharpen, morphology, shadows, and other neighborhood operations need an effect radius/halo. Dirty invalidation also needs to expand by that radius.

**Impact:** seams at tile edges and stale adjacent pixels after edits.  
**Fix:** model `effectRadius` per operation, read expanded source tiles, crop output back to the target tile, and invalidate neighboring tiles.

### P1-07: cancelled worker filters can fall back to blocking main-thread work

**Confidence:** Strong.  
**Evidence:** `components/photoshop/filter-worker.ts` abort/catch path.

Abort errors reach a catch path that marks the worker failed and runs the filter synchronously. A user cancelling an expensive operation can therefore cause the worst possible fallback: main-thread blocking.

**Impact:** frozen UI and repeated worker death after normal cancellation.  
**Fix:** preserve `AbortError` as cancellation, implement worker-side cancellation or generation tokens, remove abort listeners, and serialize worker startup/recovery.

### P1-08: WebGL resources and capability planning are not deterministic enough

**Confidence:** Strong.  
**Evidence:** `webgl-compositor.ts`, `canvas-view.tsx`.

Transient contexts/canvases, shader programs, buffers, and textures are created across passes, while cleanup is partial. The texture-limit plan assumes 16,384 instead of querying `MAX_TEXTURE_SIZE`, and allocation/framebuffer failures are not consistently handled.

**Impact:** GPU memory leaks, context loss, intermittent black/partial renders, device-specific failures.  
**Fix:** reuse one compositor per document/view, centralize resource ownership, dispose in `try/finally`, handle context loss/restoration, query actual limits, and downgrade to a bounded 2D/tile path when allocations fail.

### P1-09: brush strokes and overlays can allocate unsafe full-document buffers

**Confidence:** Strong.  
**Evidence:** `canvas-view.tsx` stroke/overlay paths and tile-only fallback paths.

Transparency locking, buffered strokes, and overlays clone full layers/documents. An 8192×8192 RGBA surface is about 256 MiB before additional copies, history, decoded images, and GPU resources. Some incompatible tiled paths can still fall back to full-document allocation.

**Impact:** tab crashes, browser OOM, severe input latency.  
**Fix:** use stroke bounds plus padding, tile-local scratch, viewport-sized overlays, and hard allocation checks. Never silently switch from tile mode to a full-document surface.

### P1-10: imported high-bit/non-RGB PSD fidelity is misleading

**Confidence:** Verified by existing review evidence.  
**Evidence:** `document-io.ts`, `high-bit-document.ts`, `psd-native-writer.ts`, `psd-color-modes.ts`, `psd-compatibility.ts`.

16/32-bit imports are rendered through 8-bit browser canvases and later expanded back to declared depth. High-bit/non-RGB PSDs go through a structure-reducing writer that omits or approximates groups, masks, descriptors, paths, guides, channels, print settings, linked resources, and more. ICC bytes are replaced by synthetic identification-only profiles and can be labelled RGB even for CMYK-origin data. HDR values above 1 are clipped before float export.

**Impact:** exports that look valid but are not faithful; professional users can lose editability, gamut, precision, or HDR highlight data.  
**Fix:** preserve native source payloads when untouched, make destructive conversion explicit, retain actual ICC bytes, separate scene-linear float compositing from display clamping, and expand compatibility reports with hard failure vs approximation categories.

### P1-11: project loading and autosave can corrupt or amplify data

**Confidence:** Strong.  
**Evidence:** `document-io.ts`, `types.ts` safe JSON limits, `autosave-recovery.tsx`, `recent-documents.ts`.

Serialization sanitization caps strings, arrays, objects, and nesting in ways that can truncate valid ICC/font/plugin/timeline payloads without a clear rejection. Autosave historically cleared all recovery snapshots when handling one entry or a failure, and synchronous base64/stringification creates multiple full-size copies.

**Impact:** silent project corruption, lost recovery, UI freezes, memory spikes.  
**Fix:** validate against a versioned schema with explicit rejection and user-visible diagnostics; make recovery operations document-scoped; stream/chunk large payloads and use binary storage instead of base64 JSON where possible.

### P1-12: advanced decoders validate dimensions too late

**Confidence:** Strong.  
**Evidence:** `raster-codecs.ts`, `advanced-subsystems.ts`, project import paths.

Several advanced codecs decode before checking dimensions. Compressed file-size limits do not protect against decompressed memory bombs, and project imports can decode layers/channels concurrently with uncapped nested masks.

**Impact:** browser tab memory exhaustion and long CPU stalls on crafted files.  
**Fix:** preflight headers before allocation, cap pixel count and decoded bytes, limit concurrency, abort nested decode work, and fail closed when dimensions are unknown.

### P1-13: deployment/test gates can give false confidence

**Confidence:** Verified by existing review evidence, partly improved in current workflow.  
**Evidence:** `.github/workflows/deploy-pages.yml`, Playwright configs, `eslint.config.mjs`, prior test results.

Prior review found 778 passing and 8 failures in a default run, with isolated/one-worker passes, `reuseExistingServer` collisions, and no effective retries/traces. Static `out/` output polluted lint after builds. Development-server tests did not exercise Pages base paths or headers. The current workflow adds strict lint/typecheck/capability/architecture checks and static smoke, which is a good correction, but it still lacks a clear PR gate and cross-browser/mobile release matrix.

**Impact:** flaky merges, broken deployment behavior escaping CI, slow diagnosis.  
**Fix:** add PR CI, isolated ports, deterministic server lifecycle, retries with traces, static artifact assertions, Firefox/WebKit/mobile smoke, and a small changed-code coverage threshold.

### P1-14: generative-fill relay must fail closed in every deployment

**Confidence:** Current source is materially improved.  
**Evidence:** `app/api/photoshop/generative-fill/route.ts` now includes origin checks, capability verification, schema/body limits, rate/concurrency quotas, timeout, and response-size limits.

This is not an open defect in the inspected route, but it remains a deployment dependency: if server capability issuance, rate-limit storage, or origin/proxy assumptions are misconfigured, the feature should remain unavailable rather than silently becoming an unauthenticated billable relay.

**Action:** add integration tests for missing capability, spoofed origin/forwarding headers, quota adapter outage, oversized upstream streaming responses, and static Pages behavior.

### P2-01: the editor Home workspace is dead code in the shell

**Confidence:** Verified by existing review evidence.  
**Evidence:** `editor-app.tsx`, `canvas-view.tsx`.

Home is lazy-loaded and events update state, but the state was discarded and the component was not rendered. With no documents, the user sees plain canvas text rather than the intended onboarding/home workflow.

**Fix:** render Home when `homeOpen || !activeDoc`, and add a no-document smoke test.

### P2-02: mobile layout collapses the canvas and dialogs

**Confidence:** Verified by prior phone-size inspection.  
**Evidence:** `editor-app.tsx`, `panel-dock.tsx`, `new-document-dialog.tsx`, `filter-gallery.tsx`.

Fixed/non-shrinking rails and docks can consume all width at 394×851, leaving a zero-width canvas. Dialog columns and filter sidebars retain desktop widths, while some controls are unnamed or below touch-target guidance.

**Fix:** mobile-specific dock mode, collapsible rails, min-width guards, responsive dialogs, accessible labels, and geometry assertions rather than existence-only tests.

### P2-03: interaction semantics remain inconsistent

**Confidence:** Mixed; some items were improved in the existing working branch, not the baseline reviewed here.  
**Evidence:** prior review of `tool-palette.tsx`, `document-tabs.tsx`, `editor-app.tsx` context menus, `panel-dock.tsx`, and `timeline-panel.tsx`.

Keyboard navigation, focus movement, nested controls, context-menu focus restoration, dialog semantics, outside-click dismissal, and separator interaction have not been consistently implemented across the editor surface.

**Fix:** use a shared interaction primitive policy: roving tab index for tabs/menus, focus trap/restore for dialogs, Escape/outside click, keyboard resize, 44px touch targets, and axe plus keyboard-only workflows.

### P2-04: public claims exceed actual guarantees

**Confidence:** Verified by prior review.  
**Evidence:** marketing components, footer copy, README, compatibility docs.

Claims such as “every tool,” “nothing faked,” and unqualified PSD round-trip conflict with documented browser limitations. Licensing copy has also been inconsistent despite an actual `LICENSE` now being present in the inspected tree.

**Fix:** use capability-driven copy, distinguish modeled metadata from working pixel behavior, and make export fidelity warnings visible before download.

### P2-05: test quality has meaningful gaps

**Confidence:** Verified by prior review evidence.  
**Evidence:** `tests/`, Playwright configs, prior test inventory.

The suite had fixed sleeps, source-string assertions, a dependency skip, no visual snapshots, limited accessibility tooling, no meaningful cross-browser coverage, and no coverage threshold. Existing tests do not cover many high-risk paths listed above.

**Fix:** prioritize behavioral tests for revision identity, stale async completions, tile fault injection, filter halos, PSD precision, ICC bytes, HDR >1, recovery per document, TGA alpha, invalid JPX failure, and built Pages assets.

## Cross-cutting root causes

1. **Identity is not carried through async work.** Active-document fallback is used where request-bound identity is required.
2. **State, history, persistence, and rendering are too coupled.** `editor-context.tsx` exposes nearly everything and imports UI/storage/algorithm/render concerns.
3. **Multiple render backends have duplicated semantics.** 2D, WebGL, full-document, tiled, and layer-tile paths can disagree.
4. **Browser limits are modeled but not always enforced at allocation boundaries.** Reporting is good; preventing unsafe work is the missing half.
5. **The test suite measures breadth more than invariants.** Many features have presence tests, but fewer assert pixel identity, revision identity, memory behavior, or deployment behavior.

## Recommended remediation order

1. Stop data loss: tile eviction, save revisions, reducer purity, stale async guards.
2. Make one canonical document/render contract and isolate history/persistence services.
3. Make tiled rendering safe: halos, no unsafe fallback, cancellation, bounded scratch.
4. Fix PSD/high-bit/ICC/HDR truthfulness and add external-reader round trips.
5. Make Pages or runtime deployment contract explicit and test the built artifact.
6. Add PR quality gates and deterministic browser coverage.
7. Then invest in mobile UX, accessibility consistency, and feature depth.

## Verification plan

Before merging fixes, run:

```bash
npm ci
npm run lint:strict
npm run typecheck
npm run test:unit
npm run check:source-hygiene
npm run check:capabilities
npm run check:architecture
npm run check:unused-scaffolds
npm run build
npm run analyze:bundle
npm run test:smoke
npm run test:static-export:smoke
```

Also run focused tests for each P0/P1 item, with Playwright workers set to 1 for diagnosis and with the production/static artifact, not only `next dev`.
