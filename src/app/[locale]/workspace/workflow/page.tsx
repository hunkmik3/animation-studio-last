// =============================================
// Workflow Editor Page
// Full-screen node-based workflow editor
// =============================================
'use client'

import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { shouldRenderWorkflowEditor } from '@/features/workflow-editor/workflow-home-helpers'

// Dynamic import to avoid SSR issues with React Flow
const WorkflowEditor = dynamic(
    () => import('@/features/workflow-editor/WorkflowEditor'),
    {
        ssr: false,
        loading: () => (
            <div
                className="flex items-center justify-center h-screen"
                style={{ background: '#0a0f1e' }}
            >
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-sm text-slate-400">Loading Workflow Editor...</p>
                </div>
            </div>
        ),
    },
)

const WorkflowHome = dynamic(
    () => import('@/features/workflow-editor/WorkflowHome'),
    {
        ssr: false,
        loading: () => (
            <div
                className="flex items-center justify-center h-screen"
                style={{ background: '#0a0f1e' }}
            >
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-sm text-slate-400">Loading Workflow Home...</p>
                </div>
            </div>
        ),
    },
)

export default function WorkflowPage() {
    const searchParams = useSearchParams()
    const workflowId = searchParams?.get('id') || null
    const projectId = searchParams?.get('projectId') || null
    const editor = searchParams?.get('editor') || null

    if (shouldRenderWorkflowEditor({ workflowId, projectId, editor })) {
        return <WorkflowEditor />
    }

    return <WorkflowHome />
}
