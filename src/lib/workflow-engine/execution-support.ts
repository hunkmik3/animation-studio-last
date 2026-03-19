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

const supportedExecutionNodeTypeSet = new Set<string>(SUPPORTED_EXECUTION_NODE_TYPES)

const UNSUPPORTED_NODE_NOTES: Record<string, string> = {
  'upscale': 'Image upscaling is not enabled in workflow execution yet.',
  'video-compose': 'Video compose is not enabled in workflow execution yet.',
  condition: 'Condition branching is not enabled in workflow execution yet.',
  output: 'Output node execution is not enabled yet. Use downstream node outputs directly.',
}

export function isNodeTypeExecutionSupported(nodeType: string): nodeType is SupportedExecutionNodeType {
  return supportedExecutionNodeTypeSet.has(nodeType)
}

export function getUnsupportedNodeExecutionMessage(nodeType: string): string {
  const note = UNSUPPORTED_NODE_NOTES[nodeType]
  if (note) return note
  return `Node "${nodeType}" is not supported by workflow execution yet.`
}
