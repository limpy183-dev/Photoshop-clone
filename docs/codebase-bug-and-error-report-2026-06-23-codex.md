# Codebase Bug and Error Analysis Report

Generated: 2026-06-23

Scope: full repository review of the Photoshop-style editor application, including build/tooling configuration, test coverage, editor state management, document import/export, plugin APIs, persistence paths, and deployment-adjacent code.

## Executive Summary

The codebase is in a substantially healthier state than several older local reports suggest. Linting, strict linting, TypeScript, capability checks, architecture gates, smoke tests, static-export smoke tests, and dependency audits all pass in the current working tree. Many previously reported defects are already fixed, including save-history routing, save shortcut document targeting, raw Photoshop event/listener usage, plugin message origin hardening, autosave deletion scope, tiled backing-store eviction, HDR float clamping, several accessibility issues, and CI/static-export gaps.

The main unresolved risks are concentrated in persistence correctness and import hardening:

- P1: plugin storage mutations are serialized but are not marked dirty and are not undoable.
- P2: dirty tracking can mark documents dirty for reducer-rejected/no-op edits.
- P2: project-embedded image data URLs are dimension-validated only after the browser starts decoding them.
- P2: project sanitization can truncate rich state with only a console warning, then continue loading.
- P2: local production build verification is blocked by the active Node version.
- P3: architecture budgets pass exactly at their limits, leaving no maintainability headroom.
- P3: marketing rate limiting is spoofable when deployed without trusted proxy IP support.

No dependency vulnerabilities were reported by `npm audit` at the time of analysis.

## Verification Matrix

| Check | Result | Notes |
| --- | --- | --- |
| `npm.cmd run lint` | Pass | ESLint completed successfully. |
| `npm.cmd run lint:strict` | Pass | Completed with zero warnings. |
| `npm.cmd run typecheck` | Pass | TypeScript completed successfully. |
| `npm.cmd run check:capabilities` | Pass | Scanned 72 capability records and 13 advanced-format entries. |
| `npm.cmd run check:architecture` | Pass | Import cycles 0/0, raw Photoshop events 0/0, raw Photoshop listeners 0/0. |
| `npm.cmd run test:smoke` | Pass | 9 tests passed. |
| `npm.cmd run test:static-export:smoke` | Pass | 2 tests passed. |
| `npm.cmd audit --omit=dev` | Pass | 0 vulnerabilities. |
| `npm.cmd audit` | Pass | 0 vulnerabilities. |
| `npm.cmd run doctor` | Fail | Only failure was Node version: current 25.2.1, expected `>=22 <23`. |
| `npm.cmd run build` | Blocked | Prebuild guard rejects Node 25.2.1. |
| `npm.cmd run analyze:bundle` | Pass with caveat | Used the existing `.next` artifact because a fresh build was blocked by Node version. |
| `npx.cmd playwright test --list` | Pass | Discovered 989 tests in 134 files; full suite was not run locally. |

## Findings

### P1 - Plugin Storage Changes Are Not Marked Dirty or Undoable

Evidence:

- `components/photoshop/editor-context.tsx:2389` handles `set-plugin-storage` by replacing `pluginStorage` on the active document.
- `components/photoshop/editor-document-lifecycle.ts:51` defines the actions that mark a document dirty, but includes `set-plugins` and does not include `set-plugin-storage`.
- `components/photoshop/editor-document-lifecycle.ts:215` marks documents dirty only when the action appears in that dirty-action set.
- `components/photoshop/advanced-subsystems-dialog.tsx:2398` and nearby plugin API methods dispatch `set-plugin-storage`.
- `components/photoshop/document-io.ts:2160` serializes `pluginStorage` into project files.

Impact:

Plugin storage is persisted into project files, but changing it does not mark the document dirty. A user or plugin can update stored plugin state, then close or switch away without receiving the same unsaved-change protection used for normal document edits. Because the action is also not history-tracked, plugin storage updates cannot be undone or redone through the normal document history model.

Recommendation:

Treat `set-plugin-storage` as a document mutation in the lifecycle layer. At minimum, add it to the dirty-action routing and add focused tests in `tests/editor-document-lifecycle.spec.ts`. If plugin storage should participate in undo/redo, add explicit history behavior for storage writes rather than relying only on dirty tracking.

Suggested regression tests:

- Dispatch `set-plugin-storage` against the active document and assert that the document becomes dirty.
- Save the document, dispatch `set-plugin-storage`, and assert that close/open protection sees unsaved changes.
- If undo support is intended, assert that undo restores the previous plugin storage value.

