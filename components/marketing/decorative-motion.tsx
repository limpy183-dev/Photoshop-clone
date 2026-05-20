"use client"

import dynamic from "next/dynamic"

const BackgroundFX = dynamic(
  () => import("./background-fx").then((mod) => mod.BackgroundFX),
  { ssr: false },
)
const BrushHeroAnimation = dynamic(
  () => import("./brush-hero-animation").then((mod) => mod.BrushHeroAnimation),
  { ssr: false },
)
const Cursor = dynamic(
  () => import("./cursor").then((mod) => mod.Cursor),
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
