import { describe, expect, it } from 'vitest'
import { executeTextInput } from '@/lib/workflow-engine/executors/text-input'
import type { NodeExecutorContext } from '@/lib/workflow-engine/executors/types'

function createContext(params: {
  content?: string
  upstreamText?: string
}): NodeExecutorContext {
  return {
    nodeId: 'node_text_1',
    nodeType: 'text-input',
    config: { content: params.content ?? '' },
    inputs: params.upstreamText !== undefined ? { text: params.upstreamText } : {},
    projectId: 'project_1',
    userId: 'user_1',
    locale: 'en',
    projectModelConfig: {
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
    },
  }
}

describe('text-input executor', () => {
  it('uses configured content when content is provided', async () => {
    const result = await executeTextInput(createContext({
      content: 'Configured text',
      upstreamText: 'Upstream text',
    }))

    expect(result.outputs).toEqual({ text: 'Configured text' })
  })

  it('falls back to upstream text when configured content is empty', async () => {
    const result = await executeTextInput(createContext({
      content: '   ',
      upstreamText: 'Upstream fallback',
    }))

    expect(result.outputs).toEqual({ text: 'Upstream fallback' })
  })

  it('returns empty text when both config and upstream are empty', async () => {
    const result = await executeTextInput(createContext({
      content: '',
      upstreamText: '',
    }))

    expect(result.outputs).toEqual({ text: '' })
  })
})
