"use client"

import * as React from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { CompatibilityManifestEntry, ExportFormat } from "./document-io"
import { alternativesForLimitation, type ExportAlternative } from "./export-alternatives"
export function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] rounded-sm px-2 py-1">
      <div className="uppercase text-[9px]">{label}</div>
      <div className="text-[var(--ps-text)] tabular-nums">{value}</div>
    </div>
  )
}

export function ManifestCount({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 py-1">
      <div className="uppercase text-[9px] text-[var(--ps-text-dim)]">{label}</div>
      <div className={`tabular-nums ${className}`}>{value}</div>
    </div>
  )
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--ps-divider)] rounded-sm">
      <div className="px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)] bg-[var(--ps-panel-2)] border-b border-[var(--ps-divider)]">
        {title}
      </div>
      <div className="p-2">{children}</div>
    </div>
  )
}

export function CheckRow({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className={cn("flex items-center gap-2 text-[11px]", disabled && "opacity-45")}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="border-[var(--ps-divider)]"
      />
      {label}
    </label>
  )
}

export function AlternativesRow({
  alternatives,
  onPick,
  testId,
}: {
  alternatives: ExportAlternative[]
  onPick: (format: ExportFormat) => void
  testId?: string
}) {
  if (!alternatives.length) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-testid={testId}>
      <span className="text-[9px] uppercase tracking-wide text-[var(--ps-text-dim)]">Try:</span>
      {alternatives.map((alt) => (
        <button
          key={alt.format}
          type="button"
          title={alt.reason}
          onClick={() => onPick(alt.format as ExportFormat)}
          className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text)] hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-100"
        >
          {alt.label}
        </button>
      ))}
    </div>
  )
}

export function LimitationsBlock({
  summary,
  items,
  currentFormat,
  onPickFormat,
}: {
  summary: string
  items: CompatibilityManifestEntry[]
  currentFormat: ExportFormat
  onPickFormat: (format: ExportFormat) => void
}) {
  return (
    <div
      className="mt-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]"
      data-testid="export-limitations"
    >
      <div className="mb-1 font-medium text-[var(--ps-text)]">{summary}</div>
      <div className="grid gap-1.5">
        {items.map((item) => {
          const alternatives = alternativesForLimitation(currentFormat, item)
          return (
            <div key={`${item.label}-${item.status}`} className="grid grid-cols-[92px_1fr] gap-2">
              <span className="uppercase tracking-wide text-amber-300">{item.status}</span>
              <div>
                <div>{item.label}: {item.detail}</div>
                <AlternativesRow
                  alternatives={alternatives}
                  onPick={onPickFormat}
                  testId={`export-limitation-alt-${item.label.replace(/\s+/g, "-").toLowerCase()}`}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
