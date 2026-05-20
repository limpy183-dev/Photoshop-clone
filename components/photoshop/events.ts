export type PhotoshopEventMap = {
  "ps-open-command-palette": undefined
  "ps-open-export-as": unknown | undefined
  "ps-open-panel": string
  "ps-request-zoom": { zoom?: number; factor?: number }
  "ps-set-dock-width": number
}

type PhotoshopEventName = keyof PhotoshopEventMap
type DetailOptionalEventName = {
  [K in PhotoshopEventName]: undefined extends PhotoshopEventMap[K] ? K : never
}[PhotoshopEventName]

const fallbackEventTarget = new EventTarget()

function photoshopEventTarget(): EventTarget {
  return typeof window !== "undefined" ? window : fallbackEventTarget
}

export function dispatchPhotoshopEvent<K extends DetailOptionalEventName>(type: K): boolean
export function dispatchPhotoshopEvent<K extends PhotoshopEventName>(type: K, detail: PhotoshopEventMap[K]): boolean
export function dispatchPhotoshopEvent<K extends PhotoshopEventName>(type: K, detail?: PhotoshopEventMap[K]) {
  return photoshopEventTarget().dispatchEvent(new CustomEvent(type, { detail }))
}

export function addPhotoshopEventListener<K extends PhotoshopEventName>(
  type: K,
  handler: (detail: PhotoshopEventMap[K], event: CustomEvent<PhotoshopEventMap[K]>) => void,
) {
  const target = photoshopEventTarget()
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<PhotoshopEventMap[K]>
    handler(customEvent.detail, customEvent)
  }
  target.addEventListener(type, listener)
  return () => target.removeEventListener(type, listener)
}
