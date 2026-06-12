# Document IO Import Sniffers Refactor

## Goal

Reduce `components/photoshop/document-io.ts` by extracting the pure PSD/PSB and raster header dimension sniffers into a focused helper module while preserving the existing public `document-io` API and current import behavior.

## Current Shape

- `document-io.ts` is over 4,200 lines and mixes file-system APIs, project serialization, raster export, PSD serialization/deserialization, compatibility reporting, and binary header sniffing.
- The header sniffers are cohesive and mostly pure:
  - byte readers
  - PSD/PSB header dimensions
  - PNG/GIF/JPEG/WebP/BMP/ISO-BMFF dimensions
- Existing public callers use `document-io` entry points such as `inspectImportFileDimensions`, `deserializePsdFile`, `loadImageFromFile`, and `loadRasterCanvasFromFile`.

## Plan

1. Add `components/photoshop/document-import-sniffers.ts`.
2. Move only pure parsing code into the new module:
   - `ImageHeaderDimensions`
   - PSD/PSB header reader
   - raster format sniffers
   - shared byte readers and ASCII checks
3. Keep behavioral guardrails in `document-io.ts`:
   - file size assertions
   - canvas size assertions
   - PSB large-document fallback planning
   - public async file APIs
4. Add focused tests for the extracted module so individual format sniffers are covered without needing browser image decode.
5. Run focused tests plus type/lint verification.

## Non-Goals

- Do not move the dynamic `import("ag-psd")` loader in this slice.
- Do not change serialized project, PSD, or raster export behavior.
- Do not rename public exports from `document-io.ts`.
