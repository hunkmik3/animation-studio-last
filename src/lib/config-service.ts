/**
 * 统一配置服务
 *
 * 所有 API 通过此服务获取模型配置，确保数据源一致性。
 *
 * 优先级：项目配置 > 用户偏好 > null
 */

import { prisma } from '@/lib/prisma'
import {
  type CapabilitySelections,
  type CapabilityOptionValue,
  type CapabilityValue,
  composeModelKey as composeStrictModelKey,
  parseModelKeyStrict,
} from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { getCapabilityOptionFields, resolveGenerationOptionsForModel } from '@/lib/model-capabilities/lookup'

export type ParsedModelKey = { provider: string, modelId: string }

/**
 * 解析模型复合 Key（严格模式，仅接受 provider::modelId）
 */
export function parseModelKey(key: string | null | undefined): ParsedModelKey | null {
  const parsed = parseModelKeyStrict(key)
  if (!parsed) return null
  return {
    provider: parsed.provider,
    modelId: parsed.modelId,
  }
}

/**
 * 组合 provider 与 modelId 为标准复合主键。
 */
export function composeModelKey(provider: string, modelId: string): string {
  return composeStrictModelKey(provider, modelId)
}

/**
 * 从复合 Key 中提取真正的 modelId（用于 API 调用）
 */
export function extractModelId(key: string | null | undefined): string | null {
  const parsed = parseModelKey(key)
  return parsed?.modelId || null
}

/**
 * 从模型字段中提取标准 modelKey（provider::modelId）
 */
