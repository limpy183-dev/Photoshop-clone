"use client"

import * as React from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP)

/* ---------------------------------------------------------------------------
 * Particle field
 * ------------------------------------------------------------------------- */

type Particle = {
  id: number
  x: number
  y: number
  size: "sm" | "lg"
  tone: "neutral" | "blue" | "rust"
  driftDuration: number
  driftDistance: number
  delay: number
}

/** Deterministic pseudo-random so SSR + client agree on particle layout. */
function makeRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function buildParticles(count: number): Particle[] {
  const rand = makeRandom(0xc0ffee)
  const particles: Particle[] = []
  for (let i = 0; i < count; i++) {
    const isLg = rand() > 0.74
    const tonePick = rand()
    particles.push({
      id: i,
      x: rand() * 100,
      y: rand() * 100,
      size: isLg ? "lg" : "sm",
      tone: tonePick > 0.86 ? "blue" : tonePick > 0.78 ? "rust" : "neutral",
      driftDuration: 16 + rand() * 22,
      driftDistance: 90 + rand() * 240,
      delay: rand() * 12,
    })
  }
  return particles
}

const PARTICLES = buildParticles(34)

/* ---------------------------------------------------------------------------
 * Brush-stroke SVG paths.
 *
 * We compute getTotalLength() at mount and use strokeDasharray /
 * strokeDashoffset to "draw" then "erase" each path on a long loop.
 * ------------------------------------------------------------------------- */

const BRUSH_PATHS: {
  d: string
  tone: "neutral" | "blue"
  duration: number
  delay: number
}[] = [
  {
    d: "M -50 220 C 200 120, 380 320, 620 220 S 1000 60, 1240 200 S 1700 380, 1980 240",
    tone: "blue",
    duration: 14,
    delay: 0,
  },
  {
    d: "M -40 720 C 240 580, 460 820, 720 700 S 1080 540, 1340 660 S 1700 820, 1980 700",
    tone: "neutral",
    duration: 18,
    delay: 4,
  },
  {
    d: "M -30 1080 C 220 940, 480 1180, 740 1040 S 1100 880, 1360 1000 S 1720 1180, 1980 1060",
    tone: "blue",
    duration: 22,
    delay: 9,
  },
]

/* ---------------------------------------------------------------------------
 * BackgroundFX
 * ------------------------------------------------------------------------- */

