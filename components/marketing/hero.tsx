"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP, ScrollTrigger)

const HEADLINE_LINES: { words: { text: string; italic?: boolean; tone?: "blue" | "rust" }[] }[] = [
  { words: [{ text: "The" }, { text: "studio" }] },
  { words: [{ text: "goes" }, { text: "browser-", italic: true }] },
  { words: [{ text: "native.", italic: true, tone: "blue" }] },
]

const HERO_STATS = [
  { value: "200+", label: "tools" },
  { value: "30+", label: "adjustment layers" },
  { value: "60", label: "fps canvas" },
]

export function Hero() {
  const sectionRef = React.useRef<HTMLElement | null>(null)
  const previewRef = React.useRef<HTMLDivElement | null>(null)

  useGSAP(
    () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      const prep = gsap.utils.toArray<HTMLSpanElement>("[data-reveal-word]")
      gsap.set(prep, { yPercent: 110, rotate: 4 })
      gsap.set("[data-eyebrow]", { autoAlpha: 0, y: 12 })
      gsap.set("[data-sub]", { autoAlpha: 0, y: 18 })
      gsap.set("[data-cta]", { autoAlpha: 0, y: 18 })
      gsap.set("[data-stat]", { autoAlpha: 0, y: 12 })
      gsap.set("[data-preview-frame]", { autoAlpha: 0, y: 60, scale: 0.96 })
      gsap.set("[data-ticker]", { autoAlpha: 0, y: 12 })

      if (reduced) {
        gsap.set(prep, { yPercent: 0, rotate: 0 })
        gsap.set(
          "[data-eyebrow], [data-sub], [data-cta], [data-stat], [data-ticker], [data-preview-frame]",
          { autoAlpha: 1, y: 0, scale: 1 },
        )
        return
      }

      const tl = gsap.timeline({ delay: 0.2, defaults: { ease: "power4.out" } })
      tl.to("[data-eyebrow]", { autoAlpha: 1, y: 0, duration: 0.6 })
        .to(
          prep,
          {
            yPercent: 0,
            rotate: 0,
            duration: 1.1,
            stagger: 0.06,
          },
          "-=0.3",
        )
        .to(
          "[data-sub]",
          { autoAlpha: 1, y: 0, duration: 0.7 },
          "-=0.6",
        )
        .to(
          "[data-cta]",
          { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.08 },
          "-=0.45",
        )
        .to(
          "[data-stat]",
          { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.07 },
          "-=0.4",
        )
        .to(
          "[data-preview-frame]",
          { autoAlpha: 1, y: 0, scale: 1, duration: 1.1, ease: "power3.out" },
          "-=0.7",
        )
        .to(
          "[data-ticker]",
          { autoAlpha: 1, y: 0, duration: 0.5 },
          "-=0.6",
        )

      // Subtle parallax on the preview frame as the hero scrolls.
      gsap.to(previewRef.current, {
        yPercent: -18,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: 0.8,
        },
      })
    },
    { scope: sectionRef },
  )

  return (
    <section
      ref={sectionRef}
      className="relative isolate overflow-hidden pt-44 pb-24 md:pt-52 md:pb-32 mk-grain"
    >
      {/* Hairline grid background. */}
      <div className="pointer-events-none absolute inset-0 mk-grid-bg opacity-60" aria-hidden="true" />
      {/* Soft blue glow anchored bottom-left. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(26,104,218,0.32) 0%, rgba(26,104,218,0) 70%)",
        }}
      />

      <div className="relative mx-auto grid max-w-[1480px] grid-cols-12 gap-6 px-6 md:px-10 lg:px-14">
        {/* Eyebrow */}
        <div className="col-span-12 flex items-center gap-3" data-eyebrow>
          <span
            className="inline-flex h-2 w-2 rounded-full bg-[var(--mk-blue)]"
            aria-hidden="true"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
            Photoshop / Web · Volume 01 · Browser native
          </span>
        </div>

        {/* Headline grid. */}
        <h1 className="col-span-12 lg:col-span-9 mt-8 font-display text-[14vw] leading-[0.95] tracking-[-0.03em] md:text-[11.5vw] lg:text-[10rem] xl:text-[12rem]">
          {HEADLINE_LINES.map((line, lineIndex) => (
            <span key={lineIndex} className="block">
              {line.words.map((word, wordIndex) => {
                const colorClass =
                  word.tone === "blue"
                    ? "text-[var(--mk-blue)]"
                    : word.tone === "rust"
                      ? "text-[var(--mk-rust)]"
                      : ""
                return (
                  <React.Fragment key={`${lineIndex}-${wordIndex}`}>
                    <span className="mk-reveal">
                      <span
                        data-reveal-word
                        className={[
                          word.italic ? "italic" : "",
                          colorClass,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {word.text}
                      </span>
                    </span>
                    {wordIndex < line.words.length - 1 ? " " : null}
                  </React.Fragment>
                )
              })}
            </span>
          ))}
        </h1>

        {/* Sub & CTAs */}
        <div className="col-span-12 lg:col-span-7 mt-10 lg:mt-12 flex flex-col gap-8">
          <p
            data-sub
            className="max-w-[40ch] text-base leading-relaxed text-[var(--mk-paper-dim)] md:text-lg"
          >
            A layer-honest, panel-rich image editor that runs where you already
            are. <span className="font-display italic text-[var(--mk-paper)]">Canvas, workers, PSD round-trip,</span> and a
            stubborn refusal to lie about what a browser can do.
          </p>

          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Link
              data-cta
              href="/editor"
              data-cursor="hover"
              className="group inline-flex items-center gap-3 rounded-full bg-[var(--mk-paper)] px-6 py-4 text-[15px] font-medium text-[var(--mk-ink)] transition-transform duration-300 hover:scale-[1.02]"
            >
              Open the editor
              <span
                aria-hidden="true"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--mk-ink)] text-[var(--mk-paper)] transition-transform duration-300 group-hover:translate-x-1"
              >
                →
              </span>
            </Link>
            <a
              data-cta
              href="#limits"
              data-cursor="hover"
              className="mk-link font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)] hover:text-[var(--mk-paper)]"
            >
              Read the honest-limits manifesto
            </a>
          </div>

          {/* Stats row */}
          <ul className="mt-2 flex flex-wrap items-end gap-x-10 gap-y-4">
            {HERO_STATS.map((stat) => (
              <li
                key={stat.label}
                data-stat
                className="flex flex-col gap-1"
              >
                <span className="mk-num font-display text-[2.6rem] leading-none text-[var(--mk-paper)]">
                  {stat.value}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--mk-paper-dim)]">
                  {stat.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Floating editor preview corner. */}
        <div
          ref={previewRef}
          data-preview-frame
          className="relative col-span-12 mt-12 lg:col-span-5 lg:mt-0"
        >
          <div className="relative ml-auto max-w-[560px] lg:absolute lg:right-0 lg:top-2">
            <div className="relative overflow-hidden rounded-md border border-[var(--mk-rule-strong)] bg-[var(--mk-ink-3)] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)]">
              <div className="flex items-center gap-1.5 border-b border-[var(--mk-rule)] bg-[var(--mk-ink-2)] px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--mk-paper-dim)]">
                  Untitled-1 @ 78% (RGB/8)
                </span>
              </div>
              <Image
                src="/marketing/editor-overview.png"
                alt="Photoshop Web editor with brush, color picker, and layers panel."
                width={1920}
                height={1080}
                priority
                className="block h-auto w-full"
              />
            </div>
            {/* Caption below the frame */}
            <div className="mt-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)]">
              <span>Fig. A — Brush · Color · Layers</span>
              <span>v0.1.0</span>
            </div>
          </div>
        </div>

        {/* Bottom ticker */}
        <div
          data-ticker
          className="col-span-12 mt-16 flex items-center justify-between border-t border-[var(--mk-rule)] pt-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)] md:mt-24"
        >
          <span>Scroll · Build · Layer · Mask · Export</span>
          <span aria-hidden="true">↓</span>
          <span className="hidden md:inline">est. 2026 — handcrafted in a single tab</span>
        </div>
      </div>
    </section>
  )
}
