export const MEMBER_PARTICLE_CYCLE_MS = 15_700
export const MEMBER_PARTICLE_BURST_COUNT = 132
export const MEMBER_PARTICLE_CONTINUOUS_COUNT = 54

const DESIGN_SEED = 4409
const BURST_SPAWN_WINDOW_MS = 5_700
const BURST_TRAVEL_MS = 3_700
const CONTINUOUS_START_MS = 5_700
const CONTINUOUS_START_WINDOW_MS = 6_300

export interface MemberParticleMotion {
  readonly startMs: number
  readonly durationMs: number
  readonly y: number
  readonly size: number
  readonly drift: number
}

export interface MemberParticle extends MemberParticleMotion {
  readonly kind: 'burst' | 'continuous'
  readonly opacity: number
  readonly tailScale: 1 | 9 | 14
}

export interface MemberParticleSet {
  readonly burst: readonly MemberParticle[]
  readonly continuous: readonly MemberParticle[]
  readonly cycleMs: number
}

export interface EvaluatedMemberParticle {
  readonly x: number
  readonly y: number
  readonly size: number
  readonly progress: number
}

function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function createRandom(seed: string): () => number {
  let state = hashString(`${DESIGN_SEED}:${seed}`) || 0x6d2b79f5
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

function between(random: () => number, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * random()
}

function tailScaleFor(index: number): MemberParticle['tailScale'] {
  const childIndex = index + 1
  if (childIndex % 5 === 0) return 14
  if (childIndex % 2 === 0) return 9
  return 1
}

export function memberParticleSeedId(seed: string): string {
  return hashString(`${DESIGN_SEED}:${seed}`).toString(36)
}

export function generateMemberParticleSet(seed: string): MemberParticleSet {
  const random = createRandom(seed)
  const burst = Array.from({ length: MEMBER_PARTICLE_BURST_COUNT }, (_, index): MemberParticle => ({
    kind: 'burst',
    startMs: index === 0
      ? 0
      : index === MEMBER_PARTICLE_BURST_COUNT - 1
        ? BURST_SPAWN_WINDOW_MS
        : between(random, 0, BURST_SPAWN_WINDOW_MS),
    durationMs: BURST_TRAVEL_MS,
    y: between(random, 10, 88),
    size: between(random, 1, 4),
    drift: between(random, -11, 11),
    opacity: between(random, 0.56, 0.96),
    tailScale: tailScaleFor(index)
  }))
  const continuous = Array.from({ length: MEMBER_PARTICLE_CONTINUOUS_COUNT }, (_, index): MemberParticle => ({
    kind: 'continuous',
    startMs: CONTINUOUS_START_MS + between(random, 0, CONTINUOUS_START_WINDOW_MS),
    durationMs: between(random, 7_500, 10_500),
    y: between(random, 10, 88),
    size: between(random, 1, 3),
    drift: between(random, -9, 9),
    opacity: between(random, 0.56, 0.96),
    tailScale: tailScaleFor(MEMBER_PARTICLE_BURST_COUNT + index)
  }))

  return { burst, continuous, cycleMs: MEMBER_PARTICLE_CYCLE_MS }
}

export function memberParticleProgress(particle: MemberParticleMotion, timestampMs: number): number | null {
  if (timestampMs < particle.startMs || timestampMs >= particle.startMs + particle.durationMs) return null
  return (timestampMs - particle.startMs) / particle.durationMs
}

export function evaluateMemberParticle(
  particle: MemberParticleMotion,
  timestampMs: number
): EvaluatedMemberParticle | null {
  const progress = memberParticleProgress(particle, timestampMs)
  if (progress === null) return null
  return {
    x: 100 * (1 - progress),
    y: particle.y + particle.drift * progress,
    size: particle.size,
    progress
  }
}

export function memberParticleOpacity(particle: MemberParticle, progress: number): number {
  if (particle.kind === 'burst') {
    if (progress < 0.064) return particle.opacity * (progress / 0.064)
    if (progress > 0.955) return particle.opacity * ((1 - progress) / 0.045)
    return particle.opacity
  }
  if (progress < 0.09) return particle.opacity * 0.72 * (progress / 0.09)
  if (progress > 0.86) return particle.opacity * 0.58 * ((1 - progress) / 0.14)
  const fade = (progress - 0.09) / 0.77
  return particle.opacity * (0.72 - 0.14 * fade)
}
