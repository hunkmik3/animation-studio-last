import { chatCompletion } from '@/lib/llm/chat-completion'
import type { NodeExecutor } from './types'
import { extractJSON } from './types'

/**
 * LLM Prompt executor — native workflow node.
 *
 * Generic LLM call with user-configurable system prompt, user prompt
 * template, model, temperature, and output format.
 *
 * Uses the production chatCompletion() from waoowaoo which handles:
 * - Multi-provider routing (Google, OpenRouter, Ark, OpenAI-compat)
 * - Model resolution via user/project config
 * - Retry with exponential backoff
 * - Usage logging and cost recording
 * - Sensitive content detection
 *
 * Parity: FULL — uses the same chatCompletion() as all original pipeline
 * LLM calls. The difference is that prompts are user-configurable instead
 * of hardcoded per pipeline step.
 */
export const executeLlmPrompt: NodeExecutor = async (ctx) => {
  const inputText = (ctx.inputs.text as string) || ''
  const contextText = ctx.inputs.context ? JSON.stringify(ctx.inputs.context) : ''

  const model = (ctx.config.model as string) || ctx.modelConfig.analysisModel
  if (!model) {
    throw new Error('No AI model configured. Set a model in node settings or project config.')
  }

  const systemPrompt = (ctx.config.systemPrompt as string) || 'You are a helpful AI assistant.'
  const userPromptTemplate = (ctx.config.userPrompt as string) || '{input}'
  const userPrompt = userPromptTemplate
    .replace('{input}', inputText)
    .replace('{context}', contextText)
  const temperature = typeof ctx.config.temperature === 'number' ? ctx.config.temperature : 0.7
  const outputFormat = (ctx.config.outputFormat as string) || 'text'

  const completion = await chatCompletion(ctx.userId, model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { temperature, projectId: ctx.projectId || undefined, reasoning: false })

  const text = completion.choices[0]?.message?.content || ''
  const outputs: Record<string, unknown> = { result: text }

  if (outputFormat === 'json') {
    outputs.json = extractJSON(text)
  }

  return {
    outputs,
    metadata: { model, inputLength: inputText.length, outputLength: text.length },
  }
}
