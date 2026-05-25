import { getFilter } from "./filters"

type ParamValue = number | string | boolean

interface FilterBatchOperation {
  filterId: string
  params: Record<string, ParamValue>
}

interface FilterRegistryWorkerRequest {
  id: number
  filterId?: string
  operations?: FilterBatchOperation[]
  width: number
  height: number
  buffer: ArrayBuffer
  params: Record<string, ParamValue>
}

interface FilterRegistryWorkerScope {
  onmessage: ((event: MessageEvent<FilterRegistryWorkerRequest>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

function transferableBuffer(data: Uint8ClampedArray): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data.buffer as ArrayBuffer
  return data.slice().buffer as ArrayBuffer
}

function applyOne(
  filterId: string,
  src: ImageData,
  params: Record<string, ParamValue>,
): ImageData {
  const filter = getFilter(filterId)
  if (!filter) throw new Error(`Worker filter not found: ${filterId}`)
  return filter.apply(src, params)
}

const workerScope = self as unknown as FilterRegistryWorkerScope

workerScope.onmessage = (event: MessageEvent<FilterRegistryWorkerRequest>) => {
  const request = event.data
  try {
    let current = new ImageData(new Uint8ClampedArray(request.buffer), request.width, request.height)
    if (Array.isArray(request.operations)) {
      const total = request.operations.length
      for (let i = 0; i < request.operations.length; i++) {
        const operation = request.operations[i]
        current = applyOne(operation.filterId, current, operation.params ?? {})
        workerScope.postMessage({
          id: request.id,
          width: current.width,
          height: current.height,
          progress: { completed: i + 1, total, filterId: operation.filterId },
        })
      }
    } else if (request.filterId) {
      current = applyOne(request.filterId, current, request.params ?? {})
    } else {
      throw new Error("Worker request did not include a filter id or operation batch")
    }

    const buffer = transferableBuffer(current.data)
    workerScope.postMessage({ id: request.id, width: current.width, height: current.height, buffer }, [buffer])
  } catch (err) {
    workerScope.postMessage({
      id: request.id,
      width: request.width,
      height: request.height,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
