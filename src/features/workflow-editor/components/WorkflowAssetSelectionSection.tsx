'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, ImageIcon, Loader2, MapPin, Search, Users } from 'lucide-react'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import {
  useGlobalCharacters,
  useGlobalLocations,
  type GlobalCharacter,
  type GlobalLocation,
} from '@/lib/query/hooks/useGlobalAssets'
import type { NodeExecutionState } from '@/lib/workflow-engine/types'
import {
  buildWorkflowCharacterAssetOutputs,
  buildWorkflowLocationAssetOutputs,
} from '@/lib/workflow-engine/reference-assets'

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function readSelectedIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    const rawValue = value.trim()
    if (!rawValue) return []
    try {
      return readSelectedIds(JSON.parse(rawValue) as unknown)
    } catch {
      return []
    }
  }

  return []
}

function resolvePreviewUrl(value: string | null | undefined): string {
  if (!value) return ''
  return toDisplayImageUrl(value) || value
}

function resolveCharacterPreview(character: GlobalCharacter): string {
  const primaryAppearance = [...(character.appearances || [])].sort(
    (left, right) => left.appearanceIndex - right.appearanceIndex,
  )[0]
  if (!primaryAppearance) return ''
  const selectedIndex = typeof primaryAppearance.selectedIndex === 'number' && primaryAppearance.selectedIndex >= 0
    ? primaryAppearance.selectedIndex
    : 0
  const selectedImage = primaryAppearance.imageUrls[selectedIndex]
    || primaryAppearance.imageUrl
    || primaryAppearance.imageUrls[0]
    || ''
  return resolvePreviewUrl(selectedImage)
}

function resolveLocationPreview(location: GlobalLocation): string {
  const selectedImage = location.images.find((image) => image.isSelected) || location.images[0]
  return resolvePreviewUrl(selectedImage?.imageUrl)
}

interface WorkflowAssetSelectionChange {
  configPatch: Record<string, unknown>
  outputs: Record<string, unknown>
  nodeState: NodeExecutionState
}

interface WorkflowAssetSelectionSectionProps {
  nodeType: string
  config: Record<string, unknown>
  onSelectionChange: (change: WorkflowAssetSelectionChange) => void
}

