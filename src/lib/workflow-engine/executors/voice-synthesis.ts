import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { estimateVoiceLineMaxSeconds } from '@/lib/voice/generate-voice-line'
import { hasVoiceLineAudioOutput } from '@/lib/task/has-output'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { generateAudio } from '@/lib/generator-api'
import type { NodeExecutor } from './types'
import {
  persistStandaloneGeneratedMedia,
  resolveStandaloneGeneratedMediaSource,
} from './standalone-generation'

type CharacterVoiceRow = {
  name: string
  customVoiceUrl: string | null
}

type SpeakerVoiceMap = Record<string, { audioUrl?: string | null }>

function parseSpeakerVoices(raw: string | null | undefined): SpeakerVoiceMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as SpeakerVoiceMap
  } catch {
    return {}
  }
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function matchCharacterBySpeaker(
  speaker: string,
  characters: CharacterVoiceRow[],
): CharacterVoiceRow | null {
  const normalizedSpeaker = normalizeText(speaker)
  const matched = characters.find((character) => normalizeText(character.name) === normalizedSpeaker)
  return matched || null
}

function hasSpeakerReferenceVoice(
  speaker: string,
  characters: CharacterVoiceRow[],
  speakerVoices: SpeakerVoiceMap,
): boolean {
  const character = matchCharacterBySpeaker(speaker, characters)
  if (character?.customVoiceUrl && character.customVoiceUrl.trim().length > 0) return true
  const speakerVoice = speakerVoices[speaker]
  return Boolean(speakerVoice?.audioUrl && speakerVoice.audioUrl.trim().length > 0)
}

function readConfigString(config: Record<string, unknown>, key: string): string {
  const raw = config[key]
  if (typeof raw !== 'string') return ''
  return raw.trim()
}

function readOptionalRate(config: Record<string, unknown>): number | null {
  const raw = config.rate
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return raw
}

/**
 * Voice Synthesis executor — production bridge to VOICE_LINE worker pipeline.
 *
 * Uses the same task type and lifecycle as workspace voice generation:
 * submitTask(VOICE_LINE) -> voice.worker.ts -> generateVoiceLine()
 *
 * Current scope intentionally requires explicit episode/line context so the node
 * operates on real project voice-line records and keeps parity with production
 * data semantics (speaker mapping, reference voice, audio persistence).
 */
export const executeVoiceSynthesis: NodeExecutor = async (ctx) => {
  const episodeId = readConfigString(ctx.config, 'episodeId')
  const lineId = readConfigString(ctx.config, 'lineId')
  const audioModel = readConfigString(ctx.config, 'audioModel')
  const voice = readConfigString(ctx.config, 'voice')
  const rate = readOptionalRate(ctx.config)
  const updateLineContentFromInput = ctx.config.updateLineContentFromInput !== false
  const inputText = typeof ctx.inputs.text === 'string' ? ctx.inputs.text.trim() : ''

  if (audioModel && !parseModelKeyStrict(audioModel)) {
    throw new Error('Audio model key is invalid. Use provider::modelId format.')
  }

  const usesWorkspaceContext = episodeId.length > 0 || lineId.length > 0
  if (usesWorkspaceContext && (!episodeId || !lineId)) {
    throw new Error('Voice synthesis has a partial workspace binding. Set both episodeId and lineId or clear both to run standalone.')
  }

  if (!usesWorkspaceContext) {
    if (!audioModel) {
      throw new Error('Standalone voice synthesis requires audioModel in node settings.')
    }
    if (!inputText) {
      throw new Error('Standalone voice synthesis requires text input.')
    }

    const result = await generateAudio(ctx.userId, audioModel, inputText, {
      ...(voice ? { voice } : {}),
      ...(rate !== null ? { rate } : {}),
    })
    if (!result.success) {
      throw new Error(result.error || 'Voice synthesis failed')
    }

    const resolved = await resolveStandaloneGeneratedMediaSource({
      result,
      userId: ctx.userId,
      mediaType: 'audio',
    })
    const mediaRef = await persistStandaloneGeneratedMedia({
      nodeId: ctx.nodeId,
      nodeType: ctx.nodeType,
      mediaType: 'audio',
      source: resolved.source,
      ...(resolved.downloadHeaders ? { downloadHeaders: resolved.downloadHeaders } : {}),
    })

    return {
      outputs: {
        audio: mediaRef.url,
        audioUrl: mediaRef.url,
        audioMediaId: mediaRef.id,
        content: inputText,
      },
      message: 'Voice generated',
      metadata: {
        mode: 'standalone',
        audioModel,
        voice: voice || null,
        rate,
      },
    }
  }
  if (!ctx.projectId) {
    throw new Error('Voice synthesis workspace bridge requires projectId.')
  }

  const projectData = await prisma.novelPromotionProject.findUnique({
    where: { projectId: ctx.projectId },
    select: {
      id: true,
      characters: {
        select: {
          name: true,
          customVoiceUrl: true,
        },
      },
    },
  })
  if (!projectData) {
    throw new Error('Novel promotion project not found')
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProjectId: projectData.id,
    },
    select: {
      id: true,
      speakerVoices: true,
    },
  })
  if (!episode) {
    throw new Error('Episode not found for this project')
  }

  const line = await prisma.novelPromotionVoiceLine.findFirst({
    where: {
      id: lineId,
      episodeId: episode.id,
    },
    select: {
      id: true,
      speaker: true,
      content: true,
    },
  })
  if (!line) {
    throw new Error('Voice line not found for this episode')
  }

  const speakerVoices = parseSpeakerVoices(episode.speakerVoices)
  const hasReferenceVoice = hasSpeakerReferenceVoice(
    line.speaker,
    projectData.characters || [],
    speakerVoices,
  )
  if (!hasReferenceVoice) {
    throw new Error('No reference voice configured for this speaker. Set character voice or speaker voice first.')
  }

  let effectiveContent = (line.content || '').trim()
  if (updateLineContentFromInput && inputText && inputText !== effectiveContent) {
    await prisma.novelPromotionVoiceLine.update({
      where: { id: line.id },
      data: {
        content: inputText,
        audioUrl: null,
        audioMediaId: null,
        audioDuration: null,
      },
    })
    effectiveContent = inputText
  }

  if (!effectiveContent) {
    throw new Error('Voice line content is empty. Provide input text or update the voice line first.')
  }

  const payload: Record<string, unknown> = {
    episodeId: episode.id,
    lineId: line.id,
    maxSeconds: estimateVoiceLineMaxSeconds(effectiveContent),
  }
  if (audioModel) payload.audioModel = audioModel

  const hasOutputAtStart = await hasVoiceLineAudioOutput(line.id)

  const result = await submitTask({
    userId: ctx.userId,
    locale: ctx.locale,
    requestId: ctx.requestId || undefined,
    projectId: ctx.projectId,
    episodeId: episode.id,
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'NovelPromotionVoiceLine',
    targetId: line.id,
    payload: withTaskUiPayload(payload, { hasOutputAtStart }),
    dedupeKey: `voice_line:${line.id}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, payload),
  })

  return {
    outputs: {},
    async: true,
    taskId: result.taskId,
    message: 'Voice synthesis task submitted',
    temporaryImplementation: true,
    parityNotes: 'Near parity bridge to production VOICE_LINE task path. Current workflow node runs one explicit voice line per execution (episodeId + lineId).',
    metadata: {
      episodeId: episode.id,
      lineId: line.id,
      audioModel: audioModel || null,
      deduped: result.deduped,
    },
  }
}
