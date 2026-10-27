import { expect, test } from 'bun:test';
import { TikTokWebSocketClient } from '../../../src/platforms/tiktok-websocket-client';
import { SyntheticTikTokConnector, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';
test.each([['follow','follow'],['share','share'],['social','social'],['subNotify','subscribe'],['superFanJoin','superfan']])('routes SDK %s to application %s once',async(source,target)=>{
    const sdk=new SyntheticTikTokConnector();const client=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:async()=>sdk});const events:unknown[]=[];client.on(target!,data=>events.push(data));const pending=client.connect();await flushConnectorSetup();sdk.open();sdk.enter();await pending;
    sdk.emit(source!,{user:{displayId:'synthetic-user',nickname:'Synthetic User'},common:{msgId:'synthetic-message'}});expect(events).toHaveLength(1);expect(events[0]).toMatchObject({user:{uniqueId:'synthetic-user'}});client.disconnect();
});
