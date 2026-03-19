import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

interface ExportPanel {
  panelNumber: number
  shotType: string | null
  cameraMove: string | null
  description: string | null
  location: string | null
  characters: unknown
  sourceText: string | null
  duration: number | null
  imageUrl: string | null
  videoPrompt: string | null
  firstLastFramePrompt: string | null
  videoGenerationMode: string | null
  photographyRules: unknown
  actingNotes: unknown
  linkedToNextPanel: boolean
}

interface ExportStoryboardGroup {
  groupIndex: number
  clipSummary: string | null
  clipContent: string | null
  clipLocation: string | null
  clipCharacters: string | null
  panels: ExportPanel[]
}

function tryParseJson(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function panelToExport(panel: {
  panelNumber: number | null
  shotType: string | null
  cameraMove: string | null
  description: string | null
  location: string | null
  characters: string | null
  srtSegment: string | null
  duration: number | null
  imageUrl: string | null
  videoPrompt: string | null
  firstLastFramePrompt: string | null
  videoGenerationMode: string | null
  photographyRules: string | null
  actingNotes: string | null
  linkedToNextPanel: boolean
}): ExportPanel {
  return {
    panelNumber: panel.panelNumber ?? 0,
    shotType: panel.shotType,
    cameraMove: panel.cameraMove,
    description: panel.description,
    location: panel.location,
    characters: tryParseJson(panel.characters),
    sourceText: panel.srtSegment,
    duration: panel.duration,
    imageUrl: panel.imageUrl,
    videoPrompt: panel.videoPrompt,
    firstLastFramePrompt: panel.firstLastFramePrompt,
    videoGenerationMode: panel.videoGenerationMode,
    photographyRules: tryParseJson(panel.photographyRules),
    actingNotes: tryParseJson(panel.actingNotes),
    linkedToNextPanel: panel.linkedToNextPanel,
  }
}

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCSV(groups: ExportStoryboardGroup[]): string {
  const headers = [
    'Group', 'Panel', 'Shot Type', 'Camera Move', 'Description',
    'Location', 'Characters', 'Source Text', 'Duration',
    'Image URL', 'Video Prompt', 'First/Last Frame Prompt',
    'Video Mode', 'Photography Rules', 'Acting Notes', 'Linked To Next',
  ]

  const rows: string[] = [headers.join(',')]

  for (const group of groups) {
    for (const panel of group.panels) {
      rows.push([
        escapeCSV(group.groupIndex + 1),
        escapeCSV(panel.panelNumber),
        escapeCSV(panel.shotType),
        escapeCSV(panel.cameraMove),
        escapeCSV(panel.description),
        escapeCSV(panel.location),
        escapeCSV(panel.characters),
        escapeCSV(panel.sourceText),
        escapeCSV(panel.duration),
        escapeCSV(panel.imageUrl),
        escapeCSV(panel.videoPrompt),
        escapeCSV(panel.firstLastFramePrompt),
        escapeCSV(panel.videoGenerationMode),
        escapeCSV(panel.photographyRules),
        escapeCSV(panel.actingNotes),
        escapeCSV(panel.linkedToNextPanel),
      ].join(','))
    }
  }

  return rows.join('\n')
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episodeId = request.nextUrl.searchParams.get('episodeId')
  const format = request.nextUrl.searchParams.get('format') || 'json'

  // Get episode IDs for this project
  const episodeIds = episodeId
    ? [episodeId]
    : (await prisma.novelPromotionEpisode.findMany({
        where: { novelPromotionProjectId: projectId },
        select: { id: true },
        orderBy: { episodeNumber: 'asc' },
      })).map((e) => e.id)

  const allGroups: ExportStoryboardGroup[] = []

  for (const epId of episodeIds) {
    const storyboards = await prisma.novelPromotionStoryboard.findMany({
      where: { episodeId: epId },
      include: {
        clip: true,
        panels: { orderBy: { panelIndex: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    })

    for (const sb of storyboards) {
      allGroups.push({
        groupIndex: allGroups.length,
        clipSummary: sb.clip?.summary ?? null,
        clipContent: sb.clip?.content ?? null,
        clipLocation: sb.clip?.location ?? null,
        clipCharacters: sb.clip?.characters ?? null,
        panels: sb.panels.map(panelToExport),
      })
    }
  }

  const groups = allGroups

  if (format === 'csv') {
    const csv = toCSV(groups)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="storyboard-${projectId.slice(0, 8)}.csv"`,
      },
    })
  }

  // JSON format
  const npProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { videoRatio: true, project: { select: { name: true } } },
  })

  return NextResponse.json({
    projectName: npProject?.project?.name || null,
    videoRatio: npProject?.videoRatio || null,
    totalGroups: groups.length,
    totalPanels: groups.reduce((sum, g) => sum + g.panels.length, 0),
    groups,
  })
})
