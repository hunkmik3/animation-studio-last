import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { getProjectModelConfig, buildImageBillingPayload } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'

// =============================================
// Workflow Node Execution API
// Executes a single workflow node by routing to
// the correct task handler based on node type.
// =============================================

type NodeConfig = Record<string, unknown>

interface ExecuteNodeBody {
    nodeType: string
    nodeId: string
    projectId: string
    config: NodeConfig
    inputs?: Record<string, unknown>
    panelId?: string
}

export const POST = apiHandler(async (request: NextRequest) => {
    const body: ExecuteNodeBody = await request.json()
    const { nodeType, nodeId, projectId, config, inputs, panelId } = body

    if (!nodeType || !nodeId || !projectId) {
        throw new ApiError('INVALID_PARAMS', { message: 'nodeType, nodeId, and projectId are required' })
    }

    // 🔐 Verify project ownership
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const locale = resolveRequiredTaskLocale(request, body as any)
    const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)

    // ── Route by node type ──
    switch (nodeType) {
        // ── Image Generate ──
        case 'image-generate': {
            // If panelId provided, use panel image task (real generation)
            if (panelId) {
                const panel = await prisma.novelPromotionPanel.findUnique({ where: { id: panelId } })
                if (!panel) throw new ApiError('NOT_FOUND', { message: 'Panel not found' })

                const imageModel = config.model as string || projectModelConfig.storyboardModel
                if (!imageModel) throw new ApiError('INVALID_PARAMS', { message: 'Image model not configured' })

                let billingPayload: Record<string, unknown>
                try {
                    billingPayload = await buildImageBillingPayload({
                        projectId,
                        userId: session.user.id,
                        imageModel,
                        basePayload: { panelId, ...config },
                    })
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Image model capability not configured'
                    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
                }

                const result = await submitTask({
                    userId: session.user.id,
                    locale,
                    requestId: getRequestId(request),
                    projectId,
                    type: TASK_TYPE.IMAGE_PANEL,
                    targetType: 'NovelPromotionPanel',
                    targetId: panelId,
                    payload: withTaskUiPayload(billingPayload, { hasOutputAtStart: !!panel.imageUrl }),
                    dedupeKey: `workflow:image:${nodeId}:${panelId}`,
                    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
                })

                return NextResponse.json({ success: true, taskId: result.taskId, nodeId })
            }

            // No panelId: mock execution for standalone node
            return NextResponse.json({
                success: true,
                nodeId,
                mock: true,
                message: 'Image generation requires a linked panel. Use "Pull from Workspace" to link nodes to panels.',
            })
        }

        // ── Video Generate ──
        case 'video-generate': {
            if (panelId) {
                const panel = await prisma.novelPromotionPanel.findUnique({ where: { id: panelId } })
                if (!panel) throw new ApiError('NOT_FOUND', { message: 'Panel not found' })

                if (!panel.imageUrl) {
                    throw new ApiError('INVALID_PARAMS', { message: 'Panel must have an image before generating video' })
                }

                const videoModel = config.model as string || projectModelConfig.videoModel
                if (!videoModel) throw new ApiError('INVALID_PARAMS', { message: 'Video model not configured' })

                const videoPayload = {
                    videoModel,
                    storyboardId: panel.storyboardId,
                    panelIndex: panel.panelIndex,
                    ...config,
                }

                const result = await submitTask({
                    userId: session.user.id,
                    locale,
                    requestId: getRequestId(request),
                    projectId,
                    type: TASK_TYPE.VIDEO_PANEL,
                    targetType: 'NovelPromotionPanel',
                    targetId: panelId,
                    payload: withTaskUiPayload(videoPayload, { hasOutputAtStart: !!panel.videoUrl }),
                    dedupeKey: `workflow:video:${nodeId}:${panelId}`,
                    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, videoPayload),
                })

                return NextResponse.json({ success: true, taskId: result.taskId, nodeId })
            }

            return NextResponse.json({
                success: true,
                nodeId,
                mock: true,
                message: 'Video generation requires a linked panel with an image.',
            })
        }

        // ── Text Input (returns content directly) ──
        case 'text-input': {
            return NextResponse.json({
                success: true,
                nodeId,
                outputs: { text: config.content || '' },
            })
        }

        // ── LLM Prompt ──
        case 'llm-prompt': {
            // For now, return mock. Will integrate with actual LLM in Phase 3.
            const inputText = (inputs?.text as string) || ''
            const model = (config.model as string) || 'gemini-2.0-flash'

            return NextResponse.json({
                success: true,
                nodeId,
                mock: true,
                outputs: {
                    result: `[LLM Processing] Model: ${model}, Input: ${inputText.length} chars`,
                },
            })
        }

        // ── Default: unsupported type ──
        default: {
            return NextResponse.json({
                success: true,
                nodeId,
                mock: true,
                message: `Node type "${nodeType}" execution not yet implemented. Coming soon.`,
            })
        }
    }
})
