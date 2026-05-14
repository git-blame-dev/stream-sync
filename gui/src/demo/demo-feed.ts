import type { GuiRowDto } from '../shared/types'

export interface DemoFeedState {
  rows: GuiRowDto[]
  nextRowIndex: number
}

const SELECTED_DEMO_ROWS: readonly GuiRowDto[] = [
  {
    type: 'chat',
    kind: 'chat',
    platform: 'tiktok',
    username: 'Goku',
    text: 'Naruto, I heard your wallet has a power level over 9000.',
    avatarUrl: 'https://myanimelist.net/images/characters/2/344142.jpg',
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'youtube',
    username: 'Ichigo',
    text: 'Before Naruto answers, remember: substitute soul reaper energy is not tax deductible.',
    avatarUrl: 'https://myanimelist.net/images/characters/13/473588.jpg',
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'twitch',
    username: 'Naruto',
    text: 'Believe it! I’m the Hokage of paypiggies today!',
    isPaypiggy: true,
    avatarUrl: 'https://myanimelist.net/images/characters/15/570333.jpg',
    timestamp: null
  },
  {
    type: 'platform:gift',
    kind: 'notification',
    platform: 'youtube',
    username: 'Ichigo',
    text: 'Ichigo sent a $10 Super Chat: Save some spiritual pressure for the rest of us.',
    avatarUrl: 'https://myanimelist.net/images/characters/13/473588.jpg',
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'tiktok',
    username: 'Goku',
    text: 'That donation hit harder than a Kamehameha!',
    avatarUrl: 'https://myanimelist.net/images/characters/2/344142.jpg',
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'twitch',
    username: 'Naruto',
    text: 'My ninja way is supporting the stream!',
    isPaypiggy: true,
    avatarUrl: 'https://myanimelist.net/images/characters/15/570333.jpg',
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'tiktok',
    username: 'Goku',
    text: 'One more warm-up before Ichigo closes the loop.',
    avatarUrl: 'https://myanimelist.net/images/characters/2/344142.jpg',
    timestamp: null
  },
  {
    type: 'chat',
    kind: 'chat',
    platform: 'youtube',
    username: 'Ichigo',
    text: 'Demo complete. Bankai: clean replay.',
    avatarUrl: 'https://myanimelist.net/images/characters/13/473588.jpg',
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
