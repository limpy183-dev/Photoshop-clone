import { expect, test } from "@playwright/test"
import {
  addPhotoshopEventListener,
  dispatchPhotoshopEvent,
  type PhotoshopEventMap,
} from "../components/photoshop/events"

test("typed photoshop event helpers dispatch detail and return an unsubscribe", () => {
  const received: PhotoshopEventMap["ps-request-zoom"][] = []
  const unsubscribe = addPhotoshopEventListener("ps-request-zoom", (detail) => {
    received.push(detail)
  })

  dispatchPhotoshopEvent("ps-request-zoom", { factor: 1.25 })
  unsubscribe()
  dispatchPhotoshopEvent("ps-request-zoom", { zoom: 2 })

  expect(received).toEqual([{ factor: 1.25 }])
})
