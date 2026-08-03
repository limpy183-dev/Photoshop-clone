export function drawFramePlaceholder(
  context: CanvasRenderingContext2D,
  frame: {
    shape: "rect" | "ellipse"
    x: number
    y: number
    w: number
    h: number
  },
) {
  context.save()
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  context.fillStyle = "rgba(15, 23, 42, 0.18)"
  context.strokeStyle = "#38bdf8"
  context.lineWidth = 2
  context.setLineDash([8, 5])
  context.beginPath()
  if (frame.shape === "ellipse") {
    context.ellipse(
      frame.x + frame.w / 2,
      frame.y + frame.h / 2,
      frame.w / 2,
      frame.h / 2,
      0,
      0,
      Math.PI * 2,
    )
  } else {
    context.rect(frame.x, frame.y, frame.w, frame.h)
  }
  context.fill()
  context.stroke()
  context.setLineDash([])
  context.strokeStyle = "rgba(255, 255, 255, 0.8)"
  context.beginPath()
  context.moveTo(frame.x, frame.y)
  context.lineTo(frame.x + frame.w, frame.y + frame.h)
  context.moveTo(frame.x + frame.w, frame.y)
  context.lineTo(frame.x, frame.y + frame.h)
  context.stroke()
  context.restore()
}

export function drawArtboardPreview(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  background: string,
) {
  context.save()
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  context.fillStyle = background
  context.fillRect(x, y, width, height)
  context.strokeStyle = "#f8fafc"
  context.lineWidth = 2
  context.strokeRect(x, y, width, height)
  context.strokeStyle = "#0f172a"
  context.lineWidth = 1
  context.strokeRect(
    x + 3,
    y + 3,
    Math.max(0, width - 6),
    Math.max(0, height - 6),
  )
  context.restore()
}

export function drawSlicePreview(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.save()
  context.strokeStyle = "#f97316"
  context.lineWidth = 2
  context.setLineDash([6, 4])
  context.strokeRect(x, y, width, height)
  context.setLineDash([])
  context.fillStyle = "rgba(249, 115, 22, 0.14)"
  context.fillRect(x, y, width, height)
  context.restore()
}
