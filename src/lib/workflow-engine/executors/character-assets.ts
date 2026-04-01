import { prisma } from '@/lib/prisma'
import { attachMediaFieldsToGlobalCharacter } from '@/lib/media/attach'
import {
  buildWorkflowCharacterAssetOutputs,
  type WorkflowCharacterReferenceSource,
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

export const executeCharacterAssets: NodeExecutor = async (ctx) => {
  const selectedCharacterIds = parseSelectedIds(ctx.config.selectedCharacterIds)
  if (selectedCharacterIds.length === 0) {
    const outputs = buildWorkflowCharacterAssetOutputs([])
    return {
      outputs,
      message: outputs.summary,
    }
  }

  const characters = await prisma.globalCharacter.findMany({
    where: {
      userId: ctx.userId,
      id: { in: selectedCharacterIds },
    },
    include: {
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
      },
    },
  })

  const attachedCharacters = await Promise.all(
    characters.map((character) => attachMediaFieldsToGlobalCharacter(character)),
  )
  const characterById = new Map<string, WorkflowCharacterReferenceSource>(
    attachedCharacters.map((character) => [character.id, character]),
  )

  const missingIds = selectedCharacterIds.filter((characterId) => !characterById.has(characterId))
  if (missingIds.length > 0) {
    throw new Error(`Character asset selection is stale or unauthorized: ${missingIds.join(', ')}`)
  }

  const orderedCharacters = selectedCharacterIds.map((characterId) => characterById.get(characterId)!)
  const outputs = buildWorkflowCharacterAssetOutputs(orderedCharacters)

  return {
    outputs,
    message: outputs.summary,
  }
}