export function BackgroundFX() {
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      const cleanups: Array<() => void> = []

      /* ---- 1. Gradient mesh blobs ----------------------------------- */
      const blobs = gsap.utils.toArray<HTMLElement>("[data-blob]")
      blobs.forEach((blob, idx) => {
        const baseX = parseFloat(blob.dataset.x ?? "0")
        const baseY = parseFloat(blob.dataset.y ?? "0")

        if (reduced) {
          gsap.set(blob, { xPercent: baseX, yPercent: baseY, scale: 1 })
          return
        }

        gsap.set(blob, {
          xPercent: baseX,
          yPercent: baseY,
          transformOrigin: "50% 50%",
        })
        gsap.to(blob, {
          xPercent: baseX + (idx % 2 === 0 ? 18 : -22),
          yPercent: baseY + (idx % 2 === 0 ? -14 : 16),
          duration: 18 + idx * 2,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        })
        gsap.to(blob, {
          scale: 1.25,
          duration: 12 + idx * 3,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          delay: idx * 1.5,
        })
        gsap.to(blob, {
          rotation: idx % 2 === 0 ? 60 : -60,
          duration: 60 + idx * 10,
          ease: "none",
          repeat: -1,
        })
      })

      /* ---- 2. Particles (skipped under reduced motion) -------------- */
      if (!reduced) {
        const particles = gsap.utils.toArray<HTMLElement>("[data-particle]")
        particles.forEach((particle) => {
          const distance = parseFloat(particle.dataset.driftDistance ?? "120")
          const duration = parseFloat(particle.dataset.driftDuration ?? "20")
          const delay = parseFloat(particle.dataset.driftDelay ?? "0")

          const tl = gsap.timeline({ repeat: -1, delay })
          tl.fromTo(
            particle,
            { y: 0, x: 0, autoAlpha: 0 },
            {
              autoAlpha: 1,
              duration: duration * 0.15,
              ease: "sine.out",
            },
          )
            .to(
              particle,
              {
                y: -distance,
                x: () => gsap.utils.random(-26, 26),
                duration: duration,
                ease: "none",
              },
              0,
            )
            .to(
              particle,
              {
                autoAlpha: 0,
                duration: duration * 0.2,
                ease: "sine.in",
              },
              `>${-duration * 0.2}`,
            )
        })
      }

      /* ---- 3. Brush stroke draw / erase loop ------------------------ */
      if (!reduced) {
        const paths = gsap.utils.toArray<SVGPathElement>("[data-brush-path]")
        paths.forEach((path) => {
          const length = path.getTotalLength()
          const duration = parseFloat(path.dataset.brushDuration ?? "16")
          const delay = parseFloat(path.dataset.brushDelay ?? "0")
          gsap.set(path, {
            strokeDasharray: length,
            strokeDashoffset: length,
          })
          const tl = gsap.timeline({ repeat: -1, delay })
          tl.to(path, {
            strokeDashoffset: 0,
            duration: duration * 0.55,
            ease: "power2.inOut",
          })
            .to(path, {
              strokeDashoffset: -length,
              duration: duration * 0.45,
              ease: "power2.in",
            })
            .set(path, { strokeDashoffset: length })
        })
      }

      /* ---- 4. Cursor spotlight -------------------------------------- */
      const spotlight = root.querySelector<HTMLElement>("[data-spotlight]")
      if (spotlight && !reduced) {
        gsap.set(spotlight, {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
        const xTo = gsap.quickTo(spotlight, "x", {
          duration: 0.9,
          ease: "power3.out",
        })
        const yTo = gsap.quickTo(spotlight, "y", {
          duration: 0.9,
          ease: "power3.out",
        })
        const onMove = (event: PointerEvent) => {
          xTo(event.clientX)
          yTo(event.clientY)
        }
        window.addEventListener("pointermove", onMove)
        cleanups.push(() => {
          window.removeEventListener("pointermove", onMove)
        })
      } else if (spotlight) {
        gsap.set(spotlight, {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
      }

      /* ---- 5. Slow scanline ----------------------------------------- */
      const scanline = root.querySelector<HTMLElement>("[data-scanline]")
      if (scanline && !reduced) {
        gsap.set(scanline, { y: 0 })
        gsap.to(scanline, {
          y: () => window.innerHeight,
          duration: 18,
          ease: "none",
          repeat: -1,
          delay: 4,
        })
      }

      return () => {
        cleanups.forEach((fn) => fn())
      }
    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef} className="mk-bg-fx" aria-hidden="true">
      {/* 1. Gradient mesh blobs. */}
      <div
        data-blob
        data-tone="blue"
        data-x="-30"
        data-y="-20"
        className="mk-blob"
        style={{ left: "0%", top: "0%" }}
      />
      <div
        data-blob
        data-tone="rust"
        data-x="20"
        data-y="-30"
        className="mk-blob"
        style={{ left: "65%", top: "5%" }}
      />
      <div
        data-blob
        data-tone="violet"
        data-x="-20"
        data-y="20"
        className="mk-blob"
        style={{ left: "10%", top: "55%" }}
      />
      <div
        data-blob
        data-tone="amber"
        data-x="10"
        data-y="-10"
        className="mk-blob"
        style={{ left: "55%", top: "65%" }}
      />

      {/* 2. Brush-stroke SVG paths. */}
      <svg
        className="mk-brush-svg"
        viewBox="0 0 1920 1280"
        preserveAspectRatio="none"
      >
        {BRUSH_PATHS.map((path, idx) => (
          <path
            key={idx}
            d={path.d}
            data-brush-path
            data-tone={path.tone}
            data-brush-duration={path.duration}
            data-brush-delay={path.delay}
            className="mk-brush-path"
          />
        ))}
      </svg>

      {/* 3. Particle field. */}
      {PARTICLES.map((particle) => (
        <span
          key={particle.id}
          data-particle
          data-size={particle.size}
          data-tone={particle.tone === "neutral" ? undefined : particle.tone}
          data-drift-distance={particle.driftDistance}
          data-drift-duration={particle.driftDuration}
          data-drift-delay={particle.delay}
          className="mk-particle"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
          }}
        />
      ))}

      {/* 4. Cursor spotlight. */}
      <div data-spotlight className="mk-spotlight" />

      {/* 5. Slow scanline. */}
      <div data-scanline className="mk-scanline" />
    </div>
  )
}
