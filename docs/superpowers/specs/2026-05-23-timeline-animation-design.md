# Timeline Animation Design

Generated: 2026-05-23

## Scope

Implement practical browser-local timeline and animation workflows:

- Improve the frame animation editor with frame capture, replacement, thumbnails, reordering, duplication, bulk duration edits, frame-from-layers creation, FPS duration application, JSON/contact-sheet/frame-sequence exports, and multi-frame animation exports.
- Add onion-skin rendering with configurable before/after frame counts, opacity, and tint.
- Generate tween frames between timeline states using opacity, visibility, transform, blend, and layer-style metadata.
- Store timeline keyframes for layer transform, opacity, fill opacity, blend mode, and effects/style without destructively changing source pixels.
- Export GIF, APNG, and animated WebP using browser-local code and browser canvas codecs where available.
- Add basic video poster-frame and metadata workflows: render a selected timeline frame to PNG and store it as a video layer poster; keep codec-dependent video export limitations explicit.

## Non-Goals

- Native Photoshop timeline parity.
- Audio rendering or native video muxing.
- Native external codec packages unless a concrete blocker requires one.
- Destructive transform playback on source layers; transforms are rendered into projected frame composites.

## Architecture

`components/photoshop/types.ts` extends `TimelineFrame` with `layerFillOpacity`, `layerBlend`, `layerStyle`, `layerTransform`, `easing`, and cached thumbnail metadata. `PsDocument` gains optional `timelineSettings` for FPS, loop count, and onion skin settings.

`components/photoshop/timeline-engine.ts` owns pure timeline behavior: frame capture, projected document construction, transform rendering, onion-skin overlay rendering, tween generation, frame reordering, FPS duration conversion, reverse, and frame-from-layers conversion.

`components/photoshop/animation-encoding.ts` owns browser-local animated export. GIF uses an in-repo indexed-palette LZW encoder. APNG writes PNG/APNG chunks and uses `CompressionStream` when available, with a stored-deflate fallback. Animated WebP wraps browser-encoded still WebP frames in a RIFF/VP8X/ANIM/ANMF container when the browser can encode static WebP frames.

`components/photoshop/document-io.ts` exposes async animation data URL export helpers and updates export limitation reports for APNG and animated WebP. `TimelinePanel` calls the engine/encoder helpers and keeps UI state local.

## Error Handling

- Export helpers throw clear errors for empty frame lists, missing canvas contexts, failed browser WebP encoding, or invalid codec bytes.
- Timeline rendering returns projected documents and canvases without mutating source layer canvases.
- Video poster creation reports missing video layers and codec limitations instead of pretending full video render support.
- Browser codec variability is surfaced through caught export errors and report text.

## Testing

Use TDD-focused tests for:

- Timeline frame capture and projected frame rendering metadata.
- Tween interpolation for opacity, transform, and layer-style numeric fields.
- Onion-skin overlay returns a document-sized canvas without mutating frames.
- GIF/APNG/WebP encoders emit correct signatures and animation chunks.
- Document I/O reports animation export limitations accurately.

Verification commands:

- `npx playwright test tests/timeline-animation.spec.ts`
- `npx tsc --noEmit`
- `npm run build`
