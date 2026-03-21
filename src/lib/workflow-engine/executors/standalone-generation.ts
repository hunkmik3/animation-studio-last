import type { GenerateResult } from '@/lib/generators/base'
import { pollAsyncTask } from '@/lib/async-poll'
import { processMediaResult } from '@/lib/media-process'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { normalizeToOriginalMediaUrl } from '@/lib/media/outbound-image'
import type { MediaRef } from '@/lib/media/types'

type StandaloneMediaType = 'image' | 'video' | 'audio'

const DEFAULT_POLL_TIMEOUT_MS = Number.parseInt(
  process.env.WORKFLOW_EXTERNAL_TIMEOUT_MS || String(20 * 60 * 1000),
  10,
)
const DEFAULT_POLL_INTERVAL_MS = Number.parseInt(
  process.env.WORKFLOW_EXTERNAL_POLL_MS || '3000',
  10,
)

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readAsyncExternalId(
  result: Pick<GenerateResult, 'async' | 'externalId'>,
  mediaType: StandaloneMediaType,
): string | null {
  if (!result.async) return null
  if (!hasNonEmptyString(result.externalId)) {
    throw new Error(`ASYNC_EXTERNAL_ID_MISSING: ${mediaType}`)
  }
  return result.externalId.trim()
}

export async function waitForStandaloneExternalResult(params: {
  externalId: string
  userId: string
  timeoutMs?: number
  intervalMs?: number
}): Promise<{ url: string; downloadHeaders?: Record<string, string> }> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  const intervalMs = params.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    const status = await pollAsyncTask(params.externalId, params.userId)

    if (status.status === 'completed') {
      const url = status.resultUrl || status.imageUrl || status.videoUrl
      if (!hasNonEmptyString(url)) {
        throw new Error(`External task completed without result url: ${params.externalId}`)
      }
      return {
        url,
        ...(status.downloadHeaders ? { downloadHeaders: status.downloadHeaders } : {}),
      }
    }

    if (status.status === 'failed') {
      throw new Error(status.error || `External task failed: ${params.externalId}`)
    }

    await sleep(intervalMs)
  }

  throw new Error(`External task polling timeout (${Math.round(timeoutMs / 1000)}s): ${params.externalId}`)
}

export async function resolveStandaloneGeneratedMediaSource(params: {
  result: GenerateResult
  userId: string
  mediaType: StandaloneMediaType
}): Promise<{ source: string; downloadHeaders?: Record<string, string> }> {
  if (params.mediaType === 'image') {
    if (hasNonEmptyString(params.result.imageUrl)) {
      return { source: params.result.imageUrl.trim() }
    }
    if (hasNonEmptyString(params.result.imageBase64)) {
      return { source: `data:image/png;base64,${params.result.imageBase64.trim()}` }
    }
  }

  if (params.mediaType === 'video' && hasNonEmptyString(params.result.videoUrl)) {
    return { source: params.result.videoUrl.trim() }
  }

  if (params.mediaType === 'audio' && hasNonEmptyString(params.result.audioUrl)) {
    return { source: params.result.audioUrl.trim() }
  }

  const externalId = readAsyncExternalId(params.result, params.mediaType)
  if (!externalId) {
    throw new Error(`Generation returned no usable ${params.mediaType} output`)
  }

  const polled = await waitForStandaloneExternalResult({
    externalId,
    userId: params.userId,
  })

  return {
    source: polled.url,
    ...(polled.downloadHeaders ? { downloadHeaders: polled.downloadHeaders } : {}),
  }
}

export async function persistStandaloneGeneratedMedia(params: {
  nodeId: string
  nodeType: string
  mediaType: StandaloneMediaType
  source: string
  downloadHeaders?: Record<string, string>
}): Promise<MediaRef> {
  const storageKey = await processMediaResult({
    source: params.source,
    type: params.mediaType,
    keyPrefix: `workflow/${params.nodeType}`,
    targetId: params.nodeId,
    ...(params.downloadHeaders ? { downloadHeaders: params.downloadHeaders } : {}),
  })

  return await ensureMediaObjectFromStorageKey(storageKey)
}

export async function normalizeStandaloneMediaInput(input: unknown): Promise<string[]> {
  const values = Array.isArray(input) ? input : [input]
  const rawValues = values.filter(hasNonEmptyString).map((value) => value.trim())
  if (rawValues.length === 0) return []

  return await Promise.all(
    rawValues.map(async (value) => {
      if (value.startsWith('data:')) return value
      return await normalizeToOriginalMediaUrl(value)
    }),
  )
}
