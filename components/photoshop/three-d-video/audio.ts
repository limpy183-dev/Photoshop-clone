import type { AudioTrack } from "../types"
import { clamp } from "./math"

export interface AudioMixPlan {
  timeMs: number
  masterVolume: number
  activeTracks: Array<AudioTrack & { gain: number; leftGain: number; rightGain: number; localTimeMs: number }>
  leftGain: number
  rightGain: number
  peakGain: number
}

export interface OfflineAudioMixSchedule {
  sampleRate: number
  durationMs: number
  masterVolume: number
  tracks: Array<AudioTrack & {
    startSeconds: number
    durationSeconds: number
    fadeInSeconds: number
    fadeOutSeconds: number
    gain: number
    leftGain: number
    rightGain: number
  }>
}

export interface MuxedAudioStreamSchedule {
  sampleRate: number
  durationMs: number
  masterVolume: number
  tracks: Array<AudioTrack & {
    startSeconds: number
    durationSeconds: number
    fadeInSeconds: number
    fadeOutSeconds: number
    gain: number
    leftGain: number
    rightGain: number
    pan: number
    gainAutomation: Array<{ timeSeconds: number; value: number }>
  }>
}

function fadeEnvelope(track: AudioTrack, localTimeMs: number) {
  let gain = track.volume
  if (track.fadeInMs && track.fadeInMs > 0) gain *= clamp(localTimeMs / track.fadeInMs, 0, 1)
  if (track.fadeOutMs && track.fadeOutMs > 0) gain *= clamp((track.durationMs - localTimeMs) / track.fadeOutMs, 0, 1)
  return gain
}

/**
 * When any track is marked `solo`, only solo tracks should play; all others
 * are silenced for the duration of the mix. This mirrors the standard DAW
 * solo bus behaviour used by every audio mixer UI.
 */
export function audibleAudioTracks(tracks: AudioTrack[]): AudioTrack[] {
  const anySolo = tracks.some((track) => track.solo && !track.muted)
  return tracks.filter((track) => !track.muted && (!anySolo || track.solo === true))
}

export function buildAudioMixPlan(tracks: AudioTrack[], timeMs: number, options: { masterVolume?: number } = {}): AudioMixPlan {
  const masterVolume = clamp(options.masterVolume ?? 1, 0, 1)
  const audible = audibleAudioTracks(tracks)
  const activeTracks = audible
    .filter((track) => timeMs >= track.startMs && timeMs <= track.startMs + track.durationMs)
    .map((track) => {
      const localTimeMs = timeMs - track.startMs
      const gain = clamp(fadeEnvelope(track, localTimeMs) * masterVolume, 0, 1)
      const pan = clamp(track.pan ?? 0, -1, 1)
      const leftGain = gain * (pan <= 0 ? 1 : 1 - pan)
      const rightGain = gain * (pan >= 0 ? 1 : 1 + pan)
      return { ...track, gain, leftGain, rightGain, localTimeMs }
    })
  const leftGain = clamp(activeTracks.reduce((sum, track) => sum + track.leftGain, 0), 0, 1)
  const rightGain = clamp(activeTracks.reduce((sum, track) => sum + track.rightGain, 0), 0, 1)
  return { timeMs, masterVolume, activeTracks, leftGain, rightGain, peakGain: Math.max(leftGain, rightGain) }
}