### P2 - Dirty Tracking Produces False Positives for Rejected or No-Op Edits

Evidence:

- `components/photoshop/editor-context.tsx:3545` runs the reducer, then calls `dirtyDocIdsForAction(action, before)`.
- `components/photoshop/editor-document-lifecycle.ts:215` derives dirtiness from action type and the pre-reducer state.
- `components/photoshop/editor-context.tsx:1353` can reject `remove-layer` and return the document unchanged when the target layer is locked or when only one layer remains.
- `components/photoshop/editor-document-lifecycle.ts:51` includes `remove-layer` in the dirty-action set.

Impact:

The editor can mark a document dirty even when the reducer rejected the operation and no document state changed. A concrete example is attempting to delete the only layer or a locked layer. This causes incorrect unsaved-change prompts and can make saved-state indicators unreliable. The same pattern may affect other locked/no-op layer actions.

Recommendation:

Make dirty tracking depend on actual state change, not action name alone. Practical options:

- Compare relevant document object identity before and after the reducer for each candidate document.
- Have reducers return mutation metadata for document-affecting actions.
- Route rejected actions through a non-dirty result path.

Suggested regression tests:

- Start from a saved single-layer document, dispatch `remove-layer`, and assert the document remains clean.
- Start from a saved document with a locked target layer, dispatch `remove-layer`, and assert the document remains clean.
- Add equivalent no-op checks for other lock-guarded actions.

### P2 - Project Embedded Image Data URLs Are Dimension-Validated After Decode Starts

Evidence:

- `components/photoshop/document-io.ts:1881` creates a canvas from a project data URL.
- `components/photoshop/document-io.ts:1893` assigns `img.src = dataUrl`.
- `components/photoshop/document-io.ts:1895` validates `img.naturalWidth` and `img.naturalHeight` only in the `onload` handler.
- `components/photoshop/document-io.ts:1910` uses that path for layer canvases, masks, frames, smart filter masks, and smart sources.
- `lib/photoshop/canvas-limits.ts:6` allows project data URLs up to 45,000,000 characters.

Impact:

Standard raster imports perform header-level preflight before decode, but project-embedded data URLs do not. A crafted project can provide a compressed image under the data URL length limit that declares very large dimensions. The browser may allocate decode resources before the application rejects the dimensions in `onload`. This is primarily a denial-of-service risk during project import.

Recommendation:

Preflight decoded data URL bytes before assigning `img.src`. Parse dimensions for supported embedded formats, then call the existing canvas limit checks before browser decode. Reject unsupported or malformed project image payloads early with an import-visible error.

Suggested regression tests:

- Import a project containing a small-byte PNG data URL with dimensions over the canvas limit and assert rejection occurs before image decode.
- Cover the same path for mask/frame/smart-filter embedded images, not only primary layer canvases.

### P2 - Project Sanitization Can Truncate Rich State Without User-Visible Import Errors

Evidence:

- `components/photoshop/document-io.ts:1568` sanitizes parsed project values with `safeJsonValue`.
- `components/photoshop/document-io.ts:1583` truncates oversized strings.
- `components/photoshop/document-io.ts:1590` truncates arrays.
- `components/photoshop/document-io.ts:1599` truncates object keys.
- `components/photoshop/document-io.ts:1612` reports truncation only with `console.warn`.
- `components/photoshop/document-io.ts:2157` through `components/photoshop/document-io.ts:2167` load rich project fields such as asset libraries, timeline frames, plugins, plugin storage, and metadata through that sanitizer.

Impact:

The current limits are much larger than older reports suggested, so ordinary projects should not be affected. However, when truncation does happen, the user receives no import report or blocking error. The project can open with partially missing plugin storage, metadata, timeline state, asset library contents, or other rich state, which can look like data loss instead of a failed or degraded import.

Recommendation:

Return structured sanitization diagnostics from project deserialization and surface them in the document import report. For fidelity-critical fields, consider rejecting the project instead of silently truncating. For non-critical fields, load the project but show a clear warning that names the truncated section.

Suggested regression tests:

- Import a project whose plugin storage exceeds sanitizer limits and assert that the UI/import result exposes a warning.
- Import a project whose timeline or asset library is truncated and assert that the user-visible report names the affected field.

### P2 - Local Production Build Verification Is Blocked by Node Version Drift

Evidence:

