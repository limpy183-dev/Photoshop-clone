# Brush Cursor Outline Contrast Design

## Goal

Keep the brush-size cursor visible over both light and dark canvas content.

## Design

Render the brush footprint as two concentric one-pixel strokes: a dark outer
ring and a white inner ring. Keep the existing brush-size scaling and cursor
canvas sizing, and do not restore the tool badge or crosshair over the brush
preview.

## Verification

Add a focused renderer regression test that records both arc radii and stroke
colors. Run the targeted Playwright test, typecheck the project, and inspect the
cursor over contrasting canvas content in the rendered editor.
