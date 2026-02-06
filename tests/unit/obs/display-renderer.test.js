const { describe, expect, it } = require('bun:test');

const { DisplayRenderer } = require('../../../src/obs/display-renderer');

describe('DisplayRenderer', () => {
    const createRenderer = (platformConfig = {}, overrides = {}) => {
        const actions = [];
        const sourcesManager = {
            updateChatMsgText: async (source, username, message) => {
                actions.push({ type: 'chatText', source, username, message });
            },
            setGroupSourceVisibility: async (source, group, visible) => {
                actions.push({ type: 'groupVisibility', source, group, visible });
            },
            setChatDisplayVisibility: async (visible, scene) => {
                actions.push({ type: 'chatDisplay', visible, scene });
            },
            setNotificationDisplayVisibility: async (visible, scene) => {
                actions.push({ type: 'notificationDisplay', visible, scene });
            },
            updateTextSource: async (source, text) => {
                actions.push({ type: 'notificationText', source, text });
            },
            setPlatformLogoVisibility: async (platform) => {
                actions.push({ type: 'platformLogo', platform });
            },
            setNotificationPlatformLogoVisibility: async (platform) => {
                actions.push({ type: 'notificationLogo', platform });
            },
            ...(overrides.sourcesManager || {})
        };

        const handleDisplayQueueError = overrides.handleDisplayQueueError || ((message, error, payload) => {
            actions.push({ type: 'error', message, error, payload });
        });

        const renderer = new DisplayRenderer({
            obsManager: { isReady: async () => (overrides.obsReady ?? true) },
            sourcesManager,
            config: {
                chat: { sourceName: 'chat', sceneName: 'scene', groupName: 'group', platformLogos: {} },
                notification: { sourceName: 'notification', sceneName: 'scene', groupName: 'group', platformLogos: {} },
                timing: { transitionDelay: 0, notificationClearDelay: 0 },
                tiktok: { messagesEnabled: true, notificationsEnabled: true, ...platformConfig },
                ...(overrides.config || {})
            },
            delay: overrides.delay || (async () => {}),
            handleDisplayQueueError,
            extractUsername: overrides.extractUsername || ((data) => data?.username ?? null),
            validateDisplayConfig: overrides.validateDisplayConfig || (() => true),
            isNotificationType: overrides.isNotificationType || ((type) => typeof type === 'string' && type.startsWith('platform:')),
            isChatType: overrides.isChatType || ((type) => type === 'chat')
        });

        return { renderer, actions };
    };

    it('renders chat items when enabled', async () => {
        const { renderer, actions } = createRenderer();

        await renderer.displayChatItem({
            type: 'chat',
            platform: 'tiktok',
            data: { username: 'test-user', message: 'hello' }
        });

        expect(actions.some(action => action.type === 'chatText')).toBe(true);
        expect(actions.some(action => action.type === 'chatDisplay' && action.visible === true)).toBe(true);
    });

    it('skips chat rendering when messages are disabled', async () => {
        const { renderer, actions } = createRenderer({ messagesEnabled: false });

        await renderer.displayChatItem({
            type: 'chat',
            platform: 'tiktok',
            data: { username: 'test-user', message: 'hello' }
        });

        expect(actions.length).toBe(0);
    });

    it('skips notification rendering when notifications are disabled', async () => {
        const { renderer, actions } = createRenderer({ notificationsEnabled: false });

        await renderer.displayNotificationItem({
            type: 'platform:follow',
            platform: 'tiktok',
            data: { username: 'test-user', displayMessage: 'hello' }
        });

        expect(actions.length).toBe(0);
    });

    it('returns false when OBS is not ready for chat', async () => {
        const { renderer, actions } = createRenderer({}, { obsReady: false });

        const result = await renderer.displayChatItem({
            type: 'chat',
            platform: 'tiktok',
            data: { username: 'test-user', message: 'hello' }
        });

        expect(result).toBe(false);
        expect(actions.length).toBe(0);
    });

    it('returns false when chat config validation fails', async () => {
        const { renderer, actions } = createRenderer({}, { validateDisplayConfig: () => false });

        const result = await renderer.displayChatItem({
            type: 'chat',
            platform: 'tiktok',
            data: { username: 'test-user', message: 'hello' }
        });

        expect(result).toBe(false);
        expect(actions.length).toBe(0);
    });

    it('reports notification errors when displayMessage is missing', async () => {
        const { renderer, actions } = createRenderer();

        const result = await renderer.displayNotificationItem({
            type: 'platform:follow',
            platform: 'tiktok',
            data: { username: 'test-user' }
        });

        expect(result).toBe(false);
        expect(actions.some(action => action.type === 'error')).toBe(true);
    });

    it('reports chat update errors and returns false', async () => {
        const { renderer, actions } = createRenderer({}, {
            sourcesManager: {
                updateChatMsgText: async () => {
                    throw new Error('chat update failed');
                }
            }
        });

        const result = await renderer.displayChatItem({
            type: 'chat',
            platform: 'tiktok',
            data: { username: 'test-user', message: 'hello' }
        });

        expect(result).toBe(false);
        expect(actions.some(action => action.type === 'error')).toBe(true);
    });

    it('returns early when no lingering chat is available', async () => {
        const { renderer, actions } = createRenderer();

        await renderer.displayLingeringChat(null);

        expect(actions.length).toBe(0);
    });

    it('hides notification displays for notification types', async () => {
        const { renderer, actions } = createRenderer();

        await renderer.hideCurrentDisplay({ type: 'platform:gift' });

        expect(actions.some(action => action.type === 'notificationDisplay' && action.visible === false)).toBe(true);
    });

    it('hides chat displays for chat types', async () => {
        const { renderer, actions } = createRenderer();

        await renderer.hideCurrentDisplay({ type: 'chat' });

        expect(actions.some(action => action.type === 'chatDisplay' && action.visible === false)).toBe(true);
    });
});
