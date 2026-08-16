import tiktokIconUrl from '../assets/platform-icons/tiktok-icon.png?inline'
import twitchIconUrl from '../assets/platform-icons/twitch-icon.png?inline'
import youtubeIconUrl from '../assets/platform-icons/youtube-icon.png?inline'

const PLATFORM_ICON_URLS = Object.freeze({
  youtube: youtubeIconUrl,
  twitch: twitchIconUrl,
  tiktok: tiktokIconUrl
})

type PlatformIconId = keyof typeof PLATFORM_ICON_URLS

export function getPlatformIconUrl(platform: unknown): string | null {
  const normalizedPlatform = typeof platform === 'string' ? platform.trim().toLowerCase() : ''
  return Object.hasOwn(PLATFORM_ICON_URLS, normalizedPlatform)
    ? PLATFORM_ICON_URLS[normalizedPlatform as PlatformIconId]
    : null
}
