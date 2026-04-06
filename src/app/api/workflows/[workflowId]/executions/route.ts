import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
    WORKFLOW_CONTINUATION_STATE_KEY,
    isWorkflowContinuationMarker,
    type WorkflowContinuationMarker,
} from '@/lib/workflow-engine/continuation'
import {
    WORKFLOW_EXECUTION_CURSOR_STATE_KEY,
    WORKFLOW_EXECUTION_LEASE_STATE_KEY,
    isWorkflowExecutionCursor,
    isWorkflowExecutionLease,
    isWorkflowExecutionLeaseExpired,
    refreshWorkflowExecutionLease,
    type WorkflowExecutionCursor,
} from '@/lib/workflow-engine/execution-authority'
import {
    WORKFLOW_CONTINUITY_MEMORY_STATE_KEY,
    isWorkflowContinuityMemory,
    type WorkflowContinuityMemory,
} from '@/lib/workflow-engine/continuity-memory'

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

    const body = await request.json() as {
        executionId?: string
        nodeId?: string
        outputs?: Record<string, unknown>
        configSnapshot?: string
        nodeState?: Record<string, unknown>
        status?: string
        continuation?: WorkflowContinuationMarker | null
        cursor?: WorkflowExecutionCursor | null
        continuityMemory?: WorkflowContinuityMemory | null
        leaseId?: string
    }
    const { executionId, nodeId, outputs, configSnapshot, nodeState, status, continuation, cursor, continuityMemory, leaseId } = body
    const hasContinuationPatch = Object.prototype.hasOwnProperty.call(body, 'continuation')
    const hasCursorPatch = Object.prototype.hasOwnProperty.call(body, 'cursor')
    const hasContinuityMemoryPatch = Object.prototype.hasOwnProperty.call(body, 'continuityMemory')
    const normalizedLeaseId = typeof leaseId === 'string' && leaseId.trim().length > 0 ? leaseId.trim() : null

    if (!nodeId && !status && !hasContinuationPatch && !hasCursorPatch && !hasContinuityMemoryPatch) {
        throw new ApiError('INVALID_PARAMS', {
            message: 'nodeId, status, continuation patch, cursor patch, or continuity memory patch is required',
        })
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
    const now = new Date()
    const updateData: Record<string, unknown> = { updatedAt: now }
    const existingNodeStates: Record<string, unknown> = execution.nodeStates
        ? JSON.parse(execution.nodeStates)
        : {}
    const currentLease = isWorkflowExecutionLease(existingNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY])
        ? existingNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY]
        : null
    const leaseIsActive = currentLease ? !isWorkflowExecutionLeaseExpired(currentLease, now) : false
    const leaseMismatch = Boolean(leaseIsActive && currentLease && normalizedLeaseId !== currentLease.leaseId)
    const shouldValidateLease = Boolean(
        (nodeId && (outputs || nodeState))
        || status
        || hasContinuationPatch
        || hasCursorPatch
        || hasContinuityMemoryPatch,
    )
    if (shouldValidateLease && leaseMismatch) {
        throw new ApiError('CONFLICT', {
            message: 'Execution lease is held by another session',
        })
    }

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

    // Merge node state / continuation marker into nodeStates
    if (
        (nodeId && nodeState)
        || hasContinuationPatch
        || hasCursorPatch
        || hasContinuityMemoryPatch
        || status === 'completed'
        || status === 'failed'
    ) {
        if (nodeId && nodeState) {
            existingNodeStates[nodeId] = nodeState
        }

        if (hasContinuationPatch) {
            if (continuation === null) {
                delete existingNodeStates[WORKFLOW_CONTINUATION_STATE_KEY]
            } else if (isWorkflowContinuationMarker(continuation)) {
                existingNodeStates[WORKFLOW_CONTINUATION_STATE_KEY] = continuation
            } else {
                throw new ApiError('INVALID_PARAMS', { message: 'Invalid continuation payload' })
            }
        }

        if (hasCursorPatch) {
            if (cursor === null) {
                delete existingNodeStates[WORKFLOW_EXECUTION_CURSOR_STATE_KEY]
            } else if (isWorkflowExecutionCursor(cursor)) {
                existingNodeStates[WORKFLOW_EXECUTION_CURSOR_STATE_KEY] = cursor
            } else {
                throw new ApiError('INVALID_PARAMS', { message: 'Invalid execution cursor payload' })
            }
        }

        if (hasContinuityMemoryPatch) {
            if (continuityMemory === null) {
                delete existingNodeStates[WORKFLOW_CONTINUITY_MEMORY_STATE_KEY]
            } else if (isWorkflowContinuityMemory(continuityMemory)) {
                existingNodeStates[WORKFLOW_CONTINUITY_MEMORY_STATE_KEY] = continuityMemory
            } else {
                throw new ApiError('INVALID_PARAMS', { message: 'Invalid continuity memory payload' })
            }
        }

        if (status === 'completed' || status === 'failed') {
            delete existingNodeStates[WORKFLOW_CONTINUATION_STATE_KEY]
            delete existingNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY]
            if (!hasCursorPatch) {
                delete existingNodeStates[WORKFLOW_EXECUTION_CURSOR_STATE_KEY]
            }
        } else if (
            leaseIsActive
            && currentLease
            && normalizedLeaseId === currentLease.leaseId
            && currentLease.runToken
        ) {
            existingNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY] = refreshWorkflowExecutionLease(currentLease, now)
        }

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
        const parsedNodeStates: Record<string, unknown> = execution?.nodeStates ? JSON.parse(execution.nodeStates) : {}
        const continuation = isWorkflowContinuationMarker(parsedNodeStates[WORKFLOW_CONTINUATION_STATE_KEY])
            ? parsedNodeStates[WORKFLOW_CONTINUATION_STATE_KEY]
            : null
        const cursor = isWorkflowExecutionCursor(parsedNodeStates[WORKFLOW_EXECUTION_CURSOR_STATE_KEY])
            ? parsedNodeStates[WORKFLOW_EXECUTION_CURSOR_STATE_KEY]
            : null
        const lease = isWorkflowExecutionLease(parsedNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY])
            ? parsedNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY]
            : null
        const continuityMemory = isWorkflowContinuityMemory(parsedNodeStates[WORKFLOW_CONTINUITY_MEMORY_STATE_KEY])
            ? parsedNodeStates[WORKFLOW_CONTINUITY_MEMORY_STATE_KEY]
            : null
        const activeLease = lease && !isWorkflowExecutionLeaseExpired(lease) ? lease : null
        delete parsedNodeStates[WORKFLOW_CONTINUATION_STATE_KEY]
        delete parsedNodeStates[WORKFLOW_EXECUTION_CURSOR_STATE_KEY]
        delete parsedNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY]
        delete parsedNodeStates[WORKFLOW_CONTINUITY_MEMORY_STATE_KEY]

        return NextResponse.json({
            executionId: execution?.id || null,
            status: execution?.status || null,
            outputData: null,
            nodeStates: Object.keys(parsedNodeStates).length > 0 ? parsedNodeStates : null,
            continuation,
            cursor,
            lease: activeLease,
            continuityMemory,
        })
    }

    const parsedNodeStates: Record<string, unknown> = execution.nodeStates ? JSON.parse(execution.nodeStates) : {}
    const continuation = isWorkflowContinuationMarker(parsedNodeStates[WORKFLOW_CONTINUATION_STATE_KEY])
        ? parsedNodeStates[WORKFLOW_CONTINUATION_STATE_KEY]
        : null
    const cursor = isWorkflowExecutionCursor(parsedNodeStates[WORKFLOW_EXECUTION_CURSOR_STATE_KEY])
        ? parsedNodeStates[WORKFLOW_EXECUTION_CURSOR_STATE_KEY]
        : null
    const lease = isWorkflowExecutionLease(parsedNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY])
        ? parsedNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY]
        : null
    const continuityMemory = isWorkflowContinuityMemory(parsedNodeStates[WORKFLOW_CONTINUITY_MEMORY_STATE_KEY])
        ? parsedNodeStates[WORKFLOW_CONTINUITY_MEMORY_STATE_KEY]
        : null
    const activeLease = lease && !isWorkflowExecutionLeaseExpired(lease) ? lease : null
    delete parsedNodeStates[WORKFLOW_CONTINUATION_STATE_KEY]
    delete parsedNodeStates[WORKFLOW_EXECUTION_CURSOR_STATE_KEY]
    delete parsedNodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY]
    delete parsedNodeStates[WORKFLOW_CONTINUITY_MEMORY_STATE_KEY]

    return NextResponse.json({
        executionId: execution.id,
        status: execution.status,
        outputData: JSON.parse(execution.outputData),
        nodeStates: Object.keys(parsedNodeStates).length > 0 ? parsedNodeStates : null,
        continuation,
        cursor,
        lease: activeLease,
        continuityMemory,
    })
})
