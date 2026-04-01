import { prisma } from '@/lib/prisma'
import { attachMediaFieldsToGlobalLocation } from '@/lib/media/attach'
import {
  buildWorkflowLocationAssetOutputs,
  type WorkflowLocationReferenceSource,
} from '@/lib/workflow-engine/reference-assets'
import type { NodeExecutor } from './types'

function parseSelectedIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    const rawValue = value.trim()
    if (!rawValue) return []
    try {
      return parseSelectedIds(JSON.parse(rawValue) as unknown)
    } catch {
      return []
    }
  }

  return []
}

export const executeLocationAssets: NodeExecutor = async (ctx) => {
  const selectedLocationIds = parseSelectedIds(ctx.config.selectedLocationIds)
  if (selectedLocationIds.length === 0) {
    const outputs = buildWorkflowLocationAssetOutputs([])
    return {
      outputs,
      message: outputs.summary,
    }
  }

  const locations = await prisma.globalLocation.findMany({
    where: {
      userId: ctx.userId,
      id: { in: selectedLocationIds },
    },
    include: {
      images: {
        orderBy: { imageIndex: 'asc' },
      },
    },
  })

  const attachedLocations = await Promise.all(
    locations.map((location) => attachMediaFieldsToGlobalLocation(location)),
  )
  const locationById = new Map<string, WorkflowLocationReferenceSource>(
    attachedLocations.map((location) => [location.id, location]),
  )

  const missingIds = selectedLocationIds.filter((locationId) => !locationById.has(locationId))
  if (missingIds.length > 0) {
    throw new Error(`Location asset selection is stale or unauthorized: ${missingIds.join(', ')}`)
  }

  const orderedLocations = selectedLocationIds.map((locationId) => locationById.get(locationId)!)
  const outputs = buildWorkflowLocationAssetOutputs(orderedLocations)

  return {
    outputs,
    message: outputs.summary,
  }
}
