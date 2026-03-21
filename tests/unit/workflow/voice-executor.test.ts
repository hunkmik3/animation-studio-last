import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeExecutorContext } from '@/lib/workflow-engine/executors'
import { TASK_TYPE } from '@/lib/task/types'

const mockSubmitTask = vi.fn()
const mockGenerateAudio = vi.fn()
const mockProcessMediaResult = vi.fn()
const mockEnsureMediaObjectFromStorageKey = vi.fn()
const mockHasVoiceLineAudioOutput = vi.fn()
const mockBuildDefaultTaskBillingInfo = vi.fn(() => ({ source: 'test' }))
const mockWithTaskUiPayload = vi.fn((payload: Record<string, unknown>) => payload)

const mockNovelPromotionProjectFindUnique = vi.fn()
const mockNovelPromotionEpisodeFindFirst = vi.fn()
const mockNovelPromotionVoiceLineFindFirst = vi.fn()
const mockNovelPromotionVoiceLineUpdate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionProject: {
      findUnique: mockNovelPromotionProjectFindUnique,
    },
    novelPromotionEpisode: {
      findFirst: mockNovelPromotionEpisodeFindFirst,
    },
    novelPromotionVoiceLine: {
      findFirst: mockNovelPromotionVoiceLineFindFirst,
      update: mockNovelPromotionVoiceLineUpdate,
    },
  },
}))

vi.mock('@/lib/task/submitter', () => ({
  submitTask: mockSubmitTask,
}))

vi.mock('@/lib/generator-api', () => ({
  generateAudio: mockGenerateAudio,
}))

vi.mock('@/lib/media-process', () => ({
  processMediaResult: mockProcessMediaResult,
}))

vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: mockEnsureMediaObjectFromStorageKey,
}))

vi.mock('@/lib/task/has-output', () => ({
  hasVoiceLineAudioOutput: mockHasVoiceLineAudioOutput,
}))

vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: mockBuildDefaultTaskBillingInfo,
}))

vi.mock('@/lib/task/ui-payload', () => ({
  withTaskUiPayload: mockWithTaskUiPayload,
}))

function createContext(overrides?: Partial<NodeExecutorContext>): NodeExecutorContext {
  return {
    nodeId: 'node_voice',
    nodeType: 'voice-synthesis',
    config: {
      episodeId: 'episode_1',
      lineId: 'line_1',
      audioModel: 'fal::resemble/index-tts-v2',
      updateLineContentFromInput: true,
    },
    inputs: {
      text: 'Updated voice line content',
    },
    projectId: 'project_1',
    userId: 'user_1',
    locale: 'en',
    modelConfig: {
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
    },
    requestId: 'req_voice_test',
    ...overrides,
  }
}

