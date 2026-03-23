import { describe, expect, it } from 'vitest'
import {
  getWorkflowModelPickerOptions,
  resolveWorkflowModelPickerMediaType,
} from '@/features/workflow-editor/model-picker'

describe('workflow model picker helpers', () => {
  it('maps workflow node types to the correct model media type', () => {
    expect(resolveWorkflowModelPickerMediaType('llm-prompt', 'model')).toBe('llm')
    expect(resolveWorkflowModelPickerMediaType('storyboard', 'model')).toBe('llm')
    expect(resolveWorkflowModelPickerMediaType('image-generate', 'model')).toBe('image')
    expect(resolveWorkflowModelPickerMediaType('video-generate', 'model')).toBe('video')
    expect(resolveWorkflowModelPickerMediaType('voice-synthesis', 'audioModel')).toBe('audio')
  })

  it('returns only the options for the requested media type', () => {
    const models = {
      llm: [{ value: 'google::gemini-3-flash-preview', label: 'Gemini 3 Flash' }],
      image: [{ value: 'google::imagen-4.0-generate-001', label: 'Imagen 4' }],
      video: [{ value: 'google::veo-3.1-generate-preview', label: 'Veo 3.1' }],
      audio: [{ value: 'qwen::cosyvoice', label: 'CosyVoice' }],
      lipsync: [],
    }

    expect(getWorkflowModelPickerOptions(models, 'image')).toEqual(models.image)
    expect(getWorkflowModelPickerOptions(models, 'llm')).toEqual(models.llm)
    expect(getWorkflowModelPickerOptions(undefined, 'video')).toEqual([])
  })
})