export function buildOfflineAudioMixSchedule(
  tracks: AudioTrack[],
  options: { masterVolume?: number; sampleRate?: number; durationMs?: number } = {},
): OfflineAudioMixSchedule {
  const masterVolume = clamp(options.masterVolume ?? 1, 0, 1)
  const sampleRate = Math.max(8000, Math.round(options.sampleRate ?? 48_000))
  const audible = audibleAudioTracks(tracks)
  const scheduled = audible
    .filter((track) => !!track.dataUrl && track.durationMs > 0)
    .map((track) => {
      const gain = clamp((track.volume ?? 1) * masterVolume, 0, 1)
      const pan = clamp(track.pan ?? 0, -1, 1)
      const leftGain = gain * (pan <= 0 ? 1 : 1 - pan)
      const rightGain = gain * (pan >= 0 ? 1 : 1 + pan)
      return {
        ...track,
        gain,
        leftGain,
        rightGain,
        startSeconds: Math.max(0, track.startMs) / 1000,
        durationSeconds: Math.max(0, track.durationMs) / 1000,
        fadeInSeconds: Math.max(0, track.fadeInMs ?? 0) / 1000,
        fadeOutSeconds: Math.max(0, track.fadeOutMs ?? 0) / 1000,
      }
    })
  const inferredDuration = scheduled.reduce((max, track) => Math.max(max, track.startMs + track.durationMs), 0)
  return {
    sampleRate,
    durationMs: Math.max(1, Math.round(options.durationMs ?? inferredDuration)),
    masterVolume,
    tracks: scheduled,
  }
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

export function buildMuxedAudioStreamSchedule(
  tracks: AudioTrack[],
  options: { masterVolume?: number; sampleRate?: number; durationMs?: number } = {},
): MuxedAudioStreamSchedule {
  const schedule = buildOfflineAudioMixSchedule(tracks, options)
  return {
    ...schedule,
    tracks: schedule.tracks.map((track) => {
      const start = roundSeconds(track.startSeconds)
      const end = roundSeconds(track.startSeconds + track.durationSeconds)
      const fadeInEnd = roundSeconds(Math.min(end, track.startSeconds + track.fadeInSeconds))
      const fadeOutStart = roundSeconds(Math.max(start, end - track.fadeOutSeconds))
      const automation: Array<{ timeSeconds: number; value: number }> = []
      if (track.fadeInSeconds > 0) {
        automation.push({ timeSeconds: start, value: 0 })
        automation.push({ timeSeconds: fadeInEnd, value: track.gain })
      } else {
        automation.push({ timeSeconds: start, value: track.gain })
      }
      if (track.fadeOutSeconds > 0) {
        if (fadeOutStart > automation[automation.length - 1].timeSeconds) {
          automation.push({ timeSeconds: fadeOutStart, value: track.gain })
        }
        automation.push({ timeSeconds: end, value: 0 })
      } else if (end > automation[automation.length - 1].timeSeconds) {
        automation.push({ timeSeconds: end, value: track.gain })
      }
      return {
        ...track,
        pan: clamp(track.pan ?? 0, -1, 1),
        gainAutomation: automation,
      }
    }),
  }
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",")
  const header = comma >= 0 ? dataUrl.slice(0, comma) : ""
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  if (/;base64/i.test(header)) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
  const encoded = new TextEncoder().encode(decodeURIComponent(payload))
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
}

function offlineAudioContextCtor(): typeof OfflineAudioContext {
  const candidate = globalThis.OfflineAudioContext
    ?? (globalThis as typeof globalThis & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!candidate) throw new Error("OfflineAudioContext is not available in this browser")
  return candidate
}

export async function renderAudioMixToAudioBuffer(
  tracks: AudioTrack[],
  options: { masterVolume?: number; sampleRate?: number; durationMs?: number } = {},
): Promise<AudioBuffer> {
  const schedule = buildOfflineAudioMixSchedule(tracks, options)
  const OfflineCtx = offlineAudioContextCtor()
  const length = Math.max(1, Math.ceil((schedule.durationMs / 1000) * schedule.sampleRate))
  const context = new OfflineCtx(2, length, schedule.sampleRate)

  for (const track of schedule.tracks) {
    if (!track.dataUrl) continue
    const source = context.createBufferSource()
    const data = dataUrlToArrayBuffer(track.dataUrl)
    source.buffer = await context.decodeAudioData(data.slice(0))
    source.playbackRate.value = Math.max(0.01, track.playbackRate ?? 1)

    const gain = context.createGain()
    const start = track.startSeconds
    const end = Math.min(schedule.durationMs / 1000, start + track.durationSeconds)
    const fadeInEnd = Math.min(end, start + track.fadeInSeconds)
    const fadeOutStart = Math.max(start, end - track.fadeOutSeconds)
    gain.gain.setValueAtTime(track.fadeInSeconds > 0 ? 0 : track.gain, start)
    if (track.fadeInSeconds > 0) gain.gain.linearRampToValueAtTime(track.gain, fadeInEnd)
    gain.gain.setValueAtTime(track.gain, fadeOutStart)
    if (track.fadeOutSeconds > 0) gain.gain.linearRampToValueAtTime(0, end)

    const maybeStereo = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null
    if (maybeStereo) {
      maybeStereo.pan.value = clamp(track.pan ?? 0, -1, 1)
      source.connect(gain)
      gain.connect(maybeStereo)
      maybeStereo.connect(context.destination)
    } else {
      source.connect(gain)
      gain.connect(context.destination)
    }
    source.start(start, 0, Math.max(0.001, end - start))
  }

  return context.startRendering()
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i) & 0xff)
}

export function encodeWavFromAudioBuffer(buffer: AudioBuffer): Uint8Array {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels || 1))
  const sampleRate = Math.max(1, Math.round(buffer.sampleRate || 44_100))
  const bitsPerSample = 16
  const blockAlign = channels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  const dataSize = buffer.length * blockAlign
  const out = new Uint8Array(44 + dataSize)
  const view = new DataView(out.buffer)
  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, dataSize, true)

  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)))
  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = clamp(channelData[channel][i] ?? 0, -1, 1)
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return out
}

