import { describe, expect, it } from 'vitest'
import {
  isUsableNodeOutput,
  normalizeMediaOutputsForNode,
  normalizeVoiceOutputsForNode,
  resolvePanelIdFromNode,
  resolveVoiceLineTargetFromNode,
  toNodeInitialOutput,
} from '@/features/workflow-editor/execution-contract'

describe('workflow execution contract', () => {
  it('treats task markers as non-usable output', () => {
    expect(isUsableNodeOutput('image-generate', { _taskId: 'task_123' })).toBe(false)
    expect(isUsableNodeOutput('video-generate', { _taskId: 'task_456', _async: true })).toBe(false)
  })

  it('requires real media keys for media nodes', () => {
    expect(isUsableNodeOutput('image-generate', { image: '' })).toBe(false)
    expect(isUsableNodeOutput('image-generate', { image: 'https://cdn.example/image.png' })).toBe(true)
    expect(isUsableNodeOutput('video-generate', { video: '' })).toBe(false)
    expect(isUsableNodeOutput('video-generate', { video: 'https://cdn.example/video.mp4' })).toBe(true)
    expect(isUsableNodeOutput('voice-synthesis', { audio: '' })).toBe(false)
    expect(isUsableNodeOutput('voice-synthesis', { audio: 'https://cdn.example/audio.mp3' })).toBe(true)
  })

  it('keeps text node outputs usable even when text is empty', () => {
    expect(isUsableNodeOutput('text-input', { text: '' })).toBe(true)
    expect(isUsableNodeOutput('text-input', { text: 'story content' })).toBe(true)
  })

  it('normalizes panel media to canonical output keys', () => {
    expect(
      normalizeMediaOutputsForNode('image-generate', {
        imageUrl: 'https://cdn.example/i.png',
        videoUrl: null,
      }),
    ).toEqual({ image: 'https://cdn.example/i.png' })

    expect(
      normalizeMediaOutputsForNode('video-generate', {
        imageUrl: 'https://cdn.example/i.png',
        videoUrl: 'https://cdn.example/v.mp4',
      }),
    ).toEqual({ video: 'https://cdn.example/v.mp4' })
  })

  it('normalizes voice line media to canonical audio output keys', () => {
    expect(
      normalizeVoiceOutputsForNode('voice-synthesis', {
        id: 'line_1',
        audioUrl: 'https://cdn.example/audio.mp3',
        speaker: 'Narrator',
        content: 'Hello there',
        audioDuration: 4200,
      }),
    ).toEqual({
      audio: 'https://cdn.example/audio.mp3',
      lineId: 'line_1',
      speaker: 'Narrator',
      content: 'Hello there',
      audioDuration: 4200,
    })
  })

  it('resolves panel ids from explicit data and node naming', () => {
    expect(resolvePanelIdFromNode('img_panel123', {})).toBe('panel123')
    expect(resolvePanelIdFromNode('custom_node', { panelId: 'panel-explicit' })).toBe('panel-explicit')
    expect(resolvePanelIdFromNode('custom_node', {})).toBeNull()
  })

  it('resolves voice line target from node config', () => {
    expect(resolveVoiceLineTargetFromNode({
      config: {
        episodeId: 'episode_1',
        lineId: 'line_1',
      },
    })).toEqual({
      episodeId: 'episode_1',
      lineId: 'line_1',
    })
    expect(resolveVoiceLineTargetFromNode({ config: { episodeId: 'episode_1' } })).toBeNull()
  })

  it('mirrors canonical media keys to legacy preview keys', () => {
    expect(
      toNodeInitialOutput({ source: 'workspace' }, { image: 'https://cdn.example/final.png' }),
    ).toEqual({
      source: 'workspace',
      image: 'https://cdn.example/final.png',
      imageUrl: 'https://cdn.example/final.png',
    })
    expect(
      toNodeInitialOutput({}, { audio: 'https://cdn.example/final.mp3' }),
    ).toEqual({
      audio: 'https://cdn.example/final.mp3',
      audioUrl: 'https://cdn.example/final.mp3',
    })
  })
})
