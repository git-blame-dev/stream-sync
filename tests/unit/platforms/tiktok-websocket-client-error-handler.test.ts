import { expect, test } from 'bun:test';
import { TikTokWebSocketClient } from '../../../src/platforms/tiktok-websocket-client';
import { SyntheticTikTokConnector, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';
test.each([401,403,429])('preserves terminal signing HTTP status %i without exposing raw errors',async status=>{
    const sdk=new SyntheticTikTokConnector();const client=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:async()=>sdk});
    const pending=client.connect();await flushConnectorSetup();sdk.emit('error',{exception:Object.assign(new Error('synthetic-secret-url'),{response:{status}})});
    await expect(pending).rejects.toMatchObject({code:status===401?4401:status===403?4403:4429});
    expect(client.lastConnectionError?.message).not.toContain('synthetic-secret');client.disconnect();
});
test('recognizes offline SDK errors and does not report readiness',async()=>{class UserOfflineError extends Error{}const sdk=new SyntheticTikTokConnector();const client=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:async()=>sdk});const pending=client.connect();await flushConnectorSetup();sdk.fail(new UserOfflineError('synthetic private detail'));await expect(pending).rejects.toMatchObject({code:4404});client.disconnect();});
