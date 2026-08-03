"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3">
      <h3 className="mb-3 text-[12px] font-semibold text-[var(--ps-text)]">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export function CapabilityNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2 text-[11px] leading-5 text-[var(--ps-text-dim)]">
      {children}
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return <div className="rounded-sm border border-[var(--ps-divider)] p-6 text-center text-[12px] text-[var(--ps-text-dim)]">{text}</div>
}

export function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="grid grid-cols-[110px_1fr_64px] items-center gap-2 text-[11px]">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <Input type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} className="h-7 px-2 text-[11px]" />
    </label>
  )
}

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="grid grid-cols-[110px_1fr] items-center gap-2 text-[11px]">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 text-[11px]">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid grid-cols-[110px_36px_1fr] items-center gap-2 text-[11px]">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-9 bg-transparent" />
      <Input value={value} onChange={(event) => onChange(event.target.value)} className="h-7 px-2 text-[11px]" />
    </label>
  )
}

export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function FileButton({ accept, label, onFile }: { accept: string; label: string; onFile: (file: File) => void | Promise<void> }) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onFile(file)
          event.currentTarget.value = ""
        }}
      />
      <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>{label}</Button>
    </>
  )
}
