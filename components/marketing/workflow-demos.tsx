/**
 * Task-oriented workflow demos for the marketing page.
 *
 * Where WorkflowSplit sells the editor's breadth (stack → adjust → mask →
 * export), this section sells real end-to-end jobs a user actually comes to do,
 * each framed as a concrete before → after transformation. Server-rendered;
 * purely presentational.
 */

const WORKFLOW_DEMOS = [
  {
    id: "remove-background",
    title: "Remove background",
    before: "A product shot on a busy, distracting backdrop.",
    after: "A clean cutout on transparency, ready to drop anywhere.",
    steps: "Select Subject → Select & Mask → refine edge → export transparent PNG.",
  },
  {
    id: "retouch-portrait",
    title: "Retouch portrait",
    before: "Raw portrait with blemishes and uneven skin tones.",
    after: "Natural, polished skin with dodge-and-burn contouring intact.",
    steps: "Spot healing → frequency-style smoothing → dodge/burn → sharpen.",
  },
  {
    id: "export-social-image",
    title: "Export social image",
    before: "A full-resolution edit that's the wrong shape for the feed.",
    after: "A correctly cropped, safe-dimension post in WebP and PNG.",
    steps: "Crop to preset → add text → export WebP/PNG/JPEG safe sizes.",
  },
  {
    id: "prepare-print-preview",
    title: "Prepare print preview",
    before: "An RGB screen file with no print intent or marks.",
    after: "A resized, soft-proofed layout with print marks and metadata.",
    steps: "Resize → proof setup → metadata → print marks → preflight.",
  },
  {
    id: "batch-resize-watermark",
    title: "Batch resize with watermark",
    before: "A folder of mixed-size images with no branding.",
    after: "Uniformly resized, watermarked exports with consistent metadata.",
    steps: "Folder input → resize rules → watermark → metadata → export.",
  },
  {
    id: "open-psd-inspect",
    title: "Open PSD and inspect compatibility",
    before: "A layered PSD with effects, text, and smart objects.",
    after: "An honest compatibility report of what's preserved vs. flattened.",
    steps: "Open PSD → read compatibility report → fix-before-export options.",
  },
] as const

export function WorkflowDemos() {
  return (
    <section
      id="workflows"
      data-testid="marketing-workflow-demos"
      className="relative border-t border-[var(--mk-rule)] py-28 md:py-40"
    >
      <div className="mx-auto max-w-[1480px] px-6 md:px-10 lg:px-14">
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mk-rust)]">
            §05 · Real workflows
          </span>
          <span className="h-px flex-1 bg-[var(--mk-rule)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-paper-dim)]">
            Before → After
          </span>
        </div>

        <h2 className="mt-10 max-w-[24ch] font-display text-[2.6rem] leading-[0.98] tracking-[-0.02em] md:text-[4.5rem]">
          Not just tools. <span className="italic text-[var(--mk-blue)]">Finished jobs.</span>
        </h2>
        <p className="mt-6 max-w-[60ch] text-sm leading-relaxed text-[var(--mk-paper-dim)]">
          Every feature exists to complete a task. These are the end-to-end flows the
          editor is built to carry from a rough start to a deliverable result — entirely
          in the browser.
        </p>

        <ul className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW_DEMOS.map((demo, index) => (
            <li
              key={demo.id}
              data-testid={`marketing-workflow-${demo.id}`}
              className="flex flex-col rounded-md border border-[var(--mk-rule-strong)] bg-[var(--mk-ink-3)] p-6 shadow-[0_24px_60px_-32px_rgba(0,0,0,0.7)]"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mk-blue-soft)]">
                Workflow {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 font-display text-[1.7rem] leading-tight italic">
                {demo.title}
              </h3>

              <div className="mt-5 grid grid-cols-1 gap-3">
                <div className="rounded-sm border border-[var(--mk-rule)] bg-[var(--mk-ink-2)] p-3">
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--mk-rust)]">
                    Before
                  </span>
                  <p className="mt-1.5 text-[13px] leading-snug text-[var(--mk-paper-dim)]">
                    {demo.before}
                  </p>
                </div>
                <div className="rounded-sm border border-[var(--mk-rule)] bg-[var(--mk-ink-2)] p-3">
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--mk-blue-soft)]">
                    After
                  </span>
                  <p className="mt-1.5 text-[13px] leading-snug text-[var(--mk-paper)]">
                    {demo.after}
                  </p>
                </div>
              </div>

              <p className="mt-5 border-t border-[var(--mk-rule)] pt-4 font-mono text-[11px] leading-relaxed text-[var(--mk-paper-dim)]">
                {demo.steps}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
