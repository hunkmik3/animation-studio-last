import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

// GET — List user's workflows
export const GET = apiHandler(async (request: NextRequest) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10)

    const where = { userId: session.user.id }

    const [total, workflows] = await Promise.all([
        prisma.workflow.count({ where }),
        prisma.workflow.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
                id: true,
                name: true,
                description: true,
                isTemplate: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                _count: { select: { executions: true } },
            },
        }),
    ])

    return NextResponse.json({
        workflows,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    })
})

// POST — Create new workflow
export const POST = apiHandler(async (request: NextRequest) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = await request.json()
    const { name, description, graphData, projectId } = body

    if (!name || name.trim().length === 0) {
        throw new ApiError('INVALID_PARAMS')
    }
    if (!graphData) {
        throw new ApiError('INVALID_PARAMS')
    }

    const workflow = await prisma.workflow.create({
        data: {
            userId: session.user.id,
            name: name.trim(),
            description: description?.trim() || null,
            graphData: typeof graphData === 'string' ? graphData : JSON.stringify(graphData),
            projectId: projectId || null,
            status: 'draft',
        },
    })

    return NextResponse.json({ workflow }, { status: 201 })
})
