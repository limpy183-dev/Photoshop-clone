"use client"

import * as React from "react"

import { useEditorSelector } from "./editor-context"

export function useHistoryState(docId?: string | null) {
  const activeDocId = useEditorSelector((editor) => editor.activeDocId)
  const documentHistoryVersions = useEditorSelector((editor) => editor.documentHistoryVersions)
  const history = useEditorSelector((editor) => editor.history)
  const historyIndex = useEditorSelector((editor) => editor.historyIndex)
  const snapshots = useEditorSelector((editor) => editor.snapshots)
  const id = docId ?? activeDocId
  const isActiveDocument = !!id && id === activeDocId

  return React.useMemo(
    () => ({
      docId: id ?? null,
      entries: isActiveDocument ? history : [],
      index: isActiveDocument ? historyIndex : -1,
      snapshots: isActiveDocument ? snapshots : [],
      version: id ? documentHistoryVersions[id] ?? 0 : 0,
    }),
    [documentHistoryVersions, history, historyIndex, id, isActiveDocument, snapshots],
  )
}

export function useHistoryCommands() {
  const jumpHistory = useEditorSelector((editor) => editor.jumpHistory)
  const stepHistoryBy = useEditorSelector((editor) => editor.stepHistoryBy)
  const createHistorySnapshot = useEditorSelector((editor) => editor.createHistorySnapshot)
  const restoreHistorySnapshot = useEditorSelector((editor) => editor.restoreHistorySnapshot)
  const deleteHistorySnapshot = useEditorSelector((editor) => editor.deleteHistorySnapshot)

  return React.useMemo(
    () => ({
      jumpHistory,
      stepHistoryBy,
      createHistorySnapshot,
      restoreHistorySnapshot,
      deleteHistorySnapshot,
    }),
    [
      createHistorySnapshot,
      deleteHistorySnapshot,
      jumpHistory,
      restoreHistorySnapshot,
      stepHistoryBy,
    ],
  )
}
