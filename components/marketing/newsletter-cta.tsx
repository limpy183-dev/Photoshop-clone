"use client"

import * as React from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"
import { toast } from "sonner"

gsap.registerPlugin(useGSAP, ScrollTrigger)

type FormState = "idle" | "loading" | "success" | "error"

export function NewsletterCta() {
  const sectionRef = React.useRef<HTMLElement | null>(null)
  const [email, setEmail] = React.useState("")
  const [feedback, setFeedback] = React.useState("")
  const [formState, setFormState] = React.useState<FormState>("idle")
  const [feedbackState, setFeedbackState] = React.useState<FormState>("idle")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  useGSAP(
    () => {
      gsap.from("[data-cta-eyebrow]", {
        autoAlpha: 0,
        y: 20,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 80%" },
      })
      gsap.from("[data-cta-title] .mk-reveal > span", {
        yPercent: 110,
        rotate: 3,
        duration: 1,
        ease: "power4.out",
        stagger: 0.07,
        scrollTrigger: { trigger: sectionRef.current, start: "top 75%" },
      })
      gsap.from("[data-cta-row]", {
        autoAlpha: 0,
        y: 30,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.12,
        scrollTrigger: { trigger: sectionRef.current, start: "top 70%" },
      })
    },
    { scope: sectionRef },
  )

  const onSubscribe = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email) return
    setFormState("loading")
    setErrorMessage(null)
    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        total?: number
      }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Subscription failed")
      }
      setFormState("success")
      toast.success("You're on the list", {
        description:
          typeof payload.total === "number"
            ? `Joining ${payload.total} other members of the workspace.`
            : undefined,
      })
      setEmail("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Subscription failed"
      setFormState("error")
      setErrorMessage(message)
      toast.error("Couldn't subscribe", { description: message })
    }
  }

  const onFeedback = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!feedback.trim()) return
    setFeedbackState("loading")
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: feedback }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not record feedback")
      }
      setFeedbackState("success")
      toast.success("Thanks — feedback received")
      setFeedback("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed"
      setFeedbackState("error")
      toast.error("Feedback didn't send", { description: message })
    }
  }

  return (
    <section
      id="updates"
      ref={sectionRef}
      className="relative overflow-hidden border-t border-[var(--mk-rule)] bg-[var(--mk-ink-veil)] py-28 md:py-40 mk-grain backdrop-blur-[2px]"
    >
      <div className="pointer-events-none absolute inset-0 mk-grid-bg opacity-50" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 top-10 h-[480px] w-[480px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(226,119,42,0.22) 0%, rgba(226,119,42,0) 70%)",
        }}
      />

      <div className="relative mx-auto max-w-[1480px] px-6 md:px-10 lg:px-14">
        <div className="flex items-center gap-4" data-cta-eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mk-rust)]">
            §06 · Subscribe / Feedback
          </span>
          <span className="h-px flex-1 bg-[var(--mk-rule)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
            POST /api · file-backed
          </span>
        </div>

        <h2
          data-cta-title
          className="mt-10 font-display text-[2.6rem] leading-[0.98] tracking-[-0.02em] md:text-[5.5rem] lg:text-[7rem]"
        >
          <span className="block">
            <span className="mk-reveal">
              <span>Get the next</span>
            </span>{" "}
            <span className="mk-reveal">
              <span className="italic">release.</span>
            </span>
          </span>
          <span className="block">
            <span className="mk-reveal">
              <span>Tell us what&apos;s</span>
            </span>{" "}
            <span className="mk-reveal">
              <span className="italic text-[var(--mk-rust)]">missing.</span>
            </span>
          </span>
        </h2>

        <div className="mt-16 grid grid-cols-12 gap-x-6 gap-y-16">
          {/* Subscribe */}
          <div data-cta-row className="col-span-12 lg:col-span-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-blue-soft)]">
              01 / Updates
            </span>
            <h3 className="mt-4 font-display text-[2rem] leading-tight italic">
              Patch notes &amp; release pings.
            </h3>
            <p className="mt-3 max-w-[44ch] text-sm leading-relaxed text-[var(--mk-paper-dim)]">
              No marketing emails. Just the changelog when a new build ships and
              when a tool gains a real-world parity feature.
            </p>

            <form className="mt-8" onSubmit={onSubscribe} noValidate>
              <label htmlFor="mk-email" className="sr-only">
                Email
              </label>
              <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:gap-5">
                <input
                  id="mk-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@studio.com"
                  className="mk-input flex-1"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    if (formState === "error") setFormState("idle")
                  }}
                  disabled={formState === "loading"}
                />
                <button
                  type="submit"
                  data-cursor="hover"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-[var(--mk-paper)] px-5 py-3 text-[13px] font-medium uppercase tracking-[0.18em] text-[var(--mk-ink)] transition-transform duration-300 hover:scale-[1.02] disabled:cursor-progress disabled:opacity-70"
                  disabled={formState === "loading"}
                >
                  {formState === "loading" ? "Sending…" : "Notify me"}
                  <span aria-hidden="true">→</span>
                </button>
              </div>

              <div className="mt-4 min-h-[20px] font-mono text-[11px] uppercase tracking-[0.18em]">
                {formState === "success" ? (
                  <span className="text-[var(--mk-blue-soft)]">
                    ✓ Confirmed — you&apos;re on the patch list.
                  </span>
                ) : null}
                {formState === "error" ? (
                  <span className="text-[var(--mk-rust)]">{errorMessage}</span>
                ) : null}
                {formState === "idle" ? (
                  <span className="text-[var(--mk-paper-dim)]">
                    No spam. Unsubscribe with one click.
                  </span>
                ) : null}
              </div>
            </form>
          </div>

          {/* Feedback */}
          <div data-cta-row className="col-span-12 lg:col-span-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-amber)]">
              02 / Feedback
            </span>
            <h3 className="mt-4 font-display text-[2rem] leading-tight italic">
              What do you wish it did?
            </h3>
            <p className="mt-3 max-w-[44ch] text-sm leading-relaxed text-[var(--mk-paper-dim)]">
              Tools, panels, filters, formats. Tell us what&apos;s missing and
              what you&apos;d trust the browser version to handle.
            </p>

            <form className="mt-8" onSubmit={onFeedback} noValidate>
              <label htmlFor="mk-feedback" className="sr-only">
                Feedback
              </label>
              <textarea
                id="mk-feedback"
                rows={3}
                placeholder="Smart objects with non-destructive perspective warp, please."
                className="mk-input resize-none"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                disabled={feedbackState === "loading"}
              />
              <div className="mt-5 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mk-paper-dim)]">
                  {feedbackState === "success" ? "✓ Logged" : "Anonymous if you want"}
                </span>
                <button
                  type="submit"
                  data-cursor="hover"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--mk-rule-strong)] px-5 py-3 text-[13px] font-medium uppercase tracking-[0.18em] text-[var(--mk-paper)] transition-colors duration-300 hover:bg-[var(--mk-paper)] hover:text-[var(--mk-ink)] disabled:cursor-progress disabled:opacity-70"
                  disabled={feedbackState === "loading" || !feedback.trim()}
                >
                  {feedbackState === "loading" ? "Sending…" : "Send"}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}
