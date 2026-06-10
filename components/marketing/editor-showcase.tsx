"use client"

import * as React from "react"
import Image from "next/image"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

import { withBasePath } from "@/lib/base-path"

gsap.registerPlugin(useGSAP, ScrollTrigger)

type Pin = {
  id: string
  /** Percentage position of the dot on the image. */
  x: number
  y: number
  /** Direction the label flows. */
  side: "left" | "right"
  /** Vertical anchor of the label relative to the dot (in px). */
  vOffset?: number
  index: string
  title: string
  body: string
}

const PINS: Pin[] = [
  {
    id: "brush",
    x: 2.4,
    y: 50.5,
    side: "right",
    index: "01",
    title: "Brush engine",
    body: "Pressure curves, flow, smoothing, hardness — the full painterly toolbox.",
  },
  {
    id: "options",
    x: 32,
    y: 7,
    side: "right",
    index: "02",
    title: "Contextual options",
    body: "Every tool surfaces its own bar. Size 118 px, hardness 1%, smoothing 18 — exactly where they belong.",
  },
  {
    id: "color",
    x: 87,
    y: 30,
    side: "left",
    index: "03",
    title: "Live colour picker",
    body: "True hex, OKLCH-aware ramps, and one-click saturation/value sliders.",
  },
  {
    id: "layers",
    x: 87,
    y: 78,
    side: "left",
    index: "04",
    title: "Layers · Masks · Comps",
    body: "Real raster + adjustment layers, vector masks, blend modes, layer comps, snapshots.",
  },
]

export function EditorShowcase() {
  const sectionRef = React.useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      const pinDots = gsap.utils.toArray<HTMLElement>("[data-pin-dot]")
      const pinLabels = gsap.utils.toArray<HTMLElement>("[data-pin-label]")
      const pinLines = gsap.utils.toArray<HTMLElement>("[data-pin-line]")

      gsap.set(pinDots, { scale: 0, transformOrigin: "center" })
      gsap.set(pinLines, { scaleX: 0, transformOrigin: "left center" })
      gsap.set(pinLabels, { autoAlpha: 0, x: 12 })

      gsap.from("[data-section-eyebrow]", {
        y: 30,
        autoAlpha: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 70%",
        },
      })
      gsap.from("[data-section-title] .mk-reveal > span", {
        yPercent: 110,
        rotate: 3,
        duration: 1,
        ease: "power4.out",
        stagger: 0.07,
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 70%",
        },
      })

      // Image entrance.
      gsap.from("[data-showcase-frame]", {
        y: 80,
        autoAlpha: 0,
        duration: 1.2,
        ease: "power3.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 65%",
        },
      })

      if (reduced) {
        gsap.set(pinDots, { scale: 1 })
        gsap.set(pinLines, { scaleX: 1 })
        gsap.set(pinLabels, { autoAlpha: 1, x: 0 })
        return
      }

      // Reveal pins one-by-one on scroll, scrubbed.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: "[data-showcase-frame]",
          start: "top 60%",
          end: "bottom 55%",
          scrub: 0.6,
        },
      })
      pinDots.forEach((dot, idx) => {
        const line = pinLines[idx]
        const label = pinLabels[idx]
        tl.to(dot, { scale: 1, duration: 0.4, ease: "back.out(2)" }, idx * 0.4)
          .to(line, { scaleX: 1, duration: 0.5, ease: "power2.out" }, idx * 0.4 + 0.15)
          .to(label, { autoAlpha: 1, x: 0, duration: 0.5, ease: "power2.out" }, idx * 0.4 + 0.25)
      })
    },
    { scope: sectionRef },
  )

  return (
    <section
      id="showcase"
      ref={sectionRef}
      className="relative overflow-hidden border-t border-[var(--mk-rule)] bg-[var(--mk-ink-veil)] py-28 md:py-40 backdrop-blur-[2px]"
    >
      <div className="mx-auto grid max-w-[1480px] grid-cols-12 gap-6 px-6 md:px-10 lg:px-14">
        <div className="col-span-12 flex items-center gap-4" data-section-eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mk-rust)]">
            §02 · The editor
          </span>
          <span className="h-px flex-1 bg-[var(--mk-rule)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
            Fig. A — Workspace
          </span>
        </div>

        <h2
          data-section-title
          className="col-span-12 mt-8 font-display text-[2.6rem] leading-[0.98] tracking-[-0.02em] md:text-[5rem] lg:text-[6.5rem]"
        >
          <span className="block">
            <span className="mk-reveal">
              <span>The full</span>
            </span>{" "}
            <span className="mk-reveal">
              <span className="italic text-[var(--mk-blue)]">workspace,</span>
            </span>
          </span>
          <span className="block">
            <span className="mk-reveal">
              <span>honestly</span>
            </span>{" "}
            <span className="mk-reveal">
              <span className="italic">built.</span>
            </span>
          </span>
        </h2>

        <p className="col-span-12 lg:col-span-7 mt-6 text-base leading-relaxed text-[var(--mk-paper-dim)] md:text-lg">
          A central canvas, vertical tool palette, top menu bar, contextual
          options, dockable panels, document tabs, history, actions, layers,
          adjustments, masks, file/export — the workspace you already know,
          re-implemented for the browser.
        </p>
      </div>

      {/* Pinned image with callouts. */}
      <div className="relative mx-auto mt-16 max-w-[1480px] px-6 md:px-10 lg:px-14">
        <figure
          data-showcase-frame
          className="relative overflow-hidden rounded-lg border border-[var(--mk-rule-strong)] bg-[var(--mk-ink-3)] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.7)]"
        >
          {/* Toolbar chrome above image */}
          <div className="flex items-center gap-2 border-b border-[var(--mk-rule)] bg-[var(--mk-ink-2)] px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)]">
              photoshop.web / workspace
            </span>
          </div>

          <div className="relative">
            <Image
              src={withBasePath("/marketing/editor-overview.png")}
              alt="Photoshop Web editor showing the brush tool, color picker, and layers panel."
              width={1920}
              height={1080}
              className="block h-auto w-full"
              sizes="(max-width: 1480px) 100vw, 1480px"
            />

            {PINS.map((pin) => (
              <div
                key={pin.id}
                className="mk-pin"
                style={{
                  left: `${pin.x}%`,
                  top: `${pin.y}%`,
                  transform: "translate(-50%, -50%)",
                  // Allow either side of the dot to host the line/label.
                  flexDirection: pin.side === "right" ? "row" : "row-reverse",
                }}
              >
                <span data-pin-dot className="mk-pin-dot" />
                <span
                  data-pin-line
                  className="mk-pin-line"
                  style={{
                    transform:
                      pin.side === "right" ? undefined : "scaleX(-1)",
                  }}
                />
                <span
                  data-pin-label
                  className="mk-pin-label flex items-center gap-2"
                >
                  <span className="font-mono text-[var(--mk-blue-soft)]">
                    {pin.index}
                  </span>
                  <span className="text-[var(--mk-paper)]">{pin.title}</span>
                </span>
              </div>
            ))}
          </div>
        </figure>

        {/* Pin captions */}
        <ul className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PINS.map((pin) => (
            <li
              key={`${pin.id}-caption`}
              className="border-t border-[var(--mk-rule)] pt-4"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-blue-soft)]">
                {pin.index} — {pin.title}
              </span>
              <p className="mt-3 text-sm leading-relaxed text-[var(--mk-paper-dim)]">
                {pin.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
