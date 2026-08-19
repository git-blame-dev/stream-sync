import { parseGuiAppearanceSnapshot, type GuiAppearanceProfile } from '../shared/appearance'

interface GoalRuntimeScope {
  __STREAM_SYNC_GUI_CONFIG__?: Record<string, unknown>
}

interface GoalRuntimeConfig {
  appearance: GuiAppearanceProfile
}

export function readGoalRuntimeConfig(
  scope: GoalRuntimeScope = globalThis as GoalRuntimeScope,
): GoalRuntimeConfig {
  const config = scope.__STREAM_SYNC_GUI_CONFIG__ ?? {}
  const appearance = parseGuiAppearanceSnapshot(config.appearance)
  const profile: GuiAppearanceProfile = appearance.profile === 'minimal' ? 'minimal' : 'standard'
  return { appearance: profile }
}
