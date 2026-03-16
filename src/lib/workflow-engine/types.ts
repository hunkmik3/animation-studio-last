// =============================================
// Workflow Engine — Core Type Definitions
// =============================================

/** Port data types that can flow between nodes */
export type PortDataType = 'text' | 'image' | 'video' | 'audio' | 'json' | 'characters' | 'scenes' | 'panels' | 'any'

/** Node categories for the palette sidebar */
export type NodeCategory = 'input' | 'ai' | 'media' | 'transform' | 'output'

/** Execution status for a node or workflow */
export type ExecutionStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

// ── Port definitions ──

export interface PortDefinition {
  id: string
  name: string
  type: PortDataType
  required: boolean
  multiple?: boolean
  description?: string
}

// ── Config field definitions (user-editable settings for each node) ──

export interface ConfigFieldDefinition {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'number' | 'slider' | 'model-picker' | 'voice-picker' | 'toggle'
  placeholder?: string
  defaultValue?: string | number | boolean
  options?: { label: string; value: string }[]
  required?: boolean
  min?: number
  max?: number
  step?: number
}

// ── Node type definition (registry entry) ──

export interface WorkflowNodeTypeDefinition {
  type: string
  title: string
  description: string
  icon: string        // lucide icon name
  category: NodeCategory
  color: string       // CSS color for node header
  inputs: PortDefinition[]
  outputs: PortDefinition[]
  configFields: ConfigFieldDefinition[]
  defaultConfig: Record<string, unknown>
}

// ── Serialized workflow graph (stored in DB) ──

export interface SerializedNode {
  id: string
  type: string
  position: { x: number; y: number }
  config: Record<string, unknown>
}

export interface SerializedEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

export interface SerializedWorkflow {
  nodes: SerializedNode[]
  edges: SerializedEdge[]
  viewport?: { x: number; y: number; zoom: number }
}

// ── Runtime execution context ──

export interface NodeExecutionContext {
  nodeId: string
  nodeType: string
  config: Record<string, unknown>
  inputs: Record<string, unknown>
  projectId?: string
  userId?: string
  locale?: string
  onProgress?: (progress: number, message?: string) => void
}

export interface NodeExecutionResult {
  outputs: Record<string, unknown>
  metadata?: Record<string, unknown>
}

// ── Node state during execution ──

export interface NodeExecutionState {
  status: ExecutionStatus
  progress: number
  message?: string
  outputs?: Record<string, unknown>
  error?: string
  startedAt?: string
  completedAt?: string
}

export interface WorkflowExecutionState {
  status: ExecutionStatus
  nodeStates: Record<string, NodeExecutionState>
  startedAt?: string
  completedAt?: string
  error?: string
}
