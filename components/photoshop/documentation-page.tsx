import type { ComponentType, ReactNode } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  Home,
  ImageIcon,
  Keyboard,
  Layers,
  MousePointer2,
  PanelRight,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from "lucide-react"

type FigureFit = "wide" | "dialog" | "panel" | "tall"

type DocumentationFigure = {
  src: string
  alt: string
  title: string
  caption: string
  fit: FigureFit
  shows: string[]
  usage: string[]
  details: string[]
}

type ReferenceBlock = {
  title: string
  body: string
  bullets?: string[]
}

export type DocumentationSection = {
  slug: string
  navLabel: string
  title: string
  eyebrow: string
  icon: ComponentType<{ className?: string }>
  summary: string
  overview: string[]
  workflows: ReferenceBlock[]
  reference: ReferenceBlock[]
  checklists: ReferenceBlock[]
  figureIds: FigureId[]
}

const FIGURES = {
  home: {
    src: "/documentation/home-start-workspace.png",
    alt: "Documentation screenshot of the home start workspace",
    title: "Home launch workspace",
    caption:
      "Home is the launch surface for creating documents, reopening recent work, pinning important files, and jumping into learning workflows.",
    fit: "wide",
    shows: [
      "The left rail with Home, Open image, and Documentation controls.",
      "The header with the Open editor action for entering the full workspace.",
      "New document preset tiles with name, category, dimensions, orientation preview, and memory estimate.",
      "Pinned files and Learn cards in the right sidebar.",
    ],
    usage: [
      "Use preset tiles when the target output size is already known.",
      "Use Open image when the workflow starts from a local raster file instead of a blank canvas.",
      "Use pinned files to keep active projects above the recent file grid.",
      "Use Learn entries when the task is known but the exact command or panel is not.",
    ],
    details: [
      "Recents and pins are stored in the current browser profile.",
      "The preset list uses the same preset source as editor-side new document creation.",
      "The Documentation button now leaves Home and opens this standalone guide.",
    ],
  },
  presets: {
    src: "/documentation/new-document-presets.png",
    alt: "Documentation screenshot of new document presets",
    title: "Home preset grid",
    caption:
      "Preset tiles summarize the starting canvas before the editor is opened, which keeps first-run document creation fast.",
    fit: "wide",
    shows: [
      "Preset categories such as Recent, Photo, Print, Web, Mobile, Icon, Social, and Film.",
      "Representative tiles for Default Canvas, Photo 6 x 4 in, A4, HD 1920 x 1080, Phone Portrait, Square Social, and 4K UHD.",
      "A visual aspect-ratio preview that lets users spot portrait, landscape, and square sizes quickly.",
      "Estimated memory use based on dimensions and bit depth.",
    ],
    usage: [
      "Select a category on the left to jump to related preset groups.",
      "Click a tile to open the editor with that preset already selected.",
      "Compare the memory estimate before choosing extremely large canvases.",
    ],
    details: [
      "Preset launch uses an editor route query so the editor owns final document creation.",
      "The memory estimate is advisory and does not include later layers, masks, or filter buffers.",
      "Print presets use pixel dimensions that match the configured resolution model.",
    ],
  },
  newDocument: {
    src: "/documentation/new-document-dialog.png",
    alt: "Documentation screenshot of the New Document dialog",
    title: "Editor New Document dialog",
    caption:
      "The editor-side dialog provides a more detailed document creation surface for dimensions, resolution, color mode, bit depth, background, and preset review.",
    fit: "dialog",
    shows: [
      "Preset selection inside the editor rather than the Home surface.",
      "Fields for width, height, resolution, units, color mode, bit depth, and background.",
      "A preview area that reflects the selected orientation and document proportions.",
      "Create and cancel actions that keep document creation explicit.",
    ],
    usage: [
      "Use this dialog when a preset is close but needs custom dimensions.",
      "Set resolution and units before building print-targeted documents.",
      "Choose background behavior before the first layer and history entry are created.",
    ],
    details: [
      "The dialog and Home preset grid share the same preset definitions.",
      "Changing the document setup here affects the initial canvas, not an already-open document.",
      "Very large settings should be checked against Browser Diagnostics and Preflight before delivery.",
    ],
  },
  editor: {
    src: "/documentation/editor-workspace.png",
    alt: "Documentation screenshot of the editor workspace",
    title: "Full editor workspace",
    caption:
      "The editor combines menus, tool options, tabs, canvas, tool palette, panel dock, status information, and document-specific controls.",
    fit: "wide",
    shows: [
      "The top menu bar with File, Edit, Image, Layer, Type, Select, Filter, View, Plugins, Window, and Help.",
      "The context-sensitive options bar directly below the menu.",
      "Document tabs, a centered canvas stage, and a bottom status bar.",
      "The left tool palette and the right panel dock.",
    ],
    usage: [
      "Start with the active tool, then use the options bar to refine how that tool behaves.",
      "Use panels for document structure, color, adjustments, history, comments, and diagnostic workflows.",
      "Use View and Window commands when the workspace layout needs to change.",
    ],
    details: [
      "The workspace is browser-native, so canvas size, memory, file APIs, and codecs depend on the current browser.",
      "Workspace presets change which panels are visible without changing the document data.",
      "Status and reports explain browser limits when a workflow cannot exactly match native desktop behavior.",
    ],
  },
  toolPaletteOptions: {
    src: "/documentation/tool-palette-options-bar.png",
    alt: "Documentation screenshot of the tool palette and options bar",
    title: "Tool palette and options bar",
    caption:
      "The tool palette selects the editing mode while the options bar exposes active-tool settings such as brush size, opacity, flow, smoothing, selection behavior, and transform controls.",
    fit: "wide",
    shows: [
      "A compact vertical tool palette with grouped tools.",
      "A horizontal options bar that changes as the active tool changes.",
      "Common settings such as brush size, hardness, opacity, flow, smoothing, and mode.",
      "Canvas-adjacent controls that reduce trips to larger dialogs.",
    ],
    usage: [
      "Select the tool first, then adjust its options before editing the canvas.",
      "Use grouped tool flyouts when a related tool is hidden behind the current icon.",
      "Check the options bar after switching tools because the available controls change.",
    ],
    details: [
      "Tool state is separate from document state and can persist across documents.",
      "Some advanced controls open a dialog or panel when the options bar would be too cramped.",
      "Small controls are intentionally dense to match an editing workspace rather than a marketing layout.",
    ],
  },
  commandPalette: {
    src: "/documentation/command-palette.png",
    alt: "Documentation screenshot of the Command Palette",
    title: "Command Palette",
    caption:
      "The Command Palette is a keyboard-first overlay for finding commands, tools, panels, filters, learning entries, workflow packs, and documentation.",
    fit: "dialog",
    shows: [
      "A searchable command input.",
      "Grouped results from menu commands, panels, tools, filters, learn entries, and docs.",
      "Result descriptions that explain what will open or run.",
      "Keyboard-friendly selection and launch behavior.",
    ],
    usage: [
      "Open the palette when you know the task name but not where it lives in the menus.",
      "Search for panel names such as Layers, History, Comments, Assets, or Browser Diagnostics.",
      "Search for workflow names such as Export As, Selection Mask, or Review Report.",
    ],
    details: [
      "Palette results are backed by the same registries that drive menus, Discover, panels, and learning links.",
      "Commands that require an open document should be run after a document is active.",
      "Search is a navigation aid, not a replacement for compatibility reports or diagnostics.",
    ],
  },
  colorPicker: {
    src: "/documentation/color-picker-dialog.png",
    alt: "Documentation screenshot of the Color Picker dialog",
    title: "Color Picker dialog",
    caption:
      "The full Color Picker gives detailed color selection with hue, saturation, brightness, numeric fields, swatches, recent colors, and harmony context.",
    fit: "dialog",
    shows: [
      "A large saturation and brightness selection area.",
      "Hue and numeric color controls for precise values.",
      "Foreground and background color preview states.",
      "Recent colors and swatches for repeatable choices.",
    ],
    usage: [
      "Use the full dialog when exact color values matter.",
      "Use numeric fields for brand colors, accessibility checks, or repeated values.",
      "Use recent colors and swatches to keep a document palette consistent.",
    ],
    details: [
      "Foreground and background color changes affect tools that consume those colors.",
      "Output fidelity still depends on document color mode and export format support.",
      "Use reports when profile conversion or metadata handling matters for delivery.",
    ],
  },
  hudColorPicker: {
    src: "/documentation/hud-color-picker.png",
    alt: "Documentation screenshot of the HUD Color Picker",
    title: "HUD Color Picker",
    caption:
      "The HUD picker is a compact floating color control for quick foreground or background updates without leaving the canvas workflow.",
    fit: "panel",
    shows: [
      "A small floating color selection surface.",
      "Quick access to hue and color field changes.",
      "Foreground and background context for paint workflows.",
      "A minimal footprint that keeps the canvas visible.",
    ],
    usage: [
      "Use it while painting, masking, retouching, or sampling colors repeatedly.",
      "Switch to the full Color Picker when numeric precision or swatch management is needed.",
      "Close it when it obstructs canvas content or measurement overlays.",
    ],
    details: [
      "The HUD is optimized for speed, not full color-management review.",
      "It pairs best with brush, pencil, shape, fill, and retouching workflows.",
      "Canvas previews should still be checked at the intended zoom level before export.",
    ],
  },
  layers: {
    src: "/documentation/layers-panel.png",
    alt: "Documentation screenshot of the Layers panel",
    title: "Layers panel",
    caption:
      "The Layers panel is the main document structure ledger for visibility, active layer selection, stacking order, masks, adjustments, effects, and nondestructive editing.",
    fit: "panel",
    shows: [
      "Layer rows with visibility, names, active selection state, and layer metadata.",
      "Controls for adding, grouping, duplicating, masking, deleting, and organizing layers.",
      "Blend mode, opacity, lock, and filter controls when the layer stack is active.",
      "A docked panel context that can be resized or moved by workspace presets.",
    ],
    usage: [
      "Select the target layer before running edits, adjustments, transforms, or filters.",
      "Use masks and adjustment layers when edits need to remain reversible.",
      "Keep layer names meaningful before handoff, export review, or report generation.",
    ],
    details: [
      "Layer state is richer than a flat raster export can preserve.",
      "PSD and PSB compatibility depends on the layer type, effects, masks, smart data, and metadata used.",
      "Reports are useful when the layer stack includes browser-only or compatibility-sensitive features.",
    ],
  },
  guides: {
    src: "/documentation/guides-panel.png",
    alt: "Documentation screenshot of the Guides panel",
    title: "Guides panel",
    caption:
      "Guides manage layout alignment, snapping, ruler-derived guide positions, and inspection-oriented positioning controls.",
    fit: "panel",
    shows: [
      "Guide lists with orientation, position, and document context.",
      "Controls for adding, clearing, locking, showing, and snapping to guides.",
      "Alignment support for layout-heavy web, print, social, and icon work.",
      "A panel view that pairs with View menu ruler and grid commands.",
    ],
    usage: [
      "Create guides before laying out text, image crops, UI slices, or print-safe regions.",
      "Lock guides when painting, selection, or transform work should not accidentally move layout references.",
      "Use snapping when aligning repeated elements or export slices.",
    ],
    details: [
      "Guides are document aids and may not appear in final raster exports unless a reporting workflow includes them.",
      "Use Preflight when guides, print margins, or slices matter for handoff.",
      "Ruler units and preferences affect how guide positions are displayed.",
    ],
  },
  history: {
    src: "/documentation/history-panel.png",
    alt: "Documentation screenshot of the History panel",
    title: "History panel",
    caption:
      "History lists recent document states so users can inspect, jump back, compare experiments, and understand what changed.",
    fit: "panel",
    shows: [
      "A chronological list of document operations.",
      "Current state indication.",
      "Undo-oriented checkpoints for edits, filters, selections, and document actions.",
      "A workflow surface for comparing experiments before committing to a direction.",
    ],
    usage: [
      "Use History after filter or adjustment experiments to compare before and after states.",
      "Return to an earlier state when a sequence of edits is not useful.",
      "Save a project file before risky work when the browser session or storage quota is a concern.",
    ],
    details: [
      "History is not a replacement for saved project versions.",
      "Large documents may use memory-aware history behavior.",
      "Exports and reports should be generated from the intended current state.",
    ],
  },
  channels: {
    src: "/documentation/channels-panel.png",
    alt: "Documentation screenshot of the Channels panel",
    title: "Channels panel",
    caption:
      "Channels expose RGB component channels, alpha channels, masks, and channel-oriented document data used by selection and imaging workflows.",
    fit: "panel",
    shows: [
      "Composite and component channel rows.",
      "Visibility and active-channel state.",
      "Alpha, mask, or selection-related channel surfaces.",
      "Channel data that can feed advanced selection and correction workflows.",
    ],
    usage: [
      "Inspect channels when tonal separation or mask quality matters.",
      "Use alpha channels for reusable selections and masks.",
      "Check channel support before expecting a raster export format to preserve extra data.",
    ],
    details: [
      "Not every export format preserves channel data.",
      "PSD or project files are safer when editable channel information must survive handoff.",
      "Browser canvas previews may flatten or approximate some color workflows, so reports should document limitations.",
    ],
  },
  paths: {
    src: "/documentation/paths-panel.png",
    alt: "Documentation screenshot of the Paths panel",
    title: "Paths panel",
    caption:
      "Paths expose vector paths, work paths, and shape-adjacent structures used for selections, clipping, type workflows, and precision editing.",
    fit: "panel",
    shows: [
      "Saved paths and current work path state.",
      "Controls for creating, selecting, converting, or deleting paths.",
      "Vector-adjacent structures that can become selections or masks.",
      "A compact panel that supports precision workflows without crowding the canvas.",
    ],
    usage: [
      "Use paths for clean edges that need more precision than freehand selection.",
      "Convert paths to selections when a pixel operation needs a vector-defined boundary.",
      "Preserve project or PSD data when paths must remain editable for another session.",
    ],
    details: [
      "Path fidelity in external formats depends on the target format and compatibility path.",
      "Path workflows often pair with Pen, Shape, Type, Select, and Mask operations.",
      "Reports should call out path conversion when exporting to flat raster formats.",
    ],
  },
  assets: {
    src: "/documentation/assets-panel.png",
    alt: "Documentation screenshot of the Assets panel",
    title: "Assets panel",
    caption:
      "Assets collect project-local reusable resources such as exported assets, libraries, tags, components, graphics, and delivery bundles.",
    fit: "panel",
    shows: [
      "Asset groups or entries stored with the project context.",
      "Controls for library-like reuse, tagging, and export-oriented organization.",
      "A delivery-focused view for images, slices, and document resources.",
      "Panel data that can be referenced by reports and project saves.",
    ],
    usage: [
      "Use Assets when repeated graphics, exports, or library items need to stay with the project.",
      "Tag or name assets clearly before handoff.",
      "Run export or review reports when assets affect delivery requirements.",
    ],
    details: [
      "Assets are local to the project and browser context unless explicitly exported.",
      "External licensing, stock search, and cloud library sync are outside the browser-local storage boundary.",
      "Project files preserve more asset context than flat raster output.",
    ],
  },
  comments: {
    src: "/documentation/comments-panel.png",
    alt: "Documentation screenshot of the Comments panel",
    title: "Comments panel",
    caption:
      "Comments support review threads, status, resolved discussion, and report-ready collaboration context.",
    fit: "panel",
    shows: [
      "Comment threads or empty-state guidance.",
      "Status and resolution context for review workflows.",
      "Document collaboration data that can be included in reports.",
      "A panel entry point for audit and handoff review.",
    ],
    usage: [
      "Use comments to track requested changes, approvals, and unresolved questions.",
      "Resolve threads before final delivery when possible.",
      "Include comments in review reports when an audit trail is needed.",
    ],
    details: [
      "Comments are project metadata and are not embedded in most flat image exports.",
      "Report generation is the reliable way to hand off comment context.",
      "Comments pair with annotations, notes, and document reports for review-heavy workflows.",
    ],
  },
  selection: {
    src: "/documentation/selection-studio-panel.png",
    alt: "Documentation screenshot of the Selection panel",
    title: "Selection Studio panel",
    caption:
      "Selection Studio brings subject selection, object selection, quick selection, color range, mask refinement, and selection output workflows into one panel.",
    fit: "panel",
    shows: [
      "Selection actions for broad automatic starts and manual refinement.",
      "Mask and output options for converting a selection into editable document state.",
      "Panel guidance for common cutout and isolation workflows.",
      "A focused surface that avoids hunting through multiple Select menu commands.",
    ],
    usage: [
      "Start with subject or object selection when the target has a clear silhouette.",
      "Use Color Range when the target is better defined by color or luminosity than outline.",
      "Use Select and Mask when edge quality, hair, transparency, or feathering matters.",
    ],
    details: [
      "Automatic selection quality depends on image content and browser-side model or fallback support.",
      "Masks are usually safer than deleting pixels because they preserve editability.",
      "Preflight and reports can document workflows that rely on masks or selection output.",
    ],
  },
  adjustmentsPanel: {
    src: "/documentation/adjustments-panel.png",
    alt: "Documentation screenshot of the Adjustments panel",
    title: "Adjustments panel",
    caption:
      "The Adjustments panel keeps tonal and color correction workflows close to the layer stack and canvas preview.",
    fit: "panel",
    shows: [
      "Adjustment categories for exposure, contrast, color, and tonal correction.",
      "Entry points for nondestructive adjustment layers.",
      "Controls that pair with layer masks and document preview.",
      "A compact workflow surface for common correction tasks.",
    ],
    usage: [
      "Prefer adjustment layers when the change may need review or later tuning.",
      "Use masks to limit an adjustment to a selected region.",
      "Compare with History or layer visibility before committing a direction.",
    ],
    details: [
      "Some high-bit and profile-specific operations are constrained by browser canvas support.",
      "Reports can explain color-management limits for delivery-sensitive files.",
      "Adjustment data is preserved more completely in project or compatible layered formats.",
    ],
  },
  filterGallery: {
    src: "/documentation/filter-gallery-dialog.png",
    alt: "Documentation screenshot of the Filter Gallery dialog",
    title: "Filter Gallery",
    caption:
      "Filter Gallery provides preview-led exploration before committing a raster, smart filter, or workflow-specific operation.",
    fit: "dialog",
    shows: [
      "A preview area for checking filter output before applying.",
      "Filter categories and controls for selected filter parameters.",
      "Commit and cancel behavior to avoid accidental destructive changes.",
      "A dialog-scaled surface for settings that would be too large for the options bar.",
    ],
    usage: [
      "Use preview before committing filters on large or delivery-sensitive documents.",
      "Use smart filters when you need editable filter stacks.",
      "Check edge cases at the intended zoom level because previews can hide fine artifacts.",
    ],
    details: [
      "Worker, WebGL, and memory support can affect filter performance.",
      "Some filters may use approximations or fallback paths in browser environments.",
      "Preflight can document filter or compatibility risks before handoff.",
    ],
  },
  cameraRaw: {
    src: "/documentation/camera-raw-dialog.png",
    alt: "Documentation screenshot of the Camera Raw Filter dialog",
    title: "Camera Raw Filter",
    caption:
      "Camera Raw Filter exposes raw-style correction controls while clearly labeling browser and native RAW pipeline boundaries.",
    fit: "dialog",
    shows: [
      "A large preview surface for exposure and tone evaluation.",
      "Correction controls grouped for raw-style adjustments.",
      "Labels that distinguish browser-backed behavior from full native RAW processing.",
      "Dialog actions for applying or cancelling the correction.",
    ],
    usage: [
      "Use it for raw-style exposure, tone, color, and detail corrections on supported inputs.",
      "Use project saves before heavy correction chains on large files.",
      "Run a report if the source format, bit depth, or metadata needs compatibility documentation.",
    ],
    details: [
      "Native camera RAW parity depends on decoder support and browser runtime limits.",
      "Metadata preservation varies by source and export target.",
      "Reports should be used when raw pipeline fidelity matters to the recipient.",
    ],
  },
  export: {
    src: "/documentation/export-as-dialog.png",
    alt: "Documentation screenshot of the Export As dialog",
    title: "Export As dialog",
    caption:
      "Export As prepares browser-deliverable PNG, JPEG, WebP, and AVIF output with scale, quality, matte, transparency, and metadata options.",
    fit: "dialog",
    shows: [
      "Format selection for browser-supported image outputs.",
      "Scale, quality, matte, transparency, and metadata controls.",
      "Preview and delivery settings before download.",
      "Clear separation between export settings and project save behavior.",
    ],
    usage: [
      "Choose PNG for transparency and lossless browser delivery.",
      "Choose JPEG for broad compatibility and smaller photographic files.",
      "Choose WebP or AVIF when target support and size reduction matter.",
      "Use project saves when editable layers and review metadata must be preserved.",
    ],
    details: [
      "Exported raster files flatten or omit many project-only structures.",
      "Codec availability and encoder behavior depend on the current browser.",
      "Use Preflight when output size, color, transparency, or metadata rules are important.",
    ],
  },
  preflight: {
    src: "/documentation/preflight-report.png",
    alt: "Documentation screenshot of the Preflight Check dialog",
    title: "Preflight Check",
    caption:
      "Preflight summarizes document risks before export, print handoff, compatibility review, or large-document delivery.",
    fit: "dialog",
    shows: [
      "A risk summary for document, export, color, metadata, and browser constraints.",
      "Issue severity and suggested quick fixes.",
      "Context that explains whether a concern blocks delivery or should be noted.",
      "A review surface before committing to export or reporting.",
    ],
    usage: [
      "Run it before final export, PSD handoff, print preview, or client review.",
      "Fix blocking issues first, then decide which warnings are acceptable.",
      "Use the report output when another person needs to understand delivery caveats.",
    ],
    details: [
      "Preflight does not change the document unless a quick fix is explicitly applied.",
      "Some warnings describe browser runtime boundaries rather than document mistakes.",
      "Large documents, unusual color modes, metadata, masks, comments, and compatibility features should be reviewed here.",
    ],
  },
  discover: {
    src: "/documentation/discover-panel.png",
    alt: "Documentation screenshot of the Discover panel",
    title: "Discover panel",
    caption:
      "Discover indexes tools, commands, panels, filters, documentation, and workflows so users can search by intent.",
    fit: "panel",
    shows: [
      "Search across app features rather than one menu at a time.",
      "Results for commands, tools, panels, filters, docs, and workflows.",
      "Descriptions that explain why a result may help.",
      "A panel-based alternative to the modal Command Palette.",
    ],
    usage: [
      "Use Discover when you want to browse or learn without interrupting the document view.",
      "Search for tasks such as export, mask, browser limits, comments, assets, or shortcuts.",
      "Open learning entries from Discover when a workflow needs more guidance.",
    ],
    details: [
      "Discover uses the same indexed feature model as command search and learning links.",
      "Some results may require an open document before they can run.",
      "Discover helps locate features; diagnostics and reports explain capability boundaries.",
    ],
  },
  browserDiagnostics: {
    src: "/documentation/browser-diagnostics-panel.png",
    alt: "Documentation screenshot of the Browser Diagnostics panel",
    title: "Browser Diagnostics panel",
    caption:
      "Browser Diagnostics reports runtime support for memory, canvas, WebGL, file APIs, OPFS storage, encoders, workers, and fallback paths.",
    fit: "panel",
    shows: [
      "Capability checks for the current browser profile.",
      "Runtime support for rendering, storage, media, encoding, worker, and file features.",
      "Warnings or fallback notes for features that are unavailable.",
      "A troubleshooting surface for document size, performance, and export issues.",
    ],
    usage: [
      "Open this panel when a document is slow, a format is unavailable, or export behavior differs by browser.",
      "Use diagnostics before starting a very large document or high-bit workflow.",
      "Attach diagnostic context to bug reports when behavior depends on the browser profile.",
    ],
    details: [
      "Diagnostics describe the runtime; they do not grant capabilities the browser does not expose.",
      "Private browsing, extensions, enterprise policies, and storage settings can change results.",
      "When diagnostics and Preflight disagree, inspect the document-specific Preflight note first.",
    ],
  },
  keyboardShortcuts: {
    src: "/documentation/keyboard-shortcuts-dialog.png",
    alt: "Documentation screenshot of the Keyboard Shortcuts dialog",
    title: "Keyboard Shortcuts dialog",
    caption:
      "Keyboard Shortcuts lists and customizes key bindings for tools, menu commands, panels, and workflow accelerators.",
    fit: "dialog",
    shows: [
      "Shortcut categories and searchable command rows.",
      "Current key bindings and conflict-aware customization controls.",
      "Reset or save behavior for restoring known shortcut sets.",
      "A productivity surface for command-heavy editing.",
    ],
    usage: [
      "Search for a command when you know its name but not its binding.",
      "Customize bindings that conflict with your browser, operating system, or editing habits.",
      "Reset shortcuts when a custom set makes the app hard to operate.",
    ],
    details: [
      "Browser and OS shortcuts may take priority over app shortcuts.",
      "Custom shortcuts are local to this browser profile unless explicitly exported by a project workflow.",
      "Menu and command registry updates should be reflected in this dialog.",
    ],
  },
  preferences: {
    src: "/documentation/preferences-dialog.png",
    alt: "Documentation screenshot of the Preferences dialog",
    title: "Preferences dialog",
    caption:
      "Preferences controls performance, RAM budgets, scratch storage, rulers, grids, tool behavior, cursor behavior, and technology previews.",
    fit: "dialog",
    shows: [
      "Performance and memory settings for browser-based editing.",
      "Scratch storage and local data controls.",
      "Rulers, grids, cursor, tool, and preview behavior.",
      "Technology-preview settings for experimental features.",
    ],
    usage: [
      "Adjust performance settings when large files or filters feel slow.",
      "Review storage preferences before relying on local project snapshots.",
      "Reset preferences when workspace behavior is unexpectedly changed.",
    ],
    details: [
      "Preferences are local to the browser profile.",
      "Changing memory budgets cannot exceed the browser process limits.",
      "Experimental features should be treated as compatibility-sensitive in reports.",
    ],
  },
  documentReport: {
    src: "/documentation/document-report-dialog.png",
    alt: "Documentation screenshot of the Round-Trip Inspector dialog",
    title: "Round-Trip Inspector",
    caption:
      "Round-Trip Inspector collects project and PSD import/export fidelity reports for compatibility review and audit handoff.",
    fit: "dialog",
    shows: [
      "Import, export, and compatibility report sections.",
      "Fidelity notes for layer, metadata, color, and unsupported feature handling.",
      "Audit-ready detail that can be shared with collaborators.",
      "A report surface for workflows where file round-tripping matters.",
    ],
    usage: [
      "Run it after importing PSD or PSB files that need compatibility review.",
      "Use it before handing off a file to another editor or native Photoshop workflow.",
      "Attach the generated text report when delivery caveats need to be explicit.",
    ],
    details: [
      "The report explains what was preserved, approximated, flattened, or omitted.",
      "Round-trip review is separate from visual inspection; use both for high-value delivery.",
      "Project files remain the safest way to preserve browser-only state.",
    ],
  },
} satisfies Record<string, DocumentationFigure>

