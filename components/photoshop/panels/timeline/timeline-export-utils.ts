import { packagePngSequenceZip, type AnimatedExportFrame } from "../../animation-encoding"
import { renderAudioMixToWavBlob, type FinalVideoExportPlan } from "../../three-d-video-engine"
import type { AudioTrack, PsDocument } from "../../types"

export async function buildTimelineVideoPackage(
  doc: PsDocument,
  plan: FinalVideoExportPlan,
  frames: AnimatedExportFrame[],
  audioTracks: AudioTrack[],
) {
  const stem = safeFilePart(doc.name)
  const entries: Array<{ name: string; bytes: Blob | Uint8Array | string }> = []
  for (let index = 0; index < frames.length; index++) {
    entries.push({
      name: `frames/${stem}-${String(index + 1).padStart(5, "0")}.png`,
      bytes: await canvasToPngBlob(frames[index].canvas),
    })
  }
  const muxableAudio = audioTracks.filter((track) => !track.muted && !!track.dataUrl && track.durationMs > 0)
  if (muxableAudio.length) {
    entries.push({
      name: "audio/mix.wav",
      bytes: await renderAudioMixToWavBlob(muxableAudio, {
        sampleRate: 48_000,
        durationMs: plan.durationMs,
        masterVolume: 1,
      }),
    })
  }
  entries.push({
    name: "manifest.json",
    bytes: JSON.stringify(
      {
        document: doc.name,
        exportedAt: new Date().toISOString(),
        plan,
        frames: frames.map((frame, index) => ({
          index,
          file: `frames/${stem}-${String(index + 1).padStart(5, "0")}.png`,
          durationMs: frame.durationMs,
          sourceFrameId: frame.sourceFrameId,
          timeMs: frame.timeMs,
        })),
        audio: muxableAudio.length ? { file: "audio/mix.wav", tracks: muxableAudio.map((track) => ({ id: track.id, name: track.name })) } : null,
      },
      null,
      2,
    ),
  })
  return packagePngSequenceZip(entries)
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG frame encode failed"))), "image/png")
  })
}

export function safeFilePart(name: string) {
  return (name || "timeline")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "timeline"
}

export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",")
  const header = comma >= 0 ? dataUrl.slice(0, comma) : ""
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  if (/;base64/i.test(header)) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
  const bytes = new TextEncoder().encode(decodeURIComponent(payload))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Read blob failed"))
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.readAsDataURL(blob)
  })
}
