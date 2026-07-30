# Contributing

Thanks for looking at this. A few things will save you time.

## Read these first

1. **[BOUNDARIES.md](BOUNDARIES.md)** — features that will never be built here
   (Adobe cloud/AI services, native plugin runtimes, certified CMM, codec
   parity, bit-exact algorithm parity). These are non-goals, not backlog. A PR
   that tries to "fix" one will be closed with a link.
2. **[CLAUDE.md](CLAUDE.md)** — the architecture tour: state management, the
   event bus, rendering, history, panels, PSD I/O, testing.
3. **[docs/improvement-roadmap.md](docs/improvement-roadmap.md)** — the current
   prioritised burn-down. If you want to help, start at P0.

## Setup

Node 22 is required and matches CI.

```bash
nvm use 22          # or: fnm use 22
npm ci
npm run doctor      # verifies Node / npm / Playwright
npm run dev         # http://localhost:3000
```

On Windows PowerShell installs where script execution blocks `npm.ps1`, use
`npm.cmd` for every command, e.g. `npm.cmd run verify`.

## The verification contract

One command, and it is the same set of checks CI runs:

```bash
npm run verify
```

That is lint (strict), typecheck, unit tests, source hygiene, capability checks,
architecture budgets, scaffold checks, production build, startup bundle budgets
and the smoke matrix. CI splits these across parallel jobs for speed, but the
union is identical, so if `verify` is green locally CI should be green too.

Useful subsets while iterating:

```bash
npm run typecheck
npm run lint:strict
npm run test:unit
npm run check:architecture
npm run test:smoke
npx playwright test tests/adjustment-layer-workflow.spec.ts
```

Cross-engine smoke (Firefox and WebKit, currently non-blocking in CI):

```bash
npx playwright install firefox webkit
PLAYWRIGHT_CROSS_BROWSER=true npm run test:smoke
```

## House rules

These are enforced by `npm run check:architecture`, not by review taste:

- **No import cycles** inside `components/photoshop/`.
- **No raw `ps-*` CustomEvents or window listeners.** Declare events in
  `events.ts`. The budget is zero.
- **No direct `localStorage` / `sessionStorage` / `indexedDB` access.** Go
  through the storage layer. The budget is zero.
- **Budgets only ever tighten.** Numeric budgets are locked in
  `scripts/architecture-budgets.lock.json`. If your change needs a budget
  raised, that is the signal to split the change instead. After a refactor that
  genuinely reduces debt, run:

  ```bash
  node scripts/check-architecture.mjs --update-ratchet
  ```

And by convention:

- Editor state mutations go through **typed editor actions** in
  `editor-context.tsx`. That is what keeps shortcuts, menus and the command
  palette consistent.
- **The reducer must be pure.** No ID generation, no timestamps, no scheduling.
  Compute those before dispatch.
- New panels are registered in `panel-registry.tsx` so they are discoverable via
  the dock, workspace presets and the command palette.
- New filters pick a lane deliberately — worker-supported, tiled, or synchronous
  fallback — and ship fidelity tests.
- Anything touching the canvas, document model, layer stack or export behaviour
  needs a test in `tests/`.
- Every async round trip that can outlive a document switch carries `docId` and
  a document revision, and discards stale completions.

## Honesty rules

The differentiator of this project is that it tells the truth about what a
browser cannot do. Please protect that:

- Surface new limitations through the capability / preflight reporting path.
  Never silently degrade.
- Do not add absolute claims ("every tool", "full fidelity", unqualified "PSD
  round-trip") to UI or marketing copy. `BOUNDARIES.md` contradicts them.
- Do not ship a UI promise without the route behind it.

## Commits and PRs

- Conventional-ish prefixes: `feat:`, `fix:`, `perf:`, `refactor:`, `test:`,
  `docs:`, `chore:`, `ci:`, `deps:`.
- One concern per PR. A refactor plus a behaviour change in one diff is not
  reviewable.
- Fill in the PR template checklist honestly. "Not applicable" is a fine answer.

## Reporting things

- Bugs: use the **Bug report** issue template. Include the Browser Diagnostics
  output; it usually contains the answer.
- Audit findings: use the **Audit finding** template, one issue per finding.
- Security: **do not open an issue.** See [SECURITY.md](SECURITY.md).
