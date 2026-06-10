# Project Boundaries

This document records features that **cannot** be implemented inside this project as a matter of design, IP, or browser sandbox limits — not as items waiting on engineering time. This file is the single place that explains *why* they will not be implemented and what the practical workaround is.

If a future contributor proposes work to "fix" one of these, this document is the place to read first.

---

## 1. Adobe cloud and AI services

Out of scope:

- Generative Fill
- Neural Filters
- Firefly / Sensei object selection, sky replacement, denoise, super-resolution, remove, match-font
- Adobe account authentication
- Creative Cloud file sync
- Adobe Fonts account sync
- Adobe Stock library integration
- Content Credentials provenance service integration

**Why:** these require Adobe-owned servers, Adobe-trained proprietary models, and Adobe-issued accounts/tokens. There is no public model or API surface this project could call without an Adobe relationship.

**Workaround already in place:** the codebase exposes a model-endpoint contract via `GENERATIVE_IMAGE_ENDPOINT` and `GENERATIVE_IMAGE_API_KEY` env vars. If you bring your own image-generation endpoint, generative fill/remove will route through it. The bundled fallback is deterministic prompt-guided inpainting — not a neural model.

---

## 2. Native Adobe runtime parity

Out of scope:

- UXP plugin runtime (Adobe's native plugin process)
- CEP panel runtime (Adobe's CEF-based panel host)
- Native `.8bf` binary filter execution
- ExtendScript / Action Manager host-object compatibility at full fidelity

**Why:** these require executing native code outside the browser's sandbox. A browser tab cannot load `.8bf` DLLs, host UXP's CEF runtime, or expose a Photoshop DOM. The existing "UXP/CEP adapter" is a *compatibility shim* for plugins that use only documented APIs the shim can map onto the in-browser editor — that is the maximum a browser project can offer.

**What does work:** the existing UXP-compatible adapter (`require("photoshop")`, `core.executeAsModal`, `action.batchPlay`), CEP-compatible adapter (`CSInterface`, `evalScript`), and `.8bf` metadata import with safe-kernel execution for 3×3 kernel descriptors.

---

## 3. Exact native Photoshop rendering and format internals

Out of scope:

- Bit-for-bit Photoshop brush engine parity
- Bit-for-bit Photoshop text rasterizer / hinting
- Photoshop's proprietary filter algorithm coefficients and GPU kernels
- Exact native PSD private descriptors and undocumented resource blocks
- Exact smart object / smart filter private resources

**Why:** Adobe does not publish the algorithms, coefficients, or descriptor schemas. Reverse-engineering them to bit-exactness is both infeasible and a legal hazard.

**What does work:** deterministic browser-local equivalents with golden-image test coverage. Where `ag-psd` exposes a native PSD descriptor structure, the project emits it; where it doesn't, the data is preserved in the project format and an XMP app-preservation envelope inside the PSD so this app can round-trip it even when Photoshop cannot read those private parts.

---

## 4. Production color and prepress parity

Out of scope:

- Certified CMM (Color Management Module) behavior — Adobe ACE, Apple ColorSync, ECI bit-for-bit parity
- Vendor CLUT / device-link ICC profiles that depend on certified CMM math
- Trapping
- Press-ready separations output

**Why:** certified CMM behavior is reserved for vendor-licensed engines. A browser implementation can compute color transforms with matrix and TRC tags faithfully — this project does — but cannot claim certified parity, and downstream press shops will not accept uncertified output without their own conversion step.

**What does work:** browser-local ICC engine for matrix+TRC RGB / Gray / CMYK profiles, soft-proofing, gamut warning, CMYK separation plates, total-ink reporting, spot overprint preview. (CLUT/device-link tag *parsing* could be added without claiming certified CMM behavior.)

---

## 5. Codec output beyond what `MediaRecorder` exposes

Out of scope (without a dedicated WASM encoder stack as a separate sub-project):

- Guaranteed ProRes / DNxHR / professional interchange codec output
- Guaranteed MP4/H.264 on every browser (Firefox does not expose H.264 via `MediaRecorder`)
- Full NLE multi-track editing beyond the existing Photoshop-style frame / video-layer workflow

**Why:** browsers expose codecs through `MediaRecorder`, and the available codec list varies per browser/OS. Adding FFmpeg.wasm, mp4-muxer, or a WebCodecs-backed encoder is a distinct project that brings ~30 MB of WASM and its own maintenance surface — out of scope for this editor.

**What does work:** MediaRecorder-driven MP4/H.264 when the browser exposes it, WebM VP9/VP8/H.264 where available, GIF/APNG/WebP frame animation, PNG sequence ZIP fallback with timeline manifest and WAV audio mix. Users who need ProRes-class output should re-encode the deterministic frame/audio package with FFmpeg externally.

---

## 6. Bounded by browser hardware limits, not implementation

Out of scope to "fix" (these are user-agent constraints, not bugs):

- Single-document size beyond `Blob` / `File` / `Canvas` / `ArrayBuffer` browser limits — typically 2–4 GB depending on browser and platform.
- Total heap usage beyond the browser's per-tab limit (typically 2–4 GB on desktop, less on mobile).
- WebGL maximum texture size — varies by GPU/driver and is queried at runtime.

**What does work:** tiled backing store, OPFS scratch, memory budgeting, dirty rects, progressive renderer, WebGL tile fallback when documents exceed GPU texture size, and explicit diagnostics surfacing the active limits.

---

## 7. Production GPU path tracing and native 3D engines

Out of scope:

- Production WebGPU / WebGL path tracing as the stable 3D renderer
- Vendor-grade physically based 3D rendering parity
- Native 3D driver, printer, or interchange runtimes

**Why:** browser GPU APIs are optional, driver-dependent, and expose different capabilities across devices. A production path tracer would require a separate rendering engine, shader pipeline, acceleration structure, material system, and fallback QA matrix beyond this editor's browser-local Photoshop-style scope.

**What does work:** deterministic CPU ray-traced previews, tiled CPU rendering for large 3D layers, editable mesh/material/UV metadata, texture-atlas baking, smart-object re-rendering, and an opt-in WebGPU path-tracing technology-preview flag for experiments when a browser exposes WebGPU. The tech preview must keep CPU ray tracing as the production fallback.

---

## Items that *are* in scope and tracked elsewhere

Partially implemented features with a concrete browser-achievable next step are normal backlog work, tracked through issues and commit history. This file (`BOUNDARIES.md`) is the inverse — the items that are intentionally *not* on that backlog.
