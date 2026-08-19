import { describe, expect, it } from 'bun:test';
import { ARCEUS_IMAGE_URL, resolveRowPresentation } from '../../../gui/src/shared/row-presentation';
import type { GuiRowDto } from '../../../gui/src/shared/types';

const row = (overrides: Partial<GuiRowDto> = {}): GuiRowDto => ({
  type: 'chat',
  kind: 'chat',
  platform: 'twitch',
  username: 'test-user',
  text: 'hello',
  avatarUrl: 'https://example.invalid/avatar.png',
  timestamp: null,
  presentationRole: 'ordinary',
  ...overrides,
});

describe('row presentation resolver', () => {
  it('leaves ordinary rows undecorated', () => {
    expect(resolveRowPresentation(row())).toEqual({ role: 'ordinary', effects: [] });
  });

  it('applies global member settings and property-level profile overrides', () => {
    const presentation = resolveRowPresentation(
      row({
        presentationRole: 'member',
        presentationOverride: {
          theme: 'red',
          spriteUrl: 'https://example.invalid/member.gif',
        },
      }),
      { memberRowTheme: 'gold', memberRowEffects: ['particles', 'sheen'] },
    );

    expect(presentation).toEqual({
      role: 'member',
      theme: 'red',
      effects: ['particles', 'sheen'],
      spriteUrl: 'https://example.invalid/member.gif',
    });
  });

  it('preserves explicit empty member effects', () => {
    expect(resolveRowPresentation(
      row({ presentationRole: 'member', presentationOverride: { effects: [] } }),
      { memberRowEffects: ['particles'] },
    )).toEqual({ role: 'member', theme: 'green', effects: [] });
  });

  it('falls back to green for malformed in-memory themes', () => {
    expect(resolveRowPresentation(
      row({ presentationRole: 'member', presentationOverride: { theme: 'violet' as never } }),
      { memberRowTheme: 'invalid' as never },
    )).toMatchObject({ role: 'member', theme: 'green' });
  });

  it('uses code-owned supporter presentation only while enabled', () => {
    expect(resolveRowPresentation(row({ presentationRole: 'supporter' }))).toEqual({
      role: 'supporter',
      theme: 'gold',
      effects: ['sheen', 'particles'],
      spriteUrl: ARCEUS_IMAGE_URL,
    });
    expect(resolveRowPresentation(
      row({ presentationRole: 'supporter' }),
      { streamSupporterChatEffectsEnabled: false },
    )).toEqual({ role: 'supporter', effects: [] });
  });

  it('keeps monetization presentation independent from member settings', () => {
    expect(resolveRowPresentation(
      row({ presentationRole: 'monetization' }),
      { memberRowTheme: 'red', memberRowEffects: [] },
    )).toEqual({
      role: 'monetization',
      theme: 'gold',
      effects: ['sheen'],
      spriteUrl: ARCEUS_IMAGE_URL,
    });
  });
});
