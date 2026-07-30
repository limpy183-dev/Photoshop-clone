import { describe, expect, it } from "vitest"
import {
  abortOperation,
  assertOperationCurrent,
  createOperationContext,
  isOperationCurrent,
} from "@/components/photoshop/operation-context"

describe("operation context", () => {
  it("keeps async work bound to the document revision and history generation", () => {
    const context = createOperationContext({ docId: "doc-a", startRevision: 4, historyGeneration: 2 })
    expect(isOperationCurrent(context, { docId: "doc-a", revision: 4, historyGeneration: 2 })).toBe(true)
    expect(isOperationCurrent(context, { docId: "doc-b", revision: 4, historyGeneration: 2 })).toBe(false)
    expect(isOperationCurrent(context, { docId: "doc-a", revision: 5, historyGeneration: 2 })).toBe(false)
    expect(isOperationCurrent(context, { docId: "doc-a", revision: 4, historyGeneration: 3 })).toBe(false)
  })

  it("treats close and cancellation as stale", () => {
    const context = createOperationContext({ docId: "doc-a", startRevision: 1 })
    const state = { docId: "doc-a", revision: 1, historyGeneration: 0 }
    expect(isOperationCurrent(context, state)).toBe(true)
    const controller = new AbortController()
    const cancelled = createOperationContext({ docId: "doc-a", startRevision: 1, signal: controller.signal })
    controller.abort()
    expect(isOperationCurrent(cancelled, state)).toBe(false)
    expect(isOperationCurrent(context, { ...state, closed: true })).toBe(false)
  })

  it("throws AbortError instead of allowing stale results through", () => {
    const context = createOperationContext({ docId: "doc-a", startRevision: 1 })
    expect(() => assertOperationCurrent(context, { docId: "doc-a", revision: 2, historyGeneration: 0 })).toThrowErrorMatchingObject({ name: "AbortError" })
  })

  it("aborts an active controller idempotently", () => {
    const controller = new AbortController()
    abortOperation(controller)
    abortOperation(controller)
    expect(controller.signal.aborted).toBe(true)
    expect(() => abortOperation(undefined)).not.toThrow()
  })
})
