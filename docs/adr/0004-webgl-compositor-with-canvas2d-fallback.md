# 0004. WebGL compositor with a Canvas 2D fallback

- Status: accepted
- Date: 2026-07-30 (documenting an existing decision)

## Context

Compositing a deep layer stack with blend modes, masks, clipping and opacity on
the main thread in Canvas 2D does not hold an interactive frame rate on large
documents. WebGL can do it in one pass per layer, but WebGL is optional,
driver-dependent, loses its context under memory pressure, and imposes a
GPU-specific maximum texture size.

## Decision

Layer composition runs through `webgl-compositor.ts` when a context is available
and the document fits the queried GPU limits, and falls back to Canvas 2D
otherwise. Documents that exceed GPU texture limits fall back to tiled
rendering rather than failing.

## Alternatives considered

- **Canvas 2D only.** Simpler and always correct, but too slow on the documents
  this editor advertises support for.
- **WebGL only.** Rejected: WebGL is not guaranteed, and context loss must be
  survivable.
- **WebGPU.** Not universally available. Held as an opt-in technology preview
  per BOUNDARIES.md, with CPU paths remaining the production fallback.

## Consequences

Good: interactive compositing where the GPU allows, correctness everywhere else.

Accepted costs — and these are the real ones:

- **Four render paths now exist** (Canvas 2D, WebGL, tile-only, layer-tile) and
  each re-implements layer semantics. This is the direct cause of divergences
  such as smart filters being applied twice on the tile path and inconsistent
  fallback behaviour. The intended fix is a canonical layer/render graph with
  backend-specific executors and one conformance suite run against every
  backend.
- GPU limits must be **queried** (`MAX_TEXTURE_SIZE`), never assumed, and every
  allocation needs framebuffer and error checks with deterministic disposal.
- Context loss must be handled explicitly; transient contexts and per-pass
  program/buffer allocation are a churn source to eliminate.
