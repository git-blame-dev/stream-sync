const { describe, it, expect } = require('bun:test');

const { createEventFeed } = require('../../../gui/src/shared/create-event-feed');

describe('GUI event feed connector behavior', () => {
    it('parses JSON events and ignores malformed payloads', () => {
        const received = [];
        const source = {
            onmessage: null,
            closeCalled: 0,
            close() {
                this.closeCalled += 1;
            }
        };

        const dispose = createEventFeed({
            url: '/gui/events',
            onEvent: (payload) => {
                received.push(payload);
            },
            eventSourceFactory: () => source
        });

        source.onmessage({ data: '{"type":"chat","kind":"chat"}' });
        source.onmessage({ data: '{bad-json' });

        expect(received.length).toBe(1);
        expect(received[0].type).toBe('chat');

        dispose();
        expect(source.closeCalled).toBe(1);
    });
});
