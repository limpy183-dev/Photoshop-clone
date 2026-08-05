"use client"

/**
 * Provenance tab — Content Credentials: signing, attaching and inspecting them.
 *
 * One tab of the Advanced Subsystems dialog. The dialog itself
 * (`subsystems-dialog.tsx`) only owns the tab list and the switch that picks
 * a workspace; each workspace holds its own state and talks to the editor
 * directly, so opening the dialog does not mount the other ten.
 */

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  CapabilityNotice,
  EmptyState,
  FileButton,
  Panel,
} from "@/components/photoshop/advanced/subsystems-dialog-controls"
import { normalizeCredentialImportPayload } from "@/editor/advanced/subsystems-import-normalizers"
import { useEditor } from "@/components/photoshop/editor/context"
import { downloadText, renderDocumentComposite } from "@/editor/document/io"
import { uid } from "@/editor/uid"
import { ADVANCED_FILE_LIMITS, assertAdvancedFileSize } from "@/editor/advanced/subsystems"
import type { ContentCredential } from "@/editor/types"
function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? new Blob()), "image/png"))
}

async function sha256Hex(data: Blob | string) {
  const buffer = typeof data === "string" ? new TextEncoder().encode(data) : await data.arrayBuffer()
  if (crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", buffer)
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
  }
  let h = 2166136261
  const bytes = new Uint8Array(buffer)
  for (const byte of bytes) h = Math.imul(h ^ byte, 16777619)
  return (h >>> 0).toString(16).padStart(8, "0")
}

async function hashCanvas(canvas: HTMLCanvasElement) {
  return sha256Hex(await canvasBlob(canvas))
}

export function ProvenanceWorkspace() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [actor, setActor] = React.useState("Local user")
  const [assertion, setAssertion] = React.useState("Edited locally in Photoshop Web")
  const [busy, setBusy] = React.useState(false)
  if (!activeDoc) return <EmptyState text="Open a document before generating provenance." />
  const credentials = activeDoc.metadata?.contentCredentials ?? []

  const generate = async () => {
    setBusy(true)
    try {
      const flat = renderDocumentComposite(activeDoc, { transparent: true })
      const ingredients: ContentCredential["ingredients"] = []
      for (const layer of activeDoc.layers) {
        if (layer.kind === "group") continue
        ingredients.push({
          id: layer.id,
          name: layer.name,
          kind: layer.kind,
          visible: layer.visible,
          hash: await hashCanvas(layer.canvas),
        })
      }
      const credential: ContentCredential = {
        id: uid("cred"),
        action: "local-edit",
        actor,
        software: "Photoshop Web",
        createdAt: new Date().toISOString(),
        documentName: activeDoc.name,
        documentHash: await hashCanvas(flat),
        layerCount: ingredients.length,
        dimensions: { width: activeDoc.width, height: activeDoc.height },
        ingredients,
        assertion,
      }
      dispatch({ type: "set-document-metadata", metadata: { ...(activeDoc.metadata ?? {}), contentCredentials: [credential, ...credentials] } })
      window.setTimeout(() => commit("Generate Content Credentials", []), 0)
      toast.success("Local provenance manifest added")
    } finally {
      setBusy(false)
    }
  }

  const exportAll = () => {
    downloadText(JSON.stringify({ app: "Photoshop Web", format: "content-credentials", version: 1, credentials }, null, 2), `${activeDoc.name}-content-credentials.json`, "application/json")
  }
  const importCredentials = async (file: File) => {
    assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.jsonBytes, "Content credentials file")
    const parsed: unknown = JSON.parse(await file.text())
    const imported = normalizeCredentialImportPayload(parsed)
    dispatch({ type: "set-document-metadata", metadata: { ...(activeDoc.metadata ?? {}), contentCredentials: [...imported, ...credentials] } })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel title="Local Content Credentials">
        <CapabilityNotice>
          Local SHA-256 provenance manifests only. Embed Metadata exports write unsigned C2PA carrier payloads, app XMP records, and format metadata, but no certificate chain is created.
        </CapabilityNotice>
        <Input value={actor} onChange={(event) => setActor(event.target.value)} className="h-8" />
        <Input value={assertion} onChange={(event) => setAssertion(event.target.value)} className="h-8" />
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" disabled={busy} onClick={generate}>{busy ? "Hashing..." : "Generate"}</Button>
          <Button size="sm" variant="secondary" disabled={!credentials.length} onClick={exportAll}>Export</Button>
        </div>
        <FileButton accept=".json,application/json" label="Import Credentials" onFile={importCredentials} />
      </Panel>
      <Panel title="Credential Chain">
        <div className="max-h-[520px] overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {credentials.length ? credentials.map((credential) => (
            <div key={credential.id} className="border-b border-[var(--ps-divider)] p-2 text-[11px]">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <span className="font-medium">{credential.assertion}</span>
                <span className="text-[var(--ps-text-dim)]">{new Date(credential.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-[var(--ps-text-dim)]">Actor: {credential.actor} - Layers: {credential.layerCount} - SHA-256: {credential.documentHash.slice(0, 18)}...</div>
            </div>
          )) : <EmptyState text="No local content credentials have been generated." />}
        </div>
      </Panel>
    </div>
  )
}
