import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { getUserModelConfig, resolveModelCapabilityGenerationOptions } from '@/lib/config-service'
import { generateVideo } from '@/lib/generator-api'
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

function readOptionalNumberConfig(config: Record<string, unknown>, key: string): number | null {
  const raw = config[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function readOptionalStringInput(inputs: Record<string, unknown>, key: string): string {
  const raw = inputs[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

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
    const videoModel = readConfigString(ctx.config, 'model') || ctx.modelConfig.videoModel
    if (!videoModel) {
      throw new Error('Video model not configured. Set a model in node settings or user defaults.')
    }

    const normalizedImages = await normalizeStandaloneMediaInput(ctx.inputs.image)
    const inputImage = normalizedImages[0]
    if (!inputImage) {
      throw new Error('Video generation requires an image input in standalone mode.')
    }

    const basePrompt = readOptionalStringInput(ctx.inputs, 'prompt')
    if (!basePrompt) {
      throw new Error('Video generation requires a motion prompt.')
    }
    const { artStyle, artStylePrompt } = resolveWorkflowArtStylePrompt(ctx.config.artStyle, ctx.locale)
    const prompt = applyWorkflowArtStyleToPrompt({
      prompt: basePrompt,
      artStylePrompt,
      locale: ctx.locale,
      mode: 'video',
    })

    const userConfig = await getUserModelConfig(ctx.userId)
    const capabilityOptions = resolveModelCapabilityGenerationOptions({
      modelType: 'video',
      modelKey: videoModel,
      capabilityDefaults: userConfig.capabilityDefaults,
    })

    const duration = readOptionalNumberConfig(ctx.config, 'duration')
    const aspectRatio = readConfigString(ctx.config, 'aspectRatio')
    const result = await generateVideo(ctx.userId, videoModel, inputImage, {
      prompt,
      ...(duration !== null ? { duration } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...capabilityOptions,
    })
    if (!result.success) {
      throw new Error(result.error || 'Video generation failed')
    }

    const resolved = await resolveStandaloneGeneratedMediaSource({
      result,
      userId: ctx.userId,
      mediaType: 'video',
    })
    const mediaRef = await persistStandaloneGeneratedMedia({
      nodeId: ctx.nodeId,
      nodeType: ctx.nodeType,
      mediaType: 'video',
      source: resolved.source,
      ...(resolved.downloadHeaders ? { downloadHeaders: resolved.downloadHeaders } : {}),
    })

    return {
      outputs: {
        video: mediaRef.url,
        videoUrl: mediaRef.url,
        videoMediaId: mediaRef.id,
      },
      message: 'Video generated',
      metadata: {
        mode: 'standalone',
        videoModel,
        duration,
        aspectRatio: aspectRatio || null,
        artStyle,
        artStylePrompt,
      },
    }
  }
  if (!ctx.projectId) {
    throw new Error('Video generation workspace bridge requires projectId.')
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

  const videoModel = (ctx.config.model as string) || ctx.modelConfig.videoModel
  if (!videoModel) {
    throw new Error('Video model not configured. Set a model in node settings or project config.')
  }
  const { artStyle } = resolveWorkflowArtStylePrompt(ctx.config.artStyle, ctx.locale)

  const videoPayload = {
    videoModel,
    storyboardId: panel.storyboardId,
    panelIndex: panel.panelIndex,
    ...ctx.config,
    ...(artStyle ? { artStyle } : {}),
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
    metadata: { videoModel, panelId: ctx.panelId, deduped: result.deduped, artStyle: artStyle || null },
  }
}
