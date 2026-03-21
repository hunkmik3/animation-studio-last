import type { Node } from '@xyflow/react'
import { resolvePanelIdFromNode } from './execution-contract'
import {
  isNodeTypeHybridExecution,
  isNodeTypeWorkspaceLinked,
  usesWorkspaceExecutionContext,
} from '@/lib/workflow-engine/execution-support'

export type WorkflowBoundaryKind = 'workflow-native' | 'workspace-linked' | 'hybrid'

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
    return 'Optional: select a panel in Workspace Binding or click Pull from Workspace to write results back into the project.'
  }
  if (nodeType === 'voice-synthesis') {
    return 'Optional: select both episode and line in Workspace Binding to bridge this node into project voice-line records.'
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
      kind: 'hybrid',
      summary: 'Runs standalone from workflow inputs, or can optionally bind to a workspace panel.',
    }
  }
  if (nodeType === 'video-generate') {
    return {
      kind: 'hybrid',
      summary: 'Runs standalone from workflow inputs, or can optionally bind to a workspace panel.',
    }
  }
  if (nodeType === 'voice-synthesis') {
    return {
      kind: 'hybrid',
      summary: 'Runs standalone from workflow text, or can optionally bind to a workspace voice line.',
    }
  }
  if (isNodeTypeHybridExecution(nodeType)) {
    return {
      kind: 'hybrid',
      summary: 'Runs standalone by default and supports optional workspace bridging.',
    }
  }
  if (isNodeTypeWorkspaceLinked(nodeType)) {
    return {
      kind: 'workspace-linked',
      summary: 'Requires linked workspace context.',
    }
  }
  return {
    kind: 'workflow-native',
    summary: 'Runs from workflow graph inputs/config without workspace linkage.',
  }
}

export function resolveWorkflowRuntimeBoundaryDescriptor(params: {
  nodeId: string
  nodeType: string
  nodeData: Record<string, unknown>
}): WorkflowBoundaryDescriptor {
  if (isNodeTypeHybridExecution(params.nodeType)) {
    const usesWorkspaceContext = usesWorkspaceExecutionContext({
      nodeType: params.nodeType,
      panelId: resolvePanelIdFromNode(params.nodeId, params.nodeData),
      config: toRecord(params.nodeData.config),
    })

    if (usesWorkspaceContext) {
      if (params.nodeType === 'voice-synthesis') {
        return {
          kind: 'workspace-linked',
          summary: 'Currently bridged into workspace episode + voice-line records.',
        }
      }

      return {
        kind: 'workspace-linked',
        summary: 'Currently bridged into workspace panel records.',
      }
    }

    return {
      kind: 'workflow-native',
      summary: 'Currently running standalone from workflow graph inputs/config.',
    }
  }

  return getWorkflowBoundaryDescriptor(params.nodeType)
}

export function resolveWorkflowNodeContextIssue(params: {
  nodeId: string
  nodeType: string
  nodeData: Record<string, unknown>
  label?: string
}): WorkflowExecutionContextIssue | null {
  const { nodeId, nodeType, nodeData } = params
  const label = params.label && params.label.trim().length > 0 ? params.label : nodeId

  if (nodeType === 'voice-synthesis') {
    const config = toRecord(nodeData.config)
    const episodeId = readConfigString(config, 'episodeId')
    const lineId = readConfigString(config, 'lineId')
    const hasEpisodeId = episodeId.length > 0
    const hasLineId = lineId.length > 0

    if (hasEpisodeId === hasLineId) {
      return null
    }

    const missing: string[] = []
    if (!hasEpisodeId) missing.push('episodeId')
    if (!hasLineId) missing.push('lineId')

    return {
      nodeId,
      nodeType,
      label,
      missing,
      message: `${label} has a partial workspace voice binding. Set both episodeId and lineId or clear both fields to run standalone.`,
    }
  }

  if (isNodeTypeWorkspaceLinked(nodeType)) {
    return {
      nodeId,
      nodeType,
      label,
      missing: ['workspaceContext'],
      message: `${label} requires explicit workspace context before running.`,
    }
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
