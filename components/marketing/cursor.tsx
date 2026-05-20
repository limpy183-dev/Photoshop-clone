"use client"

import * as React from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP)

/**
 * A small, mix-blend-difference cursor that follows the pointer with GSAP's
 * quickTo for sub-frame smoothness. Hovering elements with `data-cursor="hover"`
 * grows it. Hidden under prefers-reduced-motion or on small screens via CSS.
 */
export function Cursor() {
  const cursorRef = React.useRef<HTMLDivElement | null>(null)

  useGSAP(
    () => {
      const el = cursorRef.current
      if (!el) return

      const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
      if (mql.matches) {
        el.style.display = "none"
        return
      }

      const xTo = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" })
      const yTo = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" })

      const move = (event: PointerEvent) => {
        xTo(event.clientX)
        yTo(event.clientY)
      }
      const over = (event: PointerEvent) => {
        const target = event.target as HTMLElement | null
        const interactive =
          target?.closest("a, button, [data-cursor='hover'], input, [role='button']") !==
          null
        el.dataset.state = interactive ? "hover" : "idle"
      }

      window.addEventListener("pointermove", move)
      window.addEventListener("pointerover", over)
      return () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerover", over)
      }
    },
    { scope: cursorRef },
  )

  return <div ref={cursorRef} className="mk-cursor" aria-hidden="true" />
}
