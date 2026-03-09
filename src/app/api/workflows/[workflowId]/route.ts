import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

type Params = { params: Promise<{ workflowId: string }> }

// GET — Get single workflow
export const GET = apiHandler(async (_request: NextRequest, context: Params) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult
    const { workflowId } = await context.params

    const workflow = await prisma.workflow.findFirst({
        where: { id: workflowId, userId: session.user.id },
        include: {
            executions: {
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    status: true,
                    startedAt: true,
                    completedAt: true,
                    createdAt: true,
                },
            },
        },
    })

    if (!workflow) {
        throw new ApiError('NOT_FOUND')
    }

    return NextResponse.json({ workflow })
})

// PUT — Update workflow
export const PUT = apiHandler(async (request: NextRequest, context: Params) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult
    const { workflowId } = await context.params

    const body = await request.json()
    const { name, description, graphData, status } = body

    // Check ownership
    const existing = await prisma.workflow.findFirst({
        where: { id: workflowId, userId: session.user.id },
    })
    if (!existing) {
        throw new ApiError('NOT_FOUND')
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description?.trim() || null
    if (graphData !== undefined) updateData.graphData = typeof graphData === 'string' ? graphData : JSON.stringify(graphData)
    if (status !== undefined) updateData.status = status

    const workflow = await prisma.workflow.update({
        where: { id: workflowId },
        data: updateData,
    })

    return NextResponse.json({ workflow })
})

// DELETE — Delete workflow
export const DELETE = apiHandler(async (_request: NextRequest, context: Params) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult
    const { workflowId } = await context.params

    const existing = await prisma.workflow.findFirst({
        where: { id: workflowId, userId: session.user.id },
    })
    if (!existing) {
        throw new ApiError('NOT_FOUND')
    }

    await prisma.workflow.delete({ where: { id: workflowId } })

    return NextResponse.json({ success: true })
})
