import { describe, expect, it, vi } from 'vitest'
import type { NodeExecutorContext } from '@/lib/workflow-engine/executors'

const mockSubmitTask = vi.fn()
const mockBuildImageBillingPayload = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionPanel: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/task/submitter', () => ({
  submitTask: mockSubmitTask,
}))

vi.mock('@/lib/config-service', () => ({
  buildImageBillingPayload: mockBuildImageBillingPayload,
}))

vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ provider: 'test' })),
}))

vi.mock('@/lib/task/ui-payload', () => ({
  withTaskUiPayload: vi.fn((payload: Record<string, unknown>) => payload),
}))

function createContext(overrides?: Partial<NodeExecutorContext>): NodeExecutorContext {
  return {
    nodeId: 'node_1',
    nodeType: 'image-generate',
    config: {},
    inputs: {},
    projectId: 'project_1',
    userId: 'user_1',
    locale: 'en',
    projectModelConfig: {
      analysisModel: 'google/gemini-3-pro-preview',
      characterModel: null,
      locationModel: null,
      storyboardModel: 'fal-ai/flux-pro',
      editModel: null,
      videoModel: 'google/veo-3',
    },
    ...overrides,
  }
}

describe('workflow media executors explicit failure behavior', () => {
  it('fails image generation without panel linkage instead of returning mock success', async () => {
    const { executeImageGenerate } = await import('@/lib/workflow-engine/executors/image-generate')

    await expect(executeImageGenerate(createContext({
      nodeType: 'image-generate',
    }))).rejects.toThrow('requires a linked panel')
    expect(mockSubmitTask).not.toHaveBeenCalled()
    expect(mockBuildImageBillingPayload).not.toHaveBeenCalled()
  })

  it('fails video generation without panel linkage instead of returning mock success', async () => {
    const { executeVideoGenerate } = await import('@/lib/workflow-engine/executors/video-generate')

    await expect(executeVideoGenerate(createContext({
      nodeType: 'video-generate',
    }))).rejects.toThrow('requires a linked panel')
    expect(mockSubmitTask).not.toHaveBeenCalled()
  })
})

