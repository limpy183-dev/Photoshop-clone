import * as React from "react"

import type { VideoClipTrackState } from "../../three-d-video-engine"
import { TextBtn } from "./timeline-shared"

export function VideoTrimTrack({
  state,
  onSeek,
  onTrimIn,
  onTrimOut,
  onSplit,
}: {
  state: VideoClipTrackState
  onSeek: (timeMs: number, record?: boolean) => void
  onTrimIn: (timeMs: number, label?: string) => void
  onTrimOut: (timeMs: number, label?: string) => void
  onSplit: () => void
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const timeFromClientX = React.useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0) return state.playheadMs
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const raw = pct * state.durationMs
      return Math.max(0, Math.min(state.durationMs, Math.round(raw / state.frameStepMs) * state.frameStepMs))
    },
    [state.durationMs, state.frameStepMs, state.playheadMs],
  )

  const beginDrag = (kind: "in" | "out" | "playhead") => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    let lastTime = timeFromClientX(event.clientX)
    const apply = (timeMs: number, commitLabel?: string) => {
      if (kind === "in") onTrimIn(Math.min(timeMs, state.outPointMs - state.frameStepMs), commitLabel)
      else if (kind === "out") onTrimOut(Math.max(timeMs, state.inPointMs + state.frameStepMs), commitLabel)
      else onSeek(timeMs, !!commitLabel)
    }
    apply(lastTime)
    const onMove = (moveEvent: PointerEvent) => {
      lastTime = timeFromClientX(moveEvent.clientX)
      apply(lastTime)
    }
    const onUp = () => {
      apply(lastTime, kind === "playhead" ? "Set Video Playhead" : "Trim Video Clip")
      window.removeEventListener("pointermove", onMove)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
  }

  return (
    <div className="grid gap-1">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Video trim and playhead track"
        aria-valuemin={0}
        aria-valuemax={state.durationMs}
        aria-valuenow={state.playheadMs}
        tabIndex={0}
        onPointerDown={(event) => onSeek(timeFromClientX(event.clientX), true)}
        className="relative h-9 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
      >
        <div className="absolute left-1 right-1 top-1/2 h-1 -translate-y-1/2 rounded-full bg-black/40" />
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-[var(--ps-accent)]/35"
          style={{ left: `${state.inPercent}%`, width: `${state.clipWidthPercent}%` }}
        />
        <button
          type="button"
          title="Drag trim in"
          aria-label="Drag video trim in handle"
          onPointerDown={beginDrag("in")}
          className="absolute top-1/2 h-7 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-[var(--ps-accent)] shadow"
          style={{ left: `${state.inPercent}%` }}
        />
        <button
          type="button"
          title="Drag trim out"
          aria-label="Drag video trim out handle"
          onPointerDown={beginDrag("out")}
          className="absolute top-1/2 h-7 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-[var(--ps-accent)] shadow"
          style={{ left: `${state.outPercent}%` }}
        />
        <button
          type="button"
          title="Drag playhead"
          aria-label="Drag video playhead"
          onPointerDown={beginDrag("playhead")}
          className="absolute top-0 h-full w-2 -translate-x-1/2 rounded-[2px] bg-white/80 shadow"
          style={{ left: `${state.playheadPercent}%` }}
        />
      </div>
      <div className="flex items-center gap-2 text-[9px] text-[var(--ps-text-dim)]">
        <span>In {state.labels.in}</span>
        <span>Out {state.labels.out}</span>
        <span className="ml-auto">Playhead {state.labels.playhead}</span>
        <TextBtn disabled={!state.canSplit} onClick={onSplit}>Split</TextBtn>
      </div>
    </div>
  )
}
