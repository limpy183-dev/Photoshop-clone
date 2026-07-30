# 0003. PNG-blob history compression beyond 12 entries

- Status: accepted
- Date: 2026-07-30 (documenting an existing decision)

## Context

Undo history holds canvas-bearing snapshots. A single 4096×4096 RGBA snapshot is
~67 MB; an 8192² one is ~256 MB. A browser tab has roughly 2–4 GB of heap on
desktop and much less on mobile. A naive snapshot history exhausts memory after
a handful of steps.

## Decision

The most recent 12 history entries are kept as raw snapshots for instant undo.
Older canvas-bearing fields are encoded **losslessly** as PNG blobs and restored
on demand via `createImageBitmap`. Compression jobs are cancellable and verify
that an entry is still live before publishing a blob.

## Alternatives considered

- **Lossy compression (JPEG/WebP).** Rejected outright: undo must be exact. An
  editor that quietly changes your pixels when you press Ctrl+Z is broken.
- **Command/inverse-operation history.** Lower memory and the better model in
  principle, but it requires a correct inverse for every operation including
  destructive filters and external imports. Worth revisiting incrementally.
- **OPFS for all history.** Higher latency for recent undo, and OPFS is not
  universally available. Used for tile scratch storage instead.

## Consequences

Good: bounded memory with exact undo; deep history stays usable on large
documents.

Accepted costs:

- Restoring a deep entry is asynchronous, which introduces a class of bug we
  have already hit: a restore that completes after the user switches documents
  can apply to the wrong document. Restore actions must therefore carry `docId`
  and the expected history generation, and stale completions must be discarded.
- Compression must never run against a snapshot that the reducer can still
  mutate — another reason ADR-0001's purity rule is load-bearing.
- `HistoryEntry` currently snapshots a hand-maintained subset of `PsDocument`,
  so fields such as timeline, plugins, metadata, colour management and print
  settings are not undoable. Either one complete snapshot contract or inverse
  domain operations is required; the duplicated subset will keep drifting.
