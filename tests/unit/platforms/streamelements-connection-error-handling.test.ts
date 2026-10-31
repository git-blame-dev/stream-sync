import { describe, it, expect, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { noOpLogger } from '../../helpers/mock-factories';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../../helpers/bun-timers';
import { StreamElementsPlatform } from '../../../src/platforms/streamelements';

class RecoverySocket extends EventEmitter {
    static OPEN = 1;
    static instances: RecoverySocket[] = [];
    readyState = 0;
    constructor(_url: string) { super(); RecoverySocket.instances.push(this); }
    send(_data: string) {}
    close() { this.readyState = 3; this.emit('close', 1000); }
}
const platforms: StreamElementsPlatform[] = [];
const createPlatform = () => {
    useFakeTimers();
    RecoverySocket.instances = [];
    const platform = new StreamElementsPlatform({ enabled: true, jwtToken: 'test-only-token' }, {
        logger: noOpLogger, WebSocketCtor: RecoverySocket,
        retrySystem: { incrementRetryCount: () => 10, resetRetryCount: () => undefined }
    });
    platforms.push(platform);
    return platform;
};
afterEach(async () => {
    for (const platform of platforms.splice(0)) await platform.disconnect();
    useRealTimers();
});

describe('StreamElementsPlatform connection recovery', () => {
    it('creates one replacement after transport error followed by close', async () => {
        const platform = createPlatform();
        const pending = platform.initialize();
        const expired = RecoverySocket.instances[0]!;
        expired.emit('error', Object.assign(new Error('test-only-reset'), { code: 'ECONNRESET' }));
        expired.emit('close', 1006, 'test-only-close');
        expect(await pending).toMatchObject({ state: 'recovering' });
        advanceTimersByTime(10);
        expect(RecoverySocket.instances).toHaveLength(2);
        expect(expired.readyState).toBe(3);
        expect(expired.eventNames()).toHaveLength(0);
    });

    it('cancels scheduled recovery on disconnect', async () => {
        const platform = createPlatform();
        const pending = platform.initialize();
        RecoverySocket.instances[0]!.emit('error', new Error('connection failed'));
        await pending;
        await platform.disconnect();
        advanceTimersByTime(10000);
        expect(RecoverySocket.instances).toHaveLength(1);
    });

    it('ignores transport failure already in flight when disconnected', async () => {
        const platform = createPlatform();
        const pending = platform.initialize().catch((error: unknown) => error);
        RecoverySocket.instances[0]!.emit('error', new Error('connection failed'));
        await platform.disconnect();
        await pending;
        advanceTimersByTime(10000);
        expect(RecoverySocket.instances).toHaveLength(1);
        expect(platform.getStatus()).toMatchObject({ isReady: false, hasConnection: false });
    });
});
