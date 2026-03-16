import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { getProjectModelConfig } from '@/lib/config-service'
import { NODE_EXECUTOR_REGISTRY } from '@/lib/workflow-engine/executors'
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
    projectId: string
    config: Record<string, unknown>
    inputs?: Record<string, unknown>
    panelId?: string
}

export const POST = apiHandler(async (request: NextRequest) => {
    // ── Parse request ──
    const body: ExecuteNodeBody = await request.json()
    const { nodeType, nodeId, projectId, config, inputs, panelId } = body

    if (!nodeType || !nodeId || !projectId) {
        throw new ApiError('INVALID_PARAMS', { message: 'nodeType, nodeId, and projectId are required' })
    }

    // ── Auth ──
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    // ── Resolve context ──
    const locale = resolveRequiredTaskLocale(request, body as any)
    const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)

    // ── Lookup executor ──
    const executor = NODE_EXECUTOR_REGISTRY[nodeType]
    if (!executor) {
        return NextResponse.json({
            success: true,
            nodeId,
            mock: true,
            message: `Node type "${nodeType}" execution not yet implemented. Coming soon.`,
        })
    }

    // ── Build execution context ──
    const ctx: NodeExecutorContext = {
        nodeId,
        nodeType,
        config: config || {},
        inputs: inputs || {},
        projectId,
        userId: session.user.id,
        locale,
        projectModelConfig,
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
