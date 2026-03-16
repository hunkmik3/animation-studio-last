import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

type Params = { params: Promise<{ workflowId: string }> }

// =============================================
// Workflow Execution Persistence API
//
// POST — Save node outputs incrementally (called after each node completes)
// GET  — Load latest execution's persisted outputs (for hydration on page load)
// =============================================

/**
 * POST — Persist node output to execution record.
 *
 * Body: {
 *   executionId?: string      — reuse existing execution, or create/find latest
 *   nodeId: string            — which node completed
 *   outputs: Record<string, unknown>  — the node's output data
 *   configSnapshot?: string   — serialized node config for staleness detection
 *   nodeState?: object        — optional NodeExecutionState to persist
 *   status?: string           — execution-level status update ('completed' | 'failed')
 * }
 *
 * Returns: { executionId, saved: true }
 */
export const POST = apiHandler(async (request: NextRequest, context: Params) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult
    const { workflowId } = await context.params

    const body = await request.json()
    const { executionId, nodeId, outputs, configSnapshot, nodeState, status } = body

    if (!nodeId && !status) {
        throw new ApiError('INVALID_PARAMS', { message: 'nodeId is required (or status for execution-level update)' })
    }

    // Verify workflow ownership
    const workflow = await prisma.workflow.findFirst({
        where: { id: workflowId, userId: session.user.id },
        select: { id: true },
    })
    if (!workflow) throw new ApiError('NOT_FOUND')

    // Find or create execution record
    let execution
    if (executionId) {
        execution = await prisma.workflowExecution.findFirst({
            where: { id: executionId, workflowId, userId: session.user.id },
        })
        if (!execution) throw new ApiError('NOT_FOUND', { message: 'Execution not found' })
    } else {
        // Find latest running/pending execution, or create one
        execution = await prisma.workflowExecution.findFirst({
            where: { workflowId, userId: session.user.id, status: { in: ['running', 'pending'] } },
            orderBy: { createdAt: 'desc' },
        })
        if (!execution) {
            execution = await prisma.workflowExecution.create({
                data: {
                    workflowId,
                    userId: session.user.id,
                    status: 'running',
                    nodeStates: '{}',
                    startedAt: new Date(),
                },
            })
        }
    }

    // Build update payload
    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    // Merge node output into outputData
    if (nodeId && outputs) {
        const existingOutputData = execution.outputData
            ? JSON.parse(execution.outputData)
            : {}
        existingOutputData[nodeId] = {
            outputs,
            configSnapshot: configSnapshot || null,
            completedAt: new Date().toISOString(),
        }
        updateData.outputData = JSON.stringify(existingOutputData)
    }

    // Merge node state into nodeStates
    if (nodeId && nodeState) {
        const existingNodeStates = execution.nodeStates
            ? JSON.parse(execution.nodeStates)
            : {}
        existingNodeStates[nodeId] = nodeState
        updateData.nodeStates = JSON.stringify(existingNodeStates)
    }

    // Execution-level status update
    if (status) {
        updateData.status = status
        if (status === 'completed' || status === 'failed') {
            updateData.completedAt = new Date()
        }
    }

    await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: updateData,
    })

    return NextResponse.json({ executionId: execution.id, saved: true })
})

/**
 * GET — Load the latest execution's persisted outputs for this workflow.
 *
 * Returns: {
 *   executionId: string | null,
 *   status: string | null,
 *   outputData: Record<string, { outputs, configSnapshot, completedAt }> | null,
 *   nodeStates: Record<string, NodeExecutionState> | null,
 * }
 */
export const GET = apiHandler(async (_request: NextRequest, context: Params) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult
    const { workflowId } = await context.params

    // Find latest execution with output data
    const execution = await prisma.workflowExecution.findFirst({
        where: { workflowId, userId: session.user.id },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            status: true,
            outputData: true,
            nodeStates: true,
            startedAt: true,
            completedAt: true,
        },
    })

    if (!execution || !execution.outputData) {
        return NextResponse.json({
            executionId: execution?.id || null,
            status: execution?.status || null,
            outputData: null,
            nodeStates: null,
        })
    }

    return NextResponse.json({
        executionId: execution.id,
        status: execution.status,
        outputData: JSON.parse(execution.outputData),
        nodeStates: execution.nodeStates ? JSON.parse(execution.nodeStates) : null,
    })
})
