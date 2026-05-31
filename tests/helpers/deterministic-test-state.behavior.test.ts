import { beforeEach, describe, expect, test } from 'bun:test';

import { createMockNotificationBuilder, resetMockFactorySequence } from './mock-factories';
import { createGiftSpamScenario, resetPlatformTestDataSequence } from './platform-test-data';
import { nextTestId, resetTestIds } from './test-id';
import { createTestNotification, resetTestSetupSequence } from './test-setup';
import { resetDeterministicTestState } from './deterministic-test-state';
import { createTikTokChatEvent, resetTikTokTestDataSequence } from './tiktok-test-data';
import { createTwitchChatEvent, resetTwitchTestDataSequence } from './twitch-test-data';
import { createYouTubeChatEvent, resetYouTubeTestDataSequence } from './youtube-test-data';

type TestRecord = Record<string, unknown>;

const buildNotification = () => {
    const builder = createMockNotificationBuilder();
    return builder.build({
        type: 'platform:chat',
        platform: 'twitch',
        username: 'TestUser'
    }) as TestRecord;
};

const deterministicStateSignature = () => {
    const youtube = createYouTubeChatEvent();
    const twitch = createTwitchChatEvent();
    const tiktok = createTikTokChatEvent();
    const platformScenario = createGiftSpamScenario(1);
    const testNotification = createTestNotification('platform:chat');
    const mockNotification = buildNotification();

    return {
        testId: nextTestId('state'),
        youtubeId: youtube.item.id,
        youtubeTimestamp: youtube.timestamp,
        twitchId: twitch.id,
        twitchTimestamp: twitch.timestamp,
        tiktokMsgId: tiktok.msgId,
        tiktokUser: tiktok.user.uniqueId,
        platformStartTime: platformScenario.metadata.startTime,
        platformUsername: platformScenario.metadata.username,
        testNotificationId: testNotification.id,
        testNotificationProcessedAt: testNotification.processedAt,
        mockNotificationId: mockNotification.id,
        mockNotificationTimestamp: mockNotification.timestamp
    };
};

describe('deterministic test helper state', () => {
    beforeEach(() => {
        resetDeterministicTestState();
    });

    test('resets standalone test ids', () => {
        const first = nextTestId('id');
        const second = nextTestId('id');

        resetTestIds();

        expect(second).not.toBe(first);
        expect(nextTestId('id')).toBe(first);
    });

    test('resets YouTube fixture sequence', () => {
        const first = createYouTubeChatEvent();
        const second = createYouTubeChatEvent();

        resetYouTubeTestDataSequence();

        expect(second.item.id).not.toBe(first.item.id);
        expect(createYouTubeChatEvent().item.id).toBe(first.item.id);
    });

    test('resets Twitch fixture sequence', () => {
        const first = createTwitchChatEvent();
        const second = createTwitchChatEvent();

        resetTwitchTestDataSequence();

        expect(second.id).not.toBe(first.id);
        expect(createTwitchChatEvent().id).toBe(first.id);
    });

    test('resets TikTok fixture sequence', () => {
        const first = createTikTokChatEvent();
        const second = createTikTokChatEvent();

        resetTikTokTestDataSequence();

        expect(second.msgId).not.toBe(first.msgId);
        expect(createTikTokChatEvent().msgId).toBe(first.msgId);
    });

    test('resets aggregate platform fixture sequence', () => {
        const first = createGiftSpamScenario(1);
        const second = createGiftSpamScenario(1);

        resetPlatformTestDataSequence();

        expect(second.metadata.startTime).not.toBe(first.metadata.startTime);
        expect(createGiftSpamScenario(1).metadata.startTime).toBe(first.metadata.startTime);
    });

    test('resets test setup helper sequence', () => {
        const first = createTestNotification('platform:chat');
        const second = createTestNotification('platform:chat');

        resetTestSetupSequence();

        expect(second.id).not.toBe(first.id);
        expect(createTestNotification('platform:chat').id).toBe(first.id);
    });

    test('resets mock factory sequence', () => {
        const first = buildNotification();
        const second = buildNotification();

        resetMockFactorySequence();

        expect(second.id).not.toBe(first.id);
        expect(buildNotification().id).toBe(first.id);
    });

    test('resets all deterministic helper state through one coordinator', () => {
        const first = deterministicStateSignature();
        const second = deterministicStateSignature();

        resetDeterministicTestState();

        expect(second).not.toEqual(first);
        expect(deterministicStateSignature()).toEqual(first);
    });
});
