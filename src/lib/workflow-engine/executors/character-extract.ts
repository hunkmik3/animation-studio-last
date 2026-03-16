import { chatCompletion } from '@/lib/llm/chat-completion'
import type { NodeExecutor } from './types'
import { extractJSON } from './types'

/**
 * Character Extract executor.
 *
 * Extracts characters from input text using LLM with a configurable prompt.
 *
 * ## Production parity notes
 *
 * The original waoowaoo pipeline uses `handleAnalyzeNovelTask` which:
 * 1. Uses i18n prompt templates (PROMPT_IDS.NP_AGENT_CHARACTER_PROFILE)
 *    with rich structured output (role_level, archetype, personality_tags,
 *    era_period, social_class, costume_tier, visual_keywords, etc.)
 * 2. Runs via executeAiTextStep with streaming progress callbacks
 * 3. Persists results to DB (creates NovelPromotionCharacter records)
 * 4. Handles alias matching / dedup against existing project library
 * 5. Runs character + location extraction in parallel
 *
 * This workflow executor:
 * - Uses the SAME chatCompletion() LLM infrastructure (full provider support)
 * - Lets the user CUSTOMIZE the extraction prompt (more flexible)
 * - Returns structured data for downstream nodes (does NOT persist to DB)
 * - DB persistence happens via "Push to Workspace" action separately
 *
 * Current status: TEMPORARY SIMPLIFIED — the default prompt produces
 * less structured output than the production i18n template. To reach
 * full parity, a future phase should offer the production prompt as
 * a preset/default that users can then customize.
 */
export const executeCharacterExtract: NodeExecutor = async (ctx) => {
  const inputText = (ctx.inputs.text as string) || ''

  if (!inputText) {
    return {
      outputs: { characters: [], summary: 'No text input provided' },
    }
  }

  const model = (ctx.config.model as string) || ctx.projectModelConfig.analysisModel
  if (!model) {
    throw new Error('No AI model configured. Set a model in node settings or project config.')
  }

  const promptTemplate = (ctx.config.prompt as string) ||
    `Extract all characters from the following text. For each character provide a JSON object with these fields:
- name (string): character's primary name
- aliases (string[]): alternate names or nicknames
- role (string): protagonist / antagonist / supporting / minor
- description (string): brief character description
- appearance (string): physical appearance details
- personality (string): personality traits
- gender (string): if identifiable
- age_range (string): approximate age range if mentioned

Text:
{input}

IMPORTANT: Output ONLY a valid JSON array of character objects. No other text.`

  const userPrompt = promptTemplate.replace('{input}', inputText)

  const completion = await chatCompletion(ctx.userId, model, [
    { role: 'system', content: 'You are an expert story analyst specializing in character analysis. Always respond with valid JSON.' },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.3, projectId: ctx.projectId, reasoning: false })

  const text = completion.choices[0]?.message?.content || '[]'
  const parsed = extractJSON(text)
  const characters = Array.isArray(parsed) ? parsed : []

  return {
    outputs: {
      characters,
      summary: `Extracted ${characters.length} characters`,
    },
    temporaryImplementation: true,
    parityNotes: 'Default prompt is simpler than production i18n template (NP_AGENT_CHARACTER_PROFILE). ' +
      'Production version extracts: role_level, archetype, personality_tags, era_period, social_class, ' +
      'costume_tier, visual_keywords, suggested_colors. Future: offer production prompt as preset.',
    metadata: { model, characterCount: characters.length },
  }
}
