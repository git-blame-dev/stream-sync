import React from 'react'
import type { RowPresentation } from '../row-presentation'
import { MemberParticleCanvas } from './MemberParticleCanvas'

export function RowVisualEffects({ presentation, seed }: { presentation: RowPresentation; seed: string }) {
  if (presentation.effects.length === 0) return null

  return <div className="gui-row__effect-layer" aria-hidden="true">
    {presentation.effects.map((effect, index) => {
      switch (effect) {
        case 'sheen':
          return <span key={effect} className="gui-row__effect gui-row__effect--sheen" style={{ zIndex: index }} />
        case 'particles':
          return <span key={effect} className="gui-row__effect" style={{ zIndex: index }}>
            <MemberParticleCanvas seed={seed} />
          </span>
        default: return assertNever(effect)
      }
    })}
  </div>
}

function assertNever(value: never): never {
  throw new Error(`Unsupported row effect: ${String(value)}`)
}
