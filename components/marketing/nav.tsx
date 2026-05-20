"use client"

import * as React from "react"
import Link from "next/link"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP)

const NAV_LINKS = [
  { href: "#showcase", label: "Showcase" },
  { href: "#tools", label: "Tools" },
  { href: "#workflow", label: "Workflow" },
  { href: "#limits", label: "Honest Limits" },
  { href: "#updates", label: "Updates" },
] as const

export function Nav() {
  const navRef = React.useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      gsap.from('[data-nav-item="true"]', {
        y: -16,
        autoAlpha: 0,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.06,
        delay: 0.15,
      })
    },
    { scope: navRef },
  )

  return (
    <header
      ref={navRef}
      className="fixed top-0 left-0 right-0 z-40 px-6 md:px-10 lg:px-14"
    >
      <nav className="mx-auto mt-5 flex max-w-[1480px] items-center justify-between rounded-full border border-[var(--mk-rule)] bg-[rgba(11,9,7,0.55)] px-5 py-3 backdrop-blur-md">
        <Link
          href="/"
          data-nav-item="true"
          className="flex items-center gap-2 text-[var(--mk-paper)]"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mk-blue)] font-display text-xl italic leading-none"
          >
            P
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)]">
            Photoshop / Web
          </span>
        </Link>

        <ul className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href} data-nav-item="true">
              <a
                href={link.href}
                className="mk-link font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--mk-paper-dim)] hover:text-[var(--mk-paper)]"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div data-nav-item="true" className="flex items-center gap-3">
          <Link
            href="/editor"
            data-cursor="hover"
            className="group relative inline-flex items-center gap-2 rounded-full bg-[var(--mk-paper)] px-4 py-2 text-[12px] font-medium tracking-[0.04em] text-[var(--mk-ink)] transition-transform duration-300 hover:scale-[1.02]"
          >
            Open editor
            <span aria-hidden="true" className="text-[10px] leading-none">
              →
            </span>
          </Link>
        </div>
      </nav>
    </header>
  )
}
