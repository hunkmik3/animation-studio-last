'use client'

import { AppIcon } from '@/components/ui/icons'
import { useParams } from 'next/navigation'

interface WorkspaceTopActionsProps {
  projectId: string
  onOpenAssetLibrary: () => void
  onOpenSettings: () => void
  onRefresh: () => void
  assetLibraryLabel: string
  settingsLabel: string
  refreshTitle: string
}

export default function WorkspaceTopActions({
  projectId,
  onOpenAssetLibrary,
  onOpenSettings,
  onRefresh,
  assetLibraryLabel,
  settingsLabel,
  refreshTitle,
}: WorkspaceTopActionsProps) {
  const params = useParams()
  const locale = params?.locale as string || 'en'

  return (
    <div className="fixed top-20 right-6 z-50 flex gap-3">
      {/* Workflow Editor Node Button */}
      <a
        href={`/${locale}/workspace/workflow?projectId=${projectId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="glass-btn-base flex items-center gap-2 px-4 py-3 rounded-3xl bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)] transition-all"
        title="Open node-based Workflow Editor"
      >
        <AppIcon name="cpu" className="w-5 h-5" />
        <span className="font-semibold text-sm hidden md:inline tracking-[0.01em]">Workflow</span>
      </a>

      <button
        onClick={onOpenAssetLibrary}
        className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-3 rounded-3xl text-[var(--glass-text-primary)]"
      >
        <AppIcon name="package" className="h-5 w-5" />
        <span className="font-semibold text-sm hidden md:inline tracking-[0.01em]">{assetLibraryLabel}</span>
      </button>
      <button
        onClick={onOpenSettings}
        className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-3 rounded-3xl text-[var(--glass-text-primary)]"
      >
        <AppIcon name="settingsHexMinor" className="h-5 w-5" />
        <span className="font-semibold text-sm hidden md:inline tracking-[0.01em]">{settingsLabel}</span>
      </button>
      <button
        onClick={onRefresh}
        className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-3 rounded-3xl text-[var(--glass-text-primary)]"
        title={refreshTitle}
      >
        <AppIcon name="refresh" className="w-5 h-5" />
      </button>
    </div>
  )
}
