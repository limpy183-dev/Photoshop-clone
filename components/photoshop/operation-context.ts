/**
 * Identity and cancellation contract for asynchronous editor work.
 *
 * Every async operation that can outlive the current render should carry this
 * context. Callers validate it immediately before committing a result so a
 * tab switch, edit, close, or newer request cannot mutate the wrong document.
 */
export interface OperationContext {
  readonly docId: string
  readonly startRevision: number
  readonly requestId: string
  readonly historyGeneration: number
  readonly sourceLayerId?: string
  readonly targetLayerId?: string
  readonly signal: AbortSignal
}

export interface OperationContextInput {
  docId: string
  startRevision: number
  historyGeneration?: number
  sourceLayerId?: string
  targetLayerId?: string
  signal?: AbortSignal
  requestId?: string
}

export interface OperationState {
  docId: string
  revision: number
  historyGeneration: number
  closed?: boolean
}

let sequence = 0

function nextRequestId() {
  sequence += 1
  return `op-${Date.now().toString(36)}-${sequence.toString(36)}`
}

export function createOperationContext(input: OperationContextInput): OperationContext {
  const controller = input.signal ? null : new AbortController()
  return {
    docId: input.docId,
    startRevision: input.startRevision,
    requestId: input.requestId ?? nextRequestId(),
    historyGeneration: input.historyGeneration ?? 0,
    sourceLayerId: input.sourceLayerId,
    targetLayerId: input.targetLayerId,
    signal: input.signal ?? controller!.signal,
  }
}

/** True only while the result still belongs to the requested document state. */
export function isOperationCurrent(context: OperationContext, state: OperationState) {
  return (
    !context.signal.aborted &&
    !state.closed &&
    context.docId === state.docId &&
    context.startRevision === state.revision &&
    context.historyGeneration === state.historyGeneration
  )
}

/**
 * Use before applying an async result. AbortError is intentionally preserved
 * as a normal cancellation outcome; stale work must never fall back to a
 * synchronous mutation.
 */
export function assertOperationCurrent(context: OperationContext, state: OperationState) {
  if (!isOperationCurrent(context, state)) {
    throw new DOMException("Operation is stale or cancelled", "AbortError")
  }
}

export function abortOperation(controller: AbortController | undefined) {
  if (controller && !controller.signal.aborted) controller.abort()
}
