import * as React from "react"
import { Volume2, VolumeX } from "lucide-react"

import {
  computeWaveformPeaks,
  decodeAudioBufferFromDataUrl,
  drawWaveformPeaks,
  type WaveformPeaks,
} from "../../three-d-video-engine"
import type { AudioTrack } from "../../types"

/* ---------------------- Audio mixer + waveform widget --------------------- */

export function AudioMixerSection({
  tracks,
  playing,
  playheadMs,
  vuLevels,
  onVuLevels,
  onUpdate,
}: {
  tracks: AudioTrack[]
  playing: boolean
  playheadMs: number
  vuLevels: Record<string, number>
  onVuLevels: React.Dispatch<React.SetStateAction<Record<string, number>>>
  onUpdate: (trackId: string, patch: Partial<AudioTrack>) => void
}) {
  const anySolo = React.useMemo(
    () => tracks.some((t) => t.solo === true && !t.muted),
    [tracks],
  )
  return (
    <div className="grid gap-1 border-b border-[var(--ps-divider)] px-2 py-1.5">
      {tracks.map((track) => (
        <AudioMixerRow
          key={track.id}
          track={track}
          playing={playing}
          anySolo={anySolo}
          playheadMs={playheadMs}
          vu={vuLevels[track.id] ?? 0}
          setVu={(value) =>
            onVuLevels((prev) => (prev[track.id] === value ? prev : { ...prev, [track.id]: value }))
          }
          onUpdate={onUpdate}
        />
      ))}
    </div>
  )
}