- `package.json` and local tooling require Node `>=22 <23`.
- `npm.cmd run doctor` reports current Node `25.2.1` and fails `node-version`.
- `npm.cmd run build` fails in the prebuild guard with the same Node version mismatch.

Impact:

This is an environment defect rather than an application source defect, but it blocks local production build verification. It also means the bundle analysis in this run could only inspect the existing `.next` artifact, not a fresh build from the current working tree.

Recommendation:

Install or select Node 22 before running production verification locally. CI already appears configured for Node 22, so this is primarily a local setup issue unless other developer machines share the same drift.

Suggested verification after fixing:

- `npm.cmd run doctor`
- `npm.cmd run build`
- `npm.cmd run analyze:bundle`
- The relevant Playwright shard or full suite if runtime allows.

### P3 - Architecture Budgets Pass Exactly at Their Limits

Evidence:

- `npm.cmd run check:architecture` reports oversize files `24/24`.
- The same check reports `useEditor` imports `73/73`.
- The same check reports top 10 largest files `36095/36095` lines.

Impact:

The architecture gates are working, but they have no headroom. Any small growth in file size or context coupling will fail the gate. This is not a runtime bug, but it indicates that maintainability pressure remains high around the large editor modules.

Recommendation:

As feature work extracts code from the largest modules, ratchet these budgets downward. Avoid raising the budgets unless the added complexity is temporary and paired with a cleanup task.

### P3 - Marketing Rate Limiting Is Weak Without Trusted Proxy IP Support

Evidence:

- `lib/marketing-store.ts` derives the client identity differently depending on trusted proxy configuration.
- In non-trusted-proxy mode, the fallback identity is based on request fingerprint data such as user agent and language headers rather than a durable client IP.

Impact:

Without trusted proxy headers or a shared production rate limiter, an attacker can rotate request headers to bypass per-client marketing-form throttles. The endpoint still has schema validation and body-size controls, so this is a rate-limit robustness issue rather than direct data compromise.

Recommendation:

For production deployments, enable a trusted proxy configuration that strips and rewrites client IP headers correctly, or move rate limiting to a hosting/provider layer with durable client identity. Document the deployment requirement next to the marketing environment variables.

## Notable Findings That Were Rechecked and Not Carried Forward

The following issues appeared in older local notes but are fixed or no longer reproduce in the current tree:

- Save now captures the current history index at serialization time and passes the saved index into lifecycle state.
- The save shortcut dispatches the active `docId`.
- History restoration captures and validates the active document before committing async restore work.
- Raw Photoshop event dispatch/listener usage is gated at zero.
- Plugin messages now validate source, channel token, method, and replay state.
- Autosave recovery delete/dismiss paths target the selected document rather than clearing all autosaves.
- Recent document limits honor the user preference, including zero.
- Filter cancellation is propagated through the main-thread fallback path.
- Tiled backing-store eviction no longer drops pixel data when spill-to-disk is unavailable or fails.
- TGA 16-bit alpha expansion, preflight alpha bounds, and HDR float clamping have focused fixes and test coverage.
- Several UI accessibility defects around document tabs, resize handles, tool flyouts, and new-document labels are fixed.
- Static export smoke tests pass and marketing backend forms are disabled in static deploy mode.
- CI and Pages deploy workflows now include quality/build/smoke gates.
- `LICENSE` exists and README licensing text is consistent.

## Dependency and Version Notes

`npm audit` reports no vulnerabilities. `npm.cmd outdated` reports available upgrades, including major upgrades for some packages such as `zod`, `pdfjs-dist`, `react-resizable-panels`, `sonner`, `lucide-react`, and TypeScript. These are not immediate bugs by themselves, but major upgrades should be handled deliberately because this application has deep editor, decoding, and UI behavior.

## Residual Risk

This analysis used static inspection plus targeted verification commands. The full Playwright suite was listed but not run locally because the repository contains 989 tests and the active Node version blocked fresh production-build verification. The highest-value next verification step is to rerun the build, bundle analysis, and selected Playwright shards under Node 22.

## Recommended Fix Order

1. Fix dirty tracking for `set-plugin-storage` and add lifecycle regression tests.
2. Make dirty tracking depend on actual document changes for rejected/no-op actions.
3. Add header-level dimension preflight for project embedded image data URLs.
4. Surface project sanitizer truncation through import diagnostics.
5. Align local Node with the repository requirement and rerun production verification.
6. Ratchet architecture budgets downward as extraction work lands.
7. Harden or document production marketing rate-limit identity requirements.
