"use client"

import * as React from "react"
import Image from "next/image"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

import { withBasePath } from "@/lib/base-path"

gsap.registerPlugin(useGSAP, ScrollTrigger)

const WORKFLOW_STEPS = [
  {
    n: "01",
    title: "Stack",
    body: "Raster, adjustment, type, smart-object, and group layers — with masks, clipping, and 30+ blend modes.",
  },
  {
    n: "02",
    title: "Adjust",
    body: "Curves, Levels, Hue/Saturation, Color Balance, B&W, Photo Filter, Selective Color, Shadows/Highlights — non-destructive.",
  },
  {
    n: "03",
    title: "Mask",
    body: "Per-layer masks, vector masks, quick mask, select-and-mask refine edge, save/load selection.",
  },
  {
    n: "04",
    title: "Export",
    body: "PNG, JPEG, WebP, AVIF, GIF, SVG — plus PSD round-trip via ag-psd with honest compatibility reports.",
  },
] as const

export function WorkflowSplit() {
  const sectionRef = React.useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      gsap.from("[data-wf-eyebrow]", {
        autoAlpha: 0,
        y: 20,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 80%" },
      })
      gsap.from("[data-wf-title] .mk-reveal > span", {
        yPercent: 110,
        rotate: 3,
        duration: 1,
        ease: "power4.out",
        stagger: 0.07,
        scrollTrigger: { trigger: sectionRef.current, start: "top 75%" },
      })
      gsap.from("[data-wf-image]", {
        y: 80,
        autoAlpha: 0,
        scale: 0.96,
        duration: 1.1,
        ease: "power3.out",
        stagger: 0.15,
        scrollTrigger: { trigger: sectionRef.current, start: "top 65%" },
      })
      gsap.from("[data-wf-step]", {
        y: 30,
        autoAlpha: 0,
        duration: 0.8,
        ease: "power3.out",
        stagger: 0.1,
        scrollTrigger: { trigger: "[data-wf-steps]", start: "top 80%" },
      })

      // Subtle parallax on each image as the section scrolls.
      gsap.utils.toArray<HTMLElement>("[data-wf-image]").forEach((el, idx) => {
        gsap.to(el, {
          yPercent: idx % 2 === 0 ? -8 : -14,
          ease: "none",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.6,
          },
        })
      })
    },
    { scope: sectionRef },
  )

  return (
    <section
      id="workflow"
      ref={sectionRef}
      className="relative border-t border-[var(--mk-rule)] bg-[var(--mk-ink-veil)] py-28 md:py-40 backdrop-blur-[2px]"
    >
      <div className="mx-auto max-w-[1480px] px-6 md:px-10 lg:px-14">
        <div className="flex items-center gap-4" data-wf-eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mk-rust)]">
            §04 · The workflow
          </span>
          <span className="h-px flex-1 bg-[var(--mk-rule)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
            Stack → Adjust → Mask → Export
          </span>
        </div>

        <div className="mt-10 grid grid-cols-12 gap-6">
          <h2
            data-wf-title
            className="col-span-12 lg:col-span-9 font-display text-[2.6rem] leading-[0.98] tracking-[-0.02em] md:text-[5rem] lg:text-[6rem]"
          >
            <span className="block">
              <span className="mk-reveal">
                <span>Real layers.</span>
              </span>{" "}
              <span className="mk-reveal">
                <span className="italic">Real masks.</span>
              </span>
            </span>
            <span className="block">
              <span className="mk-reveal">
                <span>Real</span>
              </span>{" "}
              <span className="mk-reveal">
                <span className="italic text-[var(--mk-blue)]">non-destructive</span>
              </span>{" "}
              <span className="mk-reveal">
                <span>edits.</span>
              </span>
            </span>
          </h2>
        </div>

        {/* Two screenshots side by side */}
        <div className="mt-20 grid grid-cols-12 gap-6">
          <figure
            data-wf-image
            className="col-span-12 lg:col-span-7"
          >
            <div className="relative overflow-hidden rounded-md border border-[var(--mk-rule-strong)] bg-[var(--mk-ink-3)] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)]">
              <div className="flex items-center gap-2 border-b border-[var(--mk-rule)] bg-[var(--mk-ink-2)] px-4 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)]">
                  layers · history · channels · paths
                </span>
              </div>
              <Image
                src={withBasePath("/marketing/editor-layers.png")}
                alt="Layers panel showing blend mode, opacity, fill, lock controls and a selected layer."
                width={1920}
                height={1080}
                className="block h-auto w-full"
              />
            </div>
            <figcaption className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)]">
              Fig. B — Layers · 30+ blend modes · masks · clipping
            </figcaption>
          </figure>

          <figure data-wf-image className="col-span-12 lg:col-span-5 lg:mt-24">
            <div className="relative overflow-hidden rounded-md border border-[var(--mk-rule-strong)] bg-[var(--mk-ink-3)] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)]">
              <div className="flex items-center gap-2 border-b border-[var(--mk-rule)] bg-[var(--mk-ink-2)] px-4 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)]">
                  image · adjustments · auto · canvas size
                </span>
              </div>
              <Image
                src={withBasePath("/marketing/editor-image-menu.png")}
                alt="Image menu open showing Mode, Adjustments, Auto submenu, Image Size, Canvas Size."
                width={1920}
                height={1080}
                className="block h-auto w-full"
              />
            </div>
            <figcaption className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)]">
              Fig. C — Image menu · auto-tone · resize · rotate
            </figcaption>
          </figure>
        </div>

        {/* Steps */}
        <ol
          data-wf-steps
          className="mt-24 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4"
        >
          {WORKFLOW_STEPS.map((step) => (
            <li
              key={step.n}
              data-wf-step
              className="border-t border-[var(--mk-rule)] pt-6"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-blue-soft)]">
                Step {step.n}
              </span>
              <h3 className="mt-3 font-display text-[2.4rem] leading-tight italic">
                {step.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--mk-paper-dim)]">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
