import type { ComponentType, ReactNode } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Home,
  ImageIcon,
  Keyboard,
  Sparkles,
} from "lucide-react"
import { withBasePath } from "@/lib/base-path"

import { DOCUMENTATION_SECTIONS, FIGURES } from "./documentation-content"
import type { DocumentationFigure, DocumentationSection, FigureFit, ReferenceBlock } from "./documentation-content"

export { DOCUMENTATION_SECTIONS, getDocumentationSection } from "./documentation-content"
export type { DocumentationSection } from "./documentation-content"

export function DocumentationPage({ section }: { section: DocumentationSection }) {
  const activeIndex = DOCUMENTATION_SECTIONS.findIndex((item) => item.slug === section.slug)
  const previous = activeIndex > 0 ? DOCUMENTATION_SECTIONS[activeIndex - 1] : undefined
  const next = activeIndex < DOCUMENTATION_SECTIONS.length - 1 ? DOCUMENTATION_SECTIONS[activeIndex + 1] : undefined
  const Icon = section.icon
  const figures = section.figureIds.map((id) => FIGURES[id])

  return (
    <main className="min-h-screen bg-[var(--ps-chrome)] text-[var(--ps-text)]">
      <div className="grid min-h-screen grid-cols-[280px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="border-r border-[var(--ps-divider)] bg-[#181818] max-lg:border-b max-lg:border-r-0">
          <div className="sticky top-0 flex max-h-screen flex-col bg-[#181818] max-lg:static max-lg:max-h-none">
            <div className="border-b border-[var(--ps-divider)] px-4 py-4">
              <Link href="/" className="inline-flex items-center gap-2 text-[13px] font-semibold text-white">
                <img
                  src={withBasePath("/photoshop-web-logo.svg")}
                  alt="Photoshop web logo"
                  className="h-7 w-7 rounded-sm"
                  draggable={false}
                />
                Documentation
              </Link>
              <p className="mt-2 text-[11px] leading-5 text-[var(--ps-text-dim)]">
                Browser Photoshop guide with feature-specific screenshots, workflows, limits, and handoff notes.
              </p>
            </div>

            <nav aria-label="Documentation sections" className="min-h-0 flex-1 overflow-y-auto p-2 max-lg:flex max-lg:flex-none max-lg:gap-1 max-lg:overflow-x-auto">
              {DOCUMENTATION_SECTIONS.map((item) => {
                const ItemIcon = item.icon
                const active = item.slug === section.slug
                return (
                  <Link
                    key={item.slug}
                    href={`/documentation/${item.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={`mb-1 flex min-h-10 items-center gap-2 rounded-sm px-3 py-2 text-[12px] max-lg:mb-0 max-lg:min-w-max ${
                      active
                        ? "bg-[var(--ps-tool-active)] text-white"
                        : "text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
                    }`}
                  >
                    <ItemIcon className="h-4 w-4 shrink-0" />
                    <span>{item.navLabel}</span>
                  </Link>
                )
              })}
            </nav>

            <div className="grid gap-2 border-t border-[var(--ps-divider)] p-3 max-lg:grid-cols-2">
              <Link
                href="/"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-3 text-[11px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
              >
                <Home className="h-3.5 w-3.5" />
                Home
              </Link>
              <Link
                href="/editor"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-sm bg-[var(--ps-accent)] px-3 text-[11px] text-white hover:bg-[var(--ps-accent-2)]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Open editor
              </Link>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel)] px-6 py-5 max-sm:px-4">
            <div className="mx-auto max-w-[1180px]">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ps-text-dim)]">
                <Link href="/" className="hover:text-[var(--ps-text)]">Home</Link>
                <span>/</span>
                <Link href="/documentation" className="hover:text-[var(--ps-text)]">Documentation</Link>
                <span>/</span>
                <span className="text-[var(--ps-text)]">{section.navLabel}</span>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-accent-2)]">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ps-accent-2)]">{section.eyebrow}</div>
                  <h1 className="mt-1 text-[28px] font-semibold leading-tight text-white max-sm:text-[23px]">{section.title}</h1>
                  <p className="mt-2 max-w-4xl text-[13px] leading-6 text-[var(--ps-text-dim)]">{section.summary}</p>
                </div>
              </div>
            </div>
          </header>

          <div className="mx-auto grid max-w-[1180px] grid-cols-[minmax(0,1fr)_300px] gap-5 px-6 py-6 max-xl:grid-cols-1 max-sm:px-4">
            <div className="min-w-0 space-y-5">
              <DocBlock title="Overview" icon={BookOpen}>
                <div className="space-y-3">
                  {section.overview.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </DocBlock>

              <DocBlock title="Workflows" icon={CheckCircle2}>
                <ReferenceGrid blocks={section.workflows} ordered />
              </DocBlock>

              <DocBlock title="Detailed reference" icon={ImageIcon}>
                <ReferenceGrid blocks={section.reference} />
              </DocBlock>

              <DocBlock title="Checklist" icon={Keyboard}>
                <ReferenceGrid blocks={section.checklists} />
              </DocBlock>

              <DocBlock title="Screenshot reference" icon={ImageIcon}>
                <div className="space-y-4">
                  {figures.map((figure) => (
                    <DocumentationFigureCard key={figure.src} figure={figure} />
                  ))}
                </div>
              </DocBlock>

              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                {previous ? (
                  <Link
                    href={`/documentation/${previous.slug}`}
                    className="flex min-h-16 items-center gap-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-3 text-[12px] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-panel-2)]"
                  >
                    <ArrowLeft className="h-4 w-4 text-[var(--ps-accent-2)]" />
                    <span>
                      <span className="block text-[10px] uppercase tracking-[0.12em] text-[var(--ps-text-dim)]">Previous</span>
                      <span className="font-medium text-white">{previous.navLabel}</span>
                    </span>
                  </Link>
                ) : (
                  <div className="rounded-sm border border-[var(--ps-divider)] bg-[#151515] p-3 text-[11px] text-[var(--ps-text-dim)]">
                    This is the first documentation page.
                  </div>
                )}
                {next ? (
                  <Link
                    href={`/documentation/${next.slug}`}
                    className="flex min-h-16 items-center justify-end gap-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-3 text-right text-[12px] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-panel-2)]"
                  >
                    <span>
                      <span className="block text-[10px] uppercase tracking-[0.12em] text-[var(--ps-text-dim)]">Next</span>
                      <span className="font-medium text-white">{next.navLabel}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-[var(--ps-accent-2)]" />
                  </Link>
                ) : (
                  <div className="rounded-sm border border-[var(--ps-divider)] bg-[#151515] p-3 text-right text-[11px] text-[var(--ps-text-dim)]">
                    This is the final documentation page.
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-4">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">On this page</div>
                <div className="grid gap-1 text-[11px]">
                  {["Overview", "Workflows", "Detailed reference", "Checklist", "Screenshot reference"].map((item) => (
                    <a
                      key={item}
                      href={`#${toAnchor(item)}`}
                      className="rounded-sm px-2 py-1.5 text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
                    >
                      {item}
                    </a>
                  ))}
                </div>
              </div>

              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-4">
                <div className="mb-2 text-[12px] font-semibold text-white">Page coverage</div>
                <dl className="grid gap-2 text-[11px] text-[var(--ps-text-dim)]">
                  <div className="flex items-center justify-between gap-3">
                    <dt>Workflow blocks</dt>
                    <dd className="text-white">{section.workflows.length}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>Reference blocks</dt>
                    <dd className="text-white">{section.reference.length}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>Documented screenshots</dt>
                    <dd className="text-white">{figures.length}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-4">
                <div className="mb-2 text-[12px] font-semibold text-white">Screenshot rule</div>
                <p className="text-[11px] leading-5 text-[var(--ps-text-dim)]">
                  Each screenshot is kept in a constrained frame and paired with text that explains what is visible,
                  when to use the feature, and which details should be checked before relying on the workflow.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  )
}

function DocBlock({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: ComponentType<{ className?: string }>
  children: ReactNode
}) {
  return (
    <section id={toAnchor(title)} className="scroll-mt-4 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[var(--ps-accent-2)]" />
        <h2 className="text-[17px] font-semibold text-white">{title}</h2>
      </div>
      <div className="text-[12px] leading-6 text-[var(--ps-text-dim)]">{children}</div>
    </section>
  )
}

function ReferenceGrid({ blocks, ordered = false }: { blocks: ReferenceBlock[]; ordered?: boolean }) {
  const ListTag = ordered ? "ol" : "div"
  return (
    <ListTag className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
      {blocks.map((block, index) => (
        <ReferenceCard key={block.title} block={block} index={ordered ? index + 1 : undefined} />
      ))}
    </ListTag>
  )
}

function ReferenceCard({ block, index }: { block: ReferenceBlock; index?: number }) {
  const content = (
    <>
      <div className="flex items-start gap-2">
        {index ? (
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[10px] text-[var(--ps-accent-2)]">
            {index}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold leading-5 text-white">{block.title}</h3>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ps-text-dim)]">{block.body}</p>
        </div>
      </div>
      {block.bullets?.length ? (
        <ul className="mt-3 space-y-1.5 text-[11px] leading-5 text-[var(--ps-text-dim)]">
          {block.bullets.map((bullet) => (
            <li key={bullet} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2">
              <CheckCircle2 className="mt-1 h-3 w-3 text-[var(--ps-accent-2)]" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )

  if (index) {
    return <li className="rounded-sm border border-[var(--ps-divider)] bg-[#151515] p-3">{content}</li>
  }

  return <div className="rounded-sm border border-[var(--ps-divider)] bg-[#151515] p-3">{content}</div>
}

function DocumentationFigureCard({ figure }: { figure: DocumentationFigure }) {
  return (
    <figure data-testid="documentation-figure" className="overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[#101010]">
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] gap-0 max-lg:grid-cols-1">
        <div className="flex items-center justify-center border-r border-[var(--ps-divider)] bg-[#080808] p-3 max-lg:border-b max-lg:border-r-0">
          <img
            data-testid="documentation-figure-image"
            src={withBasePath(figure.src)}
            alt={figure.alt}
            loading="lazy"
            className={`h-auto w-auto max-w-full object-contain ${figureHeightClass[figure.fit]}`}
          />
        </div>
        <figcaption className="p-4">
          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[var(--ps-accent-2)]">Screenshot</div>
          <h3 className="text-[15px] font-semibold text-white">{figure.title}</h3>
          <p className="mt-2 text-[12px] leading-5 text-[var(--ps-text-dim)]">{figure.caption}</p>
          <FigureList title="This screenshot shows" items={figure.shows} />
          <FigureList title="How to use it" items={figure.usage} />
          <FigureList title="Details to check" items={figure.details} />
        </figcaption>
      </div>
    </figure>
  )
}

function FigureList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <h4 className="text-[11px] font-semibold text-white">{title}</h4>
      <ul className="mt-1.5 space-y-1.5 text-[11px] leading-5 text-[var(--ps-text-dim)]">
        {items.map((item) => (
          <li key={item} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--ps-accent-2)]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const figureHeightClass: Record<FigureFit, string> = {
  wide: "max-h-[360px]",
  dialog: "max-h-[390px]",
  panel: "max-h-[330px]",
  tall: "max-h-[400px]",
}

function toAnchor(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}
