type DisplayItem = {
    type: string;
    platform: string;
    data: unknown;
    priority?: number;
    [key: string]: unknown;
};

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

        let removedChatCount = 0;
        if (item.type === 'chat') {
            this.lastChatItem = { ...item };
            removedChatCount = this._removeQueuedChatItems();
        }

        if (this.maxQueueSize && this.queue.length >= this.maxQueueSize) {
            throw new Error(`Queue at capacity (${this.maxQueueSize})`);
        }

        const insertIndex = this._findInsertIndex(item.priority);
        this.queue.splice(insertIndex, 0, item);
        return { insertIndex, removedChatCount };
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

    _removeQueuedChatItems() {
        let removed = 0;
        for (let i = this.queue.length - 1; i >= 0; i--) {
            if (this.queue[i].type === 'chat') {
                this.queue.splice(i, 1);
                removed += 1;
            }
        }
        return removed;
    }
}

export {
    DisplayQueueState
};