describe('workflow voice synthesis executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNovelPromotionProjectFindUnique.mockResolvedValue({
      id: 'np_project_1',
      characters: [
        { name: 'Narrator', customVoiceUrl: 'cos/voice-reference.wav' },
      ],
    })
    mockNovelPromotionEpisodeFindFirst.mockResolvedValue({
      id: 'episode_1',
      speakerVoices: null,
    })
    mockNovelPromotionVoiceLineFindFirst.mockResolvedValue({
      id: 'line_1',
      speaker: 'Narrator',
      content: 'Old content',
    })
    mockNovelPromotionVoiceLineUpdate.mockResolvedValue({})
    mockHasVoiceLineAudioOutput.mockResolvedValue(false)
    mockSubmitTask.mockResolvedValue({
      taskId: 'task_voice_1',
      deduped: false,
    })
    mockGenerateAudio.mockResolvedValue({
      success: true,
      audioUrl: 'https://cdn.example.com/generated.mp3',
    })
    mockProcessMediaResult.mockResolvedValue('workflow/voice/generated.mp3')
    mockEnsureMediaObjectFromStorageKey.mockResolvedValue({
      id: 'media_audio_1',
      publicId: 'pub_audio_1',
      url: '/m/pub_audio_1',
      mimeType: 'audio/mpeg',
      sizeBytes: 2048,
      width: null,
      height: null,
      durationMs: 1200,
    })
  })

  it('submits production VOICE_LINE task and returns async task id', async () => {
    const { executeVoiceSynthesis } = await import('@/lib/workflow-engine/executors/voice-synthesis')

    const result = await executeVoiceSynthesis(createContext())

    expect(mockNovelPromotionVoiceLineUpdate).toHaveBeenCalledWith({
      where: { id: 'line_1' },
      data: {
        content: 'Updated voice line content',
        audioUrl: null,
        audioMediaId: null,
        audioDuration: null,
      },
    })
    expect(mockSubmitTask).toHaveBeenCalledTimes(1)
    const submitInput = mockSubmitTask.mock.calls[0]?.[0] as Record<string, unknown>
    expect(submitInput.type).toBe(TASK_TYPE.VOICE_LINE)
    expect(submitInput.targetType).toBe('NovelPromotionVoiceLine')
    expect(submitInput.targetId).toBe('line_1')
    expect(submitInput.projectId).toBe('project_1')
    expect(submitInput.episodeId).toBe('episode_1')
    expect(submitInput.dedupeKey).toBe('voice_line:line_1')

    expect(mockWithTaskUiPayload).toHaveBeenCalledTimes(1)
    const payloadInput = mockWithTaskUiPayload.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payloadInput.lineId).toBe('line_1')
    expect(payloadInput.episodeId).toBe('episode_1')
    expect(typeof payloadInput.maxSeconds).toBe('number')
    expect(payloadInput.audioModel).toBe('fal::resemble/index-tts-v2')

    expect(result.async).toBe(true)
    expect(result.taskId).toBe('task_voice_1')
    expect(result.message).toContain('submitted')
    expect(result.temporaryImplementation).toBe(true)
  })

  it('fails explicitly when speaker reference voice is missing', async () => {
    mockNovelPromotionProjectFindUnique.mockResolvedValue({
      id: 'np_project_1',
      characters: [],
    })
    mockNovelPromotionEpisodeFindFirst.mockResolvedValue({
      id: 'episode_1',
      speakerVoices: '{}',
    })

    const { executeVoiceSynthesis } = await import('@/lib/workflow-engine/executors/voice-synthesis')

    await expect(executeVoiceSynthesis(createContext({
      inputs: { text: '' },
    }))).rejects.toThrow('No reference voice configured')
    expect(mockSubmitTask).not.toHaveBeenCalled()
  })

  it('fails explicitly when required voice line context is missing', async () => {
    const { executeVoiceSynthesis } = await import('@/lib/workflow-engine/executors/voice-synthesis')

    await expect(executeVoiceSynthesis(createContext({
      config: {
        episodeId: '',
        lineId: '',
      },
    }))).rejects.toThrow('requires audioModel')
    expect(mockSubmitTask).not.toHaveBeenCalled()
  })

  it('generates standalone workflow audio when no workspace binding is provided', async () => {
    const { executeVoiceSynthesis } = await import('@/lib/workflow-engine/executors/voice-synthesis')

    const result = await executeVoiceSynthesis(createContext({
      projectId: null,
      config: {
        episodeId: '',
        lineId: '',
        audioModel: 'qwen::qwen-tts',
        voice: 'default',
        rate: 1.1,
        updateLineContentFromInput: false,
      },
      inputs: {
        text: 'Standalone workflow speech',
      },
    }))

    expect(mockGenerateAudio).toHaveBeenCalledWith(
      'user_1',
      'qwen::qwen-tts',
      'Standalone workflow speech',
      {
        voice: 'default',
        rate: 1.1,
      },
    )
    expect(mockProcessMediaResult).toHaveBeenCalledWith(expect.objectContaining({
      source: 'https://cdn.example.com/generated.mp3',
      type: 'audio',
      keyPrefix: 'workflow/voice-synthesis',
      targetId: 'node_voice',
    }))
    expect(mockSubmitTask).not.toHaveBeenCalled()
    expect(mockNovelPromotionProjectFindUnique).not.toHaveBeenCalled()
    expect(result.outputs).toEqual(expect.objectContaining({
      audio: '/m/pub_audio_1',
      audioUrl: '/m/pub_audio_1',
      audioMediaId: 'media_audio_1',
      content: 'Standalone workflow speech',
    }))
    expect(result.metadata).toEqual(expect.objectContaining({
      mode: 'standalone',
      audioModel: 'qwen::qwen-tts',
      voice: 'default',
      rate: 1.1,
    }))
  })

  it('fails explicitly when voice node has only partial workspace binding', async () => {
    const { executeVoiceSynthesis } = await import('@/lib/workflow-engine/executors/voice-synthesis')

    await expect(executeVoiceSynthesis(createContext({
      projectId: 'project_1',
      config: {
        episodeId: 'episode_1',
        lineId: '',
        audioModel: 'qwen::qwen-tts',
      },
      inputs: {
        text: 'Ignored because binding is invalid',
      },
    }))).rejects.toThrow('partial workspace binding')
    expect(mockGenerateAudio).not.toHaveBeenCalled()
    expect(mockSubmitTask).not.toHaveBeenCalled()
  })
})
