import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const POST = apiHandler(async (request: NextRequest) => {
    const authResult = await requireUserAuth(request)
    if ('error' in authResult) return authResult
    const { session } = authResult

    const body = await request.json()
    const { projectId, nodes } = body

    if (!projectId || !nodes || !Array.isArray(nodes)) {
        throw new ApiError('INVALID_PARAMS', { message: 'Missing projectId or nodes array' })
    }

    // Verify project belongs to user
    const project = await prisma.project.findFirst({
        where: { id: projectId, userId: session.user.id }
    })

    if (!project) {
        throw new ApiError('NOT_FOUND', { message: 'Project not found or unauthorized' })
    }

    // Keep track of panel updates
    const panelUpdates = new Map<string, { imagePrompt?: string, videoPrompt?: string }>()

    for (const node of nodes) {
        const nodeId = node.id as string
        const content = node.data?.config?.content

        if (content) {
            if (nodeId.startsWith('imgPrompt_')) {
                const panelId = nodeId.replace('imgPrompt_', '')
                const update = panelUpdates.get(panelId) || {}
                update.imagePrompt = String(content)
                panelUpdates.set(panelId, update)
            } else if (nodeId.startsWith('vidPrompt_')) {
                const panelId = nodeId.replace('vidPrompt_', '')
                const update = panelUpdates.get(panelId) || {}
                update.videoPrompt = String(content)
                panelUpdates.set(panelId, update)
            }
        }
    }

    if (panelUpdates.size === 0) {
        return NextResponse.json({ success: true, message: 'No panel prompts required updates' })
    }

    // Run updates in a transaction
    const updatePromises = []
    for (const [panelId, data] of panelUpdates.entries()) {
        updatePromises.push(
            prisma.novelPromotionPanel.update({
                where: { id: panelId },
                data: {
                    ...(data.imagePrompt !== undefined ? { imagePrompt: data.imagePrompt } : {}),
                    ...(data.videoPrompt !== undefined ? { videoPrompt: data.videoPrompt } : {})
                }
            })
        )
    }

    await prisma.$transaction(updatePromises)

    return NextResponse.json({
        success: true,
        updatedCount: panelUpdates.size
    })
})
