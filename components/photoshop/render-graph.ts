import type { Layer, PsDocument } from "./types"

export type RenderGraphNodeKind = "document" | "layer" | "mask" | "smart-filter" | "adjustment" | "output"

export interface RenderGraphNode {
  id: string
  kind: RenderGraphNodeKind
  label: string
  layerId?: string
  enabled: boolean
  inputs: string[]
}

export interface DocumentRenderGraph {
  documentId: string
  width: number
  height: number
  nodes: RenderGraphNode[]
  outputNodeId: string
}

function layerNodeId(layer: Layer) {
  return `layer:${layer.id}`
}

export function createDocumentRenderGraph(doc: PsDocument): DocumentRenderGraph {
  const nodes: RenderGraphNode[] = [
    {
      id: `document:${doc.id}`,
      kind: "document",
      label: doc.name,
      enabled: true,
      inputs: [],
    },
  ]
  let previous = `document:${doc.id}`
  for (const layer of doc.layers) {
    const layerId = layerNodeId(layer)
    nodes.push({
      id: layerId,
      kind: "layer",
      label: layer.name,
      layerId: layer.id,
      enabled: layer.visible !== false,
      inputs: [previous],
    })
    let current = layerId
    if (layer.mask) {
      const maskId = `mask:${layer.id}`
      nodes.push({
        id: maskId,
        kind: "mask",
        label: `${layer.name} Mask`,
        layerId: layer.id,
        enabled: true,
        inputs: [current],
      })
      current = maskId
    }
    for (const filter of layer.smartFilters ?? []) {
      const filterId = `smart-filter:${layer.id}:${filter.id}`
      nodes.push({
        id: filterId,
        kind: "smart-filter",
        label: filter.name,
        layerId: layer.id,
        enabled: filter.enabled !== false,
        inputs: [current],
      })
      current = filterId
    }
    if (layer.kind === "adjustment" && layer.adjustment) {
      const adjustmentId = `adjustment:${layer.id}`
      nodes.push({
        id: adjustmentId,
        kind: "adjustment",
        label: `${layer.name} Adjustment`,
        layerId: layer.id,
        enabled: layer.visible !== false,
        inputs: [current],
      })
      current = adjustmentId
    }
    previous = current
  }
  const outputNodeId = `output:${doc.id}`
  nodes.push({
    id: outputNodeId,
    kind: "output",
    label: "Document Composite",
    enabled: true,
    inputs: [previous],
  })
  return {
    documentId: doc.id,
    width: doc.width,
    height: doc.height,
    nodes,
    outputNodeId,
  }
}
