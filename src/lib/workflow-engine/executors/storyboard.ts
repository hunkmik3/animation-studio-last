import { chatCompletion } from '@/lib/llm/chat-completion'
import { getCompletionParts } from '@/lib/llm/completion-parts'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'
import {
  runScriptToStoryboardOrchestrator,
  type ScriptToStoryboardStepMeta,
  type ScriptToStoryboardStepOutput,
} from '@/lib/novel-promotion/script-to-storyboard/orchestrator'
import type { CharacterAsset, LocationAsset } from '@/lib/storyboard-phases'
import type { NodeExecutor } from './types'

/**
 * Storyboard Generator executor — PRODUCTION BRIDGE.
 *
 * Bridges directly to the production 4-phase orchestrator:
 *   runScriptToStoryboardOrchestrator()
 *
 * The orchestrator runs:
 *   Phase 1 (Plan):           Panel layout with descriptions, locations, characters,
 *                              shot_type, camera_move, source_text.
 *   Phase 2A (Cinematography): PhotographyRule per panel — composition, lighting,
 *                              colorPalette, atmosphere, technicalNotes.
 *   Phase 2B (Acting):        ActingDirection per panel — character-level acting notes.
 *   Phase 3 (Detail):         Refined panels with video_prompt, filtered invalid panels.
 *
 * Output per panel matches production shape:
 *   panel_number, description, location, source_text, characters,
 *   shot_type, camera_move, video_prompt, duration,
 *   photographyPlan: { composition, lighting, colorPalette, atmosphere, technicalNotes },
 *   actingNotes (per-character acting directions)
 *
 * ## How the bridge works
 *
 * The production orchestrator accepts a `runStep` callback that calls the LLM.
 * In the worker, this callback wraps executeAiTextStep + task progress reporting.
 * Here, we provide a lightweight runStep using chatCompletion directly —
 * same LLM call path, minus worker-specific task lifecycle.
 *
 * ## What's customizable
 * - Model: via node config or project config
 * - Temperature: via node config
 * - Reasoning: via node config (default true, matching production)
 *
 * ## What's locked for parity
 * - Prompt templates: uses same i18n production templates (not customizable)
 * - Phase structure: 4-phase pipeline (not reducible to single-pass)
 * - Panel filtering logic: same as production
 *
 * ## Remaining gap vs production
 * - Production runs inside BullMQ worker with task progress reporting
 * - Production has withInternalLLMStreamCallbacks for observability
 * - Production wraps in executePipelineGraph with checkpoint/retry at graph level
 * - Voice analysis (5th step) is NOT included — that's a separate node concern
 * - Multiple clips: production processes episode clips in parallel;
 *   workflow processes input text as a single clip
 *
 * Parity: NEAR PARITY (same 4-phase orchestration, same prompts, same merge logic)
 */
