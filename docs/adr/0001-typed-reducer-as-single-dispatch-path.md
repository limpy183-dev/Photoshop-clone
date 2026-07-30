# 0001. Typed reducer as the single dispatch path

- Status: accepted
- Date: 2026-07-30 (documenting a decision made early in the project)

## Context

The editor exposes the same operation through many entry points: a menu item, a
keyboard shortcut, a command-palette entry, a panel control, a context menu, and
an automation action. A Photoshop-style surface has hundreds of such operations.

The obvious failure mode is drift: the menu item and the shortcut do subtly
different things, one commits history and the other doesn't, one marks the
document dirty and the other doesn't.

## Decision

All editor state lives in `components/photoshop/editor-context.tsx` and is
mutated only by dispatching a member of a discriminated union of typed actions
(`set-brush`, `add-layer`, `apply-filter`, …). Every entry point dispatches the
same action. No component mutates document state directly.

## Alternatives considered

- **Per-feature stores.** Better isolation, but layer/mask/history/selection
  state is deeply interdependent; coordinating N stores per operation would
  reintroduce exactly the drift we are avoiding.
- **Imperative editor API object.** Easy to call, but untyped at the boundary and
  impossible to log, replay, or drive from the automation engine uniformly.

## Consequences

Good:

- One place to audit what an operation does.
- Automation, actions, and the scripting console reuse the same path as the UI,
  so anything scriptable is exactly what the UI does.
- Actions are serialisable, which makes history and the action-manager
  descriptor work tractable.

Accepted costs:

- The context is enormous and its value depends on nearly all state, so any
  change invalidates every `useEditor` consumer. The `useEditor` import count is
  budgeted for this reason, and splitting into selector-subscribed slices while
  keeping one dispatch path is tracked work.
- **The reducer must be pure.** Generating IDs or timestamps inside it, or
  scheduling async work from it, breaks replay and can diverge `stateRef` from
  React state. Compute those before dispatch. This has been violated before; it
  is the single most important invariant in the codebase.
