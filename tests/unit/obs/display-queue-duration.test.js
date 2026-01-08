describe('DisplayQueue TTS-driven durations', () => {
    const originalEnv = process.env.NODE_ENV;
    let ttsStages;
    const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        jest.resetModules();
        jest.clearAllMocks();
    });

    function createQueue() {
        process.env.NODE_ENV = 'test';

        jest.doMock('../../../src/utils/message-tts-handler', () => ({
            createTTSStages: jest.fn(() => ttsStages)
        }));

        const { DisplayQueue } = require('../../../src/obs/display-queue');
        const { EventEmitter } = require('events');
        const runtimeConstants = createRuntimeConstantsFixture({
            CHAT_MESSAGE_DURATION: 4500,
            CHAT_TRANSITION_DELAY: 0,
            NOTIFICATION_CLEAR_DELAY: 0
        });

        return new DisplayQueue(
            {}, // obsManager (not used by getDuration)
            { ttsEnabled: true },
            {
                CHAT_MESSAGE_DURATION: 4500,
                CHAT_TRANSITION_DELAY: 0,
                PRIORITY_LEVELS: { CHAT: 1 }
            },
            new EventEmitter(),
            runtimeConstants
        );
    }

    it('returns a minimum window for very short TTS', () => {
        ttsStages = [{ text: 'Hi', delay: 0, type: 'primary' }];
        const queue = createQueue();

        expect(queue.getDuration({ data: {}, type: 'gift' })).toBe(2000);
    });

    it('sizes the window to cover staged delays and speech length', () => {
        ttsStages = [
            { text: 'Thanks for the support', delay: 0, type: 'primary' }, // 4 words
            { text: 'Custom message with five words', delay: 2000, type: 'message' } // 5 words
        ];
        const queue = createQueue();

        // Longest stage: 5 words => 400 + (5 * 170) = 1250; delay 2000 => 3250; + tail 1000 => 4250
        expect(queue.getDuration({ data: {}, type: 'paypiggy' })).toBe(4250);
    });

    it('caps extremely long staged speech at the maximum window', () => {
        const longText = 'This is an intentionally long message with many words to stretch timing well past the cap';
        ttsStages = [{ text: longText, delay: 18000, type: 'message' }];
        const queue = createQueue();

        expect(queue.getDuration({ data: {}, type: 'gift' })).toBe(20000);
    });

    it('clears immediately when no TTS stages exist', () => {
        ttsStages = [];
        const queue = createQueue();

        expect(queue.getDuration({ data: {}, type: 'follow' })).toBe(0);
    });
});
