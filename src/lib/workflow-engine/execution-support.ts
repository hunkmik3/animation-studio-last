const SUPPORTED_EXECUTION_NODE_TYPES = [
  'text-input',
  'llm-prompt',
  'character-extract',
  'scene-extract',
  'storyboard',
  'image-generate',
  'video-generate',
  'voice-synthesis',
] as const

type SupportedExecutionNodeType = (typeof SUPPORTED_EXECUTION_NODE_TYPES)[number]
const HYBRID_EXECUTION_NODE_TYPES = [
  'image-generate',
  'video-generate',
  'voice-synthesis',
] as const
type HybridExecutionNodeType = (typeof HYBRID_EXECUTION_NODE_TYPES)[number]
const WORKSPACE_LINKED_NODE_TYPES = [] as const
type WorkspaceLinkedNodeType = (typeof WORKSPACE_LINKED_NODE_TYPES)[number]

const supportedExecutionNodeTypeSet = new Set<string>(SUPPORTED_EXECUTION_NODE_TYPES)
const hybridExecutionNodeTypeSet = new Set<string>(HYBRID_EXECUTION_NODE_TYPES)
const workspaceLinkedNodeTypeSet = new Set<string>(WORKSPACE_LINKED_NODE_TYPES)

const UNSUPPORTED_NODE_NOTES: Record<string, string> = {
  'upscale': 'Image upscaling is not enabled in workflow execution yet.',
  'video-compose': 'Video compose is not enabled in workflow execution yet.',
  condition: 'Condition branching is not enabled in workflow execution yet.',
  output: 'Output node execution is not enabled yet. Use downstream node outputs directly.',
}

export function isNodeTypeExecutionSupported(nodeType: string): nodeType is SupportedExecutionNodeType {
  return supportedExecutionNodeTypeSet.has(nodeType)
}

export function isNodeTypeHybridExecution(nodeType: string): nodeType is HybridExecutionNodeType {
  return hybridExecutionNodeTypeSet.has(nodeType)
}

export function isNodeTypeWorkspaceLinked(nodeType: string): nodeType is WorkspaceLinkedNodeType {
  return workspaceLinkedNodeTypeSet.has(nodeType)
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function usesWorkspaceExecutionContext(params: {
  nodeType: string
  panelId?: string | null
  config?: Record<string, unknown>
}): boolean {
  if (params.nodeType === 'image-generate' || params.nodeType === 'video-generate') {
    return hasNonEmptyString(params.panelId)
  }

  if (params.nodeType === 'voice-synthesis') {
    const config = toRecord(params.config)
    return hasNonEmptyString(config.episodeId) && hasNonEmptyString(config.lineId)
  }

  return isNodeTypeWorkspaceLinked(params.nodeType)
}

export function getUnsupportedNodeExecutionMessage(nodeType: string): string {
  const note = UNSUPPORTED_NODE_NOTES[nodeType]
  if (note) return note
  return `Node "${nodeType}" is not supported by workflow execution yet.`
}
