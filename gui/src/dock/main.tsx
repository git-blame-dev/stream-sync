import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { App } from '../shared/App'
import '../shared/styles.css'

interface DockRuntimeConfigSource {
  __STREAM_SYNC_GUI_CONFIG__?: Record<string, unknown>
}

interface DockBootstrapTarget {
  textContent: string
  setAttribute: (name: string, value: string) => void
}

interface DockBootstrapDependencies {
  target?: DockBootstrapTarget | null
  createRootImpl?: (target: DockBootstrapTarget) => Pick<Root, 'render'>
  readDockRuntimeConfigImpl?: typeof readDockRuntimeConfig
}

function coerceMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown bootstrap error'
}

export function readDockRuntimeConfig(scope: DockRuntimeConfigSource = globalThis as DockRuntimeConfigSource): { uiCompareMode: boolean } {
  const runtimeConfig = scope.__STREAM_SYNC_GUI_CONFIG__
  return {
    uiCompareMode: runtimeConfig?.uiCompareMode === true
  }
}

export function bootstrapDockApp(dependencies: DockBootstrapDependencies = {}): boolean {
  const target = dependencies.target !== undefined
    ? dependencies.target
    : (typeof document !== 'undefined' ? (document.getElementById('app') as DockBootstrapTarget | null) : null)
  if (!target) {
    return false
  }

  const createRootImpl = dependencies.createRootImpl || ((element) => createRoot(element as Element))
  const readDockRuntimeConfigImpl = dependencies.readDockRuntimeConfigImpl || readDockRuntimeConfig

  try {
    const runtimeConfig = readDockRuntimeConfigImpl()
    const root = createRootImpl(target)
    root.render(
      <App
        mode="dock"
        uiCompareMode={runtimeConfig.uiCompareMode}
      />
    )
    return true
  } catch (error) {
    target.setAttribute('data-gui-bootstrap-error', 'true')
    target.textContent = `Dock failed to load: ${coerceMessage(error)}`
    return false
  }
}

bootstrapDockApp()
