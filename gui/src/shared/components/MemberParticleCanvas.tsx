import React from 'react'

import {
  generateMemberParticleSet,
  memberParticleHorizontalPosition,
  memberParticleOpacity,
  memberParticleProgress,
  memberParticleSeedId,
  type MemberParticle,
  type MemberParticleDirection
} from '../member-particles'

interface MemberParticleCanvasProps {
  readonly seed: string
  readonly direction?: MemberParticleDirection
}

interface ParticleSprite {
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
}

const SPRITE_SCALE = 2
const PARTICLE_VISUAL_SCALE = 1.25
const spriteCache = new Map<string, ParticleSprite>()

function createParticleSprite(size: number, tailScale: MemberParticle['tailScale']): ParticleSprite {
  const roundedSize = Math.max(1, Math.round(size * 2) / 2)
  const width = roundedSize * tailScale
  const height = tailScale === 1 ? roundedSize : 1
  const key = `${roundedSize}:${tailScale}`
  const cached = spriteCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * SPRITE_SCALE))
  canvas.height = Math.max(1, Math.ceil(height * SPRITE_SCALE))
  const context = canvas.getContext('2d')
  if (context) {
    context.scale(SPRITE_SCALE, SPRITE_SCALE)
    if (tailScale === 1) {
      const radius = roundedSize / 2
      const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius)
      gradient.addColorStop(0, '#fffce4')
      gradient.addColorStop(0.38, '#ffd978')
      gradient.addColorStop(1, 'rgba(255, 182, 61, 0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, roundedSize, roundedSize)
    } else {
      const gradient = context.createLinearGradient(0, 0, width, 0)
      gradient.addColorStop(0, '#ffffff')
      gradient.addColorStop(0.15, '#ffe295')
      gradient.addColorStop(1, 'rgba(227, 151, 42, 0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
    }
  }

  const sprite = { canvas, width, height }
  spriteCache.set(key, sprite)
  return sprite
}

function drawParticle(
  context: CanvasRenderingContext2D,
  particle: MemberParticle,
  progress: number,
  width: number,
  height: number,
  direction: MemberParticleDirection
): void {
  const opacity = memberParticleOpacity(particle, progress)
  if (opacity <= 0) return
  const sprite = createParticleSprite(particle.size * PARTICLE_VISUAL_SCALE, particle.tailScale)
  const x = memberParticleHorizontalPosition(direction, progress, width, sprite.width)
  const y = height * (particle.y / 100) + particle.drift * progress
  context.globalAlpha = opacity
  if (direction === 'left-to-right') {
    context.save()
    context.translate(x + sprite.width, 0)
    context.scale(-1, 1)
    context.drawImage(sprite.canvas, 0, y - sprite.height / 2, sprite.width, sprite.height)
    context.restore()
    return
  }
  context.drawImage(sprite.canvas, x, y - sprite.height / 2, sprite.width, sprite.height)
}

export function MemberParticleCanvas({ seed, direction = 'right-to-left' }: MemberParticleCanvasProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const particles = generateMemberParticleSet(seed)
    const startedAt = performance.now()
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animationFrame: number | null = null
    let isVisible = true
    let width = 0
    let height = 0
    let pixelRatio = 0

    const releaseBackingStore = () => {
      canvas.width = 1
      canvas.height = 1
      width = 0
      height = 0
      pixelRatio = 0
    }

    const stop = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      animationFrame = null
    }

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const nextWidth = bounds.width
      const nextHeight = bounds.height
      const nextPixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      if (
        nextWidth <= 0 ||
        nextHeight <= 0 ||
        (nextWidth === width && nextHeight === height && nextPixelRatio === pixelRatio)
      ) return
      width = nextWidth
      height = nextHeight
      pixelRatio = nextPixelRatio
      canvas.width = Math.max(1, Math.round(width * pixelRatio))
      canvas.height = Math.max(1, Math.round(height * pixelRatio))
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }

    const draw = (timestamp: number) => {
      animationFrame = null
      if (!isVisible || motionQuery.matches) return
      resize()
      if (width <= 0 || height <= 0) return
      context.clearRect(0, 0, width, height)
      const elapsed = timestamp - startedAt
      const burstTime = elapsed % particles.cycleMs
      for (const particle of particles.burst) {
        const progress = memberParticleProgress(particle, burstTime)
        if (progress !== null) drawParticle(context, particle, progress, width, height, direction)
      }
      for (const particle of particles.continuous) {
        if (elapsed < particle.startMs) continue
        const progress = ((elapsed - particle.startMs) % particle.durationMs) / particle.durationMs
        drawParticle(context, particle, progress, width, height, direction)
      }
      context.globalAlpha = 1
      animationFrame = requestAnimationFrame(draw)
    }

    const start = () => {
      if (animationFrame === null && isVisible && !motionQuery.matches) {
        animationFrame = requestAnimationFrame(draw)
      }
    }

    const handleMotionChange = () => {
      if (motionQuery.matches) {
        stop()
        releaseBackingStore()
      } else {
        start()
      }
    }

    const intersectionObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
          isVisible = entry?.isIntersecting === true
          if (isVisible) start()
          else {
            stop()
            releaseBackingStore()
          }
        })
      : null
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          if (!isVisible || motionQuery.matches) return
          resize()
          start()
        })
      : null

    if (motionQuery.matches) releaseBackingStore()
    intersectionObserver?.observe(canvas)
    resizeObserver?.observe(canvas)
    motionQuery.addEventListener('change', handleMotionChange)
    start()

    return () => {
      stop()
      intersectionObserver?.disconnect()
      resizeObserver?.disconnect()
      motionQuery.removeEventListener('change', handleMotionChange)
      releaseBackingStore()
    }
  }, [direction, seed])

  return (
    <canvas
      ref={canvasRef}
      className="gui-row__member-particles"
      data-member-particles-seed={memberParticleSeedId(seed)}
      aria-hidden="true"
    />
  )
}
