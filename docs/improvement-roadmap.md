# Improvement roadmap

This is the canonical prioritised burn-down for the project. It supersedes
`Findings.txt`, which remains in the repository only as raw audit notes.

**Why this file exists:** `Findings.txt` contains five rounds of audits with
P0/P1 labels, precise file-and-line evidence, and no status field. Several of
its findings are already fixed (the unauthenticated generative-fill relay is now
fully hardened; the missing licence file now exists), several are not, and
nothing in the file distinguishes the two. An audit you cannot act on is worse
than no audit, because it produces the feeling of coverage without the effect.

Every item below should exist as a GitHub issue with a priority label. When an
item is fixed, close the issue and tick it here.

---

## Standing assessment

The engineering discipline here is unusually strong: a typed reducer as the
single mutation path, golden-image filter tests, machine-enforced architecture
invariants, honest capability reporting, and a `BOUNDARIES.md` that states what
will never be built. Those are the assets.

The liabilities are concentrated in three places:

1. **`canvas-view.tsx` is the project's bottleneck** — ~237 KB and ~7,100 lines
   carrying rendering, pointer routing, tiles, overlays, transforms and cursor
   logic. Most rendering defects on record trace into it.
2. **Guardrails were ratcheted to legalise debt** rather than retire it. Fixed
   by ADR-0006: budgets are now locked and may only decrease.
3. **The test matrix is Chromium-only** for a product whose entire premise is
   "browser-native".

---

## P0 — data integrity

These risk silent loss of a user's work. Nothing else should be worked on first.

- [ ] **Make the editor reducer pure.** It currently runs twice, generates IDs
      and timestamps, and schedules mutable async compression, which can diverge
      `stateRef` from React state and overlap compression against shared
      snapshots. Move ID/timestamp creation before dispatch and compression /
      blob release into a history service. Add a test that runs every action
      twice and asserts identical output.
- [ ] **Revision-stamp save completion.** The document is serialised before the
      async file write, but `markDocumentSaved` records the history index at
      completion time, so edits made while the picker or write is pending are
      marked saved without ever reaching disk. Capture the revision at
      serialisation, pass it in the completion action, stay dirty on mismatch.
- [ ] **Never evict a tile before persistence is confirmed.** Eviction clears
      resident pixel data even when OPFS is disabled or the write failed, and
      the tile is later reconstructed empty. Retain the tile or reject the
      allocation. Needs a fault-injection test with OPFS unavailable.
- [ ] **Namespace OPFS tile keys per document.** Keys omit a document namespace
      and PSB tiles use fixed identifiers, so tiles can collide across
      documents. Include a document namespace and a scratch-format version.
- [ ] **Triage `Findings.txt` into issues.** One issue per finding, priority
      labelled, with stale ones opened and immediately closed against the commit
      that fixed them.

## P1 — correctness, coverage, and the canvas monolith

- [ ] **Carry `docId` + revision + correlation ID on every async round trip.**
      History restore, save completion and asset generation all currently fall
      back to whichever document is active when the promise settles, so
      switching tabs mid-operation applies work to the wrong document.
- [ ] **One document snapshot contract for history.** `HistoryEntry` snapshots a
      hand-maintained subset of `PsDocument`; timeline, plugins, metadata,
      colour management and print settings are omitted, so File Info changes
      cannot be undone. Choose one complete snapshot or inverse domain
      operations — the duplicated subset will keep drifting.
- [ ] **Derive dirty state from revision deltas, not an action allow-list.** The
      current list produces false negatives (persisted plugin storage) and false
      positives (actions the reducer rejected).
- [ ] **Split `canvas-view.tsx`** along the seams its own helper modules already
      imply: pointer/tool input routing, composite scheduling, overlays,
      transform and coordinate math, cursor rendering. Target: no file in
      `components/photoshop/` over 1,500 lines, and ratchet the budgets down
      after each split.
