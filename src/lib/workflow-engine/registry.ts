// =============================================
// Workflow Engine — Node Type Registry
// All available node types for the workflow editor
// =============================================

import type { WorkflowNodeTypeDefinition } from './types'

// ── Node Type Definitions ──

const TEXT_INPUT_NODE: WorkflowNodeTypeDefinition = {
    type: 'text-input',
    title: 'Text Input',
    description: 'Input text content such as novels, scripts, or any text',
    icon: 'FileText',
    category: 'input',
    color: '#6366f1',
    inputs: [],
    outputs: [
        { id: 'text', name: 'Text', type: 'text', required: true },
    ],
    configFields: [
        { key: 'content', label: 'Content', type: 'textarea', placeholder: 'Enter your text here...', required: true },
    ],
    defaultConfig: { content: '' },
}

const LLM_PROMPT_NODE: WorkflowNodeTypeDefinition = {
    type: 'llm-prompt',
    title: 'LLM / AI Prompt',
    description: 'Process text with an AI model using a customizable prompt',
    icon: 'Bot',
    category: 'ai',
    color: '#8b5cf6',
    inputs: [
        { id: 'text', name: 'Input Text', type: 'text', required: true },
        { id: 'context', name: 'Context', type: 'any', required: false },
    ],
    outputs: [
        { id: 'result', name: 'Result', type: 'text', required: true },
        { id: 'json', name: 'Structured Data', type: 'json', required: false },
    ],
    configFields: [
        { key: 'systemPrompt', label: 'System Prompt', type: 'textarea', placeholder: 'You are a helpful assistant...', required: true },
        { key: 'userPrompt', label: 'User Prompt Template', type: 'textarea', placeholder: 'Analyze the following text:\n{input}', required: true },
        { key: 'model', label: 'AI Model', type: 'model-picker', required: true },
        { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 2, step: 0.1, defaultValue: 0.7 },
        { key: 'outputFormat', label: 'Output Format', type: 'select', options: [{ label: 'Plain Text', value: 'text' }, { label: 'JSON', value: 'json' }], defaultValue: 'text' },
    ],
    defaultConfig: { systemPrompt: '', userPrompt: '{input}', model: '', temperature: 0.7, outputFormat: 'text' },
}

const CHARACTER_EXTRACT_NODE: WorkflowNodeTypeDefinition = {
    type: 'character-extract',
    title: 'Character Extract',
    description: 'Extract character profiles from text using AI analysis',
    icon: 'Users',
    category: 'ai',
    color: '#ec4899',
    inputs: [
        { id: 'text', name: 'Story Text', type: 'text', required: true },
    ],
    outputs: [
        { id: 'characters', name: 'Characters', type: 'characters', required: true },
        { id: 'summary', name: 'Summary', type: 'text', required: false },
    ],
    configFields: [
        { key: 'prompt', label: 'Extraction Prompt', type: 'textarea', placeholder: 'Extract all characters from the story...', required: true },
        { key: 'model', label: 'AI Model', type: 'model-picker', required: true },
        { key: 'maxCharacters', label: 'Max Characters', type: 'number', defaultValue: 20 },
    ],
    defaultConfig: {
        prompt: 'Analyze the following text and extract all characters. For each character provide: name, age, gender, appearance description, personality traits, and role in the story.\n\nText:\n{input}\n\nOutput a JSON array of character objects.',
        model: '',
        maxCharacters: 20,
    },
}

const SCENE_EXTRACT_NODE: WorkflowNodeTypeDefinition = {
    type: 'scene-extract',
    title: 'Scene / Location Extract',
    description: 'Extract scenes and locations from text',
    icon: 'MapPin',
    category: 'ai',
    color: '#14b8a6',
    inputs: [
        { id: 'text', name: 'Story Text', type: 'text', required: true },
    ],
    outputs: [
        { id: 'scenes', name: 'Scenes', type: 'scenes', required: true },
        { id: 'summary', name: 'Summary', type: 'text', required: false },
    ],
    configFields: [
        { key: 'prompt', label: 'Extraction Prompt', type: 'textarea', placeholder: 'Extract all locations and scenes...', required: true },
        { key: 'model', label: 'AI Model', type: 'model-picker', required: true },
    ],
    defaultConfig: {
        prompt: 'Analyze the following text and extract all locations/scenes. For each provide: name, visual description, atmosphere, time of day, and weather.\n\nText:\n{input}\n\nOutput a JSON array of scene objects.',
        model: '',
    },
}

