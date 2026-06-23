export type LearningIndexType = "command" | "doc" | "filter" | "panel" | "tool" | "workflow"

export interface LearningIndexItem {
  id: string
  type: LearningIndexType
  title: string
  category: string
  description: string
  keywords: string[]
  action?: {
    kind: "event" | "panel" | "filter"
    target: string
    detail?: unknown
  }
}
