/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeWorkflow } from '@/lib/workflow-engine/executor'
import type { SerializedWorkflow } from '@/lib/workflow-engine/types'

type Params = { params: Promise<{ workflowId: string }> }

// POST — Execute workflow
export const POST = apiHandler(async (_request: NextRequest, context: Params) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult
    const { workflowId } = await context.params

    // Get workflow
    const workflow = await prisma.workflow.findFirst({
        where: { id: workflowId, userId: session.user.id },
    })
    if (!workflow) {
        throw new ApiError('NOT_FOUND')
    }

    // Parse graph data
    let graphData: SerializedWorkflow
    try {
        graphData = JSON.parse(workflow.graphData)
    } catch {
        throw new ApiError('INVALID_PARAMS')
    }

    // Create execution record
    const execution = await prisma.workflowExecution.create({
        data: {
            workflowId: workflow.id,
            userId: session.user.id,
            status: 'running',
            nodeStates: JSON.stringify({}),
            startedAt: new Date(),
        },
    })

    // Execute workflow (async — don't await in production, use queue)
    // For now, execute synchronously for demo
    try {
        const result = await executeWorkflow(graphData, {
            onNodeStart: (nodeId) => {
                console.log(`[Workflow ${execution.id}] Node ${nodeId} started`)
            },
            onNodeComplete: (_nodeId, _res) => {
                // In production, emit SSE events here
            },
            onNodeError: (nodeId, error) => {
                console.error(`[Workflow ${execution.id}] Node ${nodeId} failed:`, error.message)
            },
        })

        // Update execution record
        await prisma.workflowExecution.update({
            where: { id: execution.id },
            data: {
                status: result.status,
                nodeStates: JSON.stringify(result.nodeStates),
                completedAt: result.completedAt ? new Date(result.completedAt) : null,
                error: result.error || null,
            },
        })

        return NextResponse.json({
            execution: {
                id: execution.id,
                status: result.status,
                nodeStates: result.nodeStates,
                completedAt: result.completedAt,
            },
        })
    } catch (error) {
        // Update execution as failed
        await prisma.workflowExecution.update({
            where: { id: execution.id },
            data: {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                completedAt: new Date(),
            },
        })

        throw error
    }
})
