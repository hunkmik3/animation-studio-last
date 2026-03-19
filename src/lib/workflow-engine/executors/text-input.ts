import type { NodeExecutor } from './types'

/**
 * Text Input executor — native workflow node.
 *
 * Simply passes the user-configured text content to the output port.
 * No external system dependency. This is a pure workflow-native node.
 *
 * Parity: FULL — this node type has no original pipeline equivalent;
 * it serves as the entry point for user-provided text in the workflow.
 */
export const executeTextInput: NodeExecutor = async (ctx) => {
  const configuredContent = typeof ctx.config.content === 'string' ? ctx.config.content : ''
  const upstreamText = typeof ctx.inputs.text === 'string' ? ctx.inputs.text : ''
  const content = configuredContent.trim().length > 0 ? configuredContent : upstreamText
  return {
    outputs: { text: content },
  }
}
