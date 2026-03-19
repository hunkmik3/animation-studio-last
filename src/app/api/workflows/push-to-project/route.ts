import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  collectWorkflowAssetCandidates,
  getEmptyAssetMergeStats,
  mergeWorkflowCharactersIntoProject,
  mergeWorkflowScenesIntoProject,
  type WorkflowNodeExecutionStateLite,
  type WorkflowPushNode,
} from '@/lib/workflows/project-asset-merge'

interface WorkflowPushRequestBody {
  projectId?: string
  nodes?: WorkflowPushNode[]
  nodeOutputs?: Record<string, Record<string, unknown>>
  nodeExecutionStates?: Record<string, WorkflowNodeExecutionStateLite>
  applyAssetMerge?: boolean
}

type PanelPromptPatch = {
  imagePrompt?: string
  videoPrompt?: string
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readWorkspaceBinding(nodeData: Record<string, unknown>): string {
  return toStringValue(nodeData.workspaceBinding)
}

function resolvePanelIdFromNodeIdentity(nodeId: string, nodeData: Record<string, unknown>): string {
  const fromData = toStringValue(nodeData.panelId)
  if (fromData) return fromData
  if (nodeId.startsWith('imgPrompt_')) return nodeId.replace('imgPrompt_', '')
  if (nodeId.startsWith('vidPrompt_')) return nodeId.replace('vidPrompt_', '')
  if (nodeId.startsWith('img_')) return nodeId.replace('img_', '')
  if (nodeId.startsWith('vid_')) return nodeId.replace('vid_', '')
  return ''
}

function collectPanelPromptUpdates(nodes: WorkflowPushNode[]): Map<string, PanelPromptPatch> {
  const panelUpdates = new Map<string, PanelPromptPatch>()

  for (const node of nodes) {
    const nodeId = toStringValue(node.id)
    if (!nodeId) continue
    const nodeData = toRecord(node.data)
    const nodeType = toStringValue(nodeData.nodeType)
    const workspaceBinding = readWorkspaceBinding(nodeData)
    const panelId = resolvePanelIdFromNodeIdentity(nodeId, nodeData)
    const nodeConfig = toRecord(nodeData.config)
    const content = toStringValue(nodeConfig.content)
    if (!content) continue

    const isImagePromptNode = (
      workspaceBinding === 'panel-image-prompt'
      || nodeId.startsWith('imgPrompt_')
    ) && nodeType === 'text-input'
    const isVideoPromptNode = (
      workspaceBinding === 'panel-video-prompt'
      || nodeId.startsWith('vidPrompt_')
    ) && nodeType === 'text-input'

    if (isImagePromptNode) {
      if (!panelId) continue
      const patch = panelUpdates.get(panelId) || {}
      patch.imagePrompt = content
      panelUpdates.set(panelId, patch)
      continue
    }

    if (isVideoPromptNode) {
      if (!panelId) continue
      const patch = panelUpdates.get(panelId) || {}
      patch.videoPrompt = content
      panelUpdates.set(panelId, patch)
    }
  }

  return panelUpdates
}

function collectWorkspaceContextWarnings(nodes: WorkflowPushNode[]): string[] {
  const warnings = new Set<string>()

  for (const node of nodes) {
    const nodeId = toStringValue(node.id)
    if (!nodeId) continue
    const nodeData = toRecord(node.data)
    const nodeType = toStringValue(nodeData.nodeType)
    const label = toStringValue(nodeData.label) || nodeId
    if (!nodeType) continue

    if (nodeType === 'image-generate' || nodeType === 'video-generate') {
      const panelId = resolvePanelIdFromNodeIdentity(nodeId, nodeData)
      if (!panelId) {
        warnings.add(`${label} (${nodeType}) is missing panel linkage; this node should run via Pull from Workspace context.`)
      }
      continue
    }

    if (nodeType === 'voice-synthesis') {
      const config = toRecord(nodeData.config)
      const episodeId = toStringValue(config.episodeId)
      const lineId = toStringValue(config.lineId)
      if (!episodeId || !lineId) {
        warnings.add(`${label} (voice-synthesis) is missing episodeId/lineId context; voice execution requires workspace voice-line mapping.`)
      }
    }
  }

  return Array.from(warnings)
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json()) as WorkflowPushRequestBody
  const projectId = toStringValue(body.projectId)
  const nodes = Array.isArray(body.nodes) ? body.nodes : []
  const nodeOutputs = body.nodeOutputs && typeof body.nodeOutputs === 'object'
    ? body.nodeOutputs
    : undefined
  const nodeExecutionStates = body.nodeExecutionStates && typeof body.nodeExecutionStates === 'object'
    ? body.nodeExecutionStates
    : undefined
  const applyAssetMerge = body.applyAssetMerge !== false

  if (!projectId || nodes.length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: 'Missing projectId or nodes array' })
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: {
      id: true,
      novelPromotionData: {
        select: { id: true },
      },
    },
  })
  if (!project || !project.novelPromotionData) {
    throw new ApiError('NOT_FOUND', { message: 'Project not found or unauthorized' })
  }
  const projectInternalId = project.novelPromotionData.id

  const panelUpdates = collectPanelPromptUpdates(nodes)
  const contextWarnings = collectWorkspaceContextWarnings(nodes)
  const requestedPanelPromptUpdates = panelUpdates.size
  const assetCandidates = collectWorkflowAssetCandidates({
    nodes,
    nodeOutputs,
    nodeExecutionStates,
  })

  const txResult = await prisma.$transaction(async (tx) => {
    let appliedPanelPromptUpdates = 0
    let skippedPanelPromptUpdates = 0

    if (panelUpdates.size > 0) {
      for (const [panelId, patch] of panelUpdates.entries()) {
        const updateResult = await tx.novelPromotionPanel.updateMany({
          where: {
            id: panelId,
            storyboard: {
              episode: {
                novelPromotionProjectId: projectInternalId,
              },
            },
          },
          data: {
            ...(patch.imagePrompt !== undefined ? { imagePrompt: patch.imagePrompt } : {}),
            ...(patch.videoPrompt !== undefined ? { videoPrompt: patch.videoPrompt } : {}),
          },
        })
        if (updateResult.count > 0) {
          appliedPanelPromptUpdates += updateResult.count
        } else {
          skippedPanelPromptUpdates += 1
        }
      }
    }

    const assetMergeStats = getEmptyAssetMergeStats()
    if (applyAssetMerge) {
      assetMergeStats.characters = await mergeWorkflowCharactersIntoProject({
        tx,
        projectInternalId,
        characters: assetCandidates.characters,
        updatedCharacters: assetCandidates.updatedCharacters,
      })
      assetMergeStats.locations = await mergeWorkflowScenesIntoProject({
        tx,
        projectInternalId,
        scenes: assetCandidates.scenes,
      })
    }

    return {
      requestedPanelPromptUpdates,
      appliedPanelPromptUpdates,
      skippedPanelPromptUpdates,
      assetMergeStats,
    }
  })

  return NextResponse.json({
    success: true,
    updatedCount: txResult.appliedPanelPromptUpdates,
    panelPromptUpdates: txResult.appliedPanelPromptUpdates,
    panelPromptUpdatesRequested: txResult.requestedPanelPromptUpdates,
    panelPromptUpdatesSkipped: txResult.skippedPanelPromptUpdates,
    applyAssetMerge,
    assetMerge: txResult.assetMergeStats,
    warnings: contextWarnings,
  })
})
