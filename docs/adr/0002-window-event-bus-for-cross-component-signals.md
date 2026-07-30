# 0002. Window event bus for cross-component signals

- Status: accepted, constrained
- Date: 2026-07-30 (documenting an existing decision)

## Context

Some signals are not state: "open the command palette", "preferences changed,
reload them", "set the dock width". Routing these through React state or props
means threading callbacks through the entire shell, and — worse — a state change
in the shell re-renders the canvas subtree. Opening a right-click menu should
not repaint the canvas.

## Decision

Cross-component signals travel as `ps-*` DOM events on `window`. Every event is
declared with a typed payload in `components/photoshop/events.ts`; raw
`new CustomEvent("ps-…")` and raw `window.addEventListener("ps-…")` calls
outside that module are forbidden, with a budget of zero enforced by
`scripts/check-architecture.mjs`.

## Alternatives considered

- **Prop drilling / callback threading.** Rejected: causes canvas re-renders and
  couples the shell to every leaf.
- **A subscription store (context + selectors).** The better long-term answer for
  anything that is really state. Retained as the target for save, preferences,
  image-size and timeline flows.
- **An in-module event emitter instead of DOM events.** Marginally cleaner, but
  DOM events give us free debuggability and work across the sandboxed plugin
  iframe boundary.

## Consequences

Good: decoupled, cheap, and does not perturb canvas rendering.

Accepted costs:

- Data flow is invisible to the type system at the call site; the typed map in
  `events.ts` is the only thing preventing payload drift, which is why the raw
  budget is zero.
- Ordering and delivery are not guaranteed, so this bus must not carry anything
  that needs transactional semantics. Save, history and document-lifecycle
  flows in particular belong in typed actions with `docId` + revision, not here.
