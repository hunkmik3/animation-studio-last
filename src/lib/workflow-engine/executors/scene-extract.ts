import { chatCompletion } from '@/lib/llm/chat-completion'
import type { NodeExecutor } from './types'
import { extractJSON } from './types'

/**
 * Scene / Location Extract executor.
 *
 * Extracts scenes and locations from input text using LLM.
 *
 * ## Production parity notes
 *
 * The original pipeline uses `handleAnalyzeNovelTask` which runs location
 * extraction in parallel with character extraction using:
 * 1. i18n prompt template (PROMPT_IDS.NP_SELECT_LOCATION)
 * 2. executeAiTextStep with streaming callbacks
 * 3. Persists NovelPromotionLocation + LocationImage records to DB
 * 4. Filters out invalid/abstract locations (幻想, 抽象, etc.)
 * 5. Dedup against existing project library
 *
 * This workflow executor:
 * - Uses the SAME chatCompletion() LLM infrastructure
 * - Returns structured data for downstream nodes (no DB persistence)
 * - User can customize the extraction prompt
 *
 * Current status: TEMPORARY SIMPLIFIED — default prompt is simpler
 * than the production i18n template. Same upgrade path as character-extract.
 */
export const executeSceneExtract: NodeExecutor = async (ctx) => {
  const inputText = (ctx.inputs.text as string) || ''

  if (!inputText) {
    return {
      outputs: { scenes: [], summary: 'No text input provided' },
    }
  }

  const model = (ctx.config.model as string) || ctx.projectModelConfig.analysisModel
  if (!model) {
    throw new Error('No AI model configured. Set a model in node settings or project config.')
  }

  const promptTemplate = (ctx.config.prompt as string) ||
    `Extract all scenes and locations from the following text. For each location provide a JSON object with these fields:
- name (string): location name
- description (string): detailed visual description of the location
- atmosphere (string): mood, lighting, weather
- time_of_day (string): if mentioned (dawn/day/dusk/night)
- interior_exterior (string): "interior" or "exterior"
- key_objects (string[]): notable objects or landmarks in the scene

Text:
{input}

IMPORTANT: Output ONLY a valid JSON array of scene objects. No other text.`

  const userPrompt = promptTemplate.replace('{input}', inputText)

  const completion = await chatCompletion(ctx.userId, model, [
    { role: 'system', content: 'You are an expert story analyst specializing in setting and location analysis. Always respond with valid JSON.' },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.3, projectId: ctx.projectId, reasoning: false })

  const text = completion.choices[0]?.message?.content || '[]'
  const parsed = extractJSON(text)
  const scenes = Array.isArray(parsed) ? parsed : []

  return {
    outputs: {
      scenes,
      summary: `Extracted ${scenes.length} scenes`,
    },
    temporaryImplementation: true,
    parityNotes: 'Default prompt is simpler than production i18n template (NP_SELECT_LOCATION). ' +
      'Production version also persists LocationImage records with multiple descriptions per location. ' +
      'Future: offer production prompt as preset.',
    metadata: { model, sceneCount: scenes.length },
  }
}
