import { normalizeRowEffects, normalizeRowTheme } from '../../../src/core/row-presentation'
import type { GuiAppearanceSettings } from './appearance'
import type { GuiRowDto, RowPresentationOverride, RowTheme, RowVisualEffectId } from './types'

export interface RowPresentation {
  role: 'ordinary' | 'member' | 'supporter' | 'monetization'
  theme?: RowTheme
  effects: readonly RowVisualEffectId[]
  spriteUrl?: string
}

const DEFAULT_EFFECTS: readonly RowVisualEffectId[] = ['sheen']
const SUPPORTER_EFFECTS: readonly RowVisualEffectId[] = ['sheen', 'particles']

export function resolveRowPresentation(
  row: GuiRowDto,
  settings: Partial<Pick<GuiAppearanceSettings, 'streamSupporterChatEffectsEnabled' | 'memberRowTheme' | 'memberRowEffects'>> = {}
): RowPresentation {
  const override: RowPresentationOverride | undefined = row.presentationOverride
  const role = row.presentationRole ?? 'ordinary'
  if (role === 'ordinary') return { role, effects: [] }
  if (role === 'monetization') return { role, theme: 'gold', effects: DEFAULT_EFFECTS, spriteUrl: ARCEUS_IMAGE_URL }
  if (role === 'supporter') {
    return settings.streamSupporterChatEffectsEnabled === false
      ? { role, effects: [] }
      : { role, theme: 'gold', effects: SUPPORTER_EFFECTS, spriteUrl: ARCEUS_IMAGE_URL }
  }
  const effects = normalizeRowEffects(override?.effects)
    ?? normalizeRowEffects(settings.memberRowEffects)
    ?? DEFAULT_EFFECTS
  return {
    role,
    theme: normalizeRowTheme(override?.theme) ?? normalizeRowTheme(settings.memberRowTheme) ?? 'green',
    effects,
    ...(override?.spriteUrl ? { spriteUrl: override.spriteUrl } : {})
  }
}

export const RAYQUAZA_IMAGE_URL = 'https://img.pokemondb.net/sprites/black-white/anim/normal/rayquaza.gif'
export const ARCEUS_IMAGE_URL = 'https://img.pokemondb.net/sprites/black-white/anim/normal/arceus.gif'