type FigureId = keyof typeof FIGURES

export const DOCUMENTATION_SECTIONS: DocumentationSection[] = [
  {
    slug: "start-workspace",
    navLabel: "Start workspace",
    title: "Start workspace",
    eyebrow: "Launch surface",
    icon: PanelRight,
    summary:
      "Home is the launch and recovery surface for the browser editor. It creates new documents, opens local images, restores recent work, pins active files, and routes users into learning or documentation without requiring an open document.",
    overview: [
      "The Start workspace is intentionally task-first. It avoids a marketing page and places the first useful controls in view: create a canvas, open the editor, import an image, reopen recent work, pin important files, and jump to workflow guidance.",
      "The left rail now treats Documentation as a separate destination. Selecting the book icon navigates to the documentation route instead of scrolling down the Home page.",
      "Home keeps recent files and pinned files browser-local. Clearing site data, changing browser profiles, or using private browsing can remove those entries because they are not cloud-synced.",
    ],
    workflows: [
      {
        title: "Create a new blank canvas",
        body: "Use a preset tile when the output size is already known. The tile launches the editor with the selected preset and creates the initial document state there.",
        bullets: [
          "Check the category, dimensions, orientation preview, and memory estimate.",
          "Use Default Canvas for quick testing and Photo, Print, Web, Mobile, Icon, Social, or Film for targeted output.",
          "Open the editor directly if you need the full File > New dialog first.",
        ],
      },
      {
        title: "Open an existing image",
        body: "Use the image button on the left rail to choose a local image and hand it to the editor startup flow.",
        bullets: [
          "The file picker accepts browser-readable image files.",
          "The editor receives the selected image through a local startup handoff.",
          "If the file does not open, use Browser Diagnostics and import compatibility notes before assuming the image is corrupt.",
        ],
      },
      {
        title: "Resume work",
        body: "Recent and pinned documents help resume browser-local projects without searching the file system again.",
        bullets: [
          "Pin active work so it stays above the general recent list.",
          "Open project files when layers, comments, reports, and app-specific metadata matter.",
          "Treat recents as convenience state rather than permanent backup.",
        ],
      },
    ],
    reference: [
      {
        title: "Left rail",
        body: "The rail provides persistent entry points for Home, image import, and Documentation. It is intentionally icon-first because this is an application shell, not a content site.",
      },
      {
        title: "Learn panel",
        body: "Learn cards route into focused editor workflows such as selection masks, Export As, review reports, and browser limits. They are task shortcuts, while this documentation is the full reference.",
      },
      {
        title: "Pinned files",
        body: "Pins are stored by document id in browser storage. If a pinned document is no longer present in recents, the pin cannot render a usable file tile.",
      },
    ],
    checklists: [
      {
        title: "Start workspace checklist",
        body: "Before leaving Home, confirm that the entry route matches the task.",
        bullets: [
          "Use a preset for new work.",
          "Use Open image for a local raster file.",
          "Use Open editor for direct access to the full shell.",
          "Use Learn for guided task workflows.",
          "Use Documentation for comprehensive reference pages.",
        ],
      },
    ],
    figureIds: ["home", "presets"],
  },
  {
    slug: "documents-files",
    navLabel: "Documents and files",
    title: "Documents and files",
    eyebrow: "Document lifecycle",
    icon: FileText,
    summary:
      "Document and file workflows decide what the app can preserve. Project files retain the richest browser-editor state; raster exports are for delivery; PSD and PSB paths focus on interoperability and should be checked with compatibility reports.",
    overview: [
      "Document creation can begin from Home presets, the editor New Document dialog, an imported local image, a recent project snapshot, or a file-open workflow inside the editor.",
      "A project file is the safest format for ongoing work because it can preserve layers, comments, annotations, local assets, workflow metadata, reports, and browser-only structures.",
      "Raster formats such as PNG, JPEG, WebP, and AVIF are delivery formats. They are useful outputs, but they intentionally flatten or omit editable structures.",
    ],
    workflows: [
      {
        title: "Choose the right file path",
        body: "Start by deciding whether the next person needs editable document state or a final image.",
        bullets: [
          "Use project files for ongoing layered work.",
          "Use PSD or PSB when the recipient expects Photoshop-style structures and compatibility notes are acceptable.",
          "Use PNG, JPEG, WebP, or AVIF when the recipient only needs a flat image.",
        ],
      },
      {
        title: "Create a custom document",
        body: "Open the editor New Document dialog when a preset is close but not exact.",
        bullets: [
          "Set dimensions, resolution, units, color mode, bit depth, and background before document creation.",
          "Check the memory impact of very large documents before continuing.",
          "Name and save the project before a long edit session.",
        ],
      },
      {
        title: "Protect review context",
        body: "When comments, notes, annotations, reports, or asset metadata are part of the work, keep a project file even if a raster export is also delivered.",
        bullets: [
          "Reports can summarize what a raster export cannot contain.",
          "Comments and review threads should be resolved or explicitly documented before final handoff.",
          "Preflight should be run before delivery when compatibility matters.",
        ],
      },
    ],
    reference: [
      {
        title: "Project files",
        body: "Project files are designed to preserve app-specific editing state. They are the best option for continuing work in this browser editor.",
      },
      {
        title: "Raster imports",
        body: "Imported rasters become document content and can then receive layers, masks, adjustments, filters, comments, and reports. The original source format may not be preserved once the document becomes a project.",
      },
      {
        title: "PSD and PSB compatibility",
        body: "Layered Photoshop compatibility depends on the exact structures used. Browser-only features, unsupported layer effects, unusual metadata, profile handling, or high-bit paths should be called out in reports.",
      },
      {
        title: "Recent files",
        body: "Recent entries are a convenience layer backed by browser storage. They should not be treated as the only copy of valuable work.",
      },
    ],
    checklists: [
      {
        title: "Before saving or exporting",
        body: "Use this quick decision path when choosing how to store the document.",
        bullets: [
          "Need to edit later: save a project file.",
          "Need broad image compatibility: export a raster.",
          "Need Photoshop handoff: use PSD or PSB and run a compatibility report.",
          "Need audit context: generate a review or round-trip report.",
        ],
      },
    ],
    figureIds: ["presets", "newDocument"],
  },
  {
    slug: "editor-workspace",
    navLabel: "Editor workspace",
    title: "Editor workspace",
    eyebrow: "Editing shell",
    icon: SlidersHorizontal,
    summary:
      "The editor workspace is the production surface. It combines menus, tool options, document tabs, canvas rendering, tool selection, panels, color controls, command search, reports, and status feedback in a browser-native shell.",
    overview: [
      "The layout follows familiar desktop image-editor structure while remaining explicit about browser boundaries. Menus own command discovery, the options bar owns active-tool settings, the center stage owns canvas preview, and the right dock owns document and workflow panels.",
      "The editor is dense on purpose. It is used for repeated editing workflows, not a first-time marketing tour. Controls use small labels, icons, and panels so the canvas remains the main workspace.",
      "Command Palette, Discover, tooltips, Window menu entries, and Learn links all point into the same registered feature model so users can find tools by name, task, or panel.",
    ],
    workflows: [
      {
        title: "Orient yourself after opening a document",
        body: "Read the editor from top to bottom: menus, active-tool options, document tabs, canvas, side tools, panels, and status.",
        bullets: [
          "Use File and Edit for document actions and undo-level operations.",
          "Use Image, Layer, Type, Select, and Filter for image-specific work.",
          "Use Window to show, hide, or reset panel layouts.",
        ],
      },
      {
        title: "Find a feature fast",
        body: "Use Command Palette for modal keyboard search or Discover for a persistent panel search surface.",
        bullets: [
          "Search for panels such as Layers, Guides, Assets, Comments, or Browser Diagnostics.",
          "Search for workflows such as Export As, Selection Mask, Preflight, or Round-Trip Inspector.",
          "Use Learn entries when a workflow needs step-by-step context.",
        ],
      },
      {
        title: "Adjust colors",
        body: "Use the HUD color picker for quick canvas-adjacent changes and the full Color Picker dialog when precision, swatches, or numeric fields matter.",
        bullets: [
          "Foreground and background colors affect paint, fill, shape, and retouch workflows.",
          "Use swatches and recent colors for consistency.",
          "Use reports when color profile or export fidelity is delivery-sensitive.",
        ],
      },
    ],
    reference: [
      {
        title: "Menu bar",
        body: "Menus contain file operations, editing commands, image operations, layer operations, type workflows, selection commands, filters, view options, plugin access, panel visibility, and help surfaces.",
      },
      {
        title: "Options bar",
        body: "The options bar changes with the active tool. It is the first place to check when a tool behaves differently than expected.",
      },
      {
        title: "Canvas stage",
        body: "The stage renders the document and overlays such as selections, guides, grids, transforms, previews, masks, and diagnostic indicators.",
      },
      {
        title: "Panel dock",
        body: "Panels are grouped into workspace presets and can be opened from commands, Discover, the Window menu, learning flows, and workflow events.",
      },
      {
        title: "Status bar",
        body: "Status information helps explain zoom, document size, browser constraints, and operation context without opening a modal.",
      },
    ],
    checklists: [
      {
        title: "Editor troubleshooting checklist",
        body: "When the editor does not behave as expected, isolate which surface owns the issue.",
        bullets: [
          "Tool issue: check active tool and options bar.",
          "Panel issue: open Window or Discover and reset the workspace if needed.",
          "Canvas issue: check zoom, document size, overlays, and browser diagnostics.",
          "Export issue: run Preflight and compare output format capabilities.",
        ],
      },
    ],
    figureIds: ["editor", "toolPaletteOptions", "commandPalette", "colorPicker", "hudColorPicker"],
  },
  {
    slug: "tools-panels",
    navLabel: "Tools and panels",
    title: "Tools and panels",
    eyebrow: "Core editing",
    icon: Layers,
    summary:
      "Tools change how user input edits the document. Panels expose the state, registries, history, structure, assets, comments, measurement, and diagnostics needed to control complex image work.",
    overview: [
      "The Layers panel is the central document ledger, but it is only one part of the panel model. Guides, History, Channels, Paths, Assets, Comments, Adjustments, Properties, Color, Swatches, Learn, Discover, Browser Diagnostics, and other panels each own a specific editing or review concern.",
      "Panels are intentionally modular. A user can keep only the panels needed for the current workflow visible, then use workspace presets or search to recover the rest.",
      "Panel data often has different export behavior than pixels. Layers, comments, assets, paths, channels, and guides may need project files, PSD compatibility paths, or reports to survive handoff.",
    ],
    workflows: [
      {
        title: "Keep edits nondestructive",
        body: "Use Layers, masks, adjustment layers, smart filters, and History to preserve alternatives while editing.",
        bullets: [
          "Select the correct layer before editing.",
          "Use masks instead of erasing when a cutout may need revision.",
          "Use History to compare experiments, but save project versions for durable rollback.",
        ],
      },
      {
        title: "Use layout aids",
        body: "Use Guides with rulers, grids, snapping, slices, and export assets when a document has layout or delivery constraints.",
        bullets: [
          "Lock guides before detailed editing.",
          "Use snapping when repeated elements must align.",
          "Run Preflight when guides or slices are relevant to handoff.",
        ],
      },
      {
        title: "Prepare collaborative handoff",
        body: "Use Comments, Assets, and reports when work needs review or delivery context beyond the flat image.",
        bullets: [
          "Resolve comments before final export when possible.",
          "Keep assets named and tagged.",
          "Generate review reports for unresolved comments, annotations, and compatibility notes.",
        ],
      },
    ],
    reference: [
      {
        title: "Layers",
        body: "Layers define document structure, active edit target, visibility, stacking order, masks, effects, adjustments, groups, smart data, and many export compatibility concerns.",
      },
      {
        title: "Guides",
        body: "Guides help align layout, slices, safe areas, print boundaries, and repeated elements. They are editing aids and require reports or project files when they need to be communicated.",
      },
      {
        title: "History",
        body: "History records recent operations. It is useful for experimentation but should not replace explicit saves for valuable work.",
      },
      {
        title: "Channels",
        body: "Channels represent component, alpha, mask, and selection-related data. Not every export path preserves channel data.",
      },
      {
        title: "Paths",
        body: "Paths preserve vector-defined boundaries and precision structures that can become selections, masks, clipping paths, or shape-related data.",
      },
      {
        title: "Assets",
        body: "Assets organize project-local reusable graphics, slices, export resources, tags, and library-like items.",
      },
      {
        title: "Comments",
        body: "Comments store review discussion, status, and resolved context. They should be included in reports when collaboration history matters.",
      },
    ],
    checklists: [
      {
        title: "Panel handoff checklist",
        body: "Before sharing a document, check which panel data must survive.",
        bullets: [
          "Layers, masks, smart filters, and adjustments: use a layered or project format.",
          "Guides, paths, channels, and slices: verify format support or include a report.",
          "Assets, comments, annotations, and notes: keep the project file or generate review documentation.",
          "History: save meaningful versions instead of relying on session history.",
        ],
      },
    ],
    figureIds: ["layers", "guides", "history", "channels", "paths", "assets", "comments"],
  },
  {
    slug: "selection-masking",
    navLabel: "Selection and masking",
    title: "Selection and masking",
    eyebrow: "Masking workflows",
    icon: MousePointer2,
    summary:
      "Selection and masking workflows isolate part of the document before edits are applied. The safest path is to start broad, inspect the boundary, refine the edge, and output to an editable mask whenever future changes are likely.",
    overview: [
      "Selections are temporary boundaries; masks are durable editable document data. Use selections for quick isolated edits and masks for cutouts, composites, review cycles, and nondestructive workflows.",
      "The app supports a range of selection intents: subject, object, quick selection, lasso-style tracing, color range, focus or sky-oriented workflows, Select and Mask, Quick Mask, path-to-selection workflows, and mask output.",
      "Selection quality is content-dependent. Automatic tools work best when the subject boundary is visually clear. Manual refinement is still required for hair, transparency, motion blur, low contrast edges, and intricate details.",
    ],
    workflows: [
      {
        title: "Create a clean cutout",
        body: "Use the fastest broad selection first, then refine the edge and output to a mask rather than deleting pixels.",
        bullets: [
          "Start with subject or object selection.",
          "Inspect the boundary with overlays or marching ants.",
          "Use Select and Mask for feathering, smoothing, contrast, decontamination, and output.",
          "Save as project or layered format when the mask must remain editable.",
        ],
      },
      {
        title: "Select by color or tone",
        body: "Use Color Range when shape tools are less useful than hue, saturation, luminosity, or channel contrast.",
        bullets: [
          "Sample the target color range.",
          "Adjust fuzziness or tolerance until the preview matches the desired target.",
          "Refine with Quick Mask or a layer mask after the broad color selection is created.",
        ],
      },
      {
        title: "Turn precision paths into selections",
        body: "Use paths when a vector-defined edge is more reliable than painted or automatic selection.",
        bullets: [
          "Create or select the path in the Paths panel.",
          "Convert it to a selection when pixel edits are needed.",
          "Preserve the path in the project if the boundary may need to be edited later.",
        ],
      },
    ],
    reference: [
      {
        title: "Selection Studio",
        body: "Selection Studio centralizes subject, object, quick selection, mask output, edge refinement, and related actions so users do not need to jump across several menu paths.",
      },
      {
        title: "Quick Mask",
        body: "Quick Mask lets users paint selection state directly. It is often faster than drawing complex boundaries with lasso tools.",
      },
      {
        title: "Select and Mask",
        body: "Select and Mask is the refinement step for difficult edges. It should be used when the first selection is close but not final.",
      },
      {
        title: "Output choices",
        body: "Selections can become masks, layers, channels, paths, or isolated edits. Choose the output based on how much editability is needed.",
      },
    ],
    checklists: [
      {
        title: "Selection quality checklist",
        body: "Before applying an isolated edit or export, inspect the selection result.",
        bullets: [
          "Check the edge at realistic zoom and at high zoom.",
          "Look for halos, clipped hair, missed transparent pixels, and color contamination.",
          "Prefer masks for client review and composites.",
          "Document automatic-selection limitations in reports when fidelity matters.",
        ],
      },
    ],
    figureIds: ["selection"],
  },
  {
    slug: "adjustments-filters",
    navLabel: "Adjustments and filters",
    title: "Adjustments and filters",
    eyebrow: "Image operations",
    icon: Wrench,
    summary:
      "Adjustments change tone and color; filters change pixels, previews, or smart filter stacks. Prefer nondestructive layers and smart filters when a workflow needs review, rollback, or compatibility notes.",
    overview: [
      "Adjustment workflows include levels, curves, exposure, contrast, hue, saturation, vibrance, color balance, black and white, shadows and highlights, replace color, match color, HDR-style correction, and automatic correction paths.",
      "Filter workflows include preview-led dialogs, smart filters, blur, sharpen, noise, stylize, render, pixelate, distortion, legacy effects, camera raw style correction, and worker or WebGL accelerated paths where available.",
      "Browser rendering and file APIs can influence high-bit, profile-aware, large-document, and raw-style operations. Preflight and reports should be used when output fidelity matters.",
    ],
    workflows: [
      {
        title: "Apply tonal correction",
        body: "Use adjustment layers for corrections that may need later tuning.",
        bullets: [
          "Select the target layer or create an adjustment layer above it.",
          "Use masks to localize the correction.",
          "Compare with layer visibility and History before export.",
        ],
      },
      {
        title: "Preview a filter",
        body: "Use Filter Gallery or a dedicated filter dialog when settings need visual review.",
        bullets: [
          "Preview at the intended zoom level.",
          "Use smart filters for editable filter stacks.",
          "Run Preflight when the filter result or compatibility matters for handoff.",
        ],
      },
      {
        title: "Use raw-style controls",
        body: "Use Camera Raw Filter for exposure, tone, detail, and color workflows that benefit from a large preview and grouped correction controls.",
        bullets: [
          "Understand that browser RAW parity depends on decoder and runtime support.",
          "Save project state before heavy correction chains.",
          "Use reports when source metadata or bit depth matters.",
        ],
      },
    ],
    reference: [
      {
        title: "Adjustment layers",
        body: "Adjustment layers keep correction parameters editable and can be masked or reordered. They are preferred for work that will be reviewed.",
      },
      {
        title: "Direct adjustments",
        body: "Direct adjustments apply to pixels faster but are harder to revise. Use them for quick edits or duplicated layers.",
      },
      {
        title: "Smart filters",
        body: "Smart filters preserve filter settings and masks where supported. They are the safer path for complex filter stacks.",
      },
      {
        title: "Performance",
        body: "Large filters may use tiles, workers, WebGL, dirty rectangles, progressive previews, or fallback paths. Browser Diagnostics explains current runtime support.",
      },
      {
        title: "Color management",
        body: "Profiles, high-bit buffers, proofing, gamut warnings, and metadata can be constrained by browser support and export format capability.",
      },
    ],
    checklists: [
      {
        title: "Before applying a heavy operation",
        body: "Use this checklist for large documents, high-value output, or compatibility-sensitive work.",
        bullets: [
          "Duplicate or save the project first.",
          "Prefer adjustment layers or smart filters.",
          "Check the preview at multiple zoom levels.",
          "Run Preflight before final export.",
        ],
      },
    ],
    figureIds: ["adjustmentsPanel", "filterGallery", "cameraRaw"],
  },
  {
    slug: "export-reports",
    navLabel: "Export and reports",
    title: "Export and reports",
    eyebrow: "Delivery",
    icon: Download,
    summary:
      "Export prepares deliverable files; reports explain what the deliverable can and cannot contain. Use Export As for browser image output, Preflight for risk review, and Round-Trip Inspector when compatibility needs an audit trail.",
    overview: [
      "Export As is the standard path for browser-friendly raster output. It controls output format, quality, scale, matte, transparency, and metadata behavior.",
      "Reports exist because not every editing structure can fit into every output format. Layers, masks, comments, annotations, guides, paths, assets, profiles, and browser-only metadata may need explicit documentation.",
      "Preflight is proactive. Run it before delivery, not after a recipient finds a problem. Round-Trip Inspector is for import/export fidelity and compatibility review.",
    ],
    workflows: [
      {
        title: "Export a delivery image",
        body: "Use Export As when the target is a flat image for web, app, CMS, preview, or broad sharing.",
        bullets: [
          "Choose the format based on transparency, size, quality, and target support.",
          "Set scale and matte before download.",
          "Verify the downloaded file in the target viewer when the delivery is important.",
        ],
      },
      {
        title: "Run Preflight",
        body: "Use Preflight before exporting a file with large dimensions, unusual color, transparency, metadata, comments, or compatibility-sensitive structures.",
        bullets: [
          "Fix blocking issues first.",
          "Decide which warnings are acceptable and document them.",
          "Use quick fixes only when they match the intended output.",
        ],
      },
      {
        title: "Generate a compatibility report",
        body: "Use Round-Trip Inspector when PSD or PSB import/export fidelity needs to be reviewed.",
        bullets: [
          "Check what was preserved, approximated, flattened, or omitted.",
          "Attach the report to handoff notes.",
          "Keep the project file when browser-only data must be preserved.",
        ],
      },
    ],
    reference: [
      {
        title: "PNG",
        body: "Use PNG for transparency, lossless browser output, UI assets, and images where compression artifacts are unacceptable.",
      },
      {
        title: "JPEG",
        body: "Use JPEG for broad compatibility and photographic output where transparency is not needed.",
      },
      {
        title: "WebP and AVIF",
        body: "Use WebP or AVIF when file size and target support justify modern codecs. Check browser encoder availability.",
      },
      {
        title: "Review reports",
        body: "Review reports summarize comments, annotations, replies, tags, unresolved discussion, and delivery notes for audit-ready handoff.",
      },
      {
        title: "Round-trip reports",
        body: "Round-trip reports focus on file fidelity across import and export, especially for Photoshop-style layered workflows.",
      },
    ],
    checklists: [
      {
        title: "Export readiness checklist",
        body: "Run through these checks before delivering files.",
        bullets: [
          "Confirm output dimensions, scale, and format.",
          "Check transparency, matte, quality, and metadata settings.",
          "Run Preflight for large or compatibility-sensitive documents.",
          "Generate review or round-trip reports when handoff needs context.",
          "Keep the editable project file for future changes.",
        ],
      },
    ],
    figureIds: ["export", "preflight", "documentReport"],
  },
  {
    slug: "browser-limits",
    navLabel: "Browser limits",
    title: "Browser limits",
    eyebrow: "Runtime boundaries",
    icon: ShieldCheck,
    summary:
      "The editor runs inside the browser, so memory, canvas size, storage, encoders, WebGL, workers, file access, and security permissions are runtime boundaries. Diagnostics and reports make those limits visible.",
    overview: [
      "Browser limits are not automatically app bugs. They are the boundaries of the current browser profile, hardware, policies, storage quota, extensions, and available APIs.",
      "The app exposes Browser Diagnostics, Preflight, Discover, learning entries, and reports so users can distinguish document problems from runtime constraints.",
      "A workflow may behave differently across browsers or profiles if one supports a required encoder, WebGL feature, OPFS storage mode, worker path, or file API and another does not.",
    ],
    workflows: [
      {
        title: "Investigate performance",
        body: "Open Browser Diagnostics when canvas rendering, filters, previews, or large document behavior feels slow.",
        bullets: [
          "Check memory and canvas limits.",
          "Check WebGL and worker availability.",
          "Reduce document size, close panels, or use smaller previews when runtime limits are reached.",
        ],
      },
      {
        title: "Investigate export support",
        body: "Use diagnostics when a format, encoder, or file access path is unavailable.",
        bullets: [
          "Check whether the browser exposes the needed image encoder.",
          "Use a more compatible export format when the target encoder is missing.",
          "Document browser-specific export behavior in the report.",
        ],
      },
      {
        title: "Recover from local storage issues",
        body: "Review storage behavior when recents, preferences, project snapshots, or local libraries are missing.",
        bullets: [
          "Check whether the user changed profiles, cleared site data, or used private browsing.",
          "Save durable project files outside browser-only storage.",
          "Use Preferences and diagnostics to understand local storage boundaries.",
        ],
      },
    ],
    reference: [
      {
        title: "Memory",
        body: "Large canvases, deep history, many layers, smart filters, high-bit data, and previews all consume memory. Browser process limits can be lower than system memory.",
      },
      {
        title: "Canvas",
        body: "Maximum canvas dimensions and total pixel area vary by browser and hardware. Very large documents may need tiled or reduced-preview paths.",
      },
      {
        title: "Storage",
        body: "Recents, preferences, workspace settings, local libraries, and snapshots are local to the browser profile unless explicitly saved or exported.",
      },
      {
        title: "Security",
        body: "File access, downloads, plugins, metadata handling, and external actions are bounded by browser security rules.",
      },
      {
        title: "Codecs",
        body: "Import and export format support depends on browser APIs, bundled decoders, safe sniffing, and encoder availability.",
      },
    ],
    checklists: [
      {
        title: "Browser-limit checklist",
        body: "Use this when behavior changes between machines, profiles, or browsers.",
        bullets: [
          "Open Browser Diagnostics.",
          "Run Preflight on the current document.",
          "Compare format support and encoder availability.",
          "Check storage quota and profile state.",
          "Attach diagnostics to reports when handoff depends on runtime support.",
        ],
      },
    ],
    figureIds: ["discover", "browserDiagnostics"],
  },
  {
    slug: "troubleshooting",
    navLabel: "Troubleshooting",
    title: "Troubleshooting",
    eyebrow: "Self-service",
    icon: Search,
    summary:
      "Troubleshooting starts by identifying which layer owns the symptom: launch, document loading, tools, panels, canvas rendering, selections, filters, export, storage, shortcuts, preferences, browser capability, or file compatibility.",
    overview: [
      "Most issues are easier to solve when the symptom is mapped to one surface. Home issues usually involve storage or routing. Editor issues usually involve active tool state, panels, canvas rendering, or document data. Export issues usually involve format capabilities, metadata, color, or browser encoders.",
      "Use visible UI first: reset a workspace, check the active tool, search Discover, inspect History, run Preflight, and open Browser Diagnostics. Then use reports for compatibility or audit context.",
      "Keyboard Shortcuts and Preferences are important recovery surfaces because customized behavior can make an otherwise working editor feel broken.",
    ],
    workflows: [
      {
        title: "A command is hard to find",
        body: "Use Command Palette or Discover before scanning menus manually.",
        bullets: [
          "Search by task name, panel name, filter name, or workflow name.",
          "Open Learn entries when a command needs context.",
          "Check Keyboard Shortcuts when the issue is speed rather than discoverability.",
        ],
      },
      {
        title: "A panel is missing",
        body: "Open Window, Discover, or reset the workspace preset.",
        bullets: [
          "Search for the panel by name.",
          "Switch to a workspace preset that includes the panel.",
          "Reset preferences only after simpler recovery steps fail.",
        ],
      },
      {
        title: "A document or export looks wrong",
        body: "Use the document-specific tools first, then inspect browser capability.",
        bullets: [
          "Check layer visibility, masks, adjustment layers, and active state.",
          "Use History to compare recent operations.",
          "Run Preflight and Round-Trip Inspector when import/export fidelity matters.",
          "Open Browser Diagnostics if the issue varies by browser.",
        ],
      },
    ],
    reference: [
      {
        title: "Keyboard Shortcuts",
        body: "Use this dialog to search, customize, reset, or inspect shortcut bindings. Browser and OS shortcuts may override app shortcuts.",
      },
      {
        title: "Preferences",
        body: "Preferences control performance, storage, rulers, grids, cursors, tools, previews, and experimental behavior. Reset or adjust them when behavior is unexpectedly different.",
      },
      {
        title: "Diagnostics",
        body: "Diagnostics explain runtime support. Use them when a feature works on one machine or browser but not another.",
      },
      {
        title: "Reports",
        body: "Reports explain file and workflow fidelity. Use them when a recipient needs to understand limitations, warnings, or compatibility decisions.",
      },
    ],
    checklists: [
      {
        title: "Troubleshooting checklist",
        body: "Work through the smallest likely owner first.",
        bullets: [
          "Check active tool and options bar.",
          "Check active layer, mask, selection, and visibility.",
          "Open the missing panel through Window or Discover.",
          "Use History to identify the last operation that changed the result.",
          "Run Preflight for export or compatibility issues.",
          "Open Browser Diagnostics for runtime-specific issues.",
          "Review Keyboard Shortcuts and Preferences for customized behavior.",
        ],
      },
    ],
    figureIds: ["keyboardShortcuts", "preferences"],
  },
]

