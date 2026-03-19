import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  collectWorkflowExecutionContextIssues,
  getWorkspaceContextActionHint,
  getWorkflowBoundaryDescriptor,
  resolveWorkflowNodeContextIssue,
} from '@/features/workflow-editor/workspace-boundary'

function makeNode(params: {
  id: string
  nodeType: string
  data?: Record<string, unknown>
  type?: string
  hidden?: boolean
}): Node {
  return {
    id: params.id,
    type: params.type || 'workflowNode',
    hidden: params.hidden,
    position: { x: 0, y: 0 },
    data: {
      nodeType: params.nodeType,
      label: params.id,
      config: {},
      ...(params.data || {}),
    },
  }
}

describe('workflow workspace boundary contract', () => {
  it('classifies workspace-linked and workflow-native node boundaries', () => {
    expect(getWorkflowBoundaryDescriptor('text-input').kind).toBe('workflow-native')
    expect(getWorkflowBoundaryDescriptor('image-generate').kind).toBe('workspace-linked')
    expect(getWorkflowBoundaryDescriptor('voice-synthesis').kind).toBe('workspace-linked')
  })

  it('returns actionable context hints for workspace-linked node types', () => {
    expect(getWorkspaceContextActionHint('image-generate')).toContain('Select a panel')
    expect(getWorkspaceContextActionHint('video-generate')).toContain('Select a panel')
    expect(getWorkspaceContextActionHint('voice-synthesis')).toContain('Select episode and line')
  })

  it('detects missing workspace panel context for media nodes', () => {
    const issue = resolveWorkflowNodeContextIssue({
      nodeId: 'image_node_1',
      nodeType: 'image-generate',
      nodeData: {
        nodeType: 'image-generate',
        label: 'Image Node',
        config: {},
      },
      label: 'Image Node',
    })

    expect(issue).toEqual(expect.objectContaining({
      nodeId: 'image_node_1',
      nodeType: 'image-generate',
      missing: ['panelId'],
    }))
  })

  it('detects missing episode/line mapping for voice nodes', () => {
    const issue = resolveWorkflowNodeContextIssue({
      nodeId: 'voice_1',
      nodeType: 'voice-synthesis',
      nodeData: {
        nodeType: 'voice-synthesis',
        label: 'Voice Node',
        config: { episodeId: 'episode_1', lineId: '' },
      },
      label: 'Voice Node',
    })

    expect(issue).toEqual(expect.objectContaining({
      nodeType: 'voice-synthesis',
      missing: ['lineId'],
    }))
  })

  it('collects only actionable context issues from execution nodes', () => {
    const nodes: Node[] = [
      makeNode({ id: 'n_text', nodeType: 'text-input' }),
      makeNode({ id: 'n_img_missing', nodeType: 'image-generate' }),
      makeNode({
        id: 'n_voice_ok',
        nodeType: 'voice-synthesis',
        data: { config: { episodeId: 'ep_1', lineId: 'line_1' } },
      }),
      makeNode({ id: 'group_1', nodeType: 'workflowGroup', type: 'workflowGroup' }),
    ]

    const issues = collectWorkflowExecutionContextIssues(nodes)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.nodeId).toBe('n_img_missing')
  })
})
