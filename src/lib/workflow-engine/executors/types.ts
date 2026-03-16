// =============================================
// Node Executor — Shared Interface
// =============================================
//
// Every node executor implements this interface.
// The route handler builds the context; the executor does the work.
//
// Two execution modes:
//   1. Synchronous — executor returns outputs directly
//   2. Asynchronous — executor submits a task and returns taskId
//      (frontend polls via WorkflowTaskMonitor / SSE)

import type { Locale } from '@/i18n/routing'

// ── Context passed to every executor ──

export interface NodeExecutorContext {
  nodeId: string
  nodeType: string
  config: Record<string, unknown>
  inputs: Record<string, unknown>

  // Project / auth context
  projectId: string
  userId: string
  locale: Locale

  // Project-level model configuration (from config-service)
  projectModelConfig: ProjectModelConfig

  // Optional: linked panel ID (for image/video nodes synced from workspace)
  panelId?: string

  // Optional: request metadata for tracing
  requestId?: string
}

/** Mirrors the shape from config-service.ts */
export interface ProjectModelConfig {
  analysisModel: string | null
  characterModel: string | null
  locationModel: string | null
  storyboardModel: string | null
  editModel: string | null
  videoModel: string | null
}

// ── Result returned by every executor ──

export interface NodeExecutorResult {
  /** Output values keyed by port name — flows to downstream nodes */
  outputs: Record<string, unknown>

  /** If true, execution is async — frontend should monitor via taskId */
  async?: boolean

  /** Task ID when execution is delegated to the BullMQ task system */
  taskId?: string

  /** True if this result is from a mock/placeholder (no real processing) */
  mock?: boolean

  /** Human-readable message (shown in UI toast or node status) */
  message?: string

  /**
   * If true, this executor is a temporary simplified implementation
   * that does NOT match the full production capability of the original
   * waoowaoo pipeline. The `parityNotes` field explains the gap.
   */
  temporaryImplementation?: boolean

  /** Explains what the original system does better, if temporaryImplementation=true */
  parityNotes?: string

  /** Debug / observability metadata */
  metadata?: Record<string, unknown>
}

// ── Executor function signature ──

export type NodeExecutor = (ctx: NodeExecutorContext) => Promise<NodeExecutorResult>

// ── Shared utilities ──

/**
 * Extract JSON from LLM text output.
 * Handles ```json ... ```, ``` ... ```, or raw JSON.
 */
export function extractJSON(text: string): unknown {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
      text.match(/```\s*([\s\S]*?)\s*```/) ||
      text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text
    return JSON.parse(jsonStr.trim())
  } catch {
    return null
  }
}
