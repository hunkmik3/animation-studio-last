import { describe, expect, it } from 'vitest'
import {
  buildWorkflowDashboardStats,
  filterWorkflows,
  shouldRenderWorkflowEditor,
} from '@/features/workflow-editor/workflow-home-helpers'
import type { WorkflowListItem } from '@/features/workflow-editor/api'

const WORKFLOWS: WorkflowListItem[] = [
  {
    id: 'wf_1',
    name: 'Story Pipeline',
    description: 'Classic storyboard workflow',
    isTemplate: false,
    status: 'draft',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    _count: { executions: 3 },
  },
  {
    id: 'wf_2',
    name: 'Template Flow',
    description: 'Reusable template for onboarding',
    isTemplate: true,
    status: 'published',
    createdAt: '2026-03-19T00:00:00.000Z',
    updatedAt: '2026-03-19T00:00:00.000Z',
    _count: { executions: 7 },
  },
  {
    id: 'wf_3',
    name: 'Archive Test',
    description: 'Old experiment',
    isTemplate: false,
    status: 'archived',
    createdAt: '2026-03-18T00:00:00.000Z',
    updatedAt: '2026-03-18T00:00:00.000Z',
    _count: { executions: 0 },
  },
]

describe('workflow home helpers', () => {
  it('filters workflows by name, description, status, and template marker', () => {
    expect(filterWorkflows(WORKFLOWS, 'story')).toEqual([WORKFLOWS[0]])
    expect(filterWorkflows(WORKFLOWS, 'onboarding')).toEqual([WORKFLOWS[1]])
    expect(filterWorkflows(WORKFLOWS, 'archived')).toEqual([WORKFLOWS[2]])
    expect(filterWorkflows(WORKFLOWS, 'template')).toEqual([WORKFLOWS[1]])
  })

  it('builds dashboard stats from workflow collection', () => {
    expect(buildWorkflowDashboardStats(WORKFLOWS)).toEqual({
      total: 3,
      templates: 1,
      drafts: 1,
      published: 1,
      archived: 1,
      totalRuns: 10,
    })
  })

  it('renders the editor only when explicit editor context is present', () => {
    expect(shouldRenderWorkflowEditor({
      workflowId: null,
      projectId: null,
      editor: null,
    })).toBe(false)

    expect(shouldRenderWorkflowEditor({
      workflowId: 'wf_1',
      projectId: null,
      editor: null,
    })).toBe(true)

    expect(shouldRenderWorkflowEditor({
      workflowId: null,
      projectId: 'project_1',
      editor: null,
    })).toBe(true)

    expect(shouldRenderWorkflowEditor({
      workflowId: null,
      projectId: null,
      editor: '1',
    })).toBe(true)
  })
})
