# Smart Filter Editing Design

## Goal

Finish the browser-implementable smart-filter editing workflow: direct canvas mask painting, visible mask edit state, mask density and feather controls, drag reordering in all smart-filter surfaces, and faster stacked preview feedback.

## Scope

The project-native smart-filter model remains the source of truth. Existing `SmartFilter` fields for mask, density, feather, opacity, blend mode, order, and enabled state are preserved. This pass completes the UI and preview behavior around those fields rather than adding native Photoshop PSD smart-filter resources.

## Behavior

Smart-filter masks use Photoshop-style semantics. White reveals the selected filter effect, black hides it, gray partially reveals it, and mask density fades the mask influence toward fully revealed. Feather softens the mask before compositing. Brush, pencil, and eraser-style tools route to the selected filter mask while mask edit mode is active.

The main canvas shows a compact edit banner whenever a per-filter mask is active. The banner names the filter and layer, shows density and feather, and provides an exit control so users are not forced to inspect the Layers panel to understand the current paint target.

## UI Surfaces

The Filter Gallery stack, Properties panel smart-filter section, and Layers panel smart-filter sub-items all support drag-and-drop reordering. Existing compact controls remain; the Layers panel gains drag handles and drop behavior on smart-filter rows.

Mask density and feather controls stay in the Properties panel smart-filter section, with reducer-side clamping and render invalidation. Layer sub-items expose edit state and serve as quick activation targets.

## Preview Performance

Filter Gallery stacked preview reuses a downsampled base image and cached intermediate stack outputs. When one filter parameter or row changes, preview recomputes from the first changed stack entry instead of rebuilding the scaled source and whole stack every render.

## Testing

Focused tests cover reducer normalization, smart-filter preview cache invalidation, layer-panel drag reorder, canvas mask edit UI visibility, and the existing mask-painting history path. Verification uses targeted Playwright tests plus TypeScript checking.
