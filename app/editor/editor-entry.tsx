"use client"

import dynamic from "next/dynamic"

const EditorApp = dynamic(() => import("@/components/photoshop/editor-app"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--ps-chrome)] text-[12px] text-[var(--ps-text-dim)]">
      Loading editor
    </div>
  ),
})

export function EditorEntry() {
  return <EditorApp />
}
