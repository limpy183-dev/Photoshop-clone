import * as React from "react"

import type { FrameEasing } from "../../types"
import { EASINGS, TextBtn } from "./timeline-shared"

export function TweenDialog({
  totalFrames,
  defaultToIndex,
  onClose,
  onApply,
}: {
  totalFrames: number
  defaultToIndex: number
  onClose: () => void
  onApply: (toIndex: number, opts: { steps: number; easing: FrameEasing; props: Record<string, boolean> }) => void
}) {
  const [toIndex, setToIndex] = React.useState(Math.max(1, defaultToIndex))
  const [steps, setSteps] = React.useState(3)
  const [easing, setEasing] = React.useState<FrameEasing>("linear")
  const [opacity, setOpacity] = React.useState(true)
  const [transform, setTransform] = React.useState(true)
  const [style, setStyle] = React.useState(true)
  const [visibility, setVisibility] = React.useState(true)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-80 rounded-md border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-3 text-[11px] shadow-2xl">
        <div className="mb-2 text-[12px] font-semibold">Insert Tween Frames</div>
        <div className="space-y-2">
          <Row label="Insert before frame">
            <input
              type="number"
              min={1}
              max={totalFrames - 1}
              value={toIndex}
              onChange={(e) => setToIndex(Math.max(1, Math.min(totalFrames - 1, Number(e.target.value) || 1)))}
              className="h-6 w-20 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1"
              aria-label="Insert-before frame index"
            />
          </Row>
          <Row label="Steps">
            <input
              type="number"
              min={1}
              max={60}
              value={steps}
              onChange={(e) => setSteps(Math.max(1, Math.min(60, Number(e.target.value) || 3)))}
              className="h-6 w-20 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1"
              aria-label="Number of tween steps"
            />
          </Row>
          <Row label="Easing">
            <select
              aria-label="Tween easing"
              value={easing}
              onChange={(e) => setEasing(e.target.value as FrameEasing)}
              className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1"
            >
              {EASINGS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </Row>
          <div className="grid grid-cols-2 gap-1">
            <Toggle checked={opacity} onChange={setOpacity}>Opacity</Toggle>
            <Toggle checked={transform} onChange={setTransform}>Transform</Toggle>
            <Toggle checked={style} onChange={setStyle}>Layer style</Toggle>
            <Toggle checked={visibility} onChange={setVisibility}>Visibility</Toggle>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <TextBtn onClick={onClose}>Cancel</TextBtn>
          <TextBtn onClick={() => onApply(toIndex, { steps, easing, props: { opacity, transform, style, visibility } })}>
            Insert
          </TextBtn>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-[var(--ps-text-dim)]">{label}</span>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (next: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1 text-[10px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}
