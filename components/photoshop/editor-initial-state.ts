import { makeDocumentLifecycle } from "./editor-document-lifecycle"
import { snapshotLayers } from "./editor-history-state"
import { DEFAULT_BRUSH_PRESETS,makeDocument,type EditorState } from "./editor-reducer"

const initialDoc = makeDocument("Untitled-1", 1200, 800, "#ffffff", {
  doc: "doc_initial",
  backgroundLayer: "layer_background",
  layer: "layer_initial",
})

export const initialState: EditorState = {
  documents: [initialDoc],
  activeDocId: initialDoc.id,
  tool: "brush",
  foreground: "#000000",
  background: "#ffffff",
  brush: {
    size: 30,
    hardness: 80,
    opacity: 100,
    flow: 100,
    smoothing: 10,
    spacing: 25,
    tipShape: "round",
    sizeControl: "off",
    angleControl: "off",
    roundnessControl: "off",
    opacityControl: "off",
    flowControl: "off",
    erodibleTip: { sharpness: 70, flatness: 35, erosionRate: 50, softness: 20, aspectRatio: 80, rotation: 0 },
    bristleTip: { length: 65, density: 55, thickness: 35, stiffness: 55, splay: 35, wetness: 25 },
    mixer: { wet: 55, load: 60, mix: 50, flow: 100, sampleAllLayers: false, cleanAfterStroke: false },
    colorReplacement: { sampling: "continuous", limits: "contiguous", mode: "color", tolerance: 32, antiAlias: true },
    artHistory: { style: "tight-medium", area: 24, fidelity: 60 },
  },
  gradient: { type: "linear", reverse: false },
  paintBucket: { tolerance: 32, contiguous: true },
  eraser: {
    sampling: "continuous",
    limits: "find-edges",
    tolerance: 42,
    antiAlias: true,
    protectForeground: false,
  },
  cloneSource: {
    activePresetId: null,
    presets: [],
    aligned: true,
    sample: "current-layer",
    scale: 100,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    showOverlay: false,
  },
  symmetry: { enabled: false, axis: "vertical" },
  brushPresets: DEFAULT_BRUSH_PRESETS,
  clipboard: null,
  styleClipboard: null,
  closedDocuments: [],
  documentLifecycle: {
    [initialDoc.id]: makeDocumentLifecycle(initialDoc, 0),
  },
  activeSmartFilterMaskTarget: null,
  transform: null,
  /** Current selection options for selection tools */
  selectionOptions: {
    mode: "new",
    feather: 0,
    antiAlias: true,
    tolerance: 32,
    contiguous: true,
    sampleAllLayers: false,
    sampleSize: "point",
    autoEnhance: false,
    quickGrowAmount: 3,
    magneticWidth: 12,
    magneticContrast: 24,
    magneticHysteresis: 45,
    magneticSmoothing: 35,
    magneticFrequency: 57,
    magneticPenPressure: false,
  },
  histories: {
    [initialDoc.id]: {
      entries: [
        {
          id: "history_initial",
          label: "New Document",
          layers: snapshotLayers(initialDoc),
          activeLayerId: initialDoc.activeLayerId,
          selectedLayerIds: [...initialDoc.selectedLayerIds],
        },
      ],
      index: 0,
    },
  },
  snapshots: {
    [initialDoc.id]: [],
  },
  actions: [],
  recordingActionId: null,
  isPlayingAction: false,
}

/* ---- localStorage persistence for user settings ---- */