export const executeStoryboard: NodeExecutor = async (ctx) => {
  const inputText = (ctx.inputs.text as string) || ''
  if (!inputText.trim()) {
    throw new Error('Input text is required for storyboard generation.')
  }

  const model = (ctx.config.model as string) || ctx.projectModelConfig.analysisModel
  if (!model) {
    throw new Error('No AI model configured. Set a model in node settings or project config.')
  }

  const temperature = typeof ctx.config.temperature === 'number'
    ? ctx.config.temperature
    : undefined
  const reasoning = ctx.config.reasoning !== false

  // ── Adapt workflow inputs to orchestrator's CharacterAsset[] / LocationAsset[] ──
  const characters = adaptCharacters(ctx.inputs.characters)
  const locations = adaptLocations(ctx.inputs.scenes)

  // ── Build a single-clip input from the workflow text ──
  // Production processes multiple episode clips; workflow wraps the full text as one clip.
  const clipCharacterNames = characters.map(c => c.name)
  const clipLocation = locations.length > 0 ? locations[0].name : null

  const clips = [{
    id: ctx.nodeId,
    content: inputText,
    summary: null,
    characters: clipCharacterNames.length > 0 ? JSON.stringify(clipCharacterNames) : null,
    location: clipLocation,
    screenplay: null,
  }]

  // ── Load production i18n prompt templates ──
  const promptTemplates = {
    phase1PlanTemplate: getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_PLAN, ctx.locale),
    phase2CinematographyTemplate: getPromptTemplate(PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER, ctx.locale),
    phase2ActingTemplate: getPromptTemplate(PROMPT_IDS.NP_AGENT_ACTING_DIRECTION, ctx.locale),
    phase3DetailTemplate: getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL, ctx.locale),
  }

  // ── Build runStep callback — lightweight LLM bridge (no worker dependencies) ──
  const runStep = async (
    meta: ScriptToStoryboardStepMeta,
    prompt: string,
    action: string,
    _maxOutputTokens: number,
  ): Promise<ScriptToStoryboardStepOutput> => {
    const completion = await chatCompletion(ctx.userId, model, [
      { role: 'user', content: prompt },
    ], {
      temperature,
      reasoning,
      reasoningEffort: 'high',
      projectId: ctx.projectId,
      action,
      streamStepId: meta.stepId,
      streamStepAttempt: meta.stepAttempt || 1,
      streamStepTitle: meta.stepTitle,
      streamStepIndex: meta.stepIndex,
      streamStepTotal: meta.stepTotal,
    })

    const parts = getCompletionParts(completion)
    return {
      text: parts.text,
      reasoning: parts.reasoning,
    }
  }

  // ── Call production orchestrator ──
  const result = await runScriptToStoryboardOrchestrator({
    clips,
    novelPromotionData: { characters, locations },
    promptTemplates,
    runStep,
  })

  // ── Transform orchestrator output into workflow output contract ──
  const allPanels = result.clipPanels.flatMap(cp => cp.finalPanels)
  const panels = allPanels.map((panel, index) => ({
    panelIndex: index,
    panel_number: panel.panel_number,
    description: panel.description || '',
    location: panel.location || '',
    source_text: panel.source_text || '',
    characters: panel.characters || [],
    shot_type: panel.shot_type || '',
    camera_move: panel.camera_move || '',
    video_prompt: panel.video_prompt || '',
    duration: panel.duration || 0,
    scene_type: panel.scene_type || '',
    photographyPlan: panel.photographyPlan || null,
    actingNotes: panel.actingNotes || null,
    // Backwards-compat aliases for downstream nodes
    imagePrompt: buildImagePrompt(panel),
    videoPrompt: panel.video_prompt || '',
    shotType: panel.shot_type || '',
  }))

  return {
    outputs: {
      panels,
      summary: `Generated ${panels.length} storyboard panels (4-phase orchestrator)`,
    },
    metadata: {
      model,
      panelCount: panels.length,
      clipCount: result.summary.clipCount,
      totalStepCount: result.summary.totalStepCount,
      reasoning,
      pipelineMode: '4-phase-orchestrator',
    },
  }
}

// ── Input adapters ──

/**
 * Adapt workflow character input to production CharacterAsset[] shape.
 *
 * Upstream character-extract nodes output:
 *   [{ name, age, gender, appearance, personality }]
 *
 * Production CharacterAsset expects:
 *   { name, appearances?: [{ changeReason, description }] }
 */
