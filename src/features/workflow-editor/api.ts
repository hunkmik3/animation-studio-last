// =============================================
// Workflow API client hooks
// =============================================

import type { NodeExecutionState } from '@/lib/workflow-engine/types'
import type { WorkflowContinuationMarker } from '@/lib/workflow-engine/continuation'
import type { WorkflowExecutionCursor, WorkflowExecutionLease } from '@/lib/workflow-engine/execution-authority'

export interface WorkflowListItem {
    id: string
    name: string
    description: string | null
    isTemplate: boolean
    status: string
    createdAt: string
    updatedAt: string
    _count: { executions: number }
}

export interface WorkflowDetail {
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
    if (!res.ok) {
        let message = 'Workflow execution route is unavailable'
        try {
            const payload = await res.json()
            if (typeof payload?.message === 'string' && payload.message.trim().length > 0) {
                message = payload.message
            }
        } catch {
            // ignore parse error and keep default message
        }
        throw new Error(message)
    }
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
export interface WorkflowAssetMergeResponse {
    characters: {
        inputCount: number
        updateHintCount: number
        created: number
        updated: number
        skipped: number
        matched: number
    }
    locations: {
        inputCount: number
        created: number
        updated: number
        skipped: number
        matched: number
        createdDescriptions: number
    }
}

export async function pushWorkflowToProject(
    projectId: string,
    nodes: unknown[],
    nodeOutputs: Record<string, Record<string, unknown>>,
    nodeExecutionStates: Record<string, NodeExecutionState>,
): Promise<{
    success: boolean
    updatedCount: number
    panelPromptUpdates: number
    panelPromptUpdatesRequested: number
    panelPromptUpdatesSkipped: number
    applyAssetMerge: boolean
    assetMerge: WorkflowAssetMergeResponse
    warnings?: string[]
    message?: string
}> {
    const res = await fetch('/api/workflows/push-to-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            projectId,
            nodes,
            nodeOutputs,
            nodeExecutionStates,
            applyAssetMerge: true,
        }),
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
// ── Persist node output to execution (called after each node completes) ──
export async function persistNodeOutput(workflowId: string, data: {
    executionId?: string
    nodeId: string
    outputs?: Record<string, unknown>
    configSnapshot?: string
    nodeState?: NodeExecutionState
    status?: string
    continuation?: WorkflowContinuationMarker | null
    cursor?: WorkflowExecutionCursor | null
    leaseId?: string
}) {
    const res = await fetch(`/api/workflows/${workflowId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
    if (!res.ok) {
        let message = 'Failed to persist node output'
        let reason: string | null = null
        try {
            const payload = await res.json()
            if (typeof payload?.message === 'string' && payload.message.trim().length > 0) {
                message = payload.message
            }
            if (typeof payload?.reason === 'string' && payload.reason.trim().length > 0) {
                reason = payload.reason
            }
        } catch {
            // ignore payload parse error
        }

        const authorityConflict = res.status === 409
        const error = new Error(authorityConflict ? `EXECUTION_AUTHORITY_CONFLICT: ${message}` : message) as Error & {
            status?: number
            reason?: string | null
            authorityConflict?: boolean
        }
        error.status = res.status
        error.reason = reason
        error.authorityConflict = authorityConflict
        throw error
    }
    return res.json() as Promise<{ executionId: string; saved: boolean }>
}

// ── Load latest execution outputs (for hydration on page load) ──
export async function fetchExecutionOutputs(workflowId: string) {
    const res = await fetch(`/api/workflows/${workflowId}/executions`)
    if (!res.ok) return null
    return res.json() as Promise<{
        executionId: string | null
        status: string | null
        outputData: Record<string, { outputs: Record<string, unknown>; configSnapshot: string | null; completedAt: string }> | null
        nodeStates: Record<string, NodeExecutionState> | null
        continuation: WorkflowContinuationMarker | null
        cursor: WorkflowExecutionCursor | null
        lease: WorkflowExecutionLease | null
    }>
}

// ── Update execution status (workflow-level: completed/failed) ──
export async function updateExecutionStatus(
    workflowId: string,
    executionId: string,
    status: string,
    continuation?: WorkflowContinuationMarker | null,
    cursor?: WorkflowExecutionCursor | null,
    leaseId?: string,
) {
    return persistNodeOutput(workflowId, { executionId, nodeId: '', status, continuation, cursor, leaseId })
}

export async function startWorkflowExecution(
    workflowId: string,
    data: {
        runToken: string
        graphSignature: string
        clientInstanceId: string
    },
) {
    const res = await fetch(`/api/workflows/${workflowId}/executions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
    const payload = await res.json().catch(() => null) as
        | {
            granted: boolean
            reason?: string
            message?: string
            executionId?: string
            lease?: WorkflowExecutionLease
            cursor?: WorkflowExecutionCursor
            alreadyRunning?: boolean
        }
        | null

    if (!res.ok) {
        return {
            granted: false,
            reason: payload?.reason || 'unknown',
            message: payload?.message || 'Failed to start workflow execution',
            executionId: null,
            lease: null,
            cursor: null,
            alreadyRunning: false,
        }
    }

    return {
        granted: payload?.granted === true,
        reason: payload?.reason || null,
        message: payload?.message || null,
        executionId: payload?.executionId || null,
        lease: payload?.lease || null,
        cursor: payload?.cursor || null,
        alreadyRunning: payload?.alreadyRunning === true,
    }
}

export async function acquireExecutionResumeLease(
    workflowId: string,
    data: {
        executionId: string
        continuation: WorkflowContinuationMarker
        clientInstanceId: string
    },
) {
    const res = await fetch(`/api/workflows/${workflowId}/executions/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
    const payload = await res.json().catch(() => null) as
        | {
            granted: boolean
            reason?: string
            message?: string
            alreadyHeld?: boolean
            lease?: WorkflowExecutionLease
            continuation?: WorkflowContinuationMarker
        }
        | null

    if (!res.ok) {
        return {
            granted: false,
            reason: payload?.reason || 'unknown',
            message: payload?.message || 'Failed to acquire execution continuation lease',
        }
    }

    return {
        granted: payload?.granted === true,
        reason: payload?.reason || null,
        message: payload?.message || null,
        alreadyHeld: payload?.alreadyHeld === true,
        lease: payload?.lease || null,
        continuation: payload?.continuation || null,
    }
}

// ── Fetch single panel data (for preview updates) ──
export interface WorkflowPanelResponse {
    id: string
    imageUrl: string | null
    videoUrl: string | null
}

export async function fetchPanel(projectId: string, panelId: string): Promise<{ panel: WorkflowPanelResponse }> {
    const res = await fetch(`/api/novel-promotion/${projectId}/panel?panelId=${encodeURIComponent(panelId)}`)
    if (!res.ok) throw new Error('Failed to fetch panel')
    return res.json()
}

export interface WorkflowVoiceLineResponse {
    id: string
    episodeId: string
    speaker: string
    content: string
    audioUrl: string | null
    audioDuration: number | null
}

export async function fetchVoiceLine(projectId: string, lineId: string): Promise<{ voiceLine: WorkflowVoiceLineResponse }> {
    const res = await fetch(
        `/api/novel-promotion/${projectId}/voice-lines?lineId=${encodeURIComponent(lineId)}`,
    )
    if (!res.ok) throw new Error('Failed to fetch voice line')
    return res.json()
}

export interface WorkflowWorkspaceEpisodeOption {
    id: string
    label: string
    episodeNumber: number
}

export interface WorkflowWorkspacePanelOption {
    id: string
    episodeId: string
    episodeNumber: number
    episodeName: string | null
    panelIndex: number
    panelNumber: number | null
    description: string | null
    imageUrl: string | null
    videoUrl: string | null
}

export interface WorkflowWorkspaceVoiceLineOption {
    id: string
    episodeId: string
    lineIndex: number
    speaker: string
    content: string
    audioUrl: string | null
    audioDuration: number | null
}

export interface WorkflowWorkspaceContextResponse {
    projectId: string
    episodes: WorkflowWorkspaceEpisodeOption[]
    panels: WorkflowWorkspacePanelOption[]
    voiceLinesByEpisode: Record<string, WorkflowWorkspaceVoiceLineOption[]>
}

export async function fetchWorkflowWorkspaceContext(projectId: string): Promise<WorkflowWorkspaceContextResponse> {
    const res = await fetch(`/api/workflows/workspace-context?projectId=${encodeURIComponent(projectId)}`)
    if (!res.ok) throw new Error('Failed to fetch workflow workspace context')
    return res.json() as Promise<WorkflowWorkspaceContextResponse>
}
