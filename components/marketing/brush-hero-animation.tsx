"use client"

import * as React from "react"

type Star = {
  x: number
  y: number
  size: number
  alpha: number
  decay: number
  vx: number
  vy: number
  rotation: number
  type: 0 | 1 | 2 // dot, star, sparkle
}

export function BrushHeroAnimation() {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const animRef = React.useRef<number>(0)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d", { alpha: true })
    if (!ctx) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    let w = 0
    let h = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    // Path wraps dramatically around the title — sweeps high, dips low,
    // arcs over the headline and back down through it.
    function getPath() {
      return [
        { x: -0.1 * w, y: 0.85 * h },
        { x: 0.08 * w, y: 0.55 * h },
        { x: 0.18 * w, y: 0.15 * h },
        { x: 0.32 * w, y: 0.05 * h },
        { x: 0.5 * w, y: 0.25 * h },
        { x: 0.55 * w, y: 0.7 * h },
        { x: 0.68 * w, y: 0.92 * h },
        { x: 0.78 * w, y: 0.55 * h },
        { x: 0.88 * w, y: 0.12 * h },
        { x: 1.1 * w, y: 0.4 * h },
      ]
    }

    function catmullRom(
      p0: { x: number; y: number },
      p1: { x: number; y: number },
      p2: { x: number; y: number },
      p3: { x: number; y: number },
      t: number,
    ) {
      const t2 = t * t
      const t3 = t2 * t
      return {
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      }
    }

    // Pre-sample the full path into a fixed number of points for smooth drawing
    const TOTAL_SAMPLES = 320
    let sampledPath: { x: number; y: number }[] = []

    function rebuildPath() {
      const pts = getPath()
      const n = pts.length - 1
      sampledPath = []
      for (let i = 0; i < TOTAL_SAMPLES; i++) {
        const progress = i / (TOTAL_SAMPLES - 1)
        const segment = Math.min(Math.floor(progress * n), n - 1)
        const localT = progress * n - segment
        const p0 = pts[Math.max(segment - 1, 0)]
        const p1 = pts[segment]
        const p2 = pts[Math.min(segment + 1, n)]
        const p3 = pts[Math.min(segment + 2, n)]
        sampledPath.push(catmullRom(p0, p1, p2, p3, localT))
      }
    }
    rebuildPath()
    window.addEventListener("resize", rebuildPath)

    // Animation state
    let headIndex = 0 // how far the brush head has drawn (0 to TOTAL_SAMPLES)
    let tailFade = 0 // how far the tail has faded (0 to TOTAL_SAMPLES)
    const DRAW_RATE = 2.4 // samples per frame
    const FADE_RATE = 1.4 // tail fade samples per frame
    const FADE_DELAY = 50 // frames after head starts before tail begins fading
    let frameCount = 0
    const stars: Star[] = []
    const starPool: Star[] = [] // object pool

    function getStar(): Star {
      return starPool.pop() || { x: 0, y: 0, size: 0, alpha: 0, decay: 0, vx: 0, vy: 0, rotation: 0, type: 0 }
    }

    function spawnParticles(x: number, y: number) {
      const count = 1 + (Math.random() > 0.7 ? 1 : 0)
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 0.2 + Math.random() * 0.8
        const s = getStar()
        s.x = x
        s.y = y
        s.size = 1.5 + Math.random() * 2.5
        s.alpha = 0.6 + Math.random() * 0.4
        s.decay = 0.01 + Math.random() * 0.015
        s.vx = Math.cos(angle) * speed
        s.vy = Math.sin(angle) * speed - 0.2
        s.rotation = Math.random() * Math.PI * 2
        s.type = (Math.floor(Math.random() * 3)) as 0 | 1 | 2
        stars.push(s)
      }
    }

    let lastTime = 0

    const loop = (time: number) => {
      const dt = lastTime ? Math.min((time - lastTime) / 16.667, 2.5) : 1
      lastTime = time
      frameCount++

      ctx.clearRect(0, 0, w, h)

      // Advance head
      if (headIndex < TOTAL_SAMPLES) {
        headIndex = Math.min(headIndex + DRAW_RATE * dt, TOTAL_SAMPLES)
      }

      // Advance tail fade after delay
      if (frameCount > FADE_DELAY && tailFade < TOTAL_SAMPLES) {
        tailFade = Math.min(tailFade + FADE_RATE * dt, TOTAL_SAMPLES)

        // Spawn particles at the fading tail position
        const tailIdx = Math.floor(tailFade)
        if (tailIdx < TOTAL_SAMPLES && Math.random() < 0.3) {
          const pt = sampledPath[tailIdx]
          spawnParticles(pt.x, pt.y)
        }
      }

      // Draw the continuous brush stroke as a single Path2D
      const startIdx = Math.floor(tailFade)
      const endIdx = Math.floor(headIndex)

      if (endIdx > startIdx + 1) {
        // Build path once, reuse for all stroke layers
        const path = new Path2D()
        path.moveTo(sampledPath[startIdx].x, sampledPath[startIdx].y)
        for (let i = startIdx + 1; i < endIdx - 1; i++) {
          const curr = sampledPath[i]
          const next = sampledPath[i + 1]
          const mx = (curr.x + next.x) / 2
          const my = (curr.y + next.y) / 2
          path.quadraticCurveTo(curr.x, curr.y, mx, my)
        }
        if (endIdx - 1 > startIdx) {
          const last = sampledPath[endIdx - 1]
          path.lineTo(last.x, last.y)
        }

        ctx.lineCap = "round"
        ctx.lineJoin = "round"

        // Single stroke with shadowBlur creates a clean GPU-accelerated glow
        ctx.shadowColor = "rgba(80, 150, 255, 0.9)"
        ctx.shadowBlur = 20
        ctx.strokeStyle = "rgba(180, 215, 255, 0.95)"
        ctx.lineWidth = 4
        ctx.stroke(path)

        // Second pass with stronger glow for that dreamy bloom
        ctx.shadowBlur = 40
        ctx.strokeStyle = "rgba(140, 190, 255, 0.5)"
        ctx.lineWidth = 2
        ctx.stroke(path)

        // Reset shadow before drawing fade overlay and particles
        ctx.shadowBlur = 0
        ctx.shadowColor = "transparent"

        // Fade the tail end with a gradient overlay to make it dissolve
        if (tailFade > 0 && endIdx - startIdx > 4) {
          const fadeLen = Math.min(25, endIdx - startIdx)
          const fadeStart = sampledPath[startIdx]
          const fadeEnd = sampledPath[Math.min(startIdx + fadeLen, TOTAL_SAMPLES - 1)]
          const grad = ctx.createLinearGradient(fadeStart.x, fadeStart.y, fadeEnd.x, fadeEnd.y)
          grad.addColorStop(0, "rgba(0, 0, 0, 1)")
          grad.addColorStop(0.6, "rgba(0, 0, 0, 0.6)")
          grad.addColorStop(1, "rgba(0, 0, 0, 0)")

          const fadePath = new Path2D()
          fadePath.moveTo(sampledPath[startIdx].x, sampledPath[startIdx].y)
          const fadeMax = Math.min(startIdx + fadeLen, endIdx - 1)
          for (let i = startIdx + 1; i < fadeMax; i++) {
            const curr = sampledPath[i]
            const next = sampledPath[i + 1]
            const mx = (curr.x + next.x) / 2
            const my = (curr.y + next.y) / 2
            fadePath.quadraticCurveTo(curr.x, curr.y, mx, my)
          }

          ctx.save()
          ctx.globalCompositeOperation = "destination-out"
          ctx.strokeStyle = grad
          ctx.lineWidth = 60
          ctx.lineCap = "round"
          ctx.stroke(fadePath)
          ctx.restore()
        }

        // Bright head dot
        if (headIndex < TOTAL_SAMPLES) {
          const headPt = sampledPath[Math.min(endIdx, TOTAL_SAMPLES - 1)]
          ctx.shadowColor = "rgba(150, 200, 255, 1)"
          ctx.shadowBlur = 18
          ctx.beginPath()
          ctx.arc(headPt.x, headPt.y, 5, 0, Math.PI * 2)
          ctx.fillStyle = "rgba(230, 240, 255, 1)"
          ctx.fill()
          ctx.shadowBlur = 0
          ctx.shadowColor = "transparent"
        }
      }

      // Update and draw particles
      let aliveCount = 0
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i]
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.alpha -= s.decay * dt
        s.rotation += 0.03 * dt

        if (s.alpha <= 0) {
          starPool.push(s)
          continue
        }

        stars[aliveCount++] = s
        ctx.globalAlpha = s.alpha

        if (s.type === 0) {
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
          ctx.fillStyle = "rgba(180, 210, 255, 1)"
          ctx.fill()
        } else if (s.type === 1) {
          // 4-point star
          ctx.beginPath()
          for (let j = 0; j < 4; j++) {
            const a = s.rotation + (j * Math.PI) / 2
            ctx.moveTo(s.x, s.y)
            ctx.lineTo(s.x + Math.cos(a) * s.size, s.y + Math.sin(a) * s.size)
          }
          ctx.strokeStyle = "rgba(200, 220, 255, 1)"
          ctx.lineWidth = 0.8
          ctx.stroke()
        } else {
          // Sparkle diamond
          ctx.beginPath()
          for (let j = 0; j < 8; j++) {
            const r = j % 2 === 0 ? s.size : s.size * 0.3
            const a = s.rotation + (j * Math.PI) / 4
            const px = s.x + Math.cos(a) * r
            const py = s.y + Math.sin(a) * r
            if (j === 0) {
              ctx.moveTo(px, py)
            } else {
              ctx.lineTo(px, py)
            }
          }
          ctx.closePath()
          ctx.fillStyle = "rgba(220, 240, 255, 1)"
          ctx.fill()
        }
      }
      stars.length = aliveCount
      ctx.globalAlpha = 1

      // Reset loop
      if (tailFade >= TOTAL_SAMPLES && stars.length === 0) {
        headIndex = 0
        tailFade = 0
        frameCount = 0
        lastTime = 0
      }

      animRef.current = requestAnimationFrame(loop)
    }

    animRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener("resize", resize)
      window.removeEventListener("resize", rebuildPath)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[80vh] w-full"
    />
  )
}
