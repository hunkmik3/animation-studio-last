import type { Edge, Node } from '@xyflow/react'
import { normalizeWorkflowArtStyle } from '@/lib/workflow-engine/art-style'

export interface WorkflowGraphTemplate {
  nodes: Node[]
  edges: Edge[]
}

export const BLANK_WORKFLOW_TEMPLATE: WorkflowGraphTemplate = {
  nodes: [],
  edges: [],
}

export const CLASSIC_PIPELINE_TEMPLATE: WorkflowGraphTemplate = {
  nodes: [
    { id: 'n1', type: 'workflowNode', position: { x: 50, y: 250 }, data: { nodeType: 'text-input', label: 'Novel / Script', config: { content: '' } } },
    { id: 'n2', type: 'workflowNode', position: { x: 350, y: 100 }, data: { nodeType: 'character-extract', label: 'Extract Characters', config: { prompt: '', model: '', maxCharacters: 20 } } },
    { id: 'n3', type: 'workflowNode', position: { x: 350, y: 400 }, data: { nodeType: 'scene-extract', label: 'Extract Scenes', config: { prompt: '', model: '', maxScenes: 30 } } },
    { id: 'n4', type: 'workflowNode', position: { x: 700, y: 250 }, data: { nodeType: 'storyboard', label: 'Storyboard', config: { prompt: 'Create a storyboard from the script with panel descriptions, shot types, and camera moves.\n\nScript: {input}\nCharacters: {characters}\nScenes: {scenes}', model: '', panelCount: 10, style: normalizeWorkflowArtStyle('anime') || 'japanese-anime' } } },
    { id: 'n6', type: 'workflowNode', position: { x: 700, y: 520 }, data: { nodeType: 'voice-synthesis', label: 'Narration / Voice', config: { episodeId: '', lineId: '', audioModel: '', voice: 'default', rate: 1, updateLineContentFromInput: false } } },
  ],
  edges: [
    { id: 'e1', source: 'n1', sourceHandle: 'text', target: 'n2', targetHandle: 'text', animated: true, style: { strokeWidth: 2 } },
    { id: 'e2', source: 'n1', sourceHandle: 'text', target: 'n3', targetHandle: 'text', animated: true, style: { strokeWidth: 2 } },
    { id: 'e3', source: 'n1', sourceHandle: 'text', target: 'n4', targetHandle: 'text', animated: true, style: { strokeWidth: 2 } },
    { id: 'e4', source: 'n2', sourceHandle: 'characters', target: 'n4', targetHandle: 'characters', animated: true, style: { strokeWidth: 2 } },
    { id: 'e5', source: 'n3', sourceHandle: 'scenes', target: 'n4', targetHandle: 'scenes', animated: true, style: { strokeWidth: 2 } },
    { id: 'e6', source: 'n1', sourceHandle: 'text', target: 'n6', targetHandle: 'text', animated: true, style: { strokeWidth: 2 } },
  ],
}
