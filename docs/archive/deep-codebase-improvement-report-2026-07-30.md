# Photoshop Clone: Deep Improvement and Feature-Gap Report

**Review date:** 2026-07-30  
**Repository:** `limpy183-dev/Photoshop-clone`  
**Baseline:** default branch at `796de2242302c6db7bc6ad42a49b133cb29a3328`  
**Purpose:** turn the broad feature surface into a safer, more coherent, more useful editor.

## Product diagnosis

The project already has unusually broad Photoshop-inspired coverage: tools, layers, masks, adjustment layers, filters, file I/O, panels, automation, performance planning, capability reports, and advanced-format modeling. The next leap should not be “add 100 more menu items.” The product needs a smaller number of trustworthy workflows that are fast, reversible, honest about fidelity, and excellent on real devices.

The strongest strategic position is: **a browser-native layered editor with reliable local projects, safe large-document editing, excellent interoperability for supported cases, and explicit capability boundaries.**

## North-star priorities

### 1. Make every async operation document-safe

Create a shared `OperationContext` carrying:

- `docId`
- starting document revision
- request/correlation ID
- abort signal
- history generation
- source/target layer IDs

Every save, export, filter, decode, undo restore, asset generation, autosave, and worker completion must validate this context before mutating state. This eliminates the current class of “active tab changed while work was pending” bugs.

### 2. Split the editor into durable domain services

Replace the all-purpose context gradually with selector-based stores/services:

- document store
- history/revision store
- selection/tool runtime
- render scheduler
- persistence/import/export service
- workspace/panel UI state
- capability/security service

Keep a small command bus at the boundary. Reducers should be deterministic and side-effect free; services own timers, workers, blobs, GPU resources, and cancellation.

### 3. Build one canonical render graph

Define a graph such as:

```text
Document -> Layer tree -> mask/clip -> adjustment/effect stack -> blend -> output surface
```

Each node declares bounds, effect radius, color space, opacity, and whether it is tile-safe. 2D, WebGL, worker, and tile execution become backends for the same graph, not separate interpretations. This directly addresses double filters, tile seams, inconsistent masks, and backend-specific fidelity drift.

### 4. Make memory a product feature

Add a visible memory budget panel with:

- document pixel bytes
- layer/tile cache bytes
- history bytes
- decoded import bytes
- worker/GPU estimates
- scratch usage
- current safe-resolution recommendation

When a limit is reached, the app should explain the tradeoff and offer “reduce history,” “flatten preview only,” “switch to tile mode,” or “export a proxy.” Never silently allocate a full-document backup.

## Immediate engineering improvements

### A. Correctness and data safety

1. **Revision-based dirty state**: `revision`, `savedRevision`, and `lastAutosavedRevision` per document.
2. **Transactional tile spill**: write, verify, index, then release; fault-inject failures.
3. **Complete snapshot contract**: one versioned document snapshot type used by history, project save, autosave, and recovery.
4. **Per-document recovery queue**: recover/discard one or all without deleting unrelated snapshots.
5. **Stale completion guards**: reject results for closed documents, changed revisions, or superseded requests.
6. **Undo/redo cancellation**: one active restore per document; newer commands cancel older work.
7. **Atomic project writes**: use temporary handles/keys and commit markers so interrupted writes never replace the last good snapshot.
8. **Autosave retention policy**: configurable count/age/size, encryption-at-rest option where feasible, and explicit “clear recovery data” control.
9. **Export manifest**: record source revision, renderer backend, approximations, profile, bit depth, and warnings in the output report.
10. **Fail-closed codecs**: invalid/unsupported encoders must return an error, never a fabricated file.

### B. Rendering and performance

1. **Viewport-sized overlays** with transformed coordinate mapping via inverse DOMMatrix.
2. **Tile halos** for neighborhood filters and dirty invalidation expanded by effect radius.
3. **Bounded scratch surfaces** using stroke bounds, tile-local buffers, and a hard byte budget.
4. **Worker cancellation** that preserves cancellation as a normal outcome.
5. **Persistent WebGL compositor** with resource pools, context-loss recovery, real capability queries, and safe 2D downgrade.
6. **Progressive preview that actually renders** low-resolution tiles before full-quality output, with generation-safe cleanup.
7. **DPR observer** for monitor/zoom changes, repainting the custom cursor and resizing backing surfaces correctly.
8. **Canvas pool eviction** by retained bytes and age, with cleanup on document close and memory pressure.
9. **Input coalescing** using `getCoalescedEvents()` where available, plus pointercancel/lost-capture/unmount cleanup.
10. **Bundle budgets by route** for editor shell, marketing, codecs, and worker chunks; lazy-load advanced formats and panels.

