import { describe, expect, it } from 'vitest'
import { getArtStylePrompt } from '@/lib/constants'
import {
  applyWorkflowArtStyleToPrompt,
  buildStoryboardStyleDirective,
  normalizeWorkflowArtStyle,
  resolveWorkflowArtStylePrompt,
} from '@/lib/workflow-engine/art-style'

describe('workflow art style helpers', () => {
  it('normalizes both shared and legacy workflow style values', () => {
    expect(normalizeWorkflowArtStyle('japanese-anime')).toBe('japanese-anime')
    expect(normalizeWorkflowArtStyle('anime')).toBe('japanese-anime')
    expect(normalizeWorkflowArtStyle('comic')).toBe('american-comic')
    expect(normalizeWorkflowArtStyle('')).toBeNull()
    expect(normalizeWorkflowArtStyle('unknown-style')).toBeNull()
  })

  it('resolves style prompts and appends them to image/video prompts', () => {
    const imageStyle = resolveWorkflowArtStylePrompt('realistic', 'en')
    const videoStyle = resolveWorkflowArtStylePrompt('realistic', 'zh')

    expect(imageStyle).toEqual({
      artStyle: 'realistic',
      artStylePrompt: getArtStylePrompt('realistic', 'en'),
    })
    expect(videoStyle).toEqual({
      artStyle: 'realistic',
      artStylePrompt: getArtStylePrompt('realistic', 'zh'),
    })

    expect(applyWorkflowArtStyleToPrompt({
      prompt: 'Hero stands on the rooftop',
      artStylePrompt: imageStyle.artStylePrompt,
      locale: 'en',
      mode: 'image',
    })).toBe(`Hero stands on the rooftop, overall visual style: ${imageStyle.artStylePrompt}`)

    expect(applyWorkflowArtStyleToPrompt({
      prompt: '镜头缓慢推进',
      artStylePrompt: videoStyle.artStylePrompt,
      locale: 'zh',
      mode: 'video',
    })).toBe(`镜头缓慢推进，整体视频视觉风格：${videoStyle.artStylePrompt}`)
  })

  it('builds storyboard directives that keep the selected style explicit', () => {
    const stylePrompt = getArtStylePrompt('japanese-anime', 'en')
    expect(buildStoryboardStyleDirective({
      artStylePrompt: stylePrompt,
      locale: 'en',
    })).toBe(
      `Target visual style: ${stylePrompt}. Keep this style consistent across panel descriptions, shot design, character presentation, and environment mood.`,
    )
  })
})