function AudioMixerRow({
  track,
  playing,
  anySolo,
  playheadMs,
  vu,
  setVu,
  onUpdate,
}: {
  track: AudioTrack
  playing: boolean
  anySolo: boolean
  playheadMs: number
  vu: number
  setVu: (value: number) => void
  onUpdate: (trackId: string, patch: Partial<AudioTrack>) => void
}) {
  const peaksRef = React.useRef<WaveformPeaks | null>(null)
  const waveformRef = React.useRef<HTMLCanvasElement | null>(null)
  const [peaksReady, setPeaksReady] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setPeaksReady(false)
    peaksRef.current = null
    const canvas = waveformRef.current
    if (canvas) {
      const ctx = canvas.getContext("2d")
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
    if (!track.dataUrl) return undefined
    decodeAudioBufferFromDataUrl(track.dataUrl)
      .then((buffer) => {
        if (cancelled) return
        const buckets = Math.max(64, Math.min(1024, Math.round(buffer.duration * 80)))
        const peaks = computeWaveformPeaks(buffer, buckets)
        peaksRef.current = peaks
        setPeaksReady(true)
        const cv = waveformRef.current
        if (cv) {
          const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
          const cw = cv.clientWidth || 160
          const ch = cv.clientHeight || 28
          const targetW = Math.max(160, Math.round(cw * dpr))
          const targetH = Math.max(28, Math.round(ch * dpr))
          if (cv.width !== targetW) cv.width = targetW
          if (cv.height !== targetH) cv.height = targetH
          drawWaveformPeaks(cv, peaks, {
            background: "rgba(0,0,0,0)",
            color: track.muted ? "#666" : "#7c9cff",
          })
        }
      })
      .catch(() => {
        if (!cancelled) setPeaksReady(false)
      })
    return () => {
      cancelled = true
    }
  }, [track.dataUrl, track.muted])

  React.useEffect(() => {
    if (!playing) {
      setVu(0)
      return undefined
    }
    let raf = 0
    const tick = () => {
      const peaks = peaksRef.current
      if (!peaks || peaks.durationSeconds <= 0) {
        setVu(0)
      } else {
        const localMs = playheadMs - track.startMs
        if (localMs < 0 || localMs > track.durationMs) {
          setVu(0)
        } else {
          const localSeconds = localMs / 1000
          const bucket = Math.max(
            0,
            Math.min(
              peaks.max.length - 1,
              Math.floor((localSeconds / peaks.durationSeconds) * peaks.max.length),
            ),
          )
          const mag = Math.max(Math.abs(peaks.max[bucket] ?? 0), Math.abs(peaks.min[bucket] ?? 0))
          const muted = track.muted === true || (anySolo && track.solo !== true)
          const gain = muted ? 0 : Math.max(0, Math.min(2, track.volume ?? 1))
          setVu(Math.max(0, Math.min(1, mag * gain)))
        }
      }
      raf = window.requestAnimationFrame(tick)
    }
    tick()
    return () => {
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [
    playing,
    playheadMs,
    track.startMs,
    track.durationMs,
    track.muted,
    track.solo,
    track.volume,
    anySolo,
    setVu,
  ])

  const muted = track.muted === true || (anySolo && track.solo !== true)
  const volumePct = Math.round(Math.max(0, Math.min(1.5, track.volume ?? 1)) * 100)
  const panPct = Math.round(Math.max(-1, Math.min(1, track.pan ?? 0)) * 100)
  const fadeMax = Math.max(1000, Math.round(track.durationMs || 1000))
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(150px,220px)_70px] items-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]/30 px-2 py-1">
      <div className="min-w-0">
        <div className="truncate text-[10px] text-[var(--ps-text)]" title={track.name}>
          {track.name || "Audio track"}
        </div>
        <canvas
          ref={waveformRef}
          aria-label={`Waveform for ${track.name}`}
          className="mt-0.5 h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-black/30"
        />
        {!peaksReady && track.dataUrl ? (
          <div className="text-[9px] text-[var(--ps-text-dim)]">Decoding waveform…</div>
        ) : null}
        {!track.dataUrl ? (
          <div className="text-[9px] text-[var(--ps-text-dim)]">No source media (cue-only)</div>
        ) : null}
      </div>
      <button
        type="button"
        title={track.muted ? "Unmute" : "Mute"}
        aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
        onClick={() => onUpdate(track.id, { muted: !track.muted })}
        className={`flex h-6 w-6 items-center justify-center rounded-sm border ${
          track.muted
            ? "border-[var(--ps-accent)] bg-[var(--ps-accent)]/30 text-[var(--ps-text)]"
            : "border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]"
        }`}
      >
        {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
      </button>
      <button
        type="button"
        title={track.solo ? "Un-solo" : "Solo"}
        aria-label={track.solo ? `Un-solo ${track.name}` : `Solo ${track.name}`}
        onClick={() => onUpdate(track.id, { solo: !track.solo })}
        className={`flex h-6 w-6 items-center justify-center rounded-sm border text-[10px] font-semibold ${
          track.solo
            ? "border-[var(--ps-accent)] bg-[var(--ps-accent)] text-black"
            : "border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]"
        }`}
      >
        S
      </button>
      <div className="grid gap-1">
        <label className="grid grid-cols-[34px_1fr_34px] items-center gap-1 text-[9px] text-[var(--ps-text-dim)]">
          <span>Vol</span>
          <input
            type="range"
            min={0}
            max={150}
            value={volumePct}
            onChange={(e) =>
              onUpdate(track.id, {
                volume: Math.max(0, Math.min(1.5, Number(e.target.value) / 100)),
              })
            }
            className="h-4 w-full"
            aria-label={`Volume for ${track.name}`}
          />
          <span className="text-right">{volumePct}%</span>
        </label>
        <label className="grid grid-cols-[34px_1fr_34px] items-center gap-1 text-[9px] text-[var(--ps-text-dim)]">
          <span>Pan</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={panPct}
            onChange={(e) =>
              onUpdate(track.id, {
                pan: Math.max(-1, Math.min(1, Number(e.target.value) / 100)),
              })
            }
            className="h-4 w-full"
            aria-label={`Pan for ${track.name}`}
          />
          <span className="text-right">{panPct === 0 ? "C" : panPct < 0 ? `L${Math.abs(panPct)}` : `R${panPct}`}</span>
        </label>
        <div className="grid grid-cols-2 gap-1">
          <label className="grid grid-cols-[28px_1fr] items-center gap-1 text-[9px] text-[var(--ps-text-dim)]">
            <span>In</span>
            <input
              type="range"
              min={0}
              max={fadeMax}
              step={50}
              value={Math.max(0, Math.min(fadeMax, track.fadeInMs ?? 0))}
              onChange={(e) => onUpdate(track.id, { fadeInMs: Math.max(0, Math.min(fadeMax, Number(e.target.value) || 0)) })}
              className="h-4 w-full"
              aria-label={`Fade in for ${track.name}`}
            />
          </label>
          <label className="grid grid-cols-[32px_1fr] items-center gap-1 text-[9px] text-[var(--ps-text-dim)]">
            <span>Out</span>
            <input
              type="range"
              min={0}
              max={fadeMax}
              step={50}
              value={Math.max(0, Math.min(fadeMax, track.fadeOutMs ?? 0))}
              onChange={(e) => onUpdate(track.id, { fadeOutMs: Math.max(0, Math.min(fadeMax, Number(e.target.value) || 0)) })}
              className="h-4 w-full"
              aria-label={`Fade out for ${track.name}`}
            />
          </label>
        </div>
      </div>
      <div
        className="flex h-12 items-end overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-black"
        role="meter"
        aria-label={`VU meter for ${track.name}`}
        aria-valuenow={Math.round(vu * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        title={`${Math.round(vu * 100)}%${muted ? " (muted)" : ""}`}
      >
        <div
          className={`mt-auto w-full transition-[height] ${muted ? "bg-[var(--ps-text-dim)]/40" : "bg-[var(--ps-accent)]"}`}
          style={{ height: `${Math.max(0, Math.min(100, vu * 100))}%` }}
        />
      </div>
    </div>
  )
}
