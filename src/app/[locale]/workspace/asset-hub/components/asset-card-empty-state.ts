import type { AppIconName } from '@/components/ui/icons'

export type AssetCardEmptyStateKind = 'character' | 'location'

export interface AssetCardEmptyStateConfig {
  readonly iconName: AppIconName
  readonly actions: readonly ['upload', 'generate']
}

const EMPTY_STATE_CONFIG: Record<AssetCardEmptyStateKind, AssetCardEmptyStateConfig> = {
  character: {
    iconName: 'image',
    actions: ['upload', 'generate'],
  },
  location: {
    iconName: 'globe2',
    actions: ['upload', 'generate'],
  },
}

export function getAssetCardEmptyStateConfig(kind: AssetCardEmptyStateKind): AssetCardEmptyStateConfig {
  return EMPTY_STATE_CONFIG[kind]
}
