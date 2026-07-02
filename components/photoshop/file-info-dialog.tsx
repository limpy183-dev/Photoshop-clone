"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEditorSelector } from "./editor-context"
import type { ColorManagementSettings, DocumentMetadata, PrintSettings } from "./types"
import {
  revealSourceInBrowser,
  sourceInfoForDocument,
  sourceInfoForSmartObject,
  type SourceLocationInfo,
} from "./source-location"
import { toast } from "sonner"

const PROFILE_OPTIONS: ColorManagementSettings["assignedProfile"][] = [
  "sRGB IEC61966-2.1",
  "Display P3",
  "Adobe RGB (1998)",
  "ProPhoto RGB",
  "Working CMYK",
  "Dot Gain 20%",
  "Gray Gamma 2.2",
]

const WORKING_SPACES: ColorManagementSettings["workingSpace"][] = [
  "sRGB IEC61966-2.1",
  "Display P3",
  "Adobe RGB (1998)",
  "ProPhoto RGB",
  "Working CMYK",
]

const PROOF_PROFILES: ColorManagementSettings["proofProfile"][] = [
  "None",
  "Working CMYK",
  "U.S. Web Coated SWOP v2",
  "Japan Color 2001 Coated",
  "Display P3",
  "Dot Gain 20%",
]

function defaultMetadata(name: string): DocumentMetadata {
  return {
    title: name,
    author: "",
    description: "",
    copyright: "",
    keywords: [],
    credit: "",
    source: "",
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  }
}

function defaultColorManagement(): ColorManagementSettings {
  return {
    assignedProfile: "sRGB IEC61966-2.1",
    workingSpace: "sRGB IEC61966-2.1",
    renderingIntent: "relative-colorimetric",
    blackPointCompensation: true,
    proofProfile: "None",
    proofColors: false,
    gamutWarning: false,
  }
}

function defaultPrintSettings(): PrintSettings {
  return {
    paperSize: "Letter",
    orientation: "portrait",
    scale: 100,
    bleedMm: 0,
    cropMarks: false,
    registrationMarks: false,
    colorHandling: "app",
    proofPrint: false,
  }
}