### C. File fidelity and interoperability

1. **Native-preservation path**: if an imported PSD has not been edited, preserve original bytes/resources for loss-minimized save.
2. **Explicit conversion modes**: “preserve,” “convert to browser RGB/8-bit,” and “flatten for export,” each with a report.
3. **Real ICC retention**: preserve raw profile bytes and use a clear fallback label if the browser cannot color-manage them.
4. **Float pipeline**: keep scene-linear values above 1 until display/export policy decides how to map them.
5. **PSD compatibility matrix**: per-layer and per-feature status: preserved, approximated, flattened, dropped, or unsupported.
6. **Round-trip fixtures**: groups, masks, clipping, adjustment descriptors, text, paths, channels, ICC, 16/32-bit, HDR, smart objects, and linked data.
7. **External validation**: compare outputs using independent readers, not only the same internal parser/writer.
8. **Streaming project format**: binary chunks for pixel data, metadata index, checksums, compression, and resumable reads.
9. **Safe decode preflight**: inspect dimensions and estimated decoded bytes before codec allocation.
10. **Repair mode**: open partially damaged projects read-only, list rejected chunks, and let users export what survived.

## Feature gaps and underpowered workflows

### Tier 1: users will feel these immediately

#### 1. Proper selection editing

The selection surface is broad, but it needs production-grade behavior: antialiased edges, feather preview, add/subtract/intersect modes, transform selection, quick mask painting, save/load channels, refine-edge preview, and selection persistence through undo and project save.

**Acceptance bar:** a selection can be created, transformed, feathered, masked, saved, reloaded, and round-tripped without changing pixels unexpectedly.

#### 2. Non-destructive transform and smart objects

Add transform handles with numeric fields, pivot control, interpolation choice, perspective/warp, and non-destructive transform metadata. Add a reliable embedded smart-object container with edit-in-place and replace-content workflows.

**Acceptance bar:** repeated transforms do not permanently degrade raster content, and linked/embedded content has clear status and recovery.

#### 3. Professional text editing

The current modeled typography surface needs a real text engine: caret/selection behavior, multiline editing, baseline/leading/kerning controls, font loading fallback, text-on-path, RTL/script shaping where supported, and deterministic export warnings.

**Acceptance bar:** text layers remain editable across reload and clearly report when a font or shaping feature cannot be preserved.

#### 4. Color and proofing workflow

Add soft proof preview, gamut warning, working-space selection, profile embedding, perceptual/relative colorimetric intent choices, and a visible “display conversion vs pixel conversion” distinction.

**Acceptance bar:** the user can tell whether a color change is preview-only, destructive, or export-only.

#### 5. Real adjustment preview and masks

Adjustment layers need a consistent live-preview pipeline, mask density/edge controls, feather, mask thumbnail editing, clipping groups, and before/after comparison. Avoid creating placeholder metadata that looks real but does not affect pixels.

### Tier 2: strong differentiators

#### 6. Reliable local-first project system

Implement project versions, named snapshots, crash recovery history, conflict detection between tabs/windows, import repair, and optional File System Access API handles. Show “saved to browser,” “saved to file,” and “exported” as separate states.

#### 7. Collaboration that matches the browser

Instead of pretending to be a full cloud PSD system, support shareable review packages: flattened preview, comments anchored to coordinates, versioned annotations, and an optional CRDT-backed layer metadata channel. Keep pixel authority local until collaboration is genuinely safe.

#### 8. Automation that is useful but safe

Grow the restricted command DSL with recorded actions, parameters, conditional steps, batch folder processing through browser file handles, dry-run preview, progress/cancel, and an audit log. Keep arbitrary JavaScript/plugin execution sandboxed.

#### 9. Export presets and production handoff

Add named presets for web, print, social, thumbnails, and spritesheets. Each preset should show scale, profile, bit depth, matte, metadata, resampling, and estimated output size before export.

#### 10. Accessibility and keyboard-first mode

Provide a command palette that exposes every enabled action, discoverable shortcuts, roving focus for tabs/tools/menus, focus-safe dialogs, high-contrast theme, reduced-motion mode, and screen-reader labels for document/layer state.

### Tier 3: advanced features worth adding only after the core is safe