const STORYBOARD_NODE: WorkflowNodeTypeDefinition = {
    type: 'storyboard',
    title: 'Storyboard Generator',
    description: 'Generate storyboard panels from script, characters, and scenes',
    icon: 'LayoutGrid',
    category: 'ai',
    color: '#f59e0b',
    inputs: [
        { id: 'text', name: 'Script Text', type: 'text', required: true },
        { id: 'characters', name: 'Characters', type: 'characters', required: false },
        { id: 'scenes', name: 'Scenes', type: 'scenes', required: false },
    ],
    outputs: [
        { id: 'panels', name: 'Panels', type: 'panels', required: true },
        { id: 'summary', name: 'Summary', type: 'text', required: false },
    ],
    configFields: [
        { key: 'prompt', label: 'Storyboard Prompt', type: 'textarea', required: true },
        { key: 'model', label: 'AI Model', type: 'model-picker', required: true },
        { key: 'panelCount', label: 'Target Panel Count', type: 'number', defaultValue: 10 },
        {
            key: 'style', label: 'Visual Style', type: 'select', options: [
                { label: 'Anime', value: 'anime' },
                { label: 'Realistic', value: 'realistic' },
                { label: 'Comic', value: 'comic' },
                { label: 'Watercolor', value: 'watercolor' },
            ], defaultValue: 'anime'
        },
    ],
    defaultConfig: {
        prompt: 'Create a storyboard plan for the following script. Generate visual panel descriptions with shot types, camera movements, and character positions.\n\nScript:\n{input}\n\nCharacters:\n{characters}\n\nScenes:\n{scenes}\n\nOutput a JSON array of panel objects.',
        model: '',
        panelCount: 10,
        style: 'anime',
    },
}

const IMAGE_GENERATE_NODE: WorkflowNodeTypeDefinition = {
    type: 'image-generate',
    title: 'Image Generate',
    description: 'Generate images using AI (Flux, Stable Diffusion, etc.)',
    icon: 'Image',
    category: 'media',
    color: '#3b82f6',
    inputs: [
        { id: 'prompt', name: 'Prompt', type: 'text', required: true },
        { id: 'reference', name: 'Reference Image', type: 'image', required: false },
    ],
    outputs: [
        { id: 'image', name: 'Image', type: 'image', required: true },
    ],
    configFields: [
        {
            key: 'provider', label: 'Provider', type: 'select', options: [
                { label: 'Flux', value: 'flux' },
                { label: 'Stable Diffusion', value: 'sd' },
                { label: 'Seedream', value: 'seedream' },
                { label: 'DALL-E', value: 'dalle' },
            ], required: true
        },
        { key: 'model', label: 'Model', type: 'model-picker', required: true },
        { key: 'negativePrompt', label: 'Negative Prompt', type: 'textarea' },
        {
            key: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: [
                { label: '16:9', value: '16:9' },
                { label: '9:16', value: '9:16' },
                { label: '1:1', value: '1:1' },
                { label: '4:3', value: '4:3' },
            ], defaultValue: '16:9'
        },
        {
            key: 'resolution', label: 'Resolution', type: 'select', options: [
                { label: '1K', value: '1K' }, { label: '2K', value: '2K' }, { label: '4K', value: '4K' },
            ], defaultValue: '2K'
        },
    ],
    defaultConfig: { provider: 'flux', model: '', negativePrompt: '', aspectRatio: '16:9', resolution: '2K' },
}

const VIDEO_GENERATE_NODE: WorkflowNodeTypeDefinition = {
    type: 'video-generate',
    title: 'Video Generate',
    description: 'Generate video clips from images or prompts',
    icon: 'Video',
    category: 'media',
    color: '#ef4444',
    inputs: [
        { id: 'image', name: 'Start Image', type: 'image', required: false },
        { id: 'prompt', name: 'Motion Prompt', type: 'text', required: true },
    ],
    outputs: [
        { id: 'video', name: 'Video', type: 'video', required: true },
    ],
    configFields: [
        {
            key: 'provider', label: 'Provider', type: 'select', options: [
                { label: 'Kling', value: 'kling' },
                { label: 'Runway', value: 'runway' },
                { label: 'Seedance', value: 'seedance' },
                { label: 'Veo', value: 'veo' },
            ], required: true
        },
        { key: 'model', label: 'Model', type: 'model-picker', required: true },
        { key: 'duration', label: 'Duration (seconds)', type: 'number', defaultValue: 5 },
        {
            key: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: [
                { label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }, { label: '1:1', value: '1:1' },
            ], defaultValue: '16:9'
        },
    ],
    defaultConfig: { provider: 'kling', model: '', duration: 5, aspectRatio: '16:9' },
}

const VOICE_SYNTHESIS_NODE: WorkflowNodeTypeDefinition = {
    type: 'voice-synthesis',
    title: 'Voice Synthesis',
    description: 'Generate voice audio from text with character voices',
    icon: 'Mic',
    category: 'media',
    color: '#a855f7',
    inputs: [
        { id: 'text', name: 'Script Text', type: 'text', required: true },
        { id: 'characters', name: 'Characters', type: 'characters', required: false },
    ],
    outputs: [
        { id: 'audio', name: 'Audio', type: 'audio', required: true },
    ],
    configFields: [
        {
            key: 'provider', label: 'Provider', type: 'select', options: [
                { label: 'CosyVoice (Alibaba)', value: 'cosyvoice' },
                { label: 'Fish Audio', value: 'fishaudio' },
            ], required: true
        },
        { key: 'voice', label: 'Default Voice', type: 'voice-picker' },
        { key: 'speed', label: 'Speed', type: 'slider', min: 0.5, max: 2.0, step: 0.1, defaultValue: 1.0 },
    ],
    defaultConfig: { provider: 'cosyvoice', voice: '', speed: 1.0 },
}

