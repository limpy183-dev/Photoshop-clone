"use client"

import * as React from "react"
import Link from "next/link"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP, ScrollTrigger)

const COLUMN_GROUPS = [
  {
    title: "The editor",
    links: [
      { href: "/editor", label: "Open workspace" },
      { href: "#showcase", label: "Workspace tour" },
      { href: "#tools", label: "Tools" },
      { href: "#workflow", label: "Workflow" },
    ],
  },
  {
    title: "Honesty",
    links: [
      { href: "#limits", label: "Browser limits" },
      { href: "#limits", label: "PSD compatibility" },
      { href: "#limits", label: "Color pipeline" },
      { href: "#limits", label: "Export reports" },
    ],
  },
  {
    title: "More",
    links: [
      { href: "#updates", label: "Subscribe" },
      { href: "#updates", label: "Send feedback" },
      { href: "/editor", label: "Keyboard shortcuts" },
      { href: "/editor", label: "Command palette" },
    ],
  },
] as const

export function Footer() {
  const ref = React.useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      gsap.fromTo(
        "[data-foot-mark]",
        { yPercent: 30, autoAlpha: 0 },
        {
          yPercent: 0,
          autoAlpha: 1,
          duration: 1.4,
          ease: "power3.out",
          scrollTrigger: { trigger: ref.current, start: "top 80%" },
        },
      )
      gsap.from("[data-foot-col]", {
        autoAlpha: 0,
        y: 24,
        duration: 0.8,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 80%" },
      })
    },
    { scope: ref },
  )

  return (
    <footer
      ref={ref}
      className="relative overflow-hidden border-t border-[var(--mk-rule)] bg-[var(--mk-ink-2-veil)] backdrop-blur-[2px]"
    >
      <div className="mx-auto max-w-[1480px] px-6 pb-10 pt-24 md:px-10 lg:px-14 lg:pt-32">
        <div className="grid grid-cols-12 gap-x-6 gap-y-16">
          {/* Brand */}
          <div data-foot-col className="col-span-12 lg:col-span-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mk-paper-dim)]">
              Photoshop / Web — Vol. 01
            </span>
            <h2 className="mt-6 font-display text-[2.4rem] leading-[1.05] italic md:text-[3rem]">
              Built in a single tab,
              <br />
              for people who already know
              <br />
              the keyboard shortcuts.
            </h2>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/editor"
                data-cursor="hover"
                className="group inline-flex items-center gap-3 rounded-full bg-[var(--mk-paper)] px-5 py-3 text-[13px] font-medium text-[var(--mk-ink)] transition-transform duration-300 hover:scale-[1.02]"
              >
                Launch editor
                <span aria-hidden="true">→</span>
              </Link>
              <a
                href="#updates"
                data-cursor="hover"
                className="mk-link font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)] hover:text-[var(--mk-paper)]"
              >
                Subscribe
              </a>
            </div>
          </div>

          {/* Columns */}
          {COLUMN_GROUPS.map((column) => (
            <nav
              key={column.title}
              data-foot-col
              aria-label={column.title}
              className="col-span-6 md:col-span-4 lg:col-span-2 lg:col-start-auto"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
                {column.title}
              </span>
              <ul className="mt-5 space-y-3">
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.label}`}>
                    {link.href.startsWith("#") ? (
                      <a
                        href={link.href}
                        data-cursor="hover"
                        className="mk-link text-[14px] text-[var(--mk-paper)] hover:text-[var(--mk-blue-soft)]"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        data-cursor="hover"
                        className="mk-link text-[14px] text-[var(--mk-paper)] hover:text-[var(--mk-blue-soft)]"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {/* Colophon */}
          <div data-foot-col className="col-span-12 lg:col-span-3 lg:col-start-10">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
              Colophon
            </span>
            <p className="mt-5 text-sm leading-relaxed text-[var(--mk-paper-dim)]">
              Set in <span className="font-display italic text-[var(--mk-paper)]">Instrument Serif</span>,
              <span> </span>Bricolage Grotesque, and JetBrains Mono. Built with
              Next.js, React 19, Canvas, workers, and GSAP.
            </p>
            <p className="mt-4 text-xs italic leading-relaxed text-[var(--mk-paper-dim)]">
              Independent project. Not affiliated with, endorsed by, or
              connected to Adobe or Adobe Photoshop.
            </p>
          </div>
        </div>

        {/* Big mark */}
        <div className="mt-24 flex items-end justify-between border-t border-[var(--mk-rule)] pt-10">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
            © {new Date().getFullYear()} Photoshop Web · MIT licensed
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
            v0.1.0 · made for the browser tab
          </span>
        </div>
        <div
          aria-hidden="true"
          data-foot-mark
          className="-mb-6 mt-2 select-none font-display italic text-[var(--mk-paper)]"
          style={{
            fontSize: "clamp(6rem, 22vw, 22rem)",
            lineHeight: 0.85,
            letterSpacing: "-0.04em",
          }}
        >
          Photoshop<span className="text-[var(--mk-blue)]">/</span>Web
        </div>
      </div>
    </footer>
  )
}