function adaptCharacters(raw: unknown): CharacterAsset[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : parseJsonSafe(raw)
  if (!Array.isArray(arr)) return []

  return arr
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(item => {
      const name = String(item.name || item.characterName || 'Unknown')
      const aliases = toStringArray(item.aliases)
      const personalityTags = toStringArray(item.personality_tags)
      const visualKeywords = toStringArray(item.visual_keywords)
      const descParts: string[] = []
      if (item.introduction) descParts.push(String(item.introduction))
      if (item.appearance) descParts.push(String(item.appearance))
      if (item.primary_identifier) descParts.push(`Identifier: ${String(item.primary_identifier)}`)
      if (visualKeywords.length > 0) descParts.push(`Visual keywords: ${visualKeywords.join(', ')}`)
      if (item.age_range || item.age) descParts.push(`Age: ${String(item.age_range || item.age)}`)
      if (item.gender) descParts.push(`Gender: ${String(item.gender)}`)
      if (personalityTags.length > 0) descParts.push(`Personality: ${personalityTags.join(', ')}`)
      if (item.personality && personalityTags.length === 0) descParts.push(`Personality: ${String(item.personality)}`)
      if (aliases.length > 0) descParts.push(`Aliases: ${aliases.join(', ')}`)
      const fallbackDescription = descParts.join('. ') || null

      const expectedAppearances = Array.isArray(item.expected_appearances)
        ? item.expected_appearances
            .filter((appearance): appearance is Record<string, unknown> =>
              typeof appearance === 'object' && appearance !== null,
            )
            .map((appearance, index) => {
              const changeReason = String(
                appearance.change_reason ||
                appearance.changeReason ||
                `Appearance ${index + 1}`,
              )
              const appearanceDescription = String(
                appearance.description ||
                appearance.descriptions ||
                fallbackDescription ||
                '',
              )
              return {
                changeReason,
                description: appearanceDescription || null,
                descriptions: null,
                selectedIndex: null,
              }
            })
        : []

      const appearances = expectedAppearances.length > 0
        ? expectedAppearances
        : (fallbackDescription
            ? [{ changeReason: null, description: fallbackDescription, descriptions: null, selectedIndex: null }]
            : [])

      return {
        name,
        appearances,
      }
    })
}

/**
 * Adapt workflow scene/location input to production LocationAsset[] shape.
 *
 * Upstream scene-extract nodes output:
 *   [{ name, description, atmosphere }]
 *
 * Production LocationAsset expects:
 *   { name, images?: [{ isSelected, description }] }
 */
function adaptLocations(raw: unknown): LocationAsset[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : parseJsonSafe(raw)
  if (!Array.isArray(arr)) return []

  return arr
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(item => {
      const name = String(item.name || item.locationName || 'Unknown')
      const descriptions = toStringArray(item.descriptions)
      const firstDescription = descriptions[0] || (item.description ? String(item.description) : '')
      const descParts: string[] = []
      if (firstDescription) descParts.push(firstDescription)
      if (item.summary) descParts.push(`Summary: ${String(item.summary)}`)
      if (item.atmosphere) descParts.push(`Atmosphere: ${String(item.atmosphere)}`)
      if (item.time_of_day) descParts.push(`Time: ${String(item.time_of_day)}`)
      if (item.interior_exterior) descParts.push(`Space: ${String(item.interior_exterior)}`)
      if (item.has_crowd) descParts.push('Crowd scene')
      if (item.crowd_description) descParts.push(`Crowd: ${String(item.crowd_description)}`)
      const description = descParts.join('. ') || null
      const images = descriptions.length > 0
        ? descriptions.map((desc, index) => ({
            isSelected: index === 0,
            description: desc,
          }))
        : (description ? [{ isSelected: true, description }] : [])

      return {
        name,
        images,
      }
    })
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function parseJsonSafe(value: unknown): unknown {
  if (typeof value !== 'string') return null
  try { return JSON.parse(value) }
  catch { return null }
}

/**
 * Build an image prompt from the rich panel data produced by the orchestrator.
 * Combines description, photographyPlan, and character context into a prompt
 * suitable for image generation downstream nodes.
 */
function buildImagePrompt(panel: Record<string, unknown>): string {
  const parts: string[] = []
  if (panel.description) parts.push(String(panel.description))

  const photo = panel.photographyPlan as Record<string, unknown> | undefined
  if (photo) {
    if (photo.composition) parts.push(`Composition: ${photo.composition}`)
    if (photo.lighting) parts.push(`Lighting: ${photo.lighting}`)
    if (photo.atmosphere) parts.push(`Atmosphere: ${photo.atmosphere}`)
    if (photo.colorPalette) parts.push(`Color palette: ${photo.colorPalette}`)
  }

  if (panel.shot_type) parts.push(`Shot: ${panel.shot_type}`)
  if (panel.location) parts.push(`Location: ${panel.location}`)

  return parts.join('. ')
}