- [ ] **Preserve `AbortError` through filter cancellation.** Aborting currently
      lands in a catch that permanently marks the worker failed and re-runs the
      filter synchronously on the main thread, making cancellation worse than
      waiting. Implement real worker-side cancellation and clean up listeners.
- [ ] **Use stroke-bounds or tile-local scratch surfaces for brush work.**
      Transparency locking and buffered strokes clone full-document canvases;
      an 8192² RGBA surface is ~256 MiB per stroke. Charge scratch surfaces
      against the memory budget.
- [ ] **Fix pointer lifecycle handling.** No `pointercancel` or
      `lostpointercapture` handlers exist, so interrupted input leaks stroke
      state and scratch canvases. One idempotent cancellation path covering
      cancel, lost capture, blur and unmount.
- [ ] **Query real GPU limits.** The WebGL path assumes a 16,384-pixel texture
      limit instead of reading `MAX_TEXTURE_SIZE`, and allocations lack
      framebuffer/error checks. Add deterministic disposal and context-loss
      handling.
- [ ] **Stop applying smart filters twice on the tile path**, and propagate
      effect radius through dirty-tile invalidation so cropped tiles stop
      producing seams.
- [ ] **Add Firefox and WebKit to the smoke matrix.** Landed as a non-blocking
      CI job and an opt-in Playwright config; promote to a required check once
      green.
- [ ] **Decide the mobile stance and kill the 0 px canvas.** At 394×851 the
      editor canvas measures exactly zero pixels wide, because a 44 px tool rail
      plus a non-shrinking 340–720 px dock consumes the viewport. Either build a
      real responsive shell (dock as an overlay sheet, canvas-first layout,
      `min-width: 0`) or detect small viewports and say so honestly.
- [ ] **Validate decoder dimensions before allocation.** TIFF, EXR, HEIC,
      JPEG 2000 and RAW inputs are decoded before canvas limits are checked, and
      a compressed-size cap says nothing about decompressed memory. Read
      headers, reject on declared dimensions, then decode.
- [ ] **Bound project-import decode amplification.** Layers and channels decode
      concurrently with an uncapped number of smart-filter masks per layer. Add
      a bounded decode queue and a per-document mask cap.

## P2 — architecture, accessibility, platform

- [ ] **Introduce a canonical layer/render graph** with backend-specific
      executors for Canvas 2D, WebGL, tile-only and layer-tile, plus one
      conformance suite run against every backend. This is the highest-leverage
      architectural change available and the root cause of the divergences above
      (see ADR-0004).
- [ ] **Split the god context** into document / history / tool / lifecycle stores
      with selector subscriptions, keeping the single typed-dispatch path
      (see ADR-0001).
- [ ] **Split `advanced-subsystems-dialog.tsx`** (108 KB) into per-domain lazy
      dialogs: 3D, print, plugins, PDF/EPS, medical/HDR. They share only a tab
      bar.
- [ ] **Make "tiled" filters actually tiled.** They allocate a full-document
      `ImageData` and yield only through resolved promises, which never yields
      to input or rendering. Stream bounded tiles with macrotask scheduling.
- [ ] **Move every overlay onto Radix.** The hand-rolled context menu, panel
      browsers and `TweenDialog` re-implement focus management incorrectly:
      no dialog role, no focus trap, no Escape handling, no focus restoration.
      Radix is already a dependency.
- [ ] **Fix the documented keyboard and naming failures.** Tool-palette "more
      tools" is a `role="button"` inside a `<button>` with `tabIndex={-1}`;
      document tabs are unfocusable `div`s; resize separators expose
      `role="separator"` but cannot be keyboard-resized; New Document inputs
      have no accessible names.
- [ ] **Make `test:accessibility` a blocking gate on the editor shell**, plus a
      keyboard-only journey test: open a document, pick a tool, open a panel,
      run a filter, export.
