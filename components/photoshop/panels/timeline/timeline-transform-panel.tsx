import { IDENTITY_TRANSFORM } from "../../timeline-engine"
import type { FrameLayerTransform, PsDocument, TimelineFrame } from "../../types"
import { TextBtn } from "./timeline-shared"

export function TransformPanel({
  doc,
  frame,
  onUpdateTransform,
  onClose,
}: {
  doc: PsDocument
  frame: TimelineFrame
  onUpdateTransform: (layerId: string, patch: Partial<FrameLayerTransform>) => void
  onClose: () => void
}) {
  const editable = doc.layers.filter((layer) => layer.kind !== "group")
  return (
    <div className="max-h-48 overflow-y-auto border-t border-[var(--ps-divider)] bg-[var(--ps-panel-2)]/40 p-2 text-[10px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] text-[var(--ps-text-dim)]">Transform keyframes — {frame.name}</span>
        <TextBtn onClick={onClose}>Close</TextBtn>
      </div>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="text-left text-[var(--ps-text-dim)]">
            <th className="w-32 pb-1">Layer</th>
            <th className="pb-1">tx</th>
            <th className="pb-1">ty</th>
            <th className="pb-1">sX</th>
            <th className="pb-1">sY</th>
            <th className="pb-1">rot°</th>
            <th className="pb-1 text-right">Reset</th>
          </tr>
        </thead>
        <tbody>
          {editable.map((layer) => {
            const t = frame.layerTransform?.[layer.id] ?? IDENTITY_TRANSFORM
            return (
              <tr key={layer.id} className="border-t border-[var(--ps-divider)]">
                <td className="truncate pr-2" title={layer.name}>{layer.name}</td>
                <td>
                  <TransformInput value={t.tx} onChange={(v) => onUpdateTransform(layer.id, { tx: v })} />
                </td>
                <td>
                  <TransformInput value={t.ty} onChange={(v) => onUpdateTransform(layer.id, { ty: v })} />
                </td>
                <td>
                  <TransformInput value={t.scaleX} step={0.05} onChange={(v) => onUpdateTransform(layer.id, { scaleX: v })} />
                </td>
                <td>
                  <TransformInput value={t.scaleY} step={0.05} onChange={(v) => onUpdateTransform(layer.id, { scaleY: v })} />
                </td>
                <td>
                  <TransformInput value={t.rotation} onChange={(v) => onUpdateTransform(layer.id, { rotation: v })} />
                </td>
                <td className="text-right">
                  <TextBtn onClick={() => onUpdateTransform(layer.id, { tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotation: 0 })}>—</TextBtn>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TransformInput({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      onClick={(e) => e.stopPropagation()}
      className="h-5 w-16 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
    />
  )
}
