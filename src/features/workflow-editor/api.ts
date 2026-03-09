/* eslint-disable */
// =============================================
// Workflow API client hooks
// =============================================

import type { WorkflowExecutionState, NodeExecutionState } from '@/lib/workflow-engine/types'

interface WorkflowListItem {
    id: string
    name: string
    description: string | null
    isTemplate: boolean
    status: string
    createdAt: string
    updatedAt: string
    _count: { executions: number }
}

interface WorkflowDetail {
    id: string
    name: string
    description: string | null
    isTemplate: boolean
    status: string
    graphData: string
    createdAt: string
    updatedAt: string
    executions: {
        id: string
        status: string
        startedAt: string | null
        completedAt: string | null
        createdAt: string
    }[]
}

// ── List workflows ──
export async function fetchWorkflows(page = 1, pageSize = 20) {
    const res = await fetch(`/api/workflows?page=${page}&pageSize=${pageSize}`)
    if (!res.ok) throw new Error('Failed to fetch workflows')
    return res.json() as Promise<{ workflows: WorkflowListItem[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>
}

// ── Get single workflow ──
export async function fetchWorkflow(id: string) {
    const res = await fetch(`/api/workflows/${id}`)
    if (!res.ok) throw new Error('Failed to fetch workflow')
    return res.json() as Promise<{ workflow: WorkflowDetail }>
}

// ── Create workflow ──
export async function createWorkflow(data: {
    name: string
    description?: string
    graphData: unknown
    projectId?: string
}) {
    const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to create workflow')
    return res.json() as Promise<{ workflow: { id: string; name: string } }>
}

// ── Update workflow ──
export async function updateWorkflow(id: string, data: {
    name?: string
    description?: string
    graphData?: unknown
    status?: string
}) {
    const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to update workflow')
    return res.json() as Promise<{ workflow: { id: string; name: string } }>
}

// ── Delete workflow ──
export async function deleteWorkflow(id: string) {
    const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete workflow')
    return res.json()
}

// ── Execute workflow ──
export async function executeWorkflow(id: string) {
    const res = await fetch(`/api/workflows/${id}/execute`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to execute workflow')
    return res.json() as Promise<{
        execution: {
            id: string
            status: string
            nodeStates: Record<string, NodeExecutionState>
            completedAt: string | null
        }
    }>
}

// ── Push Workflow to Project Workspace ──
export async function pushWorkflowToProject(projectId: string, nodes: any[]): Promise<{ success: boolean; updatedCount: number; message?: string }> {
    const res = await fetch('/api/workflows/push-to-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, nodes }),
    })

    if (!res.ok) {
        let msg = 'Failed to push workflow to project'
        try {
            const err = await res.json()
            msg = err.message || msg
        } catch { }
        throw new Error(msg)
    }

    return res.json()
}
// ── Fetch single panel data (for preview updates) ──
export async function fetchPanel(projectId: string, panelId: string): Promise<{ panel: any }> {
    const res = await fetch(`/api/novel-promotion/${projectId}/panels/${panelId}`)
    if (!res.ok) throw new Error('Failed to fetch panel')
    return res.json()
}