export function extractModelKey(key: string | null | undefined): string | null {
  const parsed = parseModelKey(key)
  if (!parsed?.provider || !parsed?.modelId) return null
  return composeModelKey(parsed.provider, parsed.modelId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCapabilityValue(value: unknown): value is CapabilityValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function normalizeCapabilitySelections(raw: unknown): CapabilitySelections {
  if (!isRecord(raw)) return {}

  const normalized: CapabilitySelections = {}
  for (const [modelKey, rawSelection] of Object.entries(raw)) {
    if (!isRecord(rawSelection)) continue

    const selection: Record<string, CapabilityValue> = {}
    for (const [field, value] of Object.entries(rawSelection)) {
      if (field === 'aspectRatio') continue
      if (!isCapabilityValue(value)) continue
      selection[field] = value
    }

    if (Object.keys(selection).length > 0) {
      normalized[modelKey] = selection
    }
  }

  return normalized
}

function parseCapabilitySelections(raw: string | null | undefined): CapabilitySelections {
  if (!raw) return {}
  try {
    return normalizeCapabilitySelections(JSON.parse(raw) as unknown)
  } catch {
    return {}
  }
}

export interface ProjectModelConfig {
  analysisModel: string | null
  characterModel: string | null
  locationModel: string | null
  storyboardModel: string | null
  editModel: string | null
  videoModel: string | null
  videoRatio: string | null
  artStyle: string | null
  capabilityDefaults: CapabilitySelections
  capabilityOverrides: CapabilitySelections
}

export interface UserModelConfig {
  analysisModel: string | null
  characterModel: string | null
  locationModel: string | null
  storyboardModel: string | null
  editModel: string | null
  videoModel: string | null
  capabilityDefaults: CapabilitySelections
}

export interface WorkflowExecutionModelConfig {
  analysisModel: string | null
  characterModel: string | null
  locationModel: string | null
  storyboardModel: string | null
  editModel: string | null
  videoModel: string | null
}

/**
 * 获取项目级模型配置
 */
export async function getProjectModelConfig(
  projectId: string,
  userId: string,
): Promise<ProjectModelConfig> {
  const [projectData, userPref] = await Promise.all([
    prisma.novelPromotionProject.findUnique({ where: { projectId } }),
    prisma.userPreference.findUnique({ where: { userId } }),
  ])

  return {
    analysisModel: extractModelKey(projectData?.analysisModel) || extractModelKey(userPref?.analysisModel) || null,
    characterModel: extractModelKey(projectData?.characterModel) || null,
    locationModel: extractModelKey(projectData?.locationModel) || null,
    storyboardModel: extractModelKey(projectData?.storyboardModel) || null,
    editModel: extractModelKey(projectData?.editModel) || null,
    videoModel: extractModelKey(projectData?.videoModel) || null,
    videoRatio: projectData?.videoRatio || '16:9',
    artStyle: projectData?.artStyle || null,
    capabilityDefaults: parseCapabilitySelections(userPref?.capabilityDefaults),
    capabilityOverrides: parseCapabilitySelections(projectData?.capabilityOverrides),
  }
}

function toRuntimeCapabilitySelections(value: unknown): Record<string, CapabilityValue> {
  if (!isRecord(value)) return {}
  const selections: Record<string, CapabilityValue> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (field === 'aspectRatio') continue
    if (!isCapabilityValue(raw)) continue
    selections[field] = raw
  }
  return selections
}

function toImageRuntimeSelections(basePayload: Record<string, unknown>): Record<string, CapabilityValue> {
  const fromGenerationOptions = toRuntimeCapabilitySelections(basePayload.generationOptions)
  if (fromGenerationOptions.resolution === undefined && isCapabilityValue(basePayload.resolution)) {
    fromGenerationOptions.resolution = basePayload.resolution
  }
  return fromGenerationOptions
}

function pickPreferredCapabilityOption(
  field: string,
  allowedValues: readonly CapabilityOptionValue[],
): CapabilityValue | undefined {
  if (allowedValues.length === 0) return undefined
  if (field === 'resolution') {
    const preferredOrder = ['1080p', '2K', '1K', 'HD', '720p', '1024x1024', '512x512']
    for (const preferred of preferredOrder) {
      const found = allowedValues.find((value) => value === preferred)
      if (found !== undefined) return found as CapabilityValue
    }
  }
  return allowedValues[0] as CapabilityValue
}

function withAutofilledRuntimeSelections(input: {
  modelType: 'llm' | 'image' | 'video'
  modelKey: string
  runtimeSelections: Record<string, CapabilityValue>
}): Record<string, CapabilityValue> {
  const parsed = parseModelKeyStrict(input.modelKey)
  if (!parsed) return input.runtimeSelections

  const capabilities = findBuiltinCapabilities(input.modelType, parsed.provider, parsed.modelId)
  if (!capabilities) return input.runtimeSelections

  const optionFields = getCapabilityOptionFields(input.modelType, capabilities)
  if (Object.keys(optionFields).length === 0) return input.runtimeSelections

  const selections: Record<string, CapabilityValue> = { ...input.runtimeSelections }
  for (const [field, allowedValues] of Object.entries(optionFields)) {
    if (selections[field] !== undefined) continue
    const picked = pickPreferredCapabilityOption(field, allowedValues)
    if (picked !== undefined) {
      selections[field] = picked
    }
  }

  return selections
}

/**
 * 获取用户级模型配置（无项目时使用）
 */
export async function getUserModelConfig(userId: string): Promise<UserModelConfig> {
  const userPref = await prisma.userPreference.findUnique({
    where: { userId },
  })

  return {
    analysisModel: extractModelKey(userPref?.analysisModel) || null,
    characterModel: extractModelKey(userPref?.characterModel) || null,
    locationModel: extractModelKey(userPref?.locationModel) || null,
    storyboardModel: extractModelKey(userPref?.storyboardModel) || null,
    editModel: extractModelKey(userPref?.editModel) || null,
    videoModel: extractModelKey(userPref?.videoModel) || null,
    capabilityDefaults: parseCapabilitySelections(userPref?.capabilityDefaults),
  }
}

function toWorkflowExecutionModelConfig(config: {
  analysisModel: string | null
  characterModel: string | null
  locationModel: string | null
  storyboardModel: string | null
  editModel: string | null
  videoModel: string | null
}): WorkflowExecutionModelConfig {
  return {
    analysisModel: config.analysisModel,
    characterModel: config.characterModel,
    locationModel: config.locationModel,
    storyboardModel: config.storyboardModel,
    editModel: config.editModel,
    videoModel: config.videoModel,
  }
}

export async function getWorkflowExecutionModelConfig(input: {
  userId: string
  projectId?: string | null
}): Promise<WorkflowExecutionModelConfig> {
  const projectId =
    typeof input.projectId === 'string' && input.projectId.trim().length > 0
      ? input.projectId.trim()
      : null

  if (projectId) {
    const config = await getProjectModelConfig(projectId, input.userId)
    return toWorkflowExecutionModelConfig(config)
  }

  const config = await getUserModelConfig(input.userId)
  return toWorkflowExecutionModelConfig(config)
}

export function resolveModelCapabilityGenerationOptions(input: {
  modelType: 'llm' | 'image' | 'video'
  modelKey: string
  capabilityDefaults?: CapabilitySelections
  capabilityOverrides?: CapabilitySelections
  runtimeSelections?: Record<string, CapabilityValue>
}): Record<string, CapabilityValue> {
  const parsed = parseModelKeyStrict(input.modelKey)
  if (!parsed) {
    throw new Error(`MODEL_KEY_INVALID: ${input.modelKey}`)
  }

  const runtimeSelections = input.runtimeSelections
    ? { ...input.runtimeSelections }
    : {}
  const resolvedRuntimeSelections = input.modelType === 'llm'
    ? runtimeSelections
    : withAutofilledRuntimeSelections({
      modelType: input.modelType,
      modelKey: input.modelKey,
      runtimeSelections,
    })

  const capabilities = findBuiltinCapabilities(input.modelType, parsed.provider, parsed.modelId)
  const resolved = resolveGenerationOptionsForModel({
    modelType: input.modelType,
    modelKey: input.modelKey,
    capabilities,
    capabilityDefaults: input.capabilityDefaults,
    capabilityOverrides: input.capabilityOverrides,
    runtimeSelections: resolvedRuntimeSelections,
    requireAllFields: input.modelType !== 'llm',
  })

  if (resolved.issues.length > 0) {
    const first = resolved.issues[0]
    throw new Error(`${first.code}: ${first.field} ${first.message}`)
  }

  return resolved.options
}

export async function resolveProjectModelCapabilityGenerationOptions(input: {
  projectId: string
  userId: string
  modelType: 'llm' | 'image' | 'video'
  modelKey: string
  runtimeSelections?: Record<string, CapabilityValue>
}): Promise<Record<string, CapabilityValue>> {
  const config = await getProjectModelConfig(input.projectId, input.userId)
  return resolveModelCapabilityGenerationOptions({
    modelType: input.modelType,
    modelKey: input.modelKey,
    capabilityDefaults: config.capabilityDefaults,
    capabilityOverrides: config.capabilityOverrides,
    runtimeSelections: input.runtimeSelections,
  })
}

/**
 * 检查必需的模型配置是否存在
 */
export function checkRequiredModels(
  config: Partial<ProjectModelConfig | UserModelConfig>,
  requiredFields: (keyof ProjectModelConfig | keyof UserModelConfig)[],
): string[] {
  const missing: string[] = []
  const configValues = config as Record<string, unknown>

  const fieldNames: Record<string, string> = {
    analysisModel: 'AI分析模型',
    characterModel: '角色图像模型',
    locationModel: '场景图像模型',
    storyboardModel: '分镜图像模型',
    editModel: '修图/编辑模型',
    videoModel: '视频模型',
  }

  for (const field of requiredFields) {
    if (!configValues[field]) {
      missing.push(fieldNames[field] || field)
    }
  }

  return missing
}

/**
 * 生成缺失配置的错误消息
 */
export function getMissingConfigError(missingFields: string[]): string {
  if (missingFields.length === 0) return ''
  if (missingFields.length === 1) {
    return `请先在项目设置中配置"${missingFields[0]}"`
  }
  return `请先在项目设置中配置以下模型：${missingFields.join('、')}`
}

/**
 * 为图片类任务统一构建 billingPayload（项目级，async）
 *
 * 生图和修图统一使用严格模式：用户必须已在项目设置中配置好 resolution。
 * resolution 会同时注入到 billingPayload.generationOptions（计费用）
 * 和 task payload（worker 读取后传给 API 的 imageSize 参数）。
 */
export async function buildImageBillingPayload(input: {
  projectId: string
  userId: string
  imageModel: string | null
  basePayload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { projectId, userId, imageModel, basePayload } = input
  if (!imageModel) return basePayload

  const runtimeSelections = withAutofilledRuntimeSelections({
    modelType: 'image',
    modelKey: imageModel,
    runtimeSelections: toImageRuntimeSelections(basePayload),
  })

  let capabilityOptions: Record<string, CapabilityValue> = {}
  try {
    capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
      projectId,
      userId,
      modelType: 'image',
      modelKey: imageModel,
      runtimeSelections,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw Object.assign(new Error(message), { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }

  return {
    ...basePayload,
    imageModel,
    ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {}),
  }
}

/**
 * 为图片类任务统一构建 billingPayload（用户级，sync）
 *
 * 适用于 asset-hub 等无 projectId 场景，使用已取出的 userModelConfig。
 */
export function buildImageBillingPayloadFromUserConfig(input: {
  userModelConfig: UserModelConfig
  imageModel: string | null
  basePayload: Record<string, unknown>
}): Record<string, unknown> {
  const { userModelConfig, imageModel, basePayload } = input
  if (!imageModel) return basePayload

  const runtimeSelections = withAutofilledRuntimeSelections({
    modelType: 'image',
    modelKey: imageModel,
    runtimeSelections: toImageRuntimeSelections(basePayload),
  })

  let capabilityOptions: Record<string, CapabilityValue> = {}
  try {
    capabilityOptions = resolveModelCapabilityGenerationOptions({
      modelType: 'image',
      modelKey: imageModel,
      capabilityDefaults: userModelConfig.capabilityDefaults,
      runtimeSelections,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw Object.assign(new Error(message), { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }

  return {
    ...basePayload,
    imageModel,
    ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {}),
  }
}
