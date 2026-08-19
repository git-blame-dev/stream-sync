import React, { useEffect, useState } from 'react'
import { createEventFeed } from '../shared/create-event-feed'
import { parseFundingGoalSnapshot, selectNewestFundingGoal, type FundingGoalSnapshot } from '../shared/funding-goal'
import { FundingGoal } from './FundingGoal'
import type { GuiAppearanceProfile } from '../shared/appearance'

export interface GoalAppProps {
  eventsPath?: string
  initialProfile?: GuiAppearanceProfile
  createEventFeedImpl?: typeof createEventFeed
}

export function parseGoalEvent(payload: unknown): FundingGoalSnapshot | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = payload as Record<string, unknown>
  return value.__guiEvent === 'funding-goal' ? parseFundingGoalSnapshot(value) : null
}

export function GoalApp({
  eventsPath = '/gui/events',
  initialProfile = 'standard',
  createEventFeedImpl = createEventFeed,
}: GoalAppProps) {
  const [goal, setGoal] = useState<FundingGoalSnapshot | null>(null)
  useEffect(() => {
    setGoal(null)
    return createEventFeedImpl({
      url: eventsPath,
      onEvent: (payload) => {
        const next = parseGoalEvent(payload)
        if (next) {
          setGoal((current) => selectNewestFundingGoal(current, next))
        }
      },
    })
  }, [createEventFeedImpl, eventsPath])
  return (
    <main className="goal-page">
      {goal ? <FundingGoal goal={goal} profile={initialProfile} /> : null}
    </main>
  )
}
