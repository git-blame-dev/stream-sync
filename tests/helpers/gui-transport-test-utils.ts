const EventEmitter = require('events');

class TestEventBus extends EventEmitter {
    subscribe(eventName: string, handler: (...args: any[]) => void) {
        this.on(eventName, handler);
        return () => this.off(eventName, handler);
    }
}

module.exports = {
    TestEventBus
};
