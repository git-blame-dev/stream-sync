import type { DisplayQueueItem } from '../interfaces/DisplayQueue';

type DisplayItem = DisplayQueueItem;

class DisplayQueueState {
    queue: DisplayItem[];
    lastChatItem: DisplayItem | null;
    maxQueueSize: number | null;
    getPriority: ((itemType: string) => number) | null;

    constructor({ maxQueueSize = null, getPriority }: { maxQueueSize?: number | null; getPriority?: ((itemType: string) => number) | null } = {}) {
        this.queue = [];
        this.lastChatItem = null;
        this.maxQueueSize = maxQueueSize;
        this.getPriority = typeof getPriority === 'function' ? getPriority : null;
    }

    addItem(item: DisplayItem) {
        if (!item || !item.type || !item.data) {
            throw new Error('Invalid display item: missing type or data');
        }
        if (!item.platform) {
            throw new Error('Invalid display item: missing platform');
        }

        if (item.priority === undefined && this.getPriority) {
            item.priority = this.getPriority(item.type);
        }

        if (this.maxQueueSize && this.queue.length >= this.maxQueueSize) {
            throw new Error(`Queue at capacity (${this.maxQueueSize})`);
        }

        if (item.type === 'chat') {
            this.lastChatItem = { ...item };
        }

        const insertIndex = this._findInsertIndex(item.priority);
        this.queue.splice(insertIndex, 0, item);
        return { insertIndex };
    }

    shift(): DisplayItem | undefined {
        return this.queue.shift();
    }

    clear() {
        this.queue.length = 0;
        this.lastChatItem = null;
    }

    _findInsertIndex(priority: number | undefined) {
        let insertIndex = this.queue.length;
        for (let i = 0; i < this.queue.length; i++) {
            const queuedItem = this.queue[i];
            if (!queuedItem) {
                continue;
            }

            const queuedPriority = queuedItem.priority;
            if (typeof queuedPriority === 'number' && typeof priority === 'number' && queuedPriority < priority) {
                insertIndex = i;
                break;
            }
        }
        return insertIndex;
    }

}

export {
    DisplayQueueState
};
