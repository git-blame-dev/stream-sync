import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GoalApp } from './App'
import { readGoalRuntimeConfig } from './runtime-config'
import '../shared/styles.css'

interface GoalBootstrapTarget {
  textContent: string
  setAttribute: (name: string, value: string) => void
}

interface GoalBootstrapDependencies {
  target?: GoalBootstrapTarget | null
  createRootImpl?: (target: GoalBootstrapTarget) => Pick<Root, 'render'>
  readGoalRuntimeConfigImpl?: typeof readGoalRuntimeConfig
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown bootstrap error'
}

export function bootstrapGoalApp(dependencies: GoalBootstrapDependencies = {}): boolean {
  const mountTarget = dependencies.target !== undefined
    ? dependencies.target
    : (typeof document !== 'undefined' ? document.getElementById('app') : null)
  if (!mountTarget) {
    return false
  }

  const createRootImpl = dependencies.createRootImpl || ((target) => createRoot(target as Element))
  const readGoalRuntimeConfigImpl = dependencies.readGoalRuntimeConfigImpl || readGoalRuntimeConfig

  try {
    const runtimeConfig = readGoalRuntimeConfigImpl()
    createRootImpl(mountTarget).render(<GoalApp initialProfile={runtimeConfig.appearance} />)
    return true
  } catch (error) {
    mountTarget.setAttribute('data-gui-bootstrap-error', 'true')
    mountTarget.textContent = `Goal failed to load: ${errorMessage(error)}`
    return false
  }
}

if (typeof document !== 'undefined') {
  bootstrapGoalApp()
}
