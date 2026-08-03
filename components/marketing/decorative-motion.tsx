"use client"

import dynamic from "next/dynamic"

const BackgroundFX = dynamic(
  () => import("@/components/marketing/background-fx").then((mod) => mod.BackgroundFX),
  { ssr: false },
)
const BrushHeroAnimation = dynamic(
  () => import("@/components/marketing/brush-hero-animation").then((mod) => mod.BrushHeroAnimation),
  { ssr: false },
)
const Cursor = dynamic(
  () => import("@/components/marketing/cursor").then((mod) => mod.Cursor),
  { ssr: false },
)

export function DecorativeMotion() {
  return (
    <>
      <BackgroundFX />
      <BrushHeroAnimation />
      <Cursor />
    </>
  )
}
