import { afterEach, describe, expect, test } from 'bun:test';
import { TikTokWebSocketClient } from '../../../src/platforms/tiktok-websocket-client';
import { SyntheticTikTokConnector, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';

describe('TikTok maintained connector boundary', () => {
    const clients: TikTokWebSocketClient[] = [];
    function setup() {
        const sdk = new SyntheticTikTokConnector();
        const client = new TikTokWebSocketClient('synthetic-streamer', { apiKey:'synthetic-key', connectorFactory:async (_username,_key,signal) => { sdk.signal=signal; return sdk; } });
        clients.push(client); return {client,sdk};
    }
    afterEach(() => { for(const client of clients.splice(0))client.disconnect(); });
    test.each(['entry-first','socket-first'])('requires socket and room entry: %s', async order => {
        const {client,sdk}=setup();const pending=client.connect();await flushConnectorSetup();
        if(order==='entry-first')sdk.enter();else sdk.open();
        await flushConnectorSetup();expect(client.isConnected).toBe(false);
        if(order==='entry-first')sdk.open();else sdk.enter();
        expect(await pending).toEqual({roomId:sdk.roomId});
        expect(await client.fetchIsLive()).toBe(true);expect(await client.getRoomInfo()).toEqual({roomId:sdk.roomId});
        expect(await client.connect()).toEqual({roomId:sdk.roomId});
        expect(client.getState().isConnected).toBe(true);
    });
    test('rejects overlapping connection requests',async()=>{const {client,sdk}=setup();const pending=client.connect();await expect(client.connect()).rejects.toThrow('already');await flushConnectorSetup();sdk.open();sdk.enter();await pending;});
    test('drops events before readiness and after disconnection',async()=>{
        const {client,sdk}=setup();const received:unknown[]=[];client.on('chat',event=>received.push(event));
        const pending=client.connect();await flushConnectorSetup();sdk.emit('chat',{content:'synthetic early'});sdk.open();sdk.enter();await pending;
        sdk.emit('chat',{content:'synthetic ready',user:{displayId:'synthetic-viewer',nickname:'Synthetic Viewer'}});
        client.disconnect();sdk.emit('chat',{content:'synthetic late'});
        expect(received).toHaveLength(1);expect(received[0]).toMatchObject({comment:'synthetic ready',user:{uniqueId:'synthetic-viewer'}});
        expect(sdk.signal?.aborted).toBe(true);expect(sdk.terminated).toBe(1);expect(sdk.disconnects).toBe(1);
        expect(client.stats.messageCount).toBe(1);expect(await client.fetchIsLive()).toBe(false);
        await expect(client.getRoomInfo()).rejects.toThrow('Not connected');
    });
    test('one ready disconnect cannot be undone by late SDK events',async()=>{
        const {client,sdk}=setup();const connected:unknown[]=[];const lost:unknown[]=[];client.on('connected',data=>connected.push(data));client.on('disconnected',data=>lost.push(data));
        const pending=client.connect();await flushConnectorSetup();sdk.open();sdk.enter();await pending;
        sdk.emit('disconnected',{code:1011});sdk.enter();sdk.emit('disconnected',{code:1011});
        expect(client.isConnected).toBe(false);expect(connected).toHaveLength(1);expect(lost).toHaveLength(1);expect(client.lastConnectionError).toMatchObject({code:1011});
    });
    test('routes standalone SDK emotes once only while the connection is ready', async () => {
        const { client, sdk } = setup();
        const received: unknown[] = [];
        client.on('chat', event => received.push(event));
        const payload = { common: { msgId: 'synthetic-emote-message', createTime: '1800000000' },
            user: { displayId: 'synthetic-viewer', nickname: 'Synthetic Viewer' },
            emoteList: [{ emoteId: 'synthetic-emote', image: { urlList: ['https://example.invalid/synthetic-emote.png'] } }] };
        const pending = client.connect();
        await flushConnectorSetup();
        sdk.emit('emote', payload);
        sdk.open(); sdk.enter(); await pending;
        sdk.emit('emote', payload);
        client.disconnect();
        sdk.emit('emote', payload);
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ msgId: 'synthetic-emote-message', user: { uniqueId: 'synthetic-viewer' },
            emotes: [{ placeInComment: 0, emote: { emoteId: 'synthetic-emote', image: { imageUrl: 'https://example.invalid/synthetic-emote.png' } } }] });
    });
});
