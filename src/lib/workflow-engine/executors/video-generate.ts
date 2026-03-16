import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import type { NodeExecutor } from './types'

/**
 * Video Generate executor — BRIDGE to production task system.
 *
 * When a panelId is provided (node synced from workspace), this executor
 * delegates to the EXACT same production pipeline:
 *
 *   submitTask(VIDEO_PANEL) → BullMQ video queue → video.worker.ts
 *   → handles video generation via Google AI / Bytedance Seedance
 *   → saves panel.videoUrl → SSE event → frontend updates
 *
 * Requires the panel to already have an imageUrl (image-first workflow).
 *
 * Parity: FULL (when panelId provided) — uses identical code path
 * as the workspace "Generate Video" button.
 */
export const executeVideoGenerate: NodeExecutor = async (ctx) => {
  if (!ctx.panelId) {
    return {
      outputs: {},
      mock: true,
      message: 'Video generation requires a linked panel with an image. Use "Pull from Workspace" to link nodes.',
    }
  }

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: ctx.panelId },
  })
  if (!panel) {
    throw new Error('Panel not found')
  }

  if (!panel.imageUrl) {
    throw new Error('Panel must have an image before generating video. Run image generation first.')
  }

  const videoModel = (ctx.config.model as string) || ctx.projectModelConfig.videoModel
  if (!videoModel) {
    throw new Error('Video model not configured. Set a model in node settings or project config.')
  }

  const videoPayload = {
    videoModel,
    storyboardId: panel.storyboardId,
    panelIndex: panel.panelIndex,
    ...ctx.config,
  }

  const result = await submitTask({
    userId: ctx.userId,
    locale: ctx.locale,
    requestId: ctx.requestId || undefined,
    projectId: ctx.projectId,
    type: TASK_TYPE.VIDEO_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: ctx.panelId,
    payload: withTaskUiPayload(videoPayload, { hasOutputAtStart: !!panel.videoUrl }),
    dedupeKey: `workflow:video:${ctx.nodeId}:${ctx.panelId}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, videoPayload),
  })

  return {
    outputs: {},
    async: true,
    taskId: result.taskId,
    message: 'Video generation task submitted',
    metadata: { videoModel, panelId: ctx.panelId, deduped: result.deduped },
  }
}
