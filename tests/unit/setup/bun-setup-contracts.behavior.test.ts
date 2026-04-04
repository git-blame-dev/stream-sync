const { describe, it, expect } = require('bun:test');

const {
    registerModuleMocks,
    createWebSocketMock,
    createAxiosMock,
    createTikTokConnectorMock,
    createYoutubeiMock,
    toHaveLengthGreaterThan,
    toBeValidNotification,
    toBeValidUser
} = require('../../setup/bun.setup');

describe('bun setup contracts behavior', () => {
    it('allows module mock registration to run repeatedly', () => {
        expect(() => registerModuleMocks()).not.toThrow();
    });

    it('builds websocket mock factory contract', () => {
        const webSocketFactory = createWebSocketMock();
        const socket = webSocketFactory();

        expect(webSocketFactory.CONNECTING).toBe(0);
        expect(webSocketFactory.OPEN).toBe(1);
        expect(socket.readyState).toBe(1);
        expect(typeof socket.on).toBe('function');
    });

    it('builds axios mock factory contract', async () => {
        const axiosMock = createAxiosMock();

        expect((await axiosMock.get()).data.data).toEqual([]);
        expect((await axiosMock.post()).data.data).toEqual([]);
        const axiosInstance = axiosMock.create();
        expect((await axiosInstance.delete()).data.data).toEqual([]);
    });

    it('builds tiktok and youtube mock module contracts', async () => {
        const tiktokMock = createTikTokConnectorMock();
        const youtubeMock = createYoutubeiMock();

        const tiktokClient = new tiktokMock.WebcastPushConnection();
        expect(await tiktokClient.connect()).toBe(true);
        expect(tiktokMock.__esModule).toBe(true);

        const innertube = await youtubeMock.Innertube.create();
        expect(innertube.session.context.client.clientName).toBe('WEB');
        expect((await innertube.getBasicInfo()).basic_info.view_count).toBe(1000);
    });

    it('restores console through global helper', () => {
        const originalConsole = global.originalConsole;
        global.console = {
            log: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {}
        };

        global.restoreConsole();

        expect(global.console).toBe(originalConsole);
    });

    it('supports toHaveLengthGreaterThan matcher behavior', () => {
        expect([1, 2, 3]).toHaveLengthGreaterThan(1);
        expect([1]).not.toHaveLengthGreaterThan(3);

        expect(toHaveLengthGreaterThan([1, 2], 1).pass).toBe(true);
        expect(toHaveLengthGreaterThan([1], 3).pass).toBe(false);
    });

    it('supports toBeValidNotification matcher behavior', () => {
        expect({
            id: 'test-id',
            type: 'message',
            username: 'test-user',
            platform: 'test-platform',
            displayMessage: 'test-display',
            ttsMessage: 'test-tts'
        }).toBeValidNotification();

        expect({}).not.toBeValidNotification();

        expect(toBeValidNotification({
            id: 'test-id',
            type: 'message',
            username: 'test-user',
            platform: 'test-platform',
            displayMessage: 'test-display',
            ttsMessage: 'test-tts'
        }).pass).toBe(true);
        expect(toBeValidNotification({}).pass).toBe(false);
    });

    it('supports toBeValidUser matcher behavior', () => {
        expect({ username: 'test-user' }).toBeValidUser();
        expect({}).not.toBeValidUser();

        expect(toBeValidUser({ username: 'test-user' }).pass).toBe(true);
        expect(toBeValidUser({}).pass).toBe(false);
    });
});
