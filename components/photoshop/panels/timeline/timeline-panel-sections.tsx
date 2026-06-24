"use client"

import { Scissors } from "lucide-react"

import type { PsDocument, TimelineFrame } from "../../types"
import { FrameRow } from "./timeline-frame-row"
import { PanelEmpty, TextBtn } from "./timeline-shared"
import { TimelineThumbnailStrip } from "./timeline-thumbnail-strip"

interface TimelinePlayheadSectionProps {
  doc: PsDocument
  frames: TimelineFrame[]
  playheadMs: number
  playheadFrameIndex: number
  totalDurationMs: number
  fps: number
  cache: Map<string, ImageBitmap>
  onSeek: (timeMs: number) => void
  onSplit: () => void
}

export function TimelinePlayheadSection({
  doc,
  frames,
  playheadMs,
  playheadFrameIndex,
  totalDurationMs,
  fps,
  cache,
  onSeek,
  onSplit,
}: TimelinePlayheadSectionProps) {
  return (
    <div className="grid gap-1 border-b border-[var(--ps-divider)] px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="w-20 text-[10px] text-[var(--ps-text-dim)]">Playhead {(playheadMs / 1000).toFixed(2)}s</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, totalDurationMs)}
          step={Math.max(1, Math.round(1000 / fps))}
          value={playheadMs}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="h-5 flex-1"
          aria-label="Timeline playhead"
        />
        <span className="w-16 text-right text-[10px] text-[var(--ps-text-dim)]">
          {playheadFrameIndex >= 0 ? `#${playheadFrameIndex + 1}` : "--"}
        </span>
        <TextBtn disabled={frames.length < 1} onClick={onSplit} title="Split frame at playhead (Ctrl+Shift+K)">
          <Scissors className="mr-1 inline h-3 w-3" />Split frame
        </TextBtn>
      </div>
      <TimelineThumbnailStrip
        doc={doc}
        frames={frames}
        playheadMs={playheadMs}
        playheadFrameIndex={playheadFrameIndex}
        cache={cache}
        onSeekFrame={(index) => {
          const before = frames.slice(0, index).reduce((sum, frame) => sum + Math.max(0, frame.durationMs), 0)
          onSeek(before)
        }}
      />
    </div>
  )
}

interface TimelineBulkEditBarProps {
  selectedCount: number
  onSetDuration: (durationMs: number) => void
  onDistributeDurations: () => void
  onDeleteSelected: () => void
  onClearSelection: () => void
}

export function TimelineBulkEditBar({
  selectedCount,
  onSetDuration,
  onDistributeDurations,
  onDeleteSelected,
  onClearSelection,
}: TimelineBulkEditBarProps) {
  if (selectedCount <= 0) return null
  return (
    <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)]/40 px-2 py-1.5">
      <span className="text-[10px] text-[var(--ps-text-dim)]">{selectedCount} selected</span>
      <span className="mx-1 text-[10px] text-[var(--ps-text-dim)]">Duration</span>
      <input
        type="number"
        min={20}
        max={10000}
        step={20}
        defaultValue={500}
        onBlur={(event) => onSetDuration(Number(event.target.value) || 500)}
        className="h-5 w-16 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
        aria-label="Bulk duration in milliseconds"
      />
      <TextBtn onClick={onDistributeDurations}>Distribute</TextBtn>
      <TextBtn onClick={onDeleteSelected}>Delete</TextBtn>
      <TextBtn onClick={onClearSelection}>Clear</TextBtn>
    </div>
  )
}

interface TimelineFrameListProps {
  doc: PsDocument
  frames: TimelineFrame[]
  selectedFrameId: string | null
  selection: Set<string>
  onSelectFrame: (frameId: string, multi: boolean) => void
  onApplyFrame: (frame: TimelineFrame) => void
  onChangeFrame: (frameId: string, patch: Partial<TimelineFrame>) => void
  onDuplicateFrame: (index: number) => void
  onDeleteFrame: (frameId: string) => void
  onMoveFrame: (index: number, delta: number) => void
}

export function TimelineFrameList({
  doc,
  frames,
  selectedFrameId,
  selection,
  onSelectFrame,
  onApplyFrame,
  onChangeFrame,
  onDuplicateFrame,
  onDeleteFrame,
  onMoveFrame,
}: TimelineFrameListProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {frames.length === 0 ? (
        <PanelEmpty text="Capture layer visibility states as animation frames. Opacity, transforms, and styles are preserved." />
      ) : (
        frames.map((frame, index) => (
          <FrameRow
            key={frame.id}
            doc={doc}
            frame={frame}
            nextFrame={frames[index + 1] ?? null}
            index={index}
            total={frames.length}
            isSelected={frame.id === selectedFrameId}
            isMultiSelected={selection.has(frame.id)}
            onSelect={(multi) => onSelectFrame(frame.id, multi)}
            onApply={() => onApplyFrame(frame)}
            onChange={(patch) => onChangeFrame(frame.id, patch)}
            onDuplicate={() => onDuplicateFrame(index)}
            onDelete={() => onDeleteFrame(frame.id)}
            onMoveUp={() => onMoveFrame(index, -1)}
            onMoveDown={() => onMoveFrame(index, +1)}
          />
        ))
      )}
    </div>
  )
}
