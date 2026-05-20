"use client"

import * as React from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP, ScrollTrigger)

type LimitRow = {
  topic: string
  limit: string
  ourTake: string
}

const ROWS: LimitRow[] = [
  {
    topic: "Color management",
    limit: "Browser canvas resolves through 8-bit RGBA surfaces.",
    ourTake:
      "We model 16/32-bit, ICC, CMYK, Lab, and spot — and warn before we round-trip.",
  },
  {
    topic: "PSD round-trip",
    limit: "Some PSD constructs can't survive a browser export.",
    ourTake:
      "ag-psd handles standard data; app-only state goes to the project format with a compat report.",
  },
  {
    topic: "Advanced formats",
    limit: "TIFF, PSB, PDF, EPS, JPEG 2000, HEIF lean on native libraries.",
    ourTake:
      "We support what JS allows and tell you exactly what would be approximate.",
  },
  {
    topic: "Memory & speed",
    limit: "Very large documents can exceed practical browser RAM.",
    ourTake:
      "Workers, tile-based filters, render caches, and zoom coalescing keep the main thread breathing.",
  },
  {
    topic: "3D · video · print",
    limit: "Browsers can't be Adobe's full 3D / video / print engines.",
    ourTake:
      "We model the workflows where it makes sense and surface preflight warnings everywhere else.",
  },
]

export function Limitations() {
  const sectionRef = React.useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      gsap.from("[data-lim-eyebrow]", {
        autoAlpha: 0,
        y: 24,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 80%" },
      })
      gsap.from("[data-lim-title] .mk-reveal > span", {
        yPercent: 110,
        rotate: 3,
        duration: 1,
        ease: "power4.out",
        stagger: 0.07,
        scrollTrigger: { trigger: sectionRef.current, start: "top 75%" },
      })

      const rows = gsap.utils.toArray<HTMLElement>("[data-lim-row]")
      rows.forEach((row) => {
        const cells = row.querySelectorAll<HTMLElement>("[data-lim-cell]")
        const rule = row.querySelector<HTMLElement>("[data-lim-rule]")

        gsap.from(cells, {
          y: 24,
          autoAlpha: 0,
          duration: 0.8,
          ease: "power3.out",
          stagger: 0.08,
          scrollTrigger: { trigger: row, start: "top 85%" },
        })
        if (rule) {
          gsap.fromTo(
            rule,
            { scaleX: 0, transformOrigin: "left center" },
            {
              scaleX: 1,
              duration: 1,
              ease: "power3.out",
              scrollTrigger: { trigger: row, start: "top 85%" },
            },
          )
        }
      })
    },
    { scope: sectionRef },
  )

  return (
    <section
      id="limits"
      ref={sectionRef}
      className="relative border-t border-[var(--mk-rule)] bg-[var(--mk-ink-3-veil)] py-28 md:py-40 backdrop-blur-[2px]"
    >
      <div className="mx-auto max-w-[1480px] px-6 md:px-10 lg:px-14">
        <div className="flex items-center gap-4" data-lim-eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mk-amber)]">
            §05 · The honest part
          </span>
          <span className="h-px flex-1 bg-[var(--mk-rule)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
            Reports · warnings · receipts
          </span>
        </div>

        <div className="mt-10 grid grid-cols-12 gap-6">
          <h2
            data-lim-title
            className="col-span-12 lg:col-span-9 font-display text-[2.6rem] leading-[0.98] tracking-[-0.02em] md:text-[5rem] lg:text-[6rem]"
          >
            <span className="block">
              <span className="mk-reveal">
                <span>Browsers</span>
              </span>{" "}
              <span className="mk-reveal">
                <span className="italic">can&apos;t do</span>
              </span>{" "}
              <span className="mk-reveal">
                <span className="italic text-[var(--mk-amber)]">everything.</span>
              </span>
            </span>
            <span className="block">
              <span className="mk-reveal">
                <span>We</span>
              </span>{" "}
              <span className="mk-reveal">
                <span className="italic">tell you</span>
              </span>{" "}
              <span className="mk-reveal">
                <span>when.</span>
              </span>
            </span>
          </h2>
          <p className="col-span-12 lg:col-span-7 mt-4 text-base leading-relaxed text-[var(--mk-paper-dim)] md:text-lg">
            Photoshop Web is built for the browser, not in spite of it. Color
            management, PSD round-trip, very large documents, advanced formats —
            we model them, we ship them when they&apos;re honest, and we surface
            warnings, preflight reports, and explicit limitation manifests
            instead of silent lossy conversions.
          </p>
        </div>

        {/* Table */}
        <div className="mt-16 grid grid-cols-12 gap-x-6 border-b border-[var(--mk-rule)] pb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
          <span className="col-span-12 md:col-span-3">Topic</span>
          <span className="col-span-12 md:col-span-5">Browser reality</span>
          <span className="col-span-12 md:col-span-4">How Photoshop Web handles it</span>
        </div>

        <ul>
          {ROWS.map((row, idx) => (
            <li
              key={row.topic}
              data-lim-row
              className="relative grid grid-cols-12 gap-x-6 gap-y-2 py-8"
            >
              <span
                data-lim-cell
                className="col-span-12 md:col-span-3 font-display text-[1.6rem] italic leading-tight md:text-[1.9rem]"
              >
                <span className="font-mono text-[10px] not-italic tracking-[0.22em] text-[var(--mk-blue-soft)]">
                  ({(idx + 1).toString().padStart(2, "0")})
                </span>{" "}
                {row.topic}
              </span>
              <p
                data-lim-cell
                className="col-span-12 md:col-span-5 text-base leading-relaxed text-[var(--mk-paper)]"
              >
                {row.limit}
              </p>
              <p
                data-lim-cell
                className="col-span-12 md:col-span-4 text-sm leading-relaxed text-[var(--mk-paper-dim)]"
              >
                {row.ourTake}
              </p>
              <span
                data-lim-rule
                className="absolute bottom-0 left-0 right-0 h-px origin-left bg-[var(--mk-rule)]"
              />
            </li>
          ))}
        </ul>

        <p className="mt-12 max-w-[60ch] font-display text-[1.4rem] italic leading-snug text-[var(--mk-paper)] md:text-[1.6rem]">
          “If a feature can&apos;t round-trip cleanly, you&apos;ll see a yellow flag, a
          report, and a one-click fix — not a silent destructive convert.”
        </p>
      </div>
    </section>
  )
}
