import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getArtStylePrompt } from '@/lib/constants'
import type { NodeExecutorContext } from '@/lib/workflow-engine/executors'

const runScriptToStoryboardOrchestratorMock = vi.fn()

vi.mock('@/lib/llm/chat-completion', () => ({
  chatCompletion: vi.fn(),
}))

vi.mock('@/lib/llm/completion-parts', () => ({
  getCompletionParts: vi.fn(() => ({ text: '', reasoning: '' })),
}))

vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: {
    NP_AGENT_STORYBOARD_PLAN: 'plan',
    NP_AGENT_CINEMATOGRAPHER: 'cinematography',
    NP_AGENT_ACTING_DIRECTION: 'acting',
    NP_AGENT_STORYBOARD_DETAIL: 'detail',
  },
  getPromptTemplate: vi.fn((promptId: string) => `template:${promptId}`),
}))

vi.mock('@/lib/novel-promotion/script-to-storyboard/orchestrator', () => ({
  runScriptToStoryboardOrchestrator: runScriptToStoryboardOrchestratorMock,
}))

function createContext(overrides?: Partial<NodeExecutorContext>): NodeExecutorContext {
  return {
    nodeId: 'storyboard_node_1',
    nodeType: 'storyboard',
    config: {
      model: 'google::gemini-2.5-pro',
      style: 'realistic',
    },
    inputs: {
      text: 'Hero enters the city at dusk.',
      characters: [],
      scenes: [],
    },
    projectId: null,
    userId: 'user_1',
    locale: 'en',
    modelConfig: {
      analysisModel: 'google::gemini-2.5-pro',
      characterModel: null,
      locationModel: null,
      storyboardModel: 'fal::flux-pro',
      editModel: null,
      videoModel: 'google::veo-3',
    },
    ...overrides,
  }
}

describe('workflow storyboard style execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runScriptToStoryboardOrchestratorMock.mockResolvedValue({
      clipPanels: [
        {
          clipId: 'storyboard_node_1',
          clipIndex: 1,
          finalPanels: [
            {
              panel_number: 1,
              description: 'Wide establishing shot',
              location: 'City Gate',
              source_text: 'Hero enters the city at dusk.',
              characters: ['Hero'],
              shot_type: 'wide',
              camera_move: 'slow push-in',
              video_prompt: 'Slow cinematic push toward the gate',
              duration: 5,
            },
          ],
        },
      ],
      summary: {
        clipCount: 1,
        totalPanelCount: 1,
        totalStepCount: 6,
      },
    })
  })

  it('passes the selected storyboard style into the production orchestrator bridge', async () => {
    const { executeStoryboard } = await import('@/lib/workflow-engine/executors/storyboard')
    const result = await executeStoryboard(createContext())

    expect(runScriptToStoryboardOrchestratorMock).toHaveBeenCalledWith(expect.objectContaining({
      styleDirective: `Target visual style: ${getArtStylePrompt('realistic', 'en')}. Keep this style consistent across panel descriptions, shot design, character presentation, and environment mood.`,
    }))
    expect(result.metadata).toEqual(expect.objectContaining({
      artStyle: 'realistic',
      artStylePrompt: getArtStylePrompt('realistic', 'en'),
    }))
    expect(result.outputs).toEqual(expect.objectContaining({
      summary: 'Generated 1 storyboard panels (4-phase orchestrator)',
      panels: [
        expect.objectContaining({
          imagePrompt: expect.stringContaining('Wide establishing shot'),
          videoPrompt: 'Slow cinematic push toward the gate',
        }),
      ],
    }))
  })
})