export function getDocumentationSection(slug: string) {
  return DOCUMENTATION_SECTIONS.find((section) => section.slug === slug)
}

export function DocumentationPage({ section }: { section: DocumentationSection }) {
  const activeIndex = DOCUMENTATION_SECTIONS.findIndex((item) => item.slug === section.slug)
  const previous = activeIndex > 0 ? DOCUMENTATION_SECTIONS[activeIndex - 1] : undefined
  const next = activeIndex < DOCUMENTATION_SECTIONS.length - 1 ? DOCUMENTATION_SECTIONS[activeIndex + 1] : undefined
  const Icon = section.icon
  const figures = section.figureIds.map((id) => FIGURES[id])

  return (
    <main className="min-h-screen bg-[var(--ps-chrome)] text-[var(--ps-text)]">
      <div className="grid min-h-screen grid-cols-[280px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="border-r border-[var(--ps-divider)] bg-[#181818] max-lg:border-b max-lg:border-r-0">
          <div className="sticky top-0 flex max-h-screen flex-col bg-[#181818] max-lg:static max-lg:max-h-none">
            <div className="border-b border-[var(--ps-divider)] px-4 py-4">
              <Link href="/" className="inline-flex items-center gap-2 text-[13px] font-semibold text-white">
                <img
                  src="/photoshop-web-logo.svg"
                  alt="Photoshop web logo"
                  className="h-7 w-7 rounded-sm"
                  draggable={false}
                />
                Documentation
              </Link>
              <p className="mt-2 text-[11px] leading-5 text-[var(--ps-text-dim)]">
                Browser Photoshop guide with feature-specific screenshots, workflows, limits, and handoff notes.
              </p>
            </div>

            <nav aria-label="Documentation sections" className="min-h-0 flex-1 overflow-y-auto p-2 max-lg:flex max-lg:flex-none max-lg:gap-1 max-lg:overflow-x-auto">
              {DOCUMENTATION_SECTIONS.map((item) => {
                const ItemIcon = item.icon
                const active = item.slug === section.slug
                return (
                  <Link
                    key={item.slug}
                    href={`/documentation/${item.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={`mb-1 flex min-h-10 items-center gap-2 rounded-sm px-3 py-2 text-[12px] max-lg:mb-0 max-lg:min-w-max ${
                      active
                        ? "bg-[var(--ps-tool-active)] text-white"
                        : "text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
                    }`}
                  >
                    <ItemIcon className="h-4 w-4 shrink-0" />
                    <span>{item.navLabel}</span>
                  </Link>
                )
              })}
            </nav>

            <div className="grid gap-2 border-t border-[var(--ps-divider)] p-3 max-lg:grid-cols-2">
              <Link
                href="/"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-3 text-[11px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
              >
                <Home className="h-3.5 w-3.5" />
                Home
              </Link>
              <Link
                href="/editor"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-sm bg-[var(--ps-accent)] px-3 text-[11px] text-white hover:bg-[var(--ps-accent-2)]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Open editor
              </Link>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel)] px-6 py-5 max-sm:px-4">
            <div className="mx-auto max-w-[1180px]">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ps-text-dim)]">
                <Link href="/" className="hover:text-[var(--ps-text)]">Home</Link>
                <span>/</span>
                <Link href="/documentation" className="hover:text-[var(--ps-text)]">Documentation</Link>
                <span>/</span>
                <span className="text-[var(--ps-text)]">{section.navLabel}</span>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-accent-2)]">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ps-accent-2)]">{section.eyebrow}</div>
                  <h1 className="mt-1 text-[28px] font-semibold leading-tight text-white max-sm:text-[23px]">{section.title}</h1>
                  <p className="mt-2 max-w-4xl text-[13px] leading-6 text-[var(--ps-text-dim)]">{section.summary}</p>
                </div>
              </div>
            </div>
          </header>

          <div className="mx-auto grid max-w-[1180px] grid-cols-[minmax(0,1fr)_300px] gap-5 px-6 py-6 max-xl:grid-cols-1 max-sm:px-4">
            <div className="min-w-0 space-y-5">
              <DocBlock title="Overview" icon={BookOpen}>
                <div className="space-y-3">
                  {section.overview.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </DocBlock>

              <DocBlock title="Workflows" icon={CheckCircle2}>
                <ReferenceGrid blocks={section.workflows} ordered />
              </DocBlock>

              <DocBlock title="Detailed reference" icon={ImageIcon}>
                <ReferenceGrid blocks={section.reference} />
              </DocBlock>

              <DocBlock title="Checklist" icon={Keyboard}>
                <ReferenceGrid blocks={section.checklists} />
              </DocBlock>

              <DocBlock title="Screenshot reference" icon={ImageIcon}>
                <div className="space-y-4">
                  {figures.map((figure) => (
                    <DocumentationFigureCard key={figure.src} figure={figure} />
                  ))}
                </div>
              </DocBlock>

              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                {previous ? (
                  <Link
                    href={`/documentation/${previous.slug}`}
                    className="flex min-h-16 items-center gap-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-3 text-[12px] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-panel-2)]"
                  >
                    <ArrowLeft className="h-4 w-4 text-[var(--ps-accent-2)]" />
                    <span>
                      <span className="block text-[10px] uppercase tracking-[0.12em] text-[var(--ps-text-dim)]">Previous</span>
                      <span className="font-medium text-white">{previous.navLabel}</span>
                    </span>
                  </Link>
                ) : (
                  <div className="rounded-sm border border-[var(--ps-divider)] bg-[#151515] p-3 text-[11px] text-[var(--ps-text-dim)]">
                    This is the first documentation page.
                  </div>
                )}
                {next ? (
                  <Link
                    href={`/documentation/${next.slug}`}
                    className="flex min-h-16 items-center justify-end gap-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-3 text-right text-[12px] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-panel-2)]"
                  >
                    <span>
                      <span className="block text-[10px] uppercase tracking-[0.12em] text-[var(--ps-text-dim)]">Next</span>
                      <span className="font-medium text-white">{next.navLabel}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-[var(--ps-accent-2)]" />
                  </Link>
                ) : (
                  <div className="rounded-sm border border-[var(--ps-divider)] bg-[#151515] p-3 text-right text-[11px] text-[var(--ps-text-dim)]">
                    This is the final documentation page.
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-4">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">On this page</div>
                <div className="grid gap-1 text-[11px]">
                  {["Overview", "Workflows", "Detailed reference", "Checklist", "Screenshot reference"].map((item) => (
                    <a
                      key={item}
                      href={`#${toAnchor(item)}`}
                      className="rounded-sm px-2 py-1.5 text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
                    >
                      {item}
                    </a>
                  ))}
                </div>
              </div>

              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-4">
                <div className="mb-2 text-[12px] font-semibold text-white">Page coverage</div>
                <dl className="grid gap-2 text-[11px] text-[var(--ps-text-dim)]">
                  <div className="flex items-center justify-between gap-3">
                    <dt>Workflow blocks</dt>
                    <dd className="text-white">{section.workflows.length}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>Reference blocks</dt>
                    <dd className="text-white">{section.reference.length}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>Documented screenshots</dt>
                    <dd className="text-white">{figures.length}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-4">
                <div className="mb-2 text-[12px] font-semibold text-white">Screenshot rule</div>
                <p className="text-[11px] leading-5 text-[var(--ps-text-dim)]">
                  Each screenshot is kept in a constrained frame and paired with text that explains what is visible,
                  when to use the feature, and which details should be checked before relying on the workflow.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  )
}

function DocBlock({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: ComponentType<{ className?: string }>
  children: ReactNode
}) {
  return (
    <section id={toAnchor(title)} className="scroll-mt-4 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[var(--ps-accent-2)]" />
        <h2 className="text-[17px] font-semibold text-white">{title}</h2>
      </div>
      <div className="text-[12px] leading-6 text-[var(--ps-text-dim)]">{children}</div>
    </section>
  )
}

function ReferenceGrid({ blocks, ordered = false }: { blocks: ReferenceBlock[]; ordered?: boolean }) {
  const ListTag = ordered ? "ol" : "div"
  return (
    <ListTag className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
      {blocks.map((block, index) => (
        <ReferenceCard key={block.title} block={block} index={ordered ? index + 1 : undefined} />
      ))}
    </ListTag>
  )
}

function ReferenceCard({ block, index }: { block: ReferenceBlock; index?: number }) {
  const content = (
    <>
      <div className="flex items-start gap-2">
        {index ? (
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[10px] text-[var(--ps-accent-2)]">
            {index}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold leading-5 text-white">{block.title}</h3>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ps-text-dim)]">{block.body}</p>
        </div>
      </div>
      {block.bullets?.length ? (
        <ul className="mt-3 space-y-1.5 text-[11px] leading-5 text-[var(--ps-text-dim)]">
          {block.bullets.map((bullet) => (
            <li key={bullet} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2">
              <CheckCircle2 className="mt-1 h-3 w-3 text-[var(--ps-accent-2)]" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )

  if (index) {
    return <li className="rounded-sm border border-[var(--ps-divider)] bg-[#151515] p-3">{content}</li>
  }

  return <div className="rounded-sm border border-[var(--ps-divider)] bg-[#151515] p-3">{content}</div>
}

function DocumentationFigureCard({ figure }: { figure: DocumentationFigure }) {
  return (
    <figure data-testid="documentation-figure" className="overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[#101010]">
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] gap-0 max-lg:grid-cols-1">
        <div className="flex items-center justify-center border-r border-[var(--ps-divider)] bg-[#080808] p-3 max-lg:border-b max-lg:border-r-0">
          <img
            data-testid="documentation-figure-image"
            src={figure.src}
            alt={figure.alt}
            loading="lazy"
            className={`h-auto w-auto max-w-full object-contain ${figureHeightClass[figure.fit]}`}
          />
        </div>
        <figcaption className="p-4">
          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[var(--ps-accent-2)]">Screenshot</div>
          <h3 className="text-[15px] font-semibold text-white">{figure.title}</h3>
          <p className="mt-2 text-[12px] leading-5 text-[var(--ps-text-dim)]">{figure.caption}</p>
          <FigureList title="This screenshot shows" items={figure.shows} />
          <FigureList title="How to use it" items={figure.usage} />
          <FigureList title="Details to check" items={figure.details} />
        </figcaption>
      </div>
    </figure>
  )
}

function FigureList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <h4 className="text-[11px] font-semibold text-white">{title}</h4>
      <ul className="mt-1.5 space-y-1.5 text-[11px] leading-5 text-[var(--ps-text-dim)]">
        {items.map((item) => (
          <li key={item} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--ps-accent-2)]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const figureHeightClass: Record<FigureFit, string> = {
  wide: "max-h-[360px]",
  dialog: "max-h-[390px]",
  panel: "max-h-[330px]",
  tall: "max-h-[400px]",
}

function toAnchor(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}
