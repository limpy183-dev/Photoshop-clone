"use client"

import * as React from "react"
import { describeDocumentColorHonesty } from "./color-pipeline"
import { useEditor } from "./editor-context"

export function StatusBar() {
  const { activeDoc, dispatch, tool, brush, foreground } = useEditor()
  const [zoomInput, setZoomInput] = React.useState("")
  const colorHonesty = React.useMemo(
    () => activeDoc ? describeDocumentColorHonesty(activeDoc) : null,
    [activeDoc],
  )

  React.useEffect(() => {
    setZoomInput(`${Math.round((activeDoc?.zoom ?? 1) * 100)}%`)
  }, [activeDoc?.zoom])

  if (!activeDoc) {
    return (
      <div className="h-6 bg-[var(--ps-chrome)] border-t border-[var(--ps-divider)] text-[11px] text-[var(--ps-text-dim)] px-2 flex items-center">
        Ready
      </div>
    )
  }

  return (
    <div className="h-6 bg-[var(--ps-chrome)] border-t border-[var(--ps-divider)] text-[11px] text-[var(--ps-text-dim)] px-2 flex items-center gap-3 overflow-hidden">
      <input
        value={zoomInput}
        onChange={(e) => setZoomInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const num = parseFloat(zoomInput.replace("%", ""))
            if (!Number.isNaN(num)) {
              dispatch({ type: "set-zoom", zoom: num / 100 })
            }
          }
        }}
        onBlur={() => setZoomInput(`${Math.round(activeDoc.zoom * 100)}%`)}
        className="w-14 h-4 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px] tabular-nums text-[var(--ps-text)]"
      />
      <span>
        Doc: {(((activeDoc.width * activeDoc.height * 4) / 1024 / 1024) | 0)}.0M /{" "}
        {((activeDoc.width * activeDoc.height * 4 * activeDoc.layers.length) / 1024 / 1024).toFixed(
          1,
        )}
        M
      </span>
      <span>|</span>
      <span>
        {activeDoc.width} x {activeDoc.height}px
      </span>
      <span>|</span>
      <span>
        {activeDoc.colorMode} / {activeDoc.bitDepth} bit
      </span>
      {colorHonesty?.hasWarnings ? (
        <>
          <span>|</span>
          <span
            className="max-w-[320px] truncate text-amber-300"
            title={colorHonesty.items.map((item) => `${item.label}: ${item.detail}`).join("\n")}
          >
            {colorHonesty.badge}
          </span>
        </>
      ) : null}
      <span>|</span>
      <span>{activeDoc.layers.length} layers</span>

      <div className="flex-1" />

      <span className="capitalize">{tool}</span>
      <span>|</span>
      <span>Brush {brush.size}px</span>
      <span>|</span>
      <span className="flex items-center gap-1">
        FG
        <span
          className="inline-block w-3 h-3 border border-[var(--ps-text-dim)]"
          style={{ background: foreground }}
        />
      </span>
    </div>
  )
}
