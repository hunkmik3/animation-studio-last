import { chatCompletion } from '@/lib/llm/chat-completion'
import type { NodeExecutor } from './types'
import {
  normalizeCharacters,
  normalizeCharacterUpdates,
  parseCharacterExtractionResponse,
  resolveCharacterPrompt,
  type ExtractionPromptMode,
} from './extraction-bridge'

/**
 * Character Extract executor — NEAR PARITY BRIDGE.
 *
 * Uses production-grade extraction assets by default:
 * - Prompt template: NP_AGENT_CHARACTER_PROFILE
 * - Robust JSON parsing fallbacks
 * - Alias-aware dedupe and profile normalization
 *
 * Remaining gap vs worker path:
 * - No DB-backed merge/update persistence inside this executor
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
    return 'Custom prompt override enabled. Parsing/normalization/dedupe still use production-grade bridge helpers, but extraction quality may diverge from the production template.'
  }
  return 'Near parity bridge: uses production prompt template (NP_AGENT_CHARACTER_PROFILE), robust JSON parsing, alias-aware dedupe, and profile normalization. Remaining gap vs worker path: no DB-backed merge/persistence for updated_characters.'
}

export const executeCharacterExtract: NodeExecutor = async (ctx) => {
  const inputText = (ctx.inputs.text as string) || ''
  if (!inputText.trim()) {
    return {
      outputs: { characters: [], updatedCharacters: [], summary: 'No text input provided' },
    }
  }

  const model = (ctx.config.model as string) || ctx.projectModelConfig.analysisModel
  if (!model) {
    throw new Error('No AI model configured. Set a model in node settings or project config.')
  }

  const promptResolution = resolveCharacterPrompt({
    locale: ctx.locale,
    inputText,
    promptOverride: ctx.config.prompt,
    configCharactersLibInfo: ctx.config.charactersLibInfo,
    inputCharacters: ctx.inputs.characters,
  })
  const temperature = typeof ctx.config.temperature === 'number' ? ctx.config.temperature : 0.7
  const maxCharacters = toMaxItems(ctx.config.maxCharacters, 20)

  const completion = await chatCompletion(
    ctx.userId,
    model,
    [
      { role: 'system', content: 'You are a casting and character-asset analyst. Return strict JSON only.' },
      { role: 'user', content: promptResolution.prompt },
    ],
    {
      temperature,
      projectId: ctx.projectId,
      action: 'workflow_character_extract',
      reasoning: false,
    },
  )

  const responseText = completion.choices[0]?.message?.content || '{}'
  const parsed = parseCharacterExtractionResponse(responseText)
  const dedupedCharacters = normalizeCharacters(parsed.rawNewCharacters, ctx.locale)
  const updatedCharacters = normalizeCharacterUpdates(parsed.rawUpdatedCharacters)

  const warnings = [...parsed.warnings]
  if (promptResolution.usedLegacyDefaultPrompt) {
    warnings.push('Legacy character prompt override matched old default and was auto-upgraded to production template.')
  }

  const characters = dedupedCharacters.slice(0, maxCharacters)
  if (dedupedCharacters.length > characters.length) {
    warnings.push(`Trimmed extracted characters to maxCharacters=${maxCharacters}.`)
  }

  return {
    outputs: {
      characters,
      updatedCharacters,
      summary: `Extracted ${characters.length} characters`,
      warnings,
    },
    temporaryImplementation: true,
    parityNotes: parityNoteForPromptMode(promptResolution.promptMode),
    metadata: {
      model,
      promptMode: promptResolution.promptMode,
      parseMode: parsed.parseMode,
      characterCount: characters.length,
      updatedCharacterCount: updatedCharacters.length,
      warningCount: warnings.length,
    },
  }
}
