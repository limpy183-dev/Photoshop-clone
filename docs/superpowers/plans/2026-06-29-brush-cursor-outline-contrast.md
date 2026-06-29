# Brush Cursor Outline Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the brush-size cursor outline readable over light and dark artwork.

**Architecture:** Keep cursor-state resolution unchanged and update only the
canvas overlay painter. The painter will draw a dark outer circle followed by a
white inner circle, preserving the uncluttered brush preview.

**Tech Stack:** TypeScript, Canvas 2D, Playwright

---

### Task 1: Add contrast regression coverage

**Files:**
- Modify: `tests/preferences-performance-settings.spec.ts`
- Modify: `components/photoshop/cursor-overlay.ts`

- [ ] **Step 1: Write the failing test**

Update the brush cursor paint test to record each arc radius and stroke color,
then require a dark outer stroke at radius 16 and a white inner stroke at radius
15 for a 30-pixel brush.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd playwright test tests/preferences-performance-settings.spec.ts --grep "paints the brush cursor"
```

Expected: failure because the current painter emits only one white arc.

- [ ] **Step 3: Write the minimal implementation**

In `paintCanvasCursorOverlay`, draw the outer circle with
`rgba(0,0,0,0.9)` at `radius + 1`, followed by the white circle with
`rgba(255,255,255,1)` at `radius`.

- [ ] **Step 4: Run focused and project verification**

Run:

```powershell
npx.cmd playwright test tests/preferences-performance-settings.spec.ts --grep "paints the brush cursor|resolves canvas cursor overlays"
npm.cmd run typecheck
```

Expected: both cursor tests pass and TypeScript exits successfully.

- [ ] **Step 5: Verify rendered behavior**

Open `/editor`, select the Brush tool, move the pointer over light and dark
canvas regions, and confirm the complete circular footprint remains visible
without a badge obscuring it.
