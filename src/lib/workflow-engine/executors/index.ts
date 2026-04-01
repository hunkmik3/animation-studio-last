// =============================================
// Node Executor Registry
// =============================================
//
// Maps node type strings to executor functions.
// To add a new node type:
//   1. Create a new file in this directory (e.g., my-node.ts)
//   2. Export a NodeExecutor function
//   3. Add it to NODE_EXECUTOR_REGISTRY below
//
// The execute-node API route uses this registry as a thin dispatcher.

import type { NodeExecutor } from './types'
import { executeTextInput } from './text-input'
import { executeCharacterAssets } from './character-assets'
import { executeLocationAssets } from './location-assets'
import { executeShotSplitter } from './shot-splitter'
import { executeReferenceImage } from './reference-image'
import { executeLlmPrompt } from './llm-prompt'
import { executeCharacterExtract } from './character-extract'
import { executeSceneExtract } from './scene-extract'
import { executeStoryboard } from './storyboard'
import { executeImageGenerate } from './image-generate'
import { executeVideoGenerate } from './video-generate'
import { executeVoiceSynthesis } from './voice-synthesis'

export const NODE_EXECUTOR_REGISTRY: Record<string, NodeExecutor> = {
  'text-input': executeTextInput,
  'character-assets': executeCharacterAssets,
  'location-assets': executeLocationAssets,
  'shot-splitter': executeShotSplitter,
  'reference-image': executeReferenceImage,
  'llm-prompt': executeLlmPrompt,
  'character-extract': executeCharacterExtract,
  'scene-extract': executeSceneExtract,
  'storyboard': executeStoryboard,
  'image-generate': executeImageGenerate,
  'video-generate': executeVideoGenerate,
  'voice-synthesis': executeVoiceSynthesis,
}

// Re-export types for convenience
export type { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from './types'
export { extractJSON } from './types'
