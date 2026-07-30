# Architecture Decision Records

This project made a number of non-obvious decisions whose reasoning previously
lived only in code comments and `CLAUDE.md`. That works fine for one person and
fails the moment a second person, or the same person six months later, asks
"why is it like this?"

Each ADR captures one decision: the context, the choice, the alternatives that
were rejected, and the consequences we accepted. ADRs are **immutable** once
merged. If a decision changes, add a new ADR and mark the old one superseded.

## Format

```
# NNNN. Title

- Status: accepted | superseded by ADR-NNNN
- Date: YYYY-MM-DD

## Context
## Decision
## Alternatives considered
## Consequences
```

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-typed-reducer-as-single-dispatch-path.md) | Typed reducer as the single dispatch path | accepted |
| [0002](0002-window-event-bus-for-cross-component-signals.md) | Window event bus for cross-component signals | accepted, constrained |
| [0003](0003-png-blob-history-compression.md) | PNG-blob history compression beyond 12 entries | accepted |
| [0004](0004-webgl-compositor-with-canvas2d-fallback.md) | WebGL compositor with a Canvas 2D fallback | accepted |
| [0005](0005-capability-reporting-over-silent-degradation.md) | Capability reporting over silent degradation | accepted |
| [0006](0006-machine-enforced-architecture-budgets.md) | Machine-enforced, ratcheted architecture budgets | accepted |
