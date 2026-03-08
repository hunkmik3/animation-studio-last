import { NextRequest } from 'next/server'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'

export const runtime = 'nodejs'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  console.log('[DEBUG] script-to-storyboard-stream body:', JSON.stringify(body))
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId.trim() : ''
  console.log('[DEBUG] script-to-storyboard-stream episodeId:', episodeId)

  if (!episodeId) {
    console.log('[DEBUG] script-to-storyboard-stream: episodeId missing, throwing 400')
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireProjectAuth(projectId, {
    include: { characters: true, locations: true },
  })
  if (isErrorResponse(authResult)) return authResult
  const { session, project } = authResult

  if (project.mode !== 'novel-promotion') {
    throw new ApiError('INVALID_PARAMS')
  }

  console.log('[DEBUG] calling maybeSubmitLLMTask...')
  const asyncTaskResponse = await maybeSubmitLLMTask({
    request,
    userId: session.user.id,
    projectId,
    episodeId,
    type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    routePath: `/api/novel-promotion/${projectId}/script-to-storyboard-stream`,
    body: {
      ...body,
      displayMode: 'detail',
    },
    dedupeKey: `script_to_storyboard_run:${episodeId}`,
    priority: 2,
  })
  console.log('[DEBUG] maybeSubmitLLMTask response truthy:', !!asyncTaskResponse)
  if (asyncTaskResponse) return asyncTaskResponse

  console.log('[DEBUG] maybeSubmitLLMTask returned null, throwing 400')
  throw new ApiError('INVALID_PARAMS')
})
