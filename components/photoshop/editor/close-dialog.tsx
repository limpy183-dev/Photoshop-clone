"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface EditorCloseDialogProps {
  documentName: string | null
  saving?: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}

export function EditorCloseDialog({
  documentName,
  saving,
  onOpenChange,
  onCancel,
  onDiscard,
  onSave,
}: EditorCloseDialogProps) {
  return (
    <Dialog open={!!documentName} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Save changes to {documentName ?? "document"}?</DialogTitle>
          <DialogDescription className="text-[12px] text-[var(--ps-text-dim)]">
            Closing without saving will discard changes made since the last save in this browser session.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onDiscard} disabled={saving}>
            Don't Save
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
