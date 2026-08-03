# Findings Backlog Status

Generated: 2026-06-21

`Findings.txt` is retained as raw historical review input. Use this file as
the current triage index before treating an older finding as an active defect.

## Confirmed Current Work Items

- Smoke gate was too narrow and could hang on Windows. Addressed in this
  pass with `playwright.smoke.config.ts`, direct Next startup, and 9 smoke
  checks. Keep watching for process leaks.
- Import cycles in `components/photoshop` are current architectural debt.
  Addressed in this pass with `document-rendering.ts`, `learning-types.ts`,
  and `scripts/check-architecture.mjs`.
- Raw `ps-*` event dispatches remain current debt. The current baseline is
  tracked by `scripts/architecture-budgets.json`; future work should reduce
  that count by moving callers to `dispatchPhotoshopEvent`.
- Large editor files remain current maintainability debt. The architecture
  gate tracks the current oversize-file count and prevents growth.
- Storage governance remains active work. `client-storage.ts` now centralizes
  version/privacy metadata and quota-aware writes for migrated stores.

## Resolved Or Superseded Items

- Missing editor Home workspace: resolved before this pass; `/` and `/editor`
  Home surfaces are active and smoke-tested.
- Mobile zero-width canvas: superseded by current responsive behavior and the
  new mobile smoke geometry check.
- Missing license: resolved by the repository `LICENSE`.
- ESLint scanning generated `out/**`: resolved by ESLint ignores.
- Missing CI/bundle/capability gates: resolved by existing CI and strengthened
  by the new architecture gate.
- Generative-fill route lacks limits/origin checks: superseded by current API
  hardening and existing security tests.
- Recent-files preference ignored: superseded by current `recentFilesLimit`
  handling in `recent-documents.ts`.

## Needs Revalidation Before Fixing

- Reducer impurity and double execution claims.
- Save/dirty revision race claims.
- History restore document-binding claims.
- Complete history snapshot contract claims.
- Tile eviction and OPFS namespace claims.
- Tile-only transform mapping and large-document fallback allocation claims.
- WebGL resource cleanup and capability-planning claims.
- Accessibility claims for tabs, resize handles, context menus, and panel
  browsers.
- Marketing copy and unsubscribe claims.

Each revalidated item should get a focused failing test before code changes.

## Accepted Browser Limitations

Items about native Adobe services, native plugins, certified CMM/prepress,
exact native Photoshop parity, and browser-unsupported codec behavior should
be checked against `BOUNDARIES.md` before being filed as defects.
