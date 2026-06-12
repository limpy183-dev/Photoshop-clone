import {
  getBlurGalleryControlState,
  parseFieldBlurPins,
  parsePathBlurPoints,
  percentToCanvasPoint,
  type BlurGalleryFilterId,
  type BlurGalleryParams,
} from "./blur-gallery-controls"
import {
  getLightingEffectsControlState,
  parseLightingEffectsLights,
  type LightingEffectsParams,
} from "./lighting-effects-controls"

export interface FilterOverlayDocument {
  id: string
  width: number
  height: number
}

export interface BlurGalleryOverlayState {
  docId?: string
  filterId: BlurGalleryFilterId
  params: BlurGalleryParams
}

export interface LightingEffectsOverlayState {
  docId?: string
  params: LightingEffectsParams
}

export function drawBlurGalleryOverlayCanvas(
  overlayCanvas: HTMLCanvasElement | null,
  document: FilterOverlayDocument | null | undefined,
  visualZoom: number,
  state: BlurGalleryOverlayState | null | undefined,
) {
  if (!overlayCanvas || !document) return
  const context = overlayCanvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
  if (!state || state.docId !== document.id) return

  const controlState = getBlurGalleryControlState(state.params)
  const zoom = Math.max(0.5, visualZoom)
  const accent = "#38bdf8"
  const selectedAccent = "#fbbf24"

  context.save()
  context.lineWidth = Math.max(1, 1.5 / zoom)
  context.strokeStyle = accent
  context.fillStyle = accent
  context.shadowColor = "rgba(0,0,0,0.45)"
  context.shadowBlur = 2 / zoom

  if (state.filterId === "field-blur") {
    const pins = parseFieldBlurPins(String(state.params.pins ?? ""))
    for (let index = 0; index < pins.length; index++) {
      const pin = pins[index]
      const selected = controlState.selectedFieldPinIndexes.includes(index)
      const center = percentToCanvasPoint(pin, document.width, document.height)
      const handle = { x: center.x + pin.blur, y: center.y }
      context.save()
      context.fillStyle = selected ? "rgba(251,191,36,0.08)" : "rgba(56,189,248,0.06)"
      context.beginPath()
      context.arc(center.x, center.y, Math.max(3 / zoom, pin.blur), 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = selected ? selectedAccent : "rgba(125,211,252,0.86)"
      context.lineWidth = selected ? Math.max(1.5, 2.25 / zoom) : Math.max(1, 1.25 / zoom)
      context.setLineDash([5 / zoom, 4 / zoom])
      context.beginPath()
      context.arc(center.x, center.y, Math.max(3, pin.blur), 0, Math.PI * 2)
      context.stroke()
      context.setLineDash([])
      context.strokeStyle = selected ? selectedAccent : accent
      context.beginPath()
      context.moveTo(center.x, center.y)
      context.lineTo(handle.x, handle.y)
      context.stroke()
      context.restore()
      drawRoundHandle(context, center.x, center.y, 5, zoom, selected ? selectedAccent : accent, selected)
      drawRoundHandle(context, handle.x, handle.y, 4, zoom, "#ffffff", selected)
      if (selected) drawOverlayLabel(context, `${pin.blur}px`, handle.x + 8 / zoom, handle.y - 8 / zoom, zoom)
    }
  } else if (state.filterId === "iris-blur") {
    const center = percentToCanvasPoint({
      x: numOverlay(state.params.centerX, 50),
      y: numOverlay(state.params.centerY, 50),
    }, document.width, document.height)
    const rotation = numOverlay(state.params.rotation, 0)
    const radians = rotation * Math.PI / 180
    const axisX = { x: Math.cos(radians), y: Math.sin(radians) }
    const axisY = { x: -Math.sin(radians), y: Math.cos(radians) }
    const rx = document.width * numOverlay(state.params.ellipseWidth, numOverlay(state.params.radius, 42)) / 100 * 0.5
    const ry = document.height * numOverlay(state.params.ellipseHeight, numOverlay(state.params.radius, 42)) / 100 * 0.5
    const feather = 1 + numOverlay(state.params.feather, 30) / 100
    const widthHandle = { x: center.x + axisX.x * rx, y: center.y + axisX.y * rx }
    const heightHandle = { x: center.x + axisY.x * ry, y: center.y + axisY.y * ry }
    const featherHandle = { x: center.x + axisX.x * rx * feather, y: center.y + axisX.y * rx * feather }
    const rotationHandle = { x: center.x + axisX.x * (rx + 18 / zoom), y: center.y + axisX.y * (rx + 18 / zoom) }
    context.fillStyle = "rgba(56,189,248,0.07)"
    context.beginPath()
    context.ellipse(center.x, center.y, Math.max(1, rx * feather), Math.max(1, ry * feather), radians, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = "rgba(16,185,129,0.11)"
    context.beginPath()
    context.ellipse(center.x, center.y, Math.max(1, rx), Math.max(1, ry), radians, 0, Math.PI * 2)
    context.fill()
    context.setLineDash([])
    context.strokeStyle = "#22c55e"
    context.beginPath()
    context.ellipse(center.x, center.y, Math.max(1, rx), Math.max(1, ry), radians, 0, Math.PI * 2)
    context.stroke()
    context.strokeStyle = accent
    context.setLineDash([5 / zoom, 4 / zoom])
    context.beginPath()
    context.ellipse(center.x, center.y, Math.max(1, rx * feather), Math.max(1, ry * feather), radians, 0, Math.PI * 2)
    context.stroke()
    context.setLineDash([])
    context.strokeStyle = selectedAccent
    context.beginPath()
    context.moveTo(center.x, center.y)
    context.lineTo(rotationHandle.x, rotationHandle.y)
    context.stroke()
    drawRoundHandle(context, center.x, center.y, 5, zoom, controlState.activeControl === "iris-center" ? selectedAccent : accent, controlState.activeControl === "iris-center")
    drawRoundHandle(context, widthHandle.x, widthHandle.y, 4, zoom, "#ffffff", controlState.activeControl === "iris-width" || controlState.activeControl === "iris-radius")
    drawRoundHandle(context, heightHandle.x, heightHandle.y, 4, zoom, "#ffffff", controlState.activeControl === "iris-height")
    drawRoundHandle(context, featherHandle.x, featherHandle.y, 4, zoom, "#ffffff", controlState.activeControl === "iris-feather")
    drawRoundHandle(context, rotationHandle.x, rotationHandle.y, 4, zoom, "#ffffff", controlState.activeControl === "iris-rotation")
    drawOverlayLabel(context, "focus", center.x - axisX.x * rx - axisY.x * ry - 8 / zoom, center.y - axisX.y * rx - axisY.y * ry - 8 / zoom, zoom)
    drawOverlayLabel(context, "feather", featherHandle.x + 8 / zoom, featherHandle.y, zoom)
  } else if (state.filterId === "tilt-shift") {
    const center = percentToCanvasPoint({
      x: numOverlay(state.params.centerX, 50),
      y: numOverlay(state.params.centerY, 50),
    }, document.width, document.height)
    const angle = numOverlay(state.params.angle, 0) * Math.PI / 180
    const tangent = { x: Math.cos(angle), y: Math.sin(angle) }
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) }
    const length = Math.hypot(document.width, document.height)
    const radius = Math.min(document.width, document.height) * numOverlay(state.params.radius, 30) / 100 * 0.5
    const feather = radius + Math.min(document.width, document.height) * numOverlay(state.params.feather, 30) / 100
    drawTiltBand(context, center, tangent, normal, 0, radius * 2, length, "rgba(34,197,94,0.1)")
    drawTiltBand(context, center, tangent, normal, (radius + feather) * 0.5, Math.max(1, feather - radius), length, "rgba(56,189,248,0.08)")
    drawTiltBand(context, center, tangent, normal, -(radius + feather) * 0.5, Math.max(1, feather - radius), length, "rgba(56,189,248,0.08)")
    drawTiltLine(context, center, tangent, normal, radius, length, false, zoom)
    drawTiltLine(context, center, tangent, normal, -radius, length, false, zoom)
    drawTiltLine(context, center, tangent, normal, feather, length, true, zoom)
    drawTiltLine(context, center, tangent, normal, -feather, length, true, zoom)
    const angleHandle = {
      x: center.x + tangent.x * Math.min(document.width, document.height) * 0.24,
      y: center.y + tangent.y * Math.min(document.width, document.height) * 0.24,
    }
    context.strokeStyle = selectedAccent
    context.beginPath()
    context.moveTo(center.x, center.y)
    context.lineTo(angleHandle.x, angleHandle.y)
    context.stroke()
    drawRoundHandle(context, center.x, center.y, 5, zoom, controlState.activeControl === "tilt-center" ? selectedAccent : accent, controlState.activeControl === "tilt-center")
    drawRoundHandle(context, angleHandle.x, angleHandle.y, 4, zoom, "#ffffff", controlState.activeControl === "tilt-angle")
    drawOverlayLabel(context, "sharp", center.x + normal.x * radius + 6 / zoom, center.y + normal.y * radius - 6 / zoom, zoom)
    drawOverlayLabel(context, "fade", center.x + normal.x * feather + 6 / zoom, center.y + normal.y * feather - 6 / zoom, zoom)
  } else if (state.filterId === "path-blur") {
    const points = parsePathBlurPoints(String(state.params.path ?? ""))
    const canvasPoints = points.map((point) => percentToCanvasPoint(point, document.width, document.height))
    if (canvasPoints.length > 0) {
      context.save()
      context.strokeStyle = "rgba(56,189,248,0.18)"
      context.lineWidth = Math.max(8 / zoom, 2)
      context.lineCap = "round"
      context.lineJoin = "round"
      context.beginPath()
      context.moveTo(canvasPoints[0].x, canvasPoints[0].y)
      for (let index = 1; index < canvasPoints.length; index++) context.lineTo(canvasPoints[index].x, canvasPoints[index].y)
      context.stroke()
      context.restore()
      context.strokeStyle = accent
      context.lineCap = "round"
      context.lineJoin = "round"
      context.beginPath()
      context.moveTo(canvasPoints[0].x, canvasPoints[0].y)
      for (let index = 1; index < canvasPoints.length; index++) context.lineTo(canvasPoints[index].x, canvasPoints[index].y)
      context.stroke()
      for (let index = 1; index < canvasPoints.length; index++) {
        drawPathArrow(context, canvasPoints[index - 1], canvasPoints[index], zoom)
      }
      for (let index = 0; index < canvasPoints.length; index++) {
        const point = canvasPoints[index]
        const selected = controlState.selectedPathPointIndexes.includes(index)
        drawRoundHandle(context, point.x, point.y, 5, zoom, selected ? selectedAccent : accent, selected)
      }
    }
  } else if (state.filterId === "spin-blur") {
    const center = percentToCanvasPoint({
      x: numOverlay(state.params.centerX, 50),
      y: numOverlay(state.params.centerY, 50),
    }, document.width, document.height)
    const radius = Math.min(document.width, document.height) * numOverlay(state.params.radius, 55) / 100 * 0.5
    context.fillStyle = "rgba(56,189,248,0.08)"
    context.beginPath()
    context.arc(center.x, center.y, Math.max(1, radius), 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = accent
    context.beginPath()
    context.arc(center.x, center.y, Math.max(1, radius), 0, Math.PI * 2)
    context.stroke()
    context.setLineDash([5 / zoom, 4 / zoom])
    context.beginPath()
    context.arc(center.x, center.y, Math.max(1, radius * 1.18), 0, Math.PI * 2)
    context.stroke()
    context.setLineDash([])
    drawSpinSpokes(context, center, Math.max(1, radius), zoom)
    const amount = numOverlay(state.params.amount, 28)
    const amountHandle = {
      x: center.x,
      y: center.y - radius * Math.max(0.2, amount / 50),
    }
    context.strokeStyle = selectedAccent
    context.beginPath()
    context.moveTo(center.x, center.y)
    context.lineTo(amountHandle.x, amountHandle.y)
    context.stroke()
    drawRoundHandle(context, center.x, center.y, 5, zoom, controlState.activeControl === "spin-center" ? selectedAccent : accent, controlState.activeControl === "spin-center")
    drawRoundHandle(context, center.x + radius, center.y, 4, zoom, "#ffffff", controlState.activeControl === "spin-radius")
    drawRoundHandle(context, amountHandle.x, amountHandle.y, 4, zoom, "#ffffff", controlState.activeControl === "spin-amount")
    drawOverlayLabel(context, "radius", center.x + radius + 8 / zoom, center.y - 8 / zoom, zoom)
    drawOverlayLabel(context, `${Math.round(amount)}deg`, amountHandle.x + 8 / zoom, amountHandle.y, zoom)
  }

  context.restore()
}

export function drawLightingEffectsOverlayCanvas(
  overlayCanvas: HTMLCanvasElement | null,
  document: FilterOverlayDocument | null | undefined,
  visualZoom: number,
  state: LightingEffectsOverlayState | null | undefined,
) {
  if (!overlayCanvas || !document) return
  const context = overlayCanvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
  if (!state || state.docId !== document.id) return

  const lights = parseLightingEffectsLights(String(state.params.lights ?? ""))
  const controlState = getLightingEffectsControlState(state.params)
  const zoom = Math.max(0.5, visualZoom)
  const minDim = Math.max(1, Math.min(document.width, document.height))
  const accent = "#fbbf24"
  const secondary = "#38bdf8"

  context.save()
  context.lineWidth = Math.max(1, 1.5 / zoom)
  context.shadowColor = "rgba(0,0,0,0.45)"
  context.shadowBlur = 2 / zoom
  for (let index = 0; index < lights.length; index++) {
    const light = lights[index]
    const selected = controlState.selectedLightIndex === index
    const center = { x: light.x * document.width, y: light.y * document.height }
    const radius = Math.max(1, light.radius * minDim)
    const focusRadius = radius * 0.5 * light.focus
    const amountHandle = { x: center.x, y: center.y - radius * Math.max(0.2, light.intensity * 0.5) }
    const focusHandle = { x: center.x + focusRadius, y: center.y }
    const radiusHandle = { x: center.x + radius, y: center.y }

    context.save()
    context.fillStyle = selected ? "rgba(251,191,36,0.08)" : "rgba(56,189,248,0.06)"
    context.strokeStyle = selected ? accent : secondary
    context.setLineDash([5 / zoom, 4 / zoom])
    context.beginPath()
    context.arc(center.x, center.y, radius, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    context.setLineDash([])
    if (light.type === "spot") {
      context.strokeStyle = "rgba(248,250,252,0.46)"
      context.beginPath()
      context.arc(center.x, center.y, Math.max(1, focusRadius), 0, Math.PI * 2)
      context.stroke()
    }
    context.strokeStyle = "rgba(248,250,252,0.58)"
    context.beginPath()
    context.moveTo(center.x, center.y)
    context.lineTo(amountHandle.x, amountHandle.y)
    context.moveTo(center.x, center.y)
    context.lineTo(radiusHandle.x, radiusHandle.y)
    context.stroke()
    context.restore()

    drawRoundHandle(context, center.x, center.y, 5, zoom, selected ? accent : secondary, selected)
    drawRoundHandle(context, radiusHandle.x, radiusHandle.y, 4, zoom, "#ffffff", controlState.activeControl === `light-radius:${index}`)
    drawRoundHandle(context, focusHandle.x, focusHandle.y, 4, zoom, "#ffffff", controlState.activeControl === `light-focus:${index}`)
    drawRoundHandle(context, amountHandle.x, amountHandle.y, 4, zoom, "#ffffff", controlState.activeControl === `light-intensity:${index}`)
    drawOverlayLabel(context, `${light.type} ${Math.round(light.intensity * 100)}%`, center.x + 8 / zoom, center.y - 10 / zoom, zoom)
  }
  context.restore()
}

function drawRoundHandle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  zoom: number,
  fill = "#38bdf8",
  selected = false,
) {
  context.save()
  if (selected) {
    context.fillStyle = "rgba(251,191,36,0.22)"
    context.beginPath()
    context.arc(x, y, (radius + 5) / zoom, 0, Math.PI * 2)
    context.fill()
  }
  context.fillStyle = fill
  context.strokeStyle = "#0f172a"
  context.lineWidth = Math.max(1, 1 / zoom)
  context.beginPath()
  context.arc(x, y, radius / zoom, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  if (selected) {
    context.strokeStyle = "#fbbf24"
    context.lineWidth = Math.max(1, 1.5 / zoom)
    context.beginPath()
    context.arc(x, y, (radius + 2) / zoom, 0, Math.PI * 2)
    context.stroke()
  }
  context.restore()
}

function drawOverlayLabel(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  zoom: number,
) {
  const fontSize = Math.max(10, 11 / zoom)
  context.save()
  context.shadowBlur = 0
  context.font = `${fontSize}px sans-serif`
  const metrics = context.measureText(label)
  const padX = 4 / zoom
  const padY = 3 / zoom
  context.fillStyle = "rgba(15,23,42,0.82)"
  context.strokeStyle = "rgba(255,255,255,0.28)"
  context.lineWidth = Math.max(1, 1 / zoom)
  context.beginPath()
  context.roundRect(x - padX, y - fontSize + padY, metrics.width + padX * 2, fontSize + padY * 2, 3 / zoom)
  context.fill()
  context.stroke()
  context.fillStyle = "#f8fafc"
  context.fillText(label, x, y)
  context.restore()
}

function drawTiltBand(
  context: CanvasRenderingContext2D,
  center: { x: number; y: number },
  tangent: { x: number; y: number },
  normal: { x: number; y: number },
  offset: number,
  width: number,
  length: number,
  color: string,
) {
  context.save()
  context.strokeStyle = color
  context.lineWidth = Math.max(1, width)
  context.beginPath()
  const x = center.x + normal.x * offset
  const y = center.y + normal.y * offset
  context.moveTo(x - tangent.x * length, y - tangent.y * length)
  context.lineTo(x + tangent.x * length, y + tangent.y * length)
  context.stroke()
  context.restore()
}

function drawTiltLine(
  context: CanvasRenderingContext2D,
  center: { x: number; y: number },
  tangent: { x: number; y: number },
  normal: { x: number; y: number },
  offset: number,
  length: number,
  dashed: boolean,
  zoom: number,
) {
  context.save()
  context.strokeStyle = dashed ? "rgba(125,211,252,0.92)" : "#22c55e"
  context.lineWidth = dashed ? Math.max(1, 1.25 / zoom) : Math.max(1.25, 1.75 / zoom)
  context.setLineDash(dashed ? [5 / zoom, 5 / zoom] : [])
  const x = center.x + normal.x * offset
  const y = center.y + normal.y * offset
  context.beginPath()
  context.moveTo(x - tangent.x * length, y - tangent.y * length)
  context.lineTo(x + tangent.x * length, y + tangent.y * length)
  context.stroke()
  context.restore()
}

function drawPathArrow(
  context: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  zoom: number,
) {
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  const length = Math.hypot(deltaX, deltaY)
  if (length < 1) return
  const unitX = deltaX / length
  const unitY = deltaY / length
  const mid = { x: from.x + deltaX * 0.55, y: from.y + deltaY * 0.55 }
  const size = 7 / zoom
  context.save()
  context.fillStyle = "#f8fafc"
  context.strokeStyle = "#0f172a"
  context.lineWidth = Math.max(1, 1 / zoom)
  context.beginPath()
  context.moveTo(mid.x + unitX * size, mid.y + unitY * size)
  context.lineTo(mid.x - unitX * size * 0.65 - unitY * size * 0.55, mid.y - unitY * size * 0.65 + unitX * size * 0.55)
  context.lineTo(mid.x - unitX * size * 0.65 + unitY * size * 0.55, mid.y - unitY * size * 0.65 - unitX * size * 0.55)
  context.closePath()
  context.fill()
  context.stroke()
  context.restore()
}

function drawSpinSpokes(
  context: CanvasRenderingContext2D,
  center: { x: number; y: number },
  radius: number,
  zoom: number,
) {
  context.save()
  context.strokeStyle = "rgba(248,250,252,0.52)"
  context.lineWidth = Math.max(1, 1 / zoom)
  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * Math.PI * 2
    const inner = radius * 0.18
    const outer = radius * 0.92
    context.beginPath()
    context.moveTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner)
    context.lineTo(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer)
    context.stroke()
  }
  context.restore()
}

function numOverlay(value: BlurGalleryParams[string], fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
