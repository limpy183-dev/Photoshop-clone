"use client"

/**
 * Presentational primitives shared by the Properties panel's sections.
 *
 * These carry no editor state — they are layout and styling only, which is why
 * both `properties-panel.tsx` and `properties-tool-section.tsx` can pull from
 * here without either importing the other.
 */

import * as React from "react"

export function Section({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false)
  return (
    <div className="border border-[var(--ps-divider)] rounded-sm">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)] bg-[var(--ps-panel-2)] border-b border-[var(--ps-divider)] flex items-center gap-1.5 hover:text-[var(--ps-text)]"
      >
        <span className={`transition-transform text-[8px] ${collapsed ? "" : "rotate-90"}`}>▶</span>
        {icon}
        {title}
      </button>
      {!collapsed && <div className="p-2 flex flex-col gap-1.5">{children}</div>}
    </div>
  )
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[var(--ps-text-dim)] shrink-0">{label}</span>
      <span className="flex-1 truncate">{children}</span>
    </div>
  )
}

export function LockBtn({ active, label, title, onClick }: { active: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button
      className={`w-5 h-5 text-[8px] rounded-sm flex items-center justify-center ${active ? "bg-[var(--ps-tool-active)] text-[var(--ps-text)]" : "hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text-dim)]"}`}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function QuickBtn({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 px-2 text-[11px] rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)] text-left"
    >
      {label}
    </button>
  )
}

export function QuickToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-sm border px-2 text-left text-[10px] ${
        active
          ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]"
          : "border-[var(--ps-divider)] bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)]"
      }`}
    >
      {label}
    </button>
  )
}

export function EmptyState({ text }: { text: string }) {
  return <div className="flex items-center justify-center h-24 text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}

export function NumberField({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  onCommit: () => void
}) {
  return (
    <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        onBlur={onCommit}
        className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] text-[var(--ps-text)] outline-none"
      />
    </label>
  )
}
