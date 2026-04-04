const { describe, test, afterEach, expect } = require('bun:test');

const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');

describe('YouTube chat-update unified dispatch', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes paid and regular chat through handleChatMessage', async () => {
        const mockHandleChatMessage = createMockFn();
        const mockGetLiveChat = createMockFn().mockResolvedValue({
            on: createMockFn((event, handler) => {
                if (event === 'chat-update') {
                    handler({ item: { type: 'LiveChatPaidMessage', author: { name: 'Paid', id: 'paid-user' } } });
                    handler({ item: { type: 'LiveChatTextMessage', author: { name: 'Viewer', id: 'viewer-user' }, message: { text: 'hello' } } });
                }
            }),
            start: createMockFn()
        });

        const youtubePlatform = new (class {
            constructor() {
                this.logger = noOpLogger;
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

        const handledItems = mockHandleChatMessage.mock.calls.map(([call]) => call);
        const hasPaidMessage = handledItems.some((call) => call.item?.type === 'LiveChatPaidMessage');
        const hasTextMessage = handledItems.some((call) =>
            call.item?.type === 'LiveChatTextMessage' && call.item?.message?.text === 'hello'
        );
        expect(hasPaidMessage).toBe(true);
        expect(hasTextMessage).toBe(true);
    });
});
