# 0006. Machine-enforced, ratcheted architecture budgets

- Status: accepted
- Date: 2026-07-30

## Context

`scripts/check-architecture.mjs` enforces invariants that review reliably fails
to catch: import cycles, raw `ps-*` events, direct client-storage access,
oversized files, `useEditor` fan-out, and coordination-file import/fan-in
limits. This is genuinely valuable and unusual.

But budgets were loose enough to legalise existing debt: 15 files over 1,500
lines permitted, 29,000 combined lines permitted across the top 10 files, 6 hook
dependency suppressions permitted. The gate passed on a codebase whose largest
file was 237 KB. Worse, nothing stopped a PR that breached a budget from simply
raising it in the same diff.

## Decision

Two changes:

1. Every numeric budget is mirrored in `scripts/architecture-budgets.lock.json`.
   `check:architecture` fails if any budget in `architecture-budgets.json` is
   **looser** than its locked value. Budgets may only ever decrease.
   Tightening is done with `node scripts/check-architecture.mjs --update-ratchet`,
   which refuses to run if any budget has been loosened.
2. The text report prints remaining **headroom** for each budget, because slack
   is pre-authorised debt and should be visible on every run.

## Alternatives considered

- **Just lower the numbers now.** Would fail CI immediately and block all work.
  The ratchet freezes the status quo and forces monotonic improvement instead.
- **Review discipline.** Already demonstrably insufficient: the budgets drifted
  upward to accommodate the code.
- **Hard limits with an exceptions list.** An exceptions list is a budget with
  worse ergonomics and no burn-down pressure.

## Consequences

Good: debt can no longer grow silently, and every refactor that reduces it can
be locked in permanently. Loosening a budget becomes a visible, reviewable act
rather than a one-line edit buried in a feature diff.

Accepted costs:

- A legitimate need to raise a budget now requires editing the lock file by
  hand and justifying it in review. That friction is the point.
- The lock file must be regenerated after refactors, or headroom silently
  accumulates again. The headroom print exists to nag about exactly that.