export function FileInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
  const documentStatuses = useEditorSelector((editor) => editor.documentStatuses)
  const [tab, setTab] = React.useState<"summary" | "metadata" | "color" | "print">("summary")
  const [metadata, setMetadata] = React.useState<DocumentMetadata>(defaultMetadata("Untitled"))
  const [keywords, setKeywords] = React.useState("")
  const [color, setColor] = React.useState<ColorManagementSettings>(defaultColorManagement())
  const [print, setPrint] = React.useState<PrintSettings>(defaultPrintSettings())

  React.useEffect(() => {
    if (!open || !activeDoc) return
    const nextMetadata = { ...defaultMetadata(activeDoc.name), ...(activeDoc.metadata ?? {}) }
    setTab("summary")
    setMetadata(nextMetadata)
    setKeywords((nextMetadata.keywords ?? []).join(", "))
    setColor({ ...defaultColorManagement(), ...(activeDoc.colorManagement ?? {}) })
    setPrint({ ...defaultPrintSettings(), ...(activeDoc.printSettings ?? {}) })
  }, [activeDoc, open])

  const documentSourceInfo = activeDoc ? sourceInfoForDocument(activeDoc, documentStatuses[activeDoc.id]) : null
  const smartObjectSourceInfos = activeDoc
    ? activeDoc.layers
      .filter((layer) => layer.smartObject || layer.kind === "smart-object")
      .map((layer) => sourceInfoForSmartObject(layer))
    : []

  const revealSource = async (info: SourceLocationInfo) => {
    if (!info.fileHandle) {
      toast.info(info.unavailableReason ?? "No browser file handle is attached to this source.")
      return
    }
    const result = await revealSourceInBrowser(info.fileHandle)
    if (result.status === "cancelled") return
    if (result.status === "folder-picker-verified" || result.status === "folder-picker-opened") {
      toast.success(result.message)
      return
    }
    if (result.status === "file-accessible") {
      toast.info(result.message)
      return
    }
    toast.error(result.message)
  }

  if (!activeDoc) return null

  const layerCount = activeDoc.layers.length
  const totalPixels = activeDoc.width * activeDoc.height
  const estimatedBytes = totalPixels * 4 * layerCount
  const formatBytes = (b: number) =>
    b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`

  const rows: [string, string][] = [
    ["Document Name", activeDoc.name],
    ["Width", `${activeDoc.width} px`],
    ["Height", `${activeDoc.height} px`],
    ["Resolution", `${activeDoc.dpi ?? 72} PPI`],
    ["Color Mode", activeDoc.colorMode ?? "RGB"],
    ["Profile", color.assignedProfile],
    ["Bit Depth", `${activeDoc.bitDepth ?? 8} bits/channel`],
    ["Layers", `${layerCount}`],
    ["Total Pixels", totalPixels.toLocaleString()],
    ["Est. Uncompressed", formatBytes(estimatedBytes)],
    ["Guides", `${activeDoc.guides?.length ?? 0}`],
    ["Channels", `${activeDoc.channels?.length ?? 0}`],
  ]

  const apply = () => {
    dispatch({
      type: "set-document-metadata",
      metadata: {
        ...metadata,
        keywords: keywords
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 32),
      },
    })
    dispatch({ type: "set-color-management", settings: color })
    dispatch({ type: "set-print-settings", settings: print })
    window.setTimeout(() => commit("Update File Info", []), 0)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>File Info</DialogTitle>
          <DialogDescription className="sr-only">Document metadata, color management, and print settings.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[150px_1fr] gap-4 text-[11px]">
          <div className="space-y-1">
            {([
              ["summary", "Summary"],
              ["metadata", "Metadata"],
              ["color", "Color Management"],
              ["print", "Print & Prepress"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`h-8 w-full rounded-sm border border-[var(--ps-divider)] px-2 text-left hover:bg-[var(--ps-tool-hover)] ${
                  tab === id ? "bg-[var(--ps-tool-active)] text-white" : "bg-[var(--ps-panel-2)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {tab === "summary" ? (
              <div className="space-y-3">
                <div className="space-y-0.5">
                  {rows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[160px_1fr] gap-2 border-b border-[var(--ps-divider)] py-1">
                      <span className="text-[var(--ps-text-dim)]">{label}</span>
                      <span className="font-medium tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
                {documentSourceInfo ? (
                  <SourceLocationPanel info={documentSourceInfo} onReveal={() => void revealSource(documentSourceInfo)} />
                ) : null}
                {smartObjectSourceInfos.length ? (
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold uppercase text-[var(--ps-text-dim)]">Smart Object Sources</div>
                    {smartObjectSourceInfos.map((info, index) => (
                      <SourceLocationPanel key={`${info.primaryName}-${index}`} info={info} onReveal={() => void revealSource(info)} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {tab === "metadata" ? (
              <div className="grid gap-3">
                <Field label="Title"><TextInput ariaLabel="Metadata title" value={metadata.title ?? ""} onChange={(v) => setMetadata({ ...metadata, title: v })} /></Field>
                <Field label="Author"><TextInput ariaLabel="Metadata author" value={metadata.author ?? ""} onChange={(v) => setMetadata({ ...metadata, author: v })} /></Field>
                <Field label="Copyright"><TextInput ariaLabel="Metadata copyright" value={metadata.copyright ?? ""} onChange={(v) => setMetadata({ ...metadata, copyright: v })} /></Field>
                <Field label="Credit"><TextInput ariaLabel="Metadata credit" value={metadata.credit ?? ""} onChange={(v) => setMetadata({ ...metadata, credit: v })} /></Field>
                <Field label="Source"><TextInput ariaLabel="Metadata source" value={metadata.source ?? ""} onChange={(v) => setMetadata({ ...metadata, source: v })} /></Field>
                <Field label="Keywords"><TextInput ariaLabel="Metadata keywords" value={keywords} onChange={setKeywords} /></Field>
                <Field label="Description">
                  <textarea
                    aria-label="Metadata description"
                    value={metadata.description ?? ""}
                    onChange={(event) => setMetadata({ ...metadata, description: event.target.value })}
                    className="min-h-20 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 outline-none focus:border-[var(--ps-accent)]"
                  />
                </Field>
              </div>
            ) : null}
            {tab === "color" ? (
              <div className="grid gap-3">
                <Field label="Assigned Profile"><SelectInput ariaLabel="Assigned color profile" value={color.assignedProfile} options={PROFILE_OPTIONS} onChange={(v) => setColor({ ...color, assignedProfile: v as ColorManagementSettings["assignedProfile"] })} /></Field>
                <Field label="Working Space"><SelectInput ariaLabel="Working color space" value={color.workingSpace} options={WORKING_SPACES} onChange={(v) => setColor({ ...color, workingSpace: v as ColorManagementSettings["workingSpace"] })} /></Field>
                <Field label="Rendering Intent">
                  <SelectInput
                    ariaLabel="Rendering intent"
                    value={color.renderingIntent}
                    options={["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"]}
                    onChange={(v) => setColor({ ...color, renderingIntent: v as ColorManagementSettings["renderingIntent"] })}
                  />
                </Field>
                <Field label="Proof Profile"><SelectInput ariaLabel="Proof profile" value={color.proofProfile} options={PROOF_PROFILES} onChange={(v) => setColor({ ...color, proofProfile: v as ColorManagementSettings["proofProfile"] })} /></Field>
                <CheckInput label="Black point compensation" checked={color.blackPointCompensation} onChange={(v) => setColor({ ...color, blackPointCompensation: v })} />
                <CheckInput label="Proof colors" checked={color.proofColors} onChange={(v) => setColor({ ...color, proofColors: v })} />
                <CheckInput label="Gamut warning" checked={color.gamutWarning} onChange={(v) => setColor({ ...color, gamutWarning: v })} />
              </div>
            ) : null}
            {tab === "print" ? (
              <div className="grid gap-3">
                <Field label="Paper Size"><SelectInput ariaLabel="Paper size" value={print.paperSize} options={["Letter", "A4", "A3", "Tabloid", "Custom"]} onChange={(v) => setPrint({ ...print, paperSize: v as PrintSettings["paperSize"] })} /></Field>
                <Field label="Orientation"><SelectInput ariaLabel="Print orientation" value={print.orientation} options={["portrait", "landscape"]} onChange={(v) => setPrint({ ...print, orientation: v as PrintSettings["orientation"] })} /></Field>
                <Field label="Scale %"><NumberInput ariaLabel="Print scale" value={print.scale} min={10} max={400} onChange={(v) => setPrint({ ...print, scale: v })} /></Field>
                <Field label="Bleed mm"><NumberInput ariaLabel="Bleed millimeters" value={print.bleedMm} min={0} max={50} onChange={(v) => setPrint({ ...print, bleedMm: v })} /></Field>
                <Field label="Color Handling"><SelectInput ariaLabel="Print color handling" value={print.colorHandling} options={["app", "printer"]} onChange={(v) => setPrint({ ...print, colorHandling: v as PrintSettings["colorHandling"] })} /></Field>
                <CheckInput label="Crop marks" checked={print.cropMarks} onChange={(v) => setPrint({ ...print, cropMarks: v })} />
                <CheckInput label="Registration marks" checked={print.registrationMarks} onChange={(v) => setPrint({ ...print, registrationMarks: v })} />
                <CheckInput label="Proof print" checked={print.proofPrint} onChange={(v) => setPrint({ ...print, proofPrint: v })} />
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={apply}>Save File Info</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SourceLocationPanel({ info, onReveal }: { info: SourceLocationInfo; onReveal: () => void }) {
  return (
    <section className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold">{info.title}</div>
          <div className="truncate text-[10px] text-[var(--ps-text-dim)]">{info.primaryName}</div>
        </div>
        <Button variant="outline" size="sm" onClick={onReveal} disabled={!info.canReveal}>
          Reveal Source...
        </Button>
      </div>
      <div className="space-y-0.5">
        {info.rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[130px_1fr] gap-2 border-t border-[var(--ps-divider)] py-1">
            <span className="text-[var(--ps-text-dim)]">{label}</span>
            <span className="min-w-0 truncate font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[140px_1fr] items-start gap-2">
      <span className="pt-1.5 text-[var(--ps-text-dim)]">{label}</span>
      {children}
    </label>
  )
}

function TextInput({ ariaLabel, value, onChange }: { ariaLabel: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none focus:border-[var(--ps-accent)]"
    />
  )
}

function NumberInput({ ariaLabel, value, min, max, onChange }: { ariaLabel: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <input
      aria-label={ariaLabel}
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))}
      className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none focus:border-[var(--ps-accent)]"
    />
  )
}

function SelectInput({ ariaLabel, value, options, onChange }: { ariaLabel: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none focus:border-[var(--ps-accent)]"
    >
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  )
}

function CheckInput({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-[var(--ps-accent)]" />
      <span>{label}</span>
    </label>
  )
}
