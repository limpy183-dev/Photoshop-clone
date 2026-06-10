"use client"

import * as React from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP)

const MARQUEE_ITEMS = [
  "Layer masks",
  "PSD round-trip + reports",
  "Adjustment layers",
  "60fps canvas",
  "Smart filters",
  "Worker-tiled blur",
  "Curves · Levels · Hue",
  "Vector paths",
  "Magic wand · Quick selection",
  "GIF · WebP · AVIF · SVG",
  "Browser-honest limits",
  "Action recorder",
] as const

const SECONDARY_ITEMS = [
  "Brush · Pencil · Eraser",
  "Clone · Heal · Patch",
  "Dodge · Burn · Sponge",
  "Type · Glyphs · Paragraph",
  "Pen · Curvature · Convert",
  "Object selection · Sky select",
  "History · Snapshots · Comps",
  "Command palette · Shortcuts",
] as const

function MarqueeRow({
  items,
  direction = "left",
  speed = 24,
  className = "",
}: {
  items: readonly string[]
  direction?: "left" | "right"
  speed?: number
  className?: string
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null)

  useGSAP(
    () => {
      const track = trackRef.current
      if (!track) return
      // Track holds two copies of the children for a seamless loop.
      const totalWidth = track.scrollWidth / 2
      if (totalWidth <= 0) return
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      if (reduced) return
      const fromX = direction === "left" ? 0 : -totalWidth
      const toX = direction === "left" ? -totalWidth : 0
      gsap.fromTo(
        track,
        { x: fromX },
        {
          x: toX,
          duration: speed,
          ease: "none",
          repeat: -1,
        },
      )
    },
    { scope: trackRef, dependencies: [items, direction, speed] },
  )

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div ref={trackRef} className="mk-marquee">
        {[...items, ...items].map((item, idx) => (
          <span
            key={`${item}-${idx}`}
            className="flex items-center gap-6 px-6 whitespace-nowrap"
          >
            <span aria-hidden="true" className="text-[var(--mk-blue)]">
              ✦
            </span>
            <span>{item}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function Marquee() {
  return (
    <section
      aria-label="Feature highlights"
      className="relative border-y border-[var(--mk-rule)] bg-[var(--mk-ink-2-veil)] py-6 backdrop-blur-sm"
    >
      <MarqueeRow
        items={MARQUEE_ITEMS}
        direction="left"
        speed={32}
        className="font-display text-[2rem] leading-none italic text-[var(--mk-paper)] md:text-[2.6rem]"
      />
      <div className="my-4 h-px w-full bg-[var(--mk-rule)]" />
      <MarqueeRow
        items={SECONDARY_ITEMS}
        direction="right"
        speed={42}
        className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]"
      />
    </section>
  )
}
