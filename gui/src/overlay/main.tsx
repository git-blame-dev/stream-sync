import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { App } from '../shared/App'
import { readOverlayRuntimeConfig } from './runtime-config'
import '../shared/styles.css'

interface OverlayBootstrapTarget {
  textContent: string
  setAttribute: (name: string, value: string) => void
}

interface OverlayBootstrapDependencies {
  target?: OverlayBootstrapTarget | null
  createRootImpl?: (target: OverlayBootstrapTarget) => Pick<Root, 'render'>
  readOverlayRuntimeConfigImpl?: typeof readOverlayRuntimeConfig
}

function coerceMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown bootstrap error'
}

export function bootstrapOverlayApp(dependencies: OverlayBootstrapDependencies = {}): boolean {
  const target = dependencies.target !== undefined
    ? dependencies.target
    : (typeof document !== 'undefined' ? (document.getElementById('app') as OverlayBootstrapTarget | null) : null)
  if (!target) {
    return false
  }

  const createRootImpl = dependencies.createRootImpl || ((element) => createRoot(element as Element))
  const readOverlayRuntimeConfigImpl = dependencies.readOverlayRuntimeConfigImpl || readOverlayRuntimeConfig

  try {
    const runtimeConfig = readOverlayRuntimeConfigImpl()
    const root = createRootImpl(target)
    root.render(
      <App
        mode="overlay"
        overlayMaxMessages={runtimeConfig.overlayMaxMessages}
        overlayMaxLinesPerMessage={runtimeConfig.overlayMaxLinesPerMessage}
      />
    )
    return true
  } catch (error) {
    target.setAttribute('data-gui-bootstrap-error', 'true')
    target.textContent = `Overlay failed to load: ${coerceMessage(error)}`
    return false
  }
}

bootstrapOverlayApp()
