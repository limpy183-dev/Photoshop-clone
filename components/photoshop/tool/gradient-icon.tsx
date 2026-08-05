"use client"

import * as React from "react"

/** Photoshop-style gradient tool mark: a square ramping from solid to empty. */
export function GradientIcon({ className }: { className?: string }) {
  const id = React.useId()
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="2" fill={`url(#${id})`} />
    </svg>
  )
}
