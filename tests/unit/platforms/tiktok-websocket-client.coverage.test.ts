import { afterEach, beforeEach, expect, test } from 'bun:test';
import { TikTokWebSocketClient } from '../../../src/platforms/tiktok-websocket-client';
import { SyntheticTikTokConnector, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../../helpers/bun-timers';
let clients:TikTokWebSocketClient[]=[];
beforeEach(()=>useFakeTimers());
afterEach(()=>{for(const client of clients)client.disconnect();clients=[];useRealTimers();});
function setup(sdk=new SyntheticTikTokConnector()) {const client=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:async()=>sdk,connectTimeoutMs:1000});clients.push(client);return {client,sdk};}
test('room entry timeout aborts and closes the SDK',async()=>{const {client,sdk}=setup();const pending=client.connect();await flushConnectorSetup();sdk.open();advanceTimersByTime(1001);await expect(pending).rejects.toThrow('timed out');expect(sdk.terminated).toBeGreaterThanOrEqual(1);expect(client.isConnecting).toBe(false);});
test('cancellation during SDK creation closes its late result',async()=>{
    const sdk=new SyntheticTikTokConnector();let finish:(value:SyntheticTikTokConnector)=>void=()=>{};
    const client=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:()=>new Promise(resolve=>{finish=resolve;})});clients.push(client);
    const pending=client.connect();client.disconnect();await expect(pending).rejects.toMatchObject({code:1000});finish(sdk);await flushConnectorSetup();expect(sdk.terminated).toBe(1);expect(sdk.disconnects).toBe(1);
});
test('stale failures and readiness cannot affect the next attempt',async()=>{
    const sdk1=new SyntheticTikTokConnector();const sdk2=new SyntheticTikTokConnector();let next=sdk1;
    const client=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:async()=>next});clients.push(client);
    const first=client.connect();await flushConnectorSetup();client.disconnect();await expect(first).rejects.toMatchObject({code:1000});
    next=sdk2;const second=client.connect();await flushConnectorSetup();sdk1.emit('error',new Error('synthetic stale'));sdk1.open();sdk1.enter();sdk2.open();sdk2.enter();await second;advanceTimersByTime(50000);expect(client.isConnected).toBe(true);
});
test('empty room ID cannot become ready',async()=>{const {client,sdk}=setup();sdk.roomId='';const pending=client.connect();await flushConnectorSetup();sdk.open();sdk.enter();advanceTimersByTime(1001);await expect(pending).rejects.toThrow('timed out');});
test('stream end is terminal and reported once',async()=>{const {client,sdk}=setup();const ended:unknown[]=[];client.on('streamEnd',data=>ended.push(data));const pending=client.connect();await flushConnectorSetup();sdk.open();sdk.enter();await pending;sdk.emit('streamEnd');sdk.emit('streamEnd');expect(client.lastConnectionError).toMatchObject({code:4404});expect(ended).toHaveLength(1);});
test('factory rejection is sanitized and clears connecting state',async()=>{const client=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:async()=>{throw new Error('synthetic-secret');}});clients.push(client);await expect(client.connect()).rejects.toThrow('TikTok transport');expect(client.isConnecting).toBe(false);});

test('a late SDK success after cancellation is closed again',async()=>{
 const {client,sdk}=setup();const pending=client.connect();await flushConnectorSetup();client.disconnect();await expect(pending).rejects.toMatchObject({code:1000});sdk.open();sdk.enter();await flushConnectorSetup();expect(client.isConnected).toBe(false);expect(sdk.isConnected).toBe(false);expect(sdk.terminated).toBe(2);
});
