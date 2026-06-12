# Filter Curve Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract deterministic dithering and monotone curve interpolation from `filters/registry.ts` so adjustment and advanced filter modules can depend on them without reverse dependencies.

**Architecture:** Add `components/photoshop/filters/curve-helpers.ts`, importing only clamp helpers from `pixel-helpers.ts`. `registry.ts` imports the three extracted functions; their callers and registry definitions remain unchanged.

**Tech Stack:** TypeScript 5.7, Playwright Test 1.59 node project.

---

### Task 1: Characterize Curve Helpers

**Files:**
- Modify: `tests/filter-module-boundaries.spec.ts`

- [ ] **Step 1: Import the planned functions**

```typescript
import {
  monotoneCurveLut,
  parseCurvePoints,
  pseudoDither,
} from "../components/photoshop/filters/curve-helpers"
```

- [ ] **Step 2: Add deterministic tests**

```typescript
test("curve helpers preserve parsing, interpolation, and dithering", () => {
  expect(parseCurvePoints("255,240;bad;128,160;-4,8")).toEqual([
    [0, 8],
    [128, 160],
    [255, 240],
  ])
  expect(parseCurvePoints(42, [[0, 5], [255, 250]])).toEqual([[0, 5], [255, 250]])

  const identity = monotoneCurveLut([[0, 0], [255, 255]])
  expect(Array.from(identity)).toEqual(Array.from({ length: 256 }, (_, value) => value))

  expect(pseudoDither(0)).toBeCloseTo(0.9216903898159217, 14)
  expect(pseudoDither(1)).toBeCloseTo(0.05721816934965318, 14)
  expect(pseudoDither(17)).toBeCloseTo(0.6441862510764622, 14)
})
```

- [ ] **Step 3: Run and verify missing-module failure**

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts
```

Expected: FAIL resolving `filters/curve-helpers`.

- [ ] **Step 4: Commit the red test**

```powershell
git add tests/filter-module-boundaries.spec.ts
git commit -m "test: characterize filter curve helpers"
```

### Task 2: Extract Curve Helpers

**Files:**
- Create: `components/photoshop/filters/curve-helpers.ts`
- Modify: `components/photoshop/filters/registry.ts`

- [ ] **Step 1: Move the exact helper bodies**

Create `curve-helpers.ts` with:

```typescript
import {
  clamp01,
  clamp8,
} from "./pixel-helpers"

export function parseCurvePoints(value: unknown, fallback: [number, number][] = [[0, 0], [255, 255]]) {
  if (typeof value !== "string") return fallback
  const points = value
    .split(";")
    .map((pair) => {
      const [x, y] = pair.split(",").map((n) => Number(n))
      return Number.isFinite(x) && Number.isFinite(y) ? [clamp8(x), clamp8(y)] as [number, number] : null
    })
    .filter((p): p is [number, number] => !!p)
    .sort((a, b) => a[0] - b[0])
  if (!points.some((p) => p[0] === 0)) points.unshift([0, 0])
  if (!points.some((p) => p[0] === 255)) points.push([255, 255])
  return points.length >= 2 ? points : fallback
}

export function monotoneCurveLut(points: [number, number][]) {
  const pts = points
    .map(([x, y]) => [clamp8(x), clamp8(y)] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[0] !== arr[i - 1][0])
  const n = pts.length
  const d = new Array(Math.max(0, n - 1)).fill(0)
  const m = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1][1] - pts[i][1]) / Math.max(1, pts[i + 1][0] - pts[i][0])
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / d[i]
      const b = m[i + 1] / d[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * d[i]
        m[i + 1] = t * b * d[i]
      }
    }
  }

  const lut = new Uint8ClampedArray(256)
  for (let x = 0; x < 256; x++) {
    let j = 0
    while (j < n - 2 && x > pts[j + 1][0]) j++
    const x0 = pts[j][0]
    const y0 = pts[j][1]
    const x1 = pts[j + 1][0]
    const y1 = pts[j + 1][1]
    const span = Math.max(1, x1 - x0)
    const t = clamp01((x - x0) / span)
    const t2 = t * t
    const t3 = t2 * t
    lut[x] = clamp8(
      (2 * t3 - 3 * t2 + 1) * y0 +
      (t3 - 2 * t2 + t) * span * m[j] +
      (-2 * t3 + 3 * t2) * y1 +
      (t3 - t2) * span * m[j + 1],
    )
  }
  return lut
}

export function pseudoDither(i: number) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
```

- [ ] **Step 2: Import and remove local declarations**

Add to `registry.ts`:

```typescript
import {
  monotoneCurveLut,
  parseCurvePoints,
  pseudoDither,
} from "./curve-helpers"
```

Delete the three local function declarations and leave every caller unchanged.

- [ ] **Step 3: Run focused and static verification**

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts tests/requested-filters-adjustments.spec.ts tests/photo-workflow-depth.spec.ts
npm run lint
npm run typecheck
```

Expected: all tests pass; lint and typecheck exit 0.

- [ ] **Step 4: Commit**

```powershell
git add components/photoshop/filters/curve-helpers.ts components/photoshop/filters/registry.ts
git commit -m "refactor: extract filter curve helpers"
```

### Task 3: Verify

- [ ] **Step 1: Run capability and build gates**

```powershell
npm run check:capabilities
npm run build
```

Expected: both exit 0; the existing circular runtime warning may remain.

- [ ] **Step 2: Inspect**

```powershell
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors and no unrelated files included.
