import type { Node } from '@xyflow/react'
import { resolvePanelIdFromNode } from './execution-contract'

export type WorkflowBoundaryKind = 'workflow-native' | 'workspace-linked'

export interface WorkflowBoundaryDescriptor {
  kind: WorkflowBoundaryKind
  summary: string
}

export interface WorkflowExecutionContextIssue {
  nodeId: string
  nodeType: string
  label: string
  missing: string[]
  message: string
}

export function getWorkspaceContextActionHint(nodeType: string): string {
  if (nodeType === 'image-generate' || nodeType === 'video-generate') {
    return 'Select a panel in Workspace Binding or click Pull from Workspace.'
  }
  if (nodeType === 'voice-synthesis') {
    return 'Select episode and line in Workspace Binding or click Pull from Workspace.'
  }
  return 'Open node settings and complete required workspace context.'
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readNodeType(nodeData: Record<string, unknown>): string {
  const raw = nodeData.nodeType
  return typeof raw === 'string' ? raw.trim() : ''
}

function readNodeLabel(node: Node, nodeData: Record<string, unknown>): string {
  const raw = nodeData.label
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
  return node.id
}

function readConfigString(config: Record<string, unknown>, key: string): string {
  const raw = config[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

export function getWorkflowBoundaryDescriptor(nodeType: string): WorkflowBoundaryDescriptor {
  if (nodeType === 'image-generate') {
    return {
      kind: 'workspace-linked',
      summary: 'Requires linked workspace panel context.',
    }
  }
  if (nodeType === 'video-generate') {
    return {
      kind: 'workspace-linked',
      summary: 'Requires linked workspace panel with generated image.',
    }
  }
  if (nodeType === 'voice-synthesis') {
    return {
      kind: 'workspace-linked',
      summary: 'Requires workspace episode + voice line context.',
    }
  }
  return {
    kind: 'workflow-native',
    summary: 'Runs from workflow graph inputs/config without workspace linkage.',
  }
}

export function resolveWorkflowNodeContextIssue(params: {
  nodeId: string
  nodeType: string
  nodeData: Record<string, unknown>
  label?: string
}): WorkflowExecutionContextIssue | null {
  const { nodeId, nodeType, nodeData } = params
  const label = params.label && params.label.trim().length > 0 ? params.label : nodeId

  if (nodeType === 'image-generate' || nodeType === 'video-generate') {
    const panelId = resolvePanelIdFromNode(nodeId, nodeData)
    if (!panelId) {
      return {
        nodeId,
        nodeType,
        label,
        missing: ['panelId'],
        message: `${label} requires workspace panel linkage. Select a panel in Workspace Binding or Pull from Workspace before running.`,
      }
    }
    return null
  }

  if (nodeType === 'voice-synthesis') {
    const config = toRecord(nodeData.config)
    const episodeId = readConfigString(config, 'episodeId')
    const lineId = readConfigString(config, 'lineId')
    const missing: string[] = []
    if (!episodeId) missing.push('episodeId')
    if (!lineId) missing.push('lineId')
    if (missing.length > 0) {
      return {
        nodeId,
        nodeType,
        label,
        missing,
        message: `${label} requires ${missing.join(', ')} to map workflow run into workspace voice-line context. Bind episode/line in Workspace Binding before running.`,
      }
    }
    return null
  }

  return null
}

export function collectWorkflowExecutionContextIssues(nodes: Node[]): WorkflowExecutionContextIssue[] {
  const issues: WorkflowExecutionContextIssue[] = []

  for (const node of nodes) {
    if (node.type === 'workflowGroup' || node.hidden) continue
    const nodeData = toRecord(node.data)
    const nodeType = readNodeType(nodeData)
    if (!nodeType) continue
    const issue = resolveWorkflowNodeContextIssue({
      nodeId: node.id,
      nodeType,
      nodeData,
      label: readNodeLabel(node, nodeData),
    })
    if (issue) issues.push(issue)
  }

  return issues
}
