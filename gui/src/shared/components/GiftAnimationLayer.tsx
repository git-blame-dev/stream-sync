import React, { useEffect, useRef } from 'react'

import type { GuiGiftAnimationEffectEnvelope } from '../types'

interface GiftAnimationLayerProps {
  effect: GuiGiftAnimationEffectEnvelope | null
  onComplete: (playbackId: string) => void
}

function clampFrame(frame: [number, number, number, number], sourceWidth: number, sourceHeight: number): [number, number, number, number] {
  const maxX = Math.max(0, sourceWidth - 1)
  const maxY = Math.max(0, sourceHeight - 1)
  const x = Math.max(0, Math.min(maxX, frame[0]))
  const y = Math.max(0, Math.min(maxY, frame[1]))
  const width = Math.max(1, Math.min(sourceWidth - x, frame[2]))
  const height = Math.max(1, Math.min(sourceHeight - y, frame[3]))
  return [x, y, width, height]
}

export function GiftAnimationLayer({ effect, onComplete }: GiftAnimationLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const rgbBufferRef = useRef<HTMLCanvasElement | null>(null)
  const alphaBufferRef = useRef<HTMLCanvasElement | null>(null)
  const onCompleteRef = useRef(onComplete)
  const currentPlaybackIdRef = useRef<string>('')
  const rafRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    currentPlaybackIdRef.current = effect?.playbackId || ''

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    const canvas = canvasRef.current
    const video = videoRef.current
    if (!effect || !canvas || !video) {
      if (video) {
        video.pause()
        video.removeAttribute('src')
      }
      return
    }

    const activePlaybackId = effect.playbackId
    const { config } = effect
    const rgbFrame = clampFrame(config.rgbFrame, config.sourceWidth, config.sourceHeight)
    const alphaFrame = config.aFrame ? clampFrame(config.aFrame, config.sourceWidth, config.sourceHeight) : null
    const hasAlpha = !!alphaFrame

    const compositeWidth = hasAlpha ? Math.min(rgbFrame[2], alphaFrame[2]) : rgbFrame[2]
    const compositeHeight = hasAlpha ? Math.min(rgbFrame[3], alphaFrame[3]) : rgbFrame[3]
    const outputWidth = Math.max(1, config.renderWidth)
    const outputHeight = Math.max(1, config.renderHeight)

    let viewportWidth = 0
    let viewportHeight = 0
    let drawWidth = outputWidth
    let drawHeight = outputHeight
    let drawX = 0
    let drawY = 0

    const updateViewport = () => {
      const nextViewportWidth = Math.max(1, Math.round(canvas.clientWidth) || outputWidth)
      const nextViewportHeight = Math.max(1, Math.round(canvas.clientHeight) || outputHeight)

      if (viewportWidth === nextViewportWidth && viewportHeight === nextViewportHeight) {
        return
      }

      viewportWidth = nextViewportWidth
      viewportHeight = nextViewportHeight
      canvas.width = viewportWidth
      canvas.height = viewportHeight

      const fitScale = Math.min(viewportWidth / outputWidth, viewportHeight / outputHeight)
      drawWidth = Math.max(1, Math.round(outputWidth * fitScale))
      drawHeight = Math.max(1, Math.round(outputHeight * fitScale))
      drawX = Math.floor((viewportWidth - drawWidth) / 2)
      drawY = Math.floor((viewportHeight - drawHeight) / 2)
    }

    updateViewport()

    if (!rgbBufferRef.current) {
      rgbBufferRef.current = document.createElement('canvas')
    }

    const rgbBuffer = rgbBufferRef.current
    rgbBuffer.width = compositeWidth
    rgbBuffer.height = compositeHeight

    let alphaBuffer: HTMLCanvasElement | null = null
    if (hasAlpha) {
      if (!alphaBufferRef.current) {
        alphaBufferRef.current = document.createElement('canvas')
      }
      alphaBuffer = alphaBufferRef.current
      alphaBuffer.width = compositeWidth
      alphaBuffer.height = compositeHeight
    }

    const canvasContext = canvas.getContext('2d')
    const rgbContext = rgbBuffer.getContext('2d', { willReadFrequently: true })
    const alphaContext = alphaBuffer?.getContext('2d', { willReadFrequently: true }) || null
    if (!canvasContext || !rgbContext) {
      onCompleteRef.current(activePlaybackId)
      return
    }

    const drawToViewport = (source: HTMLCanvasElement) => {
      canvasContext.clearRect(0, 0, viewportWidth, viewportHeight)
      canvasContext.drawImage(source, drawX, drawY, drawWidth, drawHeight)
    }

    const finishPlayback = () => {
      if (currentPlaybackIdRef.current !== activePlaybackId) {
        return
      }
      onCompleteRef.current(activePlaybackId)
    }

    const tryResumePlayback = () => {
      if (currentPlaybackIdRef.current !== activePlaybackId || video.ended || !video.paused) {
        return
      }

      void video.play().catch(() => {
        finishPlayback()
      })
    }

    let mergedData: ImageData | null = null

    const renderFrame = () => {
      if (currentPlaybackIdRef.current !== activePlaybackId) {
        return
      }

      if (video.paused && !video.ended) {
        tryResumePlayback()
      }

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        updateViewport()

        rgbContext.clearRect(0, 0, rgbBuffer.width, rgbBuffer.height)
        rgbContext.drawImage(
          video,
          rgbFrame[0],
          rgbFrame[1],
          rgbFrame[2],
          rgbFrame[3],
          0,
          0,
          compositeWidth,
          compositeHeight
        )

        if (!hasAlpha || !alphaContext || !alphaFrame) {
          drawToViewport(rgbBuffer)
        } else {
          const activeAlphaBuffer = alphaBuffer
          if (!activeAlphaBuffer) {
            drawToViewport(rgbBuffer)
            return
          }

          alphaContext.clearRect(0, 0, activeAlphaBuffer.width, activeAlphaBuffer.height)
          alphaContext.drawImage(
            video,
            alphaFrame[0],
            alphaFrame[1],
            alphaFrame[2],
            alphaFrame[3],
            0,
            0,
            compositeWidth,
            compositeHeight
          )

          const rgbData = rgbContext.getImageData(0, 0, compositeWidth, compositeHeight)
          const alphaData = alphaContext.getImageData(0, 0, compositeWidth, compositeHeight)
          if (!mergedData) {
            mergedData = rgbContext.createImageData(compositeWidth, compositeHeight)
          }

          const pixelCount = compositeWidth * compositeHeight
          for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
            const offset = pixelIndex * 4
            const alpha = alphaData.data[offset]

            if (alpha <= 2) {
              mergedData.data[offset] = 0
              mergedData.data[offset + 1] = 0
              mergedData.data[offset + 2] = 0
              mergedData.data[offset + 3] = 0
              continue
            }

            mergedData.data[offset] = rgbData.data[offset]
            mergedData.data[offset + 1] = rgbData.data[offset + 1]
            mergedData.data[offset + 2] = rgbData.data[offset + 2]
            mergedData.data[offset + 3] = alpha
          }

          rgbContext.putImageData(mergedData, 0, 0)
          drawToViewport(rgbBuffer)
        }
      }

      if (!video.ended) {
        rafRef.current = window.requestAnimationFrame(renderFrame)
      }
    }

    video.currentTime = 0
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = effect.assetUrl
    video.onended = finishPlayback
    video.onerror = finishPlayback
    video.onpause = tryResumePlayback
    video.onloadeddata = () => {
      if (currentPlaybackIdRef.current !== activePlaybackId) {
        return
      }

      tryResumePlayback()
      rafRef.current = window.requestAnimationFrame(renderFrame)
    }

    timeoutRef.current = window.setTimeout(() => {
      finishPlayback()
    }, Math.max(1000, effect.durationMs + 500))

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      video.onended = null
      video.onerror = null
      video.onpause = null
      video.onloadeddata = null
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [effect])

  if (!effect) {
    return null
  }

  return (
    <div className="gui-shell__effect-layer">
      <video ref={videoRef} className="gui-shell__effect-video" muted playsInline />
      <canvas ref={canvasRef} className="gui-shell__gift-animation" />
    </div>
  )
}
