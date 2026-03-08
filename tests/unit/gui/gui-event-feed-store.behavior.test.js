const { describe, it, expect } = require('bun:test');

const { createGuiFeedStore } = require('../../../gui/src/shared/feed-store');

function createRow(index) {
    return {
        type: 'chat',
        kind: 'chat',
        platform: 'twitch',
        username: `test-user-${index}`,
        text: `message-${index}`,
        avatarUrl: `https://example.invalid/avatar-${index}.png`,
        timestamp: `2024-01-01T00:00:0${index}.000Z`
    };
}

describe('GUI feed store behavior', () => {
    it('consumes mapper DTO fields and appends display rows', () => {
        const store = createGuiFeedStore();

        store.pushEvent({
            type: 'chat',
            kind: 'chat',
            platform: 'twitch',
            username: 'test-user',
            text: 'hello world',
            avatarUrl: 'https://example.invalid/test-avatar.png',
            timestamp: '2024-01-01T00:00:00.000Z',
            ignoredField: 'ignore-me'
        });

        const rows = store.getRows();
        expect(rows.length).toBe(1);
        expect(rows[0].type).toBe('chat');
        expect(rows[0].kind).toBe('chat');
        expect(rows[0].platform).toBe('twitch');
        expect(rows[0].username).toBe('test-user');
        expect(rows[0].text).toBe('hello world');
        expect(rows[0].avatarUrl).toBe('https://example.invalid/test-avatar.png');
        expect(rows[0].timestamp).toBe('2024-01-01T00:00:00.000Z');
        expect(Object.prototype.hasOwnProperty.call(rows[0], 'ignoredField')).toBe(false);
    });

    it('appends multiple rows in arrival order', () => {
        const store = createGuiFeedStore();

        store.pushEvent({
            type: 'chat',
            kind: 'chat',
            platform: 'twitch',
            username: 'test-user-1',
            text: 'one',
            avatarUrl: 'https://example.invalid/avatar-1.png',
            timestamp: '2024-01-01T00:00:00.000Z'
        });
        store.pushEvent({
            type: 'chat',
            kind: 'chat',
            platform: 'twitch',
            username: 'test-user-2',
            text: 'two',
            avatarUrl: 'https://example.invalid/avatar-2.png',
            timestamp: '2024-01-01T00:00:01.000Z'
        });
        store.pushEvent({
            type: 'chat',
            kind: 'chat',
            platform: 'twitch',
            username: 'test-user-3',
            text: 'three',
            avatarUrl: 'https://example.invalid/avatar-3.png',
            timestamp: '2024-01-01T00:00:02.000Z'
        });

        const rows = store.getRows();
        expect(rows.length).toBe(3);
        expect(rows[0].username).toBe('test-user-1');
        expect(rows[1].username).toBe('test-user-2');
        expect(rows[2].username).toBe('test-user-3');
    });

    it('enforces overlay queue max rows by keeping latest rows', () => {
        const store = createGuiFeedStore({ maxRows: 3 });

        store.pushEvent(createRow(1));
        store.pushEvent(createRow(2));
        store.pushEvent(createRow(3));
        store.pushEvent(createRow(4));

        const rows = store.getRows();
        expect(rows.length).toBe(3);
        expect(rows.map((row) => row.username)).toEqual([
            'test-user-2',
            'test-user-3',
            'test-user-4'
        ]);
    });

    it('keeps bottom insertion ordering when queue evicts oldest rows', () => {
        const store = createGuiFeedStore({ maxRows: 3 });

        store.pushEvent(createRow(1));
        store.pushEvent(createRow(2));
        store.pushEvent(createRow(3));
        store.pushEvent(createRow(4));
        store.pushEvent(createRow(5));

        const rows = store.getRows();
        expect(rows.map((row) => row.text)).toEqual([
            'message-3',
            'message-4',
            'message-5'
        ]);
    });
});
