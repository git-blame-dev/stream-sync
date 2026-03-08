interface RuntimeConfigSource {
  __STREAM_SYNC_GUI_CONFIG__?: Record<string, unknown>
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Overlay runtime config requires positive integer ${fieldName}`)
  }

  return parsed
}

export function readOverlayRuntimeConfig(scope: RuntimeConfigSource = globalThis as RuntimeConfigSource) {
  const rawConfig = scope.__STREAM_SYNC_GUI_CONFIG__
  if (!rawConfig || typeof rawConfig !== 'object') {
    throw new Error('Overlay runtime config is required')
  }

  return {
    overlayMaxMessages: parsePositiveInteger(rawConfig.overlayMaxMessages, 'overlayMaxMessages'),
    overlayMaxLinesPerMessage: parsePositiveInteger(rawConfig.overlayMaxLinesPerMessage, 'overlayMaxLinesPerMessage')
  }
}
