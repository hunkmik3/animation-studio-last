import { chatCompletion } from '@/lib/llm/chat-completion'
import type { NodeExecutor } from './types'
import {
  normalizeScenes,
  parseSceneExtractionResponse,
  resolveScenePrompt,
  type ExtractionPromptMode,
} from './extraction-bridge'

/**
 * Scene / Location Extract executor — NEAR PARITY BRIDGE.
 *
 * Uses production-grade extraction assets by default:
 * - Prompt template: NP_SELECT_LOCATION
 * - Robust JSON parsing fallbacks
 * - Invalid-location filtering and dedupe
 * - Location description normalization
 *
 * Remaining gap vs worker path:
 * - No DB-backed location/image persistence inside this executor
 * - No worker progress callbacks; workflow executes via route call
 */
function toMaxItems(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  if (rounded < 1) return 1
  return rounded
}

function parityNoteForPromptMode(mode: ExtractionPromptMode): string {
  if (mode === 'custom-override') {
    return 'Custom prompt override enabled. Filtering/normalization/dedupe still use production-grade bridge helpers, but extraction quality may diverge from the production template.'
  }
  return 'Near parity bridge: uses production prompt template (NP_SELECT_LOCATION), production invalid-location filtering, location description normalization, and alias-aware dedupe. Remaining gap vs worker path: no DB-backed location persistence/images creation.'
}

export const executeSceneExtract: NodeExecutor = async (ctx) => {
  const inputText = (ctx.inputs.text as string) || ''
  if (!inputText.trim()) {
    return {
      outputs: { scenes: [], locations: [], summary: 'No text input provided' },
    }
  }

  const model = (ctx.config.model as string) || ctx.projectModelConfig.analysisModel
  if (!model) {
    throw new Error('No AI model configured. Set a model in node settings or project config.')
  }

  const promptResolution = resolveScenePrompt({
    locale: ctx.locale,
    inputText,
    promptOverride: ctx.config.prompt,
    configLocationsLibInfo: ctx.config.locationsLibInfo,
    inputScenes: ctx.inputs.scenes,
  })
  const temperature = typeof ctx.config.temperature === 'number' ? ctx.config.temperature : 0.7
  const maxScenes = toMaxItems(ctx.config.maxScenes, 30)

  const completion = await chatCompletion(
    ctx.userId,
    model,
    [
      { role: 'system', content: 'You are a location asset extraction specialist. Return strict JSON only.' },
      { role: 'user', content: promptResolution.prompt },
    ],
    {
      temperature,
      projectId: ctx.projectId,
      action: 'workflow_scene_extract',
      reasoning: false,
    },
  )

  const responseText = completion.choices[0]?.message?.content || '{}'
  const parsed = parseSceneExtractionResponse(responseText)
  const normalizedScenes = normalizeScenes(parsed.rawLocations)

  const warnings = [...parsed.warnings]
  if (promptResolution.usedLegacyDefaultPrompt) {
    warnings.push('Legacy scene prompt override matched old default and was auto-upgraded to production template.')
  }

  const scenes = normalizedScenes.slice(0, maxScenes)
  if (normalizedScenes.length > scenes.length) {
    warnings.push(`Trimmed extracted scenes to maxScenes=${maxScenes}.`)
  }

  return {
    outputs: {
      scenes,
      locations: scenes,
      summary: `Extracted ${scenes.length} scenes`,
      warnings,
    },
    temporaryImplementation: true,
    parityNotes: parityNoteForPromptMode(promptResolution.promptMode),
    metadata: {
      model,
      promptMode: promptResolution.promptMode,
      parseMode: parsed.parseMode,
      sceneCount: scenes.length,
      warningCount: warnings.length,
    },
  }
}
