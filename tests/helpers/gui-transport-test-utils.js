const net = require('net');
const EventEmitter = require('events');

class TestEventBus extends EventEmitter {
    subscribe(eventName, handler) {
        this.on(eventName, handler);
        return () => this.off(eventName, handler);
    }
}

async function getAvailablePort() {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = address && typeof address === 'object' ? address.port : null;
            server.close((closeError) => {
                if (closeError) {
                    reject(closeError);
                    return;
                }
                resolve(port);
            });
        });
    });
}

module.exports = {
    TestEventBus,
    getAvailablePort
};
