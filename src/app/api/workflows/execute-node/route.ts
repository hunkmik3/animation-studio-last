import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { getWorkflowExecutionModelConfig } from '@/lib/config-service'
import { NODE_EXECUTOR_REGISTRY } from '@/lib/workflow-engine/executors'
import {
    getUnsupportedNodeExecutionMessage,
    usesWorkspaceExecutionContext,
} from '@/lib/workflow-engine/execution-support'
import type { NodeExecutorContext } from '@/lib/workflow-engine/executors'

// =============================================
// Workflow Node Execution API — Thin Dispatcher
//
// Parses request → authenticates → builds context → looks up executor → returns result.
// All node-specific logic lives in src/lib/workflow-engine/executors/<node-type>.ts
// =============================================

interface ExecuteNodeBody {
    nodeType: string
    nodeId: string
    projectId?: string
    config: Record<string, unknown>
    inputs?: Record<string, unknown>
    panelId?: string
}

export const POST = apiHandler(async (request: NextRequest) => {
    // ── Parse request ──
    const body: ExecuteNodeBody = await request.json()
    const { nodeType, nodeId, config, inputs, panelId } = body
    const projectId = typeof body.projectId === 'string' && body.projectId.trim().length > 0
        ? body.projectId.trim()
        : ''
    const usesWorkspaceContext = usesWorkspaceExecutionContext({
        nodeType,
        panelId,
        config,
    })

    if (!nodeType || !nodeId) {
        throw new ApiError('INVALID_PARAMS', { message: 'nodeType and nodeId are required' })
    }

    // ── Lookup executor ──
    const executor = NODE_EXECUTOR_REGISTRY[nodeType]
    if (!executor) {
        throw new ApiError('INVALID_PARAMS', {
            message: getUnsupportedNodeExecutionMessage(nodeType),
        })
    }

    if (usesWorkspaceContext && !projectId) {
        throw new ApiError('INVALID_PARAMS', {
            message: `Node "${nodeType}" requires projectId because it is currently bound to workspace data.`,
        })
    }

    // ── Auth ──
    const authResult = usesWorkspaceContext && projectId
        ? await requireProjectAuthLight(projectId)
        : await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    // ── Resolve context ──
    const locale = resolveRequiredTaskLocale(request, body)
    const modelConfig = await getWorkflowExecutionModelConfig({
        projectId: usesWorkspaceContext ? projectId : null,
        userId: session.user.id,
    })

    // ── Build execution context ──
    const ctx: NodeExecutorContext = {
        nodeId,
        nodeType,
        config: config || {},
        inputs: inputs || {},
        projectId: usesWorkspaceContext ? projectId : null,
        userId: session.user.id,
        locale,
        modelConfig,
        panelId,
        requestId: getRequestId(request),
    }

    // ── Execute ──
    const result = await executor(ctx)

    // ── Return standardized response ──
    return NextResponse.json({
        success: true,
        nodeId,
        ...result,
    })
})
