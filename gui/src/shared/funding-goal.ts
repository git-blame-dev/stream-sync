export interface FundingGoalSnapshot {
  enabled: boolean
  id: string
  label: string
  currentUsd: number
  targetUsd: number
  completed: boolean
  revision: number
  sessionId: string
}

export interface FundingGoalDisplayState {
  currentText: string
  targetText: string
  progressRatio: number
  progressValue: number
  progressValueText: string
  isOverTarget: boolean
}

export function parseFundingGoalSnapshot(value: unknown): FundingGoalSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (typeof item.enabled !== 'boolean' || typeof item.id !== 'string' || item.id.trim().length === 0
    || typeof item.label !== 'string' || item.label.trim().length === 0
    || typeof item.currentUsd !== 'number' || !Number.isFinite(item.currentUsd) || item.currentUsd < 0
    || typeof item.targetUsd !== 'number' || !Number.isFinite(item.targetUsd) || item.targetUsd <= 0
    || typeof item.completed !== 'boolean' || typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 0
    || typeof item.sessionId !== 'string' || item.sessionId.length === 0) return null
  return {
    enabled: item.enabled,
    id: item.id,
    label: item.label,
    currentUsd: item.currentUsd,
    targetUsd: item.targetUsd,
    completed: item.completed,
    revision: item.revision,
    sessionId: item.sessionId,
  }
}

export function selectNewestFundingGoal<T extends FundingGoalSnapshot>(current: T | null, next: T): T {
  return current === null || current.id !== next.id || current.sessionId !== next.sessionId || next.revision > current.revision
    ? next
    : current
}

export function formatFundingUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

export function deriveFundingGoalDisplayState(goal: FundingGoalSnapshot): FundingGoalDisplayState {
  const progressValue = Math.min(goal.currentUsd, goal.targetUsd)
  const currentText = formatFundingUsd(goal.currentUsd)
  const targetText = formatFundingUsd(goal.targetUsd)
  return {
    currentText,
    targetText,
    progressRatio: progressValue / goal.targetUsd,
    progressValue,
    progressValueText: `${currentText} of ${targetText}${goal.completed ? ', goal reached' : ''}`,
    isOverTarget: goal.currentUsd > goal.targetUsd,
  }
}
