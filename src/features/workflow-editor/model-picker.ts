import type { UserModelOption, UserModelsPayload } from '@/lib/query/hooks/useUserModels'

export type WorkflowModelPickerMediaType = 'llm' | 'image' | 'video' | 'audio'

export function resolveWorkflowModelPickerMediaType(
  nodeType: string | undefined,
  fieldKey: string,
): WorkflowModelPickerMediaType {
  if (fieldKey === 'audioModel' || nodeType === 'voice-synthesis') {
    return 'audio'
  }

  if (nodeType === 'image-generate') {
    return 'image'
  }

  if (nodeType === 'video-generate') {
    return 'video'
  }

  return 'llm'
}

export function getWorkflowModelPickerOptions(
  models: Partial<UserModelsPayload> | undefined,
  mediaType: WorkflowModelPickerMediaType,
): UserModelOption[] {
  const entries = models?.[mediaType]
  return Array.isArray(entries) ? entries : []
}