- [ ] **Enforce a minimum hit area** of 24 px (ideally 44 px). Current offenders
      are 12×12, 16×16 and 20×20 px.
- [ ] **Fix or delete the dead Home workspace.** It is lazy-loaded, its state
      value is discarded, and `ps-show-home` updates nothing, so with no
      documents the canvas shows plain text instead. Render it when
      `homeOpen || !activeDoc`, or remove it.
- [ ] **Ship durable rate-limit and storage adapters**, and make the local
      `.data/*.jsonl` and in-process buckets fail loudly outside development.
      Client identity currently derives from caller-controlled headers.
- [ ] **Serve security headers on the published build**, or label the GitHub
      Pages export a demo. A static export runs neither `headers()` nor the
      nonce proxy, so the deployed app has no CSP and can be framed.
- [ ] **Honour the Recent Files Limit preference.** Recent documents persist
      complete serialised projects — canvas and mask data URLs included — to
      `localStorage`, hardcoded to eight entries, ignoring the user's setting
      including zero. Store thumbnails only, keep pixel data in OPFS, and add an
      explicit purge command.
- [ ] **Pin GitHub Actions to commit SHAs** with Dependabot updates. `npm audit`
      runs at `--audit-level=low` while the Actions supply chain floats on tags.
- [ ] **Audit the dependency tree for load-bearing weight.** Justify or remove
      `gsap`/`@gsap/react` (likely marketing-only) and `paper`; add a test
      asserting no raster/document decoder appears in any startup chunk; gate
      decoders behind capability probes; add a total-transferred-bytes budget
      for `/editor` so WASM and worker payloads count.
- [ ] **Add performance budgets to CI**: p95 brush-stroke latency, filter time
      on a fixed 4K fixture, peak heap on a large-document scenario.
      `canvas-interaction-performance.spec.ts` exists but is not a gate.

## P3 — polish

- [ ] Promote burned-down ESLint rules from `warn` to `error`, turn
      `reportUnusedDisableDirectives` on, and add `eslint-plugin-jsx-a11y`.
- [ ] Drive `hookDependencySuppressions` to 0 (budget is 6) — those six are
      exactly where stale-closure bugs live in a canvas app.
- [ ] Type the menu payloads and add a narrow typed facade over Paper.js so
      `no-explicit-any` can become an error.
- [ ] Corpus-based fuzzing for PSD/TIFF/EXR/HEIC/JPEG 2000/RAW/DICOM parsers.
- [ ] Containerise visual-regression rendering so baselines are reproducible off
      Windows.
- [ ] Add a devcontainer or `docker compose` path; document macOS/Linux setup
      alongside the PowerShell instructions.
- [ ] Extend `doctor.mjs` to report WebGL and OPFS availability, since both
      silently change test outcomes.
- [ ] Add a marketing claim test that greps UI copy for absolute claims
      ("every tool", "full fidelity", unqualified "PSD round-trip").
- [ ] Ship the unsubscribe route or remove the "unsubscribe with one click"
      claim; only POST exists today.
- [ ] Consolidate `images/` into `docs/images/`.
- [ ] Add release automation (tags, changelog) so capability claims can be
      versioned. Still `0.1.0` since creation.

---

## Metrics worth tracking

| Metric | Today | Target |
| --- | --- | --- |
| Largest file in `components/photoshop/` | ~7,100 lines | < 1,500 |
| Combined lines, top 10 files | 29,000 budgeted | < 15,000 |
| Open P0/P1 audit issues | untracked | 0 |
| Browser engines in CI | 1 | 3 |
| PR time to first failure | ~20 min | < 2 min |
| `hookDependencySuppressions` | 6 budgeted | 0 |
| axe violations on the editor shell | unmeasured | 0 |
| `/editor` cold-load transferred bytes | unbudgeted | budgeted |
| p95 brush-stroke latency at 4096² | unmeasured | budgeted |
