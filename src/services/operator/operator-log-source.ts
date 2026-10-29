import type { LogLevel } from '../../core/logger/types';
import { randomUUID } from 'node:crypto';

type JsonLogValue = null | boolean | number | string | JsonLogValue[] | { [key: string]: JsonLogValue };

type OperatorLogInput = {
    timestamp: string;
    level: LogLevel;
    message: string;
    source: string;
    data: JsonLogValue;
};

type OperatorLogEntry = OperatorLogInput & {
    id: number;
};

type OperatorLogHistory = {
    sessionId: string;
    entries: readonly OperatorLogEntry[];
    oldestId: number | null;
    newestId: number | null;
    truncated: boolean;
};

type OperatorLogSubscriber = (entry: OperatorLogEntry) => boolean | void;

type OperatorLogConnection = {
    history: OperatorLogHistory;
    activate: () => void;
    unsubscribe: () => void;
};

type OperatorLogSource = {
    append: (input: OperatorLogInput) => OperatorLogEntry;
    connect: (afterCursor: string | undefined, subscriber: OperatorLogSubscriber) => OperatorLogConnection;
    history: () => OperatorLogHistory;
};

type OperatorLogSourceOptions = {
    maxEntries?: number;
    maxBytes?: number;
    maxEntryBytes?: number;
};

type StoredEntry = {
    entry: OperatorLogEntry;
    bytes: number;
};

type SubscriberState = {
    subscriber: OperatorLogSubscriber;
    active: boolean;
    removed: boolean;
    buffered: OperatorLogEntry[];
};

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 60 * 1024;
const MIN_ENTRY_BYTES = 256;

function encodedBytes(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

class BoundedOperatorLogSource implements OperatorLogSource {
    private readonly sessionId = randomUUID();
    private readonly maxEntries: number;
    private readonly maxBytes: number;
    private readonly maxEntryBytes: number;
    private nextId = 1;
    private retainedBytes = 0;
    private entries: StoredEntry[] = [];
    private subscribers = new Set<SubscriberState>();

    constructor(options: OperatorLogSourceOptions = {}) {
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
        if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
            throw new RangeError('maxEntries must be a positive safe integer');
        }
        if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) {
            throw new RangeError('maxBytes must be a positive safe integer');
        }
        if (!Number.isSafeInteger(this.maxEntryBytes) || this.maxEntryBytes < MIN_ENTRY_BYTES) {
            throw new RangeError(`maxEntryBytes must be a safe integer of at least ${MIN_ENTRY_BYTES}`);
        }
    }

    append(input: OperatorLogInput): OperatorLogEntry {
        if (!Number.isSafeInteger(this.nextId)) {
            throw new RangeError('Operator log ID space exhausted');
        }

        const id = this.nextId;
        let entry: OperatorLogEntry = { id, ...input };
        let bytes = encodedBytes(entry);
        if (bytes > this.maxEntryBytes) {
            entry = {
                id,
                timestamp: input.timestamp,
                level: input.level,
                message: input.message.slice(0, 4096),
                source: input.source.slice(0, 512),
                data: '[TRUNCATED]'
            };
            bytes = encodedBytes(entry);
        }
        if (bytes > this.maxEntryBytes) {
            entry = {
                id,
                timestamp: input.timestamp,
                level: input.level,
                message: '[TRUNCATED]',
                source: input.source.slice(0, 64),
                data: null
            };
            bytes = encodedBytes(entry);
        }
        if (bytes > this.maxEntryBytes) {
            throw new RangeError('Operator log entry cannot fit configured byte limit');
        }

        this.nextId += 1;
        this.entries.push({ entry, bytes });
        this.retainedBytes += bytes;
        while (this.entries.length > this.maxEntries || this.retainedBytes > this.maxBytes) {
            const removed = this.entries.shift();
            if (removed) this.retainedBytes -= removed.bytes;
        }

        for (const subscriber of [...this.subscribers]) {
            if (subscriber.active) this.deliver(subscriber, entry);
            else subscriber.buffered.push(entry);
        }
        return entry;
    }

    history(): OperatorLogHistory {
        const entries = this.entries.map(({ entry }) => entry);
        return {
            sessionId: this.sessionId,
            entries,
            oldestId: entries[0]?.id ?? null,
            newestId: entries.at(-1)?.id ?? null,
            truncated: false
        };
    }

    connect(afterCursor: string | undefined, subscriber: OperatorLogSubscriber): OperatorLogConnection {
        const snapshot = this.history();
        const prefix = `${this.sessionId}:`;
        const sequence = afterCursor?.startsWith(prefix) ? afterCursor.slice(prefix.length) : '';
        const parsed = /^(?:0|[1-9]\d*)$/.test(sequence) ? Number(sequence) : NaN;
        const afterId = Number.isSafeInteger(parsed) ? parsed : undefined;
        const reset = afterCursor !== undefined && (afterId === undefined || afterId > (snapshot.newestId ?? 0));
        const evicted = afterId !== undefined && snapshot.oldestId !== null && afterId < snapshot.oldestId - 1;
        const replay = afterId === undefined || reset || evicted
            ? snapshot.entries
            : snapshot.entries.filter((entry) => entry.id > afterId);
        const state: SubscriberState = { subscriber, active: false, removed: false, buffered: [] };
        this.subscribers.add(state);
        let activated = false;
        const unsubscribe = () => {
            if (state.removed) return;
            state.removed = true;
            state.buffered = [];
            this.subscribers.delete(state);
        };
        const activate = () => {
            if (activated || state.removed) return;
            activated = true;
            let deliveredId = reset || evicted ? 0 : (afterId ?? 0);
            for (const entry of replay) {
                if (!this.deliver(state, entry)) return;
                deliveredId = entry.id;
            }
            while (!state.removed && state.buffered.length > 0) {
                const buffered = state.buffered;
                state.buffered = [];
                for (const entry of buffered) {
                    if (entry.id <= deliveredId) continue;
                    if (!this.deliver(state, entry)) return;
                    deliveredId = entry.id;
                }
            }
            state.active = !state.removed;
        };

        return {
            history: {
                sessionId: this.sessionId,
                entries: replay,
                oldestId: snapshot.oldestId,
                newestId: snapshot.newestId,
                truncated: reset || evicted
            },
            activate,
            unsubscribe
        };
    }

    private deliver(state: SubscriberState, entry: OperatorLogEntry): boolean {
        try {
            if (state.subscriber(entry) !== false) return true;
        } catch {
            // Subscriber failures must not affect application logging.
        }
        state.removed = true;
        state.buffered = [];
        this.subscribers.delete(state);
        return false;
    }
}

function createOperatorLogSource(options?: OperatorLogSourceOptions): OperatorLogSource {
    return new BoundedOperatorLogSource(options);
}

export { BoundedOperatorLogSource, createOperatorLogSource, DEFAULT_MAX_ENTRY_BYTES };
export type {
    JsonLogValue,
    OperatorLogConnection,
    OperatorLogEntry,
    OperatorLogHistory,
    OperatorLogInput,
    OperatorLogSource,
    OperatorLogSourceOptions,
    OperatorLogSubscriber
};
