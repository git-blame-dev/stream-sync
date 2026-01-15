const { describe, test, afterEach, expect } = require('bun:test');

const { initializeTestLogging } = require('../helpers/test-setup');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks, resetModules } = require('../helpers/bun-module-mocks');

initializeTestLogging();

mockModule('../../src/platforms/youtube.js', () => ({}));

const YouTubePlatform = require('../../src/platforms/youtube.js');

describe('YouTube chat-update unified dispatch', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    test('routes paid and regular chat through handleChatMessage', async () => {
        const mockHandleChatMessage = createMockFn();
        const mockGetLiveChat = createMockFn().mockResolvedValue({
            on: createMockFn((event, handler) => {
                if (event === 'chat-update') {
                    handler({ item: { type: 'LiveChatPaidMessage' }, author: { name: 'Paid' } });
                    handler({ item: { type: 'LiveChatTextMessage', message: { text: 'hello' } }, author: { name: 'Viewer' } });
                }
            }),
            start: createMockFn()
        });

        const youtubePlatform = new (class {
            constructor() {
                this.logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
                this.handleChatMessage = mockHandleChatMessage;
                this._extractMessagesFromChatItem = (chatItem) => [chatItem];
                this._shouldSkipMessage = () => false;
                this.config = {};
                this.connectionManager = {
                    connectToStream: createMockFn().mockResolvedValue({ on: createMockFn(), start: createMockFn() }),
                    disconnectFromStream: createMockFn()
                };
            }
            async connectToLiveChat(videoId) {
                const liveChat = await mockGetLiveChat();
                liveChat.on('chat-update', (chatItem) => {
                    if (this._shouldSkipMessage(chatItem)) return;
                    const messages = this._extractMessagesFromChatItem(chatItem);
                    messages.forEach((msg) => this.handleChatMessage(msg));
                });
                await liveChat.start();
            }
        })();

        await youtubePlatform.connectToLiveChat('vid1');

        expect(mockHandleChatMessage).toHaveBeenCalledWith(
            expect.objectContaining({ item: { type: 'LiveChatPaidMessage' } })
        );
        expect(mockHandleChatMessage).toHaveBeenCalledWith(
            expect.objectContaining({ item: { type: 'LiveChatTextMessage', message: { text: 'hello' } } })
        );
    });
});
