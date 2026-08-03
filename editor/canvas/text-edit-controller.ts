/**
 * Type-tool editing session.
 *
 * While a text layer is being edited the DOM textarea is the only rendering of
 * its content: the layer's rasterized glyphs are cleared on entry so the caret
 * doesn't sit on top of a stale raster. Committing writes the typed value back
 * and pushes one history entry; cancelling restores what was there.
 */
import * as React from "react"
import { addPhotoshopEventListener } from "@/editor/events"
import type { ChangedLayerIds } from "@/editor/history-geometry"
import type { Action } from "@/editor/reducer-model"
import type { Layer, PsDocument, TextProps, ToolId } from "@/editor/types"

/** An in-flight type-tool edit. Mirrors the DOM textarea's backing state. */
export interface TextEditState {
  layerId: string
  value: string
  /** Layer was created by this placement gesture — cancelling discards it. */
  isNew: boolean
}

const DEFAULT_TEXT_FONT = "Geist, system-ui, sans-serif"
const DEFAULT_TEXT_SIZE = 48

export interface TextEditControllerOptions {
  activeDoc: PsDocument | null | undefined
  activeLayer: Layer | null | undefined
  tool: ToolId
  foreground: string
  dispatch: React.Dispatch<Action>
  requestRender: () => void
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
}

export interface TextEditController {
  editingText: TextEditState | null
  setEditingText: React.Dispatch<React.SetStateAction<TextEditState | null>>
  /** Live mirror of `editingText`, readable from pointer handlers. */
  editingTextRef: React.RefObject<TextEditState | null>
  /** Text properties a newly placed type layer starts from. */
  activeTextDefaults: () => TextProps
  beginTextEdit: (layer: Layer, isNew: boolean) => void
  commitTextEdit: () => void
  cancelTextEdit: () => void
}

export function useTextEditController({
  activeDoc,
  activeLayer,
  tool,
  foreground,
  dispatch,
  requestRender,
  commit,
}: TextEditControllerOptions): TextEditController {
  const [editingText, setEditingText] = React.useState<TextEditState | null>(null)
  const editingTextRef = React.useRef<TextEditState | null>(null)
  editingTextRef.current = editingText
  // The original content, kept so Escape can restore a layer that was cleared
  // for editing without going through history.
  const editingTextOriginalRef = React.useRef<string>("")

  function activeTextDefaults(): TextProps {
    const source = activeLayer?.kind === "text" ? activeLayer.text : null
    return {
      content: "",
      font: source?.font ?? DEFAULT_TEXT_FONT,
      size: source?.size ?? DEFAULT_TEXT_SIZE,
      weight: source?.weight ?? "bold",
      italic: source?.italic ?? false,
      color: foreground,
      align: source?.align ?? "left",
      x: 0,
      y: 0,
    }
  }

  function beginTextEdit(layer: Layer, isNew: boolean) {
    if (layer.kind !== "text" || !layer.text) return
    editingTextOriginalRef.current = layer.text.content
    if (layer.text.content) {
      dispatch({ type: "set-layer-text", id: layer.id, text: { ...layer.text, content: "" } })
      requestRender()
    }
    setEditingText({ layerId: layer.id, value: editingTextOriginalRef.current, isNew })
  }

  function commitTextEdit() {
    const editing = editingTextRef.current
    if (!editing || !activeDoc) return
    editingTextRef.current = null
    setEditingText(null)
    const layer = activeDoc.layers.find((l) => l.id === editing.layerId)
    if (!layer || layer.kind !== "text" || !layer.text) return
    const value = editing.value
    // An empty box that was never typed into leaves nothing behind.
    if (!value && editing.isNew) {
      dispatch({ type: "remove-layer", id: layer.id })
      requestRender()
      return
    }
    dispatch({ type: "set-layer-text", id: layer.id, text: { ...layer.text, content: value } })
    requestRender()
    if (value !== editingTextOriginalRef.current || editing.isNew) {
      commit(editing.isNew ? (layer.text.vertical ? "Vertical Type" : "Type") : "Edit Text", [layer.id])
    }
  }

  function cancelTextEdit() {
    const editing = editingTextRef.current
    if (!editing || !activeDoc) return
    editingTextRef.current = null
    setEditingText(null)
    const layer = activeDoc.layers.find((l) => l.id === editing.layerId)
    if (!layer || layer.kind !== "text" || !layer.text) return
    if (editing.isNew) {
      dispatch({ type: "remove-layer", id: layer.id })
    } else {
      // Restore the raster that beginTextEdit cleared.
      dispatch({
        type: "set-layer-text",
        id: layer.id,
        text: { ...layer.text, content: editingTextOriginalRef.current },
      })
    }
    requestRender()
  }

  const beginTextEditRef = React.useRef(beginTextEdit)
  const commitTextEditRef = React.useRef(commitTextEdit)
  const activeDocRef = React.useRef(activeDoc)
  beginTextEditRef.current = beginTextEdit
  commitTextEditRef.current = commitTextEdit
  activeDocRef.current = activeDoc

  React.useEffect(() => {
    function handler(e: Event) {
      const id = (e as CustomEvent<{ layerId?: string }>).detail?.layerId
      if (!id) return
      const layer = activeDocRef.current?.layers.find((l) => l.id === id)
      if (!layer || layer.kind !== "text" || !layer.text) return
      beginTextEditRef.current(layer, false)
    }
    return addPhotoshopEventListener("ps-edit-text", (_detail, event) => handler(event))
    // Reads the live document/handler through refs so it never resubscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switching tools or documents mid-edit commits what has been typed rather
  // than stranding an invisible (cleared) text layer.
  React.useEffect(() => {
    if (!editingTextRef.current) return
    commitTextEditRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, activeDoc?.id])

  return {
    editingText,
    setEditingText,
    editingTextRef,
    activeTextDefaults,
    beginTextEdit,
    commitTextEdit,
    cancelTextEdit,
  }
}