const UPSCALE_NODE: WorkflowNodeTypeDefinition = {
    type: 'upscale',
    title: 'Image Upscale',
    description: 'Upscale and enhance image quality',
    icon: 'ZoomIn',
    category: 'transform',
    color: '#06b6d4',
    inputs: [
        { id: 'image', name: 'Image', type: 'image', required: true },
    ],
    outputs: [
        { id: 'image', name: 'Upscaled Image', type: 'image', required: true },
    ],
    configFields: [
        {
            key: 'scale', label: 'Scale Factor', type: 'select', options: [
                { label: '2x', value: '2' }, { label: '4x', value: '4' },
            ], defaultValue: '2'
        },
    ],
    defaultConfig: { scale: '2' },
}

const VIDEO_COMPOSE_NODE: WorkflowNodeTypeDefinition = {
    type: 'video-compose',
    title: 'Video Compose',
    description: 'Compose final video from clips, audio, and subtitles',
    icon: 'Film',
    category: 'transform',
    color: '#f97316',
    inputs: [
        { id: 'videos', name: 'Video Clips', type: 'video', required: true, multiple: true },
        { id: 'audio', name: 'Audio Track', type: 'audio', required: false },
    ],
    outputs: [
        { id: 'video', name: 'Final Video', type: 'video', required: true },
    ],
    configFields: [
        {
            key: 'transition', label: 'Transition', type: 'select', options: [
                { label: 'Cut', value: 'cut' }, { label: 'Fade', value: 'fade' }, { label: 'Dissolve', value: 'dissolve' },
            ], defaultValue: 'cut'
        },
        { key: 'addSubtitles', label: 'Add Subtitles', type: 'toggle', defaultValue: true },
    ],
    defaultConfig: { transition: 'cut', addSubtitles: true },
}

const CONDITION_NODE: WorkflowNodeTypeDefinition = {
    type: 'condition',
    title: 'Condition',
    description: 'Branch workflow based on conditions',
    icon: 'GitBranch',
    category: 'transform',
    color: '#84cc16',
    inputs: [
        { id: 'value', name: 'Value', type: 'any', required: true },
    ],
    outputs: [
        { id: 'true', name: 'True', type: 'any', required: true },
        { id: 'false', name: 'False', type: 'any', required: true },
    ],
    configFields: [
        { key: 'condition', label: 'Condition Expression', type: 'text', placeholder: 'e.g., length > 100', required: true },
    ],
    defaultConfig: { condition: '' },
}

const OUTPUT_NODE: WorkflowNodeTypeDefinition = {
    type: 'output',
    title: 'Output / Preview',
    description: 'Preview and export workflow results',
    icon: 'Download',
    category: 'output',
    color: '#10b981',
    inputs: [
        { id: 'content', name: 'Content', type: 'any', required: true },
    ],
    outputs: [],
    configFields: [
        { key: 'label', label: 'Output Label', type: 'text', placeholder: 'Final Result', defaultValue: 'Output' },
        { key: 'autoDownload', label: 'Auto Download', type: 'toggle', defaultValue: false },
    ],
    defaultConfig: { label: 'Output', autoDownload: false },
}

// ── Registry ──

export const NODE_TYPE_REGISTRY: Record<string, WorkflowNodeTypeDefinition> = {
    'text-input': TEXT_INPUT_NODE,
    'llm-prompt': LLM_PROMPT_NODE,
    'character-extract': CHARACTER_EXTRACT_NODE,
    'scene-extract': SCENE_EXTRACT_NODE,
    'storyboard': STORYBOARD_NODE,
    'image-generate': IMAGE_GENERATE_NODE,
    'video-generate': VIDEO_GENERATE_NODE,
    'voice-synthesis': VOICE_SYNTHESIS_NODE,
    'upscale': UPSCALE_NODE,
    'video-compose': VIDEO_COMPOSE_NODE,
    'condition': CONDITION_NODE,
    'output': OUTPUT_NODE,
}

export const NODE_TYPES_BY_CATEGORY = {
    input: [TEXT_INPUT_NODE],
    ai: [LLM_PROMPT_NODE, CHARACTER_EXTRACT_NODE, SCENE_EXTRACT_NODE, STORYBOARD_NODE],
    media: [IMAGE_GENERATE_NODE, VIDEO_GENERATE_NODE, VOICE_SYNTHESIS_NODE],
    transform: [UPSCALE_NODE, VIDEO_COMPOSE_NODE, CONDITION_NODE],
    output: [OUTPUT_NODE],
} as const

export const CATEGORY_LABELS: Record<string, string> = {
    input: '📝 Input',
    ai: '🤖 AI Processing',
    media: '🎨 Media Generation',
    transform: '🔄 Transform',
    output: '📤 Output',
}

export function getNodeTypeDefinition(type: string): WorkflowNodeTypeDefinition | undefined {
    return NODE_TYPE_REGISTRY[type]
}
