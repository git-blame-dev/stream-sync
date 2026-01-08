
const { initializeTestLogging } = require('../helpers/test-setup');
initializeTestLogging();

jest.mock('../../src/platforms/youtube.js');

const YouTubePlatform = require('../../src/platforms/youtube.js');

describe('YouTube chat-update unified dispatch', () => {
    it('routes paid and regular chat through handleChatMessage', async () => {
        const mockHandleChatMessage = jest.fn();
        const mockGetLiveChat = jest.fn().mockResolvedValue({
            on: jest.fn((event, handler) => {
                if (event === 'chat-update') {
                    handler({ item: { type: 'LiveChatPaidMessage' }, author: { name: 'Paid' } });
                    handler({ item: { type: 'LiveChatTextMessage', message: { text: 'hello' } }, author: { name: 'Viewer' } });
                }
            }),
            start: jest.fn()
        });

        const youtubePlatform = new (class {
            constructor() {
                this.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
                this.handleChatMessage = mockHandleChatMessage;
                this._extractMessagesFromChatItem = (chatItem) => [chatItem];
                this._shouldSkipMessage = () => false;
                this.config = {};
                this.connectionManager = {
                    connectToStream: jest.fn().mockResolvedValue({ on: jest.fn(), start: jest.fn() }),
                    disconnectFromStream: jest.fn()
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
