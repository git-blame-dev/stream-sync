import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ChatDemo } from './ChatDemo'
import '../shared/styles.css'

interface DemoBootstrapTarget {
  textContent: string
  setAttribute: (name: string, value: string) => void
}

interface DemoBootstrapDependencies {
  target?: DemoBootstrapTarget | null
  createRootImpl?: (target: DemoBootstrapTarget) => Pick<Root, 'render'>
}

function coerceMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown bootstrap error'
}

export function bootstrapChatDemo(dependencies: DemoBootstrapDependencies = {}): boolean {
  const target = dependencies.target !== undefined
    ? dependencies.target
    : (typeof document !== 'undefined' ? (document.getElementById('app') as DemoBootstrapTarget | null) : null)
  if (!target) {
    return false
  }

  const createRootImpl = dependencies.createRootImpl || ((element) => createRoot(element as Element))

  try {
    const root = createRootImpl(target)
    root.render(<ChatDemo />)
    return true
  } catch (error) {
    target.setAttribute('data-gui-bootstrap-error', 'true')
    target.textContent = `Demo failed to load: ${coerceMessage(error)}`
    return false
  }
}

bootstrapChatDemo()
