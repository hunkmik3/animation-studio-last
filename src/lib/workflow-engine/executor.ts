// =============================================
// Workflow Execution Engine
// DAG-based executor with topological sort
// =============================================

import type {
    SerializedWorkflow,
    SerializedNode,
    SerializedEdge,
    NodeExecutionContext,
    NodeExecutionResult,
    WorkflowExecutionState,
} from './types'


// ── Topological Sort ──

interface AdjacencyInfo {
    node: SerializedNode
    inDegree: number
    inputEdges: SerializedEdge[]
}

function topologicalSort(nodes: SerializedNode[], edges: SerializedEdge[]): SerializedNode[] {
    const adjacency = new Map<string, AdjacencyInfo>()

    // Initialize
    for (const node of nodes) {
        adjacency.set(node.id, {
            node,
            inDegree: 0,
            inputEdges: [],
        })
    }

    // Build in-degree counts
    for (const edge of edges) {
        const target = adjacency.get(edge.target)
        if (target) {
            target.inDegree++
            target.inputEdges.push(edge)
        }
    }

    // Kahn's algorithm
    const queue: SerializedNode[] = []
    const sorted: SerializedNode[] = []

    for (const [, info] of adjacency) {
        if (info.inDegree === 0) {
            queue.push(info.node)
        }
    }

    while (queue.length > 0) {
        const current = queue.shift()!
        sorted.push(current)

        // Find outgoing edges
        for (const edge of edges) {
            if (edge.source === current.id) {
                const target = adjacency.get(edge.target)
                if (target) {
                    target.inDegree--
                    if (target.inDegree === 0) {
                        queue.push(target.node)
                    }
                }
            }
        }
    }

    if (sorted.length !== nodes.length) {
        throw new Error('Workflow has circular dependencies')
    }

    return sorted
}

// ── Gather Inputs from connected edges ──

function gatherInputs(
    nodeId: string,
    edges: SerializedEdge[],
    nodeOutputs: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
    const inputs: Record<string, unknown> = {}

    for (const edge of edges) {
        if (edge.target === nodeId) {
            const sourceOutputs = nodeOutputs.get(edge.source)
            if (sourceOutputs && edge.sourceHandle) {
                inputs[edge.targetHandle] = sourceOutputs[edge.sourceHandle]
            }
        }
    }

    return inputs
}

// ── Node Executor Registry ──

type NodeExecutor = (ctx: NodeExecutionContext) => Promise<NodeExecutionResult>

const nodeExecutors: Record<string, NodeExecutor> = {
    'text-input': async (ctx) => {
        const content = (ctx.config.content as string) || ''
        return { outputs: { text: content } }
    },

    'llm-prompt': async (ctx) => {
        const input = (ctx.inputs.text as string) || ''
        const context = ctx.inputs.context as string | undefined
        const systemPrompt = (ctx.config.systemPrompt as string) || ''
        const userPromptTemplate = (ctx.config.userPrompt as string) || '{input}'
        const model = (ctx.config.model as string) || ''
        const outputFormat = (ctx.config.outputFormat as string) || 'text'

        // Build the user prompt by replacing variables
        const userPrompt = userPromptTemplate
            .replace(/\{input\}/g, input)
            .replace(/\{context\}/g, context || '')

        // In a real implementation, this would call the AI runtime
        // For now, return a structured placeholder showing the prompt was processed
        const result = `[LLM Processing]\nModel: ${model}\nSystem: ${systemPrompt.slice(0, 100)}...\nInput length: ${input.length} chars\nPrompt: ${userPrompt.slice(0, 200)}...`

        if (outputFormat === 'json') {
            return {
                outputs: {
                    result,
                    json: { processed: true, model, inputLength: input.length },
                },
            }
        }
        return { outputs: { result } }
    },

    'character-extract': async (ctx) => {
        const input = (ctx.inputs.text as string) || ''
        const prompt = (ctx.config.prompt as string) || ''
        const model = (ctx.config.model as string) || ''

        return {
            outputs: {
                characters: [
                    { name: 'Character 1', role: 'protagonist', description: 'Extracted from text' },
                ],
                summary: `[Character Extraction] Model: ${model}, Input: ${input.length} chars, Prompt: ${prompt.slice(0, 100)}`,
            },
        }
    },

    'scene-extract': async (ctx) => {
        const input = (ctx.inputs.text as string) || ''
        return {
            outputs: {
                scenes: [
                    { name: 'Scene 1', description: 'Extracted from text' },
                ],
                summary: `[Scene Extraction] Input: ${input.length} chars`,
            },
        }
    },

    'storyboard': async (ctx) => {
        const input = (ctx.inputs.text as string) || ''
        const panelCount = (ctx.config.panelCount as number) || 10
        return {
            outputs: {
                panels: Array.from({ length: panelCount }, (_, i) => ({
                    panel_number: i + 1,
                    description: `Panel ${i + 1} - generated`,
                    shot_type: 'medium shot',
                    camera_move: 'static',
                })),
                summary: `[Storyboard] ${panelCount} panels generated from ${input.length} chars`,
            },
        }
    },

    'image-generate': async (ctx) => {
        const prompt = (ctx.inputs.prompt as string) || ''
        const provider = (ctx.config.provider as string) || 'flux'
        return {
            outputs: {
                image: `[Image placeholder] Provider: ${provider}, Prompt: ${prompt.slice(0, 100)}`,
            },
        }
    },

    'video-generate': async (ctx) => {
        const prompt = (ctx.inputs.prompt as string) || ''
        const provider = (ctx.config.provider as string) || 'kling'
        return {
            outputs: {
                video: `[Video placeholder] Provider: ${provider}, Prompt: ${prompt.slice(0, 100)}`,
            },
        }
    },

    'voice-synthesis': async (ctx) => {
        const text = (ctx.inputs.text as string) || ''
        const provider = (ctx.config.provider as string) || 'cosyvoice'
        return {
            outputs: {
                audio: `[Audio placeholder] Provider: ${provider}, Text: ${text.slice(0, 100)}`,
            },
        }
    },

    'upscale': async (ctx) => {
        const image = ctx.inputs.image
        const scale = (ctx.config.scale as string) || '2'
        return {
            outputs: {
                image: `[Upscaled ${scale}x] ${String(image).slice(0, 100)}`,
            },
        }
    },

    'video-compose': async (ctx) => {
        return {
            outputs: {
                video: `[Composed video] inputs: ${Object.keys(ctx.inputs).length}`,
            },
        }
    },

    'condition': async (ctx) => {
        const value = ctx.inputs.value
        // Simple evaluation for now
        const result = Boolean(value)
        return {
            outputs: {
                true: result ? value : null,
                false: result ? null : value,
            },
        }
    },

    'output': async (ctx) => {
        const content = ctx.inputs.content
        return {
            outputs: {},
            metadata: {
                label: ctx.config.label || 'Output',
                content,
            },
        }
    },
}

