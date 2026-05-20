import EditorPage from "./editor/page"
import { EditorBodyLock } from "@/components/photoshop/editor-body-lock"

export default function Page() {
  return (
    <>
      <EditorBodyLock />
      <div className="h-screen w-screen overflow-hidden">
        <EditorPage />
      </div>
    </>
  )
}
