"use client"

import * as React from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"
import {
  Brush,
  Crop,
  Eraser,
  Hand,
  Lasso,
  MousePointer2,
  PenTool,
  Pipette,
  Sparkles,
  Square,
  Stamp,
  Type as TypeIcon,
  Wand2,
} from "lucide-react"

gsap.registerPlugin(useGSAP, ScrollTrigger)

type Tool = {
  name: string
  shortcut: string
  group: string
  description: string
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}

const TOOLS: Tool[] = [
  {
    name: "Move",
    shortcut: "V",
    group: "Transform",
    description: "Move, transform, snap to guides, and align like a real layer.",
    Icon: MousePointer2,
  },
  {
    name: "Marquee",
    shortcut: "M",
    group: "Selection",
    description: "Rectangular and elliptical marquees with feather and anti-alias.",
    Icon: Square,
  },
  {
    name: "Lasso",
    shortcut: "L",
    group: "Selection",
    description: "Free, polygonal, and magnetic lassos with refine-edge brush.",
    Icon: Lasso,
  },
  {
    name: "Magic Wand",
    shortcut: "W",
    group: "Selection",
    description: "Tolerance-based color pick plus quick selection and select subject.",
    Icon: Wand2,
  },
  {
    name: "Crop",
    shortcut: "C",
    group: "Composition",
    description: "Aspect-locked crop, perspective crop, slice and frame tools.",
    Icon: Crop,
  },
  {
    name: "Eyedropper",
    shortcut: "I",
    group: "Color",
    description: "Sample color, set foreground/background, and pick from any layer.",
    Icon: Pipette,
  },
  {
    name: "Brush",
    shortcut: "B",
    group: "Paint",
    description: "Pressure-aware brush with flow, smoothing, and hardness curves.",
    Icon: Brush,
  },
  {
    name: "Clone",
    shortcut: "S",
    group: "Retouch",
    description: "Clone stamp, pattern stamp, and content-aware healing.",
    Icon: Stamp,
  },
  {
    name: "Eraser",
    shortcut: "E",
    group: "Paint",
    description: "Background, magic, and history eraser with hardness control.",
    Icon: Eraser,
  },
  {
    name: "Pen",
    shortcut: "P",
    group: "Vector",
    description: "Bezier, freeform, curvature pen — convert points, edit paths.",
    Icon: PenTool,
  },
  {
    name: "Type",
    shortcut: "T",
    group: "Type",
    description: "Character, paragraph, OpenType, type-on-path, type masks.",
    Icon: TypeIcon,
  },
  {
    name: "Hand · Zoom",
    shortcut: "H · Z",
    group: "Navigate",
    description: "Coalesced 60fps zoom, pan, rotate-view, and rulers.",
    Icon: Hand,
  },
]

export function ToolsGrid() {
  const sectionRef = React.useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      gsap.from("[data-tools-eyebrow]", {
        autoAlpha: 0,
        y: 24,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 75%" },
      })
      gsap.from("[data-tools-title] .mk-reveal > span", {
        yPercent: 110,
        rotate: 3,
        duration: 1,
        ease: "power4.out",
        stagger: 0.06,
        scrollTrigger: { trigger: sectionRef.current, start: "top 75%" },
      })

      ScrollTrigger.batch("[data-tool-card]", {
        start: "top 85%",
        once: true,
        onEnter: (els) => {
          gsap.from(els, {
            y: 50,
            autoAlpha: 0,
            duration: 0.9,
            ease: "power3.out",
            stagger: { each: 0.06, from: "start" },
            overwrite: true,
          })
        },
      })
    },
    { scope: sectionRef },
  )

  return (
    <section
      id="tools"
      ref={sectionRef}
      className="relative border-t border-[var(--mk-rule)] bg-[var(--mk-ink-2-veil)] py-28 md:py-40 backdrop-blur-[2px]"
    >
      <div className="mx-auto max-w-[1480px] px-6 md:px-10 lg:px-14">
        <div className="flex items-center gap-4" data-tools-eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mk-rust)]">
            §03 · The arsenal
          </span>
          <span className="h-px flex-1 bg-[var(--mk-rule)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
            12 of 200+
          </span>
        </div>

        <div className="mt-10 grid grid-cols-12 gap-6">
          <h2
            data-tools-title
            className="col-span-12 lg:col-span-8 font-display text-[2.6rem] leading-[0.98] tracking-[-0.02em] md:text-[5rem] lg:text-[6rem]"
          >
            <span className="block">
              <span className="mk-reveal">
                <span>The tools</span>
              </span>{" "}
              <span className="mk-reveal">
                <span className="italic">you reach</span>
              </span>
            </span>
            <span className="block">
              <span className="mk-reveal">
                <span>for, in</span>
              </span>{" "}
              <span className="mk-reveal">
                <span className="italic text-[var(--mk-rust)]">muscle memory.</span>
              </span>
            </span>
          </h2>
          <p className="col-span-12 lg:col-span-4 self-end text-base leading-relaxed text-[var(--mk-paper-dim)]">
            Brush, lasso, pen, type, clone, healing, gradient, paint bucket, dodge, burn, sponge — a
            keyboard-shortcut-faithful palette that obeys the same{" "}
            <span className="italic text-[var(--mk-paper)]">B / V / W / T</span> instincts you
            already have.
          </p>
        </div>

        {/* Grid */}
        <ul className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {TOOLS.map((tool, idx) => {
            const numbered = (idx + 1).toString().padStart(2, "0")
            return (
              <li
                key={tool.name}
                data-tool-card
                data-cursor="hover"
                className="mk-tool group relative flex h-full min-h-[230px] flex-col justify-between rounded-md p-6"
              >
                <div className="flex items-start justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
                    {numbered} · {tool.group}
                  </span>
                  <span className="rounded border border-[var(--mk-rule)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mk-paper)]">
                    {tool.shortcut}
                  </span>
                </div>

                <div className="mt-8 flex items-end justify-between">
                  <div>
                    <tool.Icon
                      className="h-10 w-10 text-[var(--mk-paper)] transition-colors duration-300 group-hover:text-[var(--mk-blue)]"
                      strokeWidth={1.4}
                    />
                    <h3 className="mt-6 font-display text-[1.6rem] leading-tight">
                      {tool.name}
                    </h3>
                    <p className="mt-2 max-w-[28ch] text-[13px] leading-relaxed text-[var(--mk-paper-dim)]">
                      {tool.description}
                    </p>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--mk-rule)] pt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--mk-paper-dim)]">
          <span>+ 188 more in the editor</span>
          <span className="flex items-center gap-3">
            <Sparkles className="h-3.5 w-3.5 text-[var(--mk-amber)]" strokeWidth={1.6} />
            Including object selection, refine edge, smart filters, action recorder
          </span>
        </div>
      </div>
    </section>
  )
}
