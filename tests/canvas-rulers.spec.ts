import { expect, test } from "@playwright/test"

import {
  RulerTicks,
  Rulers,
  rulerGuideFromPointer,
  rulerGuidePreviewStyle,
  rulerTickPositionStyle,
} from "../components/photoshop/canvas-rulers"

test("ruler components remain exported from the focused module", () => {
  expect(Rulers).toBeTruthy()
  expect(RulerTicks).toBeTruthy()
})

test("pointer coordinates retain ruler guide conversion and clamping", () => {
  const stageRect = {
    left: 100,
    top: 20,
    width: 400,
    height: 200,
  }

  expect(rulerGuideFromPointer("horizontal", { clientX: 0, clientY: 70 }, stageRect, 800, 400)).toEqual({
    orient: "horizontal",
    pos: 100,
  })
  expect(rulerGuideFromPointer("vertical", { clientX: 300, clientY: 0 }, stageRect, 800, 400)).toEqual({
    orient: "vertical",
    pos: 400,
  })
  expect(rulerGuideFromPointer("horizontal", { clientX: 0, clientY: -100 }, stageRect, 800, 400)).toEqual({
    orient: "horizontal",
    pos: 0,
  })
  expect(rulerGuideFromPointer("vertical", { clientX: 900, clientY: 0 }, stageRect, 800, 400)).toEqual({
    orient: "vertical",
    pos: 800,
  })
})

test("ruler guide preview retains centered stage formulas and styles", () => {
  expect(rulerGuidePreviewStyle(
    { orient: "horizontal", pos: 20 },
    100,
    80,
    2,
  )).toEqual({
    top: "calc(50% + -22px)",
    left: 18,
    right: 0,
    height: 1,
    background: "#06b6d4",
    boxShadow: "0 0 0 1px rgba(6,182,212,0.28)",
  })
  expect(rulerGuidePreviewStyle(
    { orient: "vertical", pos: 30 },
    100,
    80,
    2,
  )).toEqual({
    left: "calc(50% + -22px)",
    top: 18,
    bottom: 0,
    width: 1,
    background: "#06b6d4",
    boxShadow: "0 0 0 1px rgba(6,182,212,0.28)",
  })
})

test("ruler tick placement retains horizontal and vertical centering", () => {
  expect(rulerTickPositionStyle(40, 100, 2, "horizontal")).toEqual({
    left: "calc(50% + -60px)",
  })
  expect(rulerTickPositionStyle(40, 100, 2, "vertical")).toEqual({
    top: "calc(50% + -60px)",
  })
})
