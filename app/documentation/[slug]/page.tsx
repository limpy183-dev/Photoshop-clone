import type { Metadata } from "next"
import { notFound } from "next/navigation"
import {
  DOCUMENTATION_SECTIONS,
  DocumentationPage,
  getDocumentationSection,
} from "@/components/photoshop/documentation-page"

type DocumentationRouteProps = {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return DOCUMENTATION_SECTIONS.map((section) => ({ slug: section.slug }))
}

export async function generateMetadata({ params }: DocumentationRouteProps): Promise<Metadata> {
  const { slug } = await params
  const section = getDocumentationSection(slug)

  if (!section) {
    return {
      title: "Documentation - Photoshop Web",
    }
  }

  return {
    title: `${section.title} - Photoshop Web Documentation`,
    description: section.summary,
  }
}

export default async function DocumentationSectionRoute({ params }: DocumentationRouteProps) {
  const { slug } = await params
  const section = getDocumentationSection(slug)

  if (!section) {
    notFound()
  }

  return <DocumentationPage section={section} />
}