export async function renderAudioMixToWavBlob(
  tracks: AudioTrack[],
  options: { masterVolume?: number; sampleRate?: number; durationMs?: number } = {},
): Promise<Blob> {
  const buffer = await renderAudioMixToAudioBuffer(tracks, options)
  return new Blob([encodeWavFromAudioBuffer(buffer)], { type: "audio/wav" })
}

/**
 * Decode an audio data URL into an AudioBuffer using an OfflineAudioContext.
 *
 * Each call creates a short-lived 1-channel/1-sample OfflineAudioContext purely
 * to access `decodeAudioData`; the returned buffer can be sampled freely by the
 * UI without touching the live AudioContext used for playback.
 */
export async function decodeAudioBufferFromDataUrl(dataUrl: string, sampleRate = 48_000): Promise<AudioBuffer> {
  const OfflineCtx = offlineAudioContextCtor()
  const context = new OfflineCtx(1, 1, Math.max(8000, Math.round(sampleRate)))
  const data = dataUrlToArrayBuffer(dataUrl)
  return context.decodeAudioData(data.slice(0))
}

export interface WaveformPeaks {
  /** Min sample per peak bucket, range [-1, 1]. */
  min: Float32Array
  /** Max sample per peak bucket, range [-1, 1]. */
  max: Float32Array
  /** Sample rate the peaks were derived from. */
  sampleRate: number
  /** Source channel count. Peaks are flattened to mono by averaging. */
  channels: number
  /** Duration covered by the peaks in seconds. */
  durationSeconds: number
}

/**
 * Compute min/max peak pairs from an AudioBuffer suitable for drawing a
 * waveform thumbnail. Channels are averaged to mono before bucketing.
 */
export function computeWaveformPeaks(buffer: AudioBuffer, buckets: number): WaveformPeaks {
  const targetBuckets = Math.max(1, Math.floor(buckets))
  const channelCount = Math.max(1, buffer.numberOfChannels)
  const length = buffer.length
  const min = new Float32Array(targetBuckets)
  const max = new Float32Array(targetBuckets)
  if (length === 0) {
    return { min, max, sampleRate: buffer.sampleRate, channels: channelCount, durationSeconds: 0 }
  }
  const channels: Float32Array[] = []
  for (let c = 0; c < channelCount; c++) channels.push(buffer.getChannelData(c))
  const samplesPerBucket = Math.max(1, Math.floor(length / targetBuckets))
  for (let bucket = 0; bucket < targetBuckets; bucket++) {
    const start = bucket * samplesPerBucket
    const end = bucket === targetBuckets - 1 ? length : Math.min(length, start + samplesPerBucket)
    let lo = Infinity
    let hi = -Infinity
    for (let i = start; i < end; i++) {
      let sum = 0
      for (let c = 0; c < channelCount; c++) sum += channels[c][i]
      const sample = sum / channelCount
      if (sample < lo) lo = sample
      if (sample > hi) hi = sample
    }
    if (!Number.isFinite(lo)) lo = 0
    if (!Number.isFinite(hi)) hi = 0
    min[bucket] = clamp(lo, -1, 1)
    max[bucket] = clamp(hi, -1, 1)
  }
  return {
    min,
    max,
    sampleRate: buffer.sampleRate,
    channels: channelCount,
    durationSeconds: length / buffer.sampleRate,
  }
}

/**
 * Draw a min/max waveform onto a target 2D canvas. The canvas is sized to
 * match its CSS box so the caller can use simple `width`/`height` props.
 */
export function drawWaveformPeaks(
  canvas: HTMLCanvasElement,
  peaks: WaveformPeaks,
  options: { color?: string; background?: string; centerLine?: boolean } = {},
): void {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)
  if (options.background) {
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, width, height)
  }
  ctx.fillStyle = options.color ?? "#7dd3fc"
  const midY = height / 2
  const bucketCount = peaks.min.length
  if (bucketCount === 0) return
  const xStep = width / bucketCount
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const x = bucket * xStep
    const top = midY - peaks.max[bucket] * midY
    const bottom = midY - peaks.min[bucket] * midY
    ctx.fillRect(x, Math.min(top, bottom), Math.max(0.5, xStep - 0.5), Math.max(1, Math.abs(bottom - top)))
  }
  if (options.centerLine !== false) {
    ctx.fillStyle = "rgba(255,255,255,0.18)"
    ctx.fillRect(0, midY - 0.5, width, 1)
  }
}
