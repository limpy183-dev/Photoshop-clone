---
created: 2026-05-27T14:38:59.358Z
status: active
---
Verified plan for implementing the real remainder from `comprehensive-implementation-gaps.txt`:

1. Complete a subsystem audit against the actual codebase before edits.
Expected files to inspect: `components/photoshop/panel-registry.tsx`, `components/photoshop/menu-bar.tsx`, `components/photoshop/options-bar.tsx`, `components/photoshop/tool-palette.tsx`, `components/photoshop/status-bar.tsx`, `components/photoshop/capabilities.ts`, and key files under `components/photoshop/panels/`.
Important finding already confirmed: several items marked missing in the report already exist, including `glyphs-panel.tsx`, `notes-panel.tsx`, `discover-panel.tsx`, `learn-panel.tsx`, `libraries-panel.tsx`, `browser-diagnostics-panel.tsx`, and tool registrations for many supposedly missing tools.

2. Produce a verified gap ledger grouped by subsystem.
Output of this step: a reduced list of only the gaps that are still genuinely missing or incomplete after code inspection.
Likely groups:
- Quick UI/workflow gaps
- Panel depth and registration gaps
- Tool behavior/options gaps
- Layer/compositing and selection/channel gaps
- Filter/export/performance gaps

3. Execute the first implementation wave only on independent, high-signal items.
Expected initial file changes will likely center on existing UI and integration files such as:
- `components/photoshop/options-bar.tsx`
- `components/photoshop/status-bar.tsx`
- `components/photoshop/menu-bar.tsx`
- `components/photoshop/panel-registry.tsx`
- specific panel files in `components/photoshop/panels/`
- targeted engine/dialog files for validated missing behavior

4. Parallelize only where edits are file-isolated.
Examples:
- one subtask for a specific panel file
- one subtask for a single dialog file
- one subtask for a single engine file
I will avoid parallel edits that touch shared integration surfaces like `menu-bar.tsx` or `options-bar.tsx` until their dependency map is clear.

5. Integrate and verify batch-by-batch.
Validation will focus on compile-safe changes, registration/wiring consistency, and targeted behavior coverage rather than trying to land all 215 report items blindly.

Important constraints and rationale:
- The report cannot be treated as source of truth.
- Many items appear implemented but may still be shallow; those need depth work, not duplicate creation.
- Some very large items such as full WebGL filter/effect parity or true bezier booleans should only be attempted after confirming they are still materially missing and not already partially handled elsewhere.

If approved, I will exit plan mode and begin the verified audit in executable mode, then start implementing the first validated batches.