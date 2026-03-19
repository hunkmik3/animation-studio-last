import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { buildImageBillingPayload } from '@/lib/config-service'
import type { NodeExecutor } from './types'

/**
 * Image Generate executor — BRIDGE to production task system.
 *
 * When a panelId is provided (node synced from workspace), this executor
 * delegates to the EXACT same production pipeline used by the original
 * waoowaoo workspace:
 *
 *   submitTask(IMAGE_PANEL) → BullMQ image queue → image.worker.ts
 *   → handlePanelImageTask → FAL.ai / Google Gemini / Bytedance Seedream
 *   → saves panel.imageUrl → SSE event → frontend updates
 *
 * This is a FULL CAPABILITY BRIDGE — zero quality loss compared to
 * the original pipeline. The workflow editor's WorkflowTaskMonitor
 * component listens for task completion and updates the node state.
 *
 * Without panelId: fails explicitly because production generation requires
 * a linked workspace panel context.
 *
 * Parity: FULL (when panelId provided) — uses identical code path
 * as the workspace "Generate Image" button.
 */
export const executeImageGenerate: NodeExecutor = async (ctx) => {
  if (!ctx.panelId) {
    throw new Error('Image generation requires a linked panel. Use "Pull from Workspace" to link nodes to panels.')
  }

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: ctx.panelId },
  })
  if (!panel) {
    throw new Error('Panel not found')
  }

  const imageModel = (ctx.config.model as string) || ctx.projectModelConfig.storyboardModel
  if (!imageModel) {
    throw new Error('Image model not configured. Set a model in node settings or project config.')
  }

  const customPrompt = typeof ctx.config.customPrompt === 'string' && ctx.config.customPrompt.trim()
    ? ctx.config.customPrompt.trim()
    : undefined

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId: ctx.projectId,
      userId: ctx.userId,
      imageModel,
      basePayload: { panelId: ctx.panelId, ...ctx.config },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw new Error(message)
  }

  if (customPrompt) {
    billingPayload.customPrompt = customPrompt
  }
  // Auto-confirm: workflow generates should immediately update imageUrl
  // without requiring manual candidate confirmation on workspace
  billingPayload.autoConfirm = true

  const result = await submitTask({
    userId: ctx.userId,
    locale: ctx.locale,
    requestId: ctx.requestId || undefined,
    projectId: ctx.projectId,
    type: TASK_TYPE.IMAGE_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: ctx.panelId,
    payload: withTaskUiPayload(billingPayload, { hasOutputAtStart: !!panel.imageUrl }),
    dedupeKey: `workflow:image:${ctx.nodeId}:${ctx.panelId}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
  })

  return {
    outputs: {},
    async: true,
    taskId: result.taskId,
    message: 'Image generation task submitted',
    metadata: { imageModel, panelId: ctx.panelId, deduped: result.deduped },
  }
}