// ── Main Executor ──

export interface ExecutionCallbacks {
    onNodeStart?: (nodeId: string) => void
    onNodeProgress?: (nodeId: string, progress: number, message?: string) => void
    onNodeComplete?: (nodeId: string, result: NodeExecutionResult) => void
    onNodeError?: (nodeId: string, error: Error) => void
    onWorkflowComplete?: (state: WorkflowExecutionState) => void
}

export async function executeWorkflow(
    workflow: SerializedWorkflow,
    callbacks?: ExecutionCallbacks,
): Promise<WorkflowExecutionState> {
    const { nodes, edges } = workflow
    const state: WorkflowExecutionState = {
        status: 'running',
        nodeStates: {},
        startedAt: new Date().toISOString(),
    }

    // Initialize all node states
    for (const node of nodes) {
        state.nodeStates[node.id] = {
            status: 'pending',
            progress: 0,
        }
    }

    try {
        // Topological sort
        const sortedNodes = topologicalSort(nodes, edges)
        const nodeOutputs = new Map<string, Record<string, unknown>>()

        // Execute in order
        for (const node of sortedNodes) {
            const nodeState = state.nodeStates[node.id]
            // Mark as running
            nodeState.status = 'running'
            nodeState.startedAt = new Date().toISOString()
            callbacks?.onNodeStart?.(node.id)

            try {
                // Gather inputs from connected nodes
                const inputs = gatherInputs(node.id, edges, nodeOutputs)

                // Get executor
                const executor = nodeExecutors[node.type]
                if (!executor) {
                    throw new Error(`No executor found for node type: ${node.type}`)
                }

                // Execute with progress
                callbacks?.onNodeProgress?.(node.id, 10, 'Preparing...')

                const context: NodeExecutionContext = {
                    nodeId: node.id,
                    nodeType: node.type,
                    config: node.config,
                    inputs,
                }

                callbacks?.onNodeProgress?.(node.id, 50, 'Processing...')
                const result = await executor(context)

                // Store outputs
                nodeOutputs.set(node.id, result.outputs)

                // Mark complete
                nodeState.status = 'completed'
                nodeState.progress = 100
                nodeState.outputs = result.outputs
                nodeState.completedAt = new Date().toISOString()
                callbacks?.onNodeComplete?.(node.id, result)

            } catch (error) {
                nodeState.status = 'failed'
                nodeState.error = error instanceof Error ? error.message : String(error)
                callbacks?.onNodeError?.(node.id, error instanceof Error ? error : new Error(String(error)))

                // Don't stop entire workflow — skip dependent nodes
            }
        }

        // Determine overall status
        const allCompleted = Object.values(state.nodeStates).every((s) => s.status === 'completed')
        const anyFailed = Object.values(state.nodeStates).some((s) => s.status === 'failed')

        state.status = allCompleted ? 'completed' : anyFailed ? 'failed' : 'completed'
        state.completedAt = new Date().toISOString()

    } catch (error) {
        state.status = 'failed'
        state.error = error instanceof Error ? error.message : String(error)
    }

    callbacks?.onWorkflowComplete?.(state)
    return state
}
