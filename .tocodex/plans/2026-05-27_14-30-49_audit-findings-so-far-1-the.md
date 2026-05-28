---
created: 2026-05-27T14:30:49.103Z
status: active
---
Audit findings so far:
1. The report cannot be treated as source of truth. Multiple items listed as missing already exist in the codebase, including dedicated panels for Glyphs, Notes, Discover, Learn, Libraries, and Browser Diagnostics.
2. The codebase already contains a broad implementation surface for many later-phase items as well, so the remaining work needs verification at the integration and behavior level, not blind implementation from the report.
3. The correct approach is to audit by subsystem, then implement only gaps that remain real after checking registration, wiring, and feature depth.

Proposed execution plan:
1. Complete a subsystem audit in code mode.
Expected files inspected: `components/photoshop/panel-registry.tsx`, `components/photoshop/menu-bar.tsx`, `components/photoshop/options-bar.tsx`, `components/photoshop/tool-palette.tsx`, `components/photoshop/status-bar.tsx`, `components/photoshop/capabilities.ts`, key files under `components/photoshop/panels/`, and the engine/dialog files referenced by the report.
Goal: classify each report item as implemented, partially implemented, or genuinely missing.

2. Build a verified gap ledger and batch list.
Expected file changes: likely a memo/audit doc under `tocodex-docs/` plus implementation todos.
Goal: reduce the 215 reported items into a smaller set of real remaining gaps grouped by subsystem and dependency.

3. Execute implementation in batches, highest-signal first.
Initial batches:
- Batch A: quick UI and workflow gaps that are still real after audit
- Batch B: panel integration/depth gaps
- Batch C: tool and selection workflow gaps
- Batch D: layer/compositing and color workflow gaps
- Batch E: filters/export/performance items that are still materially missing
Expected file changes: targeted edits across existing `components/photoshop/*` and `components/photoshop/panels/*` files rather than broad greenfield additions.

4. Verify each batch before moving on.
Expected checks: compile-facing TypeScript integrity where possible, registration/wiring checks, and targeted behavioral verification from the code paths involved.

Important considerations:
- The report is not trustworthy enough to implement verbatim.
- Some listed items are likely present but shallow; those need focused depth work rather than re-creation.
- Some very-large items should only be tackled after confirming they are still genuinely missing and not already partially delivered elsewhere.

If approved, I will exit plan mode and continue with the actual audit in executable mode, then start implementing the verified remainder in batches.