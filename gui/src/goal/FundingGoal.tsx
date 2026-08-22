import React from 'react'
import type { GuiAppearanceProfile } from '../shared/appearance'
import { MemberParticleCanvas } from '../shared/components/MemberParticleCanvas'
import { deriveFundingGoalDisplayState, type FundingGoalSnapshot } from '../shared/funding-goal'

interface FundingGoalProps {
  goal: FundingGoalSnapshot
  profile?: GuiAppearanceProfile
}

export function FundingGoal({ goal, profile = 'standard' }: FundingGoalProps) {
  if (!goal.enabled) {
    return null
  }
  const display = deriveFundingGoalDisplayState(goal)
  const emojiLabel = /^(\p{Extended_Pictographic}(?:\p{Emoji_Modifier})?(?:\uFE0E|\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier})?(?:\uFE0E|\uFE0F)?)*)(?:\s+)?(.*)$/u.exec(goal.label)
  const label = (
    <span className="funding-goal__label" aria-label={goal.label}>
      {emojiLabel ? <span className="funding-goal__emoji" aria-hidden="true">{emojiLabel[1]}</span> : null}
      {emojiLabel ? emojiLabel[2] : goal.label}
    </span>
  )
  const labelGroup = (
    <span className="funding-goal__label-group">
      <span className="funding-goal__badge">{display.isComplete ? 'FUNDED' : 'GOAL'}</span>
      {label}
    </span>
  )
  const rail = (
    <div
      className="funding-goal__rail"
      role="progressbar"
      aria-label={goal.label}
      aria-valuemin={0}
      aria-valuemax={goal.targetUsd}
      aria-valuenow={display.progressValue}
      aria-valuetext={display.progressValueText}
    >
      <div className="funding-goal__fill" style={{ transform: `scaleX(${display.progressRatio})` }} />
      <MemberParticleCanvas seed={`funding-goal:${goal.id}`} direction="left-to-right" />
    </div>
  )
  return (
    <section className={`funding-goal funding-goal--${profile}`} aria-label={goal.label}>
      {profile === 'minimal' ? (
        <div className="funding-goal__summary">
          {labelGroup}
          {rail}
          <span className="funding-goal__amount">
            <span className="funding-goal__current-amount">{display.currentText}</span>
            <span> / </span>
            <span>{display.targetText} <span className="funding-goal__unit">USD</span></span>
          </span>
        </div>
      ) : (
        <div className="funding-goal__summary">
          <div className="funding-goal__identity">
            {labelGroup}
            {rail}
          </div>
          <span className="funding-goal__raised-copy" aria-label={`${display.currentText} raised of ${display.targetText} USD`}>
            <span className="funding-goal__raised-value">{display.currentText} raised</span>
            <span className="funding-goal__target-value">of {display.targetText} <span className="funding-goal__unit">USD</span></span>
          </span>
        </div>
      )}
    </section>
  )
}
