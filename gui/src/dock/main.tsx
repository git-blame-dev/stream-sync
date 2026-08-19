import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { App } from '../shared/App'
import { isGuiFeedMode } from '../shared/feed-mode'
import type { GuiAppMode, GuiFeedMode } from '../shared/types'
import { parseGuiAppearanceSnapshot, type GuiAppearance } from '../shared/appearance'
import '../shared/styles.css'

interface DockRuntimeConfigSource {
  __STREAM_SYNC_GUI_CONFIG__?: Record<string, unknown>
  __STREAM_SYNC_GUI_KIND__?: string
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

export function readDockRuntimeConfig(scope: DockRuntimeConfigSource = globalThis as DockRuntimeConfigSource): { mode: Extract<GuiAppMode, 'dock' | 'notifications' | 'tiktok-animations'>, feedMode: GuiFeedMode, dockMaxMessages: number, notificationTransitionMs: number, appearance: GuiAppearance } {
  const runtimeKind = typeof scope.__STREAM_SYNC_GUI_KIND__ === 'string'
    ? scope.__STREAM_SYNC_GUI_KIND__.trim().toLowerCase()
    : ''
  const rawConfig = scope.__STREAM_SYNC_GUI_CONFIG__ ?? {}
  return {
    mode: runtimeKind === 'tiktok-animations' || runtimeKind === 'notifications' ? runtimeKind : 'dock',
    feedMode: runtimeKind === 'notifications'
      ? 'non-chat'
      : (isGuiFeedMode(scope.__STREAM_SYNC_GUI_CONFIG__?.dockFeedMode) ? scope.__STREAM_SYNC_GUI_CONFIG__?.dockFeedMode as GuiFeedMode : 'all'),
    dockMaxMessages: Number.isInteger(rawConfig.dockMaxMessages) && Number(rawConfig.dockMaxMessages) >= 1 && Number(rawConfig.dockMaxMessages) <= 2000 ? Number(rawConfig.dockMaxMessages) : 200,
    notificationTransitionMs: Number.isInteger(scope.__STREAM_SYNC_GUI_CONFIG__?.notificationTransitionMs) && Number(scope.__STREAM_SYNC_GUI_CONFIG__?.notificationTransitionMs) >= 0
      ? Number(scope.__STREAM_SYNC_GUI_CONFIG__?.notificationTransitionMs)
      : 1000,
    appearance: parseGuiAppearanceSnapshot(rawConfig.appearance)
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
        mode={runtimeConfig.mode}
        feedMode={runtimeConfig.feedMode}
        dockMaxMessages={runtimeConfig.dockMaxMessages}
        notificationTransitionMs={runtimeConfig.notificationTransitionMs}
        initialAppearance={runtimeConfig.appearance}
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