export function WorkflowAssetSelectionSection(props: WorkflowAssetSelectionSectionProps) {
  const isCharacterNode = props.nodeType === 'character-assets'
  const isLocationNode = props.nodeType === 'location-assets'
  const shouldRender = isCharacterNode || isLocationNode
  const [search, setSearch] = useState('')

  const charactersQuery = useGlobalCharacters()
  const locationsQuery = useGlobalLocations()

  const selectedIds = useMemo(() => (
    isCharacterNode
      ? readSelectedIds(props.config.selectedCharacterIds)
      : readSelectedIds(props.config.selectedLocationIds)
  ), [isCharacterNode, props.config.selectedCharacterIds, props.config.selectedLocationIds])

  const allCharacters = charactersQuery.data || []
  const allLocations = locationsQuery.data || []
  const searchQuery = search.trim().toLowerCase()

  const filteredCharacters = useMemo(() => (
    allCharacters.filter((character) => {
      if (!searchQuery) return true
      return character.name.toLowerCase().includes(searchQuery)
    })
  ), [allCharacters, searchQuery])

  const filteredLocations = useMemo(() => (
    allLocations.filter((location) => {
      if (!searchQuery) return true
      return location.name.toLowerCase().includes(searchQuery)
        || (location.summary || '').toLowerCase().includes(searchQuery)
    })
  ), [allLocations, searchQuery])

  const syncSelection = (nextSelectedIds: string[]) => {
    if (isCharacterNode) {
      const characterById = new Map(allCharacters.map((character) => [character.id, character]))
      const selectedCharacters = nextSelectedIds
        .map((characterId) => characterById.get(characterId))
        .filter(isDefined)
      const outputs = buildWorkflowCharacterAssetOutputs(selectedCharacters)
      props.onSelectionChange({
        configPatch: { selectedCharacterIds: nextSelectedIds },
        outputs,
        nodeState: {
          status: 'completed',
          progress: 100,
          message: outputs.summary,
          completedAt: new Date().toISOString(),
          outputs,
        },
      })
      return
    }

    const locationById = new Map(allLocations.map((location) => [location.id, location]))
    const selectedLocations = nextSelectedIds
      .map((locationId) => locationById.get(locationId))
      .filter(isDefined)
    const outputs = buildWorkflowLocationAssetOutputs(selectedLocations)
    props.onSelectionChange({
      configPatch: { selectedLocationIds: nextSelectedIds },
      outputs,
      nodeState: {
        status: 'completed',
        progress: 100,
        message: outputs.summary,
        completedAt: new Date().toISOString(),
        outputs,
      },
    })
  }

  const toggleSelectedId = (assetId: string) => {
    const nextSelectedIds = selectedIds.includes(assetId)
      ? selectedIds.filter((selectedId) => selectedId !== assetId)
      : [...selectedIds, assetId]
    syncSelection(nextSelectedIds)
  }

  const clearSelection = () => {
    syncSelection([])
  }

  const selectFiltered = () => {
    const filteredIds = isCharacterNode
      ? filteredCharacters.map((character) => character.id)
      : filteredLocations.map((location) => location.id)
    syncSelection(filteredIds)
  }

  if (!shouldRender) return null

  const loading = isCharacterNode ? charactersQuery.isLoading : locationsQuery.isLoading
  const error = isCharacterNode ? charactersQuery.error : locationsQuery.error
  const items = isCharacterNode ? filteredCharacters : filteredLocations
  const title = isCharacterNode ? 'Asset Hub Characters' : 'Asset Hub Locations'
  const helperText = isCharacterNode
    ? 'Select the character refs that should stay consistent when storyboard panels are materialized.'
    : 'Select the location refs that should anchor storyboard shots and panel environments.'
  const Icon = isCharacterNode ? Users : MapPin

  return (
    <div className="border-t border-slate-800">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{title}</span>
      </div>
      <div className="px-4 pb-4 space-y-3">
        <div className="rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          {helperText}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isCharacterNode ? 'Search characters...' : 'Search locations...'}
            className="w-full rounded-lg border border-slate-700 bg-slate-800/80 py-2 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>{`${selectedIds.length} selected`}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectFiltered}
              disabled={items.length === 0}
              className="rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-300 transition-colors hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Select visible
            </button>
            <button
              type="button"
              onClick={clearSelection}
              disabled={selectedIds.length === 0}
              className="rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-300 transition-colors hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-3 text-xs text-slate-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
            Loading Asset Hub items...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-xs text-red-200">
            {error instanceof Error ? error.message : 'Failed to load Asset Hub items.'}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-3 text-xs text-slate-400">
            {searchQuery
              ? 'No assets match the current search.'
              : 'No Asset Hub references are available yet.'}
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="space-y-2">
            {isCharacterNode && filteredCharacters.map((character) => {
              const isSelected = selectedIds.includes(character.id)
              const previewUrl = resolveCharacterPreview(character)
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => toggleSelectedId(character.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all ${
                    isSelected
                      ? 'border-blue-400 bg-blue-500/10 shadow-lg shadow-blue-500/10'
                      : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
                  }`}
                >
                  <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                    {previewUrl ? (
                      <MediaImageWithLoading
                        src={previewUrl}
                        alt={character.name}
                        containerClassName="h-14 w-14"
                        className="h-14 w-14 object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">{character.name}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {`${character.appearances.length} appearance${character.appearances.length === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  {isSelected && <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-blue-300" />}
                </button>
              )
            })}

            {isLocationNode && filteredLocations.map((location) => {
              const isSelected = selectedIds.includes(location.id)
              const previewUrl = resolveLocationPreview(location)
              return (
                <button
                  key={location.id}
                  type="button"
                  onClick={() => toggleSelectedId(location.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all ${
                    isSelected
                      ? 'border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-500/10'
                      : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
                  }`}
                >
                  <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                    {previewUrl ? (
                      <MediaImageWithLoading
                        src={previewUrl}
                        alt={location.name}
                        containerClassName="h-14 w-14"
                        className="h-14 w-14 object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">{location.name}</div>
                    <div className="mt-0.5 truncate text-[10px] text-slate-500">
                      {location.summary || `${location.images.length} image reference${location.images.length === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  {isSelected && <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-300" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
