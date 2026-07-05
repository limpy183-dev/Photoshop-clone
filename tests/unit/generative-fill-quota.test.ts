import { describe, expect, it } from "vitest"
import {
  generativeFillConcurrencyKey,
  generativeFillDailyKey,
  generativeFillMinuteKey,
} from "../../lib/generative-fill-quota"

describe("generative fill quota identity", () => {
  it("uses only the authenticated subject for paid quota buckets", () => {
    const subject = "account:customer-42"
    expect(generativeFillMinuteKey(subject)).toBe("genfill:minute:account%3Acustomer-42")
    expect(generativeFillDailyKey(subject)).toBe("genfill:day:account%3Acustomer-42")
    expect(generativeFillConcurrencyKey(subject)).toBe("genfill:concurrency:account%3Acustomer-42")
  })

  it("bounds subject key length without accepting mutable request headers", () => {
    const longSubject = "x".repeat(500)
    expect(generativeFillMinuteKey(longSubject).length).toBeLessThanOrEqual(160)
  })
})
