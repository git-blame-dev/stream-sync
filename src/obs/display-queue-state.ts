import type {
    DisplayQueueItem,
    DisplayQueueSequence
} from '../interfaces/DisplayQueue';

type DisplayItem = DisplayQueueItem | DisplayQueueSequence;
type AddSequenceOptions = {
    reservedRows?: number;
};

class DisplayQueueState {
    queue: DisplayItem[] = [];
    maxQueueSize: number | null;
    getPriority: ((itemType: string) => number) | null;

    constructor({ maxQueueSize = null, getPriority }: { maxQueueSize?: number | null; getPriority?: ((itemType: string) => number) | null } = {}) {
        this.maxQueueSize = maxQueueSize;
        this.getPriority = typeof getPriority === 'function' ? getPriority : null;
    }

    isSequence(item: DisplayItem): item is DisplayQueueSequence {
        return item.type === '__display_queue_sequence__' &&
            'children' in item &&
            Array.isArray(item.children);
    }

    getQueueLength() {
        return this.queue.reduce(
            (length, item) => length + (this.isSequence(item) ? item.children.length : 1),
            0
        );
    }

    validate(item: DisplayQueueItem) {
        if (!item || !item.type || !item.data) {
            throw new Error('Invalid display item: missing type or data');
        }
        if (!item.platform) {
            throw new Error('Invalid display item: missing platform');
        }
        return item;
    }

    addItem(item: DisplayQueueItem, reservedRows = 0) {
        this.validate(item);
        this.assertCapacity(reservedRows + 1);
        if (item.priority === undefined && this.getPriority) {
            item.priority = this.getPriority(item.type);
        }
        const insertIndex = this._findInsertIndex(item.priority);
        this.queue.splice(insertIndex, 0, item);
        return { insertIndex };
    }

    addSequence(children: DisplayQueueItem[], options: AddSequenceOptions = {}) {
        const safeOptions = options && typeof options === 'object' ? options : {};
        const requestedReservedRows = safeOptions.reservedRows;
        const reservedRows = typeof requestedReservedRows === 'number' &&
            Number.isInteger(requestedReservedRows) && requestedReservedRows >= 0
            ? requestedReservedRows
            : 0;
        if (!Array.isArray(children) || children.length === 0) {
            throw new Error('Invalid display sequence: expected non-empty children');
        }

        children.forEach((item) => this.validate(item));
        this.assertCapacity(reservedRows + children.length);
        const normalized = children.map((item) => ({
            ...item,
            priority: item.priority ?? this.getPriority?.(item.type) ?? 0
        }));

        const sequence: DisplayQueueSequence = {
            type: '__display_queue_sequence__',
            priority: Math.max(...normalized.map((item) => item.priority ?? 0)),
            children: normalized
        };
        const insertIndex = this._findInsertIndex(sequence.priority);
        this.queue.splice(insertIndex, 0, sequence);

        return { insertIndex };
    }

    shift() {
        return this.queue.shift();
    }

    clear() {
        this.queue.length = 0;
    }

    removeMatching(predicate: (item: DisplayQueueItem) => boolean) {
        const removed: DisplayQueueItem[] = [];
        const retained: DisplayItem[] = this.queue.flatMap((entry): DisplayItem[] => {
            if (!this.isSequence(entry)) {
                const matches = predicate(entry);
                if (matches) removed.push(entry);
                return matches ? [] : [entry];
            }
            const children = entry.children.filter((child) => {
                const matches = predicate(child);
                if (matches) removed.push(child);
                return !matches;
            });
            return children.length === 0 ? [] : [{ ...entry, children }];
        });
        this.queue.splice(0, this.queue.length, ...retained);
        return removed;
    }

    assertCapacity(additionalRows: number) {
        if (this.maxQueueSize && this.getQueueLength() + additionalRows > this.maxQueueSize) {
            throw new Error(`Queue at capacity (${this.maxQueueSize})`);
        }
    }

    _findInsertIndex(priority: number | undefined) {
        for (let i = 0; i < this.queue.length; i++) {
            const queuedPriority = this.queue[i]?.priority;
            if (typeof queuedPriority === 'number' && typeof priority === 'number' && queuedPriority < priority) {
                return i;
            }
        }
        return this.queue.length;
    }
}

export { DisplayQueueState };
