"use client"

import * as React from "react"
import { X } from "lucide-react"
import { describeDocumentColorHonesty } from "./color-pipeline"
import { useEditor } from "./editor-context"

export function StatusBar({ onHide }: { onHide?: () => void }) {
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
      <div
        data-testid="status-bar"
        className="h-6 bg-[var(--ps-chrome)] border-t border-[var(--ps-divider)] text-[11px] text-[var(--ps-text-dim)] px-2 flex items-center"
      >
        <span>Ready</span>
        <div className="flex-1" />
        {onHide ? (
          <button
            type="button"
            aria-label="Hide info bar"
            title="Hide info bar"
            onClick={onHide}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div
      data-testid="status-bar"
      className="h-6 bg-[var(--ps-chrome)] border-t border-[var(--ps-divider)] text-[11px] text-[var(--ps-text-dim)] px-2 flex items-center gap-3 overflow-hidden"
    >
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
      {onHide ? (
        <button
          type="button"
          aria-label="Hide info bar"
          title="Hide info bar"
          onClick={onHide}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  )
}
