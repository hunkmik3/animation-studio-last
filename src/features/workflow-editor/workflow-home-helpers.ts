import type { WorkflowListItem } from '@/features/workflow-editor/api'

export interface WorkflowDashboardStats {
  total: number
  templates: number
  drafts: number
  published: number
  archived: number
  totalRuns: number
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase()
}

export function filterWorkflows(
  workflows: ReadonlyArray<WorkflowListItem>,
  query: string,
): WorkflowListItem[] {
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return [...workflows]

  return workflows.filter((workflow) => {
    const haystacks = [
      workflow.name,
      workflow.description || '',
      workflow.status,
      workflow.isTemplate ? 'template' : 'workflow',
    ]

    return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery))
  })
}

export function buildWorkflowDashboardStats(
  workflows: ReadonlyArray<WorkflowListItem>,
): WorkflowDashboardStats {
  return workflows.reduce<WorkflowDashboardStats>((stats, workflow) => {
    stats.total += 1
    stats.totalRuns += workflow._count.executions

    if (workflow.isTemplate) stats.templates += 1
    if (workflow.status === 'draft') stats.drafts += 1
    if (workflow.status === 'published') stats.published += 1
    if (workflow.status === 'archived') stats.archived += 1

    return stats
  }, {
    total: 0,
    templates: 0,
    drafts: 0,
    published: 0,
    archived: 0,
    totalRuns: 0,
  })
}

export function shouldRenderWorkflowEditor(params: {
  workflowId: string | null
  projectId: string | null
  editor: string | null
}): boolean {
  return Boolean(
    (params.workflowId && params.workflowId.trim().length > 0)
    || (params.projectId && params.projectId.trim().length > 0)
    || (params.editor && params.editor.trim().length > 0),
  )
}
