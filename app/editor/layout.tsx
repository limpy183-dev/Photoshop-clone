import type { Metadata } from "next"
import { EditorBodyLock } from "@/components/photoshop/editor-body-lock"

export const metadata: Metadata = {
  title: "Photoshop Web — Editor",
  description:
    "The Photoshop Web editor: layers, panels, tools, masks, and PSD round-trip in a browser tab.",
}

export default function EditorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <EditorBodyLock />
      <div className="h-screen w-screen overflow-hidden">{children}</div>
    </>
  )
}
