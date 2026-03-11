const PLATFORM_ICON_BASE_PATH = '/gui/assets/platform-icons'

const PLATFORM_ICON_FILE_NAMES: Record<string, string> = {
  youtube: 'youtube-icon.png',
  twitch: 'twitch-icon.png',
  tiktok: 'tiktok-icon.png'
}

function normalizePlatform(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function getPlatformIconUrl(platform: unknown): string | null {
  const normalizedPlatform = normalizePlatform(platform)
  const fileName = PLATFORM_ICON_FILE_NAMES[normalizedPlatform]
  return fileName ? `${PLATFORM_ICON_BASE_PATH}/${fileName}` : null
}
