class DisplayQueueState {
    constructor({ maxQueueSize = null, getPriority } = {}) {
        this.queue = [];
        this.lastChatItem = null;
        this.maxQueueSize = maxQueueSize;
        this.getPriority = typeof getPriority === 'function' ? getPriority : null;
    }

    addItem(item) {
        if (!item || !item.type || !item.data) {
            throw new Error('Invalid display item: missing type or data');
        }
        if (!item.platform) {
            throw new Error('Invalid display item: missing platform');
        }

        if (this.maxQueueSize && this.queue.length >= this.maxQueueSize) {
            throw new Error(`Queue at capacity (${this.maxQueueSize})`);
        }

        if (item.priority === undefined && this.getPriority) {
            item.priority = this.getPriority(item.type);
        }

        let removedChatCount = 0;
        if (item.type === 'chat') {
            this.lastChatItem = { ...item };
            removedChatCount = this._removeQueuedChatItems();
        }

        const insertIndex = this._findInsertIndex(item.priority);
        this.queue.splice(insertIndex, 0, item);
        return { insertIndex, removedChatCount };
    }

    shift() {
        return this.queue.shift();
    }

    clear() {
        this.queue.length = 0;
        this.lastChatItem = null;
    }

    _findInsertIndex(priority) {
        let insertIndex = this.queue.length;
        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].priority < priority) {
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

module.exports = {
    DisplayQueueState
};
