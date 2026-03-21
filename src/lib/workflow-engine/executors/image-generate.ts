import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import {
  buildImageBillingPayload,
  getUserModelConfig,
  resolveModelCapabilityGenerationOptions,
} from '@/lib/config-service'
import { generateImage } from '@/lib/generator-api'
import {
  applyWorkflowArtStyleToPrompt,
  resolveWorkflowArtStylePrompt,
} from '../art-style'
import type { NodeExecutor } from './types'
import {
  normalizeStandaloneMediaInput,
  persistStandaloneGeneratedMedia,
  resolveStandaloneGeneratedMediaSource,
} from './standalone-generation'

function readConfigString(config: Record<string, unknown>, key: string): string {
  const raw = config[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

function readOptionalStringInput(inputs: Record<string, unknown>, key: string): string {
  const raw = inputs[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

function readOptionalNumberConfig(config: Record<string, unknown>, key: string): number | null {
  const raw = config[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

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
    const imageModel = readConfigString(ctx.config, 'model') || ctx.modelConfig.storyboardModel
    if (!imageModel) {
      throw new Error('Image model not configured. Set a model in node settings or user defaults.')
    }

    const customPrompt = readConfigString(ctx.config, 'customPrompt')
    const promptInput = readOptionalStringInput(ctx.inputs, 'prompt')
    const basePrompt = customPrompt || promptInput
    if (!basePrompt) {
      throw new Error('Image generation requires a prompt input or custom prompt.')
    }
    const { artStyle, artStylePrompt } = resolveWorkflowArtStylePrompt(ctx.config.artStyle, ctx.locale)
    const prompt = applyWorkflowArtStyleToPrompt({
      prompt: basePrompt,
      artStylePrompt,
      locale: ctx.locale,
      mode: 'image',
    })

    const userConfig = await getUserModelConfig(ctx.userId)
    const runtimeSelections: Record<string, string | number | boolean> = {}
    const resolution = readConfigString(ctx.config, 'resolution')
    if (resolution) runtimeSelections.resolution = resolution
    const capabilityOptions = resolveModelCapabilityGenerationOptions({
      modelType: 'image',
      modelKey: imageModel,
      capabilityDefaults: userConfig.capabilityDefaults,
      runtimeSelections,
    })

    const aspectRatio = readConfigString(ctx.config, 'aspectRatio')
    const negativePrompt = readConfigString(ctx.config, 'negativePrompt')
    const referenceImages = await normalizeStandaloneMediaInput(ctx.inputs.reference)
    const result = await generateImage(ctx.userId, imageModel, prompt, {
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(negativePrompt ? { negativePrompt } : {}),
      ...capabilityOptions,
    })
    if (!result.success) {
      throw new Error(result.error || 'Image generation failed')
    }

    const resolved = await resolveStandaloneGeneratedMediaSource({
      result,
      userId: ctx.userId,
      mediaType: 'image',
    })
    const mediaRef = await persistStandaloneGeneratedMedia({
      nodeId: ctx.nodeId,
      nodeType: ctx.nodeType,
      mediaType: 'image',
      source: resolved.source,
      ...(resolved.downloadHeaders ? { downloadHeaders: resolved.downloadHeaders } : {}),
    })

    return {
      outputs: {
        image: mediaRef.url,
        imageUrl: mediaRef.url,
        imageMediaId: mediaRef.id,
        usedPrompt: prompt,
      },
      message: 'Image generated',
      metadata: {
        mode: 'standalone',
        imageModel,
        referenceImageCount: referenceImages.length,
        resolution: runtimeSelections.resolution || null,
        aspectRatio: aspectRatio || null,
        negativePrompt: negativePrompt || null,
        seed: readOptionalNumberConfig(ctx.config, 'seed'),
        artStyle,
        artStylePrompt,
      },
    }
  }
  if (!ctx.projectId) {
    throw new Error('Image generation workspace bridge requires projectId.')
  }

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: ctx.panelId },
  })
  if (!panel) {
    throw new Error('Panel not found')
  }

  const imageModel = (ctx.config.model as string) || ctx.modelConfig.storyboardModel
  if (!imageModel) {
    throw new Error('Image model not configured. Set a model in node settings or project config.')
  }

  const customPrompt = typeof ctx.config.customPrompt === 'string' && ctx.config.customPrompt.trim()
    ? ctx.config.customPrompt.trim()
    : undefined
  const { artStyle } = resolveWorkflowArtStylePrompt(ctx.config.artStyle, ctx.locale)

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
  if (artStyle) {
    billingPayload.artStyle = artStyle
  }

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
    metadata: { imageModel, panelId: ctx.panelId, deduped: result.deduped, artStyle: artStyle || null },
  }
}
