import { isGuiFeedMode } from '../shared/feed-mode'
import type { GuiFeedMode } from '../shared/types'
import { parseGuiAppearanceSnapshot } from '../shared/appearance'

interface RuntimeConfigSource {
  __STREAM_SYNC_GUI_CONFIG__?: Record<string, unknown>
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Overlay runtime config requires positive integer ${fieldName}`)
  }

  return value
}

export function readOverlayRuntimeConfig(scope: RuntimeConfigSource = globalThis as RuntimeConfigSource): { overlayMaxMessages: number, overlayMaxLinesPerMessage: number, overlayFeedMode: GuiFeedMode, appearance: ReturnType<typeof parseGuiAppearanceSnapshot> } {
  const rawConfig = scope.__STREAM_SYNC_GUI_CONFIG__
  if (!rawConfig || typeof rawConfig !== 'object') {
    throw new Error('Overlay runtime config is required')
  }

  return {
    overlayMaxMessages: parsePositiveInteger(rawConfig.overlayMaxMessages, 'overlayMaxMessages'),
    overlayMaxLinesPerMessage: parsePositiveInteger(rawConfig.overlayMaxLinesPerMessage, 'overlayMaxLinesPerMessage'),
    overlayFeedMode: isGuiFeedMode(rawConfig.overlayFeedMode) ? rawConfig.overlayFeedMode : 'all',
    appearance: parseGuiAppearanceSnapshot(rawConfig.appearance)
  }
}
