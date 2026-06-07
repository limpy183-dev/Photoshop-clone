import { DecorativeMotion } from "@/components/marketing/decorative-motion"
import { EditorShowcase } from "@/components/marketing/editor-showcase"
import { Footer } from "@/components/marketing/footer"
import { Hero } from "@/components/marketing/hero"
import { Limitations } from "@/components/marketing/limitations"
import { Marquee } from "@/components/marketing/marquee"
import { Nav } from "@/components/marketing/nav"
import { NewsletterCta } from "@/components/marketing/newsletter-cta"
import { ToolsGrid } from "@/components/marketing/tools-grid"
import { WorkflowDemos } from "@/components/marketing/workflow-demos"
import { WorkflowSplit } from "@/components/marketing/workflow-split"

/**
 * Marketing landing page.
 *
 * Wrapped in a single `.marketing` root so the scoped tokens & utilities
 * defined in app/globals.css (--mk-ink, .mk-reveal, .mk-pin, etc.) apply
 * here without leaking into the editor route. Server-rendered shell;
 * each content section keeps its SSR markup while decorative motion layers
 * load as client-only dynamic chunks.
 */
export default function MarketingPage() {
  return (
    <div className="marketing relative min-h-screen isolate">
      <DecorativeMotion />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <EditorShowcase />
        <ToolsGrid />
        <WorkflowSplit />
        <WorkflowDemos />
        <Limitations />
        <NewsletterCta />
      </main>
      <Footer />
    </div>
  )
}
