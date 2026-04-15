import EventEmitter from 'node:events';

class TestEventBus extends EventEmitter {
    subscribe(eventName: string, handler: (...args: unknown[]) => void) {
        this.on(eventName, handler);
        return () => this.off(eventName, handler);
    }
}

export { TestEventBus };
