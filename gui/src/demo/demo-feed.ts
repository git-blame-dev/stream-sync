import type { GuiBadgeImage, GuiRowDto } from '../shared/types'
import { DEMO_CHARACTER_CATALOG } from './demo-catalog'

export interface DemoFeedState {
  rows: GuiRowDto[]
  nextRowIndex: number
}

export const RED_MEMBER_DEMO_SPRITE_URL = 'https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/fff66c2b-2718-44ef-8f83-3cd2763d6838/dfnkphg-eef02296-d5ef-4283-88ca-497d781906af.gif?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1cm46YXBwOjdlMGQxODg5ODIyNjQzNzNhNWYwZDQxNWVhMGQyNmUwIiwiaXNzIjoidXJuOmFwcDo3ZTBkMTg4OTgyMjY0MzczYTVmMGQ0MTVlYTBkMjZlMCIsIm9iaiI6W1t7InBhdGgiOiIvZi9mZmY2NmMyYi0yNzE4LTQ0ZWYtOGY4My0zY2QyNzYzZDY4MzgvZGZua3BoZy1lZWYwMjI5Ni1kNWVmLTQyODMtODhjYS00OTdkNzgxOTA2YWYuZ2lmIn1dXSwiYXVkIjpbInVybjpzZXJ2aWNlOmZpbGUuZG93bmxvYWQiXX0.7AkJyzeLDX9pMiyz4BOnJlvKqZQFby9IN8LNkyEwr7I'
export const TWITCH_MEMBER_DEMO_BADGES: readonly GuiBadgeImage[] = [
  {
    imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3',
    source: 'twitch',
    label: 'Moderator'
  },
  {
    imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/511b78a9-ab37-472f-9569-457753bbe7d3/3',
    source: 'twitch',
    label: 'Founder'
  },
  {
    imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/bbbe0db0-a598-423e-86d0-f9fb98ca1933/3',
    source: 'twitch',
    label: 'Prime Gaming'
  }
]

const SELECTED_DEMO_ROWS: readonly GuiRowDto[] = [
  {
    type: 'chat',
    kind: 'chat',
    platform: 'twitch',
    username: 'Goku',
    text: 'Naruto, I heard your wallet has a power level over 9000.',
    avatarUrl: DEMO_CHARACTER_CATALOG.Goku,
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'tiktok',
    username: 'Ichigo',
    text: 'Before Naruto answers, remember: substitute soul reaper energy is not tax deductible.',
    avatarUrl: DEMO_CHARACTER_CATALOG.Ichigo,
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'youtube',
    username: 'Naruto',
    text: 'Believe it! I’m the Hokage of paypiggies today!',
    isPaypiggy: true,
    memberTheme: 'red',
    memberSpriteUrl: RED_MEMBER_DEMO_SPRITE_URL,
    avatarUrl: DEMO_CHARACTER_CATALOG.Naruto,
    timestamp: null
  },
  {
    type: 'platform:gift',
    kind: 'notification',
    platform: 'tiktok',
    username: 'Ichigo',
    text: 'Ichigo sent a $10 Super Chat: Save some spiritual pressure for the rest of us.',
    avatarUrl: DEMO_CHARACTER_CATALOG.Ichigo,
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'twitch',
    username: 'Goku',
    text: 'That donation hit harder than a Kamehameha!',
    avatarUrl: DEMO_CHARACTER_CATALOG.Goku,
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'twitch',
    username: 'Goku',
    text: 'My Saiyan pride is supporting the stream!',
    isPaypiggy: true,
    badgeImages: [...TWITCH_MEMBER_DEMO_BADGES],
    avatarUrl: DEMO_CHARACTER_CATALOG.Goku,
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'twitch',
    username: 'Goku',
    text: 'One more warm-up before Ichigo closes the loop.',
    avatarUrl: DEMO_CHARACTER_CATALOG.Goku,
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'tiktok',
    username: 'Ichigo',
    text: 'Demo complete. Bankai: clean replay.',
    avatarUrl: DEMO_CHARACTER_CATALOG.Ichigo,
    timestamp: null
  }
]

export function createDemoRows(): GuiRowDto[] {
  return SELECTED_DEMO_ROWS.map((row) => ({ ...row }))
}

export function createInitialDemoFeedState(): DemoFeedState {
  return {
    rows: [],
    nextRowIndex: 0
  }
}

export function advanceDemoFeed(state: DemoFeedState): DemoFeedState {
  const selectedRows = createDemoRows()
  const nextRow = selectedRows.at(state.nextRowIndex)
  if (!nextRow) {
    return createInitialDemoFeedState()
  }

  return {
    rows: [...state.rows, nextRow],
    nextRowIndex: state.nextRowIndex + 1
  }
}