- vector shape boolean operations and SVG path editing
- gradient mesh and richer vector strokes
- perspective/vanishing-point guides
- content-aware fill with local-only models or explicit external capability
- animation timeline with onion skin, keyframe interpolation, and GIF/video export that reports codec limits
- print layout with bleed, crop marks, tiling, and printer profile handoff
- plugin marketplace only after a durable permission/update model exists
- camera raw non-destructive metadata pipeline
- 3D/video only if the project can provide real rendering rather than modeled panels

## UX improvements

### Mobile

Do not force desktop Photoshop chrome onto a phone. Use a bottom tool tray, collapsible panels, full-screen dialogs, gesture-aware zoom/pan, and a single active panel at a time. At minimum:

- guarantee a non-zero canvas region at 320px width
- make the layer panel a sheet
- move tools into a scrollable bottom tray
- use 44px touch targets
- test 320×568, 375×667, 394×851, and landscape tablet sizes

### Onboarding and empty state

Render the Home workspace when no document is open. Offer New Document, Open, Recent, templates, keyboard shortcuts, and a small “what works in browser” capability summary. Keep the editor shell out of the way until a document exists.

### Trust and status

Use a single status vocabulary:

- **Saved to file**
- **Saved locally**
- **Unsaved changes**
- **Exported copy**
- **Recovery available**
- **Approximation warning**
- **Operation cancelled**
- **Operation failed, original preserved**

This is more valuable than adding another Photoshop-style panel.

## Testing and quality improvements

### Add invariant tests first

- reducer called exactly once per dispatch
- deterministic reducer output for identical state/action
- stale save completion cannot clear dirty state
- stale history restore cannot mutate another document
- stale generator completion cannot target active-tab fallback
- tile eviction never drops bytes before verified persistence
- tile keys are namespaced by document and format version
- filter output is identical across 2D/tiled/WebGL for supported operations
- cancellation never invokes a synchronous fallback
- failed encoders never download a valid-looking fake file

### Add fixture tests

- 8-bit, 16-bit, 32-bit PSDs
- CMYK and ICC profiles
- groups/masks/clipping/adjustments/text/paths/channels
- HDR pixels above 1
- large projects with many masks/plugins/timeline entries
- multiple simultaneous autosave recoveries
- 16-bit TGA alpha
- malformed JPEG 2000 and advanced codec headers

### Add release tests

- built static Pages artifact under `/Photoshop-clone/`
- root-relative URL scan
- API-dependent UI behavior when API is unavailable
- CSP/header expectations for runtime hosting vs Pages
- Chromium, Firefox, WebKit, mobile Chromium, keyboard-only, and axe scans
- isolated server per worker, deterministic port, retries with traces
- no linting of generated `out/` output

### Add performance budgets

Track and fail CI on:

- editor initial JS and largest chunk
- first usable canvas time
- brush input latency at 60/120 Hz
- p95 filter completion for representative tile sizes
- peak JS heap during import/export
- peak retained canvas/GPU bytes
- time to recover a 500 MB project index

## Suggested roadmap

### Phase 0: stop losing work, 1 to 2 weeks

Reducer purity, revision-based dirty state, async identity guards, transactional tile eviction, recovery queue, and invariant tests.

### Phase 1: make rendering coherent, 2 to 4 weeks

Canonical render graph, tile halos, bounded overlays/scratch, worker cancellation, WebGL cleanup, progressive preview, and memory panel.

### Phase 2: make files trustworthy, 2 to 4 weeks

Native-preservation PSD path, explicit conversion reports, ICC retention, float/HDR policy, safe decode preflight, repair mode, and external round-trip fixtures.

### Phase 3: make deployment real, 1 to 2 weeks

Choose Pages versus runtime hosting, fix base paths, separate server-only features, add PR CI, static artifact tests, cross-browser smoke, and reproducible traces.

### Phase 4: improve user-visible depth, 4 to 8 weeks

Selection editing, non-destructive transforms/smart objects, real typography, proofing, export presets, onboarding, mobile shell, and accessibility.

### Phase 5: advanced differentiation

Collaboration review packages, safe automation recording, local AI capabilities with explicit permissions, animation, print, or vector depth based on actual usage data.

## Final take

The project does not need more feature names. It needs fewer “modeled” features and more end-to-end workflows that are pixel-correct, revision-safe, memory-bounded, testable, and honest about export fidelity. Fix the P0/P1 correctness and deployment issues first; then deepen selections, transforms, typography, color, and local-first projects. That path will make this feel like a serious editor instead of a very impressive menu catalog.
