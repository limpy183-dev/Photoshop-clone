## What changed

<!-- One or two sentences. What does this PR do, and why now? -->

## Why

<!-- Link the issue this closes. If there is no issue, say why this is
     urgent enough to skip one. -->

Closes #

## Scope check

- [ ] This does **not** attempt anything listed in [BOUNDARIES.md](../BOUNDARIES.md)
- [ ] Editor behaviour changes go through a typed editor action, not ad-hoc state
- [ ] New panels are registered in `panel-registry.tsx`
- [ ] New `ps-*` events are declared in `events.ts` (raw `CustomEvent` budget is 0)
- [ ] New client storage access goes through the storage layer (direct budget is 0)

## Verification

```bash
npm run verify
```

- [ ] `npm run verify` passes locally (Node 22)
- [ ] Added or updated tests for anything touching the canvas, document model,
      layer stack, filters or export behaviour
- [ ] `npm run check:architecture` budgets did **not** need loosening
      (they are ratcheted; see `scripts/architecture-budgets.lock.json`)

## Honesty check

- [ ] No new absolute capability claims in UI or marketing copy that
      [BOUNDARIES.md](../BOUNDARIES.md) contradicts
- [ ] Any new browser limitation is surfaced through the capability /
      preflight reporting path rather than silently degraded

## Screenshots / notes

<!-- Optional. Required for visual changes. -->
