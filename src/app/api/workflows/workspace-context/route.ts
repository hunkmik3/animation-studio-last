import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface WorkspaceContextEpisode {
  id: string
  name: string | null
  episodeNumber: number
}

interface WorkspaceContextPanel {
  id: string
  episodeId: string
  episodeNumber: number
  episodeName: string | null
  panelIndex: number
  panelNumber: number | null
  description: string | null
  imageUrl: string | null
  videoUrl: string | null
}

interface WorkspaceContextVoiceLine {
  id: string
  episodeId: string
  lineIndex: number
  speaker: string
  content: string
  audioUrl: string | null
  audioDuration: number | null
}

function toEpisodeLabel(episode: WorkspaceContextEpisode): string {
  const title = episode.name && episode.name.trim().length > 0
    ? episode.name.trim()
    : `Episode ${episode.episodeNumber}`
  return `E${episode.episodeNumber} · ${title}`
}

export const GET = apiHandler(async (request: NextRequest) => {
  const projectId = request.nextUrl.searchParams.get('projectId')
  if (!projectId) {
    throw new ApiError('INVALID_PARAMS', { message: 'Missing projectId' })
  }

  const authResult = await requireProjectAuth(projectId, { include: { episodes: true } })
  if (isErrorResponse(authResult)) return authResult

  const episodes: WorkspaceContextEpisode[] = (authResult.novelData.episodes || [])
    .map((episode) => ({
      id: episode.id,
      name: typeof episode.name === 'string' ? episode.name : null,
      episodeNumber: typeof episode.episodeNumber === 'number'
        ? episode.episodeNumber
        : 0,
    }))
    .sort((left, right) => left.episodeNumber - right.episodeNumber)

  const episodeById = new Map(
    episodes.map((episode) => [episode.id, episode]),
  )

  const panelRows = await prisma.novelPromotionPanel.findMany({
    where: {
      storyboard: {
        episode: {
          novelPromotionProjectId: authResult.novelData.id,
        },
      },
    },
    select: {
      id: true,
      panelIndex: true,
      panelNumber: true,
      description: true,
      imageUrl: true,
      videoUrl: true,
      storyboard: {
        select: {
          episodeId: true,
        },
      },
    },
  })

  const panels: WorkspaceContextPanel[] = panelRows
    .map((panel) => {
      const episode = episodeById.get(panel.storyboard.episodeId)
      return {
        id: panel.id,
        episodeId: panel.storyboard.episodeId,
        episodeNumber: episode?.episodeNumber || 0,
        episodeName: episode?.name || null,
        panelIndex: panel.panelIndex,
        panelNumber: panel.panelNumber,
        description: panel.description,
        imageUrl: panel.imageUrl,
        videoUrl: panel.videoUrl,
      }
    })
    .sort((left, right) => {
      if (left.episodeNumber !== right.episodeNumber) {
        return left.episodeNumber - right.episodeNumber
      }
      return left.panelIndex - right.panelIndex
    })

  const voiceLineRows = await prisma.novelPromotionVoiceLine.findMany({
    where: {
      episode: {
        novelPromotionProjectId: authResult.novelData.id,
      },
    },
    select: {
      id: true,
      episodeId: true,
      lineIndex: true,
      speaker: true,
      content: true,
      audioUrl: true,
      audioDuration: true,
    },
    orderBy: [
      { episodeId: 'asc' },
      { lineIndex: 'asc' },
    ],
  })

  const voiceLinesByEpisode: Record<string, WorkspaceContextVoiceLine[]> = {}
  for (const row of voiceLineRows) {
    if (!voiceLinesByEpisode[row.episodeId]) {
      voiceLinesByEpisode[row.episodeId] = []
    }
    voiceLinesByEpisode[row.episodeId].push({
      id: row.id,
      episodeId: row.episodeId,
      lineIndex: row.lineIndex,
      speaker: row.speaker,
      content: row.content,
      audioUrl: row.audioUrl,
      audioDuration: row.audioDuration,
    })
  }

  const episodeOptions = episodes.map((episode) => ({
    id: episode.id,
    label: toEpisodeLabel(episode),
    episodeNumber: episode.episodeNumber,
  }))

  return NextResponse.json({
    projectId,
    episodes: episodeOptions,
    panels,
    voiceLinesByEpisode,
  })
})
